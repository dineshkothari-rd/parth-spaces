import { Alert } from '../../shared/utils/alert';
import { useMemo, useState } from 'react';
import { downloadPdf, shareCsv } from '../../shared/utils/exportFile';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { FilterPill } from '../customers/FilterPill';
import { getBusinessType } from '../customers/businessTypes';
import { getCustomerAllocationLabel } from '../customers/customerUtils';
import {
  calculateMonthlyDues,
  calculatePaymentResult,
  buildDuesCsv,
  getCollectedTotal,
  getMonthDisplay,
  getMonthKey,
  getPaymentAmount,
  getPaymentTenantId,
  getRemainingPaymentBalance,
  isVoided,
  matchesMonth,
  meterReadingNeedsReview,
  shiftMonth,
  summarizeDues,
} from '../operations/operationsMath';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { TextField } from '../../shared/components/TextField';
import { auth, db } from '../../lib/firebase/client';
import type { DueRecord, InvoiceRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord } from '../../shared/types/records';
import { money, toNumber } from '../../shared/utils/money';
import { ExpenseDesk } from './ExpenseDesk';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { defaultBusinessSettings, requireBusinessIdentity, type BusinessSettings } from '../customers/businessConfig';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';

type MoneyView = 'dues' | 'collections' | 'expenses';
type DueStatusFilter = 'due' | 'partial' | 'pending' | 'paid' | 'all';
type PaymentStatusFilter = 'all' | 'recorded';
type PaymentDraft = {
  amountPaid: number;
  paymentMode: string;
  reference: string;
  balance: number;
  businessType: string;
  month: string;
  note: string;
  paidOn: string;
  status: string;
  tenantId: string;
  tenantName: string;
  tenantRoom: string;
  totalRent: number;
};

const dueFilters: Array<{ label: string; value: DueStatusFilter }> = [
  { label: 'Due', value: 'due' },
  { label: 'Partial', value: 'partial' },
  { label: 'Pending', value: 'pending' },
  { label: 'Paid', value: 'paid' },
  { label: 'All', value: 'all' },
];

const paymentFilters: Array<{ label: string; value: PaymentStatusFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Recorded', value: 'recorded' },
];

function getPaymentStatus(payment: PaymentRecord) {
  return isVoided(payment) ? 'Voided' : 'Recorded';
}

function getPaymentTenantName(payment: PaymentRecord, tenants: TenantRecord[]) {
  if (payment.tenantName) return payment.tenantName;

  const tenantId = getPaymentTenantId(payment);
  const tenant = tenants.find((item) => item.id === tenantId);

  return tenant?.name || tenant?.fullName || tenant?.tenantName || payment.name || 'Collection';
}

function getPaymentRoom(payment: PaymentRecord, tenants: TenantRecord[]) {
  if (payment.tenantRoom) return payment.tenantRoom;

  const tenantId = getPaymentTenantId(payment);
  const tenant = tenants.find((item) => item.id === tenantId);

  return tenant?.room || '';
}

function getPaymentBusinessType(payment: PaymentRecord, tenants: TenantRecord[]) {
  if (payment.businessType) return String(payment.businessType);

  const tenantId = getPaymentTenantId(payment);
  const tenant = tenants.find((item) => item.id === tenantId);

  return tenant?.businessType || 'pg';
}

function getPaymentAllocationLabel(payment: PaymentRecord, tenants: TenantRecord[]) {
  const room = getPaymentRoom(payment, tenants);
  const businessType = getPaymentBusinessType(payment, tenants);

  return getCustomerAllocationLabel({ businessType, room });
}

function getTenantDisplayName(tenant: TenantRecord) {
  return tenant.name || tenant.fullName || tenant.tenantName || 'Unnamed';
}

function matchesDueSearch(due: DueRecord, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) return true;

  return [due.tenantName, due.tenantRoom, due.phone, due.businessType].some((value) =>
    String(value || '').toLowerCase().includes(query),
  );
}

function matchesDueStatus(due: DueRecord, filter: DueStatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'due') return due.balance > 0;

  return due.status.toLowerCase() === filter;
}

