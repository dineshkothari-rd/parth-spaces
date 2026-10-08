import type { TenantRecord } from '../../shared/types/records';
import { defaultBusinessSettings, getRoomNumbers, getSeatNumbers, type BusinessSettings } from './businessConfig';
import { getCustomerStatus } from './customerUtils';

export { PG_ROOM_CAPACITY, ROOM_COUNT, ROOM_START } from './businessConfig';

export const roomNumbers = getRoomNumbers();
export const bedLabels = ['Bed A', 'Bed B'] as const;

export function normalizeLibrarySeat(value: unknown) {
  const text = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const rawSeat = text.replace(/^SEAT\s*/, '');
  const match = rawSeat.match(/^([A-Z])0*(\d{1,3})$/);

  return match ? `${match[1]}${match[2].padStart(2, '0')}` : rawSeat;
}

export function getAllocationKey(value: unknown, businessType: unknown) {
  const text = String(value || '').trim();

  if (businessType === 'library') {
    const seatMatch = text.match(/Seat\s+([A-Z]\d{1,3})/i) || text.match(/^([A-Z]\d{1,3})$/i);
    return normalizeLibrarySeat(seatMatch?.[1] || text);
  }

  return parseRoomLabel(text).room;
}

function getTimestampDate(value: unknown) {
  if (value instanceof Date) return value;

  if (value && typeof value === 'object') {
    if ('toDate' in value && typeof value.toDate === 'function') return value.toDate();
    if ('seconds' in value && typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  }

  return null;
}

export function parseStayDate(value: unknown, time: unknown = '', endOfDay = false) {
  const timestampDate = getTimestampDate(value);

  if (timestampDate && !Number.isNaN(timestampDate.getTime())) return timestampDate;

  const text = String(value || '').trim();
  if (!text) return null;

  const dateOnly = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  const indianDate = text.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  const parts = dateOnly
    ? [Number(dateOnly[1]), Number(dateOnly[2]), Number(dateOnly[3])]
    : indianDate
      ? [Number(indianDate[3]), Number(indianDate[2]), Number(indianDate[1])]
      : null;

  if (parts) {
    const timeText = String(time || '').trim();
    const timeMatch = timeText.match(/^(\d{1,2}):(\d{2})$/);
    if (timeText && !timeMatch) return null;
    const hour = timeMatch ? Number(timeMatch[1]) : endOfDay ? 23 : 0;
    const minute = timeMatch ? Number(timeMatch[2]) : endOfDay ? 59 : 0;
    const date = new Date(parts[0], parts[1] - 1, parts[2], hour, minute, endOfDay && !timeMatch ? 59 : 0, endOfDay && !timeMatch ? 999 : 0);

    return date.getFullYear() === parts[0] && date.getMonth() === parts[1] - 1 && date.getDate() === parts[2]
      && hour <= 23 && minute <= 59 ? date : null;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getStayCheckout(customer: TenantRecord) {
  const checkoutTime = customer.moveOutTime || customer.checkoutTime;

  for (const checkoutValue of [customer.moveOutDate, customer.checkOutDate, customer.checkoutDate, customer.endDate, customer.checkedOutAt]) {
    const parsed = parseStayDate(checkoutValue, checkoutTime, !checkoutTime);
    if (parsed) return parsed;
  }

  return null;
}

export function getStayStart(customer: TenantRecord) {
  for (const startValue of [customer.moveInDate, customer.checkInDate, customer.checkedInAt]) {
    const parsed = parseStayDate(startValue, customer.moveInTime);
    if (parsed) return parsed;
  }

  return null;
}

export function staysOverlap(first: TenantRecord, second: TenantRecord) {
  if ([getCustomerStatus(first), getCustomerStatus(second)].includes('cancelled')) return false;

  const firstStart = getStayStart(first);
  const secondStart = getStayStart(second);
  const firstEnd = getStayCheckout(first);
  const secondEnd = getStayCheckout(second);

  return (firstStart?.getTime() ?? Number.NEGATIVE_INFINITY) < (secondEnd?.getTime() ?? Number.POSITIVE_INFINITY)
    && (secondStart?.getTime() ?? Number.NEGATIVE_INFINITY) < (firstEnd?.getTime() ?? Number.POSITIVE_INFINITY);
}

export function canAllocateCustomer(candidate: TenantRecord, existing: TenantRecord[], capacity = defaultBusinessSettings.pgCapacity) {
  const conflicts = existing.filter((customer) => staysOverlap(customer, candidate));
  const businessType = String(candidate.businessType || 'pg');

  if (businessType === 'library' || businessType === 'hotel') return conflicts.length === 0;
  if (conflicts.some((customer) => customer.businessType === 'hotel')) return false;
  const start = getStayStart(candidate)?.getTime() ?? Number.NEGATIVE_INFINITY;
  const end = getStayCheckout(candidate)?.getTime() ?? Number.POSITIVE_INFINITY;
  const events = conflicts.flatMap((customer) => [
    { at: Math.max(start, getStayStart(customer)?.getTime() ?? Number.NEGATIVE_INFINITY), delta: 1 },
    { at: Math.min(end, getStayCheckout(customer)?.getTime() ?? Number.POSITIVE_INFINITY), delta: -1 },
  ]).sort((a, b) => a.at === b.at ? a.delta - b.delta : a.at < b.at ? -1 : 1);
  let occupied = 1;
  for (const event of events) {
    occupied += event.delta;
    if (occupied > capacity) return false;
  }
  return capacity >= 1;
}

export function validateInventorySettings(settings: BusinessSettings, customers: TenantRecord[]) {
  const rooms = new Set(getRoomNumbers(settings));
  const seats = new Set(getSeatNumbers(settings));
  const allocated = customers.filter((customer) => ['active', 'booked', 'checked in', 'occupied'].includes(getCustomerStatus(customer)) && customer.room);
  for (const customer of allocated) {
    const key = getAllocationKey(customer.room, customer.businessType);
    if (!(customer.businessType === 'library' ? seats : rooms).has(key)) throw new Error('An active customer or reservation uses inventory outside these settings. Move or close that allocation first.');
    const others = allocated.filter((other) => other.id !== customer.id && (other.businessType === 'library') === (customer.businessType === 'library') && getAllocationKey(other.room, other.businessType) === key);
    if (!canAllocateCustomer(customer, others, settings.pgCapacity)) throw new Error('The capacity is too small for existing allocations. Move or close those allocations first.');
  }
}

export function parseRoomLabel(value: unknown) {
  const text = String(value || '');
  const roomMatch = text.match(/Room\s+(\d+)/i);
  const legacyRoomMatch = text.match(/^(\d{1,4})\b/);
  const rawRoom = roomMatch?.[1] || legacyRoomMatch?.[1] || '';
  const room = rawRoom ? rawRoom.padStart(3, '0') : '';
  const bed = text.includes('Bed A')
    ? 'Bed A'
    : text.includes('Bed B')
      ? 'Bed B'
      : /Full Room|Double Room|Single/i.test(text)
        ? 'Full Room'
        : '';

  return { bed, room };
}

export function isRoomCustomer(customer: TenantRecord, now = Date.now()) {
  const businessType = customer.businessType || 'pg';

  if (!['pg', 'hotel'].includes(businessType)) return false;

  const status = getCustomerStatus(customer);
  const activeStatuses = ['active', 'booked', 'checked in', 'occupied'];

  if (!activeStatuses.includes(status)) return false;

  const checkout = getStayCheckout(customer);
  const isLegacyLifecycle = !customer.checkedInAt && !customer.checkedOutAt;
  if (isLegacyLifecycle && checkout && checkout.getTime() <= now) return false;

  return Boolean(parseRoomLabel(customer.room).room);
}

export function isRoomOccupied(customer: TenantRecord, now = Date.now()) {
  return getCustomerStatus(customer) !== 'booked' && isRoomCustomer(customer, now);
}

export function getRoomSummary(customers: TenantRecord[], now = Date.now(), settings = defaultBusinessSettings) {
  const activeRoomCustomers = customers.filter((customer) => isRoomOccupied(customer, now));
  const occupiedRooms = new Set(activeRoomCustomers.map((customer) => parseRoomLabel(customer.room).room));

  return {
    activeRoomCustomers: activeRoomCustomers.length,
    availableRooms: Math.max(0, settings.roomCount - occupiedRooms.size),
    occupiedRooms: occupiedRooms.size,
    totalRooms: settings.roomCount,
  };
}

export function getRoomOccupancy(customers: TenantRecord[], now = Date.now(), settings = defaultBusinessSettings) {
  const activeRoomCustomers = customers.filter((customer) => isRoomOccupied(customer, now));

  return getRoomNumbers(settings).map((room) => {
    const occupants = activeRoomCustomers.filter((customer) => parseRoomLabel(customer.room).room === room);
    const businessType = occupants.some((customer) => customer.businessType === 'hotel') ? 'hotel' : occupants.length ? 'pg' : '';
    const capacity = businessType === 'hotel' ? 1 : settings.pgCapacity;
    const guestCount = occupants.reduce(
      (count, customer) => count + 1 + (customer.businessType === 'hotel' && Array.isArray(customer.additionalGuests) ? customer.additionalGuests.filter(Boolean).length : 0),
      0,
    );

    return {
      availableBeds: Math.max(0, capacity - occupants.length),
      businessType,
      capacity,
      guestCount,
      occupants,
      room,
      status: occupants.length >= capacity ? 'Full' : occupants.length > 0 ? 'Partial' : 'Open',
    };
  });
}

export function getInventoryCalendar(customers: TenantRecord[], start = new Date(), days = 7, settings = defaultBusinessSettings) {
  return Array.from({ length: days }, (_, offset) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
    const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayWindow = { id: dayKey, moveInDate: dayKey, moveOutDate: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`, moveOutTime: '00:00', status: 'booked' } as TenantRecord;
    const active = customers.filter((customer) =>
      ['active', 'booked', 'checked in', 'occupied'].includes(getCustomerStatus(customer))
      && staysOverlap(customer, dayWindow));
    const roomCustomers = active.filter((customer) => ['pg', 'hotel'].includes(String(customer.businessType || 'pg')));
    const occupiedRooms = new Set(roomCustomers.map((customer) => parseRoomLabel(customer.room).room).filter(Boolean));
    const openBeds = getRoomNumbers(settings).reduce((total, room) => {
      const occupants = roomCustomers.filter((customer) => parseRoomLabel(customer.room).room === room);
      return total + (occupants.some((customer) => customer.businessType === 'hotel') ? 0 : Math.max(0, settings.pgCapacity - occupants.length));
    }, 0);
    const busySeats = new Set(active
      .filter((customer) => customer.businessType === 'library')
      .map((customer) => getAllocationKey(customer.room, 'library'))
      .filter(Boolean));

    return {
      active,
      busySeats: busySeats.size,
      date,
      dayKey,
      occupiedRooms: occupiedRooms.size,
      openBeds,
      reservations: active.filter((customer) => getCustomerStatus(customer) === 'booked').length,
    };
  });
}
