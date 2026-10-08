import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useLanguage } from '../i18n/LanguageProvider';

type PrimaryButtonProps = {
  label: string;
  loading?: boolean;
  onPress: () => void;
};

export function PrimaryButton({ label, loading = false, onPress }: PrimaryButtonProps) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);

  return (
    <Pressable
      accessibilityRole="button"
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && !loading && styles.pressed, loading && styles.loading]}
    >
      {loading ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.label}>{t(label)}</Text>}
    </Pressable>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }],
  },
  loading: {
    opacity: 0.72,
  },
  label: {
    color: colors.onBrand,
    fontSize: 15,
    fontWeight: typography.weight.black,
  },
  });
}
