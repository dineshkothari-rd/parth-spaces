import { readFileSync } from 'node:fs';
import test, { after } from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

const projectId = 'demo-no-project';
const testEnv = await initializeTestEnvironment({
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  projectId,
});

after(() => testEnv.cleanup());

async function seed() {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users', 'admin-1'), { accessStatus: 'active', role: 'admin' }),
      setDoc(doc(db, 'users', 'admin-2'), { accessStatus: 'suspended', role: 'admin' }),
      setDoc(doc(db, 'users', 'staff-1'), { accessStatus: 'active', role: 'staff' }),
      setDoc(doc(db, 'users', 'staff-2'), { accessStatus: 'suspended', role: 'staff' }),
      setDoc(doc(db, 'users', 'customer-1'), { accessStatus: 'active', customerId: 'tenant-1', role: 'customer' }),
      setDoc(doc(db, 'users', 'customer-2'), { accessStatus: 'active', customerId: 'tenant-2', role: 'customer' }),
      setDoc(doc(db, 'tenants', 'tenant-1'), { businessType: 'pg', name: 'Customer One', status: 'checked in' }),
      setDoc(doc(db, 'tenants', 'tenant-2'), { businessType: 'pg', name: 'Customer Two', status: 'checked in' }),
      setDoc(doc(db, 'tenants', 'tenant-3'), { businessType: 'pg', name: 'Customer Three', status: 'checked in' }),
      setDoc(doc(db, 'payments', 'payment-1'), { amountPaid: 500, tenantId: 'tenant-1' }),
      setDoc(doc(db, 'payments', 'payment-2'), { amountPaid: 700, tenantId: 'tenant-2' }),
      setDoc(doc(db, 'invoices', 'tenant-1_2026-08'), { tenantId: 'tenant-1', month: '2026-08', total: 1000 }),
      setDoc(doc(db, 'invoices', 'tenant-2_2026-08'), { tenantId: 'tenant-2', month: '2026-08', total: 1200 }),
      setDoc(doc(db, 'settlements', 'tenant-1'), { refundDue: 500, refundStatus: 'Due', tenantId: 'tenant-1' }),
      setDoc(doc(db, 'meterReadings', 'meter-1'), { currentReading: 100, tenantId: 'tenant-1' }),
      setDoc(doc(db, 'meterReadings', 'meter-2'), { currentReading: 200, tenantId: 'tenant-1' }),
      setDoc(doc(db, 'notices', 'notice-all'), { audience: 'all', message: 'All', title: 'All' }),
      setDoc(doc(db, 'notices', 'notice-one'), { audience: 'customer', message: 'One', tenantId: 'tenant-1', title: 'One' }),
      setDoc(doc(db, 'notices', 'notice-two'), { audience: 'customer', message: 'Two', tenantId: 'tenant-2', title: 'Two' }),
    ]);
  });
}

function signedIn(uid, role, extra = {}) {
  return testEnv.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true, role, ...extra }).firestore();
}

