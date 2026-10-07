import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-expect-error Node runs this check with native TypeScript stripping.
import { canAllocateCustomer, getInventoryCalendar, getRoomOccupancy, getRoomSummary, parseStayDate, parseRoomLabel, PG_ROOM_CAPACITY, ROOM_COUNT, staysOverlap, validateInventorySettings } from './roomUtils.ts';
import { defaultBusinessSettings, getRoomNumbers, getSeatNumbers, validateBusinessSettings } from './businessConfig';

test('future reservations hold inventory without counting as occupied rooms', () => {
  const customers = [
    { id: 'reservation', businessType: 'hotel', moveInDate: '2026-09-10', moveOutDate: '2026-09-12', room: 'Room 101', status: 'booked' },
    { id: 'guest', businessType: 'hotel', moveInDate: '2026-08-20', moveOutDate: '2026-08-24', room: 'Room 102', status: 'checked in' },
  ];
  const summary = getRoomSummary(customers, new Date(2026, 7, 22).getTime());
  assert.equal(summary.occupiedRooms, 1);
  assert.equal(summary.availableRooms, ROOM_COUNT - 1);
});

test('back-to-back reservations share a room but overlapping stays do not', () => {
  const first = { id: 'first', moveInDate: '2026-09-10', moveInTime: '12:00', moveOutDate: '2026-09-12', moveOutTime: '11:00', status: 'booked' };
  const next = { id: 'next', moveInDate: '2026-09-12', moveInTime: '12:00', moveOutDate: '2026-09-13', moveOutTime: '11:00', status: 'booked' };
  const overlap = { ...next, id: 'overlap', moveInDate: '2026-09-11' };

  assert.equal(staysOverlap(first, next), false);
  assert.equal(staysOverlap(first, overlap), true);
});

test('allocation capacity blocks concurrent hotel, PG, and library conflicts', () => {
  const stay = { id: 'candidate', businessType: 'pg', moveInDate: '2026-09-10', room: 'Room 101', status: 'booked' };
  const existingPgCustomers = Array.from({ length: PG_ROOM_CAPACITY }, (_, index) => ({ ...stay, id: `pg-${index}` }));
  const hotel = { ...stay, businessType: 'hotel', id: 'hotel' };
  const member = { ...stay, businessType: 'library', id: 'member', room: 'Seat A01' };

  assert.equal(canAllocateCustomer(stay, existingPgCustomers.slice(0, -1)), true);
  assert.equal(canAllocateCustomer(stay, existingPgCustomers), false);
  assert.equal(canAllocateCustomer(stay, [hotel]), false);
  assert.equal(canAllocateCustomer(member, [{ ...member, id: 'existing' }]), false);
});

test('inventory calendar shows future room, bed and seat commitments', () => {
  const customers = [
    { id: 'pg', businessType: 'pg', moveInDate: '2026-09-22', moveOutDate: '2026-09-24', room: 'Room 101 / Bed A', status: 'booked' },
    { id: 'seat', businessType: 'library', moveInDate: '2026-09-22', moveOutDate: '2026-09-23', room: 'Seat A01', status: 'active' },
  ];
  const [day] = getInventoryCalendar(customers, new Date(2026, 8, 22), 1);

  assert.equal(day.occupiedRooms, 1);
  assert.equal(day.openBeds, ROOM_COUNT * PG_ROOM_CAPACITY - 1);
  assert.equal(day.busySeats, 1);
  assert.equal(day.reservations, 1);
  const [previousDay] = getInventoryCalendar(customers, new Date(2026, 8, 21), 1);
  assert.equal(previousDay.occupiedRooms, 0);
  assert.equal(previousDay.busySeats, 0);
});

test('PG capacity uses peak occupancy rather than the number of overlapping bookings', () => {
  const candidate = { id: 'new', businessType: 'pg', room: 'Room 101', moveInDate: '2026-09-01', moveOutDate: '2026-09-05', moveOutTime: '00:00', status: 'booked' };
  const first = { ...candidate, id: 'first', moveOutDate: '2026-09-03' };
  const second = { ...candidate, id: 'second', moveInDate: '2026-09-03' };
  assert.equal(canAllocateCustomer(candidate, [first, second], 2), true);
  assert.equal(canAllocateCustomer(candidate, [first, { ...second, moveInDate: '2026-09-02' }], 2), false);
  assert.equal(canAllocateCustomer(candidate, [first, second], 1), false);
});

test('stay dates reject calendar rollover and invalid times', () => {
  assert.equal(parseStayDate('2026-02-30'), null);
  assert.equal(parseStayDate('2026-13-01'), null);
  assert.equal(parseStayDate('2026-09-01', '24:00'), null);
  assert.equal(parseStayDate('2026-09-01', '12:99'), null);
  assert.equal(parseStayDate('2026-09-01', '12:00junk'), null);
  assert.equal(parseStayDate('2028-02-29')?.getDate(), 29);
});

test('live inventory settings drive room, bed and seat calculations and protect allocations', () => {
  const settings = { ...defaultBusinessSettings, roomStart: 1001, roomCount: 2, pgCapacity: 3, seatPrefix: 'B', seatCount: 2 };
  const customer = { id: 'pg', businessType: 'pg', room: '1001', status: 'checked in', moveInDate: '2026-09-01' };
  assert.deepEqual(getRoomNumbers(settings), ['1001', '1002']);
  assert.deepEqual(getSeatNumbers(settings), ['B01', 'B02']);
  assert.equal(parseRoomLabel('1001').room, '1001');
  assert.equal(getRoomSummary([customer], Date.now(), settings).availableRooms, 1);
  assert.equal(getRoomOccupancy([customer, { ...customer, id: 'second' }], Date.now(), settings)[0].status, 'Partial');
  assert.equal(getInventoryCalendar([customer], new Date(2026, 8, 22), 1, settings)[0].openBeds, 5);
  assert.doesNotThrow(() => validateInventorySettings(settings, [customer]));
  assert.throws(() => validateInventorySettings({ ...settings, roomStart: 1002 }, [customer]));
  const member = { id: 'member', businessType: 'library', room: 'Seat B02', status: 'active' };
  assert.throws(() => validateInventorySettings({ ...settings, seatCount: 1 }, [member]));
  assert.throws(() => validateInventorySettings({ ...settings, pgCapacity: 1 }, [customer, { ...customer, id: 'second' }]));
  assert.throws(() => validateBusinessSettings({ ...settings, roomCount: 1.5 }));
  assert.throws(() => validateBusinessSettings({ ...settings, meterRate: -1 }));
  assert.throws(() => validateBusinessSettings({ ...settings, meterRate: 10.001 }));
});
