import { useEffect, useMemo, useState } from 'react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { featureModules } from '../featureModules';
import { CustomersScreen } from '../customers/CustomersScreen';
import { MoreScreen, type MoreView } from '../more/MoreScreen';
import { MoneyScreen } from '../money/MoneyScreen';
import { OperationsOverviewScreen, type OverviewDestination } from '../operations/OperationsOverviewScreen';
import type { AdminProfile } from '../../shared/types/admin';
import { AppBadge } from '../../shared/components/AppBadge';
import { ModuleCard } from '../../shared/components/ModuleCard';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';
import { FirestoreRefreshContext } from '../../shared/hooks/useFirestoreCollection';
import { db } from '../../lib/firebase/client';

const primaryTabs = [
  { id: 'overview', label: 'Home', mark: 'H' },
  { id: 'tenants', label: 'Customers', mark: 'C' },
  { id: 'payments', label: 'Money', mark: 'M' },
  { id: 'more', label: 'More', mark: '••' },
];

type WorkspaceScreenProps = {
  admin: AdminProfile;
  onSignOut: () => void;
};

export function WorkspaceScreen({ admin, onSignOut }: WorkspaceScreenProps) {
  const [activeTab, setActiveTab] = useState('overview');
  const [moreView, setMoreView] = useState<MoreView>('enquiries');
  const [customerStart, setCustomerStart] = useState({ action: '', mode: 'All', status: '', customerId: '' });
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { settings, can } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 1000;
  const styles = useMemo(() => createStyles(colors, wide), [colors, wide]);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (admin.role !== 'staff' || admin.accessStatus !== 'invited') return;
    updateDoc(doc(db, 'users', admin.uid), {
      accessStatus: 'active',
      activatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => undefined);
  }, [admin.accessStatus, admin.role, admin.uid]);
  const visibleTab = (activeTab === 'tenants' && !can('customers')) || (activeTab === 'payments' && !can('money')) ? 'overview' : activeTab;
  const activeModules = useMemo(() => {
    if (activeTab === 'overview') return featureModules;
    if (activeTab === 'more') return featureModules.filter((feature) => !['overview', 'tenants', 'payments'].includes(feature.id));
    return featureModules.filter((feature) => feature.id === activeTab);
  }, [activeTab]);

  function refreshPage() {
    setRefreshing(true);
    setRefreshKey((current) => current + 1);
    setTimeout(() => setRefreshing(false), 900);
  }

  function openDestination(destination: OverviewDestination) {
    if ((['arrivals', 'attention', 'customers', 'departures', 'meter'].includes(destination) && !can('customers')) || (destination === 'money' && !can('money')) || (destination === 'enquiries' && !can('operations'))) return;
    if (destination === 'arrivals' || destination === 'attention' || destination === 'customers' || destination === 'departures') {
      setCustomerStart(destination === 'arrivals'
        ? { action: 'arrival', mode: 'All', status: 'reserved', customerId: '' }
        : destination === 'departures'
          ? { action: 'departure', mode: 'All', status: 'active', customerId: '' }
          : destination === 'attention'
            ? { action: '', mode: 'Needs attention', status: '', customerId: '' }
            : { action: '', mode: 'All', status: '', customerId: '' });
      setActiveTab('tenants');
      return;
    }

    if (destination === 'money') {
      setActiveTab('payments');
      return;
    }

    setMoreView(destination);
    setActiveTab('more');
  }

  const navigation = (
        <View style={styles.nav}>
          {primaryTabs.filter((tab) => tab.id !== 'tenants' || can('customers')).filter((tab) => tab.id !== 'payments' || can('money')).map((tab) => {
            const active = tab.id === visibleTab;

            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                key={tab.id}
                onPress={() => {
                  if (tab.id === 'tenants') setCustomerStart({ action: '', mode: 'All', status: '', customerId: '' });
                  setActiveTab(tab.id);
                }}
                style={[styles.navItem, active && styles.navItemActive]}
              >
                <Text style={[styles.navMark, active && styles.navMarkActive]}>{tab.mark}</Text>
                <Text style={[styles.navLabel, active && styles.navLabelActive]}>{t(tab.label)}</Text>
              </Pressable>
            );
          })}
        </View>
  );

  return (
    <View style={styles.screen}>
      {wide ? <View style={styles.sidebar} testID="desktop-sidebar">
        <View style={styles.sidebarBrand}><View style={styles.brandMark}><Text style={styles.brandMarkText}>P</Text></View><Text style={styles.sidebarTitle}>Parth Spaces</Text></View>
        <Text style={styles.sidebarCaption}>WORKSPACE</Text>
        {navigation}
        <Text style={styles.sidebarFooter}>Parth Software Labs</Text>
      </View> : null}
      <View style={styles.workspaceBody}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top + spacing.sm, spacing.lg) }]}>
        <View style={styles.brandRow}>
          <View style={styles.brandMark}>
            <Text style={styles.brandMarkText}>{settings.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>{settings.name} · {t(admin.role === 'admin' ? 'Admin' : 'Staff')}</Text>
            <Text style={styles.title}>{t('Hi')}, {admin.name}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.exitButton}>
          <Text style={styles.exitText}>{t('Logout')}</Text>
        </Pressable>
      </View>

      <FirestoreRefreshContext.Provider value={refreshKey}>
        <ScrollView
          testID="workspace-scroll"
          alwaysBounceVertical
          contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.xl) }]}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl colors={[colors.brand]} onRefresh={refreshPage} refreshing={refreshing} tintColor={colors.brand} />}
          style={styles.scroller}
        >
          {visibleTab === 'overview' ? (
            <OperationsOverviewScreen onNavigate={openDestination} />
          ) : visibleTab === 'tenants' && can('customers') ? (
            <CustomersScreen key={`${customerStart.customerId}-${customerStart.action}-${customerStart.mode}`} initialCustomerId={customerStart.customerId} initialActionFilter={customerStart.action} initialMode={customerStart.mode} initialStatusFilter={customerStart.status} isAdmin={admin.role === 'admin'} />
          ) : visibleTab === 'payments' && can('money') ? (
            <MoneyScreen />
          ) : visibleTab === 'more' ? (
            <MoreScreen onCheckout={(customerId) => { setCustomerStart({ action: '', mode: 'All', status: '', customerId }); setActiveTab('tenants'); }} isAdmin={admin.role === 'admin'} onViewChange={setMoreView} view={moreView} />
          ) : (
            <>
              <View style={styles.heroPanel}>
                <View style={styles.heroTop}>
                  <Text style={styles.heroTitle}>{t('Almost ready')}</Text>
                  <AppBadge label="Soon" />
                </View>
                <Text style={styles.heroText}>
                  {t('This section is being prepared for day-to-day use.')}
                </Text>
              </View>

              <View style={styles.moduleList}>
                {activeModules.map((feature) => (
                  <ModuleCard feature={feature} key={feature.id} />
                ))}
              </View>
            </>
          )}
        </ScrollView>
      </FirestoreRefreshContext.Provider>

      {!wide ? <View testID="mobile-navigation" style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 48 : spacing.sm) }]}>{navigation}</View> : null}
      </View>
    </View>
  );
}