test('customer can only read and request help for their own account', async () => {
  await seed();
  const db = signedIn('customer-1', 'customer', { customerId: 'tenant-1' });

  await assertSucceeds(getDoc(doc(db, 'tenants', 'tenant-1')));
  await assertSucceeds(getDoc(doc(db, 'payments', 'payment-1')));
  await assertSucceeds(getDoc(doc(db, 'invoices', 'tenant-1_2026-08')));
  await assertSucceeds(getDoc(doc(db, 'settlements', 'tenant-1')));
  await assertSucceeds(getDoc(doc(db, 'meterReadings', 'meter-1')));
  await assertSucceeds(getDoc(doc(db, 'notices', 'notice-all')));
  await assertSucceeds(getDoc(doc(db, 'notices', 'notice-one')));
  await assertFails(getDoc(doc(db, 'tenants', 'tenant-2')));
  await assertFails(getDoc(doc(db, 'payments', 'payment-2')));
  await assertFails(getDoc(doc(db, 'invoices', 'tenant-2_2026-08')));
  await assertFails(getDoc(doc(db, 'settlements', 'tenant-2')));
  await assertFails(getDoc(doc(db, 'notices', 'notice-two')));
  await assertSucceeds(setDoc(doc(db, 'supportRequests', 'request-1'), {
    createdAt: serverTimestamp(), createdBy: 'customer-1', customerId: 'tenant-1', message: 'Please help', status: 'open', type: 'issue',
  }));
  await assertFails(setDoc(doc(db, 'supportRequests', 'request-2'), {
    createdAt: serverTimestamp(), createdBy: 'customer-1', customerId: 'tenant-2', message: 'Not mine', status: 'open', type: 'issue',
  }));
  await assertFails(setDoc(doc(db, 'supportRequests', 'request-3'), {
    createdAt: serverTimestamp(), createdBy: 'customer-1', customerId: 'tenant-1', message: 'x'.repeat(2001), status: 'open', type: 'issue',
  }));
  await assertFails(setDoc(doc(db, 'supportRequests', 'request-4'), {
    createdAt: serverTimestamp(), createdBy: 'customer-1', customerId: 'tenant-1', message: 'Please help', response: 'Already approved', status: 'open', type: 'issue',
  }));
  await assertFails(setDoc(doc(db, 'supportRequests', 'request-5'), {
    createdAt: '2026-09-21', createdBy: 'customer-1', customerId: 'tenant-1', message: 'Forged time', status: 'open', type: 'issue',
  }));
  await assertFails(updateDoc(doc(db, 'settlements', 'tenant-1'), {
    refundStatus: 'Paid', refundedAt: serverTimestamp(), refundedBy: 'customer-1',
  }));

  const staleClaimsDb = signedIn('customer-1', 'customer', { customerId: 'tenant-2' });
  await assertSucceeds(getDoc(doc(staleClaimsDb, 'tenants', 'tenant-1')));
  await assertFails(getDoc(doc(staleClaimsDb, 'tenants', 'tenant-2')));
});

