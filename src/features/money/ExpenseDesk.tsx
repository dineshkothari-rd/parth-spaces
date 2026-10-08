import { Alert } from '../../shared/utils/alert';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { auth, db } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import type { ExpenseRecord, PaymentRecord } from '../../shared/types/records';
import { money, toNumber } from '../../shared/utils/money';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { FilterPill } from '../customers/FilterPill';
import { getCollectedTotal, getExpenseAmount, getMonthDisplay, isVoided, matchesMonth } from '../operations/operationsMath';
import { parseAmount, paymentModes, validatePaymentDetails } from './financeMath';
import { getDayKey } from '../operations/operationsMath';
import { editableExpenseCategories, expenseCategories, getExpenseCategory } from './expenseCategories';

type ExpenseDraft = {
  amount: number;
  category: string;
  date: string;
  note: string;
  paymentMode: string;
  reference: string;
  title: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function getExpenseTitle(expense: ExpenseRecord) {
  return expense.title || expense.name || expense.description || 'Expense';
}

function getExpenseDate(expense: ExpenseRecord) {
  return String(expense.date || expense.expenseDate || '').slice(0, 10);
}

function matchesExpenseSearch(expense: ExpenseRecord, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) return true;

  return [getExpenseTitle(expense), expense.note, expense.paymentMode, expense.category].some((value) =>
    String(value || '').toLowerCase().includes(query),
  );
}

function getExpenseTotal(expenses: ExpenseRecord[]) {
  return expenses.reduce((sum, expense) => sum + getExpenseAmount(expense), 0);
}

