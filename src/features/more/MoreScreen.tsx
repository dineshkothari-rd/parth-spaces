import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { EnquiriesScreen } from '../enquiries/EnquiriesScreen';
import { MeterScreen } from '../meter/MeterScreen';
import { NoticesScreen } from '../notices/NoticesScreen';
import { SettingsScreen } from '../settings/SettingsScreen';
import { StaffScreen } from '../staff/StaffScreen';
import { SupportRequestsScreen } from '../support/SupportRequestsScreen';
import { AuditScreen } from '../audit/AuditScreen';
import { FinanceDesk } from '../money/FinanceDesk';
import { MembershipsScreen } from '../customers/MembershipsScreen';
import { SettlementsScreen } from '../money/SettlementsScreen';
import { InventoryCalendarScreen } from '../customers/InventoryCalendarScreen';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';

export type MoreView = 'finance' | 'memberships' | 'audit' | 'calendar' | 'enquiries' | 'notices' | 'meter' | 'requests' | 'settings' | 'settlements' | 'team';

const moreViews: Array<{ label: string; value: MoreView }> = [
  { label: 'Enquiries', value: 'enquiries' },
  { label: 'Notices', value: 'notices' },
  { label: 'Meter', value: 'meter' },
  { label: 'Requests', value: 'requests' },
  { label: 'Settings', value: 'settings' },
  { label: 'Team', value: 'team' },
  { label: 'Audit', value: 'audit' },
  { label: 'Settlements', value: 'settlements' },
  { label: 'Money management', value: 'finance' },
  { label: 'Memberships & agreements', value: 'memberships' },
  { label: 'Calendar', value: 'calendar' },
];

export function MoreScreen({ isAdmin, onCheckout, onViewChange, view }: { isAdmin: boolean; onCheckout: (customerId: string) => void; onViewChange: (view: MoreView) => void; view: MoreView }) {
  const { can } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const allowedViews = moreViews.filter((item) => {
    if (['audit', 'team'].includes(item.value)) return isAdmin;
    if (item.value === 'memberships') return can('customers');
    if (item.value === 'meter') return can('customers');
    if (['settlements', 'finance'].includes(item.value)) return can('money');
    if (['enquiries', 'notices', 'requests'].includes(item.value)) return can('operations');
    return true;
  });
  const activeView = allowedViews.some((item) => item.value === view) ? view : 'settings';

  return (
    <View>
      <View style={styles.switcher}>
        {allowedViews.map((item) => {
          const active = item.value === activeView;

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={item.value}
              onPress={() => onViewChange(item.value)}
              style={[styles.switchItem, active && styles.switchItemActive]}
            >
              <Text style={[styles.switchText, active && styles.switchTextActive]}>{t(item.label)}</Text>
            </Pressable>
          );
        })}
      </View>

      {activeView === 'enquiries' ? (
        <EnquiriesScreen />
      ) : activeView === 'notices' ? (
        <NoticesScreen />
      ) : activeView === 'meter' ? (
        <MeterScreen onCheckout={onCheckout} />
      ) : activeView === 'requests' ? (
        <SupportRequestsScreen />
      ) : activeView === 'team' && isAdmin ? (
        <StaffScreen />
      ) : activeView === 'audit' && isAdmin ? (
        <AuditScreen />
      ) : activeView === 'settlements' ? (
        <SettlementsScreen />
      ) : activeView === 'finance' ? (
        <FinanceDesk />
      ) : activeView === 'memberships' ? (
        <MembershipsScreen />
      ) : activeView === 'calendar' ? (
        <InventoryCalendarScreen />
      ) : (
        <SettingsScreen />
      )}
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    switcher: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginBottom: spacing.lg,
      padding: spacing.sm,
    },
    switchItem: {
      alignItems: 'center',
      borderRadius: radius.md,
      flexBasis: 120,
      flexGrow: 1,
      minHeight: 42,
      justifyContent: 'center',
    },
    switchItemActive: {
      backgroundColor: colors.ink,
    },
    switchText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    switchTextActive: {
      color: colors.onBrand,
    },
  });
}