function createStyles(colors: AppColors, wide: boolean) {
  return StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
    flexDirection: wide ? 'row' : 'column',
  },
  workspaceBody: { flex: 1, minWidth: 0 },
  sidebar: { width: 232, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border, padding: 20 },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: 40 },
  sidebarTitle: { color: colors.text, fontWeight: typography.weight.bold, fontSize: 19 },
  sidebarCaption: { color: colors.muted, fontSize: 11, letterSpacing: 1.4, marginBottom: spacing.lg },
  sidebarFooter: { color: colors.muted, fontSize: 12, marginTop: 'auto', paddingTop: spacing.xl },
  header: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
    paddingHorizontal: wide ? 32 : spacing.lg,
    paddingTop: spacing.lg,
  },
  brandRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.md,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.copper,
    borderRadius: radius.md,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  brandMarkText: {
    color: colors.onBrand,
    fontSize: 20,
    fontWeight: typography.weight.black,
  },
  headerCopy: {
    flex: 1,
  },
  eyebrow: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: 19,
    fontWeight: typography.weight.black,
    marginTop: 2,
  },
  exitButton: {
    backgroundColor: colors.surfaceMuted,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  exitText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  content: {
    alignSelf: 'center',
    flexGrow: 1,
    maxWidth: 1200,
    padding: wide ? 32 : spacing.lg,
    paddingBottom: spacing.xl,
    width: '100%',
  },
  scroller: {
    flex: 1,
  },
  heroPanel: {
    backgroundColor: colors.ink,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  heroTop: {
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  heroTitle: {
    color: colors.onBrand,
    fontSize: 24,
    fontWeight: typography.weight.black,
    lineHeight: 30,
  },
  heroText: {
    color: colors.panelMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  moduleList: {
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  footer: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  nav: {
    backgroundColor: wide ? colors.surface : colors.surfaceRaised,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: wide ? 0 : 1,
    flexDirection: wide ? 'column' : 'row',
    gap: spacing.sm,
    maxWidth: 680,
    padding: spacing.sm,
    ...(wide ? {} : shadow.dock),
    width: '100%',
  },
  navItem: {
    alignItems: 'center',
    flexDirection: wide ? 'row' : 'column',
    paddingHorizontal: wide ? spacing.md : 0,
    borderRadius: radius.sm,
    flex: wide ? undefined : 1,
    gap: wide ? spacing.md : 3,
    minHeight: 50,
    justifyContent: wide ? 'flex-start' : 'center',
  },
  navItemActive: {
    backgroundColor: colors.brand,
  },
  navMark: {
    color: colors.subtle,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  navMarkActive: {
    color: colors.onBrand,
  },
  navLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weight.black,
  },
  navLabelActive: {
    color: colors.onBrand,
  },
  });
}
