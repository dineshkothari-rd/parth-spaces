import type { AgreementRecord, DepositAccount, DepositEvent, ExpenseRecord, InvoiceRecord, MembershipRecord, MeterReadingRecord, PaymentRecord, SettlementRecord, TenantRecord, WorkItem } from '../../shared/types/records';
import { roundMoney, toNumber } from '../../shared/utils/money';
import { defaultBusinessSettings, getSeatNumbers, type BusinessSettings } from '../customers/businessConfig';
import { getAllocationKey, getRoomOccupancy, getStayCheckout, getStayStart } from '../customers/roomUtils';
import { escapeDocumentText } from '../customers/membershipMath';
import { calculateMonthlyDues, csvCell, getDayKey, getExpenseAmount, getPaymentAmount, getRecordDay, isVoided, summarizeDues } from './operationsMath';
import { outstandingRows } from './workMath';

export type ReportData = {
  tenants: TenantRecord[]; payments: PaymentRecord[]; expenses: ExpenseRecord[];
  readings: MeterReadingRecord[]; invoices: InvoiceRecord[]; settlements: SettlementRecord[];
  deposits: DepositEvent[]; accounts: DepositAccount[]; memberships: MembershipRecord[]; work: WorkItem[];
};
export const reportKinds = ['summary', 'collections', 'expenses', 'deposits', 'outstanding', 'occupancy', 'customers', 'memberships', 'work'] as const;
export type ReportKind = typeof reportKinds[number];
export type ReportTable = { columns: string[]; rows: Array<Array<string | number>>; notes: string[] };
const sum = (values: number[]) => roundMoney(values.reduce((total, value) => total + value, 0));
const inMonth = (record: Record<string, unknown>, month: string, fields: string[]) => getRecordDay(record, fields).slice(0, 7) === month;
function typeFor(data: ReportData, record: Record<string, unknown>) {
  return String(record.businessType || data.tenants.find((tenant) => tenant.id === (record.tenantId || record.customerId || record.userId))?.businessType || 'Unknown');
}
function forBusiness(data: ReportData, record: Record<string, unknown>, business: string) { return !business || typeFor(data, record) === business; }
export function monthlyReportSummary(data: ReportData, month: string, business = '') {
  const payments = data.payments.filter((item) => !isVoided(item) && inMonth(item, month, ['createdAt', 'paidOn', 'date']) && forBusiness(data, item, business));
  const expenses = data.expenses.filter((item) => !isVoided(item) && inMonth(item, month, ['date', 'expenseDate', 'createdAt']));
  const deposits = data.deposits.filter((item) => inMonth(item, month, ['createdAt']) && forBusiness(data, item, business));
  const refunds = data.settlements.filter((item) => item.refundStatus === 'Paid' && inMonth(item, month, ['refundedAt']) && forBusiness(data, item, business));
  const collections = sum(payments.map(getPaymentAmount));
  const expenseTotal = sum(expenses.map(getExpenseAmount));
  const depositCollections = sum(deposits.filter((item) => item.kind === 'collection').map((item) => item.amount));
  const depositRefunds = sum(deposits.filter((item) => item.kind === 'refund').map((item) => item.amount));
  const settlementRefunds = sum(refunds.map((item) => item.refundDue));
  const dues = summarizeDues(calculateMonthlyDues(data.tenants, data.payments, month, data.readings, data.invoices).filter((item) => !business || item.businessType === business));
  return { collections, expenseTotal, depositCollections, depositRefunds, settlementRefunds,
    netCash: business ? null : roundMoney(collections + depositCollections - expenseTotal - depositRefunds - settlementRefunds),
    depositHeld: sum(data.accounts.filter((item) => forBusiness(data, item, business)).map((item) => item.held)),
    expected: roundMoney(dues.expected), paidForBills: roundMoney(dues.collected), billBalance: roundMoney(dues.balance),
    undated: data.payments.filter((item) => !isVoided(item) && !getRecordDay(item, ['createdAt', 'paidOn', 'date']) && forBusiness(data, item, business)).length
      + data.expenses.filter((item) => !isVoided(item) && !getRecordDay(item, ['date', 'expenseDate', 'createdAt'])).length };
}
export function occupancyRows(tenants: TenantRecord[], day = getDayKey(), settings = defaultBusinessSettings) {
  const now = new Date(`${day}T12:00:00`).getTime();
  const rows: Array<Array<string | number>> = getRoomOccupancy(tenants, now, settings).map((room) => [room.room, room.businessType || 'Shared PG / Hotel', room.status, room.capacity, room.occupants.length, room.availableBeds, room.occupants.map((item) => item.fullName || item.name || '').join('; ')]);
  const active = tenants.filter((tenant) => tenant.businessType === 'library' && ['active', 'checked in', 'occupied'].includes(String(tenant.status || 'active').toLowerCase()) && (!getStayStart(tenant) || getStayStart(tenant)!.getTime() <= now) && (!getStayCheckout(tenant) || getStayCheckout(tenant)!.getTime() > now));
  for (const seat of getSeatNumbers(settings)) {
    const occupants = active.filter((tenant) => getAllocationKey(tenant.room, 'library') === seat);
    rows.push([seat, 'library', occupants.length ? 'Full' : 'Open', 1, occupants.length, occupants.length ? 0 : 1, occupants.map((item) => item.fullName || item.name || '').join('; ')]);
  }
  return rows;
}
export function buildReportTable(kind: ReportKind, data: ReportData, month: string, business = '', day = getDayKey(), settings: BusinessSettings = defaultBusinessSettings): ReportTable {
  const notes = [`Billing month: ${month}. Current balances and inventory: ${day}.`, 'Collections use the date money was received, not the bill month. Deposits are liabilities; net cash movement is not profit.', ...(business ? ['Expenses are shared across the business. See the All businesses report for expenses and net cash movement.'] : [])];
  const dated = (record: Record<string, unknown>, fields: string[]) => inMonth(record, month, fields) && forBusiness(data, record, business);
  switch (kind) {
    case 'summary': {
      const summary = monthlyReportSummary(data, month, business);
      return { columns: ['Metric', 'Amount / count'], rows: [['Collections received', summary.collections], ['Bills for selected month', summary.expected], ['Payments applied to these bills', summary.paidForBills], ['Remaining for these bills', summary.billBalance], ['Deposit collections', summary.depositCollections], ['Deposit refunds', summary.depositRefunds], ['Checkout refunds paid', summary.settlementRefunds], ['Deposits held now', summary.depositHeld], ['Undated legacy financial records omitted', summary.undated], ...(!business ? [['Expenses', summary.expenseTotal], ['Net cash movement', summary.netCash!]] : [['Shared expenses (All businesses)', summary.expenseTotal]])], notes };
    }
    case 'collections': return { columns: ['Record', 'Received on', 'Bill month', 'Customer', 'Business', 'Amount', 'Method', 'Reference', 'Collector', 'Status'], rows: data.payments.filter((item) => dated(item, ['createdAt', 'paidOn', 'date'])).map((item) => [item.id, getRecordDay(item, ['createdAt', 'paidOn', 'date']), item.month || '', item.tenantName || item.name || '', typeFor(data, item), getPaymentAmount(item), item.paymentMode || 'Unclassified', item.reference || '', item.collectedBy || String(item.createdBy || ''), isVoided(item) ? 'Voided' : 'Recorded']), notes: [...notes, 'Voided rows remain in the export for review and are excluded from totals.'] };
    case 'expenses': return { columns: ['Record', 'Date', 'Title', 'Category', 'Amount', 'Method', 'Reference', 'Status'], rows: business ? [] : data.expenses.filter((item) => inMonth(item, month, ['date', 'expenseDate', 'createdAt'])).map((item) => [item.id, getRecordDay(item, ['date', 'expenseDate', 'createdAt']), item.title || item.name || '', item.category || '', getExpenseAmount(item), String(item.paymentMode || 'Unclassified'), String(item.reference || ''), isVoided(item) ? 'Voided' : 'Recorded']), notes };
    case 'deposits': return { columns: ['Record', 'Date', 'Customer', 'Movement', 'Amount', 'Before', 'After', 'Method', 'Reference', 'Reason'], rows: data.deposits.filter((item) => dated(item, ['createdAt'])).map((item) => [item.id, getRecordDay(item, ['createdAt']), item.tenantName, item.kind, item.amount, item.before, item.after, item.paymentMode, item.reference, item.note]), notes: [...notes, 'Application transfers the ledger to checkout; it is not a cash movement. Checkout refunds are listed in the summary.'] };
    case 'outstanding': return { columns: ['Customer', 'Phone', 'Allocation', 'Business', 'Balance now', 'Overdue now', 'Oldest due date', 'Days overdue', 'Age'], rows: outstandingRows(data.tenants, data.payments, data.readings, data.invoices, data.settlements, day).filter((item) => !business || item.tenant.businessType === business).map((item) => [item.tenant.fullName || item.tenant.name || '', item.tenant.phone || '', item.tenant.room || '', item.tenant.businessType || 'pg', item.balance, item.overdue, item.oldestDueDate, item.overdueDays, item.bucket]), notes };
    case 'occupancy': return { columns: ['Room / seat', 'Business', 'Status', 'Capacity', 'Occupied', 'Available', 'Customers'], rows: occupancyRows(data.tenants, day, settings).filter((row) => !business || row[1] === business || (business !== 'library' && row[1] === 'Shared PG / Hotel')), notes: [...notes, 'Rooms are shared by PG and Hotel. Vacant rooms are not two separate inventories. Reserved arrivals are available in Calendar.'] };
    case 'customers': return { columns: ['Customer ID', 'Name', 'Phone', 'Email', 'Business', 'Allocation', 'Status', 'Start', 'End', 'Fee'], rows: data.tenants.filter((item) => forBusiness(data, item, business)).map((item) => [item.id, item.fullName || item.name || '', item.phone || '', item.email || '', item.businessType || 'pg', item.room || '', item.archived ? 'Archived' : item.status || 'active', item.moveInDate || '', item.moveOutDate || '', toNumber(item.rent)]), notes: [...notes, 'Customer export omits government document numbers, ID photos and signed images.'] };
    case 'memberships': return { columns: ['Customer', 'Plan', 'Monthly fee', 'Start', 'End', 'Seat'], rows: data.memberships.filter((item) => forBusiness(data, item, business)).map((item) => [item.tenantName, item.planName, item.monthlyFee, item.start, item.end, item.seat]), notes: [...notes, 'Membership history includes all periods, not only the selected month.'] };
    case 'work': return { columns: ['Task', 'Kind', 'Due date', 'Allocation', 'Customer', 'Assigned to', 'Status', 'Outcome'], rows: data.work.filter((item) => item.dueDate.startsWith(month) && (!business || (item.customerId && forBusiness(data, item, business)))).map((item) => [item.title, item.kind, item.dueDate, item.allocation, item.customerName, item.assignedName || 'Unassigned', item.status, item.outcome]), notes };
  }
}
export function reportCsv(table: ReportTable) {
  return '\uFEFF' + [table.columns, ...table.rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}
export function reportHtml(table: ReportTable, business: BusinessSettings, title: string) {
  const escape = escapeDocumentText;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:16mm}body{font-family:Arial;font-size:10px;color:#111}h1{font-size:22px}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #ddd;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#eee}p{line-height:1.5}</style></head><body><h1>${escape(business.name)}</h1><p>${escape(business.address)} · ${escape(business.phone)}</p><h2>${escape(title)}</h2>${table.notes.map((note) => `<p>${escape(note)}</p>`).join('')}<table><thead><tr>${table.columns.map((column) => `<th>${escape(column)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></body></html>`;
}
export function agreementHtml(agreement: AgreementRecord) {
  const escape = escapeDocumentText;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial;padding:32px;font-size:14px}pre{white-space:pre-wrap;font-family:inherit;line-height:1.6}img{max-width:100%;page-break-before:always}</style></head><body><h1>${escape(agreement.businessName)}</h1><p>${escape(agreement.address)}</p><h2>Customer agreement</h2><p>Agreement: ${escape(agreement.id)} · ${escape(agreement.status)}</p><p>Customer: ${escape(agreement.tenantName)} · Allocation: ${escape(agreement.room)}</p><p>Period: ${escape(agreement.start)} – ${escape(agreement.end)} · Fee: Rs ${escape(agreement.fee)}</p><pre>${escape(agreement.terms)}</pre><p>Customer signature: ___________________</p><p>Business signature: ___________________</p>${agreement.status === 'Accepted' ? `<p>Accepted by ${escape(agreement.acceptanceName)}; recorded by ${escape(agreement.acceptedBy)} on ${escape(agreement.acceptedAt?.seconds ? new Date(agreement.acceptedAt.seconds * 1000).toLocaleString('en-IN') : '')}</p><img src="${escape(agreement.signedPhoto)}" alt="Signed agreement">` : ''}</body></html>`;
}
