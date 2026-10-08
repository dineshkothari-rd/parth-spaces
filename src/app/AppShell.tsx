import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationBar } from 'expo-navigation-bar';
import { usePreventScreenCapture } from 'expo-screen-capture';
import * as SystemUI from 'expo-system-ui';
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { firebaseConfigStatus } from '../config/firebaseConfig';
import { SignInScreen } from '../features/auth/SignInScreen';
import { useAppSession } from '../features/auth/useAdminSession';
import { WorkspaceScreen } from '../features/admin/WorkspaceScreen';
import { CustomerWorkspaceScreen } from '../features/customer/CustomerWorkspaceScreen';
import { AppErrorBoundary } from '../shared/components/AppErrorBoundary';
import { AppThemeProvider, radius, spacing, typography, useAppTheme, type AppColors } from '../design/tokens';
import { LanguageProvider, useLanguage } from '../shared/i18n/LanguageProvider';
import { BusinessSettingsProvider } from '../features/settings/BusinessSettingsProvider';

export function AppShell() {
  return (
    <AppThemeProvider>
      <LanguageProvider>
        <AppShellRoot />
      </LanguageProvider>
    </AppThemeProvider>
  );
}

function AppShellRoot() {
  const session = useAppSession();
  const [splashVisible, setSplashVisible] = useState(true);
  const finishSplash = useCallback(() => setSplashVisible(false), []);

  return (
    <View style={splashStyles.app}>
      <AppShellContent session={session} />
      {splashVisible ? <AnimatedSplash onFinish={finishSplash} ready={session.status !== 'checking'} /> : null}
    </View>
  );
}

function AnimatedSplash({ onFinish, ready }: { onFinish: () => void; ready: boolean }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const copy = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;
  const [introFinished, setIntroFinished] = useState(false);

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.spring(entrance, {
        friction: 7,
        tension: 65,
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(copy, {
        delay: 140,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
      Animated.timing(progress, {
        duration: 850,
        easing: Easing.inOut(Easing.cubic),
        toValue: 1,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => setIntroFinished(finished));
    return () => animation.stop();
  }, [copy, entrance, progress]);

  useEffect(() => {
    if (!introFinished || !ready) return;

    const animation = Animated.sequence([
      Animated.delay(250),
      Animated.timing(exit, {
        duration: 280,
        easing: Easing.in(Easing.cubic),
        toValue: 0,
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) onFinish();
    });
    return () => animation.stop();
  }, [exit, introFinished, onFinish, ready]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[splashStyles.overlay, { opacity: exit }]}
    >
      <StatusBar style="light" />
      <Animated.View
        style={[
          splashStyles.logoScene,
          {
            opacity: entrance,
            transform: [
              { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] }) },
              { rotate: entrance.interpolate({ inputRange: [0, 1], outputRange: ['-5deg', '0deg'] }) },
            ],
          },
        ]}
      >
        <View style={splashStyles.haloOuter} />
        <View style={splashStyles.haloInner} />
        <View style={[splashStyles.spark, splashStyles.sparkTop]} />
        <View style={[splashStyles.spark, splashStyles.sparkBottom]} />
        <View style={splashStyles.logo}>
          <View style={splashStyles.logoInset}>
            <Text style={splashStyles.logoText}>K</Text>
          </View>
          <View style={splashStyles.logoAccent} />
        </View>
      </Animated.View>
      <Animated.View
        style={{
          alignItems: 'center',
          opacity: copy,
          transform: [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
        }}
      >
        <Text style={splashStyles.eyebrow}>PARTH SPACES</Text>
        <Text style={splashStyles.title}>Your spaces, made simple.</Text>
        <Text style={splashStyles.subtitle}>PG · HOTEL · LIBRARY</Text>
      </Animated.View>
      <View style={splashStyles.track}>
        <Animated.View style={[splashStyles.progress, { transform: [{ scaleX: progress }] }]} />
      </View>
    </Animated.View>
  );
}

function AppShellContent({ session }: { session: ReturnType<typeof useAppSession> }) {
  const { colors, isDark } = useAppTheme();
  const styles = createStyles(colors);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.canvas).catch(() => undefined);
  }, [colors.canvas]);

  return (
    <AppErrorBoundary>
      <View style={styles.safeArea}>
        {session.profile ? <AuthenticatedPrivacyShield /> : null}
        <NavigationBar style={isDark ? 'dark' : 'light'} />
        <StatusBar style={isDark ? 'light' : 'dark'} />
        {!firebaseConfigStatus.ready ? (
          <MissingConfigScreen />
        ) : session.status === 'checking' ? (
          null
        ) : session.profile && (session.profile.accessStatus === 'suspended' || session.profile.accessStatus === 'revoked') ? (
          <AccountAccessScreen accessStatus={session.profile.accessStatus} onSignOut={session.signOut} />
        ) : session.profile && !session.profile.emailVerified ? (
          <EmailVerificationScreen
            email={session.profile.email}
            onRefresh={session.refreshProfile}
            onSend={session.sendAccountVerification}
            onSignOut={session.signOut}
          />
        ) : session.profile?.role === 'customer' ? (
          <BusinessSettingsProvider key={session.profile.uid} onSignOut={session.signOut} profile={session.profile}><CustomerWorkspaceScreen onSignOut={session.signOut} profile={session.profile} /></BusinessSettingsProvider>
        ) : session.profile ? (
          <BusinessSettingsProvider key={session.profile.uid} onSignOut={session.signOut} profile={session.profile}><WorkspaceScreen admin={session.profile} onSignOut={session.signOut} /></BusinessSettingsProvider>
        ) : (
          <SignInScreen error={session.error} loading={session.submitting} onForgotPassword={session.requestPasswordReset} onSignIn={session.signIn} />
        )}
      </View>
    </AppErrorBoundary>
  );
}