test('staff can operate but cannot escalate roles or bypass lifecycle', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');

  await assertSucceeds(setDoc(doc(db, 'payments', 'payment-new'), {
    amountPaid: 500, balance: 500, businessType: 'pg', createdAt: serverTimestamp(), createdBy: 'staff-1', month: '2026-08', note: '', paidOn: '21/09/2026', status: 'Recorded', tenantId: 'tenant-2', tenantName: 'Customer Two', tenantRoom: 'Room 102', totalRent: 1000,
  }));
  const invoice = {
    baseAmount: 1000, businessType: 'pg', issuedAt: serverTimestamp(), issuedBy: 'staff-1', meterAmount: 100,
    month: '2026-09', status: 'Issued', tenantId: 'tenant-1', tenantName: 'Customer One', tenantRoom: 'Room 101', total: 1100,
  };
  await assertSucceeds(setDoc(doc(db, 'invoices', 'tenant-1_2026-09'), invoice));
  await assertFails(setDoc(doc(db, 'invoices', 'wrong-id'), invoice));
  await assertFails(updateDoc(doc(db, 'invoices', 'tenant-1_2026-08'), { total: 0 }));
  const settlement = {
    depositApplied: 1000, depositHeld: 1500, discount: 100, extraCharge: 100, finalBalance: 0,
    finalizedAt: serverTimestamp(), finalizedBy: 'staff-1', grossDue: 1000, ledgerBalance: 1000,
    month: '2026-09', paidAtSettlement: 0, paymentReceived: 0, refundDue: 500,
    refundStatus: 'Due', status: 'Final', tenantId: 'tenant-2', tenantName: 'Customer Two',
  };
  await assertFails(setDoc(doc(db, 'settlements', 'tenant-2'), settlement));
  await assertFails(setDoc(doc(db, 'settlements', 'wrong-id'), settlement));
  await assertFails(setDoc(doc(db, 'settlements', 'tenant-3'), { ...settlement, finalBalance: 999, tenantId: 'tenant-3' }));
  const checkout = writeBatch(db);
  checkout.update(doc(db, 'tenants', 'tenant-2'), { checkedOutAt: serverTimestamp(), status: 'checked out' });
  checkout.set(doc(db, 'settlements', 'tenant-2'), settlement);
  await assertSucceeds(checkout.commit());
  const balanceCheckout = writeBatch(db);
  balanceCheckout.update(doc(db, 'tenants', 'tenant-3'), { checkedOutAt: serverTimestamp(), status: 'checked out' });
  balanceCheckout.set(doc(db, 'settlements', 'tenant-3'), {
    ...settlement, depositApplied: 0, depositHeld: 0, discount: 0, extraCharge: 0,
    finalBalance: 500, grossDue: 500, ledgerBalance: 500, refundDue: 0,
    refundStatus: 'None', tenantId: 'tenant-3',
  });
  await assertSucceeds(balanceCheckout.commit());
  const balancePayment = {
    amountPaid: 200, balance: 300, businessType: 'pg', createdAt: serverTimestamp(),
    createdBy: 'staff-1', month: '2026-09', note: 'Settlement balance', paidOn: '22/09/2026',
    status: 'Recorded', tenantId: 'tenant-3', tenantName: 'Customer Three', tenantRoom: 'Room 103', totalRent: 500,
  };
  await assertFails(setDoc(doc(db, 'payments', 'wrong-settlement-note'), { ...balancePayment, note: '' }));
  await assertFails(setDoc(doc(db, 'payments', 'over-settlement'), { ...balancePayment, amountPaid: 600, balance: 0, totalRent: 600 }));
  await assertSucceeds(setDoc(doc(db, 'payments', 'balance-payment'), balancePayment));
  await assertSucceeds(updateDoc(doc(db, 'settlements', 'tenant-1'), {
    refundStatus: 'Paid', refundedAt: serverTimestamp(), refundedBy: 'staff-1',
  }));
  await assertFails(updateDoc(doc(db, 'settlements', 'tenant-1'), { finalBalance: 0 }));
  await assertFails(setDoc(doc(db, 'payments', 'payment-forged'), {
    amountPaid: 500, balance: 0, businessType: 'pg', createdAt: serverTimestamp(), createdBy: 'staff-1', month: 'not-a-month', note: '', paidOn: '21/09/2026', status: 'Recorded', tenantId: 'tenant-1', tenantName: 'Customer One', tenantRoom: 'Room 101', totalRent: 100,
  }));
  await assertFails(updateDoc(doc(db, 'tenants', 'tenant-1'), { status: 'checked out' }));
  await assertFails(updateDoc(doc(db, 'tenants', 'tenant-1'), { status: 'booked' }));
  await assertFails(updateDoc(doc(db, 'users', 'staff-1'), { role: 'admin' }));
  await assertSucceeds(setDoc(doc(db, 'allocationGuards', 'room-101'), {
    inventoryType: 'room', reservations: [{ businessType: 'pg', customerId: 'tenant-1', status: 'checked in' }], updatedAt: serverTimestamp(),
  }));

  const suspendedDb = signedIn('staff-2', 'staff');
  await assertFails(getDoc(doc(suspendedDb, 'tenants', 'tenant-1')));
});

test('admin manages access while unverified users are denied', async () => {
  await seed();
  const adminDb = signedIn('admin-1', 'admin');
  await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-1'), { accessStatus: 'suspended' }));
  await assertFails(deleteDoc(doc(adminDb, 'tenants', 'tenant-1')));

  const unverified = testEnv.authenticatedContext('staff-1', { email: 'staff@example.com', email_verified: false, role: 'staff' }).firestore();
  await assertFails(getDoc(doc(unverified, 'tenants', 'tenant-1')));

  const suspendedAdmin = signedIn('admin-2', 'admin');
  await assertFails(getDoc(doc(suspendedAdmin, 'tenants', 'tenant-1')));
});

