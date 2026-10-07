import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as Crypto from 'expo-crypto';
import { createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail, signOut, type User } from 'firebase/auth';
import { collection, doc, runTransaction, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { auth, db, getProvisioningAuth } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useRealtimeClock } from '../../shared/hooks/useRealtimeClock';
import type { DepositAccount, InvoiceRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord } from '../../shared/types/records';
import { roundMoney, toNumber } from '../../shared/utils/money';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { getRoomNumbers, getSeatNumbers } from './businessConfig';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { businessTypeOptions, getBusinessType } from './businessTypes';
import { getStartNowStatus } from './customerLifecycle';
import { CustomerCard } from './CustomerCard';
import { customerStatusOptions, getCustomerName, getCustomerStatus, getCustomerStatusGroup, matchesCustomerSearch } from './customerUtils';
import { FilterPill } from './FilterPill';
import { LifecycleMeterSheet, type LifecycleMeterResult } from './LifecycleMeterSheet';
import { canAllocateCustomer, getAllocationKey, getRoomOccupancy, getRoomSummary, normalizeLibrarySeat, parseRoomLabel, staysOverlap } from './roomUtils';
import { calculateOutstandingBalance, calculateSettlement, getCollectedTotal, getDayKey, getMeterChargeForMonth, getMonthKey, matchesDailyStayAction, meterReadingNeedsReview } from '../operations/operationsMath';
import { syncAllocationGuard } from './allocationTransactions';
import { CheckoutSettlementSheet, type CheckoutSettlementDraft } from './CheckoutSettlementSheet';

type CustomerDraft = {
  additionalGuests: string[];
  businessType: string;
  documentId: string;
  documentType: string;
  email: string;
  idProof: string | null;
  idProofName: string | null;
  idProofSize: number;
  idProofType: string | null;
  idProofBack: string | null;
  idProofBackName: string | null;
  idProofBackSize: number;
  customerPhoto: string | null;
  customerPhotoName: string | null;
  customerPhotoSize: number;
  moveInDate: string;
  moveInTime: string;
  moveOutDate: string;
  moveOutTime: string;
  name: string;
  phone: string;
  rent: number;
  room: string;
  roomType: string;
  services: string[];
  status: string;
};

type PendingMeterLifecycle = {
  action: 'check-in' | 'check-out';
  customer: TenantRecord;
  minimumReading: number;
};

type PendingSettlement = {
  customer: TenantRecord;
  meterResult?: LifecycleMeterResult;
  minimumReading: number;
};

const initialForm = {
  additionalGuests: [] as string[],
  businessType: 'pg',
  documentId: '',
  documentType: 'aadhaar',
  email: '',
  idProof: null as string | null,
  idProofName: null as string | null,
  idProofSize: 0,
  idProofType: null as string | null,
  idProofBack: null as string | null,
  idProofBackName: null as string | null,
  idProofBackSize: 0,
  customerPhoto: null as string | null,
  customerPhotoName: null as string | null,
  customerPhotoSize: 0,
  moveInDate: '',
  moveInTime: '12:00',
  moveOutDate: '',
  moveOutTime: '11:00',
  name: '',
  phone: '',
  rent: '',
  room: '',
  roomType: 'single',
  services: [] as string[],
  status: 'checked in',
};

const activeAllocationStatuses = ['active', 'booked', 'checked in', 'occupied'];
const documentTypes = [
  { label: 'Aadhaar Card', needsBack: true, value: 'aadhaar' },
  { label: 'PAN Card', needsBack: false, value: 'pan' },
  { label: 'Driving Licence', needsBack: true, value: 'driving-licence' },
  { label: 'Voter ID', needsBack: true, value: 'voter-id' },
  { label: 'Passport', needsBack: false, value: 'passport' },
];

type CustomerPhotoTarget = 'customer' | 'document-front' | 'document-back';

const validationPatterns = {
  aadhaar: /^\d{12}$/,
  pan: /^[A-Z]{5}\d{4}[A-Z]$/,
  'driving-licence': /^[A-Z]{2}\d{2}[A-Z0-9]{7,13}$/,
  'voter-id': /^[A-Z]{3}\d{7}$/,
  passport: /^[A-Z][1-9]\d{6}$/,
};

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

function isValidPersonName(value: string) {
  return /^[\p{L}][\p{L}\s.'-]{1,79}$/u.test(value.trim());
}

function isValidDateText(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]);
}

