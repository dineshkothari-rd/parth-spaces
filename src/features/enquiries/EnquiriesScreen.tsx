import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { collection, deleteDoc, doc, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { db } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import type { EnquiryRecord } from '../../shared/types/records';
import { businessTypeOptions, getBusinessType } from '../customers/businessTypes';
import { FilterPill } from '../customers/FilterPill';
import { editableEnquiryStatuses, enquiryStatuses } from './enquiryStatuses';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import { useBusinessSettings } from '../settings/BusinessSettingsProvider';

function getStatus(enquiry: EnquiryRecord) {
  return enquiry.status || 'New';
}

function matchesSearch(enquiry: EnquiryRecord, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) return true;

  return [enquiry.name, enquiry.phone, enquiry.email, enquiry.roomType, enquiry.message].some((value) =>
    String(value || '').toLowerCase().includes(query),
  );
}

function countByStatus(enquiries: EnquiryRecord[], status: string) {
  return enquiries.filter((enquiry) => getStatus(enquiry) === status).length;
}

function formatDate(createdAt: EnquiryRecord['createdAt']) {
  if (!createdAt) return 'Just now';

  if (typeof createdAt.toDate === 'function') {
    return createdAt.toDate().toLocaleString('en-IN', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    });
  }

  if (createdAt.seconds) {
    return new Date(createdAt.seconds * 1000).toLocaleString('en-IN', {
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    });
  }

  return 'Just now';
}

function cleanPhone(phone: unknown) {
  return String(phone || '').replace(/\D/g, '');
}

function inferBusinessType(enquiry: EnquiryRecord) {
  if (enquiry.businessType && businessTypeOptions.some((type) => type.id === enquiry.businessType)) {
    return enquiry.businessType;
  }

  const text = [enquiry.roomType, enquiry.message].join(' ').toLowerCase();

  if (/(library|seat|locker|reading|study)/.test(text)) return 'library';
  if (/(hotel|guest|night|check.?in|check.?out|stay)/.test(text)) return 'hotel';
  return 'pg';
}

function openLink(url: string) {
  Linking.openURL(url).catch(() => undefined);
}