test('audit records require the signed-in actor and server time', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');

  await assertSucceeds(setDoc(doc(db, 'auditEvents', 'valid'), {
    action: 'payment.created', actorUid: 'staff-1', createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, 'auditEvents', 'wrong-actor'), {
    action: 'payment.created', actorUid: 'admin-1', createdAt: serverTimestamp(),
  }));
  await assertFails(setDoc(doc(db, 'auditEvents', 'client-time'), {
    action: 'payment.created', actorUid: 'staff-1', createdAt: '2026-09-21',
  }));
  await assertFails(setDoc(doc(db, 'auditEvents', 'invented-action'), {
    action: 'admin.superpowers', actorUid: 'staff-1', createdAt: serverTimestamp(),
  }));
});

test('business writes reject oversized private data and invalid money records', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');

  await assertFails(setDoc(doc(db, 'tenants', 'oversized-proof'), {
    businessType: 'pg', customerPhoto: null, idProof: 'x'.repeat(260001), name: 'Customer', rent: 1000, room: 'Room 101', services: [], status: 'booked',
  }));
  await assertFails(setDoc(doc(db, 'expenses', 'huge-expense'), {
    amount: 10000001, category: 'maintenance', createdAt: serverTimestamp(), createdBy: 'staff-1', date: '2026-09-21', note: '', paymentMode: 'Cash', title: 'Invalid',
  }));
  await assertFails(setDoc(doc(db, 'meterReadings', 'oversized-photo'), {
    createdAt: serverTimestamp(), currentReading: 100, month: '2026-09', photo: 'x'.repeat(700001), photoSize: 700001, tenantId: 'tenant-1',
  }));
  await assertFails(updateDoc(doc(db, 'payments', 'payment-1'), {
    status: 'Voided', updatedAt: serverTimestamp(), voidedAt: serverTimestamp(), voidedBy: 'staff-1',
  }));
  await assertSucceeds(updateDoc(doc(db, 'payments', 'payment-2'), {
    status: 'Voided', updatedAt: serverTimestamp(), voidedAt: serverTimestamp(), voidedBy: 'staff-1',
  }));
  await assertSucceeds(updateDoc(doc(db, 'meterReadings', 'meter-1'), {
    status: 'Voided', voidedAt: serverTimestamp(), voidedBy: 'staff-1',
  }));
  await assertFails(updateDoc(doc(db, 'meterReadings', 'meter-2'), { currentReading: 50 }));
  await assertFails(deleteDoc(doc(db, 'meterReadings', 'meter-2')));
});

test('customers cannot read or change allocation guards', async () => {
  await seed();
  const db = signedIn('customer-1', 'customer', { customerId: 'tenant-1' });

  await assertFails(getDoc(doc(db, 'allocationGuards', 'room-101')));
  await assertFails(setDoc(doc(db, 'allocationGuards', 'room-101'), { inventoryType: 'room', reservations: [] }));
});