function AuthenticatedPrivacyShield() {
  usePreventScreenCapture('authenticated-session');
  return null;
}

function EmailVerificationScreen({ email, onRefresh, onSend, onSignOut }: {
  email: string;
  onRefresh: () => Promise<boolean>;
  onSend: () => Promise<void>;
  onSignOut: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const sent = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function sendVerification() {
    setBusy(true);
    setMessage('');
    try {
      await onSend();
      setMessage(t('Verification email sent. Check your inbox.'));
    } catch (sendError) {
      setMessage(sendError instanceof Error ? sendError.message : t('Could not send verification email.'));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setMessage('');
    try {
      if (!await onRefresh()) setMessage(t('Email is not verified yet.'));
    } catch (refreshError) {
      setMessage(refreshError instanceof Error ? refreshError.message : t('Could not refresh account access. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    sendVerification();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') onRefresh().catch(() => undefined);
    });
    return () => subscription.remove();
  }, [onRefresh]);

  return (
    <View style={styles.centered}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>@</Text></View>
      <Text style={styles.centerTitle}>{t('Verify your email')}</Text>
      <Text style={styles.centerText}>{t('We sent a verification link to')} {email}.</Text>
      {message ? <Text accessibilityLiveRegion="polite" style={styles.verificationMessage}>{message}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} onPress={refresh} style={styles.signOutButton}>
        <Text style={styles.signOutText}>{t(busy ? 'Checking...' : "I've verified my email")}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={sendVerification} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{t('Resend verification email')}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy} onPress={onSignOut} style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>{t('Logout')}</Text>
      </Pressable>
    </View>
  );
}

function AccountAccessScreen({ accessStatus, onSignOut }: { accessStatus: 'revoked' | 'suspended'; onSignOut: () => void }) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const suspended = accessStatus === 'suspended';

  return (
    <View style={styles.centered}>
      <View style={styles.warningMark}><Text style={styles.warningMarkText}>!</Text></View>
      <Text style={styles.centerTitle}>{t(suspended ? 'Access suspended' : 'Access revoked')}</Text>
      <Text style={styles.centerText}>
        {t(suspended ? 'Please contact the administrator to restore your access.' : 'This account is no longer active.')}
      </Text>
      <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOutButton}>
        <Text style={styles.signOutText}>{t('Logout')}</Text>
      </Pressable>
    </View>
  );
}

function MissingConfigScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);

  return (
    <View style={styles.centered}>
      <View style={styles.warningMark}>
        <Text style={styles.warningMarkText}>!</Text>
      </View>
      <Text style={styles.centerTitle}>{t('Setup needed')}</Text>
      <Text style={styles.centerText}>
        {t('Please complete app setup before signing in.')}
      </Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.canvas,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  brandMarkText: {
    color: colors.onBrand,
    fontSize: 28,
    fontWeight: typography.weight.black,
  },
  warningMark: {
    alignItems: 'center',
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  warningMarkText: {
    color: colors.warning,
    fontSize: 28,
    fontWeight: typography.weight.black,
  },
  centered: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  centerTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: typography.weight.black,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  centerText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  signOutButton: {
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  signOutText: {
    color: colors.onBrand,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  secondaryButton: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: typography.weight.black,
  },
  verificationMessage: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  });
}

const splashStyles = StyleSheet.create({
  app: {
    flex: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    zIndex: 100,
  },
  logoScene: {
    alignItems: 'center',
    height: 260,
    justifyContent: 'center',
    width: 260,
  },
  haloOuter: {
    borderColor: 'rgba(94,234,212,0.18)',
    borderRadius: 118,
    borderWidth: 1,
    height: 236,
    position: 'absolute',
    width: 236,
  },
  haloInner: {
    backgroundColor: 'rgba(45,212,191,0.07)',
    borderColor: 'rgba(94,234,212,0.36)',
    borderRadius: 92,
    borderWidth: 1,
    height: 184,
    position: 'absolute',
    width: 184,
  },
  spark: {
    backgroundColor: '#F5A06D',
    borderRadius: 5,
    height: 10,
    position: 'absolute',
    width: 10,
  },
  sparkTop: {
    right: 35,
    top: 51,
  },
  sparkBottom: {
    bottom: 39,
    left: 49,
  },
  logo: {
    alignItems: 'center',
    backgroundColor: '#147D64',
    borderRadius: 32,
    height: 128,
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { height: 14, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    width: 128,
  },
  logoInset: {
    alignItems: 'center',
    backgroundColor: '#2DD4BF',
    borderRadius: 25,
    height: 96,
    justifyContent: 'center',
    width: 96,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 54,
    fontWeight: typography.weight.black,
    letterSpacing: -3,
  },
  logoAccent: {
    backgroundColor: '#F5A06D',
    borderColor: '#0F172A',
    borderRadius: 10,
    borderWidth: 4,
    bottom: 3,
    height: 20,
    position: 'absolute',
    right: 3,
    width: 20,
  },
  eyebrow: {
    color: '#5EEAD4',
    fontSize: 12,
    fontWeight: typography.weight.black,
    letterSpacing: 4,
  },
  title: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: typography.weight.black,
    letterSpacing: -0.5,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: typography.weight.bold,
    letterSpacing: 2.2,
    marginTop: spacing.md,
  },
  track: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 3,
    height: 3,
    marginTop: 32,
    overflow: 'hidden',
    width: 120,
  },
  progress: {
    backgroundColor: '#2DD4BF',
    borderRadius: 3,
    height: 3,
    width: 120,
  },
});
