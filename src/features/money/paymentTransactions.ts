import { collection, doc, getDocFromServer, getDocsFromServer, query, runTransaction, serverTimestamp, where, type Firestore, type Transaction } from 'firebase/firestore';
import type { PaymentRecord } from '../../shared/types/records';
import { getCollectedTotal, getPaymentAmount, isVoided } from '../operations/operationsMath';
import { roundMoney } from '../../shared/utils/money';
import { parseAmount, validatePaymentDetails } from './financeMath';

export type PaymentDraft = {
  amountPaid: number; paymentMode: string; reference: string; balance: number;
  businessType: string; month: string; note: string; paidOn: string; status: string;
  tenantId: string; tenantName: string; tenantRoom: string; totalRent: number;
};

export async function recordMonthlyPayment(db: Firestore, payload: PaymentDraft, actorUid: string, paymentId = doc(collection(db, 'payments')).id) {
  parseAmount(String(payload.amountPaid));
  validatePaymentDetails(payload.paymentMode, payload.reference);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(payload.month)) throw new Error('Choose a valid billing month.');
  const accountRef = doc(db, 'paymentAccounts', `${payload.tenantId}_${payload.month}`);
  const paymentRef = doc(db, 'payments', paymentId);
  // ponytail: trusted money staff seed legacy totals; use a server migration before untrusted operators are admitted.
  // Read server records rather than a possibly stale realtime list.
  const existingAccount = await getDocFromServer(accountRef);
  const legacyQueries = existingAccount.exists() ? [] : await Promise.all(
    ['tenantId', 'userId'].map(field => getDocsFromServer(query(collection(db, 'payments'), where(field, '==', payload.tenantId)))),
  );
  const legacy = [...new Map(legacyQueries.flatMap(result => result.docs).map(item => [item.id, item])).values()]
    .filter(item => item.data().month === payload.month);
  return runTransaction(db, async transaction => {
    const existingPayment = await transaction.get(paymentRef);
    if (existingPayment.exists()) {
      const saved = existingPayment.data();
      if (['tenantId', 'month', 'amountPaid', 'paymentMode', 'reference', 'note'].some(field => saved[field] !== payload[field as keyof PaymentDraft]) || isVoided({ id: paymentRef.id, ...saved } as PaymentRecord)) throw new Error('This payment attempt already exists with different details. Reopen the form.');
      return { id: paymentRef.id, ...saved } as PaymentRecord;
    }
    const account = await transaction.get(accountRef);
    const invoice = await transaction.get(doc(db, 'invoices', accountRef.id));
    const tenant = await transaction.get(doc(db, 'tenants', payload.tenantId));
    const settlement = await transaction.get(doc(db, 'settlements', payload.tenantId));
    if (!invoice.exists()) throw new Error('Freeze this month’s invoice before recording payment.');
    if (!tenant.exists() || settlement.exists()) throw new Error('Customer changed. Use Settlements for checkout payments.');
    const previous = account.exists() ? Number(account.data().paid) : getCollectedTotal(await Promise.all(legacy.map(async item => {
      const latest = await transaction.get(item.ref);
      return { id: item.id, ...latest.data() } as PaymentRecord;
    })));
    const total = Number(invoice.data().total);
    const paid = roundMoney(previous + payload.amountPaid);
    if (!Number.isFinite(previous) || previous < 0 || !Number.isFinite(total) || paid > total) throw new Error('Amount exceeds the latest remaining balance. Refresh and try again.');
    const payment = { ...payload, totalRent: total, balance: roundMoney(total - paid), createdBy: actorUid, collectedBy: actorUid, createdAt: serverTimestamp() };
    transaction.set(paymentRef, payment);
    transaction.set(accountRef, { tenantId: payload.tenantId, month: payload.month, paid, paymentId: paymentRef.id, updatedAt: serverTimestamp(), updatedBy: actorUid });
    transaction.set(doc(collection(db, 'auditEvents')), { action: 'payment.created', actorUid, createdAt: serverTimestamp(), entityId: paymentRef.id, entityType: 'payment' });
    return { id: paymentRef.id, ...payment };
  });
}

export async function voidMonthlyPayment(db: Firestore, paymentId: string, actorUid: string) {
  return runTransaction(db, async transaction => {
    const paymentRef = doc(db, 'payments', paymentId);
    const payment = await transaction.get(paymentRef);
    if (!payment.exists() || isVoided({ id: payment.id, ...payment.data() } as PaymentRecord)) throw new Error('This payment is already voided or unavailable.');
    const record = payment.data();
    const accountRef = doc(db, 'paymentAccounts', `${record.tenantId}_${record.month}`);
    const account = await transaction.get(accountRef);
    const settlement = await transaction.get(doc(db, 'settlements', record.tenantId));
    if (settlement.exists()) throw new Error('Checkout is final. This payment cannot be voided.');
    if (account.exists()) {
      const paid = roundMoney(Number(account.data().paid) - Number(record.amountPaid));
      if (!Number.isFinite(paid) || paid < 0) throw new Error('Payment account needs review before voiding.');
      transaction.set(accountRef, { ...account.data(), paid, paymentId, updatedAt: serverTimestamp(), updatedBy: actorUid });
    }
    transaction.update(paymentRef, { status: 'Voided', updatedAt: serverTimestamp(), voidedAt: serverTimestamp(), voidedBy: actorUid });
    transaction.set(doc(collection(db, 'auditEvents')), { action: 'payment.voided', actorUid, createdAt: serverTimestamp(), entityId: paymentId, entityType: 'payment' });
  });
}

export async function assertCheckoutPayments(transaction: Transaction, db: Firestore, tenantId: string, months: string[], payments: PaymentRecord[]) {
  for (const payment of payments) {
    const latest = await transaction.get(doc(db, 'payments', payment.id));
    const record = { id: payment.id, ...latest.data() } as PaymentRecord;
    if (!latest.exists() || isVoided(record) !== isVoided(payment) || getPaymentAmount(record) !== getPaymentAmount(payment) || record.month !== payment.month) throw new Error('Payments changed. Reopen checkout before continuing.');
  }
  for (const month of new Set(months)) {
    const account = await transaction.get(doc(db, 'paymentAccounts', `${tenantId}_${month}`));
    const expected = getCollectedTotal(payments.filter(payment => payment.month === month));
    if (account.exists() && roundMoney(account.data().paid) !== roundMoney(expected)) throw new Error('Payments changed. Reopen checkout before continuing.');
  }
}
