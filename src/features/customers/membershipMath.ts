import { getDayKey, shiftMonth } from '../operations/operationsMath';

export function membershipPeriod(start: string, months: number) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(start) || !Number.isInteger(months) || months < 1 || months > 12 || Number(start.slice(0, 4)) < 2000 || Number(start.slice(0, 4)) > 2099) throw new Error('Use the first day of a month and a duration of 1–12 months.');
  const endMonth = shiftMonth(start.slice(0, 7), months);
  const end = getDayKey(new Date(Number(endMonth.slice(0, 4)), Number(endMonth.slice(5, 7)) - 1, 0));
  return { start, end, invoiceMonths: Array.from({ length: months }, (_, index) => shiftMonth(start.slice(0, 7), index)) };
}
export function membershipStatus(end: string, today = getDayKey()) {
  if (end < today) return 'Expired';
  const days = Math.ceil((new Date(`${end}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000);
  return days <= 7 ? 'Expiring soon' : 'Active';
}
export function escapeDocumentText(value: unknown) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}
