import { StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';

type MetricTileProps = {
  label: string;
  tone?: 'brand' | 'blue' | 'green' | 'orange' | 'red';
  value: string | number;
};

export function MetricTile({ label, tone = 'brand', value }: MetricTileProps) {
  const { colors } = useAppTheme();
  const styles = createStyles(colors);
  const toneStyles = {
    blue: { backgroundColor: colors.accentSoft, color: colors.link },
    brand: { backgroundColor: colors.skySoft, color: colors.link },
    green: { backgroundColor: colors.successSoft, color: colors.success },
    orange: { backgroundColor: colors.warningSoft, color: colors.warning },
    red: { backgroundColor: colors.dangerSoft, color: colors.danger },
  };
  const toneStyle = toneStyles[tone];

  return (
    <View style={styles.tile}>
      <View style={styles.tileTop}>
        <Text style={styles.label}>{label}</Text>
        <View style={[styles.marker, { backgroundColor: toneStyle.backgroundColor }]}>
          <Text style={[styles.markerText, { color: toneStyle.color }]}>{String(label).slice(0, 1)}</Text>
        </View>
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.7} style={styles.value} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    minHeight: 118,
    padding: spacing.md,
    ...shadow.card,
  },
  tileTop: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  marker: {
    alignItems: 'center',
    borderRadius: radius.sm,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  markerText: {
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  value: {
    color: colors.text,
    fontSize: 22,
    fontWeight: typography.weight.black,
    marginTop: spacing.xl,
  },
  label: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    marginTop: 3,
  },
  });
}