test('business settings are readable by approved accounts and editable only by admins', async () => {
  await seed();
  const settings = {
    name: 'Test property', address: 'Test address', phone: '', roomStart: 101, roomCount: 14, pgCapacity: 2,
    seatPrefix: 'A', seatCount: 100, defaultPgRent: 5000, defaultHotelCharge: 1000, defaultLibraryFee: 500,
    meterRate: 8.5, updatedAt: serverTimestamp(), updatedBy: 'admin-1',
  };
  const adminDb = signedIn('admin-1', 'admin');
  await assertSucceeds(setDoc(doc(adminDb, 'settings', 'business'), settings));
  await assertSucceeds(getDoc(doc(signedIn('staff-1', 'staff'), 'settings', 'business')));
  await assertSucceeds(getDoc(doc(signedIn('customer-1', 'customer'), 'settings', 'business')));
  await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'settings', 'business')));
  await assertFails(getDoc(doc(signedIn('staff-2', 'staff'), 'settings', 'business')));
  await assertFails(updateDoc(doc(signedIn('staff-1', 'staff'), 'settings', 'business'), { name: 'Changed' }));
  await assertFails(updateDoc(doc(signedIn('customer-1', 'customer'), 'settings', 'business'), { roomCount: 100 }));
  await assertFails(updateDoc(doc(adminDb, 'settings', 'business'), { pgCapacity: 0 }));
  await assertFails(updateDoc(doc(adminDb, 'settings', 'business'), { roomCount: 1.5 }));
  await assertFails(updateDoc(doc(adminDb, 'settings', 'business'), { roomStart: 9999, roomCount: 2 }));
  await assertFails(updateDoc(doc(adminDb, 'settings', 'business'), { meterRate: -1 }));
  await assertFails(updateDoc(doc(adminDb, 'settings', 'business'), { extra: 'unexpected' }));
  await assertFails(deleteDoc(doc(adminDb, 'settings', 'business')));
});

test('staff permissions block direct writes without relying on hidden app controls', async () => {
  await seed();
  const adminDb = signedIn('admin-1', 'admin');
  const staffDb = signedIn('staff-1', 'staff');
  await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-1'), { permissions: { customers: false, money: false, operations: false } }));
  await assertSucceeds(getDoc(doc(staffDb, 'tenants', 'tenant-1')));
  await assertFails(updateDoc(doc(staffDb, 'tenants', 'tenant-1'), { name: 'Changed' }));
  await assertFails(setDoc(doc(staffDb, 'allocationGuards', 'room-101'), { inventoryType: 'room', reservations: [], updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(staffDb, 'payments', 'blocked'), {
    amountPaid: 100, balance: 900, businessType: 'pg', createdAt: serverTimestamp(), createdBy: 'staff-1',
    month: '2026-09', note: '', paidOn: '2026-09-21', status: 'Recorded', tenantId: 'tenant-2', tenantName: '', tenantRoom: '', totalRent: 1000,
  }));
  await assertFails(setDoc(doc(staffDb, 'expenses', 'blocked'), {
    amount: 100, category: 'maintenance', createdAt: serverTimestamp(), createdBy: 'staff-1', date: '2026-09-21', note: '', paymentMode: 'Cash', title: 'Repair',
  }));
  await assertFails(setDoc(doc(staffDb, 'notices', 'blocked'), { title: 'Notice', message: 'Message', audience: 'all' }));
  await assertFails(setDoc(doc(staffDb, 'enquiries', 'blocked'), { name: 'New lead' }));
  await assertFails(updateDoc(doc(staffDb, 'users', 'staff-1'), { 'permissions.money': true }));
  await assertFails(updateDoc(doc(adminDb, 'users', 'staff-1'), { permissions: { money: 'yes' } }));
  await assertFails(updateDoc(doc(adminDb, 'users', 'staff-1'), { permissions: { unexpected: true } }));
  await assertSucceeds(updateDoc(doc(adminDb, 'users', 'staff-1'), { 'permissions.operations': true }));
  await assertSucceeds(setDoc(doc(staffDb, 'enquiries', 'allowed'), { name: 'New lead' }));
  await assertFails(updateDoc(doc(staffDb, 'tenants', 'tenant-1'), { name: 'Still blocked' }));
});

test('deposit movements require an atomic matching ledger, cannot overspend and remain immutable', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');
  const movement = (id, kind, amount, before, after) => ({ tenantId: 'tenant-3', tenantName: 'Three', kind, amount, before, after, paymentMode: 'Cash', reference: '', note: 'Deposit', createdAt: serverTimestamp(), createdBy: 'staff-1' });
  const account = (id, held) => ({ tenantId: 'tenant-3', held, eventId: id, updatedAt: serverTimestamp(), updatedBy: 'staff-1' });
  await assertFails(setDoc(doc(db, 'depositEvents', 'alone'), movement('alone', 'collection', 500, 0, 500)));
  await assertFails(setDoc(doc(db, 'depositAccounts', 'tenant-3'), account('missing', 500)));
  const collect = writeBatch(db);
  collect.set(doc(db, 'depositAccounts', 'tenant-3'), account('collect', 500));
  collect.set(doc(db, 'depositEvents', 'collect'), movement('collect', 'collection', 500, 0, 500));
  await assertSucceeds(collect.commit());
  const stale = writeBatch(db);
  stale.set(doc(db, 'depositAccounts', 'tenant-3'), account('stale', 200));
  stale.set(doc(db, 'depositEvents', 'stale'), movement('stale', 'refund', 300, 0, 200));
  await assertFails(stale.commit());
  const refund = writeBatch(db);
  refund.set(doc(db, 'depositAccounts', 'tenant-3'), account('refund', 200));
  refund.set(doc(db, 'depositEvents', 'refund'), movement('refund', 'refund', 300, 500, 200));
  await assertSucceeds(refund.commit());
  const overspend = writeBatch(db);
  overspend.set(doc(db, 'depositAccounts', 'tenant-3'), account('overspend', -1));
  overspend.set(doc(db, 'depositEvents', 'overspend'), movement('overspend', 'deduction', 201, 200, -1));
  await assertFails(overspend.commit());
  await assertFails(updateDoc(doc(db, 'depositEvents', 'collect'), { amount: 100 }));
  await assertFails(deleteDoc(doc(db, 'depositAccounts', 'tenant-3')));
  const customer = signedIn('customer-1', 'customer');
  await assertFails(getDoc(doc(customer, 'depositAccounts', 'tenant-3')));
});

