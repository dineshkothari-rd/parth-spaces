import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error Node runs this check with native TypeScript stripping.
import { buildDuesCsv, calculateMonthlyDues, calculateOutstandingBalance, calculatePaymentResult, calculateSettlement, getDailyStayActions, getMeterChargeForMonth, getMeterReadingCandidates, getMeterReadingCharges, getRemainingPaymentBalance } from './operationsMath.ts';

test('meter charges retain their recorded rate and round decimal charges to paise', () => {
  const readings = [
    { id: 'baseline', tenantId: 'tenant-1', currentReading: 100, previousReading: 100, readingType: 'check-in' as const, ratePerUnit: 10 },
    { id: 'decimal', tenantId: 'tenant-1', currentReading: 100.3, previousReading: 100, ratePerUnit: 8.55 },
    { id: 'free', tenantId: 'tenant-1', currentReading: 110, previousReading: 100.3, ratePerUnit: 0, billAmount: 100, unitsConsumed: 9.7 },
  ];
  const charges = getMeterReadingCharges(readings, 'tenant-1');
  assert.equal(charges.decimal.amount, 2.56);
  assert.equal(charges.free.amount, 0);
});

test('reservation to checkout keeps an accurate customer ledger', () => {
  const reservation = { id: 'tenant-1', businessType: 'pg', moveInDate: '2026-08-10', rent: 3000, status: 'booked' };
  assert.deepEqual(calculateMonthlyDues([reservation], [], '2026-08'), []);

  const checkedIn = { ...reservation, status: 'checked in' };
  const readings = [{ id: 'meter-1', billAmount: 400, month: '2026-08', tenantId: 'tenant-1' }];
  const payments = [
    { id: 'payment-1', amountPaid: 1000, month: '2026-08', tenantId: 'tenant-1' },
    { id: 'payment-2', amountPaid: 500, month: '2026-08', tenantId: 'tenant-1' },
  ];
  assert.deepEqual(calculateMonthlyDues([checkedIn], payments, '2026-08', readings)[0], {
    extraCharge: 0, discount: 0, dueDate: '2026-08-10', note: '',
    baseAmount: 3000,
    balance: 1900,
    businessType: 'pg',
    id: 'tenant-1-2026-08',
    meterAmount: 400,
    month: '2026-08',
    paid: 1500,
    phone: '',
    rent: 3400,
    status: 'Partial',
    tenantId: 'tenant-1',
    tenantName: 'Unnamed',
    tenantRoom: '',
  });

  const checkedOut = { ...checkedIn, moveOutDate: '2026-08-20', status: 'checked out' };
  assert.equal(calculateMonthlyDues([checkedOut], payments, '2026-08', readings)[0]?.balance, 1900);
  assert.equal(calculateOutstandingBalance(checkedOut, payments, readings, '2026-10'), 1900);
  assert.deepEqual(calculateMonthlyDues([checkedOut], payments, '2026-09', readings), []);
});

test('second partial payment closes the balance used on its receipt', () => {
  const previous = [{ id: 'first', amountPaid: 500, month: '2026-08', tenantId: 'tenant-1' }];
  assert.deepEqual(calculatePaymentResult(1000, previous, 'tenant-1', '2026-08', 500), { balance: 0, status: 'Paid' });
  assert.equal(getRemainingPaymentBalance(1000, previous, 'tenant-1', '2026-08'), 500);
});

test('issued invoices freeze historical charges and export safely', () => {
  const tenant = { id: 'tenant-1', name: 'Kumar, Dinesh', rent: 9000, status: 'active' };
  const invoices = [{
    id: 'tenant-1_2026-08', baseAmount: 3000, businessType: 'pg', issuedBy: 'admin', meterAmount: 400,
    month: '2026-08', status: 'Issued' as const, tenantId: 'tenant-1', tenantName: 'Kumar, Dinesh', tenantRoom: '101', total: 3400,
  }];
  const due = calculateMonthlyDues([tenant], [], '2026-08', [], invoices)[0];

  assert.equal(due.rent, 3400);
  assert.match(buildDuesCsv([due]), /"Kumar, Dinesh"/);
});

test('checkout settlement applies deposit, discount, payment and refund exactly once', () => {
  assert.deepEqual(calculateSettlement({
    depositHeld: 5000,
    discount: 500,
    extraCharge: 1000,
    ledgerBalance: 3000,
    paymentReceived: 0,
  }), {
    depositApplied: 3500,
    finalBalance: 0,
    grossDue: 3500,
    paymentReceived: 0,
    refundDue: 1500,
  });

  const tenant = { id: 'tenant-1', moveInDate: '2026-09-01', moveOutDate: '2026-09-21', rent: 3000, status: 'checked out' };
  const payments = [
    { id: 'before', amountPaid: 1000, month: '2026-09', tenantId: 'tenant-1' },
    { id: 'after', amountPaid: 200, month: '2026-09', tenantId: 'tenant-1' },
  ];
  const settlement = [{
    id: 'tenant-1', depositApplied: 0, depositHeld: 0, discount: 0, extraCharge: 0,
    finalBalance: 500, finalizedBy: 'admin', grossDue: 500, ledgerBalance: 500,
    month: '2026-09', paidAtSettlement: 1000, paymentReceived: 0, refundDue: 0,
    refundStatus: 'None' as const, status: 'Final' as const, tenantId: 'tenant-1', tenantName: 'Customer',
  }];
  assert.equal(calculateOutstandingBalance(tenant, payments, [], '2026-09', [], settlement), 300);
});

