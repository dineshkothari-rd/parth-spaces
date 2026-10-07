import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useRealtimeClock } from '../../shared/hooks/useRealtimeClock';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import type { EnquiryRecord, ExpenseRecord, InvoiceRecord, MeterReadingRecord, PaymentRecord, TenantRecord } from '../../shared/types/records';
import { money } from '../../shared/utils/money';
import { businessTypeOptions } from '../customers/businessTypes';
import { getCustomerStatusGroup } from '../customers/customerUtils';
import { getRoomSummary, parseRoomLabel } from '../customers/roomUtils';
import {
  calculateMonthlyDues,
  getCollectedTotal,
  getExpenseTotal,
  getDailyStayActions,
  getDayKey,
  getMonthDisplay,
  getMonthKey,
  isVoided,
  matchesMonth,
  meterReadingNeedsReview,
  shiftMonth,
  summarizeDues,
} from './operationsMath';
import { MetricTile } from './MetricTile';

const paymentDateFields = ['paidOn', 'date', 'createdAt', 'updatedAt'];
const expenseDateFields = ['date', 'expenseDate', 'createdAt', 'updatedAt'];
const activityDateFields = ['createdAt', 'updatedAt', 'date'];

export type OverviewDestination = 'arrivals' | 'attention' | 'customers' | 'departures' | 'money' | 'enquiries' | 'meter';

