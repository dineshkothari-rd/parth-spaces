function positiveInteger(value: string | undefined, fallback: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

export const ROOM_START = positiveInteger(process.env.EXPO_PUBLIC_ROOM_START, 101, 9999);
export const ROOM_COUNT = positiveInteger(process.env.EXPO_PUBLIC_ROOM_COUNT, 14, 500);
export const PG_ROOM_CAPACITY = positiveInteger(process.env.EXPO_PUBLIC_PG_ROOM_CAPACITY, 2, 20);

export const defaultBusinessSettings = {
  name: 'Your business',
  address: '',
  phone: '',
  upiId: '',
  upiQr: '',
  roomStart: ROOM_START,
  roomCount: ROOM_COUNT,
  pgCapacity: PG_ROOM_CAPACITY,
  seatPrefix: 'A',
  seatCount: 100,
  defaultPgRent: 0,
  defaultHotelCharge: 0,
  defaultLibraryFee: 0,
  meterRate: 10,
};

export type BusinessSettings = typeof defaultBusinessSettings;

export function validateBusinessSettings(settings: BusinessSettings) {
  if (!settings.name.trim() || settings.name.length > 120) throw new Error('Enter a business name up to 120 characters.');
  if (settings.upiQr && (!settings.upiQr.startsWith('data:image/jpeg;base64,') || settings.upiQr.length > 260000)) throw new Error('UPI QR image is too large.');
  if (settings.upiId && !/^[a-zA-Z0-9._-]{2,100}@[a-zA-Z0-9.-]{2,50}$/.test(settings.upiId)) throw new Error('Enter a valid UPI ID.');
  if (settings.address.length > 500 || settings.phone.length > 30) throw new Error('Business contact details are too long.');
  for (const [value, maximum] of [[settings.roomStart, 9999], [settings.roomCount, 500], [settings.pgCapacity, 20], [settings.seatCount, 999]]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error('Enter valid whole numbers for inventory and capacity.');
  }
  if (settings.roomStart + settings.roomCount - 1 > 9999 || !/^[A-Z]$/.test(settings.seatPrefix)) throw new Error('Use room numbers up to 9999 and a single seat prefix letter.');
  for (const value of [settings.defaultPgRent, settings.defaultHotelCharge, settings.defaultLibraryFee, settings.meterRate]) {
    if (!Number.isFinite(value) || value < 0 || value > 10_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.000001) throw new Error('Enter non-negative billing amounts with at most two decimal places.');
  }
  if (settings.meterRate > 1000) throw new Error('Electricity rate must not exceed 1000 per unit.');
  return settings;
}

export function getRoomNumbers(settings = defaultBusinessSettings) {
  return Array.from({ length: settings.roomCount }, (_, index) => String(settings.roomStart + index).padStart(3, '0'));
}

export function getSeatNumbers(settings = defaultBusinessSettings) {
  return Array.from({ length: settings.seatCount }, (_, index) => `${settings.seatPrefix}${String(index + 1).padStart(2, '0')}`);
}

export function requireBusinessIdentity(business: Pick<BusinessSettings, 'name'>) {
  if (!business.name.trim() || business.name.trim() === defaultBusinessSettings.name) {
    throw new Error('Set your actual business name in Business settings before generating bills or receipts.');
  }
}