test('overlapping checkout reading does not bill consumed units twice', () => {
  const readings = [
    { id: 'check-in', currentReading: 100, month: '2026-08', previousReading: 100, ratePerUnit: 10, tenantId: 'tenant-1', unitsConsumed: 0 },
    { id: 'manual', billAmount: 500, currentReading: 150, month: '2026-08', previousReading: 100, ratePerUnit: 10, tenantId: 'tenant-1', unitsConsumed: 50 },
    { id: 'check-out', billAmount: 1000, currentReading: 200, month: '2026-09', previousReading: 100, ratePerUnit: 10, tenantId: 'tenant-1', unitsConsumed: 100 },
  ];

  assert.equal(getMeterChargeForMonth(readings, 'tenant-1', '2026-08'), 500);
  assert.equal(getMeterChargeForMonth(readings, 'tenant-1', '2026-09'), 500);
});

test('voided meter readings stay in history without affecting bills', () => {
  const readings = [
    { id: 'baseline', currentReading: 100, month: '2026-08', previousReading: 100, ratePerUnit: 10, tenantId: 'tenant-1' },
    { id: 'mistake', currentReading: 500, month: '2026-08', previousReading: 100, ratePerUnit: 10, status: 'Voided', tenantId: 'tenant-1' },
    { id: 'correct', currentReading: 150, month: '2026-08', previousReading: 100, ratePerUnit: 10, tenantId: 'tenant-1' },
  ];

  assert.equal(getMeterChargeForMonth(readings, 'tenant-1', '2026-08'), 500);
  assert.equal(getMeterReadingCharges(readings, 'tenant-1').mistake, undefined);
});

test('first absolute meter reading is a baseline, not consumed units', () => {
  const readings = [
    { id: 'baseline', billAmount: 859420, currentReading: 85942, month: '2026-08', previousReading: 0, ratePerUnit: 10, tenantId: 'tenant-1', unitsConsumed: 85942 },
  ];

  assert.equal(getMeterChargeForMonth(readings, 'tenant-1', '2026-08'), 0);
  assert.deepEqual(getMeterReadingCharges(readings, 'tenant-1').baseline, { amount: 0, units: 0 });
});

test('implausible OCR jump is held for review instead of entering financial totals', () => {
  const readings = [
    { id: 'check-in', currentReading: 2019, month: '2026-08', previousReading: 0, ratePerUnit: 10, readingType: 'check-in' as const, tenantId: 'tenant-1' },
    { id: 'bad-ocr', currentReading: 82880, month: '2026-08', previousReading: 2019, ratePerUnit: 10, tenantId: 'tenant-1' },
  ];

  assert.deepEqual(getMeterReadingCharges(readings, 'tenant-1')['bad-ocr'], { amount: 0, needsReview: true, units: 0 });
  assert.equal(getMeterChargeForMonth(readings, 'tenant-1', '2026-08'), 0);
});

test('OCR suggestions reject unrelated numbers and keep plausible meter readings', () => {
  assert.deepEqual(getMeterReadingCandidates('240V 50Hz display 04882 serial 823880', 2019), [4882]);
});

test('a hotel stay is charged once in its check-in month', () => {
  const hotelStay = { id: 'hotel-1', businessType: 'hotel', moveInDate: '2026-08-30', moveOutDate: '2026-09-02', rent: 5000, status: 'checked out' };
  assert.equal(calculateMonthlyDues([hotelStay], [], '2026-08')[0]?.rent, 5000);
  assert.deepEqual(calculateMonthlyDues([hotelStay], [], '2026-09'), []);
});

test('daily work highlights due stays and incomplete active profiles', () => {
  const complete = { documentId: 'ID-1', idProof: 'photo', phone: '9999999999', room: '101' };
  const tenants = [
    { ...complete, id: 'arrival', moveInDate: '2026-08-23', status: 'booked' },
    { ...complete, id: 'future', moveInDate: '2026-08-24', status: 'booked' },
    { ...complete, id: 'departure', moveInDate: '2026-08-01', moveOutDate: '2026-08-22', status: 'checked in' },
    { id: 'incomplete', moveInDate: '2026-08-01', status: 'active' },
    { id: 'done', moveInDate: '2026-07-01', moveOutDate: '2026-08-01', status: 'checked out' },
  ];

  assert.deepEqual(getDailyStayActions(tenants, '2026-08-23'), {
    arrivals: 1,
    departures: 1,
    incompleteProfiles: 1,
  });
});