export function ExpenseDesk({ month }: { month: string }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [actionError, setActionError] = useState('');
  const expenses = useFirestoreCollection<ExpenseRecord>('expenses', { sortBy: 'createdAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments', { sortBy: 'createdAt' });
  const monthlyExpenses = useMemo(
    () => expenses.data.filter((expense) => !isVoided(expense) && matchesMonth(expense, month, ['date', 'expenseDate', 'createdAt', 'updatedAt'])),
    [expenses.data, month],
  );
  const monthlyPayments = useMemo(
    () => payments.data.filter((payment) => matchesMonth(payment, month, ['paidOn', 'date', 'createdAt', 'updatedAt'])),
    [month, payments.data],
  );
  const visibleExpenses = useMemo(
    () =>
      monthlyExpenses.filter((expense) => {
        const categoryMatches = category ? expense.category === category : true;
        return categoryMatches && matchesExpenseSearch(expense, search);
      }),
    [category, monthlyExpenses, search],
  );
  const income = getCollectedTotal(monthlyPayments);
  const expenseTotal = getExpenseTotal(visibleExpenses);
  const allExpenseTotal = getExpenseTotal(monthlyExpenses);
  const net = income - allExpenseTotal;
  const loading = expenses.loading || payments.loading;
  const error = expenses.error || payments.error;

  function clearFilters() {
    setSearch('');
    setCategory('');
  }

  async function createExpense(payload: ExpenseDraft) {
    setSaving(true);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      const expenseRef = doc(collection(db, 'expenses'));
      batch.set(expenseRef, {
        ...payload,
        createdBy: actorUid,
        createdAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'expense.created', actorUid, createdAt: serverTimestamp(), entityId: expenseRef.id, entityType: 'expense' });
      await batch.commit();
      setShowForm(false);
    } catch (createError) {
      setActionError(createError instanceof Error ? createError.message : t('Could not save expense.'));
    } finally {
      setSaving(false);
    }
  }

  async function voidExpense(expenseId: string) {
    setDeletingId(expenseId);
    setActionError('');

    try {
      const actorUid = auth.currentUser?.uid;
      if (!actorUid) throw new Error(t('Please sign in again.'));
      const batch = writeBatch(db);
      batch.update(doc(db, 'expenses', expenseId), { status: 'Voided', updatedAt: serverTimestamp(), voidedAt: serverTimestamp(), voidedBy: actorUid });
      batch.set(doc(collection(db, 'auditEvents')), { action: 'expense.voided', actorUid, createdAt: serverTimestamp(), entityId: expenseId, entityType: 'expense' });
      await batch.commit();
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not void expense.'));
    } finally {
      setDeletingId('');
    }
  }

  function confirmDelete(expense: ExpenseRecord) {
    Alert.alert(t('Void expense?'), `${t('Void')} ${getExpenseTitle(expense)} ${t('for')} ${money(getExpenseAmount(expense))}? ${t('The original record will remain in the audit trail.')}`, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Void'), style: 'destructive', onPress: () => voidExpense(expense.id) },
    ]);
  }

  return (
    <View style={styles.wrap}>
      {showForm ? (
        <ExpenseFormSheet month={month} onClose={() => setShowForm(false)} onSubmit={createExpense} saving={saving} styles={styles} />
      ) : null}

      <View style={styles.panel}>
        <View style={styles.panelTop}>
          <View>
            <Text style={styles.kicker}>{getMonthDisplay(month)}</Text>
            <Text style={styles.title}>{t('Cash flow')}</Text>
          </View>
          <Pressable onPress={() => setShowForm(true)} style={styles.addButton}>
            <Text style={styles.addButtonText}>{t('Add expense')}</Text>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Metric label={t('Income')} styles={styles} value={money(income)} />
          <Metric danger label={t('Expenses')} styles={styles} value={money(allExpenseTotal)} />
          <Metric danger={net < 0} label={t('Net')} styles={styles} value={money(net)} />
        </View>
      </View>

      {loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading cash flow')}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.toolbar}>
        <TextField label="Search expenses" onChangeText={setSearch} placeholder="Title, note, payment mode..." value={search} />
        <View style={styles.filterRail}>
          {expenseCategories.map((item) => (
            <FilterPill active={category === item.value} key={item.value || 'all'} label={item.label} onPress={() => setCategory(item.value)} />
          ))}
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{t('Expenses shown')}</Text>
        <Text style={styles.summaryValue}>{money(expenseTotal)}</Text>
        <Text style={styles.summaryMeta}>
          {visibleExpenses.length} {t('expenses in')} {getMonthDisplay(month)}
        </Text>
      </View>

      {visibleExpenses.length ? (
        visibleExpenses.slice(0, 50).map((expense) => (
          <ExpenseCard
            deleting={deletingId === expense.id}
            expense={expense}
            key={expense.id}
            onDelete={() => confirmDelete(expense)}
            styles={styles}
          />
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('No expenses found')}</Text>
          <Text style={styles.emptyText}>{t('Add an expense or change the filters.')}</Text>
          <Pressable onPress={monthlyExpenses.length ? clearFilters : () => setShowForm(true)} style={styles.emptyAction}>
            <Text style={styles.emptyActionText}>{t(monthlyExpenses.length ? 'Clear filters' : 'Add expense')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function ExpenseFormSheet({
  month,
  onClose,
  onSubmit,
  saving,
  styles,
}: {
  month: string;
  onClose: () => void;
  onSubmit: (payload: ExpenseDraft) => void;
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('maintenance');
  const [date, setDate] = useState(`${month}-${String(new Date().getDate()).padStart(2, '0')}`);
  const [paymentMode, setPaymentMode] = useState('Cash');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  function submit() {
    let parsedAmount: number;
    try {
      parsedAmount = parseAmount(amount); validatePaymentDetails(paymentMode, reference);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || getDayKey(new Date(`${date}T12:00:00`)) !== date) throw new Error('Enter a valid date as YYYY-MM-DD.');
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Invalid expense.'); return; }

    if (!title.trim()) {
      setFormError(t('Expense title is required.'));
      return;
    }

    if (!parsedAmount || parsedAmount <= 0) {
      setFormError(t('Enter a valid amount.'));
      return;
    }

    if (!date.trim()) {
      setFormError(t('Expense date is required.'));
      return;
    }

    onSubmit({
      amount: parsedAmount,
      category,
      date: date.trim() || todayKey(),
      note: note.trim(),
      paymentMode, reference: reference.trim(),
      title: title.trim(),
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
                <Text style={styles.sheetKicker}>{t('Outgoing cost')}</Text>
                <Text style={styles.sheetTitle}>{t('Add expense')}</Text>
              </View>
              <Pressable disabled={saving} onPress={onClose} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseText}>{t('Close')}</Text>
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Text style={styles.formLabel}>{t('Category')}</Text>
            <View style={styles.filterRail}>
              {editableExpenseCategories.map((item) => (
                <FilterPill active={category === item.value} key={item.value} label={item.label} onPress={() => setCategory(item.value)} />
              ))}
            </View>

            <View style={styles.formGrid}>
              <TextField label="Title" onChangeText={setTitle} placeholder="Electricity bill" value={title} />
              <TextField keyboardType="numeric" label="Amount" onChangeText={setAmount} placeholder="2500" value={amount} />
              <TextField label="Date" onChangeText={setDate} placeholder="YYYY-MM-DD" value={date} />
              <View style={{ flexDirection: 'row', gap: 8 }}>{paymentModes.map((mode) => <FilterPill key={mode} label={mode} active={paymentMode === mode} onPress={() => setPaymentMode(mode)} />)}</View>
              <TextField label="Transaction reference" value={reference} onChangeText={setReference} maxLength={120} />
              <TextField label="Note" multiline onChangeText={setNote} placeholder="Optional note" value={note} />
            </View>

            <View style={styles.sheetActions}>
              <Pressable disabled={saving} onPress={onClose} style={[styles.sheetSecondaryAction, saving && styles.disabledAction]}>
                <Text style={styles.sheetSecondaryText}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={submit} style={[styles.sheetPrimaryAction, saving && styles.disabledAction]}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetPrimaryText}>{t('Save expense')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function ExpenseCard({
  deleting,
  expense,
  onDelete,
  styles,
}: {
  deleting: boolean;
  expense: ExpenseRecord;
  onDelete: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const category = getExpenseCategory(expense.category);

  return (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <View style={styles.recordCopy}>
          <Text style={styles.recordCategory}>{t(category.label)}</Text>
          <Text style={styles.recordTitle}>{getExpenseTitle(expense)}</Text>
          <Text style={styles.recordMeta}>
            {getExpenseDate(expense) || t('No date')}
            {expense.paymentMode ? ` / ${String(expense.paymentMode)}` : ''}
          </Text>
        </View>
        <Text style={styles.recordAmount}>{money(getExpenseAmount(expense))}</Text>
      </View>

      {expense.note ? <Text style={styles.note}>{String(expense.note)}</Text> : null}
      <Pressable disabled={deleting} onPress={onDelete} style={[styles.deleteButton, deleting && styles.disabledAction]}>
        <Text style={styles.deleteButtonText}>{t(deleting ? 'Voiding...' : 'Void expense')}</Text>
      </Pressable>
    </View>
  );
}

function Metric({
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
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, danger && styles.metricDanger]}>{value}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      marginTop: spacing.lg,
    },
    panel: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
      ...shadow.card,
    },
    panelTop: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
    },
    kicker: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.text,
      fontSize: 24,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    addButton: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    addButtonText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    metrics: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    metric: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    metricLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    metricValue: {
      color: colors.success,
      fontSize: 14,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    metricDanger: {
      color: colors.danger,
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
    recordCategory: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    recordTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: typography.weight.black,
      lineHeight: 22,
      marginTop: spacing.xs,
    },
    recordMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      marginTop: spacing.xs,
    },
    recordAmount: {
      color: colors.danger,
      fontSize: 15,
      fontWeight: typography.weight.black,
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
    deleteButtonText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    disabledAction: {
      opacity: 0.45,
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
    formGrid: {
      gap: spacing.md,
      marginTop: spacing.lg,
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
