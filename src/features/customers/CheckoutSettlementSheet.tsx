import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { TextField } from '../../shared/components/TextField';
import type { TenantRecord } from '../../shared/types/records';
import { money, toNumber } from '../../shared/utils/money';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { paymentModes, parseAmount, validatePaymentDetails } from '../money/financeMath';
import { FilterPill } from './FilterPill';
import { calculateSettlement } from '../operations/operationsMath';
import { getCustomerName } from './customerUtils';

export type CheckoutSettlementDraft = {
  paymentMode: string;
  reference: string;
  depositHeld: number;
  discount: number;
  extraCharge: number;
  paymentReceived: number;
};

export function CheckoutSettlementSheet({
  heldDeposit,
  automaticCharge,
  customer,
  ledgerBalance,
  onClose,
  onSubmit,
  saving,
}: {
  heldDeposit?: number;
  automaticCharge: number;
  customer: TenantRecord;
  ledgerBalance: number;
  onClose: () => void;
  onSubmit: (draft: CheckoutSettlementDraft) => void;
  saving: boolean;
}) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const [depositHeld, setDepositHeld] = useState(heldDeposit === undefined ? '' : String(heldDeposit));
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [discount, setDiscount] = useState('');
  const [extraCharge, setExtraCharge] = useState('');
  const [paymentReceived, setPaymentReceived] = useState('');
  const [error, setError] = useState('');
  const draft = {
    paymentMode, reference: reference.trim(),
    depositHeld: heldDeposit ?? toNumber(depositHeld),
    discount: toNumber(discount),
    extraCharge: automaticCharge + toNumber(extraCharge),
    ledgerBalance,
    paymentReceived: toNumber(paymentReceived),
  };
  const result = calculateSettlement(draft);

  function submit() {
    try {
      for (const value of [heldDeposit === undefined ? depositHeld || '0' : String(heldDeposit), discount || '0', extraCharge || '0', paymentReceived || '0']) parseAmount(value, true);
      if (draft.paymentReceived > 0) validatePaymentDetails(paymentMode, reference);
    } catch (error) { setError(error instanceof Error ? error.message : 'Invalid amount.'); return; }
    const values = [draft.depositHeld, draft.discount, draft.extraCharge, draft.paymentReceived];
    if (values.some((value) => value < 0 || value > 10_000_000)) return setError(t('Enter valid settlement amounts.'));
    if (draft.discount > ledgerBalance + draft.extraCharge) return setError(t('Discount cannot exceed the total amount due.'));
    if (draft.paymentReceived > result.grossDue - result.depositApplied) return setError(t('Payment received is more than the remaining amount.'));
    onSubmit({ paymentMode, reference: reference.trim(), depositHeld: draft.depositHeld, discount: draft.discount, extraCharge: draft.extraCharge, paymentReceived: draft.paymentReceived });
  }

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.kicker}>{t('Final settlement')}</Text>
            <Text style={styles.title}>{getCustomerName(customer)}</Text>
            <Text style={styles.subtitle}>{t('Review every amount before completing checkout.')}</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Summary label={t('Ledger due')} styles={styles} value={money(ledgerBalance)} />
            {automaticCharge ? <Summary label={t('Final meter charge')} styles={styles} value={money(automaticCharge)} /> : null}
            <View style={styles.fields}>
              <TextField editable={heldDeposit === undefined} keyboardType="numeric" label="Deposit already received and held" onChangeText={setDepositHeld} placeholder="0" value={heldDeposit === undefined ? depositHeld : String(heldDeposit)} />
              <Text style={styles.subtitle}>{t(heldDeposit === undefined ? 'Legacy deposit: enter only the amount actually held. New deposits should be recorded in Money management first.' : 'Deposit comes from the recorded ledger and will be closed with this settlement.')}</Text>
              <TextField keyboardType="numeric" label="Discount" onChangeText={setDiscount} placeholder="0" value={discount} />
              <TextField keyboardType="numeric" label="Other extra charge" onChangeText={setExtraCharge} placeholder="0" value={extraCharge} />
              <TextField keyboardType="numeric" label="Payment received now" onChangeText={setPaymentReceived} placeholder="0" value={paymentReceived} />
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>{paymentModes.map((mode) => <FilterPill key={mode} label={mode} active={paymentMode === mode} onPress={() => setPaymentMode(mode)} />)}</View>
            <TextField label="Transaction reference" value={reference} onChangeText={setReference} maxLength={120} />
            <View style={styles.result}>
              <Summary label={t('Gross due')} styles={styles} value={money(result.grossDue)} />
              <Summary label={t('Deposit applied')} styles={styles} value={money(result.depositApplied)} />
              <Summary label={t('Final balance')} styles={styles} value={money(result.finalBalance)} />
              <Summary label={t('Refund due')} styles={styles} value={money(result.refundDue)} />
            </View>

            <View style={styles.actions}>
              <Pressable disabled={saving} onPress={onClose} style={styles.secondary}><Text style={styles.secondaryText}>{t('Cancel')}</Text></Pressable>
              <Pressable disabled={saving} onPress={submit} style={styles.primary}>
                {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>{t('Finalize checkout')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Summary({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue}>{value}</Text></View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '92%', padding: spacing.xl },
    kicker: { color: colors.link, fontSize: 12, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    title: { color: colors.text, fontSize: 24, fontWeight: typography.weight.black, marginTop: spacing.xs },
    subtitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.lg, marginTop: spacing.xs },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, marginBottom: spacing.md, padding: spacing.md },
    fields: { gap: spacing.sm, marginTop: spacing.lg },
    result: { backgroundColor: colors.surfaceRaised, borderRadius: radius.lg, marginTop: spacing.lg, paddingHorizontal: spacing.md },
    row: { alignItems: 'center', borderBottomColor: colors.borderSoft, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
    rowLabel: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold },
    rowValue: { color: colors.text, fontSize: 15, fontWeight: typography.weight.black },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondary: { alignItems: 'center', borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 48 },
    secondaryText: { color: colors.text, fontWeight: typography.weight.black },
    primary: { alignItems: 'center', backgroundColor: colors.brand, borderRadius: radius.md, flex: 1, justifyContent: 'center', minHeight: 48 },
    primaryText: { color: colors.onBrand, fontWeight: typography.weight.black },
  });
}
