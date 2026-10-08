import { Alert } from '../../shared/utils/alert';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { collection, doc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { auth, db } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useRealtimeClock } from '../../shared/hooks/useRealtimeClock';
import type { MeterReadingRecord, TenantRecord } from '../../shared/types/records';
import { money, roundMoney, toNumber } from '../../shared/utils/money';
import { FilterPill } from '../customers/FilterPill';
import { getCustomerAllocationLabel, getCustomerStatus } from '../customers/customerUtils';
import { isRoomCustomer } from '../customers/roomUtils';
import { LifecycleMeterSheet, type LifecycleMeterResult } from '../customers/LifecycleMeterSheet';
import { syncAllocationGuard } from '../customers/allocationTransactions';
import { getMeterReadingCharges, getMonthKey, isVoided, meterReadingNeedsReview } from '../operations/operationsMath';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';


type MeterDraft = {
  billAmount: number;
  currentReading: number;
  month: string;
  note: string;
  previousReading: number;
  ratePerUnit: number;
  tenantId: string;
  tenantName: string;
  tenantRoom: string;
  unitsConsumed: number;
};

type PendingLifecycle = {
  action: 'check-in' | 'check-out';
  customer: TenantRecord;
  minimumReading: number;
};

function getTenantName(tenant: TenantRecord) {
  return tenant.name || tenant.fullName || tenant.tenantName || 'Unnamed';
}

function isMeterCustomer(tenant: TenantRecord, now: number) {
  return String(tenant.businessType || 'pg') === 'pg' && isRoomCustomer(tenant, now);
}

