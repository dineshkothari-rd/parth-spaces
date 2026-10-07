import type { DepositEvent, ExpenseRecord, PaymentRecord, SettlementRecord } from '../../shared/types/records';
import { roundMoney, toNumber } from '../../shared/utils/money';
import { getDayKey, isVoided, matchesDay } from '../operations/operationsMath';

export const paymentModes = ['Cash', 'UPI', 'Bank'] as const;
export function parseAmount(text: string, allowZero = false) {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) throw new Error('Enter an amount with at most two decimal places.');
  const amount = Number(text);
  if (amount > 10_000_000 || (allowZero ? amount < 0 : amount <= 0)) throw new Error('Enter a valid amount up to 10,000,000.');
  return amount;
}
export function validatePaymentDetails(mode: string, reference: string) {
  if (!paymentModes.includes(mode as typeof paymentModes[number]) || reference.length > 120 || (mode !== 'Cash' && !reference.trim())) {
    throw new Error('Enter the transaction reference for a bank or UPI payment.');
  }
}
export function dailyReconciliation(payments: PaymentRecord[], expenses: ExpenseRecord[], deposits: DepositEvent[], settlements: SettlementRecord[], day = getDayKey()) {
  const totals = { Cash: 0, UPI: 0, Bank: 0, Unclassified: 0 };
  const add = (mode: unknown, amount: number) => {
    const key = paymentModes.includes(mode as typeof paymentModes[number]) ? mode as keyof typeof totals : 'Unclassified';
    totals[key] = roundMoney(totals[key] + amount);
  };
  payments.filter((item) => !isVoided(item) && matchesDay(item, day, ['createdAt', 'paidOn'])).forEach((item) => add(item.paymentMode, toNumber(item.amountPaid ?? item.amount ?? item.paid)));
  expenses.filter((item) => !isVoided(item) && matchesDay(item, day, ['date', 'createdAt'])).forEach((item) => add(item.paymentMode, -toNumber(item.amount ?? item.cost ?? item.total)));
  deposits.filter((item) => matchesDay(item, day, ['createdAt'])).forEach((item) => {
    if (item.kind === 'collection' || item.kind === 'refund') add(item.paymentMode, item.kind === 'collection' ? item.amount : -item.amount);
  });
  settlements.filter((item) => item.refundStatus === 'Paid' && matchesDay(item, day, ['refundedAt'])).forEach((item) => add(item.refundMode, -item.refundDue));
  return totals;
}