function isValidTimeText(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function needsCustomerAttention(customer: TenantRecord) {
  return getCustomerStatusGroup(customer) === 'reserved'
    || !customer.room
    || !customer.phone
    || !customer.documentId
    || !customer.idProof;
}

export function CustomersScreen({
  initialCustomerId = '',
  initialActionFilter = '',
  initialMode = 'All',
  initialStatusFilter = '',
  isAdmin,
}: {
  initialCustomerId?: string;
  initialActionFilter?: string;
  initialMode?: string;
  initialStatusFilter?: string;
  isAdmin: boolean;
}) {
  const { settings, can } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const meterReadings = useFirestoreCollection<MeterReadingRecord>('meterReadings', { sortBy: 'createdAt' });
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices', { sortBy: 'issuedAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments', { sortBy: 'createdAt' });
  const settlements = useFirestoreCollection<SettlementRecord>('settlements', { sortBy: 'finalizedAt' });
  const now = useRealtimeClock();
  const today = getDayKey(new Date(now));
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState(initialActionFilter);
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [mode, setMode] = useState(initialMode);
  const [selectedRoom, setSelectedRoom] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(initialCustomerId);
  const [editingCustomer, setEditingCustomer] = useState<TenantRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [cancellingId, setCancellingId] = useState('');
  const [invitingId, setInvitingId] = useState('');
  const [accessChangingId, setAccessChangingId] = useState('');
  const [checkingOutId, setCheckingOutId] = useState('');
  const [checkingInId, setCheckingInId] = useState('');
  const [actionError, setActionError] = useState('');
  const [viewingProof, setViewingProof] = useState<TenantRecord | null>(null);
  const [pendingMeterLifecycle, setPendingMeterLifecycle] = useState<PendingMeterLifecycle | null>(null);
  const [pendingSettlement, setPendingSettlement] = useState<PendingSettlement | null>(null);
  const [savingSettlement, setSavingSettlement] = useState(false);
  const deposits = useFirestoreCollection<DepositAccount>('depositAccounts');
  const settlementPreview = useMemo(() => {
    if (!pendingSettlement) return { automaticCharge: 0, ledgerBalance: 0, month: getMonthKey() };

    const month = getMonthKey(new Date(now));
    const units = pendingSettlement.meterResult
      ? Math.max(0, pendingSettlement.meterResult.reading - pendingSettlement.minimumReading)
      : 0;
    const meterCharge = roundMoney(units * settings.meterRate);
    const previewReadings = pendingSettlement.meterResult ? [...meterReadings.data, {
      id: 'checkout-preview',
      billAmount: meterCharge,
      currentReading: pendingSettlement.meterResult.reading,
      month,
      previousReading: pendingSettlement.minimumReading,
      ratePerUnit: settings.meterRate,
      readingType: 'check-out' as const,
      tenantId: pendingSettlement.customer.id,
      unitsConsumed: units,
    }] : meterReadings.data;
    const currentInvoice = invoices.data.find((invoice) =>
      invoice.tenantId === pendingSettlement.customer.id && invoice.month === month);

    return {
      automaticCharge: currentInvoice
        ? Math.max(0, getMeterChargeForMonth(previewReadings, pendingSettlement.customer.id, month) - currentInvoice.meterAmount)
        : 0,
      ledgerBalance: calculateOutstandingBalance(
        pendingSettlement.customer,
        payments.data,
        previewReadings,
        month,
        invoices.data,
        settlements.data,
      ),
      month,
    };
  }, [invoices.data, meterReadings.data, now, payments.data, pendingSettlement, settlements.data, settings.meterRate]);
  const roomSummary = useMemo(() => getRoomSummary(tenants.data, now, settings), [now, tenants.data, settings]);
  const roomOccupancy = useMemo(() => getRoomOccupancy(tenants.data, now, settings), [now, tenants.data, settings]);
  const filtered = useMemo(
    () =>
      tenants.data.filter((tenant) => {
        const typeMatches = typeFilter ? (tenant.businessType || 'pg') === typeFilter : true;
        const statusMatches = statusFilter ? getCustomerStatusGroup(tenant) === statusFilter : true;
        const roomMode = mode === 'Rooms' ? ['pg', 'hotel'].includes(String(tenant.businessType || 'pg')) && Boolean(tenant.room) : true;
        const roomMatches = selectedRoom ? parseRoomLabel(tenant.room).room === selectedRoom : true;
        const needsAttention = mode === 'Needs attention' ? needsCustomerAttention(tenant) : true;
        const matchesAction = actionFilter ? matchesDailyStayAction(tenant, actionFilter, today) : true;

        return typeMatches && statusMatches && roomMode && roomMatches && needsAttention && matchesAction && matchesCustomerSearch(tenant, search);
      }),
    [actionFilter, mode, search, selectedRoom, statusFilter, tenants.data, today, typeFilter],
  );

  function updateMode(nextMode: string) {
    setMode(nextMode);
    setActionFilter('');
    if (nextMode !== 'Rooms') setSelectedRoom('');
  }

  function openCreateForm() {
    setEditingCustomer(null);
    setActionError('');
    setShowForm(true);
  }

  function openEditForm(customer: TenantRecord) {
    setEditingCustomer(customer);
    setActionError('');
    setShowForm(true);
  }

  async function saveCustomer(payload: CustomerDraft) {
    if (editingCustomer?.membershipManaged && ['businessType', 'moveOutDate', 'rent'].some((field) => String(payload[field as keyof CustomerDraft] ?? '') !== String(editingCustomer[field] ?? ''))) return t('Use Memberships to change the membership period or plan.');
    const previousStatus = editingCustomer ? getCustomerStatus(editingCustomer) : '';
    const requiresInitialMeter = !editingCustomer && payload.businessType === 'pg' && payload.status === 'checked in';
    const savedPayload = requiresInitialMeter ? { ...payload, status: 'booked' } : payload;
    const leavingCheckedInState = ['active', 'checked in', 'occupied'].includes(previousStatus) && payload.status !== previousStatus;
    const isMeterLifecycleTransition = editingCustomer
      && ['pg', 'hotel'].includes(String(editingCustomer.businessType || 'pg'))
      && payload.status !== previousStatus
      && (['checked in', 'checked out'].includes(payload.status) || leavingCheckedInState);

    if (isMeterLifecycleTransition) {
      Alert.alert(t('Use checkout action'), t('Use the Check in or Check out action from customer details so the financial settlement is saved.'));
      return;
    }

    setSaving(true);
    setActionError('');

    try {
      const now = new Date();
      const localDate = getLocalDate(now);
      const localTime = now.toTimeString().slice(0, 5);
      const lifecycleFields = savedPayload.status === 'checked out' && previousStatus !== 'checked out'
        ? {
            checkedOutAt: serverTimestamp(),
            moveOutDate: savedPayload.moveOutDate || localDate,
            moveOutTime: savedPayload.moveOutTime || localTime,
          }
        : ['active', 'checked in', 'occupied'].includes(savedPayload.status) && !['active', 'checked in', 'occupied'].includes(previousStatus)
          ? {
              checkedInAt: serverTimestamp(),
              moveInDate: savedPayload.moveInDate || localDate,
              moveInTime: savedPayload.moveInTime || localTime,
            }
          : {};

      const customerRef = editingCustomer
        ? doc(db, 'tenants', editingCustomer.id)
        : doc(collection(db, 'tenants'));
      const nextCustomer = { id: customerRef.id, ...editingCustomer, ...savedPayload, ...lifecycleFields } as TenantRecord;

      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customerRef.id, editingCustomer || undefined, nextCustomer, tenants.data);
        if (editingCustomer) {
          transaction.update(customerRef, { ...savedPayload, ...lifecycleFields, updatedAt: serverTimestamp() });
        } else {
          transaction.set(customerRef, {
            ...savedPayload,
            ...lifecycleFields,
            createdAt: serverTimestamp(),
            idProof: savedPayload.idProof || null,
            idProofName: savedPayload.idProofName || null,
            idProofSize: savedPayload.idProofSize || 0,
            idProofType: savedPayload.idProofType || null,
            idProofBack: savedPayload.idProofBack || null,
            idProofBackName: savedPayload.idProofBackName || null,
            idProofBackSize: savedPayload.idProofBackSize || 0,
            customerPhoto: savedPayload.customerPhoto || null,
            customerPhotoName: savedPayload.customerPhotoName || null,
            customerPhotoSize: savedPayload.customerPhotoSize || 0,
          });
        }
      });

      if (!editingCustomer) {
        if (requiresInitialMeter) {
          setPendingMeterLifecycle({
            action: 'check-in',
            customer: { id: customerRef.id, ...savedPayload },
            minimumReading: getRoomReading({ id: customerRef.id, ...savedPayload }),
          });
        }
      }

      setShowForm(false);
      setEditingCustomer(null);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : t('Could not save customer.');
      setActionError(message);
      return message;
    } finally {
      setSaving(false);
    }
  }

  async function archiveCustomer(customer: TenantRecord) {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) {
      setActionError(t('Please sign in again.'));
      return;
    }

    setDeletingId(customer.id);
    setActionError('');

    try {
      const archivedStatus = getCustomerStatus(customer) === 'booked' ? 'cancelled' : 'inactive';
      const archiveDate = getLocalDate(new Date());
      const archivedCustomer = { ...customer, accessStatus: customer.userId ? 'revoked' : customer.accessStatus, archived: true, moveOutDate: customer.moveOutDate || archiveDate, status: archivedStatus } as TenantRecord;
      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customer.id, customer, archivedCustomer, tenants.data);
        if (customer.userId) {
          transaction.update(doc(db, 'users', customer.userId), {
            accessStatus: 'revoked',
            revokedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        transaction.update(doc(db, 'tenants', customer.id), {
          accessStatus: customer.userId ? 'revoked' : customer.accessStatus || 'active',
          archived: true,
          archivedAt: serverTimestamp(),
          archivedBy: actorUid,
          checkedOutAt: serverTimestamp(),
          moveOutDate: customer.moveOutDate || archiveDate,
          status: archivedStatus,
          updatedAt: serverTimestamp(),
        });
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: 'customer.archived',
          actorUid,
          createdAt: serverTimestamp(),
          customerId: customer.id,
          customerName: getCustomerName(customer),
        });
      });
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not archive customer.'));
    } finally {
      setDeletingId('');
    }
  }

  function confirmArchive(customer: TenantRecord) {
    Alert.alert(t('Archive customer?'), `${customer.name || t('This customer')} · ${t('Their history and financial records will be kept.')}`, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Archive'), style: 'destructive', onPress: () => archiveCustomer(customer) },
    ]);
  }

  async function shareCustomerAccess(customer: TenantRecord) {
    const email = customer.email?.trim().toLowerCase();
    if (!email) {
      Alert.alert(t('Email required'), t('Add the customer email before sharing app access.'));
      return;
    }

    setInvitingId(customer.id);
    setActionError('');

    try {
      if (!customer.userId) {
        const actorUid = auth.currentUser?.uid;
        if (!actorUid) throw new Error(t('Please sign in again.'));

        const provisioningAuth = getProvisioningAuth();
        let createdUser: User | undefined;

        try {
          const credential = await createUserWithEmailAndPassword(
            provisioningAuth,
            email,
            `${Crypto.randomUUID()}Aa1!`,
          );
          createdUser = credential.user;

          const batch = writeBatch(db);
          batch.set(doc(db, 'users', createdUser.uid), {
            accessStatus: 'invited',
            createdAt: serverTimestamp(),
            customerId: customer.id,
            email,
            name: customer.name || customer.fullName || customer.tenantName || '',
            role: 'customer',
            uid: createdUser.uid,
            updatedAt: serverTimestamp(),
          });
          batch.update(doc(db, 'tenants', customer.id), {
            accessStatus: 'invited',
            invitedAt: serverTimestamp(),
            invitedBy: actorUid,
            updatedAt: serverTimestamp(),
            userId: createdUser.uid,
          });
          batch.set(doc(collection(db, 'auditEvents')), {
            action: 'customer.access_provisioned',
            actorUid,
            createdAt: serverTimestamp(),
            customerId: customer.id,
            customerName: customer.name || customer.fullName || customer.tenantName || '',
          });
          await batch.commit();
        } catch (error) {
          if (createdUser) await deleteUser(createdUser).catch(() => undefined);
          if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/email-already-in-use') {
            throw new Error(t('This email already has an account but is not linked. Use another email.'));
          }
          throw error;
        } finally {
          await signOut(provisioningAuth).catch(() => undefined);
        }
      }

      await sendPasswordResetEmail(auth, email);
      Alert.alert(t('Access email sent'), `${t('Password setup instructions were sent to')} ${email}.`);
    } catch (inviteError) {
      const message = inviteError instanceof Error ? inviteError.message : t('Could not send customer access email.');
      setActionError(message);
      Alert.alert(t('Could not send access'), message);
    } finally {
      setInvitingId('');
    }
  }

  async function changeCustomerAccess(customer: TenantRecord) {
    if (!customer.userId || customer.accessStatus === 'revoked') return;

    const actorUid = auth.currentUser?.uid;
    if (!actorUid) {
      setActionError(t('Please sign in again.'));
      return;
    }

    const nextStatus = customer.accessStatus === 'suspended' ? 'active' : 'suspended';
    setAccessChangingId(customer.id);
    setActionError('');

    try {
      const batch = writeBatch(db);
      const accessUpdate = { accessStatus: nextStatus, accessUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() };
      batch.update(doc(db, 'users', customer.userId), accessUpdate);
      batch.update(doc(db, 'tenants', customer.id), accessUpdate);
      batch.set(doc(collection(db, 'auditEvents')), {
        action: `customer.access_${nextStatus}`,
        actorUid,
        createdAt: serverTimestamp(),
        customerId: customer.id,
        customerName: getCustomerName(customer),
      });
      await batch.commit();
    } catch (accessError) {
      setActionError(accessError instanceof Error ? accessError.message : t('Could not update customer access.'));
    } finally {
      setAccessChangingId('');
    }
  }

  function getRoomReading(customer: TenantRecord) {
    const room = parseRoomLabel(customer.room).room;
    const roomReading = meterReadings.data.find((reading) =>
      !meterReadingNeedsReview(meterReadings.data, reading)
      && parseRoomLabel(reading.tenantRoom).room === room);
    return toNumber(roomReading?.currentReading);
  }

  function startMeterLifecycle(customer: TenantRecord, action: PendingMeterLifecycle['action']) {
    setActionError('');
    setPendingMeterLifecycle({
      action,
      customer,
      minimumReading: getRoomReading(customer),
    });
  }

  async function completeMeterLifecycle(result: LifecycleMeterResult) {
    if (!pendingMeterLifecycle) return;

    const { action, customer, minimumReading } = pendingMeterLifecycle;
    const checkingIn = action === 'check-in';
    if (!checkingIn) {
      setPendingMeterLifecycle(null);
      setPendingSettlement({ customer, meterResult: result, minimumReading });
      return;
    }
    const setBusy = checkingIn ? setCheckingInId : setCheckingOutId;
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) {
      setActionError(t('Please sign in again.'));
      return;
    }
    setBusy(customer.id);
    setActionError('');

    try {
      const eventTime = new Date();
      const readingRef = doc(collection(db, 'meterReadings'));
      const unitsConsumed = checkingIn ? 0 : Math.max(0, result.reading - minimumReading);
      const tenantUpdate = checkingIn ? {
        checkedInAt: serverTimestamp(),
        checkInMeterReading: result.reading,
        checkInMeterReadingId: readingRef.id,
        moveInDate: getLocalDate(eventTime),
        moveInTime: eventTime.toTimeString().slice(0, 5),
        status: 'checked in',
        updatedAt: serverTimestamp(),
      } : {
        checkedOutAt: serverTimestamp(),
        checkOutMeterReading: result.reading,
        checkOutMeterReadingId: readingRef.id,
        moveOutDate: getLocalDate(eventTime),
        moveOutTime: eventTime.toTimeString().slice(0, 5),
        status: 'checked out',
        updatedAt: serverTimestamp(),
      };
      const nextCustomer = { ...customer, ...tenantUpdate, status: checkingIn ? 'checked in' : 'checked out' } as TenantRecord;

      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customer.id, customer, nextCustomer, tenants.data);
        transaction.set(readingRef, {
          billAmount: roundMoney(unitsConsumed * settings.meterRate),
          createdAt: serverTimestamp(),
          currentReading: result.reading,
          month: `${eventTime.getFullYear()}-${String(eventTime.getMonth() + 1).padStart(2, '0')}`,
          note: checkingIn ? 'Check-in meter photo' : 'Check-out meter photo',
          ocrText: result.ocrText,
          photo: result.photo,
          photoSize: result.photoSize,
          previousReading: minimumReading,
          ratePerUnit: settings.meterRate,
          readingSource: `ocr-confirmed-${result.photoSource}`,
          readingType: action,
          tenantId: customer.id,
          tenantName: customer.name || customer.fullName || customer.tenantName || 'Unnamed customer',
          tenantRoom: customer.room || '',
          unitsConsumed,
        });
        transaction.update(doc(db, 'tenants', customer.id), tenantUpdate);
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: checkingIn ? 'customer.checked_in' : 'customer.checked_out',
          actorUid,
          createdAt: serverTimestamp(),
          customerId: customer.id,
          customerName: customer.name || customer.fullName || customer.tenantName || '',
        });
      });
      setPendingMeterLifecycle(null);
    } catch (lifecycleError) {
      setActionError(lifecycleError instanceof Error ? lifecycleError.message : t('Could not save meter lifecycle.'));
    } finally {
      setBusy('');
    }
  }

  async function completeRoomLifecycle(customer: TenantRecord, action: PendingMeterLifecycle['action']) {
    const checkingIn = action === 'check-in';
    if (!checkingIn) {
      setPendingSettlement({ customer, minimumReading: 0 });
      return;
    }
    const setBusy = checkingIn ? setCheckingInId : setCheckingOutId;
    const actorUid = auth.currentUser?.uid;

    if (!actorUid) {
      setActionError(t('Please sign in again.'));
      return;
    }

    setBusy(customer.id);
    setActionError('');

    try {
      const eventTime = new Date();
      const tenantUpdate = checkingIn ? {
        checkedInAt: serverTimestamp(),
        moveInDate: getLocalDate(eventTime),
        moveInTime: eventTime.toTimeString().slice(0, 5),
        status: 'checked in',
        updatedAt: serverTimestamp(),
      } : {
        checkedOutAt: serverTimestamp(),
        moveOutDate: getLocalDate(eventTime),
        moveOutTime: eventTime.toTimeString().slice(0, 5),
        status: 'checked out',
        updatedAt: serverTimestamp(),
      };
      const nextCustomer = { ...customer, ...tenantUpdate, status: checkingIn ? 'checked in' : 'checked out' } as TenantRecord;
      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customer.id, customer, nextCustomer, tenants.data);
        transaction.update(doc(db, 'tenants', customer.id), tenantUpdate);
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: checkingIn ? 'customer.checked_in' : 'customer.checked_out',
          actorUid,
          createdAt: serverTimestamp(),
          customerId: customer.id,
          customerName: customer.name || customer.fullName || customer.tenantName || '',
        });
      });
    } catch (lifecycleError) {
      setActionError(lifecycleError instanceof Error ? lifecycleError.message : t('Could not update customer lifecycle.'));
    } finally {
      setBusy('');
    }
  }

  async function finalizeCheckout(draft: CheckoutSettlementDraft) {
    if (!pendingSettlement) return;
    if (deposits.loading || deposits.error) return setActionError(t('Wait for the deposit ledger to load.'));
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) return setActionError(t('Please sign in again.'));

    const { customer, meterResult, minimumReading } = pendingSettlement;
    const result = calculateSettlement({ ...draft, ledgerBalance: settlementPreview.ledgerBalance });
    const eventTime = new Date();
    const tenantPayments = payments.data.filter((payment) => payment.tenantId === customer.id || payment.userId === customer.id);
    const paidAtSettlement = getCollectedTotal(tenantPayments) + result.paymentReceived;
    const paymentRef = doc(collection(db, 'payments'));
    const readingRef = doc(collection(db, 'meterReadings'));
    const tenantUpdate = {
      checkedOutAt: serverTimestamp(),
      moveOutDate: getLocalDate(eventTime),
      moveOutTime: eventTime.toTimeString().slice(0, 5),
      ...(meterResult ? { checkOutMeterReading: meterResult.reading, checkOutMeterReadingId: readingRef.id } : {}),
      status: 'checked out',
      updatedAt: serverTimestamp(),
    };
    const nextCustomer = { ...customer, ...tenantUpdate, status: 'checked out' } as TenantRecord;

    setSavingSettlement(true);
    setCheckingOutId(customer.id);
    setActionError('');
    try {
      await runTransaction(db, async (transaction) => {
        const depositRef = doc(db, 'depositAccounts', customer.id);
        const deposit = await transaction.get(depositRef);
        if (deposit.exists() && deposit.data().held !== draft.depositHeld) throw new Error('Deposit changed. Reopen checkout before continuing.');
        await syncAllocationGuard(transaction, customer.id, customer, nextCustomer, tenants.data);
        if (deposit.exists()) {
          const eventRef = doc(collection(db, 'depositEvents'));
          transaction.set(depositRef, { tenantId: customer.id, held: 0, eventId: eventRef.id, updatedAt: serverTimestamp(), updatedBy: actorUid });
          transaction.set(eventRef, { tenantId: customer.id, tenantName: getCustomerName(customer), kind: 'application', amount: draft.depositHeld, before: draft.depositHeld, after: 0, paymentMode: 'Cash', reference: '', note: 'Deposit transferred to checkout settlement: applied to due or reserved for refund', createdAt: serverTimestamp(), createdBy: actorUid });
        }

        if (meterResult) {
          const unitsConsumed = Math.max(0, meterResult.reading - minimumReading);
          transaction.set(readingRef, {
            billAmount: roundMoney(unitsConsumed * settings.meterRate),
            createdAt: serverTimestamp(),
            currentReading: meterResult.reading,
            month: settlementPreview.month,
            note: 'Check-out meter photo',
            ocrText: meterResult.ocrText,
            photo: meterResult.photo,
            photoSize: meterResult.photoSize,
            previousReading: minimumReading,
            ratePerUnit: settings.meterRate,
            readingSource: `ocr-confirmed-${meterResult.photoSource}`,
            readingType: 'check-out',
            tenantId: customer.id,
            tenantName: getCustomerName(customer),
            tenantRoom: customer.room || '',
            unitsConsumed,
          });
        }

        if (result.paymentReceived > 0) {
          transaction.set(paymentRef, {
            amountPaid: result.paymentReceived,
            balance: result.finalBalance,
            businessType: customer.businessType || 'pg',
            createdAt: serverTimestamp(),
            createdBy: actorUid,
            month: settlementPreview.month,
            paymentMode: draft.paymentMode, reference: draft.reference, collectedBy: actorUid,
            note: 'Checkout settlement',
            paidOn: eventTime.toLocaleDateString('en-IN'),
            status: 'Recorded',
            tenantId: customer.id,
            tenantName: getCustomerName(customer),
            tenantRoom: customer.room || '',
            totalRent: result.grossDue,
          });
          transaction.set(doc(collection(db, 'auditEvents')), {
            action: 'payment.created', actorUid, createdAt: serverTimestamp(), entityId: paymentRef.id, entityType: 'payment',
          });
        }

        transaction.update(doc(db, 'tenants', customer.id), tenantUpdate);
        transaction.set(doc(db, 'settlements', customer.id), {
          depositApplied: result.depositApplied,
          depositHeld: draft.depositHeld,
          discount: draft.discount,
          extraCharge: draft.extraCharge,
          finalBalance: result.finalBalance,
          finalizedAt: serverTimestamp(),
          finalizedBy: actorUid,
          grossDue: result.grossDue,
          ledgerBalance: settlementPreview.ledgerBalance,
          month: settlementPreview.month,
          paidAtSettlement,
          paymentReceived: result.paymentReceived,
          refundDue: result.refundDue,
          refundStatus: result.refundDue > 0 ? 'Due' : 'None',
          status: 'Final',
          tenantId: customer.id,
          tenantName: getCustomerName(customer),
        });
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: 'settlement.finalized', actorUid, createdAt: serverTimestamp(), entityId: customer.id, entityType: 'settlement',
        });
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: 'customer.checked_out', actorUid, createdAt: serverTimestamp(), customerId: customer.id, customerName: getCustomerName(customer),
        });
      });
      setPendingSettlement(null);
    } catch (settlementError) {
      setActionError(settlementError instanceof Error ? settlementError.message : t('Could not finalize checkout.'));
    } finally {
      setSavingSettlement(false);
      setCheckingOutId('');
    }
  }

  function confirmCheckIn(customer: TenantRecord) {
    if (String(customer.businessType || 'pg') === 'pg') {
      startMeterLifecycle(customer, 'check-in');
      return;
    }

    Alert.alert(t('Check in customer?'), getCustomerName(customer), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Check in'), onPress: () => completeRoomLifecycle(customer, 'check-in') },
    ]);
  }

  function confirmCheckOut(customer: TenantRecord) {
    if (payments.loading || invoices.loading || settlements.loading || meterReadings.loading) {
      setActionError(t('Wait for financial records to finish loading, then try checkout again.'));
      return;
    }
    if (String(customer.businessType || 'pg') === 'pg') {
      startMeterLifecycle(customer, 'check-out');
      return;
    }

    Alert.alert(t('Check out customer?'), getCustomerName(customer), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Check out'), onPress: () => completeRoomLifecycle(customer, 'check-out') },
    ]);
  }

  async function cancelReservation(customer: TenantRecord) {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) {
      setActionError(t('Please sign in again.'));
      return;
    }

    setCancellingId(customer.id);
    setActionError('');

    try {
      const tenantUpdate = {
        ...(customer.userId ? { accessStatus: 'revoked', revokedAt: serverTimestamp() } : {}),
        cancelledAt: serverTimestamp(),
        cancelledBy: actorUid,
        status: 'cancelled',
        updatedAt: serverTimestamp(),
      };
      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customer.id, customer, { ...customer, ...tenantUpdate, status: 'cancelled' } as TenantRecord, tenants.data);
        transaction.update(doc(db, 'tenants', customer.id), tenantUpdate);
        if (customer.userId) {
          transaction.update(doc(db, 'users', customer.userId), {
            accessStatus: 'revoked',
            revokedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: 'customer.reservation_cancelled',
          actorUid,
          createdAt: serverTimestamp(),
          customerId: customer.id,
          customerName: customer.name || customer.fullName || customer.tenantName || '',
        });
      });
    } catch (cancelError) {
      setActionError(cancelError instanceof Error ? cancelError.message : t('Could not cancel reservation.'));
    } finally {
      setCancellingId('');
    }
  }

  function confirmCancelReservation(customer: TenantRecord) {
    Alert.alert(t('Cancel reservation?'), `${getCustomerName(customer)} · ${t('The customer record will remain in history.')}`, [
      { text: t('Keep reservation'), style: 'cancel' },
      { text: t('Cancel reservation'), style: 'destructive', onPress: () => cancelReservation(customer) },
    ]);
  }

  return (
    <View>
      {showForm ? (
        <CustomerFormSheet
          customer={editingCustomer}
          customers={tenants.data}
          onClose={() => {
            setShowForm(false);
            setEditingCustomer(null);
          }}
          onSubmit={saveCustomer}
          saving={saving}
          styles={styles}
        />
      ) : null}
      <IdProofPreview onClose={() => setViewingProof(null)} proof={viewingProof} styles={styles} />
      {pendingMeterLifecycle ? (
        <LifecycleMeterSheet
          action={pendingMeterLifecycle.action}
          customer={pendingMeterLifecycle.customer}
          minimumReading={pendingMeterLifecycle.minimumReading}
          onClose={() => setPendingMeterLifecycle(null)}
          onSubmit={completeMeterLifecycle}
          saving={checkingInId === pendingMeterLifecycle.customer.id || checkingOutId === pendingMeterLifecycle.customer.id}
        />
      ) : null}
      {pendingSettlement ? (
        <CheckoutSettlementSheet
          heldDeposit={deposits.data.find((item) => item.id === pendingSettlement.customer.id)?.held}
          automaticCharge={settlementPreview.automaticCharge}
          customer={pendingSettlement.customer}
          ledgerBalance={settlementPreview.ledgerBalance}
          onClose={() => setPendingSettlement(null)}
          onSubmit={finalizeCheckout}
          saving={savingSettlement}
        />
      ) : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.kicker}>{t('Stays & seats')}</Text>
            <Text style={styles.title}>{tenants.data.length} {t('customers')}</Text>
            <Text style={styles.subtitle}>{t('Manage guests, members, rooms, seats, and contact details.')}</Text>
          </View>
          <Pressable accessibilityLabel={t('Add customer')} accessibilityRole="button" hitSlop={8} onPress={openCreateForm} style={styles.addButton}>
            <Text style={styles.addButtonText}>{t('Add')}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.summaryGrid}>
        <SummaryTile label={t('Occupied rooms')} styles={styles} value={`${roomSummary.occupiedRooms}/${roomSummary.totalRooms}`} />
        <SummaryTile label={t('Available rooms')} styles={styles} value={roomSummary.availableRooms} />
        <SummaryTile label={t('Staying now')} styles={styles} value={roomSummary.activeRoomCustomers} />
      </View>

      <View style={styles.modeSwitch}>
        {['All', 'Rooms', 'Needs attention'].map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: mode === item }}
            key={item}
            onPress={() => updateMode(item)}
            style={[styles.modeItem, mode === item && styles.modeItemActive]}
          >
            <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>{t(item)}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.modeFeedback}>
        <Text style={styles.modeFeedbackTitle}>
          {t(mode === 'All' ? 'All customers' : mode === 'Rooms' ? 'Room customers' : 'Needs attention')} · {filtered.length}
        </Text>
        <Text style={styles.modeFeedbackText}>
          {t(mode === 'All'
            ? 'Everyone across PG, hotel, and library.'
            : mode === 'Rooms'
              ? 'PG and hotel customers assigned to rooms. Tap a room to narrow the list.'
              : 'Reserved customers or records missing room, phone, document, or ID proof.')}
        </Text>
      </View>

      {mode === 'Rooms' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.roomRail}>
          {roomOccupancy.map((room) => {
            const roomLabel = room.businessType === 'hotel'
              ? 'Hotel occupied'
              : room.businessType === 'pg'
                ? room.availableBeds > 0 ? `${t('PG')} · ${room.availableBeds} ${t('spots open')}` : 'PG full'
                : 'Available';

            return <Pressable
              accessibilityRole="button"
              key={room.room}
              onPress={() => setSelectedRoom((current) => current === room.room ? '' : room.room)}
              style={[
                styles.roomCard,
                room.status === 'Full' && styles.roomCardFull,
                selectedRoom === room.room && styles.roomCardSelected,
              ]}
            >
              <Text style={[styles.roomNumber, room.status === 'Full' && styles.roomTextFull]}>{t('Room')} {room.room}</Text>
              <Text style={[styles.roomStatus, room.status === 'Full' && styles.roomStatusFull]}>{t(roomLabel)}</Text>
              <Text style={[styles.roomMeta, room.status === 'Full' && styles.roomMetaFull]}>
                {room.businessType === 'hotel'
                  ? `${t('Hotel')} / ${room.guestCount} ${t(room.guestCount === 1 ? 'guest' : 'guests')}`
                  : room.businessType === 'pg'
                    ? `${room.occupants.length} ${t(room.occupants.length === 1 ? 'tenant' : 'tenants')}`
                    : t('PG or Hotel')}
              </Text>
            </Pressable>;
          })}
        </ScrollView>
      ) : null}

      {selectedRoom ? (
        <Pressable accessibilityRole="button" onPress={() => setSelectedRoom('')} style={styles.activeRoomFilter}>
          <Text style={styles.activeRoomFilterText}>{t('Room')} {selectedRoom} {t('selected. Tap to clear')}</Text>
        </Pressable>
      ) : null}

      {actionFilter ? (
        <Pressable accessibilityRole="button" onPress={() => setActionFilter('')} style={styles.activeRoomFilter}>
          <Text style={styles.activeRoomFilterText}>
            {t(actionFilter === 'arrival' ? 'Ready to check in selected. Tap to clear' : 'Check-outs due selected. Tap to clear')}
          </Text>
        </Pressable>
      ) : null}

      <TextInput
        autoCapitalize="none"
        onChangeText={setSearch}
        placeholder="Name, room, phone, document ID..."
        placeholderTextColor={colors.muted}
        style={styles.search}
        value={search}
      />

      <Text style={styles.filterTitle}>Business</Text>
      <View style={styles.filters}>
        <FilterPill active={!typeFilter} label="All" onPress={() => setTypeFilter('')} />
        {businessTypeOptions.map((type) => (
          <FilterPill
            active={typeFilter === type.id}
            key={type.id}
            label={type.label}
            onPress={() => setTypeFilter(type.id)}
          />
        ))}
      </View>

      <Text style={styles.filterTitle}>Status</Text>
      <View style={styles.filters}>
        {customerStatusOptions.map((status) => (
          <FilterPill
            active={statusFilter === status.value}
            key={status.label}
            label={status.label}
            onPress={() => setStatusFilter(status.value)}
          />
        ))}
      </View>

      {tenants.loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading customers')}</Text>
        </View>
      ) : null}

      {tenants.error ? <Text style={styles.errorText}>{tenants.error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.list}>
        {filtered.length ? (
          filtered.slice(0, 40).map((tenant) => (
            <CustomerCard
              accessActionLabel={tenant.accessStatus === 'suspended' ? 'Restore access' : 'Suspend access'}
              accessChanging={accessChangingId === tenant.id}
              cancelling={cancellingId === tenant.id}
              checkingIn={checkingInId === tenant.id}
              checkingOut={checkingOutId === tenant.id}
              customer={tenant}
              deleting={deletingId === tenant.id}
              expanded={selectedCustomerId === tenant.id}
              inviting={invitingId === tenant.id}
              key={tenant.id}
              onDelete={isAdmin ? () => confirmArchive(tenant) : undefined}
              onCancel={() => confirmCancelReservation(tenant)}
              onAccessChange={isAdmin && tenant.userId && tenant.accessStatus !== 'revoked' ? () => changeCustomerAccess(tenant) : undefined}
              onEdit={() => openEditForm(tenant)}
              onInvite={isAdmin && getCustomerStatusGroup(tenant) !== 'cancelled' && tenant.accessStatus !== 'suspended' && tenant.accessStatus !== 'revoked' ? () => shareCustomerAccess(tenant) : undefined}
              onCheckIn={() => confirmCheckIn(tenant)}
              onCheckOut={can('money') ? () => confirmCheckOut(tenant) : undefined}
              onToggle={() => setSelectedCustomerId((current) => current === tenant.id ? '' : tenant.id)}
              onViewIdProof={() => setViewingProof(tenant)}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>{t('Nothing found')}</Text>
            <Text style={styles.emptyText}>{t('Try changing the search or filters.')}</Text>
          </View>
        )}
      </View>

      {filtered.length > 40 ? (
        <Text style={styles.footerText}>{t('Showing first 40 customers. Search to find someone faster.')}</Text>
      ) : null}
    </View>
  );
}

function getLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function SummaryTile({
  label,
  styles,
  value,
}: {
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: number | string;
}) {
  return (
    <View style={styles.summaryTile}>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

type CustomerFormStep = 'business' | 'allocation' | 'details';

const customerFormSteps: Array<{ id: CustomerFormStep; label: string }> = [
  { id: 'business', label: 'Business' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'details', label: 'Details' },
];

function CustomerFormSheet({
  customer,
  customers,
  onClose,
  onSubmit,
  saving,
  styles,
}: {
  customer: TenantRecord | null;
  customers: TenantRecord[];
  onClose: () => void;
  onSubmit: (payload: CustomerDraft) => Promise<string | void>;
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const { settings } = useBusinessSettings();
  const { t } = useLanguage();
  const [form, setForm] = useState(() => ({
    ...initialForm,
    additionalGuests: Array.isArray(customer?.additionalGuests) ? customer.additionalGuests : [],
    businessType: customer?.businessType || initialForm.businessType,
    documentId: customer?.documentId || '',
    documentType: customer?.documentType || initialForm.documentType,
    email: customer?.email || '',
    idProof: customer?.idProof || null,
    idProofName: customer?.idProofName || null,
    idProofSize: customer?.idProofSize || 0,
    idProofType: customer?.idProofType || null,
    idProofBack: customer?.idProofBack || null,
    idProofBackName: customer?.idProofBackName || null,
    idProofBackSize: customer?.idProofBackSize || 0,
    customerPhoto: customer?.customerPhoto || null,
    customerPhotoName: customer?.customerPhotoName || null,
    customerPhotoSize: customer?.customerPhotoSize || 0,
    moveInDate: customer?.moveInDate || '',
    moveInTime: customer?.moveInTime || '12:00',
    moveOutDate: customer?.moveOutDate || '',
    moveOutTime: customer?.moveOutTime || '11:00',
    name: customer?.name || customer?.fullName || customer?.tenantName || '',
    phone: customer?.phone || '',
    rent: customer ? String(customer.rent ?? '') : settings.defaultPgRent ? String(settings.defaultPgRent) : '',
    room: customer?.room || '',
    roomType: customer?.roomType || 'single',
    services: Array.isArray(customer?.services) ? customer.services : [],
    status: customer?.status || initialForm.status,
  }));
  const [formError, setFormError] = useState('');
  const [formStep, setFormStep] = useState<CustomerFormStep>('business');
  const activeType = { ...getBusinessType(form.businessType), allocationCapacity: form.businessType === 'pg' ? settings.pgCapacity : 1 };
  const selectedDocument = documentTypes.find((item) => item.value === form.documentType) || documentTypes[0];
  const currentAllocation = getAllocationKey(customer?.room, form.businessType);
  const draftStay = { id: customer?.id || 'draft', ...form } as TenantRecord;
  const allocationNumbers = form.businessType === 'library' ? getSeatNumbers(settings) : getRoomNumbers(settings);
  const allocationOccupants = customers.filter((item) => {
    const itemType = String(item.businessType || 'pg');
    const sameInventory = form.businessType === 'library'
      ? itemType === 'library'
      : ['pg', 'hotel'].includes(itemType);

    const activelyAllocated = activeAllocationStatuses.includes(getCustomerStatus(item))
      && !(form.status === 'booked' && !form.moveInDate)
      && staysOverlap(item, draftStay);

    return item.id !== customer?.id && sameInventory && activelyAllocated;
  });
  const availableAllocationOptions = allocationNumbers
    .map((allocation) => {
      const occupants = allocationOccupants.filter((item) => getAllocationKey(item.room, form.businessType) === allocation);
      const isCurrent = currentAllocation === allocation;
      const hasConflictingBusiness = occupants.some((item) => String(item.businessType || 'pg') !== form.businessType);
      const vacantSeats = hasConflictingBusiness || !canAllocateCustomer(draftStay, occupants, settings.pgCapacity) ? 0 : Math.max(1, activeType.allocationCapacity - occupants.length);

      return {
        allocation,
        hasConflictingBusiness,
        occupants,
        isCurrent,
        vacantSeats,
      };
    })
    .filter((room) => room.vacantSeats > 0 || room.isCurrent);
  const selectedAllocation = getAllocationKey(form.room, form.businessType);
  const selectedAllocationOccupants = selectedAllocation
    ? allocationOccupants.filter((item) => getAllocationKey(item.room, form.businessType) === selectedAllocation)
    : [];
  const selectedRoomHasConflictingBusiness = form.businessType !== 'library' && selectedAllocationOccupants.some(
    (item) => String(item.businessType || 'pg') !== form.businessType,
  );
  const selectedAllocationIsCurrent = Boolean(selectedAllocation && currentAllocation === selectedAllocation);
  const selectedRoomAvailable = form.businessType === 'library'
    || selectedAllocationIsCurrent
    || (getRoomNumbers(settings).includes(selectedAllocation) && !selectedRoomHasConflictingBusiness && canAllocateCustomer(draftStay, selectedAllocationOccupants, settings.pgCapacity));
  const librarySeatAvailable = form.businessType !== 'library' || canAllocateCustomer(draftStay, selectedAllocationOccupants, settings.pgCapacity);
  const librarySeatLooksValid = form.businessType !== 'library' || !selectedAllocation || selectedAllocationIsCurrent || getSeatNumbers(settings).includes(selectedAllocation);
  const canContinueAllocation = Boolean(form.name.trim() && form.phone.trim() && form.room.trim() && toNumber(form.rent));
  const roomLifecycleBusiness = ['pg', 'hotel'].includes(form.businessType);
  const visibleStatusOptions = !customer
    ? [
        { label: 'Start now', value: getStartNowStatus(form.businessType) },
        { label: 'Reserve for later', value: 'booked' },
      ]
    : roomLifecycleBusiness
      ? activeType.statusOptions.filter((status) => status.value === form.status)
      : activeType.statusOptions;

  function updateField(name: keyof typeof form, value: string | string[]) {
    setForm((current) => ({
      ...current,
      [name]: value,
      ...(name === 'roomType' ? { room: '' } : {}),
    }));
    setFormError('');
  }

  function updateBusinessType(type: string) {
    const nextType = getBusinessType(type);
    const nextStatus = customer && nextType.statusOptions.some((status) => status.value === form.status)
      ? form.status
      : form.status === 'booked'
        ? 'booked'
        : getStartNowStatus(type);

    setForm((current) => ({
      ...current,
      businessType: type,
      ...(!customer ? { rent: String(type === 'pg' ? settings.defaultPgRent || '' : type === 'hotel' ? settings.defaultHotelCharge || '' : settings.defaultLibraryFee || '') } : {}),
      room: '',
      roomType: 'single',
      services: current.services.filter((service) => nextType.services.includes(service)),
      additionalGuests: type === 'hotel' ? current.additionalGuests : [],
      status: nextStatus,
    }));
    setFormError('');
  }

  function updateLibrarySeat(value: string) {
    const seat = normalizeLibrarySeat(value);
    updateField('room', seat ? `Seat ${seat}` : '');
  }

  function goToStep(nextStep: CustomerFormStep) {
    if (nextStep === 'details' && !canContinueAllocation) {
      setFormStep('allocation');
      setFormError(`${t('Name, phone,')} ${t(activeType.unitLabel).toLowerCase()} ${t('and amount are required.')}`);
      return;
    }

    if (nextStep === 'details' && !librarySeatLooksValid) {
      setFormStep('allocation');
      setFormError(t('Choose a seat within the configured library inventory.'));
      return;
    }

    if (nextStep === 'details' && !librarySeatAvailable) {
      setFormStep('allocation');
      setFormError(`${t(activeType.unitLabel)} ${selectedAllocation} ${t('is already assigned. Choose another seat.')}`);
      return;
    }

    if (nextStep === 'details' && !selectedRoomAvailable) {
      setFormStep('allocation');
      setFormError(t('This room is already assigned to the other business. Choose another room.'));
      return;
    }

    setFormError('');
    setFormStep(nextStep);
  }

  function goNext() {
    if (formStep === 'business') {
      setFormStep('allocation');
      setFormError('');
      return;
    }

    if (formStep === 'allocation') {
      if (!canContinueAllocation) {
        setFormError(`${t('Name, phone,')} ${t(activeType.unitLabel).toLowerCase()} ${t('and amount are required.')}`);
        return;
      }

      if (!librarySeatLooksValid) {
        setFormError(t('Choose a seat within the configured library inventory.'));
        return;
      }

      if (!librarySeatAvailable) {
        setFormError(`${t(activeType.unitLabel)} ${selectedAllocation} ${t('is already assigned. Choose another seat.')}`);
        return;
      }

      if (!selectedRoomAvailable) {
        setFormError(t('This room is already assigned to the other business. Choose another room.'));
        return;
      }

      setFormStep('details');
      setFormError('');
    }
  }

  function goBack() {
    if (formStep === 'details') {
      setFormStep('allocation');
      return;
    }

    if (formStep === 'allocation') {
      setFormStep('business');
    }
  }

  function toggleService(service: string) {
    setForm((current) => ({
      ...current,
      services: current.services.includes(service)
        ? current.services.filter((item) => item !== service)
        : [...current.services, service],
    }));
  }

  function addHotelGuest() {
    setForm((current) => ({ ...current, additionalGuests: [...current.additionalGuests, ''] }));
  }

  function updateHotelGuest(index: number, value: string) {
    setForm((current) => ({
      ...current,
      additionalGuests: current.additionalGuests.map((guest, guestIndex) => guestIndex === index ? value : guest),
    }));
  }

  function removeHotelGuest(index: number) {
    setForm((current) => ({
      ...current,
      additionalGuests: current.additionalGuests.filter((_, guestIndex) => guestIndex !== index),
    }));
  }

  function choosePhotoSource(target: CustomerPhotoTarget) {
    Alert.alert(t('Add photo'), t('Choose where to get the photo from.'), [
      { text: t('Camera'), onPress: () => pickCustomerImage(target, 'camera') },
      { text: t('Gallery'), onPress: () => pickCustomerImage(target, 'gallery') },
      { text: t('Cancel'), style: 'cancel' },
    ]);
  }

  async function pickCustomerImage(target: CustomerPhotoTarget, source: 'camera' | 'gallery') {
    setFormError('');

    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setFormError(t(source === 'camera' ? 'Camera permission is required to add this photo.' : 'Photo library permission is required to add this photo.'));
      return;
    }

    const options: ImagePicker.ImagePickerOptions = {
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 0.75,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return;

    const asset = result.assets[0];

    if (!asset?.uri) {
      setFormError(t('Could not read selected image.'));
      return;
    }

    const context = ImageManipulator.manipulate(asset.uri);
    context.resize({ width: 720 });
    const rendered = await context.renderAsync();
    const optimized = await rendered.saveAsync({ base64: true, compress: 0.35, format: SaveFormat.JPEG });

    if (!optimized.base64) {
      setFormError(t('Could not prepare selected image.'));
      return;
    }
    if (optimized.base64.length > 240_000) {
      setFormError(t('Photo is too large. Move closer and retake it.'));
      return;
    }

    const photo = `data:image/jpeg;base64,${optimized.base64}`;
    const photoSize = Math.ceil((optimized.base64.length * 3) / 4);
    const photoName = `${target}-${Date.now()}.jpg`;

    setForm((current) => target === 'customer' ? {
      ...current,
      customerPhoto: photo,
      customerPhotoName: photoName,
      customerPhotoSize: photoSize,
    } : target === 'document-back' ? {
      ...current,
      idProofBack: photo,
      idProofBackName: photoName,
      idProofBackSize: photoSize,
    } : {
      ...current,
      idProof: photo,
      idProofName: photoName,
      idProofSize: photoSize,
      idProofType: 'image/jpeg',
    });
  }

  function removePhoto(target: CustomerPhotoTarget) {
    setForm((current) => target === 'customer' ? {
      ...current,
      customerPhoto: null,
      customerPhotoName: null,
      customerPhotoSize: 0,
    } : target === 'document-back' ? {
      ...current,
      idProofBack: null,
      idProofBackName: null,
      idProofBackSize: 0,
    } : {
      ...current,
      idProof: null,
      idProofName: null,
      idProofSize: 0,
      idProofType: null,
    });
    setFormError('');
  }

  async function submit() {
    const rent = toNumber(form.rent);
    const normalizedDocumentId = form.documentId.replace(/[\s-]/g, '').toUpperCase();
    const normalizedPhone = normalizePhone(form.phone);
    const documentPattern = validationPatterns[form.documentType as keyof typeof validationPatterns];

    if (!form.name.trim() || !form.phone.trim() || !form.room.trim() || !rent) {
      setFormStep('allocation');
      setFormError(`${t('Name, phone,')} ${t(activeType.unitLabel).toLowerCase()} ${t('and amount are required.')}`);
      return;
    }

    if (!isValidPersonName(form.name)) {
      setFormStep('allocation');
      setFormError(t('Enter a valid customer name using letters only.'));
      return;
    }

    if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
      setFormStep('allocation');
      setFormError(t('Enter a valid 10-digit Indian mobile number.'));
      return;
    }

    if (!Number.isFinite(rent) || rent <= 0 || rent > 10_000_000) {
      setFormStep('allocation');
      setFormError(t('Enter a valid amount greater than zero.'));
      return;
    }

    if (!librarySeatLooksValid) {
      setFormStep('allocation');
      setFormError(t('Choose a seat within the configured library inventory.'));
      return;
    }

    if (!librarySeatAvailable) {
      setFormStep('allocation');
      setFormError(`${t(activeType.unitLabel)} ${selectedAllocation} ${t('is already assigned. Choose another seat.')}`);
      return;
    }

    if (!selectedRoomAvailable) {
      setFormStep('allocation');
      setFormError(t('This room is already assigned to the other business. Choose another room.'));
      return;
    }

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      setFormStep('details');
      setFormError(t('Enter a valid email address.'));
      return;
    }

    if (form.moveInDate && !isValidDateText(form.moveInDate)) {
      setFormStep('details');
      setFormError(t('Select a valid move-in date.'));
      return;
    }

    if (!customer && form.status === 'booked' && !form.moveInDate) {
      setFormStep('details');
      setFormError(t('Choose a start date for the reservation.'));
      return;
    }

    if (!customer && form.status === 'booked' && form.moveInDate < getLocalDate(new Date())) {
      setFormStep('details');
      setFormError(t('Choose today or a future date for the reservation.'));
      return;
    }

    if (!customer && form.status !== 'booked' && form.moveInDate > getLocalDate(new Date())) {
      setFormStep('details');
      setFormError(t('Choose Reserve for later when the start date is in the future.'));
      return;
    }

    if (form.moveOutDate && !isValidDateText(form.moveOutDate)) {
      setFormStep('details');
      setFormError(t('Select a valid move-out date.'));
      return;
    }

    if (form.businessType === 'hotel' && !form.moveOutDate) {
      setFormStep('details');
      setFormError(t('Choose a check-out date for the hotel stay.'));
      return;
    }

    if (form.moveInDate && form.moveOutDate && form.moveOutDate < form.moveInDate) {
      setFormStep('details');
      setFormError(t('Move-out date cannot be before move-in date.'));
      return;
    }

    if (activeType.usesTimeFields && (!isValidTimeText(form.moveInTime) || !isValidTimeText(form.moveOutTime))) {
      setFormStep('details');
      setFormError(t('Enter time in 24-hour HH:mm format.'));
      return;
    }

    if (!normalizedDocumentId || !documentPattern?.test(normalizedDocumentId)) {
      setFormStep('details');
      setFormError(`${t('Enter a valid document number for')} ${t(selectedDocument.label)}.`);
      return;
    }

    if (form.businessType === 'hotel' && form.additionalGuests.some((guest) => guest.trim() && !isValidPersonName(guest))) {
      setFormStep('allocation');
      setFormError(t('Enter valid additional guest names using letters only.'));
      return;
    }

    if (!form.customerPhoto || !form.idProof || (selectedDocument.needsBack && !form.idProofBack)) {
      setFormStep('details');
      setFormError(t('Customer photo and required document photos must be added.'));
      return;
    }

    const saveError = await onSubmit({
      additionalGuests: form.businessType === 'hotel'
        ? form.additionalGuests.map((guest) => guest.trim()).filter(Boolean)
        : [],
      businessType: form.businessType,
      documentId: normalizedDocumentId,
      documentType: form.documentType,
      email: form.email.trim(),
      idProof: form.idProof,
      idProofName: form.idProofName,
      idProofSize: form.idProofSize,
      idProofType: form.idProofType,
      idProofBack: form.idProofBack,
      idProofBackName: form.idProofBackName,
      idProofBackSize: form.idProofBackSize,
      customerPhoto: form.customerPhoto,
      customerPhotoName: form.customerPhotoName,
      customerPhotoSize: form.customerPhotoSize,
      moveInDate: form.moveInDate.trim(),
      moveInTime: form.moveInTime.trim(),
      moveOutDate: form.moveOutDate.trim(),
      moveOutTime: form.moveOutTime.trim(),
      name: form.name.trim(),
      phone: normalizedPhone,
      rent,
      room: form.room.trim(),
      roomType: form.roomType,
      services: form.services,
      status: form.status,
    });

    if (saveError) setFormError(saveError);
  }

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetKicker}>{t(activeType.flowLabel)}</Text>
                <Text style={styles.sheetTitle}>{t(customer ? 'Edit customer' : 'Add customer')}</Text>
              </View>
              <Pressable disabled={saving} onPress={onClose} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseText}>{t('Close')}</Text>
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <View style={styles.businessContext}>
              <Text style={styles.businessContextLabel}>{t(customer ? 'Editing for' : 'Adding for')}</Text>
              <Text style={styles.businessContextTitle}>{t(activeType.label)}</Text>
              <Text style={styles.businessContextMeta}>{t(activeType.flowLabel)}</Text>
            </View>

            <View style={styles.formStepper}>
              {customerFormSteps.map((step, index) => {
                const active = formStep === step.id;

                return (
                  <Pressable
                    accessibilityRole="button"
                    key={step.id}
                    onPress={() => goToStep(step.id)}
                    style={[styles.stepperItem, active && styles.stepperItemActive]}
                  >
                    <Text style={[styles.stepperIndex, active && styles.stepperIndexActive]}>{index + 1}</Text>
                    <Text style={[styles.stepperText, active && styles.stepperTextActive]} numberOfLines={1}>{t(step.label)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {formStep === 'business' ? (
              <>
                <Text style={styles.formLabel}>{t('Business type')}</Text>
                <View style={styles.sheetFilters}>
                  {businessTypeOptions.map((type) => (
                    <FilterPill active={form.businessType === type.id} key={type.id} label={type.label} onPress={() => updateBusinessType(type.id)} />
                  ))}
                </View>
                <Text style={styles.detailHint}>{t(activeType.detailsHint)}</Text>
              </>
            ) : null}

            {formStep === 'allocation' ? (
              <>
                <View style={styles.formGrid}>
                  <TextField label={`${activeType.customerLabel} name`} onChangeText={(value) => updateField('name', value)} placeholder="Full name" value={form.name} />
                  <TextField keyboardType="phone-pad" label="Phone" onChangeText={(value) => updateField('phone', value)} placeholder="Phone number" value={form.phone} />
                </View>

                {form.businessType === 'hotel' ? (
                  <View style={styles.hotelGuestsSection}>
                    <View style={styles.hotelGuestsHeader}>
                      <View style={styles.hotelGuestsCopy}>
                        <Text style={styles.formLabel}>{t('Additional hotel guests')}</Text>
                        <Text style={styles.inlineHelp}>{t('These names stay under the same booking and do not consume another room.')}</Text>
                      </View>
                      <Pressable accessibilityRole="button" onPress={addHotelGuest} style={styles.addGuestButton}>
                        <Text style={styles.addGuestButtonText}>{t('Add guest')}</Text>
                      </Pressable>
                    </View>
                    {form.additionalGuests.map((guest, index) => (
                      <View key={`hotel-guest-${index}`} style={styles.hotelGuestRow}>
                        <View style={styles.hotelGuestField}>
                          <TextField
                            autoCapitalize="words"
                            label={`${t('Guest')} ${index + 2}`}
                            onChangeText={(value) => updateHotelGuest(index, value)}
                            placeholder="Full name"
                            value={guest}
                          />
                        </View>
                        <Pressable accessibilityRole="button" onPress={() => removeHotelGuest(index)} style={styles.removeGuestButton}>
                          <Text style={styles.removeGuestButtonText}>{t('Remove')}</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Text style={styles.formLabel}>{t(activeType.unitLabel)}</Text>
                <View style={styles.roomPickerHeader}>
                  <Text style={styles.roomPickerTitle}>{t(activeType.allocationTitle)}</Text>
                  <Text style={styles.roomPickerMeta}>{t(activeType.allocationHelp)}</Text>
                </View>
                {form.businessType === 'library' ? (
                  <>
                    <TextField
                      autoCapitalize="characters"
                      label="Seat number"
                      onChangeText={updateLibrarySeat}
                      placeholder={`${settings.seatPrefix}01–${settings.seatPrefix}${String(settings.seatCount).padStart(2, '0')}`}
                      value={selectedAllocation}
                    />
                    {selectedAllocation ? (
                      <View
                        style={[
                          styles.allocationStatusBox,
                          (!librarySeatLooksValid || !librarySeatAvailable) && styles.allocationStatusBoxDanger,
                        ]}
                      >
                        <Text
                          style={[
                            styles.allocationStatusTitle,
                            (!librarySeatLooksValid || !librarySeatAvailable) && styles.allocationStatusTitleDanger,
                          ]}
                        >
                          {!librarySeatLooksValid
                              ? t('Invalid seat format')
                            : librarySeatAvailable
                              ? selectedAllocationIsCurrent
                                ? `${t('Seat')} ${selectedAllocation} ${t('is current')}`
                                : `${t('Seat')} ${selectedAllocation} ${t('is available')}`
                              : `${t('Seat')} ${selectedAllocation} ${t('is already assigned')}`}
                        </Text>
                        <Text style={styles.allocationStatusMeta}>
                          {selectedAllocationOccupants.length} {t(selectedAllocationOccupants.length === 1 ? 'active member assigned' : 'active members assigned')}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.inlineHelp}>{t('Enter a seat code to check if it is free.')}</Text>
                    )}
                  </>
                ) : availableAllocationOptions.length ? (
                  <View style={styles.roomPickerGrid}>
                    {availableAllocationOptions.map((option) => {
                      const active = getAllocationKey(form.room, form.businessType) === option.allocation;
                      const allocationLabel = `${activeType.unitLabel} ${option.allocation}`;
                      const seatsLabel = option.isCurrent
                        ? `${t('Current')} ${t(activeType.unitLabel).toLowerCase()}`
                        : `${option.vacantSeats} ${t(option.vacantSeats === 1 ? 'spot open' : 'spots open')}`;

                      return (
                        <Pressable
                          accessibilityRole="button"
                          key={option.allocation}
                          onPress={() => updateField('room', allocationLabel)}
                          style={[styles.roomOption, active && styles.roomOptionActive]}
                        >
                          <Text style={[styles.roomOptionTitle, active && styles.roomOptionTitleActive]}>{allocationLabel}</Text>
                          <Text style={[styles.roomOptionMeta, active && styles.roomOptionMetaActive]}>{seatsLabel}</Text>
                          <Text style={[styles.roomOptionSubtle, active && styles.roomOptionMetaActive]}>
                            {option.occupants.length} {t('assigned')}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : (
                  <View style={styles.noRoomBox}>
                    <Text style={styles.noRoomText}>{t('No available')} {t(activeType.unitLabel).toLowerCase()} {t('right now.')}</Text>
                  </View>
                )}

                <View style={styles.formGrid}>
                  <TextField keyboardType="numeric" label={activeType.feeLabel} onChangeText={(value) => updateField('rent', value)} placeholder="Amount" value={form.rent} />
                </View>

                <Text style={styles.formLabel}>{t(customer ? 'Status' : 'Onboarding')}</Text>
                <View style={styles.sheetFilters}>
                  {visibleStatusOptions
                    .filter((item, index, list) => list.findIndex((entry) => entry.value === item.value) === index && item.value)
                    .map((status) => (
                      <FilterPill
                        active={form.status === status.value}
                        key={status.value}
                        label={status.label}
                        onPress={() => updateField('status', status.value)}
                      />
                    ))}
                </View>
                {!customer ? (
                  <Text style={styles.inlineHelp}>
                    {t('Start now activates the customer. PG asks for a meter photo after save. Reserve for later requires a start date.')}
                  </Text>
                ) : null}
              </>
            ) : null}

            {formStep === 'details' ? (
              <>
                <Text style={styles.detailHint}>
                  {t(activeType.detailsHint)}
                </Text>

                <View style={styles.formGrid}>
                  <TextField keyboardType="email-address" label="Email" onChangeText={(value) => updateField('email', value)} placeholder="Email optional" value={form.email} />
                  <CalendarField label={t(activeType.startDateLabel)} onChange={(value) => updateField('moveInDate', value)} styles={styles} value={form.moveInDate} />
                  {activeType.usesTimeFields ? (
                    <TextField label="Check-in time" onChangeText={(value) => updateField('moveInTime', value)} placeholder="HH:mm" value={form.moveInTime} />
                  ) : null}
                  <CalendarField label={t(activeType.endDateLabel)} onChange={(value) => updateField('moveOutDate', value)} styles={styles} value={form.moveOutDate} />
                  {activeType.usesTimeFields ? (
                    <TextField label="Check-out time" onChangeText={(value) => updateField('moveOutTime', value)} placeholder="HH:mm" value={form.moveOutTime} />
                  ) : null}
                </View>

                <Text style={styles.formLabel}>{t('Services')}</Text>
                <View style={styles.sheetFilters}>
                  {activeType.services.map((service) => (
                    <FilterPill active={form.services.includes(service)} key={service} label={service} onPress={() => toggleService(service)} />
                  ))}
                </View>

                <Text style={styles.formLabel}>{t('Document ID')}</Text>
                <View style={styles.documentFields}>
                  <View style={styles.sheetFilters}>
                    {documentTypes.map((document) => (
                      <FilterPill
                        active={form.documentType === document.value}
                        key={document.value}
                        label={document.label}
                        onPress={() => {
                          updateField('documentType', document.value);
                          if (!document.needsBack) removePhoto('document-back');
                        }}
                      />
                    ))}
                  </View>
                  <TextField autoCapitalize="characters" label={`${selectedDocument.label} number`} onChangeText={(value) => updateField('documentId', value)} placeholder="Document number" value={form.documentId} />

                  <PhotoUploadBox label={t('Customer photo')} name={form.customerPhotoName} onPick={() => choosePhotoSource('customer')} onRemove={() => removePhoto('customer')} photo={form.customerPhoto} size={form.customerPhotoSize} styles={styles} />
                  <PhotoUploadBox label={`${t(selectedDocument.label)} ${t('front photo')}`} name={form.idProofName} onPick={() => choosePhotoSource('document-front')} onRemove={() => removePhoto('document-front')} photo={form.idProof} size={form.idProofSize} styles={styles} />
                  {selectedDocument.needsBack ? (
                    <PhotoUploadBox label={`${t(selectedDocument.label)} ${t('back photo')}`} name={form.idProofBackName} onPick={() => choosePhotoSource('document-back')} onRemove={() => removePhoto('document-back')} photo={form.idProofBack} size={form.idProofBackSize} styles={styles} />
                  ) : null}
                </View>
              </>
            ) : null}

            <View style={styles.sheetActions}>
              <Pressable disabled={saving} onPress={formStep === 'business' ? onClose : goBack} style={[styles.sheetSecondaryAction, saving && styles.disabledAction]}>
                <Text style={styles.sheetSecondaryText}>{t(formStep === 'business' ? 'Cancel' : 'Back')}</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={formStep === 'details' ? submit : goNext} style={[styles.sheetPrimaryAction, saving && styles.disabledAction]}>
                {saving ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.sheetPrimaryText}>{t(formStep === 'details' ? (customer ? 'Save customer' : 'Add customer') : 'Next')}</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PhotoUploadBox({ label, name, onPick, onRemove, photo, size, styles }: {
  label: string;
  name: string | null;
  onPick: () => void;
  onRemove: () => void;
  photo: string | null;
  size: number;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();

  return (
    <View style={styles.proofBox}>
      <Text style={styles.proofTitle}>{label}</Text>
      {photo ? (
        <>
          <Image resizeMode="cover" source={{ uri: photo }} style={styles.proofFormPreview} />
          <Text style={styles.proofMeta}>{name || label} / {Math.round(size / 1024)} KB</Text>
          <View style={styles.proofActions}>
            <Pressable onPress={onPick} style={styles.proofAction}><Text style={styles.proofActionText}>{t('Replace')}</Text></Pressable>
            <Pressable onPress={onRemove} style={styles.proofDangerAction}><Text style={styles.proofDangerText}>{t('Remove')}</Text></Pressable>
          </View>
        </>
      ) : (
        <>
          <Text style={styles.proofMeta}>{t('Camera or gallery photo required.')}</Text>
          <Pressable onPress={onPick} style={styles.proofPrimaryAction}><Text style={styles.proofPrimaryText}>{t('Add photo')}</Text></Pressable>
        </>
      )}
    </View>
  );
}

function CalendarField({ label, onChange, styles, value }: {
  label: string;
  onChange: (value: string) => void;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  const { t } = useLanguage();
  const parsed = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const initialDate = parsed ? new Date(Number(parsed[1]), Number(parsed[2]) - 1, 1) : new Date();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(initialDate);
  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : 0;
  });
  const monthTitle = visibleMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  function chooseDate(day: number) {
    const selected = new Date(year, month, day);
    onChange(getLocalDate(selected));
    setOpen(false);
  }

  function moveMonth(offset: number) {
    setVisibleMonth(new Date(year, month + offset, 1));
  }

  return (
    <>
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} style={styles.calendarField}>
        <Text style={styles.calendarFieldLabel}>{label}</Text>
        <View style={styles.calendarFieldRow}>
          <Text style={[styles.calendarFieldValue, !value && styles.calendarPlaceholder]}>{value || t('Select date')}</Text>
          <Text style={styles.calendarIcon}>CAL</Text>
        </View>
      </Pressable>
      {open ? (
        <Modal animationType="fade" transparent visible onRequestClose={() => setOpen(false)}>
          <View style={styles.calendarBackdrop}>
            <View style={styles.calendarCard}>
              <View style={styles.calendarHeader}>
                <Pressable onPress={() => moveMonth(-1)} style={styles.calendarNav}><Text style={styles.calendarNavText}>‹</Text></Pressable>
                <Text style={styles.calendarTitle}>{monthTitle}</Text>
                <Pressable onPress={() => moveMonth(1)} style={styles.calendarNav}><Text style={styles.calendarNavText}>›</Text></Pressable>
              </View>
              <View style={styles.calendarGrid}>
                {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <Text key={`${day}-${index}`} style={styles.calendarWeekday}>{day}</Text>)}
                {cells.map((day, index) => {
                  const dateValue = day ? getLocalDate(new Date(year, month, day)) : '';
                  const selected = dateValue === value;
                  return day ? (
                    <Pressable key={index} onPress={() => chooseDate(day)} style={[styles.calendarDay, selected && styles.calendarDaySelected]}>
                      <Text style={[styles.calendarDayText, selected && styles.calendarDayTextSelected]}>{day}</Text>
                    </Pressable>
                  ) : <View key={index} style={styles.calendarDay} />;
                })}
              </View>
              <View style={styles.calendarActions}>
                {value ? <Pressable onPress={() => { onChange(''); setOpen(false); }} style={styles.calendarClear}><Text style={styles.calendarClearText}>{t('Clear')}</Text></Pressable> : <View />}
                <Pressable onPress={() => setOpen(false)} style={styles.calendarDone}><Text style={styles.calendarDoneText}>{t('Close')}</Text></Pressable>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

function IdProofPreview({
  onClose,
  proof,
  styles,
}: {
  onClose: () => void;
  proof: TenantRecord | null;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  if (!proof) return null;

  const canPreview = String(proof.idProof || '').startsWith('data:image');

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={[styles.previewBackdrop, { paddingBottom: Math.max(insets.bottom, spacing.xl), paddingTop: Math.max(insets.top, spacing.xl) }]}>
        <View style={styles.previewHeader}>
          <View style={styles.previewCopy}>
            <Text style={styles.previewTitle}>{t('ID proof')}</Text>
            <Text style={styles.previewMeta}>{proof.name || t('Customer')} / {proof.idProofName || t('Document image')}</Text>
            {proof.idProofSize ? <Text style={styles.previewSize}>{Math.round(proof.idProofSize / 1024)} KB</Text> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.previewClose}>
            <Text style={styles.previewCloseText}>{t('Close')}</Text>
          </Pressable>
        </View>
        {canPreview ? (
          <Image resizeMode="contain" source={{ uri: proof.idProof || '' }} style={styles.previewImage} />
        ) : (
          <View style={styles.previewEmpty}>
            <Text style={styles.previewEmptyText}>{t('Preview is available for image ID proofs.')}</Text>
          </View>
        )}
        <Text style={styles.previewHint}>{t('Use the Android back button or Close to return.')}</Text>
      </View>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  hero: {
    backgroundColor: colors.ink,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadow.card,
  },
  heroTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  heroCopy: {
    flex: 1,
  },
  kicker: {
    color: colors.panelAccent,
    fontSize: 12,
    fontWeight: typography.weight.black,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.onBrand,
    fontSize: 34,
    fontWeight: typography.weight.black,
    lineHeight: 40,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.panelMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  addButton: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    zIndex: 1,
  },
  addButtonText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  calendarField: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 64,
    padding: spacing.md,
  },
  calendarFieldLabel: { color: colors.muted, fontSize: 11, fontWeight: typography.weight.black, textTransform: 'uppercase' },
  calendarFieldRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 7 },
  calendarFieldValue: { color: colors.text, fontSize: 15, fontWeight: typography.weight.black },
  calendarPlaceholder: { color: colors.muted },
  calendarIcon: { color: colors.brand, fontSize: 11, fontWeight: typography.weight.black },
  calendarBackdrop: { alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.62)', flex: 1, justifyContent: 'center', padding: spacing.lg },
  calendarCard: { backgroundColor: colors.surface, borderRadius: radius.lg, maxWidth: 420, padding: spacing.lg, width: '100%' },
  calendarHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  calendarTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weight.black },
  calendarNav: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, height: 42, justifyContent: 'center', width: 42 },
  calendarNavText: { color: colors.text, fontSize: 28, fontWeight: typography.weight.black },
  calendarGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.md },
  calendarWeekday: { color: colors.muted, fontSize: 11, fontWeight: typography.weight.black, textAlign: 'center', width: '14.2857%' },
  calendarDay: { alignItems: 'center', borderRadius: radius.sm, height: 40, justifyContent: 'center', marginTop: 4, width: '14.2857%' },
  calendarDaySelected: { backgroundColor: colors.ink },
  calendarDayText: { color: colors.text, fontSize: 13, fontWeight: typography.weight.bold },
  calendarDayTextSelected: { color: colors.onBrand, fontWeight: typography.weight.black },
  calendarActions: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg },
  calendarClear: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  calendarClearText: { color: colors.danger, fontSize: 13, fontWeight: typography.weight.black },
  calendarDone: { backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  calendarDoneText: { color: colors.onBrand, fontSize: 13, fontWeight: typography.weight.black },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  summaryTile: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderWidth: 1,
    borderRadius: radius.lg,
    flexBasis: 120,
    flexGrow: 1,
    minHeight: 86,
    padding: spacing.md,
    ...shadow.card,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weight.black,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weight.bold,
    lineHeight: 15,
    marginTop: 4,
  },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 15,
    marginTop: spacing.lg,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    ...shadow.card,
  },
  modeSwitch: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.sm,
    ...shadow.card,
  },
  modeItem: {
    alignItems: 'center',
    borderRadius: radius.md,
    flex: 1,
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  modeItemActive: {
    backgroundColor: colors.ink,
  },
  modeText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  modeTextActive: {
    color: colors.onBrand,
  },
  modeFeedback: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  modeFeedbackTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  modeFeedbackText: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  roomRail: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  roomCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    minHeight: 112,
    padding: spacing.md,
    width: 132,
    ...shadow.card,
  },
  roomCardFull: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  roomCardSelected: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  roomNumber: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weight.black,
  },
  roomStatus: {
    color: colors.brand,
    fontSize: 20,
    fontWeight: typography.weight.black,
    marginTop: spacing.lg,
  },
  roomMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    marginTop: 3,
  },
  roomTextFull: {
    color: colors.onBrand,
  },
  roomStatusFull: {
    color: colors.panelAccent,
  },
  roomMetaFull: {
    color: colors.panelMuted,
  },
  activeRoomFilter: {
    alignSelf: 'flex-start',
    backgroundColor: colors.skySoft,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  activeRoomFilterText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  filterTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: typography.weight.black,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statusText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
  },
  errorText: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.danger,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  list: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.xl,
    ...shadow.card,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: typography.weight.black,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  footerText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  sheetBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.54)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    maxHeight: '92%',
    padding: spacing.lg,
  },
  sheetHandle: {
    alignSelf: 'center',
    backgroundColor: colors.border,
    borderRadius: radius.sm,
    height: 4,
    marginBottom: spacing.lg,
    width: 44,
  },
  sheetHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  sheetKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.black,
    textTransform: 'uppercase',
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: typography.weight.black,
    marginTop: spacing.xs,
  },
  sheetCloseButton: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sheetCloseText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  businessContext: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  businessContextLabel: {
    color: colors.panelMuted,
    fontSize: 11,
    fontWeight: typography.weight.black,
    textTransform: 'uppercase',
  },
  businessContextTitle: {
    color: colors.onBrand,
    fontSize: 22,
    fontWeight: typography.weight.black,
    marginTop: spacing.xs,
  },
  businessContextMeta: {
    color: colors.panelMuted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    marginTop: spacing.xs,
  },
  formStepper: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.xs,
  },
  stepperItem: {
    alignItems: 'center',
    borderRadius: radius.sm,
    flex: 1,
    minHeight: 42,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  stepperItemActive: {
    backgroundColor: colors.ink,
  },
  stepperIndex: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weight.black,
  },
  stepperIndexActive: {
    color: colors.panelAccent,
  },
  stepperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  stepperTextActive: {
    color: colors.onBrand,
  },
  detailHint: {
    backgroundColor: colors.skySoft,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  formLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
    textTransform: 'uppercase',
  },
  sheetFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  roomPickerHeader: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  roomPickerTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  roomPickerMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    marginTop: spacing.xs,
  },
  roomPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inlineHelp: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  allocationStatusBox: {
    backgroundColor: colors.successSoft,
    borderColor: colors.success,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  allocationStatusBoxDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: colors.danger,
  },
  allocationStatusTitle: {
    color: colors.success,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  allocationStatusTitleDanger: {
    color: colors.danger,
  },
  allocationStatusMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    marginTop: spacing.xs,
  },
  roomOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 78,
    padding: spacing.md,
    width: '48%',
  },
  roomOptionActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  roomOptionTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: typography.weight.black,
  },
  roomOptionTitleActive: {
    color: colors.onBrand,
  },
  roomOptionMeta: {
    color: colors.success,
    fontSize: 12,
    fontWeight: typography.weight.black,
    marginTop: spacing.xs,
  },
  roomOptionMetaActive: {
    color: colors.panelMuted,
  },
  roomOptionSubtle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: typography.weight.bold,
    marginTop: 2,
  },
  noRoomBox: {
    backgroundColor: colors.warningSoft,
    borderColor: colors.warning,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  noRoomText: {
    color: colors.warning,
    fontSize: 13,
    fontWeight: typography.weight.black,
    lineHeight: 19,
  },
  formGrid: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  hotelGuestsSection: {
    marginTop: spacing.lg,
  },
  hotelGuestsHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  hotelGuestsCopy: {
    flex: 1,
  },
  addGuestButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addGuestButtonText: {
    color: colors.onBrand,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  hotelGuestRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  hotelGuestField: {
    flex: 1,
  },
  removeGuestButton: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  removeGuestButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  sheetActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  sheetSecondaryAction: {
    alignItems: 'center',
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  sheetSecondaryText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  sheetPrimaryAction: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    flex: 1,
    minHeight: 48,
    justifyContent: 'center',
  },
  sheetPrimaryText: {
    color: colors.onBrand,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  proofBox: {
    backgroundColor: colors.surfaceMuted,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  documentFields: {
    gap: spacing.md,
  },
  proofTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: typography.weight.black,
  },
  proofFormPreview: {
    borderRadius: radius.md,
    height: 180,
    marginBottom: spacing.md,
    marginTop: spacing.md,
    width: '100%',
  },
  proofMeta: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  proofActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  proofAction: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  proofActionText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  proofDangerAction: {
    alignItems: 'center',
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
  },
  proofDangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  proofPrimaryAction: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    marginTop: spacing.md,
    minHeight: 42,
    justifyContent: 'center',
  },
  proofPrimaryText: {
    color: colors.onBrand,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  previewBackdrop: {
    backgroundColor: 'rgba(0,0,0,0.94)',
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  previewHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  previewCopy: {
    flex: 1,
  },
  previewTitle: {
    color: colors.onBrand,
    fontSize: 20,
    fontWeight: typography.weight.black,
  },
  previewMeta: {
    color: colors.panelMuted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  previewSize: {
    color: colors.panelSubtle,
    fontSize: 12,
    marginTop: 3,
  },
  previewImage: {
    flex: 1,
    width: '100%',
  },
  previewEmpty: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radius.md,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  previewEmptyText: {
    color: colors.panelMuted,
    fontSize: 14,
    fontWeight: typography.weight.bold,
    lineHeight: 20,
    textAlign: 'center',
  },
  previewClose: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: radius.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  previewCloseText: {
    color: colors.onBrand,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  previewHint: {
    color: colors.panelSubtle,
    fontSize: 12,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  disabledAction: {
    opacity: 0.45,
  },
  });
}
