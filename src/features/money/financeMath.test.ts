import assert from 'node:assert/strict';
import test from 'node:test';
import { dailyReconciliation, parseAmount, validatePaymentDetails } from './financeMath';
import { escapeDocumentText, membershipPeriod, membershipStatus } from '../customers/membershipMath';
import { calculateMonthlyDues, calculateOutstandingBalance, calculateSettlement } from '../operations/operationsMath';
import type { DepositEvent, InvoiceRecord, TenantRecord } from '../../shared/types/records';

test('money input rejects invalid precision, sign, overflow and non-cash payments without reference', () => {
  assert.equal(parseAmount('12.35'), 12.35);
  assert.equal(parseAmount('0', true), 0);
  for (const value of ['', '0', '-1', '0.001', 'Infinity', '1e3', '10000001']) assert.throws(() => parseAmount(value));
  assert.doesNotThrow(() => validatePaymentDetails('Cash', ''));
  assert.doesNotThrow(() => validatePaymentDetails('UPI', 'bank-reference'));
  assert.throws(() => validatePaymentDetails('UPI', ''));
  assert.throws(() => validatePaymentDetails('Other', 'reference'));
});

test('reconciliation separates income, deposit liability, non-cash deductions and actual refunds', () => {
  const timestamp = { seconds: new Date('2026-10-06T12:00:00').getTime() / 1000 };
  const event = (kind: DepositEvent['kind'], amount: number) => ({ id: kind, tenantId: 'a', tenantName: 'A', kind, amount, before: 100, after: 0, paymentMode: 'Cash', reference: '', note: 'test', createdAt: timestamp, createdBy: 'staff' });
  const totals = dailyReconciliation([
    { id: '1', amountPaid: 50.10, paymentMode: 'Cash', createdAt: timestamp },
    { id: '2', amountPaid: 70, paymentMode: 'UPI', createdAt: timestamp },
    { id: '3', amountPaid: 20, createdAt: timestamp },
    { id: '4', amountPaid: 999, status: 'Voided', createdAt: timestamp },
  ], [{ id: 'expense', amount: 10, paymentMode: 'Cash', date: '2026-10-06' }], [event('collection', 100), event('deduction', 20), event('refund', 30), event('application', 50)], [
    { id: 'settlement', refundStatus: 'Paid', refundDue: 40, refundMode: 'UPI', refundedAt: timestamp } as never,
  ], '2026-10-06');
  assert.deepEqual(totals, { Cash: 110.10, UPI: 30, Bank: 0, Unclassified: 20 });
  assert.deepEqual(dailyReconciliation([], [], [event('collection', 10)], [], '2026-10-07'), { Cash: 0, UPI: 0, Bank: 0, Unclassified: 0 });
});

test('membership periods cover calendar months, leap February and year boundaries', () => {
  assert.deepEqual(membershipPeriod('2028-02-01', 1), { start: '2028-02-01', end: '2028-02-29', invoiceMonths: ['2028-02'] });
  assert.deepEqual(membershipPeriod('2026-12-01', 2), { start: '2026-12-01', end: '2027-01-31', invoiceMonths: ['2026-12', '2027-01'] });
  for (const [start, duration] of [['2026-13-01', 1], ['2026-02-30', 1], ['2026-02-02', 1], ['2026-02-01', 0], ['2026-02-01', 13]] as const) assert.throws(() => membershipPeriod(start, duration));
  assert.equal(membershipStatus('2026-10-05', '2026-10-06'), 'Expired');
  assert.equal(membershipStatus('2026-10-13', '2026-10-06'), 'Expiring soon');
  assert.equal(membershipStatus('2026-10-31', '2026-10-06'), 'Active');
  assert.equal(escapeDocumentText('<script>"A&B"</script>'), '&lt;script&gt;&quot;A&amp;B&quot;&lt;/script&gt;');
});

test('membership billing preserves legacy months, saved plan prices and gaps; invoice credits affect balance', () => {
  const tenant: TenantRecord = { id: 'a', name: 'A', status: 'active', businessType: 'library', moveInDate: '2026-08-10', moveOutDate: '2026-12-31', rent: 500, membershipManaged: true, membershipStart: '2026-10-01' };
  const invoice: InvoiceRecord = { id: 'a_2026-10', tenantId: 'a', tenantName: 'A', tenantRoom: 'A01', baseAmount: 700, meterAmount: 0, total: 700, businessType: 'library', month: '2026-10', status: 'Issued', issuedBy: 'admin' };
  assert.equal(calculateMonthlyDues([tenant], [], '2026-09')[0].rent, 500);
  assert.equal(calculateMonthlyDues([tenant], [], '2026-10', [], [invoice])[0].rent, 700);
  assert.equal(calculateMonthlyDues([tenant], [], '2026-11')[0].rent, 0);
  assert.equal(calculateOutstandingBalance(tenant, [], [], '2026-11', [invoice]), 1700);
  assert.equal(calculateMonthlyDues([tenant], [], '2027-01').length, 0);
  const adjusted = { ...invoice, baseAmount: 500, extraCharge: 100, discount: 50, total: 550, dueDate: '2026-10-10' };
  const due = calculateMonthlyDues([tenant], [{ id: 'p', tenantId: 'a', month: '2026-10', amountPaid: 200 }], '2026-10', [], [adjusted])[0];
  assert.equal(due.balance, 350); assert.equal(due.extraCharge, 100); assert.equal(due.discount, 50); assert.equal(due.dueDate, '2026-10-10');
});

test('settlement amounts round to paise', () => {
  const result = calculateSettlement({ ledgerBalance: 17.1, extraCharge: 0, discount: 5.2, depositHeld: 10.1, paymentReceived: 1.8 });
  assert.equal(result.grossDue, 11.9); assert.equal(result.finalBalance, 0);
});