test('adjusted bills, reconciliation and manual payment references are validated', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');
  const bill = { tenantId: 'tenant-3', tenantName: 'Three', tenantRoom: 'A01', businessType: 'library', month: '2026-10', baseAmount: 500, meterAmount: 0, extraCharge: 100, discount: 50, total: 550, dueDate: '2026-10-10', note: 'Credit and extra charge', status: 'Issued', issuedAt: serverTimestamp(), issuedBy: 'staff-1' };
  await assertFails(setDoc(doc(db, 'invoices', 'tenant-3_2026-10'), { ...bill, total: 500 }));
  await assertSucceeds(setDoc(doc(db, 'invoices', 'tenant-3_2026-10'), bill));
  await assertFails(updateDoc(doc(db, 'invoices', 'tenant-3_2026-10'), { discount: 100 }));
  const payment = { amountPaid: 100, balance: 450, businessType: 'library', createdAt: serverTimestamp(), createdBy: 'staff-1', collectedBy: 'staff-1', month: '2026-10', note: '', paidOn: '2026-10-06', status: 'Recorded', tenantId: 'tenant-3', tenantName: 'Three', tenantRoom: 'A01', totalRent: 550, paymentMode: 'UPI', reference: '' };
  await assertFails(setDoc(doc(db, 'payments', 'upi'), payment));
  await assertSucceeds(setDoc(doc(db, 'payments', 'upi'), { ...payment, reference: 'UTR-123' }));
  await assertFails(setDoc(doc(db, 'payments', 'forged'), { ...payment, reference: 'UTR', collectedBy: 'admin-1' }));
  const check = { day: '2026-10-06', cashOpening: 50, bankOpening: 0, cashMovement: 100, bankMovement: 0, cashExpected: 150, bankExpected: 0, cashActual: 140, bankActual: 0, cashDifference: -10, bankDifference: 0, note: 'Short', createdAt: serverTimestamp(), createdBy: 'staff-1' };
  await assertSucceeds(setDoc(doc(db, 'reconciliations', 'day'), check));
  await assertFails(setDoc(doc(db, 'reconciliations', 'bad'), { ...check, cashDifference: 0 }));
  await assertFails(updateDoc(doc(db, 'reconciliations', 'day'), { cashActual: 150 }));
});

