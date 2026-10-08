import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAppTheme } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { TextField } from '../../shared/components/TextField';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useRealtimeClock } from '../../shared/hooks/useRealtimeClock';
import type { DepositAccount, DepositEvent, ExpenseRecord, InvoiceRecord, MembershipRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord, WorkItem } from '../../shared/types/records';
import { FilterPill } from '../customers/FilterPill';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { downloadPdf, shareCsv } from '../../shared/utils/exportFile';
import { getDayKey, getMonthKey } from './operationsMath';
import { buildReportTable, reportCsv, reportHtml, reportKinds, type ReportData, type ReportKind } from './reportMath';

const labels: Record<ReportKind, string> = { summary: 'Financial summary', collections: 'Collections', expenses: 'Expenses', deposits: 'Deposit movements', outstanding: 'Outstanding and aging', occupancy: 'Occupancy', customers: 'Customers', memberships: 'Membership history', work: 'Work checklist' };
export function ReportsScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { settings } = useBusinessSettings();
  const today = getDayKey(new Date(useRealtimeClock()));
  const [month, setMonth] = useState(getMonthKey());
  const [business, setBusiness] = useState('');
  const [kind, setKind] = useState<ReportKind>('summary');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const tenants = useFirestoreCollection<TenantRecord>('tenants');
  const payments = useFirestoreCollection<PaymentRecord>('payments');
  const expenses = useFirestoreCollection<ExpenseRecord>('expenses');
  const readings = useFirestoreCollection<MeterReadingRecord>('meterReadings');
  const invoices = useFirestoreCollection<InvoiceRecord>('invoices');
  const settlements = useFirestoreCollection<SettlementRecord>('settlements');
  const deposits = useFirestoreCollection<DepositEvent>('depositEvents');
  const accounts = useFirestoreCollection<DepositAccount>('depositAccounts');
  const memberships = useFirestoreCollection<MembershipRecord>('memberships');
  const work = useFirestoreCollection<WorkItem>('workItems');
  const sources = [tenants, payments, expenses, readings, invoices, settlements, deposits, accounts, memberships, work];
  const loading = sources.some((item) => item.loading), error = sources.find((item) => item.error)?.error;
  const data: ReportData = { tenants: tenants.data, payments: payments.data, expenses: expenses.data, readings: readings.data, invoices: invoices.data, settlements: settlements.data, deposits: deposits.data, accounts: accounts.data, memberships: memberships.data, work: work.data };
  const validMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
  const table = validMonth ? buildReportTable(kind, data, month, business, today, settings) : null;
  async function exportReport(format: 'csv' | 'pdf') {
    if (loading || error || !table) return setMessage('Wait for records to load and enter a valid month.');
    setBusy(true); setMessage('');
    try {
      const title = `${t(labels[kind])} · ${month} · ${business || t('All businesses')}`;
      const fileName = `parth-spaces-${kind}-${month}-${business || 'all'}.${format}`;
      if (format === 'csv') await shareCsv({ fileName, csv: reportCsv(table), title });
      else await downloadPdf({ fileName, html: reportHtml(table, settings, title), title });
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'Could not export report.'); } finally { setBusy(false); }
  }
  return <View style={{ gap: 12 }}>
    <Text style={{ color: colors.text, fontSize: 24 }}>{t('Reports & exports')}</Text>
    <TextField label="Billing month (YYYY-MM)" value={month} onChangeText={setMonth} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[['All businesses', ''], ['PG', 'pg'], ['Hotel', 'hotel'], ['Library', 'library']].map(([label, value]) => <FilterPill key={label} label={label} active={business === value} onPress={() => setBusiness(value)} />)}</View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{reportKinds.map((value) => <FilterPill key={value} label={labels[value]} active={kind === value} onPress={() => setKind(value)} />)}</View>
    {loading ? <Text style={{ color: colors.muted }}>{t('Loading...')}</Text> : null}
    {message || error || !validMonth ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger }}>{message || error || t('Enter the month as YYYY-MM.')}</Text> : null}
    {table && !loading && !error ? <View style={{ padding: 16, borderRadius: 16, backgroundColor: colors.surface, gap: 10 }}><Text style={{ color: colors.text, fontSize: 18 }}>{t(labels[kind])} · {table.rows.length} {t('rows')}</Text>{table.notes.map((note) => <Text key={note} style={{ color: colors.muted }}>{note}</Text>)}
      {table.rows.slice(0, 30).map((row, index) => <Text key={index} selectable style={{ color: colors.text }}>{row.map((value, column) => `${t(table.columns[column])}: ${value}`).join(' · ')}</Text>)}
      {table.rows.length > 30 ? <Text style={{ color: colors.muted }}>{t('Preview shows 30 rows. Exports include every row.')}</Text> : null}
      <PrimaryButton label="Export CSV" loading={busy} onPress={() => exportReport('csv')} /><PrimaryButton label="Download report PDF" loading={busy} onPress={() => exportReport('pdf')} />
    </View> : null}
  </View>;
}
