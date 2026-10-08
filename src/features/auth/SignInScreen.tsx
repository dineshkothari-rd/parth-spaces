import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { TextField } from '../../shared/components/TextField';
import { useLanguage } from '../../shared/i18n/LanguageProvider';

type SignInScreenProps = {
  error: string;
  loading: boolean;
  onForgotPassword: (email: string) => Promise<void>;
  onSignIn: (email: string, password: string) => void;
};

export function SignInScreen({ error, loading, onForgotPassword, onSignIn }: SignInScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const { width } = useWindowDimensions();
  const wide = Platform.OS === 'web' && width >= 900;
  const styles = createStyles(colors, wide);
  const insets = useSafeAreaInsets();

  function submit() {
    if (!loading) onSignIn(email.trim(), password);
  }

  async function recoverPassword() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes('@')) {
      setRecoveryMessage(t('Enter your email first.'));
      return;
    }

    setRecovering(true);
    setRecoveryMessage('');
    try {
      await onForgotPassword(normalizedEmail);
      setRecoveryMessage(t('If an account exists for this email, password reset instructions have been sent.'));
    } catch (recoveryError) {
      setRecoveryMessage(recoveryError instanceof Error ? recoveryError.message : t('Could not send password reset email.'));
    } finally {
      setRecovering(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, spacing.xl), paddingTop: Math.max(insets.top, spacing.xl) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.hero}>
            <View style={styles.mark}>
              <Text style={styles.markText}>P</Text>
            </View>
            <Text style={styles.eyebrow}>Parth Spaces</Text>
            <Text style={styles.title}>{t('Welcome back')}</Text>
            <Text style={styles.subtitle}>{t('Sign in to manage your stay, membership, rooms, and payments.')}</Text>
            <Text style={styles.studio}>BY PARTH SOFTWARE LABS</Text>
          </View>

          <View style={styles.form}>
            <View>
              <Text style={styles.formTitle}>{t('Secure login')}</Text>
              <Text style={styles.formSubtitle}>{t('Only approved accounts can open the app.')}</Text>
            </View>
            <TextField
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!loading}
              keyboardType="email-address"
              label="Email"
              onChangeText={setEmail}
              placeholder="admin@example.com"
              returnKeyType="next"
              textContentType="emailAddress"
              value={email}
            />
            <View>
              <TextField
                autoComplete="password"
                editable={!loading}
                label="Password"
                onChangeText={setPassword}
                onSubmitEditing={submit}
                placeholder="Password"
                returnKeyType="done"
                secureTextEntry={!passwordVisible}
                textContentType="password"
                value={password}
              />
              <Pressable
                accessibilityRole="button"
                disabled={loading}
                hitSlop={8}
                onPress={() => setPasswordVisible((visible) => !visible)}
                style={styles.passwordToggle}
              >
                <Text style={styles.passwordToggleText}>{t(passwordVisible ? 'Hide password' : 'Show password')}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={loading || recovering}
                onPress={recoverPassword}
                style={styles.forgotPassword}
              >
                <Text style={styles.passwordToggleText}>{t(recovering ? 'Sending...' : 'Forgot password?')}</Text>
              </Pressable>
            </View>
            {recoveryMessage ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{recoveryMessage}</Text> : null}
            {error ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {t(error)}
              </Text>
            ) : null}
            <PrimaryButton label="Continue" loading={loading} onPress={submit} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: AppColors, wide: boolean) {
  return StyleSheet.create({
  screen: {
    backgroundColor: colors.canvas,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  container: {
    alignSelf: 'center',
    maxWidth: wide ? 1060 : 480,
    flexDirection: wide ? 'row' : 'column',
    alignItems: wide ? 'center' : 'stretch',
    gap: wide ? 72 : spacing.lg,
    width: '100%',
  },
  hero: {
    backgroundColor: wide ? colors.canvas : colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    flex: wide ? 1 : undefined,
  },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.copper,
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  markText: {
    color: colors.onBrand,
    fontSize: 27,
    fontWeight: typography.weight.black,
  },
  eyebrow: {
    color: colors.link,
    fontSize: 12,
    fontWeight: typography.weight.black,
    letterSpacing: 1.2,
    marginTop: spacing.xl,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.text,
    fontSize: wide ? 52 : 32,
    fontWeight: typography.weight.black,
    lineHeight: wide ? 58 : 38,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.muted,
    fontSize: wide ? 18 : 15,
    lineHeight: wide ? 28 : 23,
    marginTop: spacing.sm,
  },
  form: {
    backgroundColor: colors.surface,
    borderColor: colors.borderSoft,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    width: wide ? 420 : undefined,
    padding: wide ? 32 : spacing.xl,
    ...shadow.card,
  },
  formTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: typography.weight.black,
  },
  formSubtitle: {
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  passwordToggle: {
    alignSelf: 'flex-end',
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  forgotPassword: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  passwordToggleText: {
    color: colors.link,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  error: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    color: colors.danger,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    padding: spacing.md,
  },
  studio: { color: colors.muted, fontSize: 11, letterSpacing: 1.5, marginTop: 32 },
  notice: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.md,
    color: colors.success,
    fontSize: 13,
    fontWeight: typography.weight.bold,
    lineHeight: 19,
    padding: spacing.md,
  },
  });
}
