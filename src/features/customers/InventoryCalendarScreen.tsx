import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import type { TenantRecord } from '../../shared/types/records';
import { getCustomerAllocationLabel, getCustomerName, getCustomerStatusLabel } from './customerUtils';
import { getInventoryCalendar } from './roomUtils';

function shiftDate(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function InventoryCalendarScreen() {
  const { settings } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const tenants = useFirestoreCollection<TenantRecord>('tenants', { sortBy: 'createdAt' });
  const [start, setStart] = useState(() => new Date());
  const days = useMemo(() => getInventoryCalendar(tenants.data, start, 7, settings), [start, tenants.data, settings]);

  return (
    <View>
      <Text style={styles.title}>{t('Inventory calendar')}</Text>
      <Text style={styles.subtitle}>{t('Room, bed and seat commitments for the next seven days.')}</Text>
      <View style={styles.navigator}>
        <Pressable onPress={() => setStart((value) => shiftDate(value, -7))} style={styles.navButton}><Text style={styles.navText}>{t('Previous week')}</Text></Pressable>
        <Pressable onPress={() => setStart(new Date())} style={styles.today}><Text style={styles.todayText}>{t('Today')}</Text></Pressable>
        <Pressable onPress={() => setStart((value) => shiftDate(value, 7))} style={styles.navButton}><Text style={styles.navText}>{t('Next week')}</Text></Pressable>
      </View>
      {tenants.error ? <Text style={styles.error}>{tenants.error}</Text> : null}
      {days.map((day) => (
        <View key={day.dayKey} style={styles.card}>
          <View style={styles.header}>
            <View><Text style={styles.day}>{day.date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}</Text><Text style={styles.date}>{day.dayKey}</Text></View>
            <Text style={styles.rooms}>{day.occupiedRooms}/{settings.roomCount} {t('rooms')}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label={t('Open beds')} styles={styles} value={day.openBeds} />
            <Metric label={t('Busy seats')} styles={styles} value={day.busySeats} />
            <Metric label={t('Reservations')} styles={styles} value={day.reservations} />
          </View>
          {day.active.slice(0, 8).map((customer) => (
            <View key={customer.id} style={styles.booking}>
              <View style={styles.bookingCopy}><Text style={styles.name}>{getCustomerName(customer)}</Text><Text style={styles.meta}>{getCustomerAllocationLabel(customer)}</Text></View>
              <Text style={styles.status}>{t(getCustomerStatusLabel(customer))}</Text>
            </View>
          ))}
          {!day.active.length ? <Text style={styles.empty}>{t('No commitments for this day.')}</Text> : null}
          {day.active.length > 8 ? <Text style={styles.more}>+{day.active.length - 8} {t('more')}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function Metric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    title: { color: colors.text, fontSize: 24, fontWeight: typography.weight.black },
    subtitle: { color: colors.muted, fontSize: 13, marginBottom: spacing.lg, marginTop: spacing.xs },
    navigator: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
    navButton: { alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: radius.md, flex: 1, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.xs },
    navText: { color: colors.text, fontSize: 11, fontWeight: typography.weight.black },
    today: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.md, justifyContent: 'center', minHeight: 42, paddingHorizontal: spacing.md },
    todayText: { color: colors.onBrand, fontSize: 11, fontWeight: typography.weight.black },
    card: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.md, padding: spacing.lg },
    header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
    day: { color: colors.text, fontSize: 17, fontWeight: typography.weight.black },
    date: { color: colors.muted, fontSize: 11, marginTop: 2 },
    rooms: { color: colors.brand, fontSize: 12, fontWeight: typography.weight.black },
    metrics: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
    metric: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, flex: 1, padding: spacing.sm },
    metricValue: { color: colors.text, fontSize: 16, fontWeight: typography.weight.black },
    metricLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
    booking: { alignItems: 'center', borderTopColor: colors.borderSoft, borderTopWidth: 1, flexDirection: 'row', minHeight: 48 },
    bookingCopy: { flex: 1 },
    name: { color: colors.text, fontSize: 13, fontWeight: typography.weight.black },
    meta: { color: colors.muted, fontSize: 11, marginTop: 2 },
    status: { color: colors.brand, fontSize: 11, fontWeight: typography.weight.bold },
    empty: { color: colors.muted, fontSize: 12, paddingVertical: spacing.md, textAlign: 'center' },
    more: { color: colors.brand, fontSize: 11, marginTop: spacing.sm, textAlign: 'center' },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, marginBottom: spacing.md, padding: spacing.md },
  });
}
