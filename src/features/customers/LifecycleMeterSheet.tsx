import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { radius, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import type { TenantRecord } from '../../shared/types/records';
import { toNumber } from '../../shared/utils/money';
import { getMeterReadingCandidates, MAX_BILLABLE_METER_UNITS } from '../operations/operationsMath';
import { getCustomerName } from './customerUtils';

export type LifecycleMeterResult = {
  ocrText: string;
  photo: string;
  photoSize: number;
  photoSource: 'camera' | 'gallery';
  reading: number;
};

type LifecycleAction = 'check-in' | 'check-out';

export function LifecycleMeterSheet({
  action,
  customer,
  minimumReading,
  onClose,
  onSubmit,
  saving,
}: {
  action: LifecycleAction;
  customer: TenantRecord;
  minimumReading: number;
  onClose: () => void;
  onSubmit: (result: LifecycleMeterResult) => void;
  saving: boolean;
}) {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const [photo, setPhoto] = useState('');
  const [photoSize, setPhotoSize] = useState(0);
  const [ocrText, setOcrText] = useState('');
  const [reading, setReading] = useState('');
  const [readingCandidates, setReadingCandidates] = useState<number[]>([]);
  const [photoSource, setPhotoSource] = useState<LifecycleMeterResult['photoSource']>('camera');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const title = action === 'check-in' ? t('Check-in meter reading') : t('Check-out meter reading');

  async function chooseAndRead(source: LifecycleMeterResult['photoSource']) {
    setError('');
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(t(source === 'camera'
        ? 'Camera permission is required to scan the meter.'
        : 'Photo library permission is required to select a meter photo.'));
      return;
    }

    const pickerOptions: ImagePicker.ImagePickerOptions = {
      allowsEditing: true,
      mediaTypes: ['images'],
      quality: 0.8,
    };
    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync(pickerOptions)
      : await ImagePicker.launchImageLibraryAsync(pickerOptions);

    if (result.canceled || !result.assets[0]?.uri) return;

    setScanning(true);

    try {
      const context = ImageManipulator.manipulate(result.assets[0].uri);
      context.resize({ width: 1024 });
      const rendered = await context.renderAsync();
      const optimized = await rendered.saveAsync({ base64: true, compress: 0.45, format: SaveFormat.JPEG });

      if (!optimized.base64) throw new Error(t('Could not prepare meter photo.'));
      if (optimized.base64.length > 650_000) {
        throw new Error(t('Meter photo is too large. Move closer and retake it.'));
      }

      const recognized = Platform.OS === 'web'
        ? { text: '' }
        : await (await import('@infinitered/react-native-mlkit-text-recognition')).recognizeText(optimized.uri);
      const detectedCandidates = getMeterReadingCandidates(recognized.text, minimumReading);
      const suggested = detectedCandidates[0];

      setPhoto(`data:image/jpeg;base64,${optimized.base64}`);
      setPhotoSize(optimized.base64.length);
      setPhotoSource(source);
      setOcrText(recognized.text);
      setReadingCandidates(detectedCandidates.slice(0, 6));
      setReading(suggested === undefined ? '' : String(suggested));

      if (suggested === undefined) setError(t(Platform.OS === 'web'
        ? 'Enter the meter reading from the photo. Automatic scanning is available in the Android app.'
        : 'No safe meter reading was detected. Enter it from the photo.'));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : t('Could not read meter photo.'));
    } finally {
      setScanning(false);
    }
  }

  function submit() {
    const numericReading = toNumber(reading);

    if (!photo) {
      setError(t('Take a meter photo before continuing.'));
      return;
    }

    if (!reading.trim() || !Number.isFinite(numericReading)) {
      setError(t('Confirm a valid meter reading.'));
      return;
    }

    if (numericReading < minimumReading) {
      setError(`${t('Meter reading cannot be less than')} ${minimumReading}.`);
      return;
    }

    if (action === 'check-out' && numericReading - minimumReading > MAX_BILLABLE_METER_UNITS) {
      setError(t('This reading is unusually high. Check the photo and correct the number.'));
      return;
    }

    onSubmit({ ocrText, photo, photoSize, photoSource, reading: numericReading });
  }

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <View style={styles.headerCopy}>
                <Text style={styles.kicker}>{t(action === 'check-in' ? 'Check in' : 'Check out')}</Text>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{getCustomerName(customer)} / {String(customer.room || '-')}</Text>
              </View>
              <Pressable disabled={saving || scanning} onPress={onClose} style={styles.closeButton}>
                <Text style={styles.closeText}>{t('Close')}</Text>
              </Pressable>
            </View>

            <View style={styles.minimumBox}>
              <Text style={styles.minimumLabel}>{t('Minimum allowed reading')}</Text>
              <Text style={styles.minimumValue}>{minimumReading}</Text>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {photo ? <Image resizeMode="contain" source={{ uri: photo }} style={styles.preview} /> : null}

            <View style={styles.photoActions}>
              <Pressable disabled={saving || scanning} onPress={() => chooseAndRead('camera')} style={styles.cameraButton}>
                {scanning ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.cameraButtonText}>{t(photo ? 'Retake photo' : 'Take meter photo')}</Text>}
              </Pressable>
              <Pressable disabled={saving || scanning} onPress={() => chooseAndRead('gallery')} style={styles.galleryButton}>
                <Text style={styles.galleryButtonText}>{t('Choose from gallery')}</Text>
              </Pressable>
            </View>

            {readingCandidates.length > 1 ? (
              <View style={styles.suggestions}>
                <Text style={styles.readingLabel}>{t('Numbers found in photo')}</Text>
                <View style={styles.suggestionRail}>
                  {readingCandidates.map((candidate) => (
                    <Pressable key={candidate} onPress={() => setReading(String(candidate))} style={styles.suggestion}>
                      <Text style={styles.suggestionText}>{candidate}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.readingField}>
              <Text style={styles.readingLabel}>{t('Confirm meter reading')}</Text>
              <View style={styles.lockedReading}>
                <TextInput
                  keyboardType="decimal-pad"
                  onChangeText={(value) => {
                    setReading(value);
                    setError('');
                  }}
                  placeholder={t('Enter the number shown on the meter')}
                  placeholderTextColor={colors.muted}
                  style={styles.readingValue}
                  value={reading}
                />
              </View>
            </View>

            <Text style={styles.help}>{t(Platform.OS === 'web' ? 'Match the number with the photo before saving.' : 'OCR is only a suggestion. Match the number with the photo before saving.')}</Text>

            <View style={styles.actions}>
              <Pressable disabled={saving || scanning} onPress={onClose} style={styles.secondaryAction}>
                <Text style={styles.secondaryText}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable disabled={saving || scanning} onPress={submit} style={[styles.primaryAction, (saving || scanning) && styles.disabled]}>
                {saving ? <ActivityIndicator color={colors.onBrand} /> : <Text style={styles.primaryText}>{t(action === 'check-in' ? 'Save & check in' : 'Save & check out')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    backdrop: { backgroundColor: 'rgba(0,0,0,0.58)', flex: 1, justifyContent: 'flex-end' },
    sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, maxHeight: '94%', padding: spacing.lg },
    handle: { alignSelf: 'center', backgroundColor: colors.border, borderRadius: radius.sm, height: 4, marginBottom: spacing.lg, width: 44 },
    header: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
    headerCopy: { flex: 1 },
    kicker: { color: colors.link, fontSize: 12, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    title: { color: colors.text, fontSize: 23, fontWeight: typography.weight.black, marginTop: 4 },
    subtitle: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold, marginTop: 5 },
    closeButton: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    closeText: { color: colors.text, fontSize: 13, fontWeight: typography.weight.black },
    minimumBox: { alignItems: 'center', backgroundColor: colors.skySoft, borderRadius: radius.md, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.lg, padding: spacing.md },
    minimumLabel: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold },
    minimumValue: { color: colors.text, fontSize: 20, fontWeight: typography.weight.black },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, fontSize: 13, fontWeight: typography.weight.bold, lineHeight: 19, marginTop: spacing.md, padding: spacing.md },
    preview: { backgroundColor: colors.surfaceMuted, borderRadius: radius.md, height: 210, marginTop: spacing.md, width: '100%' },
    photoActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    cameraButton: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.md, flex: 1, justifyContent: 'center', minHeight: 50 },
    cameraButtonText: { color: colors.onBrand, fontSize: 14, fontWeight: typography.weight.black },
    galleryButton: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: 'center', minHeight: 50 },
    galleryButtonText: { color: colors.text, fontSize: 14, fontWeight: typography.weight.black },
    suggestions: { marginTop: spacing.md },
    suggestionRail: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
    suggestion: { backgroundColor: colors.skySoft, borderRadius: radius.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    suggestionText: { color: colors.text, fontSize: 14, fontWeight: typography.weight.black },
    readingField: { marginTop: spacing.lg },
    readingLabel: { color: colors.muted, fontSize: 12, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    lockedReading: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, minHeight: 56, paddingHorizontal: spacing.md },
    readingValue: { color: colors.text, flex: 1, fontSize: 22, fontWeight: typography.weight.black },
    readingPlaceholder: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold },
    lockedBadge: { backgroundColor: colors.accentSoft, borderRadius: radius.sm, color: colors.link, fontSize: 11, fontWeight: typography.weight.black, marginLeft: spacing.sm, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: 5, textTransform: 'uppercase' },
    help: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    secondaryAction: { alignItems: 'center', backgroundColor: colors.surfaceMuted, borderRadius: radius.md, flex: 1, justifyContent: 'center', minHeight: 48 },
    secondaryText: { color: colors.text, fontSize: 14, fontWeight: typography.weight.black },
    primaryAction: { alignItems: 'center', backgroundColor: colors.ink, borderRadius: radius.md, flex: 1.5, justifyContent: 'center', minHeight: 48 },
    primaryText: { color: colors.onBrand, fontSize: 14, fontWeight: typography.weight.black },
    disabled: { opacity: 0.5 },
  });
}