export function OperationsOverviewScreen({ onNavigate }: { onNavigate: (destination: OverviewDestination) => void }) {
  const { settings } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [month, setMonth] = useState(getMonthKey());
  const now = useRealtimeClock();
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const payments = useFirestoreCollection<PaymentRecord>('payments', { sortBy: 'createdAt' });
  const expenses = useFirestoreCollection<ExpenseRecord>('expenses', { sortBy: 'createdAt' });
  const enquiries = useFirestoreCollection<EnquiryRecord>('enquiries', { sortBy: 'createdAt' });
  const meterReadings = useFirestoreCollection<MeterReadingRecord>('meterReadings', { sortBy: 'createdAt' });
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices', { sortBy: 'issuedAt' });
  const loading = tenants.loading || payments.loading || expenses.loading || enquiries.loading || meterReadings.loading || invoices.loading;
  const error = tenants.error || payments.error || expenses.error || enquiries.error || meterReadings.error || invoices.error;
  const currentMonth = getMonthKey();
  const today = getDayKey(new Date(now));
  const roomSummary = useMemo(() => getRoomSummary(tenants.data, now, settings), [now, tenants.data, settings]);
  const snapshot = useMemo(() => {
    const monthlyPayments = payments.data.filter((payment) => matchesMonth(payment, month, paymentDateFields));
    const monthlyExpenses = expenses.data.filter((expense) => matchesMonth(expense, month, expenseDateFields));
    const monthlyEnquiries = enquiries.data.filter((enquiry) => matchesMonth(enquiry, month, activityDateFields));
    const monthlyReadings = meterReadings.data.filter((reading) =>
      matchesMonth(reading, month, activityDateFields)
      && !isVoided(reading)
      && !meterReadingNeedsReview(meterReadings.data, reading));
    const dues = calculateMonthlyDues(tenants.data, payments.data, month, meterReadings.data, invoices.data);
    const activeCustomers = tenants.data.filter((customer) => getCustomerStatusGroup(customer) === 'active');
    const readPgRooms = new Set(monthlyReadings.map((reading) => parseRoomLabel(reading.tenantRoom).room).filter(Boolean));
    const activePgRooms = new Set(
      activeCustomers
        .filter((customer) => String(customer.businessType || 'pg') === 'pg')
        .map((customer) => parseRoomLabel(customer.room).room)
        .filter(Boolean),
    );
    const collected = getCollectedTotal(monthlyPayments);
    const expenseTotal = getExpenseTotal(monthlyExpenses);

    return {
      activeCustomers,
      businessSnapshots: businessTypeOptions.map((business) => {
        const active = activeCustomers.filter((customer) => String(customer.businessType || 'pg') === business.id);
        const allocations = new Set(active.map((customer) => String(customer.room || '').trim()).filter(Boolean));
        const businessDues = summarizeDues(dues.filter((due) => due.businessType === business.id));
        return { active: active.length, allocations: allocations.size, due: businessDues.balance, ...business };
      }),
      collected,
      dailyActions: getDailyStayActions(tenants.data, today),
      duesSummary: summarizeDues(dues),
      expenseTotal,
      net: collected - expenseTotal,
      newEnquiries: monthlyEnquiries.filter((enquiry) => String(enquiry.status || 'New').toLowerCase() === 'new'),
      roomsMissingReading: [...activePgRooms].filter((room) => !readPgRooms.has(room)).length,
    };
  }, [enquiries.data, expenses.data, invoices.data, meterReadings.data, month, payments.data, tenants.data, today]);
  const { activeCustomers, businessSnapshots, collected, dailyActions, duesSummary, expenseTotal, net, newEnquiries, roomsMissingReading } = snapshot;

  return (
    <View>
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.kicker}>{getMonthDisplay(month)}</Text>
            <Text style={styles.heroLabel}>{t('Net')}</Text>
          </View>
          <View style={[styles.netBadge, net < 0 && styles.netBadgeDanger]}>
            <Text style={[styles.netBadgeText, net < 0 && styles.netBadgeTextDanger]}>{t(net < 0 ? 'Due' : 'Cash flow')}</Text>
          </View>
        </View>
        <Text adjustsFontSizeToFit minimumFontScale={0.65} numberOfLines={1} style={styles.netValue}>{money(net)}</Text>
        <Text style={styles.heroTitle}>{t('Monthly snapshot')}</Text>
        <Text style={styles.heroText}>{t('Collections, dues, expenses, and follow-ups for this month.')}</Text>
        <View style={styles.monthNavigator}>
          <Pressable accessibilityRole="button" onPress={() => setMonth((value) => shiftMonth(value, -1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>{t('Prev')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMonth(currentMonth)} style={styles.monthValue}>
            <Text style={styles.monthValueText}>{getMonthDisplay(month)}</Text>
            <Text style={styles.monthValueHint}>{month === currentMonth ? t('Current month') : t('Tap to reset')}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMonth((value) => shiftMonth(value, 1))} style={styles.monthButton}>
            <Text style={styles.monthButtonText}>{t('Next')}</Text>
          </Pressable>
        </View>
      </View>

      {loading ? <View style={styles.statusRow}><ActivityIndicator color={colors.brand} /><Text style={styles.statusText}>{t('Loading latest details')}</Text></View> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.metrics}>
        <MetricTile label={t('Collected')} value={money(collected)} tone="green" />
        <MetricTile label={t('Expenses')} value={money(expenseTotal)} tone="orange" />
        <MetricTile label={t('Expected')} value={money(duesSummary.expected)} tone="blue" />
        <MetricTile label={t('Due')} value={money(duesSummary.balance)} tone={duesSummary.balance > 0 ? 'red' : 'green'} />
      </View>

      <View style={styles.sectionHeader}>
        <View><Text style={styles.sectionKicker}>{t('Business')}</Text><Text style={styles.sectionTitle}>{t('Stays & seats')}</Text></View>
        <Text style={styles.sectionMeta}>{activeCustomers.length} {t('customers')}</Text>
      </View>
      <View style={styles.businessGrid}>
        {businessSnapshots.map((business) => <BusinessCard business={business} key={business.id} styles={styles} />)}
      </View>

      <View style={styles.capacityPanel}>
        <View style={styles.capacityCopy}><Text style={styles.panelTitle}>{t('Rooms')}</Text><Text style={styles.panelText}>{t('Available for PG or Hotel')}</Text></View>
        <View style={styles.capacityValues}>
          <SummaryValue label={t('Occupied')} styles={styles} value={roomSummary.occupiedRooms} />
          <SummaryValue label={t('Available')} styles={styles} value={roomSummary.availableRooms} />
          <SummaryValue label={t('Total')} styles={styles} value={roomSummary.totalRooms} />
        </View>
      </View>

      <View style={styles.attentionPanel}>
        <Text style={styles.panelTitle}>{t("Today's work")}</Text>
        <FocusRow accent={colors.success} label={t('Arrivals ready')} onPress={() => onNavigate('arrivals')} styles={styles} value={`${dailyActions.arrivals} ${t('customers')}`} />
        <FocusRow accent={colors.copper} label={t('Check-outs due')} onPress={() => onNavigate('departures')} styles={styles} value={`${dailyActions.departures} ${t('customers')}`} />
        <FocusRow accent={colors.accent} label={t('Profiles to complete')} onPress={() => onNavigate('attention')} styles={styles} value={`${dailyActions.incompleteProfiles} ${t('customers')}`} />
        <FocusRow accent={colors.danger} label={t('Outstanding dues')} onPress={() => onNavigate('money')} styles={styles} value={`${duesSummary.pendingCount + duesSummary.partialCount} ${t('customers')}`} />
        <FocusRow accent={colors.warning} label={t('Meter readings')} onPress={() => onNavigate('meter')} styles={styles} value={`${roomsMissingReading} ${t('rooms')}`} />
        <FocusRow accent={colors.sky} label={t('New enquiries')} onPress={() => onNavigate('enquiries')} styles={styles} value={`${newEnquiries.length} ${t('leads')}`} />
      </View>
    </View>
  );
}

function BusinessCard({ business, styles }: { business: (typeof businessTypeOptions)[number] & { active: number; allocations: number; due: number }; styles: ReturnType<typeof createStyles> }) {
  const { t } = useLanguage();

  return (
    <View style={styles.businessCard}>
      <View style={styles.businessTop}><View style={styles.businessMark}><Text style={styles.businessMarkText}>{business.label[0]}</Text></View><Text style={styles.businessLabel}>{t(business.label)}</Text></View>
      <Text style={styles.businessValue}>{business.active}</Text>
      <Text style={styles.businessValueLabel}>{t('Active')}</Text>
      <View style={styles.businessDivider} />
      <View style={styles.businessDetail}><Text style={styles.businessDetailLabel}>{t(business.unitLabel)}</Text><Text style={styles.businessDetailValue}>{business.allocations}</Text></View>
      <View style={styles.businessDetail}><Text style={styles.businessDetailLabel}>{t('Due')}</Text><Text style={[styles.businessDetailValue, business.due > 0 && styles.dueValue]}>{money(business.due)}</Text></View>
    </View>
  );
}

function SummaryValue({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: number }) {
  return <View style={styles.summaryValue}><Text style={styles.summaryNumber}>{value}</Text><Text style={styles.summaryLabel}>{label}</Text></View>;
}

function FocusRow({ accent, label, onPress, styles, value }: { accent: string; label: string; onPress: () => void; styles: ReturnType<typeof createStyles>; value: string }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.focusRow, pressed && styles.focusRowPressed]}><View style={styles.focusLabelWrap}><View style={[styles.focusDot, { backgroundColor: accent }]} /><Text style={styles.focusLabel}>{label}</Text></View><Text style={styles.focusValue}>{value}  ›</Text></Pressable>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: spacing.lg, ...shadow.card },
    heroTop: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between' },
    kicker: { color: colors.panelAccent, fontSize: 12, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    heroLabel: { color: colors.panelSubtle, fontSize: 12, fontWeight: typography.weight.bold, marginTop: spacing.sm },
    netBadge: { backgroundColor: colors.successSoft, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6 },
    netBadgeDanger: { backgroundColor: colors.dangerSoft },
    netBadgeText: { color: colors.success, fontSize: 11, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    netBadgeTextDanger: { color: colors.danger },
    netValue: { color: colors.panelText, fontSize: 40, fontWeight: typography.weight.black, lineHeight: 46, marginTop: spacing.sm },
    heroTitle: { color: colors.panelText, fontSize: 18, fontWeight: typography.weight.black, marginTop: spacing.lg },
    heroText: { color: colors.panelMuted, fontSize: 14, lineHeight: 21, marginTop: spacing.xs },
    monthNavigator: { alignItems: 'center', backgroundColor: colors.overlayFaint, borderRadius: radius.lg, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, padding: spacing.sm },
    monthButton: { alignItems: 'center', backgroundColor: colors.overlaySubtle, borderRadius: radius.md, justifyContent: 'center', minHeight: 38, paddingHorizontal: spacing.md },
    monthButtonText: { color: colors.onBrand, fontSize: 12, fontWeight: typography.weight.black },
    monthValue: { alignItems: 'center', flex: 1 },
    monthValueText: { color: colors.onBrand, fontSize: 15, fontWeight: typography.weight.black },
    monthValueHint: { color: colors.panelMuted, fontSize: 11, fontWeight: typography.weight.bold, marginTop: 2 },
    statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    statusText: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold },
    errorText: { backgroundColor: colors.dangerSoft, borderColor: colors.danger, borderRadius: radius.md, borderWidth: 1, color: colors.danger, fontSize: 13, fontWeight: typography.weight.bold, lineHeight: 19, marginTop: spacing.md, padding: spacing.md },
    metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, justifyContent: 'space-between', marginTop: spacing.lg },
    sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'space-between', marginTop: spacing.xl },
    sectionKicker: { color: colors.brand, fontSize: 11, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    sectionTitle: { color: colors.text, fontSize: 21, fontWeight: typography.weight.black, marginTop: 3 },
    sectionMeta: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.bold },
    businessGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, paddingVertical: spacing.md },
    businessCard: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, flexBasis: 180, flexGrow: 1, padding: spacing.md, ...shadow.card },
    businessTop: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm },
    businessMark: { alignItems: 'center', backgroundColor: colors.copperSoft, borderRadius: radius.sm, height: 32, justifyContent: 'center', width: 32 },
    businessMarkText: { color: colors.copper, fontSize: 14, fontWeight: typography.weight.black },
    businessLabel: { color: colors.text, flexShrink: 1, fontSize: 15, fontWeight: typography.weight.black },
    businessValue: { color: colors.text, fontSize: 30, fontWeight: typography.weight.black, marginTop: spacing.lg },
    businessValueLabel: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.bold, marginTop: 2 },
    businessDivider: { backgroundColor: colors.borderSoft, height: 1, marginVertical: spacing.md },
    businessDetail: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 26 },
    businessDetailLabel: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.bold },
    businessDetailValue: { color: colors.text, fontSize: 13, fontWeight: typography.weight.black },
    dueValue: { color: colors.danger },
    capacityPanel: { backgroundColor: colors.skySoft, borderRadius: radius.lg, flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm, padding: spacing.lg },
    capacityCopy: { flexBasis: 130, flexGrow: 1 },
    panelTitle: { color: colors.text, fontSize: 17, fontWeight: typography.weight.black },
    panelText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.xs },
    capacityValues: { flexBasis: 190, flexDirection: 'row', flexGrow: 1, gap: spacing.sm, justifyContent: 'space-between' },
    summaryValue: { alignItems: 'center', flex: 1, minWidth: 42 },
    summaryNumber: { color: colors.text, fontSize: 20, fontWeight: typography.weight.black },
    summaryLabel: { color: colors.muted, fontSize: 10, fontWeight: typography.weight.bold, marginTop: 3 },
    attentionPanel: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.lg, padding: spacing.lg, ...shadow.card },
    focusRow: { alignItems: 'center', borderTopColor: colors.borderSoft, borderTopWidth: 1, flexDirection: 'row', justifyContent: 'space-between', minHeight: 48 },
    focusRowPressed: { opacity: 0.65 },
    focusLabelWrap: { alignItems: 'center', flex: 1, flexDirection: 'row', gap: spacing.sm },
    focusDot: { borderRadius: 99, height: 8, width: 8 },
    focusLabel: { color: colors.text, flex: 1, fontSize: 14, fontWeight: typography.weight.bold },
    focusValue: { color: colors.muted, flexShrink: 1, fontSize: 13, fontWeight: typography.weight.bold, marginLeft: spacing.sm, textAlign: 'right' },
  });
}