test('membership plans and renewals preserve price snapshots, prevent overlap and require both permissions', async () => {
  await seed();
  const admin = signedIn('admin-1', 'admin');
  const staff = signedIn('staff-1', 'staff');
  const plan = { name: 'Annual', months: 12, monthlyFee: 700, active: true, createdAt: serverTimestamp(), createdBy: 'admin-1' };
  await assertFails(setDoc(doc(staff, 'membershipPlans', 'annual'), { ...plan, createdBy: 'staff-1' }));
  await assertSucceeds(setDoc(doc(admin, 'membershipPlans', 'annual'), plan));
  await assertFails(updateDoc(doc(admin, 'membershipPlans', 'annual'), { monthlyFee: 1 }));
  await testEnv.withSecurityRulesDisabled(async (context) => { await updateDoc(doc(context.firestore(), 'tenants', 'tenant-3'), { businessType: 'library', room: 'A01', rent: 500, moveInDate: '2026-10-01' }); });
  const member = { tenantId: 'tenant-3', tenantName: 'Three', planId: 'annual', planName: 'Annual', monthlyFee: 700, start: '2026-10-01', end: '2027-09-30', seat: 'A01', invoiceMonths: ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06', '2027-07', '2027-08', '2027-09'], createdAt: serverTimestamp(), createdBy: 'staff-1' };
  await assertFails(setDoc(doc(staff, 'memberships', 'membership'), member));
  const renewal = writeBatch(staff);
  renewal.set(doc(staff, 'memberships', 'membership'), member);
  renewal.update(doc(staff, 'tenants', 'tenant-3'), { membershipManaged: true, membershipStart: '2026-10-01', membershipEnd: member.end, membershipId: 'membership', moveOutDate: member.end });
  for (const month of member.invoiceMonths) renewal.set(doc(staff, 'invoices', `tenant-3_${month}`), { membershipId: 'membership', tenantId: 'tenant-3', tenantName: 'Three', tenantRoom: 'A01', businessType: 'library', month, baseAmount: 700, meterAmount: 0, total: 700, dueDate: `${month}-10`, status: 'Issued', issuedAt: serverTimestamp(), issuedBy: 'staff-1' });
  await assertSucceeds(renewal.commit());
  const overlap = writeBatch(staff);
  overlap.set(doc(staff, 'memberships', 'overlap'), member);
  overlap.update(doc(staff, 'tenants', 'tenant-3'), { membershipId: 'overlap' });
  await assertFails(overlap.commit());
  await assertFails(updateDoc(doc(staff, 'memberships', 'membership'), { end: '2028-09-30' }));
  await assertFails(updateDoc(doc(staff, 'tenants', 'tenant-3'), { membershipManaged: false }));
  await assertSucceeds(updateDoc(doc(admin, 'membershipPlans', 'annual'), { active: false }));
  await assertFails(updateDoc(doc(admin, 'membershipPlans', 'annual'), { active: true }));
});

test('agreement acceptance requires signed evidence and keeps historical terms immutable', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');
  const agreement = { tenantId: 'tenant-1', tenantName: 'One', businessName: 'Kothari', address: '', room: '101', fee: 500, start: '2026-10-01', end: '', terms: 'Approved terms', status: 'Draft', createdAt: serverTimestamp(), createdBy: 'staff-1' };
  await assertSucceeds(setDoc(doc(db, 'agreements', 'version-1'), agreement));
  await assertFails(updateDoc(doc(db, 'agreements', 'version-1'), { terms: 'Rewritten' }));
  const acceptance = { status: 'Accepted', acceptanceName: 'One', acceptedAt: serverTimestamp(), acceptedBy: 'staff-1', signedPhoto: 'data:image/jpeg;base64,c2lnbmVk' };
  await assertFails(updateDoc(doc(db, 'agreements', 'version-1'), { ...acceptance, signedPhoto: '' }));
  await assertSucceeds(updateDoc(doc(db, 'agreements', 'version-1'), acceptance));
  await assertFails(updateDoc(doc(db, 'agreements', 'version-1'), { acceptanceName: 'Changed' }));
  await assertSucceeds(getDoc(doc(signedIn('customer-1', 'customer'), 'agreements', 'version-1')));
  await assertFails(getDoc(doc(signedIn('customer-2', 'customer'), 'agreements', 'version-1')));
  await assertFails(setDoc(doc(signedIn('customer-1', 'customer'), 'agreements', 'fake'), { ...agreement, createdBy: 'customer-1' }));
});

