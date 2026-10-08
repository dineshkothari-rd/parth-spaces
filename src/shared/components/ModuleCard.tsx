import { StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { AppBadge } from './AppBadge';
import type { FeatureModule } from '../../features/featureModules';
import { useLanguage } from '../i18n/LanguageProvider';

const statusLabel = {
  ready: 'Ready',
  next: 'Soon',
  planned: 'Soon',
};

export function ModuleCard({ feature }: { feature: FeatureModule }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.title}>{t(feature.title)}</Text>
        <AppBadge label={statusLabel[feature.status]} tone={feature.status === 'ready' ? 'success' : 'neutral'} />
      </View>
      <Text style={styles.description}>{t(feature.description)}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadow.card,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: 16,
    fontWeight: typography.weight.black,
  },
  description: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  collection: {
    color: colors.link,
    fontSize: 12,
    fontWeight: typography.weight.bold,
    marginTop: spacing.md,
  },
  });
}
