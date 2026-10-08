import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { collection, doc, getDocs, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '../../lib/firebase/client';
import { useAppTheme } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import type { AppProfile } from '../../shared/types/admin';
import type { TenantRecord } from '../../shared/types/records';
import { hasPermission, type StaffPermission } from '../../shared/types/permissions';
import { defaultBusinessSettings, getRoomNumbers, getSeatNumbers, validateBusinessSettings, type BusinessSettings } from '../customers/businessConfig';
import { validateInventorySettings } from '../customers/roomUtils';

const BusinessSettingsContext = createContext<{
  settings: BusinessSettings;
  isAdmin: boolean;
  can: (permission: StaffPermission) => boolean;
  save: (settings: BusinessSettings) => Promise<void>;
} | null>(null);

export function BusinessSettingsProvider({ children, onSignOut, profile }: PropsWithChildren<{ onSignOut: () => void; profile: AppProfile }>) {
  const [settings, setSettings] = useState(defaultBusinessSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const { colors } = useAppTheme();
  const { t } = useLanguage();

  useEffect(() => {
    setLoading(true);
    setError('');
    return onSnapshot(doc(db, 'settings', 'business'), (snapshot) => {
      try {
        setSettings(validateBusinessSettings({ ...defaultBusinessSettings, ...snapshot.data() }));
        setError('');
      } catch {
        setError('Business settings are invalid. Contact the administrator.');
      }
      setLoading(false);
    }, () => {
      setError('Could not load business settings. Please try again.');
      setLoading(false);
    });
  }, [profile.uid, retry]);

  async function save(next: BusinessSettings) {
    if (profile.role !== 'admin') throw new Error('Only administrators can change business settings.');
    validateBusinessSettings(next);
    const tenants = await getDocs(collection(db, 'tenants'));
    const customers = tenants.docs.map((snapshot) => ({ ...snapshot.data(), id: snapshot.id }) as TenantRecord);
    const changedRooms = next.roomStart !== settings.roomStart || next.roomCount !== settings.roomCount || next.pgCapacity !== settings.pgCapacity;
    const changedSeats = next.seatPrefix !== settings.seatPrefix || next.seatCount !== settings.seatCount;
    validateInventorySettings(next, customers.filter((customer) => customer.businessType === 'library' ? changedSeats : changedRooms));

    await runTransaction(db, async (transaction) => {
      const ref = doc(db, 'settings', 'business');
      const current = await transaction.get(ref);
      const previous = { ...defaultBusinessSettings, ...current.data() };
      const nextRooms = new Set(getRoomNumbers(next));
      const nextSeats = new Set(getSeatNumbers(next));
      const affectedGuards = [
        ...getRoomNumbers(previous).filter((room) => !nextRooms.has(room) || next.pgCapacity < previous.pgCapacity).map((room) => `room-${room}`),
        ...getSeatNumbers(previous).filter((seat) => !nextSeats.has(seat)).map((seat) => `seat-${seat}`),
      ];
      const guards = await Promise.all(affectedGuards.map((id) => transaction.get(doc(db, 'allocationGuards', id))));
      const reservations = guards.flatMap((snapshot) => {
        const room = snapshot.id.startsWith('seat-') ? `Seat ${snapshot.id.slice(5)}` : `Room ${snapshot.id.slice(5)}`;
        return (snapshot.data()?.reservations || []).map((entry: TenantRecord) => ({ ...entry, id: String(entry.customerId || entry.id), room }));
      });
      validateInventorySettings(next, reservations);
      transaction.set(ref, { ...next, updatedAt: serverTimestamp(), updatedBy: profile.uid });
      transaction.set(doc(collection(db, 'auditEvents')), {
        action: 'business.settings_updated', actorUid: profile.uid, createdAt: serverTimestamp(),
      });
    });
  }

  if (loading || error) return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
      {loading ? <ActivityIndicator color={colors.brand} /> : <>
        <Text style={{ color: colors.danger }}>{t(error)}</Text>
        <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)}><Text style={{ color: colors.link }}>{t('Try again')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={onSignOut}><Text style={{ color: colors.link }}>{t('Logout')}</Text></Pressable>
      </>}
    </View>
  );

  return <BusinessSettingsContext.Provider value={{ settings, isAdmin: profile.role === 'admin', can: (permission) => hasPermission(profile, permission), save }}>{children}</BusinessSettingsContext.Provider>;
}

export function useBusinessSettings() {
  const context = useContext(BusinessSettingsContext);
  if (!context) throw new Error('Business settings are unavailable.');
  return context;
}