function matchesPaymentSearch(payment: PaymentRecord, tenants: TenantRecord[], search: string) {
  const query = search.trim().toLowerCase();

  if (!query) return true;

  return [
    getPaymentTenantName(payment, tenants),
    getPaymentRoom(payment, tenants),
    payment.month,
    payment.paidOn,
    payment.note,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

function matchesPaymentStatus(payment: PaymentRecord, filter: PaymentStatusFilter) {
  if (filter === 'all') return true;

  return getPaymentStatus(payment).toLowerCase() === filter;
}

function getPaymentTime(payment: PaymentRecord) {
  for (const value of [payment.createdAt, payment.updatedAt]) {
    if (value?.toDate) return value.toDate().getTime();
    if (typeof value?.seconds === 'number') return value.seconds * 1000;
  }

  const text = String(payment.paidOn || payment.date || '');
  const indianDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (indianDate) {
    return new Date(Number(indianDate[3]), Number(indianDate[2]) - 1, Number(indianDate[1])).getTime();
  }

  const parsed = new Date(text).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function getPhoneDigits(phone: string) {
  return phone.replace(/\D/g, '');
}

function callPhone(phone: string) {
  if (!phone) return;

  Linking.openURL(`tel:${phone}`).catch(() => undefined);
}

function openWhatsApp(due: DueRecord) {
  const phone = getPhoneDigits(due.phone);

  if (!phone) return;

  const message = encodeURIComponent(
    `Hello ${due.tenantName}, your ${due.month} balance is ${money(due.balance)}. Please clear it when possible.`,
  );

  Linking.openURL(`https://wa.me/${phone}?text=${message}`).catch(() => undefined);
}

function getDocumentTitle(businessType: string, documentType: 'bill' | 'receipt', t: (text: string) => string) {
  const type = getBusinessType(businessType);
  const prefix = t(type.label);

  if (documentType === 'bill') {
    if (type.id === 'hotel') return `${prefix} ${t('Stay bill')}`;
    if (type.id === 'library') return `${prefix} ${t('Membership bill')}`;
    return `${prefix} ${t('Monthly bill')}`;
  }

  if (type.id === 'hotel') return `${prefix} ${t('Stay receipt')}`;
  if (type.id === 'library') return `${prefix} ${t('Membership receipt')}`;
  return `${prefix} ${t('Payment receipt')}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getDocumentFileName(title: string, customerName: string, period: string) {
  const cleanName = `${title}-${customerName}-${period || new Date().toISOString().slice(0, 10)}`
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return `parth-spaces-${cleanName}.pdf`;
}

function buildDocumentHtml({
  business = defaultBusinessSettings,
  balance,
  customer,
  documentNumber,
  generatedAt,
  labels,
  lineItems,
  meta,
  paid,
  status,
  title,
  total,
}: {
  business?: BusinessSettings;
  balance: string;
  customer: string;
  documentNumber: string;
  generatedAt: string;
  labels: {
    amount: string;
    balance: string;
    charges: string;
    customer: string;
    description: string;
    generatedOn: string;
    name: string;
    paid: string;
    status: string;
    total: string;
  };
  lineItems: Array<{ label: string; value: string }>;
  meta: Array<{ label: string; value: string }>;
  paid: string;
  status: string;
  title: string;
  total: string;
}) {
  requireBusinessIdentity(business);
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { color: #17212B; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; }
          .header { background: #0F172A; border-radius: 16px; color: #FFFFFF; padding: 28px; }
          .brand { color: #BFE6FF; font-size: 13px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; }
          h1 { font-size: 30px; margin: 8px 0 0; }
          .doc { color: #C8D4DE; font-size: 13px; margin-top: 8px; }
          .section { border: 1px solid #E2E8F0; border-radius: 14px; margin-top: 20px; padding: 18px; }
          .section-title { color: #64748B; font-size: 12px; font-weight: 800; margin-bottom: 12px; text-transform: uppercase; }
          .grid { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; }
          .cell { background: #F8FAFC; border-radius: 12px; padding: 12px; }
          .label { color: #64748B; font-size: 11px; font-weight: 800; text-transform: uppercase; }
          .value { color: #0F172A; font-size: 15px; font-weight: 800; margin-top: 4px; }
          table { border-collapse: collapse; margin-top: 12px; width: 100%; }
          th { color: #64748B; font-size: 11px; text-align: left; text-transform: uppercase; }
          td, th { border-bottom: 1px solid #E2E8F0; padding: 12px 0; }
          td:last-child, th:last-child { text-align: right; }
          .totals { margin-left: auto; margin-top: 18px; width: 320px; }
          .total-row { display: flex; justify-content: space-between; padding: 8px 0; }
          .total-row strong { font-size: 18px; }
          .footer { color: #64748B; font-size: 12px; margin-top: 28px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">${escapeHtml(business.name)}</div>
          <div>${escapeHtml(business.address)}</div><div>${escapeHtml(business.phone)}</div>
          <h1>${escapeHtml(title)}</h1>
          <div class="doc">${escapeHtml(documentNumber)}</div>
        </div>

        <div class="section">
          <div class="section-title">${escapeHtml(labels.customer)}</div>
          <div class="grid">
            <div class="cell"><div class="label">${escapeHtml(labels.name)}</div><div class="value">${escapeHtml(customer)}</div></div>
            <div class="cell"><div class="label">${escapeHtml(labels.status)}</div><div class="value">${escapeHtml(status)}</div></div>
            ${meta.map((item) => `<div class="cell"><div class="label">${escapeHtml(item.label)}</div><div class="value">${escapeHtml(item.value)}</div></div>`).join('')}
          </div>
        </div>

        <div class="section">
          <div class="section-title">${escapeHtml(labels.charges)}</div>
          <table>
            <thead><tr><th>${escapeHtml(labels.description)}</th><th>${escapeHtml(labels.amount)}</th></tr></thead>
            <tbody>
              ${lineItems.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${escapeHtml(item.value)}</td></tr>`).join('')}
            </tbody>
          </table>
          <div class="totals">
            <div class="total-row"><span>${escapeHtml(labels.total)}</span><strong>${escapeHtml(total)}</strong></div>
            <div class="total-row"><span>${escapeHtml(labels.paid)}</span><strong>${escapeHtml(paid)}</strong></div>
            <div class="total-row"><span>${escapeHtml(labels.balance)}</span><strong>${escapeHtml(balance)}</strong></div>
          </div>
        </div>

        <div class="footer">${escapeHtml(labels.generatedOn)} ${escapeHtml(generatedAt)}</div>
      </body>
    </html>
  `;
}

function getPdfLabels(t: (text: string) => string) {
  return {
    amount: t('Amount'),
    balance: t('Balance'),
    charges: t('Charges'),
    customer: t('Customer'),
    description: t('Description'),
    generatedOn: t('Generated on'),
    name: t('Name'),
    paid: t('Paid'),
    status: t('Status'),
    total: t('Total'),
  };
}

function buildBillHtml(due: DueRecord, t: (text: string) => string, business = defaultBusinessSettings) {
  const type = getBusinessType(due.businessType);
  const title = getDocumentTitle(due.businessType, 'bill', t);
  const allocation = getCustomerAllocationLabel({ businessType: due.businessType, room: due.tenantRoom });

  return buildDocumentHtml({
    business,
    balance: money(due.balance),
    customer: due.tenantName,
    documentNumber: `${t('Bill for')} ${due.month}`,
    generatedAt: new Date().toLocaleString('en-IN'),
    labels: getPdfLabels(t),
    lineItems: [
      { label: t(type.feeLabel), value: money(due.baseAmount) },
      ...(due.meterAmount ? [{ label: t('Electricity'), value: money(due.meterAmount) }] : []),
      ...(due.extraCharge ? [{ label: t('Additional charge'), value: money(due.extraCharge) }] : []),
      ...(due.discount ? [{ label: t('Discount / credit'), value: `−${money(due.discount)}` }] : []),
    ],
    meta: [
      { label: t(type.unitLabel), value: allocation },
      { label: t('Month'), value: due.month },
      { label: t('Due date'), value: due.dueDate || '-' },
      ...(due.note ? [{ label: t('Note'), value: due.note }] : []),
    ],
    paid: money(due.paid),
    status: t(due.status),
    title,
    total: money(due.rent),
  });
}

export function buildReceiptHtml(payment: PaymentRecord, tenants: TenantRecord[], t: (text: string) => string, business = defaultBusinessSettings) {
  const businessType = getPaymentBusinessType(payment, tenants);
  const type = getBusinessType(businessType);
  const title = getDocumentTitle(businessType, 'receipt', t);
  const allocation = getPaymentAllocationLabel(payment, tenants);
  const balance = toNumber(payment.balance);
  const note = payment.note ? [{ label: t('Note'), value: String(payment.note) }] : [];

  return buildDocumentHtml({
    business,
    balance: money(balance),
    customer: getPaymentTenantName(payment, tenants),
    documentNumber: `${t('Receipt no')}: ${String(payment.id || '').slice(-8).toUpperCase() || '-'}`,
    generatedAt: new Date().toLocaleString('en-IN'),
    labels: getPdfLabels(t),
    lineItems: [{ label: t('Amount paid'), value: money(getPaymentAmount(payment)) }],
    meta: [
      { label: t(type.unitLabel), value: allocation },
      { label: t('Month'), value: payment.month || '-' },
      { label: t('Paid on'), value: payment.paidOn || '-' },
      { label: t('Payment method'), value: payment.paymentMode || 'Not recorded' },
      { label: t('Reference'), value: payment.reference || '-' },
      { label: t('Collected by'), value: payment.collectedBy || payment.createdBy as string || '-' },
      ...note,
    ],
    paid: money(getPaymentAmount(payment)),
    status: t(getPaymentStatus(payment)),
    title,
    total: money(payment.totalRent),
  });
}

export function MoneyScreen() {
  const { settings } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [view, setView] = useState<MoneyView>('dues');
  const [month, setMonth] = useState(getMonthKey());
  const [search, setSearch] = useState('');
  const [dueFilter, setDueFilter] = useState<DueStatusFilter>('due');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatusFilter>('all');
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentFormTenantId, setPaymentFormTenantId] = useState('');
  const [paymentFormAmount, setPaymentFormAmount] = useState(0);
  const [savingPayment, setSavingPayment] = useState(false);
  const [invoiceAction, setInvoiceAction] = useState<'export' | 'generate' | ''>('');
  const [deletingPaymentId, setDeletingPaymentId] = useState('');
  const [actionError, setActionError] = useState('');
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments', { sortBy: 'createdAt' });
  const meterReadings = useFirestoreCollection<MeterReadingRecord>('meterReadings', { sortBy: 'createdAt' });
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices', { sortBy: 'issuedAt' });
  const settlements = useFirestoreCollection<SettlementRecord>('settlements', { sortBy: 'finalizedAt' });
  const activePayments = useMemo(() => payments.data.filter((payment) => !isVoided(payment)), [payments.data]);

  const dues = useMemo(
    () => calculateMonthlyDues(tenants.data, activePayments, month, meterReadings.data, invoices.data),
    [activePayments, invoices.data, meterReadings.data, month, tenants.data],
  );
  const monthlyPayments = useMemo(
    () => activePayments.filter((payment) => matchesMonth(payment, month, ['paidOn', 'date', 'createdAt', 'updatedAt'])),
    [activePayments, month],
  );
  const visibleDues = useMemo(
    () => dues.filter((due) => matchesDueStatus(due, dueFilter) && matchesDueSearch(due, search)),
    [dueFilter, dues, search],
  );
  const visiblePayments = useMemo(
    () =>
      monthlyPayments.filter(
        (payment) => matchesPaymentStatus(payment, paymentFilter) && matchesPaymentSearch(payment, tenants.data, search),
      ),
    [monthlyPayments, paymentFilter, search, tenants.data],
  );
  const latestPayments = useMemo(
    () => [...activePayments].sort((first, second) => getPaymentTime(second) - getPaymentTime(first)).slice(0, 5),
    [activePayments],
  );
  const duesSummary = useMemo(() => summarizeDues(dues), [dues]);
  const visibleDuesSummary = useMemo(() => summarizeDues(visibleDues), [visibleDues]);
  const collected = useMemo(() => getCollectedTotal(visiblePayments), [visiblePayments]);
  const loading = tenants.loading || payments.loading || meterReadings.loading || invoices.loading || settlements.loading;
  const error = tenants.error || payments.error || meterReadings.error || invoices.error || settlements.error;
  const activeFilters = view === 'dues' ? dueFilters : paymentFilters;
  const currentMonth = getMonthKey();

  function clearFilters() {
    setSearch('');
    setDueFilter('due');
    setPaymentFilter('all');
  }

  function openPaymentForm(tenantId = '', amount = 0) {
    setActionError('');
    setPaymentFormAmount(amount);
    setPaymentFormTenantId(tenantId);
    setShowPaymentForm(true);
  }

  async function createPayment(payload: PaymentDraft) {
    setSavingPayment(true);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      const paymentRef = doc(collection(db, 'payments'));
      batch.set(paymentRef, {
        ...payload,
        createdBy: actorUid,
        collectedBy: actorUid,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'payment.created',
        actorUid,
        createdAt: serverTimestamp(),
        entityId: paymentRef.id,
        entityType: 'payment',
      });
      await batch.commit();
      setShowPaymentForm(false);
      setView('collections');
      setPaymentFilter('all');
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : t('Could not record payment.'));
    } finally {
      setSavingPayment(false);
    }
  }

  async function generateMonthlyInvoices() {
    setInvoiceAction('generate');
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const existing = new Set(invoices.data.filter((invoice) => invoice.month === month).map((invoice) => invoice.tenantId));
      const missing = dues.filter((due) => !existing.has(due.tenantId) && !tenants.data.find((tenant) => tenant.id === due.tenantId)?.membershipManaged);
      if (!missing.length) throw new Error(t('Invoices are already generated for this month.'));
      if (missing.length > 498) throw new Error(t('Generate invoices in a smaller customer batch.'));

      const batch = writeBatch(db);
      missing.forEach((due) => {
        batch.set(doc(db, 'invoices', `${due.tenantId}_${month}`), {
          baseAmount: due.baseAmount,
          businessType: due.businessType,
          dueDate: `${month}-10`,
          issuedAt: serverTimestamp(),
          issuedBy: actorUid,
          meterAmount: due.meterAmount,
          month,
          status: 'Issued',
          tenantId: due.tenantId,
          tenantName: due.tenantName,
          tenantRoom: due.tenantRoom,
          total: due.rent,
        });
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'invoices.generated',
        actorUid,
        createdAt: serverTimestamp(),
        entityId: month,
        entityType: 'invoice_batch',
        month,
      });
      await batch.commit();
      Alert.alert(t('Invoices generated'), `${missing.length} ${t('invoices saved permanently for')} ${month}.`);
    } catch (invoiceError) {
      setActionError(invoiceError instanceof Error ? invoiceError.message : t('Could not generate invoices.'));
    } finally {
      setInvoiceAction('');
    }
  }

  async function exportMonthlyReport() {
    setInvoiceAction('export');
    setActionError('');

    try {
      await shareCsv({ fileName: `parth-spaces-dues-${month}.csv`, csv: buildDuesCsv(dues), title: t('Export monthly report') });
    } catch (exportError) {
      setActionError(exportError instanceof Error ? exportError.message : t('Could not export report.'));
    } finally {
      setInvoiceAction('');
    }
  }

  async function voidPayment(paymentId: string) {
    setDeletingPaymentId(paymentId);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      batch.update(doc(db, 'payments', paymentId), { status: 'Voided', updatedAt: serverTimestamp(), voidedAt: serverTimestamp(), voidedBy: actorUid });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'payment.voided', actorUid, createdAt: serverTimestamp(), entityId: paymentId, entityType: 'payment' });
      await batch.commit();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not void payment.'));
    } finally {
      setDeletingPaymentId('');
    }
  }

  function confirmDeletePayment(payment: PaymentRecord) {
    Alert.alert(
      t('Void payment?'),
      `${t('Void payment for')} ${getPaymentTenantName(payment, tenants.data)}? ${t('The original record will remain in the audit trail.')}`,
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Void'),
          style: 'destructive',
          onPress: () => voidPayment(payment.id),
        },
      ],
    );
  }

  async function downloadBill(due: DueRecord) {
    setActionError('');

    try {
      const title = getDocumentTitle(due.businessType, 'bill', t);
      await downloadPdf({
        fileName: getDocumentFileName(title, due.tenantName, due.month),
        html: buildBillHtml(due, t, settings),
        title,
      });
    } catch (shareError) {
      setActionError(shareError instanceof Error ? shareError.message : t('Could not prepare bill.'));
    }
  }

  async function downloadReceipt(payment: PaymentRecord) {
    setActionError('');

    try {
      const businessType = getPaymentBusinessType(payment, tenants.data);
      const title = getDocumentTitle(businessType, 'receipt', t);
      await downloadPdf({
        fileName: getDocumentFileName(title, getPaymentTenantName(payment, tenants.data), payment.month || payment.paidOn || ''),
        html: buildReceiptHtml(payment, tenants.data, t, settings),
        title,
      });
    } catch (shareError) {
      setActionError(shareError instanceof Error ? shareError.message : t('Could not prepare receipt.'));
    }
  }

  return (
    <View>
      {showPaymentForm ? (
        <PaymentFormSheet
          initialAmount={paymentFormAmount}
          initialTenantId={paymentFormTenantId}
          month={month}
          onClose={() => setShowPaymentForm(false)}
          onSubmit={createPayment}
          payments={activePayments}
          invoices={invoices.data}
          settlements={settlements.data}
          readings={meterReadings.data}
          saving={savingPayment}
          styles={styles}
          tenants={tenants.data}
        />
      ) : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.kicker}>{getMonthDisplay(month)}</Text>
            <Text style={styles.title}>{t('Money')}</Text>
          </View>
          <View style={styles.viewSwitch}>
            {(['dues', 'collections', 'expenses'] as MoneyView[]).map((item) => {
              const active = item === view;

              return (
                <Pressable key={item} onPress={() => setView(item)} style={[styles.switchItem, active && styles.switchItemActive]}>
                  <Text style={[styles.switchText, active && styles.switchTextActive]}>
                    {t(item === 'dues' ? 'Dues' : item === 'collections' ? 'Collections' : 'Expenses')}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.monthNavigator}>
          <Pressable accessibilityRole="button" onPress={() => setMonth((value) => shiftMonth(value, -1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>{t('Prev')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMonth(currentMonth)} style={styles.monthValue}>
            <Text style={styles.monthValueText}>{month}</Text>
            <Text style={styles.monthValueHint}>{month === currentMonth ? t('Current month') : t('Tap to reset')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMonth((value) => shiftMonth(value, 1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>{t('Next')}</Text>
          </Pressable>
        </View>

        <View style={styles.heroMetrics}>
          <HeroMetric label={t('Expected')} styles={styles} value={money(duesSummary.expected)} />
          <HeroMetric label={t('Collected')} styles={styles} value={money(duesSummary.collected)} />
          <HeroMetric label={t('Due')} danger styles={styles} value={money(duesSummary.balance)} />
        </View>

        {view === 'expenses' ? null : (
          <View style={styles.heroActions}>
            <Pressable accessibilityRole="button" onPress={() => openPaymentForm()} style={styles.recordPaymentButton}>
              <Text style={styles.recordPaymentText}>{t('Record payment')}</Text>
            </Pressable>
            <View style={styles.secondaryActions}>
              <Pressable disabled={Boolean(invoiceAction)} onPress={generateMonthlyInvoices} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>{t(invoiceAction === 'generate' ? 'Saving...' : 'Freeze invoices')}</Text>
              </Pressable>
              <Pressable disabled={Boolean(invoiceAction)} onPress={exportMonthlyReport} style={styles.secondaryAction}>
                <Text style={styles.secondaryActionText}>{t(invoiceAction === 'export' ? 'Exporting...' : 'Export CSV')}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading money details')}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.latestPanel}>
        <View style={styles.latestHeader}>
          <View>
            <Text style={styles.latestTitle}>{t('Latest payments')}</Text>
            <Text style={styles.latestHint}>{t('Most recently recorded collections')}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setView('collections');
              setPaymentFilter('all');
              setSearch('');
            }}
            style={styles.latestAction}
          >
            <Text style={styles.latestActionText}>{t('View records')}</Text>
          </Pressable>
        </View>
        {latestPayments.length ? latestPayments.map((payment) => (
          <LatestPaymentRow key={payment.id} payment={payment} styles={styles} tenants={tenants.data} />
        )) : (
          <Text style={styles.latestEmpty}>{t('No payments recorded yet.')}</Text>
        )}
      </View>

      {view === 'expenses' ? null : (
        <View style={styles.toolbar}>
          <TextField
            label={view === 'dues' ? 'Search dues' : 'Search collections'}
            onChangeText={setSearch}
            placeholder={view === 'dues' ? 'Name, allocation, phone, type...' : 'Name, month, allocation, note...'}
            value={search}
          />
          <View style={styles.filterRail}>
            {activeFilters.map((filter) => {
              const active = view === 'dues' ? dueFilter === filter.value : paymentFilter === filter.value;

              return (
                <FilterPill
                  active={active}
                  key={filter.value}
                  label={filter.label}
                  onPress={() => {
                    if (view === 'dues') setDueFilter(filter.value as DueStatusFilter);
                    else setPaymentFilter(filter.value as PaymentStatusFilter);
                  }}
                />
              );
            })}
          </View>
        </View>
      )}

      {view === 'expenses' ? (
        <ExpenseDesk month={month} />
      ) : view === 'dues' ? (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('Due balance')}</Text>
          <Text style={styles.summaryValue}>{money(visibleDuesSummary.balance)}</Text>
          <Text style={styles.summaryMeta}>
            {visibleDues.length} {t('customers')}, {visibleDuesSummary.partialCount} {t('partial')}, {visibleDuesSummary.pendingCount} {t('pending')}
          </Text>
        </View>
      ) : (
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>{t('Collections')}</Text>
          <Text style={styles.summaryValue}>{money(collected)}</Text>
          <Text style={styles.summaryMeta}>
            {visiblePayments.length} {t('payments in')} {getMonthDisplay(month)}, {money(duesSummary.balance)} {t('still due')}
          </Text>
        </View>
      )}

      {view === 'expenses' ? null : view === 'dues' ? (
        visibleDues.length ? (
          visibleDues
            .slice(0, 50)
            .map((due) => (
              <DueCard due={due} key={due.id} onDownloadBill={() => downloadBill(due)} onRecordPayment={() => openPaymentForm(due.tenantId, due.balance)} styles={styles} />
            ))
        ) : (
          <EmptyMoneyState clearFilters={clearFilters} styles={styles} />
        )
      ) : visiblePayments.length ? (
        visiblePayments
          .slice(0, 50)
          .map((payment) => (
            <PaymentCard
              deleting={deletingPaymentId === payment.id}
              key={payment.id}
              onDelete={() => confirmDeletePayment(payment)}
              canVoid={!settlements.data.some((item) => item.tenantId === getPaymentTenantId(payment))}
              onDownloadReceipt={() => downloadReceipt(payment)}
              payment={payment}
              styles={styles}
              tenants={tenants.data}
            />
          ))
      ) : (
        <EmptyMoneyState clearFilters={clearFilters} styles={styles} />
      )}
    </View>
  );
}

function PaymentFormSheet({
  initialAmount,
  initialTenantId,
  month,
  onClose,
  onSubmit,
  payments,
  invoices,
  settlements,
  readings,
  saving,
  styles,
  tenants,
}: {
  initialAmount: number;
  initialTenantId: string;
  month: string;
  onClose: () => void;
  onSubmit: (payload: PaymentDraft) => void;
  payments: PaymentRecord[];
  invoices: InvoiceRecord[];
  settlements: SettlementRecord[];
  readings: MeterReadingRecord[];
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
  tenants: TenantRecord[];
}) {
  const { t } = useLanguage();
  const [tenantId, setTenantId] = useState(initialTenantId);
  const [paymentMonth, setPaymentMonth] = useState(month);
  const [amountPaid, setAmountPaid] = useState(initialAmount > 0 ? String(initialAmount) : '');
  const [note, setNote] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [formError, setFormError] = useState('');
  const selectedTenantId = tenantId || tenants[0]?.id || '';
  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId);
  const hasSettlement = settlements.some((settlement) => settlement.tenantId === selectedTenantId);
  const selectedBusinessType = getBusinessType(selectedTenant?.businessType);
  const selectedDue = calculateMonthlyDues(selectedTenant ? [selectedTenant] : [], payments, paymentMonth, readings, invoices)[0];
  const tenantRent = selectedDue?.baseAmount || 0;
  const meterAmount = selectedDue?.meterAmount || 0;
  const totalCharge = selectedDue?.rent || 0;
  const alreadyPaid = selectedDue?.paid || 0;
  const meterReadingUnderReview = readings.some((reading) =>
    reading.tenantId === selectedTenantId
    && reading.month === paymentMonth
    && meterReadingNeedsReview(readings, reading));
  const paid = toNumber(amountPaid);
  const remainingBalance = getRemainingPaymentBalance(totalCharge, payments, selectedTenantId, paymentMonth);
  const { balance, status } = calculatePaymentResult(totalCharge, payments, selectedTenantId, paymentMonth, paid);
  const tenantOptions = useMemo(
    () =>
      tenants.slice(0, 80).map((tenant) => ({
        id: tenant.id,
        label: `${getTenantDisplayName(tenant)} / ${getCustomerAllocationLabel(tenant)}`,
      })),
    [tenants],
  );

  function submit() {
    if (!tenants.length) {
      setFormError(t('Add a customer before recording payments.'));
      return;
    }

    if (!selectedTenant) {
      setFormError(t('Select a customer first.'));
      return;
    }

    if (hasSettlement) {
      setFormError(t('Record checkout balance payments in More → Settlements.'));
      return;
    }

    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(paymentMonth.trim())) {
      setFormError(t('Enter the month as YYYY-MM.'));
      return;
    }

    if (paymentMode !== 'Cash' && !reference.trim()) {
      setFormError(t('Enter the transaction reference for a bank or UPI payment.'));
      return;
    }

    if (!paid || paid <= 0 || !Number.isFinite(Number(amountPaid)) || paid > 10_000_000 || Math.abs(paid * 100 - Math.round(paid * 100)) > 0.000001) {
      setFormError(t('Enter a valid amount paid.'));
      return;
    }

    if (!selectedDue || remainingBalance <= 0) {
      setFormError(t('No payment is due for this customer in the selected month.'));
      return;
    }

    if (paid > remainingBalance) {
      setFormError(`${t('Amount cannot be more than the remaining balance:')} ${money(remainingBalance)}`);
      return;
    }

    onSubmit({
      amountPaid: paid,
      paymentMode,
      reference: reference.trim(),
      balance,
      businessType: selectedTenant.businessType || 'pg',
      month: paymentMonth.trim(),
      note: note.trim(),
      paidOn: new Date().toLocaleDateString('en-IN'),
      status: 'Recorded',
      tenantId: selectedTenant.id,
      tenantName: getTenantDisplayName(selectedTenant),
      tenantRoom: getCustomerAllocationLabel(selectedTenant),
      totalRent: totalCharge,
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
                <Text style={styles.sheetKicker}>{t('New collection')}</Text>
                <Text style={styles.sheetTitle}>{t('Record payment')}</Text>
              </View>
              <Pressable disabled={saving} onPress={onClose} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseText}>{t('Close')}</Text>
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Text style={styles.formLabel}>{t('Customer')}</Text>
            {tenantOptions.length ? (
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                style={styles.tenantPicker}
                contentContainerStyle={styles.tenantPickerContent}
              >
                {tenantOptions.map((tenant) => (
                  <FilterPill
                    active={selectedTenantId === tenant.id}
                    key={tenant.id}
                    label={tenant.label}
                    onPress={() => {
                      setTenantId(tenant.id);
                      setFormError('');
                    }}
                  />
                ))}
              </ScrollView>
            ) : (
              <Text style={styles.formHelpText}>{t('No customers found')}</Text>
            )}

            <View style={styles.formGrid}>
              <TextField
                label="Month"
                onChangeText={(value) => {
                  setPaymentMonth(value);
                  setFormError('');
                }}
                placeholder="2026-08"
                value={paymentMonth}
              />
              <TextField
                keyboardType="numeric"
                label="Amount paid"
                onChangeText={(value) => {
                  setAmountPaid(value);
                  setFormError('');
                }}
                placeholder="5000"
                value={amountPaid}
              />
            </View>

            <View style={styles.formSummary}>
              <AmountCell label={t(selectedBusinessType.feeLabel)} styles={styles} value={money(tenantRent)} />
              <AmountCell label={t('Electricity')} styles={styles} value={money(meterAmount)} />
              <AmountCell label={t('Total')} styles={styles} value={money(totalCharge)} />
              <AmountCell label={t('Already paid')} styles={styles} value={money(alreadyPaid)} />
              <AmountCell danger={balance > 0} label={t('Balance after payment')} styles={styles} value={money(balance)} />
              <AmountCell label={t('Status')} styles={styles} value={t(status)} />
            </View>

            {meterReadingUnderReview ? (
              <Text style={styles.errorText}>{t('Electricity charge is not included until the meter reading is corrected.')}</Text>
            ) : null}

            <View style={styles.formGrid}>{['Cash', 'UPI', 'Bank'].map((mode) => <FilterPill key={mode} label={mode} active={paymentMode === mode} onPress={() => setPaymentMode(mode)} />)}</View>
            <TextField label="Transaction reference" value={reference} onChangeText={setReference} maxLength={120} />
            <Text style={styles.formHelpText}>{t('Save only after verifying the payment in cash or your bank account.')}</Text>
            <TextField label="Note" onChangeText={setNote} placeholder="Optional note" value={note} />

            <View style={styles.sheetActions}>
              <Pressable disabled={saving} onPress={onClose} style={[styles.sheetSecondaryAction, saving && styles.disabledAction]}>
                <Text style={styles.sheetSecondaryText}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={submit} style={[styles.sheetPrimaryAction, saving && styles.disabledAction]}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetPrimaryText}>{t('Save payment')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function LatestPaymentRow({
  payment,
  styles,
  tenants,
}: {
  payment: PaymentRecord;
  styles: ReturnType<typeof createStyles>;
  tenants: TenantRecord[];
}) {
  const { t } = useLanguage();
  const allocation = getPaymentAllocationLabel(payment, tenants);

  return (
    <View style={styles.latestRow}>
      <View style={styles.latestRowCopy}>
        <Text style={styles.latestName}>{getPaymentTenantName(payment, tenants)}</Text>
        <Text style={styles.latestMeta}>
          {payment.paidOn || payment.date || payment.month || t('Date unavailable')}
          {allocation !== 'No allocation' ? ` / ${allocation}` : ''}
        </Text>
      </View>
      <View style={styles.latestAmountWrap}>
        <Text style={styles.latestAmount}>{money(getPaymentAmount(payment))}</Text>
        <Text style={styles.latestStatus}>{t(getPaymentStatus(payment))}</Text>
      </View>
    </View>
  );
}

function HeroMetric({
  danger = false,
  label,
  styles,
  value,
}: {
  danger?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.heroMetric}>
      <Text style={styles.heroMetricLabel}>{label}</Text>
      <Text style={[styles.heroMetricValue, danger && styles.heroMetricDanger]}>{value}</Text>
    </View>
  );
}

function DueCard({
  due,
  onDownloadBill,
  onRecordPayment,
  styles,
}: {
  due: DueRecord;
  onDownloadBill: () => void;
  onRecordPayment: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const type = getBusinessType(due.businessType);
  const canContact = Boolean(due.phone);

  return (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <View style={styles.recordCopy}>
          <Text style={styles.recordTitle}>{due.tenantName}</Text>
          <Text style={styles.recordMeta}>
            {t(type.label)} / {getCustomerAllocationLabel({ businessType: due.businessType, room: due.tenantRoom })}
          </Text>
        </View>
        <StatusBadge status={due.status} styles={styles} />
      </View>

      <View style={styles.amountGrid}>
        <AmountCell label={t(type.feeLabel)} styles={styles} value={money(due.baseAmount)} />
        {due.meterAmount ? <AmountCell label={t('Electricity')} styles={styles} value={money(due.meterAmount)} /> : null}
        <AmountCell label={t('Paid')} styles={styles} value={money(due.paid)} />
        <AmountCell danger={due.balance > 0} label={t('Due')} styles={styles} value={money(due.balance)} />
      </View>

      <View style={styles.actions}>
        <Pressable disabled={!canContact} onPress={() => callPhone(due.phone)} style={[styles.actionButton, !canContact && styles.disabledAction]}>
          <Text style={styles.actionText}>{t('Call')}</Text>
        </Pressable>
        <Pressable disabled={!canContact} onPress={() => openWhatsApp(due)} style={[styles.actionButton, styles.actionButtonAccent, !canContact && styles.disabledAction]}>
          <Text style={styles.actionText}>{t('WhatsApp')}</Text>
        </Pressable>
        <Pressable onPress={onRecordPayment} style={[styles.actionButton, styles.actionButtonSurface]}>
          <Text style={styles.actionTextAlt}>{t('Record')}</Text>
        </Pressable>
        <Pressable onPress={onDownloadBill} style={[styles.actionButton, styles.actionButtonSurface]}>
          <Text style={styles.actionTextAlt}>{t('Bill')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PaymentCard({
  canVoid,
  deleting,
  onDelete,
  onDownloadReceipt,
  payment,
  styles,
  tenants,
}: {
  canVoid: boolean;
  deleting: boolean;
  onDelete: () => void;
  onDownloadReceipt: () => void;
  payment: PaymentRecord;
  styles: ReturnType<typeof createStyles>;
  tenants: TenantRecord[];
}) {
  const { t } = useLanguage();
  const status = getPaymentStatus(payment);
  const allocation = getPaymentAllocationLabel(payment, tenants);

  return (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <View style={styles.recordCopy}>
          <Text style={styles.recordTitle}>{getPaymentTenantName(payment, tenants)}</Text>
          <Text style={styles.recordMeta}>
            {payment.month || payment.paidOn || 'No date'}
            {allocation !== 'No allocation' ? ` / ${allocation}` : ''}
          </Text>
        </View>
        <StatusBadge status={status} styles={styles} />
      </View>

      <View style={styles.amountGrid}>
        <AmountCell label={t('Paid')} styles={styles} value={money(getPaymentAmount(payment))} />
      </View>

      {payment.note ? <Text style={styles.note}>{String(payment.note)}</Text> : null}
      <View style={styles.actions}>
        <Pressable onPress={onDownloadReceipt} style={[styles.actionButton, styles.actionButtonSurface]}>
          <Text style={styles.actionTextAlt}>{t('Receipt')}</Text>
        </Pressable>
        {canVoid ? <Pressable disabled={deleting} onPress={onDelete} style={[styles.actionButton, styles.deleteInlineButton, deleting && styles.disabledAction]}>
          <Text style={styles.deleteInlineText}>{t(deleting ? 'Voiding...' : 'Void payment')}</Text>
        </Pressable> : null}
      </View>
    </View>
  );
}

function AmountCell({
  danger = false,
  label,
  styles,
  value,
}: {
  danger?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.amountCell}>
      <Text style={styles.amountLabel}>{label}</Text>
      <Text style={[styles.amountValue, danger && styles.amountDanger]}>{value}</Text>
    </View>
  );
}

function StatusBadge({ status, styles }: { status: string; styles: ReturnType<typeof createStyles> }) {
  const { t } = useLanguage();
  const normalized = status.toLowerCase();
  const tone =
    normalized === 'paid'
      ? styles.badgeSuccess
      : normalized === 'partial'
        ? styles.badgeWarning
        : normalized === 'pending'
          ? styles.badgeDanger
          : styles.badgeNeutral;

  return (
    <View style={[styles.badge, tone]}>
      <Text style={styles.badgeText}>{t(status)}</Text>
    </View>
  );
}

function EmptyMoneyState({
  clearFilters,
  styles,
}: {
  clearFilters: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{t('No payments found')}</Text>
      <Text style={styles.emptyText}>{t('Try changing the search or filters.')}</Text>
      <Pressable onPress={clearFilters} style={styles.emptyAction}>
        <Text style={styles.emptyActionText}>{t('Clear filters')}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      backgroundColor: colors.ink,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    heroTop: {
      gap: spacing.md,
    },
    kicker: {
      color: colors.panelAccent,
      fontSize: 13,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.panelText,
      fontSize: 29,
      fontWeight: typography.weight.black,
      lineHeight: 34,
      marginTop: spacing.xs,
    },
    viewSwitch: {
      backgroundColor: colors.overlayFaint,
      borderRadius: radius.md,
      flexDirection: 'row',
      gap: spacing.xs,
      padding: spacing.xs,
    },
    switchItem: {
      alignItems: 'center',
      borderRadius: radius.sm,
      flex: 1,
      minHeight: 40,
      justifyContent: 'center',
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
    },
    switchItemActive: {
      backgroundColor: colors.surface,
    },
    switchText: {
      color: colors.panelMuted,
      fontSize: 13,
      fontWeight: typography.weight.black,
      textAlign: 'center',
    },
    switchTextActive: {
      color: colors.text,
    },
    monthNavigator: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    monthButton: {
      alignItems: 'center',
      backgroundColor: colors.overlaySubtle,
      borderRadius: radius.md,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    monthButtonText: {
      color: colors.panelText,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    monthValue: {
      alignItems: 'center',
      backgroundColor: colors.overlayFaint,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 52,
      justifyContent: 'center',
    },
    monthValueText: {
      color: colors.panelText,
      fontSize: 16,
      fontWeight: typography.weight.black,
    },
    monthValueHint: {
      color: colors.panelSubtle,
      fontSize: 11,
      fontWeight: typography.weight.bold,
      marginTop: 2,
    },
    heroMetrics: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    heroMetric: {
      backgroundColor: colors.overlayFaint,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    heroMetricLabel: {
      color: colors.panelSubtle,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    heroMetricValue: {
      color: colors.panelText,
      fontSize: 14,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    heroMetricDanger: {
      color: colors.danger,
    },
    recordPaymentButton: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      minHeight: 48,
      justifyContent: 'center',
    },
    heroActions: {
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    secondaryActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    secondaryAction: {
      alignItems: 'center',
      backgroundColor: colors.overlaySubtle,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 44,
      justifyContent: 'center',
    },
    secondaryActionText: {
      color: colors.panelText,
      fontSize: 12,
      fontWeight: typography.weight.black,
    },
    recordPaymentText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: typography.weight.black,
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
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
      marginTop: spacing.lg,
      padding: spacing.md,
    },
    toolbar: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    latestPanel: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    latestHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    latestTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: typography.weight.black,
    },
    latestHint: {
      color: colors.muted,
      fontSize: 12,
      marginTop: 3,
    },
    latestAction: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    latestActionText: {
      color: colors.link,
      fontSize: 12,
      fontWeight: typography.weight.black,
    },
    latestRow: {
      alignItems: 'center',
      borderTopColor: colors.borderSoft,
      borderTopWidth: 1,
      flexDirection: 'row',
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    latestRowCopy: {
      flex: 1,
    },
    latestName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: typography.weight.black,
    },
    latestMeta: {
      color: colors.muted,
      fontSize: 12,
      marginTop: 4,
    },
    latestAmountWrap: {
      alignItems: 'flex-end',
    },
    latestAmount: {
      color: colors.success,
      fontSize: 14,
      fontWeight: typography.weight.black,
    },
    latestStatus: {
      color: colors.muted,
      fontSize: 10,
      fontWeight: typography.weight.bold,
      marginTop: 3,
      textTransform: 'uppercase',
    },
    latestEmpty: {
      color: colors.muted,
      fontSize: 13,
      paddingTop: spacing.md,
    },
    filterRail: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    summaryLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    summaryValue: {
      color: colors.text,
      fontSize: 26,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    summaryMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      lineHeight: 19,
      marginTop: spacing.xs,
    },
    recordCard: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.md,
      padding: spacing.lg,
      ...shadow.card,
    },
    recordHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    recordCopy: {
      flex: 1,
    },
    recordTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: typography.weight.black,
    },
    recordMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      marginTop: spacing.xs,
    },
    badge: {
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    badgeSuccess: {
      backgroundColor: colors.successSoft,
    },
    badgeWarning: {
      backgroundColor: colors.warningSoft,
    },
    badgeDanger: {
      backgroundColor: colors.dangerSoft,
    },
    badgeNeutral: {
      backgroundColor: colors.accentSoft,
    },
    badgeText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    amountGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    amountCell: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      flexBasis: '40%',
      minHeight: 82,
      padding: spacing.md,
    },
    amountLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
      lineHeight: 16,
    },
    amountValue: {
      color: colors.success,
      fontSize: 16,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    amountDanger: {
      color: colors.danger,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    actionButton: {
      alignItems: 'center',
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      flex: 1,
      minWidth: '46%',
      minHeight: 44,
      justifyContent: 'center',
    },
    actionButtonAccent: {
      backgroundColor: colors.success,
    },
    actionButtonSurface: {
      backgroundColor: colors.surfaceMuted,
    },
    disabledAction: {
      opacity: 0.45,
    },
    actionText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    actionTextAlt: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    deleteButton: {
      alignItems: 'center',
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      marginTop: spacing.md,
      minHeight: 42,
      justifyContent: 'center',
    },
    deleteButtonText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    deleteInlineButton: {
      backgroundColor: colors.dangerSoft,
    },
    deleteInlineText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    note: {
      color: colors.muted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: spacing.md,
    },
    emptyState: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.md,
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
    formHelpText: {
      color: colors.muted,
      fontSize: 14,
      fontWeight: typography.weight.bold,
      lineHeight: 20,
    },
    formGrid: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    formSummary: {
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