function matchesSearch(reading: MeterReadingRecord, search: string) {
  const queryText = search.trim().toLowerCase();

  if (!queryText) return true;

  return [reading.tenantName, reading.tenantRoom, reading.month, reading.note].some((value) =>
    String(value || '').toLowerCase().includes(queryText),
  );
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function MeterScreen({ onCheckout }: { onCheckout: (customerId: string) => void }) {
  const { settings, can } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [tenantFilter, setTenantFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [actionError, setActionError] = useState('');
  const [viewingPhoto, setViewingPhoto] = useState<MeterReadingRecord | null>(null);
  const [pendingLifecycle, setPendingLifecycle] = useState<PendingLifecycle | null>(null);
  const now = useRealtimeClock();
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const readings = useFirestoreCollection<MeterReadingRecord>('meterReadings', { sortBy: 'createdAt' });
  const meterCustomers = useMemo(() => tenants.data.filter((tenant) => isMeterCustomer(tenant, now)), [now, tenants.data]);
  const meterFormCustomers = useMemo(
    () => tenants.data.filter((tenant) => String(tenant.businessType || 'pg') === 'pg' && Boolean(tenant.room)),
    [tenants.data],
  );
  const filtered = useMemo(
    () =>
      readings.data.filter((reading) => {
        if (isVoided(reading)) return false;
        const tenantMatches = tenantFilter ? reading.tenantId === tenantFilter : true;
        return tenantMatches && matchesSearch(reading, search);
      }),
    [readings.data, search, tenantFilter],
  );
  const readingCharges = useMemo(() => {
    const charges: ReturnType<typeof getMeterReadingCharges> = {};
    const tenantIds = new Set(readings.data.map((reading) => reading.tenantId).filter(Boolean) as string[]);

    tenantIds.forEach((id) => Object.assign(charges, getMeterReadingCharges(readings.data, id)));
    return charges;
  }, [readings.data]);
  const totalUnits = useMemo(() => filtered.reduce((sum, reading) => sum + (readingCharges[reading.id]?.units || 0), 0), [filtered, readingCharges]);
  const totalBill = useMemo(() => filtered.reduce((sum, reading) => sum + (readingCharges[reading.id]?.amount || 0), 0), [filtered, readingCharges]);
  const loading = tenants.loading || readings.loading;
  const error = tenants.error || readings.error;
  const lifecycleCustomers = useMemo(
    () => tenants.data.filter((tenant) => {
      const status = getCustomerStatus(tenant);
      return String(tenant.businessType || 'pg') === 'pg'
        && Boolean(tenant.room)
        && ['booked', 'active', 'checked in', 'occupied'].includes(status);
    }),
    [tenants.data],
  );

  function clearFilters() {
    setSearch('');
    setTenantFilter('');
  }

  async function createReading(payload: MeterDraft) {
    setSaving(true);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      const readingRef = doc(collection(db, 'meterReadings'));
      batch.set(readingRef, {
        ...payload,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'meter.created', actorUid, createdAt: serverTimestamp(), entityId: readingRef.id, entityType: 'meterReading' });
      await batch.commit();
      setShowForm(false);
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : t('Could not save meter reading.'));
    } finally {
      setSaving(false);
    }
  }

  async function voidReading(readingId: string) {
    setDeletingId(readingId);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      batch.update(doc(db, 'meterReadings', readingId), { status: 'Voided', voidedAt: serverTimestamp(), voidedBy: actorUid });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'meter.voided', actorUid, createdAt: serverTimestamp(), entityId: readingId, entityType: 'meterReading' });
      await batch.commit();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not void meter reading.'));
    } finally {
      setDeletingId('');
    }
  }

  function confirmDelete(reading: MeterReadingRecord) {
    Alert.alert(t('Void reading?'), `${t('Void reading for')} ${reading.tenantName || t('this customer')}? ${t('The original record will remain in the audit trail.')}`, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Void'), style: 'destructive', onPress: () => voidReading(reading.id) },
    ]);
  }

  function latestRoomReading(customer: TenantRecord) {
    const validReadings = readings.data.filter((reading) => !meterReadingNeedsReview(readings.data, reading));
    const customerReading = validReadings.find((reading) => reading.tenantId === customer.id);
    const roomReading = validReadings.find((reading) => reading.tenantRoom === customer.room);
    return toNumber(customerReading?.currentReading ?? roomReading?.currentReading);
  }

  function openLifecycle(customer: TenantRecord) {
    if (getCustomerStatus(customer) !== 'booked') {
      if (can('money')) onCheckout(customer.id);
      return;
    }
    const action = getCustomerStatus(customer) === 'booked' ? 'check-in' : 'check-out';
    setActionError('');
    setPendingLifecycle({
      action,
      customer,
      minimumReading: latestRoomReading(customer),
    });
  }

  async function completeLifecycle(result: LifecycleMeterResult) {
    if (!pendingLifecycle) return;

    const { customer, minimumReading } = pendingLifecycle;
    setSaving(true);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const eventTime = new Date();
      const readingRef = doc(collection(db, 'meterReadings'));
      const tenantUpdate = {
        checkedInAt: serverTimestamp(), checkInMeterReading: result.reading, checkInMeterReadingId: readingRef.id,
        moveInDate: formatLocalDate(eventTime), moveInTime: eventTime.toTimeString().slice(0, 5),
        status: 'checked in', updatedAt: serverTimestamp(),
      };
      const nextCustomer = { ...customer, ...tenantUpdate } as TenantRecord;
      await runTransaction(db, async (transaction) => {
        await syncAllocationGuard(transaction, customer.id, customer, nextCustomer, tenants.data);
        transaction.set(readingRef, {
          billAmount: 0,
          createdAt: serverTimestamp(),
          currentReading: result.reading,
          month: `${eventTime.getFullYear()}-${String(eventTime.getMonth() + 1).padStart(2, '0')}`,
          note: 'Check-in meter photo',
          ocrText: result.ocrText,
          photo: result.photo,
          photoSize: result.photoSize,
          previousReading: minimumReading,
          ratePerUnit: settings.meterRate,
          readingSource: `ocr-confirmed-${result.photoSource}`,
          readingType: 'check-in',
          tenantId: customer.id,
          tenantName: getTenantName(customer),
          tenantRoom: customer.room || '',
          unitsConsumed: 0,
        });
        transaction.update(doc(db, 'tenants', customer.id), tenantUpdate);
        transaction.set(doc(collection(db, 'auditEvents')), {
          action: 'customer.checked_in',
          actorUid,
          createdAt: serverTimestamp(),
          customerId: customer.id,
          customerName: getTenantName(customer),
        });
      });
      setPendingLifecycle(null);
    } catch (lifecycleError) {
      setActionError(lifecycleError instanceof Error ? lifecycleError.message : t('Could not save meter lifecycle.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <MeterPhotoPreview onClose={() => setViewingPhoto(null)} reading={viewingPhoto} styles={styles} />
      {pendingLifecycle ? (
        <LifecycleMeterSheet
          action={pendingLifecycle.action}
          customer={pendingLifecycle.customer}
          minimumReading={pendingLifecycle.minimumReading}
          onClose={() => setPendingLifecycle(null)}
          onSubmit={completeLifecycle}
          saving={saving}
        />
      ) : null}
      {showForm ? (
        <MeterFormSheet onClose={() => setShowForm(false)} onSubmit={createReading} readings={readings.data} saving={saving} styles={styles} tenants={meterFormCustomers} />
      ) : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.kicker}>{t('Electricity')}</Text>
            <Text style={styles.title}>{t('Meter readings')}</Text>
            <Text style={styles.subtitle}>{t('Add readings and calculate the bill for each room.')}</Text>
          </View>
          <Pressable
            onPress={() => {
              setActionError('');
              setShowForm(true);
            }}
            style={styles.addButton}
          >
            <Text style={styles.addButtonText}>{t('Add reading')}</Text>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Metric label={t('Readings')} styles={styles} value={String(filtered.length)} />
          <Metric label={t('Units')} styles={styles} value={String(totalUnits)} />
          <Metric label={t('Bill')} styles={styles} value={money(totalBill)} />
        </View>
      </View>

      {loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading meter readings')}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.lifecyclePanel}>
        <Text style={styles.lifecycleTitle}>{t('Check-in / Check-out meter')}</Text>
        <Text style={styles.lifecycleHelp}>{t('Check in with a meter photo. Checkout opens the customer settlement flow.')}</Text>
        {lifecycleCustomers.length ? lifecycleCustomers.map((customer) => {
          const checkingIn = getCustomerStatus(customer) === 'booked';
          return (
            <View key={customer.id} style={styles.lifecycleRow}>
              <View style={styles.lifecycleCopy}>
                <Text style={styles.lifecycleName}>{getTenantName(customer)}</Text>
                <Text style={styles.lifecycleMeta}>{getCustomerAllocationLabel(customer)} / {t(checkingIn ? 'Upcoming' : 'Staying')}</Text>
              </View>
              <Pressable disabled={saving || (!checkingIn && !can('money'))} onPress={() => openLifecycle(customer)} style={styles.lifecycleButton}>
                <Text style={styles.lifecycleButtonText}>{t(checkingIn ? 'Check in + photo' : 'Open checkout settlement')}</Text>
              </Pressable>
            </View>
          );
        }) : <Text style={styles.helpText}>{t('No pending room lifecycle actions.')}</Text>}
      </View>

      <View style={styles.toolbar}>
        <TextField label="Search readings" onChangeText={setSearch} placeholder="Name, room, month, note..." value={search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail}>
          <FilterPill active={!tenantFilter} label="All" onPress={() => setTenantFilter('')} />
          {meterCustomers.slice(0, 40).map((tenant) => (
            <FilterPill active={tenantFilter === tenant.id} key={tenant.id} label={getTenantName(tenant)} onPress={() => setTenantFilter(tenant.id)} />
          ))}
        </ScrollView>
      </View>

      {filtered.length ? (
        filtered.slice(0, 50).map((reading) => (
          <MeterCard
            deleting={deletingId === reading.id}
            key={reading.id}
            onDelete={() => confirmDelete(reading)}
            onViewPhoto={() => setViewingPhoto(reading)}
            reading={reading}
            readingCharge={readingCharges[reading.id]}
            styles={styles}
          />
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('No readings found')}</Text>
          <Text style={styles.emptyText}>{t('Add a reading or change the filters.')}</Text>
          <Pressable onPress={readings.data.length ? clearFilters : () => setShowForm(true)} style={styles.emptyAction}>
            <Text style={styles.emptyActionText}>{t(readings.data.length ? 'Clear filters' : 'Add reading')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function MeterFormSheet({
  onClose,
  onSubmit,
  readings,
  saving,
  styles,
  tenants,
}: {
  onClose: () => void;
  onSubmit: (payload: MeterDraft) => void;
  readings: MeterReadingRecord[];
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
  tenants: TenantRecord[];
}) {
  const { settings } = useBusinessSettings();
  const { t } = useLanguage();
  const [tenantId, setTenantId] = useState(tenants[0]?.id || '');
  const [month, setMonth] = useState(getMonthKey());
  const [currentReading, setCurrentReading] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');
  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);
  const latestReading = readings.find((reading) => reading.tenantId === tenantId);
  const previousReading = latestReading ? toNumber(latestReading.currentReading) : null;
  const current = toNumber(currentReading);
  const previous = previousReading ?? current;
  const unitsConsumed = previousReading === null ? 0 : Math.max(0, current - previous);
  const billAmount = roundMoney(unitsConsumed * settings.meterRate);

  function selectTenant(nextTenantId: string) {
    setTenantId(nextTenantId);
    setCurrentReading('');
    setFormError('');
  }

  function submit() {
    if (!selectedTenant) {
      setFormError(t('Select a customer first.'));
      return;
    }

    if (!month.trim() || !currentReading) {
      setFormError(t('Month and current reading are required.'));
      return;
    }

    if (previousReading !== null && current < previous) {
      setFormError(`${t('Current reading cannot be less than previous reading')} (${previous}).`);
      return;
    }

    onSubmit({
      billAmount,
      currentReading: current,
      month: month.trim(),
      note: note.trim(),
      previousReading: previous,
      ratePerUnit: settings.meterRate,
      tenantId: selectedTenant.id,
      tenantName: getTenantName(selectedTenant),
      tenantRoom: getCustomerAllocationLabel(selectedTenant),
      unitsConsumed,
    });
  }

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetKicker}>{t('Electricity')}</Text>
                <Text style={styles.sheetTitle}>{t('Add reading')}</Text>
              </View>
              <Pressable disabled={saving} onPress={onClose} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseText}>{t('Close')}</Text>
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Text style={styles.formLabel}>{t('Customer')}</Text>
            {tenants.length ? (
              <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.tenantPicker} contentContainerStyle={styles.tenantPickerContent}>
                {tenants.slice(0, 80).map((tenant) => (
                  <FilterPill
                    active={tenantId === tenant.id}
                    key={tenant.id}
                    label={`${getTenantName(tenant)} / ${getCustomerAllocationLabel(tenant)}`}
                    onPress={() => selectTenant(tenant.id)}
                  />
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.helpText}>{t('No rooms available for meter readings.')}</Text>
            )}

            <View style={styles.formGrid}>
              <TextField label="Month" onChangeText={setMonth} placeholder="2026-08" value={month} />
              <TextField keyboardType="numeric" label="Current reading" onChangeText={setCurrentReading} placeholder="1250" value={currentReading} />
            </View>

            <View style={styles.readingSummary}>
              <MeterMini label={t('Previous')} styles={styles} value={previousReading === null ? t('Baseline') : String(previous)} />
              <MeterMini label={t('Current')} styles={styles} value={String(current)} />
              <MeterMini label={t('Units')} styles={styles} value={String(unitsConsumed)} />
              <MeterMini label={t('Bill')} styles={styles} value={money(billAmount)} />
            </View>

            <TextField label="Note" onChangeText={setNote} placeholder="Optional note" value={note} />

            <View style={styles.sheetActions}>
              <Pressable disabled={saving} onPress={onClose} style={[styles.sheetSecondaryAction, saving && styles.disabled]}>
                <Text style={styles.sheetSecondaryText}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={submit} style={[styles.sheetPrimaryAction, saving && styles.disabled]}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetPrimaryText}>{t('Save reading')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function MeterCard({
  deleting,
  onDelete,
  onViewPhoto,
  reading,
  readingCharge,
  styles,
}: {
  deleting: boolean;
  onDelete: () => void;
  onViewPhoto: () => void;
  reading: MeterReadingRecord;
  readingCharge?: { amount: number; needsReview?: boolean; units: number };
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{reading.tenantName || t('Meter reading')}</Text>
          <Text style={styles.cardMeta}>
            {reading.month || t('No month')}
            {reading.tenantRoom ? ` / ${reading.tenantRoom}` : ''}
          </Text>
        </View>
        <Text style={styles.billText}>{money(readingCharge?.amount)}</Text>
      </View>

      <View style={styles.grid}>
        <MeterMini label={t('Previous')} styles={styles} value={String(toNumber(reading.previousReading))} />
        <MeterMini label={t('Current')} styles={styles} value={String(toNumber(reading.currentReading))} />
      </View>

      {readingCharge?.needsReview ? (
        <Text style={styles.errorText}>{t('This reading looks incorrect. Void it and add the correct reading.')}</Text>
      ) : null}

      {reading.photo ? (
        <View style={styles.photoSection}>
          <Text style={styles.photoLabel}>{t(reading.readingType === 'check-in' ? 'Check-in meter photo' : reading.readingType === 'check-out' ? 'Check-out meter photo' : 'Meter photo')}</Text>
          <Pressable accessibilityRole="button" onPress={onViewPhoto} style={styles.photoButton}>
            <Image resizeMode="cover" source={{ uri: String(reading.photo) }} style={styles.meterPhoto} />
            <View style={styles.photoOverlay}>
              <Text style={styles.photoOverlayText}>{t('View full photo')}</Text>
            </View>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.grid}>
        <MeterMini label={t('Units')} styles={styles} value={String(readingCharge?.units || 0)} />
        <MeterMini label={t('Rate')} styles={styles} value={money(reading.ratePerUnit)} />
      </View>

      {reading.note ? <Text style={styles.note}>{String(reading.note)}</Text> : null}
      <Pressable disabled={deleting} onPress={onDelete} style={[styles.deleteButton, deleting && styles.disabled]}>
        <Text style={styles.deleteText}>{t(deleting ? 'Voiding...' : 'Void reading')}</Text>
      </Pressable>
    </View>
  );
}

function MeterPhotoPreview({
  onClose,
  reading,
  styles,
}: {
  onClose: () => void;
  reading: MeterReadingRecord | null;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();

  if (!reading?.photo) return null;

  const title = reading.readingType === 'check-in'
    ? t('Check-in meter photo')
    : reading.readingType === 'check-out'
      ? t('Check-out meter photo')
      : t('Meter photo');

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={[styles.photoPreviewBackdrop, { paddingBottom: Math.max(insets.bottom, spacing.xl), paddingTop: Math.max(insets.top, spacing.xl) }]}>
        <View style={styles.photoPreviewHeader}>
          <View style={styles.photoPreviewCopy}>
            <Text style={styles.photoPreviewTitle}>{title}</Text>
            <Text style={styles.photoPreviewMeta}>
              {reading.tenantName || t('Meter reading')} / {reading.tenantRoom || '-'} / {toNumber(reading.currentReading)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.photoPreviewClose}>
            <Text style={styles.photoPreviewCloseText}>{t('Close')}</Text>
          </Pressable>
        </View>
        <Image resizeMode="contain" source={{ uri: String(reading.photo) }} style={styles.photoPreviewImage} />
        <Text style={styles.photoPreviewHint}>{t('Tap Close or use the Android back button to return.')}</Text>
      </View>
    </Modal>
  );
}

function MeterMini({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return (
    <View style={styles.miniBox}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
    </View>
  );
}

function Metric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.lg,
    },
    hero: {
      backgroundColor: colors.ink,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    heroTop: {
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    heroCopy: {
      width: '100%',
    },
    kicker: {
      color: colors.panelAccent,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.panelText,
      fontSize: 24,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    subtitle: {
      color: colors.panelMuted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.sm,
    },
    addButton: {
      alignItems: 'center',
      alignSelf: 'stretch',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      justifyContent: 'center',
      minHeight: 46,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    addButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    metrics: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    metric: {
      backgroundColor: colors.overlayFaint,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    metricLabel: {
      color: colors.panelMuted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    metricValue: {
      color: colors.panelText,
      fontSize: 16,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
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
      padding: spacing.md,
    },
    toolbar: {
      gap: spacing.md,
    },
    lifecyclePanel: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      gap: spacing.sm,
      padding: spacing.lg,
      ...shadow.card,
    },
    lifecycleTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: typography.weight.black,
    },
    lifecycleHelp: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: spacing.xs,
    },
    lifecycleRow: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.md,
    },
    lifecycleCopy: { flex: 1 },
    lifecycleName: { color: colors.text, fontSize: 14, fontWeight: typography.weight.black },
    lifecycleMeta: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.bold, marginTop: 4 },
    lifecycleButton: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      justifyContent: 'center',
      minHeight: 42,
      paddingHorizontal: spacing.md,
    },
    lifecycleButtonText: { color: colors.onBrand, fontSize: 12, fontWeight: typography.weight.black },
    filterRail: {
      gap: spacing.sm,
      paddingRight: spacing.lg,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
      ...shadow.card,
    },
    cardHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cardCopy: {
      flex: 1,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: typography.weight.black,
    },
    cardMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      marginTop: spacing.xs,
    },
    billText: {
      color: colors.warning,
      fontSize: 16,
      fontWeight: typography.weight.black,
    },
    grid: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    photoSection: {
      marginTop: spacing.md,
    },
    photoLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      marginBottom: spacing.sm,
      textTransform: 'uppercase',
    },
    meterPhoto: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      height: 180,
      width: '100%',
    },
    photoButton: {
      borderRadius: radius.md,
      overflow: 'hidden',
      position: 'relative',
    },
    photoOverlay: {
      backgroundColor: 'rgba(5,8,13,0.72)',
      bottom: 0,
      left: 0,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      position: 'absolute',
      right: 0,
    },
    photoOverlayText: {
      color: colors.onBrand,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textAlign: 'center',
    },
    photoPreviewBackdrop: {
      backgroundColor: 'rgba(0,0,0,0.94)',
      flex: 1,
      paddingHorizontal: spacing.lg,
    },
    photoPreviewHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    photoPreviewCopy: {
      flex: 1,
    },
    photoPreviewTitle: {
      color: colors.onBrand,
      fontSize: 20,
      fontWeight: typography.weight.black,
    },
    photoPreviewMeta: {
      color: colors.panelMuted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: spacing.xs,
    },
    photoPreviewClose: {
      backgroundColor: 'rgba(255,255,255,0.16)',
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    photoPreviewCloseText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    photoPreviewImage: {
      flex: 1,
      width: '100%',
    },
    photoPreviewHint: {
      color: colors.panelSubtle,
      fontSize: 12,
      marginTop: spacing.md,
      textAlign: 'center',
    },
    miniBox: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    miniLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    miniValue: {
      color: colors.text,
      fontSize: 14,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    note: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: spacing.md,
    },
    deleteButton: {
      alignItems: 'center',
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      marginTop: spacing.md,
      minHeight: 42,
      justifyContent: 'center',
    },
    deleteText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    disabled: {
      opacity: 0.45,
    },
    emptyState: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: typography.weight.black,
      textAlign: 'center',
    },
    emptyText: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    emptyAction: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      marginTop: spacing.lg,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    emptyActionText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
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
    formLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
      marginBottom: spacing.sm,
      marginTop: spacing.lg,
      textTransform: 'uppercase',
    },
    tenantPicker: {
      maxHeight: 156,
    },
    tenantPickerContent: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    helpText: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: typography.weight.bold,
      lineHeight: 20,
    },
    formGrid: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    readingSummary: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginVertical: spacing.lg,
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
  });
}