export function EnquiriesScreen() {
  const { settings, can } = useBusinessSettings();
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  const [convertingId, setConvertingId] = useState('');
  const [actionError, setActionError] = useState('');
  const enquiries = useFirestoreCollection<EnquiryRecord>('enquiries', { sortBy: 'createdAt' });
  const filtered = useMemo(
    () =>
      enquiries.data.filter((enquiry) => {
        const statusMatches = statusFilter ? getStatus(enquiry) === statusFilter : true;
        return statusMatches && matchesSearch(enquiry, search);
      }),
    [enquiries.data, search, statusFilter],
  );

  function clearFilters() {
    setSearch('');
    setStatusFilter('');
  }

  async function updateStatus(enquiry: EnquiryRecord, status: string) {
    setBusyId(enquiry.id);
    setActionError('');

    try {
      await updateDoc(doc(db, 'enquiries', enquiry.id), {
        status,
        updatedAt: serverTimestamp(),
      });
    } catch (statusError) {
      setActionError(statusError instanceof Error ? statusError.message : t('Could not update enquiry status.'));
    } finally {
      setBusyId('');
    }
  }

  async function deleteEnquiry(enquiryId: string) {
    setBusyId(enquiryId);
    setActionError('');

    try {
      await deleteDoc(doc(db, 'enquiries', enquiryId));
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not delete enquiry.'));
    } finally {
      setBusyId('');
    }
  }

  async function convertEnquiry(enquiry: EnquiryRecord) {
    const businessType = inferBusinessType(enquiry);
    const type = getBusinessType(businessType);
    const status = businessType === 'library' ? 'booked' : type.statusOptions[0]?.value || 'booked';

    setConvertingId(enquiry.id);
    setActionError('');

    try {
      const enquiryRef = doc(db, 'enquiries', enquiry.id);
      const customerRef = doc(collection(db, 'tenants'));
      await runTransaction(db, async (transaction) => {
        const latest = await transaction.get(enquiryRef);
        if (!latest.exists() || latest.data().status === 'Converted') throw new Error(t('This enquiry is already converted.'));

        transaction.set(customerRef, {
          businessType,
          createdAt: serverTimestamp(),
          email: enquiry.email || '',
          idProof: null,
          idProofName: null,
          idProofSize: 0,
          idProofType: null,
          moveInDate: '',
          moveInTime: '12:00',
          moveOutDate: '',
          moveOutTime: '11:00',
          name: enquiry.name || t('Unnamed enquiry'),
          phone: enquiry.phone || '',
          rent: businessType === 'pg' ? settings.defaultPgRent : businessType === 'hotel' ? settings.defaultHotelCharge : settings.defaultLibraryFee,
          room: '',
          roomType: enquiry.roomType || '',
          services: [],
          sourceEnquiryId: enquiry.id,
          sourceMessage: enquiry.message || '',
          status,
        });
        transaction.update(enquiryRef, {
          convertedAt: serverTimestamp(),
          customerId: customerRef.id,
          status: 'Converted',
          updatedAt: serverTimestamp(),
        });
      });
    } catch (convertError) {
      setActionError(convertError instanceof Error ? convertError.message : t('Could not convert enquiry.'));
    } finally {
      setConvertingId('');
    }
  }

  function confirmDelete(enquiry: EnquiryRecord) {
    Alert.alert(t('Delete enquiry?'), `${t('Delete enquiry from')} ${enquiry.name || t('this person')}? ${t('This cannot be undone.')}`, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => deleteEnquiry(enquiry.id) },
    ]);
  }

  return (
    <View>
      <View style={styles.hero}>
        <View>
          <Text style={styles.kicker}>{t('New enquiries')}</Text>
          <Text style={styles.title}>{t('Enquiries')}</Text>
          <Text style={styles.subtitle}>{t('Call, message, and turn interested people into customers.')}</Text>
        </View>
        <View style={styles.metrics}>
          <Metric label={t('Total')} styles={styles} value={String(enquiries.data.length)} />
          <Metric label={t('New')} styles={styles} value={String(countByStatus(enquiries.data, 'New'))} />
          <Metric label={t('Converted')} styles={styles} value={String(countByStatus(enquiries.data, 'Converted'))} />
        </View>
      </View>

      {enquiries.loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading enquiries')}</Text>
        </View>
      ) : null}

      {enquiries.error ? <Text style={styles.errorText}>{enquiries.error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.toolbar}>
        <TextField label="Search enquiries" onChangeText={setSearch} placeholder="Name, phone, room, seat..." value={search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail}>
          {enquiryStatuses.map((status) => (
            <FilterPill
              active={statusFilter === status.value}
              key={status.label}
              label={status.label}
              onPress={() => setStatusFilter(status.value)}
            />
          ))}
        </ScrollView>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{t('Showing')}</Text>
        <Text style={styles.summaryValue}>{filtered.length}</Text>
        <Text style={styles.summaryMeta}>{t(statusFilter || search ? 'Filtered enquiries' : 'All enquiries')}</Text>
      </View>

      {filtered.length ? (
        filtered.slice(0, 50).map((enquiry) => (
          <EnquiryCard
            busy={busyId === enquiry.id}
            enquiry={enquiry}
            key={enquiry.id}
            onConvert={can('customers') ? () => convertEnquiry(enquiry) : undefined}
            onDelete={() => confirmDelete(enquiry)}
            onStatusChange={(status) => updateStatus(enquiry, status)}
            styles={styles}
            converting={convertingId === enquiry.id}
          />
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('No enquiries found')}</Text>
          <Text style={styles.emptyText}>{t('Try changing the search or filters.')}</Text>
          {search || statusFilter ? (
            <Pressable onPress={clearFilters} style={styles.emptyAction}>
              <Text style={styles.emptyActionText}>{t('Clear filters')}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

function EnquiryCard({
  busy,
  converting,
  enquiry,
  onConvert,
  onDelete,
  onStatusChange,
  styles,
}: {
  busy: boolean;
  converting: boolean;
  enquiry: EnquiryRecord;
  onConvert?: () => void;
  onDelete: () => void;
  onStatusChange: (status: string) => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const status = getStatus(enquiry);
  const phone = cleanPhone(enquiry.phone);
  const inferredType = getBusinessType(inferBusinessType(enquiry));
  const converted = status === 'Converted';
  const whatsappMessage = encodeURIComponent(
    `Hi ${enquiry.name || ''}, thanks for your enquiry. We can help you with availability and pricing.`,
  );

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardCopy}>
          <Text style={styles.name}>{enquiry.name || t('Unnamed enquiry')}</Text>
          <Text style={styles.date}>{formatDate(enquiry.createdAt)}</Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{t(status)}</Text>
        </View>
      </View>

      <View style={styles.infoGrid}>
        <InfoBox label={t('Phone')} styles={styles} value={enquiry.phone || '-'} />
        <InfoBox label={t('For')} styles={styles} value={t(inferredType.label)} />
        <InfoBox label={t('Requirement')} styles={styles} value={enquiry.roomType || t('Not selected')} />
      </View>

      {enquiry.email ? <Text style={styles.email}>{enquiry.email}</Text> : null}
      {enquiry.message ? <Text style={styles.message}>{enquiry.message}</Text> : null}

      <Text style={styles.sectionLabel}>{t('Status')}</Text>
      <View style={styles.statusRail}>
        {editableEnquiryStatuses.map((option) => {
          const active = status === option.value;

          return (
            <Pressable
              disabled={busy || active}
              key={option.value}
              onPress={() => onStatusChange(option.value)}
              style={[styles.statusChip, active && styles.statusChipActive, busy && styles.disabled]}
            >
              <Text style={[styles.statusChipText, active && styles.statusChipTextActive]}>{t(option.label)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.actions}>
        <Pressable disabled={!phone} onPress={() => openLink(`tel:${phone}`)} style={[styles.actionButton, !phone && styles.disabled]}>
          <Text style={styles.actionText}>{t('Call')}</Text>
        </Pressable>
        <Pressable
          disabled={!enquiry.email}
          onPress={() => openLink(`mailto:${enquiry.email}`)}
          style={[styles.actionButton, styles.actionButtonSurface, !enquiry.email && styles.disabled]}
        >
          <Text style={styles.actionTextAlt}>{t('Email')}</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable disabled={!phone} onPress={() => openLink(`https://wa.me/${phone}?text=${whatsappMessage}`)} style={[styles.actionButton, styles.actionButtonAccent, !phone && styles.disabled]}>
          <Text style={styles.actionText}>{t('WhatsApp')}</Text>
        </Pressable>
        <Pressable disabled={!onConvert || busy || converting || converted} onPress={onConvert} style={[styles.actionButton, styles.actionButtonSurface, (!onConvert || busy || converting || converted) && styles.disabled]}>
          <Text style={styles.actionTextAlt}>{t(converted ? 'Converted' : converting ? 'Converting...' : 'Convert')}</Text>
        </Pressable>
      </View>

      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={onDelete} style={[styles.actionButton, styles.deleteButton, busy && styles.disabled]}>
          <Text style={styles.deleteText}>{t(busy ? 'Saving...' : 'Delete')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function InfoBox({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return (
    <View style={styles.infoBox}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Metric({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: {
      backgroundColor: colors.ink,
      borderRadius: radius.lg,
      padding: spacing.lg,
    },
    kicker: {
      color: colors.panelAccent,
      fontSize: 13,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.panelText,
      fontSize: 29,
      fontWeight: typography.weight.black,
      lineHeight: 34,
      marginTop: spacing.xs,
    },
    subtitle: {
      color: colors.panelMuted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.sm,
    },
    metrics: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    metric: {
      backgroundColor: colors.overlayFaint,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    metricLabel: {
      color: colors.panelSubtle,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    metricValue: {
      color: colors.panelText,
      fontSize: 18,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    statusText: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
    },
    errorText: {
      backgroundColor: colors.dangerSoft,
      borderColor: colors.danger,
      borderRadius: radius.md,
      borderWidth: 1,
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      lineHeight: 19,
      marginTop: spacing.lg,
      padding: spacing.md,
    },
    toolbar: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    filterRail: {
      gap: spacing.sm,
      paddingRight: spacing.lg,
    },
    summaryCard: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    summaryLabel: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    summaryValue: {
      color: colors.text,
      fontSize: 28,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    summaryMeta: {
      color: colors.muted,
      fontSize: 13,
      fontWeight: typography.weight.bold,
      lineHeight: 19,
      marginTop: spacing.xs,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.md,
      padding: spacing.lg,
      ...shadow.card,
    },
    cardHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cardCopy: {
      flex: 1,
    },
    name: {
      color: colors.text,
      fontSize: 16,
      fontWeight: typography.weight.black,
    },
    date: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.bold,
      marginTop: spacing.xs,
    },
    badge: {
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    badgeText: {
      color: colors.text,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    infoGrid: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    infoBox: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    infoLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    infoValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    email: {
      color: colors.success,
      fontSize: 14,
      fontWeight: typography.weight.black,
      marginTop: spacing.md,
    },
    message: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      color: colors.muted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.md,
      padding: spacing.md,
    },
    sectionLabel: {
      color: colors.text,
      fontSize: 12,
      fontWeight: typography.weight.black,
      marginTop: spacing.md,
      textTransform: 'uppercase',
    },
    statusRail: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.sm,
    },
    statusChip: {
      backgroundColor: colors.surfaceRaised,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
    },
    statusChipActive: {
      backgroundColor: colors.ink,
      borderColor: colors.ink,
    },
    statusChipText: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
    },
    statusChipTextActive: {
      color: colors.onBrand,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    actionButton: {
      alignItems: 'center',
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 44,
      justifyContent: 'center',
    },
    actionButtonSurface: {
      backgroundColor: colors.surfaceMuted,
    },
    actionButtonAccent: {
      backgroundColor: colors.success,
    },
    actionText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    actionTextAlt: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    deleteButton: {
      backgroundColor: colors.dangerSoft,
    },
    deleteText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    disabled: {
      opacity: 0.45,
    },
    emptyState: {
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderColor: colors.borderSoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginTop: spacing.md,
      padding: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: typography.weight.black,
      textAlign: 'center',
    },
    emptyText: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    emptyAction: {
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      marginTop: spacing.lg,
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    emptyActionText: {
      color: colors.onBrand,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
  });
}
