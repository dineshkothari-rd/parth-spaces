import { useState } from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../../lib/firebase/client';
import { useAppTheme } from '../../design/tokens';
import { TextField } from '../../shared/components/TextField';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import type { DepositAccount, DepositEvent, ExpenseRecord, InvoiceRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord } from '../../shared/types/records';
import { money, roundMoney } from '../../shared/utils/money';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { calculateMonthlyDues, getDayKey, getMonthKey, matchesDay, isVoided } from '../operations/operationsMath';
import { FilterPill } from '../customers/FilterPill';
import { dailyReconciliation, parseAmount, paymentModes, validatePaymentDetails } from './financeMath';
import { useLanguage } from '../../shared/i18n/LanguageProvider';

export function FinanceDesk() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { settings } = useBusinessSettings();
  const tenants = useFirestoreCollection<TenantRecord>('tenants');
  const accounts = useFirestoreCollection<DepositAccount>('depositAccounts');
  const events = useFirestoreCollection<DepositEvent>('depositEvents', { sortBy: 'createdAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments');
  const expenses = useFirestoreCollection<ExpenseRecord>('expenses');
  const settlements = useFirestoreCollection<SettlementRecord>('settlements');
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices');
  const readings = useFirestoreCollection<MeterReadingRecord>('meterReadings');
  const [tenantId, setTenantId] = useState('');
  const [kind, setKind] = useState<'collection' | 'deduction' | 'refund'>('collection');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [month, setMonth] = useState(getMonthKey());
  const [dueDate, setDueDate] = useState(`${getMonthKey()}-10`);
  const [extra, setExtra] = useState('0');
  const [discount, setDiscount] = useState('0');
  const [day, setDay] = useState(getDayKey());
  const [openingCash, setOpeningCash] = useState('0');
  const [openingBank, setOpeningBank] = useState('0');
  const [actualCash, setActualCash] = useState('');
  const [actualBank, setActualBank] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tenant = tenants.data.find((item) => item.id === tenantId);
  const held = accounts.data.find((item) => item.id === tenantId)?.held || 0;
  const loading = [tenants, accounts, events, payments, expenses, settlements, invoices, readings].some((item) => item.loading);
  const loadError = [tenants, accounts, events, payments, expenses, settlements, invoices, readings].find((item) => item.error)?.error;
  const unclassified = [...payments.data.filter((item) => !isVoided(item) && matchesDay(item, day, ['createdAt', 'paidOn'])), ...expenses.data.filter((item) => !isVoided(item) && matchesDay(item, day, ['date', 'createdAt']))].some((item) => !paymentModes.includes(item.paymentMode as typeof paymentModes[number]))
    || settlements.data.some((item) => item.refundStatus === 'Paid' && matchesDay(item, day, ['refundedAt']) && !paymentModes.includes(item.refundMode as typeof paymentModes[number]));
  const totals = dailyReconciliation(payments.data, expenses.data, events.data, settlements.data, day);
  const card = { backgroundColor: colors.surface, padding: 16, borderRadius: 16, gap: 12, marginBottom: 16 };
  const text = { color: colors.text };
  async function perform(action: (uid: string) => Promise<void>) {
    if (loading || loadError) return setMessage('Wait for records to load successfully.');
    const uid = auth.currentUser?.uid;
    if (!uid) return setMessage('Please sign in again.');
    setBusy(true); setMessage('');
    try { await action(uid); setMessage('Saved.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); } finally { setBusy(false); }
  }
  function saveDeposit() {
    return perform(async (uid) => {
      if (!tenant) throw new Error('Select a customer first.');
      const value = parseAmount(amount);
      validatePaymentDetails(mode, reference);
      if (!note.trim() || note.length > 1000) throw new Error('Enter a reason up to 1,000 characters.');
      const accountRef = doc(db, 'depositAccounts', tenant.id);
      const eventRef = doc(collection(db, 'depositEvents'));
      await runTransaction(db, async (transaction) => {
        const account = await transaction.get(accountRef);
        const settlement = await transaction.get(doc(db, 'settlements', tenant.id));
        const latestTenant = await transaction.get(doc(db, 'tenants', tenant.id));
        if (settlement.exists()) throw new Error('Use Settlements for this checked-out customer.');
        if (!latestTenant.exists() || ['checked out', 'cancelled', 'inactive'].includes(String(latestTenant.data().status))) throw new Error('Select an active customer or reservation.');
        const before = Number(account.data()?.held || 0);
        const after = roundMoney(before + (kind === 'collection' ? value : -value));
        if (after < 0 || after > 10_000_000) throw new Error('Amount exceeds the available deposit or account limit.');
        transaction.set(accountRef, { tenantId: tenant.id, held: after, eventId: eventRef.id, updatedAt: serverTimestamp(), updatedBy: uid });
        transaction.set(eventRef, { tenantId: tenant.id, tenantName: tenant.fullName || tenant.name || '', kind, amount: value, before, after, paymentMode: mode, reference: reference.trim(), note: note.trim(), createdAt: serverTimestamp(), createdBy: uid });
        transaction.set(doc(collection(db, 'auditEvents')), { action: 'deposit.recorded', actorUid: uid, createdAt: serverTimestamp(), entityId: eventRef.id, entityType: 'deposit' });
      });
      setAmount(''); setReference(''); setNote('');
    });
  }
  function issueInvoice() {
    return perform(async (uid) => {
      if (!tenant || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Select a customer and valid month YYYY-MM.');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || getDayKey(new Date(`${dueDate}T12:00:00`)) !== dueDate || !dueDate.startsWith(month)) throw new Error('Enter a valid due date in the billing month.');
      const charge = parseAmount(extra, true), credit = parseAmount(discount, true);
      const due = calculateMonthlyDues([tenant], payments.data, month, readings.data, invoices.data)[0];
      if (!due || tenant.membershipManaged) throw new Error('No editable monthly bill. Managed memberships issue their own invoices.');
      const total = roundMoney(due.baseAmount + due.meterAmount + charge - credit);
      if (total < due.paid || total < 0 || total > 10_000_000) throw new Error('Credit exceeds unpaid charges or total is too large.');
      if (note.length > 1000 || ((charge || credit) && !note.trim())) throw new Error('Enter a reason for the charge or credit.');
      await runTransaction(db, async (transaction) => {
        const ref = doc(db, 'invoices', `${tenant.id}_${month}`);
        const existing = await transaction.get(ref);
        const closed = await transaction.get(doc(db, 'settlements', tenant.id));
        const latest = await transaction.get(doc(db, 'tenants', tenant.id));
        if (existing.exists() || closed.exists()) throw new Error('This bill is already final.');
        if (latest.data()?.rent !== tenant.rent || latest.data()?.status !== tenant.status) throw new Error('Customer changed. Refresh before issuing.');
        transaction.set(ref, { baseAmount: due.baseAmount, meterAmount: due.meterAmount, extraCharge: charge, discount: credit, dueDate, note: note.trim(), total, businessType: due.businessType, month, tenantId: tenant.id, tenantName: due.tenantName, tenantRoom: due.tenantRoom, status: 'Issued', issuedAt: serverTimestamp(), issuedBy: uid });
        transaction.set(doc(collection(db, 'auditEvents')), { action: 'invoices.generated', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'invoice' });
      });
    });
  }
  function reconcile() {
    return perform(async (uid) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || getDayKey(new Date(`${day}T12:00:00`)) !== day || day > getDayKey()) throw new Error('Enter a valid day up to today.');
      if (unclassified) throw new Error('Unclassified movements need review before reconciliation.');
      const cashOpening = parseAmount(openingCash, true), bankOpening = parseAmount(openingBank, true);
      const cashActual = parseAmount(actualCash, true), bankActual = parseAmount(actualBank, true);
      const cashExpected = roundMoney(cashOpening + totals.Cash), bankExpected = roundMoney(bankOpening + totals.UPI + totals.Bank);
      await runTransaction(db, async (transaction) => {
        const ref = doc(collection(db, 'reconciliations'));
        transaction.set(ref, { day, cashOpening, bankOpening, cashExpected, bankExpected, cashActual, bankActual, cashDifference: roundMoney(cashActual - cashExpected), bankDifference: roundMoney(bankActual - bankExpected), cashMovement: totals.Cash, bankMovement: roundMoney(totals.UPI + totals.Bank), note: note.trim(), createdBy: uid, createdAt: serverTimestamp() });
        transaction.set(doc(collection(db, 'auditEvents')), { action: 'money.reconciled', actorUid: uid, createdAt: serverTimestamp(), entityId: ref.id, entityType: 'reconciliation' });
      });
    });
  }
  const history = useFirestoreCollection<import('../../shared/types/records').FirestoreRecord>('reconciliations', { sortBy: 'createdAt' });
  return <View>
    <Text style={{ ...text, fontSize: 24 }}>{t('Money management')}</Text>
    {message || loadError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, marginVertical: 12 }}>{t(message || loadError || '')}</Text> : null}
    {loading ? <Text style={text}>{t('Loading...')}</Text> : null}
    <View style={card}><Text style={text}>{t('Manual UPI collection')}</Text><Text selectable style={text}>{settings.upiId || t('Add your UPI ID in Business settings.')}</Text>
      {settings.upiQr ? <Image source={{ uri: settings.upiQr }} style={{ width: 220, height: 220, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Business UPI QR code" /> : null}
      {settings.upiId ? <PrimaryButton label="Open UPI app" onPress={() => { Linking.openURL(`upi://pay?pa=${encodeURIComponent(settings.upiId)}&pn=${encodeURIComponent(settings.name)}&cu=INR`).catch(() => setMessage('No UPI app is available on this device.')); }} /> : null}
      <Text style={text}>{t('Verify receipt in your bank account before recording a payment. Opening a UPI app does not confirm payment.')}</Text>
    </View>
    <View style={card}><Text style={text}>{t('Customer')}</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{tenants.data.filter((item) => !item.archived).map((item) => <FilterPill key={item.id} label={`${item.fullName || item.name} · ${item.room || ''}`} active={tenantId === item.id} onPress={() => setTenantId(item.id)} />)}</View>
      <Text style={text}>{t('Deposit held')}: {money(held)}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>{(['collection', 'deduction', 'refund'] as const).map((item) => <FilterPill key={item} label={item} active={kind === item} onPress={() => setKind(item)} />)}</View>
      <TextField label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <View style={{ flexDirection: 'row', gap: 8 }}>{paymentModes.map((item) => <FilterPill key={item} label={item} active={mode === item} onPress={() => setMode(item)} />)}</View>
      <TextField label="Transaction reference" value={reference} onChangeText={setReference} maxLength={120} />
      <TextField label="Reason / note" value={note} onChangeText={setNote} maxLength={1000} />
      <PrimaryButton label="Record deposit movement" onPress={saveDeposit} loading={busy || loading} />
      {events.data.filter((item) => item.tenantId === tenantId).map((item) => <Text key={item.id} selectable style={text}>{item.kind} · {money(item.amount)} · {item.paymentMode} · {item.reference || '—'} · {item.note} · {item.createdBy} · {item.createdAt?.seconds ? new Date(item.createdAt.seconds * 1000).toLocaleString('en-IN') : ''} · {t('Held')}: {money(item.after)}</Text>)}
    </View>
    <View style={card}><Text style={text}>{t('Finalize monthly bill with charges or credit')}</Text><Text style={text}>{t('Issue before collection. Issued bills retain these amounts permanently. Discount / credit reduces the bill; it is not a cash refund.')}</Text>
      <TextField label="Month" value={month} onChangeText={(value) => { setMonth(value); setDueDate(`${value}-10`); }} />
      <TextField label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />
      <TextField label="Additional charge" value={extra} onChangeText={setExtra} keyboardType="decimal-pad" />
      <TextField label="Discount / credit" value={discount} onChangeText={setDiscount} keyboardType="decimal-pad" />
      <PrimaryButton label="Issue final bill" onPress={issueInvoice} loading={busy || loading} />
    </View>
    <View style={card}><Text style={text}>{t('Daily cash and bank reconciliation')}</Text><TextField label="Day (YYYY-MM-DD)" value={day} onChangeText={setDay} />
      {Object.entries(totals).map(([key, value]) => <Text key={key} style={text}>{key}: {money(value)}</Text>)}
      {unclassified ? <Text style={{ color: colors.danger }}>{t('Legacy movements without a method need review; a final reconciliation cannot be saved for this day.')}</Text> : null}
      <Text style={text}>{t('Net movements include collections, deposits, expenses and refunds. Count cash and check bank entries for this day; saved checks are snapshots.')}</Text>
      <TextField label="Opening cash" value={openingCash} onChangeText={setOpeningCash} keyboardType="decimal-pad" />
      <TextField label="Opening bank balance" value={openingBank} onChangeText={setOpeningBank} keyboardType="decimal-pad" />
      <TextField label="Actual closing cash" value={actualCash} onChangeText={setActualCash} keyboardType="decimal-pad" />
      <TextField label="Actual closing bank balance" value={actualBank} onChangeText={setActualBank} keyboardType="decimal-pad" />
      <PrimaryButton label="Save reconciliation" onPress={reconcile} loading={busy || loading} />
      {history.error ? <Text style={text}>{history.error}</Text> : null}
      {history.data.filter((item) => item.day === day).map((item) => <Text key={item.id} style={text}>{String(item.day)} · {t('Cash difference')}: {money(item.cashDifference)} · {t('Bank difference')}: {money(item.bankDifference)} · {String(item.createdBy)}</Text>)}
    </View>
  </View>;
}