test('checkout atomically applies the recorded deposit and reserves any refund', async () => {
  await seed();
  const db = signedIn('staff-1', 'staff');
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'depositAccounts', 'tenant-3'), { tenantId: 'tenant-3', held: 500, eventId: 'legacy' });
  });
  const settlement = { tenantId: 'tenant-3', tenantName: 'Three', depositHeld: 500, depositApplied: 300, discount: 0, extraCharge: 0, finalBalance: 0, finalizedAt: serverTimestamp(), finalizedBy: 'staff-1', grossDue: 300, ledgerBalance: 300, month: '2026-10', paidAtSettlement: 0, paymentReceived: 0, refundDue: 200, refundStatus: 'Due', status: 'Final' };
  const missing = writeBatch(db);
  missing.update(doc(db, 'tenants', 'tenant-3'), { status: 'checked out', checkedOutAt: serverTimestamp() });
  missing.set(doc(db, 'settlements', 'tenant-3'), settlement);
  await assertFails(missing.commit());
  const checkout = writeBatch(db);
  checkout.update(doc(db, 'tenants', 'tenant-3'), { status: 'checked out', checkedOutAt: serverTimestamp() });
  checkout.set(doc(db, 'settlements', 'tenant-3'), settlement);
  checkout.set(doc(db, 'depositAccounts', 'tenant-3'), { tenantId: 'tenant-3', held: 0, eventId: 'apply', updatedAt: serverTimestamp(), updatedBy: 'staff-1' });
  checkout.set(doc(db, 'depositEvents', 'apply'), { tenantId: 'tenant-3', tenantName: 'Three', kind: 'application', amount: 500, before: 500, after: 0, paymentMode: 'Cash', reference: '', note: 'Checkout', createdAt: serverTimestamp(), createdBy: 'staff-1' });
  await assertSucceeds(checkout.commit());
  await assertFails(updateDoc(doc(db, 'settlements', 'tenant-3'), { refundStatus: 'Paid', refundedAt: serverTimestamp(), refundedBy: 'staff-1', refundMode: 'Bank', refundReference: '' }));
  await assertSucceeds(updateDoc(doc(db, 'settlements', 'tenant-3'), { refundStatus: 'Paid', refundedAt: serverTimestamp(), refundedBy: 'staff-1', refundMode: 'Bank', refundReference: 'UTR-123' }));
});

test('unverified customer cannot activate tenant access even when their profile is already active', async () => {
  await seed();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'tenants', 'tenant-1'), { accessStatus: 'invited' });
  });
  const changes = { accessStatus: 'active', activatedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertFails(updateDoc(doc(signedIn('customer-1', 'customer', { email_verified: false }), 'tenants', 'tenant-1'), changes));
  await assertSucceeds(updateDoc(doc(signedIn('customer-1', 'customer'), 'tenants', 'tenant-1'), changes));
});

test('unknown accounts cannot use claimed roles to read records or create their own approval', async () => {
  await seed();
  for (const role of ['admin', 'staff', 'customer']) {
    const db = signedIn('unapproved', role, { customerId: 'tenant-1' });
    await assertFails(getDoc(doc(db, 'tenants', 'tenant-1')));
    await assertFails(setDoc(doc(db, 'users', 'unapproved'), { accessStatus: 'active', role: 'admin' }));
  }
});
