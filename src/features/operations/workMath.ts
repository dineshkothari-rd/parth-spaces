import type { EnquiryRecord, InvoiceRecord, MembershipRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord } from '../../shared/types/records';
import { roundMoney } from '../../shared/utils/money';
import { calculateMonthlyDues, calculateOutstandingBalance, getDayKey, getMonthKey, getRecordDay, shiftMonth } from './operationsMath';

export function validDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) && getDayKey(date) === value;
}
export function daysBetween(first: string, second: string) {
  return Math.floor((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
}
export function outstandingRows(tenants: TenantRecord[], payments: PaymentRecord[], readings: MeterReadingRecord[], invoices: InvoiceRecord[], settlements: SettlementRecord[], day = getDayKey()) {
  const month = day.slice(0, 7);
  return tenants.flatMap((tenant) => {
    const balance = roundMoney(calculateOutstandingBalance(tenant, payments, readings, month, invoices, settlements));
    if (balance <= 0) return [];
    const settlement = settlements.find((item) => item.tenantId === tenant.id && item.status === 'Final');
    let oldestDueDate = '', overdue = 0;
    if (settlement) {
      oldestDueDate = getRecordDay(settlement, ['finalizedAt']) || getRecordDay(tenant, ['checkedOutAt', 'moveOutDate']) || `${settlement.month}-01`;
      overdue = oldestDueDate < day ? balance : 0;
    } else {
      const start = [getRecordDay(tenant, ['checkedInAt', 'moveInDate', 'checkInDate']).slice(0, 7), ...invoices.filter((item) => item.tenantId === tenant.id).map((item) => item.month)].filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item)).sort()[0] || month;
      // ponytail: reuse the existing 20-year ledger ceiling; use stored aging totals for larger histories.
      for (let cursor = start, count = 0; cursor <= month && count < 240; cursor = shiftMonth(cursor, 1), count += 1) {
        const due = calculateMonthlyDues([tenant], payments, cursor, readings, invoices)[0];
        if (!due?.balance) continue;
        const date = due.dueDate && validDay(due.dueDate) ? due.dueDate : `${cursor}-10`;
        if (!oldestDueDate || date < oldestDueDate) oldestDueDate = date;
        if (date < day) overdue = roundMoney(overdue + due.balance);
      }
    }
    const overdueDays = oldestDueDate && oldestDueDate < day ? daysBetween(oldestDueDate, day) : 0;
    return [{ tenant, balance, overdue, oldestDueDate, overdueDays, bucket: overdueDays === 0 ? 'Not overdue' : overdueDays <= 30 ? '1–30 days' : overdueDays <= 60 ? '31–60 days' : overdueDays <= 90 ? '61–90 days' : '90+ days' }];
  }).sort((a, b) => b.overdueDays - a.overdueDays || b.balance - a.balance);
}
export function expiringMemberships(memberships: MembershipRecord[], day = getDayKey()) {
  return memberships.filter((item) => item.start <= day && daysBetween(day, item.end) <= 7 && !memberships.some((other) => other.tenantId === item.tenantId && other.end > item.end))
    .sort((a, b) => a.end.localeCompare(b.end));
}
export function pendingEnquiries(enquiries: EnquiryRecord[], day = getDayKey()) {
  return enquiries.filter((item) => !['converted', 'closed'].includes(String(item.status || '').toLowerCase()) && (!item.followUpDate || String(item.followUpDate) <= day));
}
export function reminderMessage(business: string, name: string, detail: string) {
  return `Hello ${name}, a reminder from ${business}: ${detail}. Please contact us if you need help. Thank you.`;
}
