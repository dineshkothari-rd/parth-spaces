import { FilterPill } from '../customers/FilterPill';
import { parseAmount, paymentModes, validatePaymentDetails } from './financeMath';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { collection, doc, serverTimestamp, writeBatch, runTransaction } from 'firebase/firestore';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { auth, db } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import type { PaymentRecord, SettlementRecord, TenantRecord } from '../../shared/types/records';
import { money, toNumber } from '../../shared/utils/money';
import { getCollectedTotal, getPaymentTenantId } from '../operations/operationsMath';

export function SettlementsScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const settlements = useFirestoreCollection<SettlementRecord>('settlements', { sortBy: 'finalizedAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments', { sortBy: 'createdAt' });
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const [busyId, setBusyId] = useState('');
  const [paymentId, setPaymentId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');

  async function markRefundPaid(settlement: SettlementRecord) {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) return setError(t('Please sign in again.'));
    setBusyId(settlement.id);
    setError('');
    try {
      validatePaymentDetails(paymentMode, reference);
      const batch = writeBatch(db);
      batch.update(doc(db, 'settlements', settlement.id), {
        refundMode: paymentMode, refundReference: reference.trim(), refundStatus: 'Paid', refundedAt: serverTimestamp(), refundedBy: actorUid,
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'settlement.refund_paid', actorUid, createdAt: serverTimestamp(), entityId: settlement.id, entityType: 'settlement',
      });
      await batch.commit();
    } catch (refundError) {
      setError(refundError instanceof Error ? refundError.message : t('Could not record refund.'));
    } finally {
      setBusyId('');
    }
  }

  function confirmRefund(settlement: SettlementRecord) {
    Alert.alert(
      t('Mark refund paid?'),
      `${settlement.tenantName} · ${money(settlement.refundDue)}`,
      [{ text: t('Cancel'), style: 'cancel' }, { text: t('Mark paid'), onPress: () => markRefundPaid(settlement) }],
    );
  }

  function getRemainingBalance(settlement: SettlementRecord) {
    const paidNow = getCollectedTotal(payments.data.filter((payment) => getPaymentTenantId(payment) === settlement.tenantId));
    return Math.max(0, settlement.finalBalance - Math.max(0, paidNow - settlement.paidAtSettlement));
  }

  async function recordBalancePayment(settlement: SettlementRecord) {
    const actorUid = auth.currentUser?.uid;
    const amount = toNumber(paymentAmount);
    const balance = getRemainingBalance(settlement);
    const tenant = tenants.data.find((item) => item.id === settlement.tenantId);
    if (!actorUid) return setError(t('Please sign in again.'));
    if (!amount || amount <= 0 || amount > balance) return setError(t('Enter an amount up to the remaining balance.'));

    setBusyId(settlement.id);
    setError('');
    try {
      parseAmount(paymentAmount);
      validatePaymentDetails(paymentMode, reference);
      const paymentRef = doc(collection(db, 'payments'));
      const batch = writeBatch(db);
      batch.set(paymentRef, {
        amountPaid: amount,
        balance: balance - amount,
        businessType: tenant?.businessType || 'pg',
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        month: settlement.month,
        paymentMode, reference: reference.trim(), collectedBy: actorUid,
        note: 'Settlement balance',
        paidOn: new Date().toLocaleDateString('en-IN'),
        status: 'Recorded',
        tenantId: settlement.tenantId,
        tenantName: settlement.tenantName,
        tenantRoom: tenant?.room || '',
        totalRent: settlement.grossDue,
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'payment.created', actorUid, createdAt: serverTimestamp(), entityId: paymentRef.id, entityType: 'payment',
      });
      await batch.commit();
      setPaymentAmount('');
      setPaymentId('');
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : t('Could not record payment.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <View>
      <Text style={styles.title}>{t('Checkout settlements')}</Text>
      <Text style={styles.subtitle}>{t('Final balances, deposits and refunds stay recorded here.')}</Text>
      {settlements.error || error ? <Text style={styles.error}>{settlements.error || error}</Text> : null}
      <View style={styles.paymentBox}><Text style={styles.subtitle}>{t('Method and reference for the next balance payment or refund')}</Text><View style={{ flexDirection: 'row', gap: 8 }}>{paymentModes.map((mode) => <FilterPill key={mode} label={mode} active={paymentMode === mode} onPress={() => setPaymentMode(mode)} />)}</View><TextField label="Transaction reference" value={reference} onChangeText={setReference} maxLength={120} /></View>
      {settlements.data.map((settlement) => (
        <View key={settlement.id} style={styles.card}>
          <View style={styles.header}><Text style={styles.name}>{settlement.tenantName}</Text><Text style={styles.month}>{settlement.month}</Text></View>
          <Row label={t('Gross due')} styles={styles} value={money(settlement.grossDue)} />
          <Row label={t('Deposit applied')} styles={styles} value={money(settlement.depositApplied)} />
          <Row label={t('Payment received')} styles={styles} value={money(settlement.paymentReceived)} />
          <Row label={t('Remaining balance')} styles={styles} value={money(getRemainingBalance(settlement))} />
          <Row label={t('Refund')} styles={styles} value={`${money(settlement.refundDue)} · ${t(settlement.refundStatus)}`} />
          {getRemainingBalance(settlement) > 0 ? paymentId === settlement.id ? (
            <View style={styles.paymentBox}>
              <TextField keyboardType="numeric" label="Payment received" onChangeText={setPaymentAmount} placeholder="0" value={paymentAmount} />
              <Pressable disabled={busyId === settlement.id} onPress={() => recordBalancePayment(settlement)} style={styles.action}>
                <Text style={styles.actionText}>{t(busyId === settlement.id ? 'Saving...' : 'Save payment')}</Text>
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => { setPaymentId(settlement.id); setPaymentAmount(''); }} style={styles.balanceAction}>
              <Text style={styles.balanceActionText}>{t('Record balance payment')}</Text>
            </Pressable>
          ) : null}
          {settlement.refundStatus === 'Due' ? (
            <Pressable disabled={busyId === settlement.id} onPress={() => confirmRefund(settlement)} style={styles.action}>
              <Text style={styles.actionText}>{t(busyId === settlement.id ? 'Saving...' : 'Mark refund paid')}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {!settlements.loading && !settlements.data.length ? <Text style={styles.empty}>{t('No checkout settlements yet.')}</Text> : null}
    </View>
  );
}

function Row({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={styles.value}>{value}</Text></View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    title: { color: colors.text, fontSize: 24, fontWeight: typography.weight.black },
    subtitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.lg, marginTop: spacing.xs },
    card: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
    name: { color: colors.text, flex: 1, fontSize: 16, fontWeight: typography.weight.black },
    month: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.bold },
    row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs },
    label: { color: colors.muted, fontSize: 12 },
    value: { color: colors.text, fontSize: 13, fontWeight: typography.weight.black },
    action: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radius.md, marginTop: spacing.md, padding: spacing.md },
    actionText: { color: colors.onBrand, fontWeight: typography.weight.black },
    paymentBox: { marginTop: spacing.md },
    balanceAction: { alignItems: 'center', borderColor: colors.brand, borderRadius: radius.md, borderWidth: 1, marginTop: spacing.md, padding: spacing.md },
    balanceActionText: { color: colors.brand, fontWeight: typography.weight.black },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, marginBottom: spacing.md, padding: spacing.md },
    empty: { color: colors.muted, padding: spacing.xl, textAlign: 'center' },
  });
}
