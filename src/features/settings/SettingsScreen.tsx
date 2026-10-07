import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { TextField } from '../../shared/components/TextField';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { useBusinessSettings } from './BusinessSettingsProvider';
import type { BusinessSettings } from '../customers/businessConfig';

const businessFields: Array<{ key: keyof BusinessSettings; label: string; numeric?: boolean }> = [
  { key: 'name', label: 'Business name' },
  { key: 'address', label: 'Business address' },
  { key: 'phone', label: 'Business phone' },
  { key: 'upiId', label: 'UPI ID for manual payments' },
  { key: 'roomStart', label: 'First room number', numeric: true },
  { key: 'roomCount', label: 'Number of rooms', numeric: true },
  { key: 'pgCapacity', label: 'PG capacity per room', numeric: true },
  { key: 'seatPrefix', label: 'Seat prefix (A-Z)' },
  { key: 'seatCount', label: 'Number of library seats', numeric: true },
  { key: 'defaultPgRent', label: 'Default monthly PG rent', numeric: true },
  { key: 'defaultHotelCharge', label: 'Default hotel stay charge', numeric: true },
  { key: 'defaultLibraryFee', label: 'Default library membership fee', numeric: true },
  { key: 'meterRate', label: 'Electricity rate per unit', numeric: true },
];

export function SettingsScreen() {
  const { colors, scheme, setThemePreference, themeOptions, themePreference } = useAppTheme();
  const { language, languageOptions, languagePreference, setLanguagePreference, t } = useLanguage();
  const styles = createStyles(colors);
  const { settings, save, isAdmin } = useBusinessSettings();
  const [draft, setDraft] = useState(() => Object.fromEntries(businessFields.map(({ key }) => [key, String(settings[key])])));
  const [upiQr, setUpiQr] = useState(settings.upiQr);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!dirty) { setDraft(Object.fromEntries(businessFields.map(({ key }) => [key, String(settings[key])]))); setUpiQr(settings.upiQr); }
  }, [settings, dirty]);

  async function chooseQr() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error('Photo library permission is required.');
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (result.canceled) return;
      const context = ImageManipulator.manipulate(result.assets[0].uri);
      context.resize({ width: 720 });
      const rendered = await context.renderAsync();
      const optimized = await rendered.saveAsync({ base64: true, compress: 0.8, format: SaveFormat.JPEG });
      if (!optimized.base64 || optimized.base64.length > 240000) throw new Error('QR image is too large. Crop it and try again.');
      setUpiQr(`data:image/jpeg;base64,${optimized.base64}`); setDirty(true); setMessage('QR selected. Verify it matches your UPI ID before saving.');
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : 'Could not read QR image.'); }
  }

  async function saveBusiness() {
    setSaving(true);
    setMessage('');
    setFailed(false);
    try {
      const next = Object.fromEntries(businessFields.map(({ key, numeric }) => [key, numeric ? draft[key].trim() ? Number(draft[key]) : Number.NaN : draft[key].trim()])) as BusinessSettings;
      next.upiQr = upiQr;
      next.seatPrefix = next.seatPrefix.toUpperCase();
      await save(next);
      setDirty(false);
      setMessage('Business settings saved.');
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not save business settings.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{t('Settings')}</Text>
        <Text style={styles.title}>{t('Preferences')}</Text>
        <Text style={styles.subtitle}>{t('Choose how the app should look and read on this device.')}</Text>
      </View>

      {isAdmin ? <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('Business settings')}</Text>
        <Text style={styles.sectionText}>{t('Changes apply to all devices. Default fees apply to new customers; existing charges stay unchanged.')}</Text>
        <View style={styles.options}>
          {businessFields.map(({ key, label, numeric }) => <TextField
            key={key} label={label} value={draft[key]} editable={!saving}
            keyboardType={numeric ? 'decimal-pad' : key === 'phone' ? 'phone-pad' : 'default'}
            maxLength={key === 'address' ? 500 : numeric ? 12 : key === 'seatPrefix' ? 1 : key === 'phone' ? 30 : 120}
            onChangeText={(value) => { setDraft((current) => ({ ...current, [key]: value })); setDirty(true); setMessage(''); }}
          />)}
          {upiQr ? <Image source={{ uri: upiQr }} style={{ width: 220, height: 220, alignSelf: 'center' }} resizeMode="contain" accessibilityLabel="Business UPI QR preview" /> : null}
          <PrimaryButton label={upiQr ? "Replace UPI QR image" : "Add UPI QR image"} loading={saving} onPress={chooseQr} />
          {upiQr ? <PrimaryButton label="Remove UPI QR image" loading={saving} onPress={() => { setUpiQr(''); setDirty(true); }} /> : null}
          <PrimaryButton label="Save business settings" loading={saving} onPress={saveBusiness} />
          {message ? <Text accessibilityLiveRegion="polite" style={{ color: failed ? colors.danger : colors.success }}>{t(message)}</Text> : null}
        </View>
      </View> : null}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('App language')}</Text>
        <Text style={styles.sectionText}>
          {t(languagePreference === 'system' ? 'Following your device language.' : 'Using a fixed app language.')}
        </Text>
        <View style={styles.options}>
          {languageOptions.map((item) => {
            const active = item.code === languagePreference;
            const isSystem = item.code === 'system';

            return (
              <Pressable
                accessibilityRole="button"
                key={item.code}
                onPress={() => setLanguagePreference(item.code)}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{t(item.label)}</Text>
                <Text style={[styles.optionMeta, active && styles.optionMetaActive]}>
                  {isSystem ? `${t('Current')}: ${language === 'hi' ? 'हिंदी' : 'English'}` : item.nativeLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('Theme')}</Text>
        <Text style={styles.sectionText}>
          {t(themePreference === 'system' ? 'Following your device theme.' : 'Using a fixed app theme.')}
        </Text>
        <View style={styles.options}>
          {themeOptions.map((item) => {
            const active = item.value === themePreference;

            return (
              <Pressable
                accessibilityRole="button"
                key={item.value}
                onPress={() => setThemePreference(item.value)}
                style={[styles.option, active && styles.optionActive]}
              >
                <Text style={[styles.optionTitle, active && styles.optionTitleActive]}>{t(item.label)}</Text>
                <Text style={[styles.optionMeta, active && styles.optionMetaActive]}>
                  {item.value === 'system' ? `${t('Current')}: ${t(scheme === 'dark' ? 'Dark' : 'Light')}` : t(item.value === 'dark' ? 'Dark mode' : 'Light mode')}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      backgroundColor: colors.ink,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    kicker: {
      color: colors.panelAccent,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.onBrand,
      fontSize: 30,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    subtitle: {
      color: colors.panelMuted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: typography.weight.black,
    },
    sectionText: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.xs,
    },
    options: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    option: {
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md,
    },
    optionActive: {
      backgroundColor: colors.ink,
      borderColor: colors.ink,
    },
    optionTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: typography.weight.black,
    },
    optionTitleActive: {
      color: colors.onBrand,
    },
    optionMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      marginTop: spacing.xs,
    },
    optionMetaActive: {
      color: colors.panelMuted,
    },
  });
}
