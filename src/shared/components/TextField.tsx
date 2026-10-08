import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useLanguage } from '../i18n/LanguageProvider';

type TextFieldProps = TextInputProps & {
  label: string;
};

export function TextField({ label, placeholder: rawPlaceholder, style, ...props }: TextFieldProps) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const placeholder = typeof rawPlaceholder === 'string' ? t(rawPlaceholder) : rawPlaceholder;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{t(label)}</Text>
      <TextInput
        accessibilityLabel={t(label)}
        autoCapitalize="none"
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={[styles.input, style]}
        {...props}
      />
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: 13,
    fontWeight: typography.weight.bold,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    color: colors.text,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  });
}
