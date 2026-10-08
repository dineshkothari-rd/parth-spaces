import { Alert } from '../../shared/utils/alert';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { addDoc, collection, deleteDoc, deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { db } from '../../lib/firebase/client';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import type { NoticeRecord, TenantRecord } from '../../shared/types/records';
import { FilterPill } from '../customers/FilterPill';
import { getCustomerAllocationLabel, getCustomerName } from '../customers/customerUtils';
import { editableNoticeTypes, getNoticeType, noticeTypes } from './noticeTypes';
import { useLanguage } from '../../shared/i18n/LanguageProvider';

type NoticeDraft = {
  audience: 'all' | 'customer' | 'staff';
  message: string;
  tenantId?: string;
  tenantName?: string;
  title: string;
  type: string;
};

function matchesSearch(notice: NoticeRecord, search: string) {
  const query = search.trim().toLowerCase();

  if (!query) return true;

  return [notice.title, notice.message].some((value) => String(value || '').toLowerCase().includes(query));
}

function countByType(notices: NoticeRecord[], type: string) {
  return notices.filter((notice) => notice.type === type).length;
}

function formatDate(createdAt: NoticeRecord['createdAt']) {
  if (!createdAt) return '';

  if (typeof createdAt.toDate === 'function') {
    return createdAt.toDate().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  if (createdAt.seconds) {
    return new Date(createdAt.seconds * 1000).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  return '';
}

export function NoticesScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [editingNotice, setEditingNotice] = useState<NoticeRecord | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [actionError, setActionError] = useState('');
  const notices = useFirestoreCollection<NoticeRecord>('notices', { sortBy: 'createdAt' });
  const tenants = useFirestoreCollection<TenantRecord>('tenants');
  const filtered = useMemo(
    () =>
      notices.data.filter((notice) => {
        const typeMatches = typeFilter ? notice.type === typeFilter : true;
        return typeMatches && matchesSearch(notice, search);
      }),
    [notices.data, search, typeFilter],
  );

  function clearFilters() {
    setSearch('');
    setTypeFilter('');
  }

  function openCreateForm() {
    setEditingNotice(null);
    setActionError('');
    setShowForm(true);
  }

  function openEditForm(notice: NoticeRecord) {
    setEditingNotice(notice);
    setActionError('');
    setShowForm(true);
  }

  async function saveNotice(payload: NoticeDraft) {
    setSaving(true);
    setActionError('');

    try {
      if (editingNotice) {
        await updateDoc(doc(db, 'notices', editingNotice.id), {
          ...payload,
          tenantId: payload.tenantId || deleteField(),
          tenantName: payload.tenantName || deleteField(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'notices'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      setShowForm(false);
      setEditingNotice(null);
    } catch (saveError) {
      setActionError(saveError instanceof Error ? saveError.message : t('Could not save notice.'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteNotice(noticeId: string) {
    setDeletingId(noticeId);
    setActionError('');

    try {
      await deleteDoc(doc(db, 'notices', noticeId));
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : t('Could not delete notice.'));
    } finally {
      setDeletingId('');
    }
  }

  function confirmDelete(notice: NoticeRecord) {
    Alert.alert(t('Delete notice?'), `${t('Delete')} "${notice.title || t('Notice')}"? ${t('This cannot be undone.')}`, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Delete'), style: 'destructive', onPress: () => deleteNotice(notice.id) },
    ]);
  }

  return (
    <View style={styles.wrap}>
      {showForm ? (
        <NoticeFormSheet
          notice={editingNotice}
          onClose={() => {
            setShowForm(false);
            setEditingNotice(null);
          }}
          onSubmit={saveNotice}
          saving={saving}
          styles={styles}
          tenants={tenants.data}
        />
      ) : null}

      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View>
            <Text style={styles.kicker}>{t('Announcements')}</Text>
            <Text style={styles.title}>{t('Notices')}</Text>
            <Text style={styles.subtitle}>{t('Share important updates with everyone quickly.')}</Text>
          </View>
          <Pressable onPress={openCreateForm} style={styles.addButton}>
            <Text style={styles.addButtonText}>{t('Add notice')}</Text>
          </Pressable>
        </View>

        <View style={styles.metrics}>
          <Metric label={t('Total')} styles={styles} value={String(notices.data.length)} />
          <Metric danger label={t('Urgent')} styles={styles} value={String(countByType(notices.data, 'danger'))} />
          <Metric label={t('Warnings')} styles={styles} value={String(countByType(notices.data, 'warning'))} />
        </View>
      </View>

      {notices.loading ? (
        <View style={styles.statusRow}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.statusText}>{t('Loading notices')}</Text>
        </View>
      ) : null}

      {notices.error ? <Text style={styles.errorText}>{notices.error}</Text> : null}
      {actionError ? <Text style={styles.errorText}>{actionError}</Text> : null}

      <View style={styles.toolbar}>
        <TextField label="Search notices" onChangeText={setSearch} placeholder="Title or message..." value={search} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRail}>
          {noticeTypes.map((type) => (
            <FilterPill active={typeFilter === type.value} key={type.label} label={type.label} onPress={() => setTypeFilter(type.value)} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>{t('Showing')}</Text>
        <Text style={styles.summaryValue}>{filtered.length}</Text>
        <Text style={styles.summaryMeta}>{t(typeFilter || search ? 'Filtered notices' : 'All notices')}</Text>
      </View>

      {filtered.length ? (
        filtered.slice(0, 50).map((notice) => (
          <NoticeCard
            deleting={deletingId === notice.id}
            key={notice.id}
            notice={notice}
            onDelete={() => confirmDelete(notice)}
            onEdit={() => openEditForm(notice)}
            styles={styles}
          />
        ))
      ) : (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{t('No notices found')}</Text>
          <Text style={styles.emptyText}>{t('Add a notice or change the filters.')}</Text>
          <Pressable onPress={notices.data.length ? clearFilters : openCreateForm} style={styles.emptyAction}>
            <Text style={styles.emptyActionText}>{t(notices.data.length ? 'Clear filters' : 'Add notice')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function NoticeFormSheet({
  notice,
  onClose,
  onSubmit,
  saving,
  styles,
  tenants,
}: {
  notice: NoticeRecord | null;
  onClose: () => void;
  onSubmit: (payload: NoticeDraft) => void;
  saving: boolean;
  styles: ReturnType<typeof createStyles>;
  tenants: TenantRecord[];
}) {
  const { t } = useLanguage();
  const [title, setTitle] = useState(notice?.title || '');
  const [message, setMessage] = useState(notice?.message || '');
  const [type, setType] = useState(notice?.type || 'info');
  const [audience, setAudience] = useState<NoticeDraft['audience']>(notice ? notice.audience || 'staff' : 'all');
  const [tenantId, setTenantId] = useState(notice?.tenantId || '');
  const [formError, setFormError] = useState('');
  const selectedTenant = tenants.find((tenant) => tenant.id === tenantId);

  function submit() {
    if (!title.trim() || !message.trim()) {
      setFormError(t('Title and message are required.'));
      return;
    }

    if (audience === 'customer' && !selectedTenant) {
      setFormError(t('Select a customer first.'));
      return;
    }

    onSubmit({
      audience,
      message: message.trim(),
      ...(audience === 'customer' && selectedTenant ? {
        tenantId: selectedTenant.id,
        tenantName: getCustomerName(selectedTenant),
      } : {}),
      title: title.trim(),
      type,
    });
  }

  return (
    <Modal animationType="slide" transparent visible onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetBackdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetKicker}>{t(notice ? 'Edit announcement' : 'New announcement')}</Text>
                <Text style={styles.sheetTitle}>{t(notice ? 'Edit notice' : 'Add notice')}</Text>
              </View>
              <Pressable disabled={saving} onPress={onClose} style={styles.sheetCloseButton}>
                <Text style={styles.sheetCloseText}>{t('Close')}</Text>
              </Pressable>
            </View>

            {formError ? <Text style={styles.errorText}>{formError}</Text> : null}

            <Text style={styles.formLabel}>{t('Audience')}</Text>
            <View style={styles.typeRail}>
              {[
                { label: 'All customers', value: 'all' },
                { label: 'One customer', value: 'customer' },
                { label: 'Staff only', value: 'staff' },
              ].map((item) => (
                <FilterPill
                  active={audience === item.value}
                  key={item.value}
                  label={item.label}
                  onPress={() => {
                    setAudience(item.value as NoticeDraft['audience']);
                    setFormError('');
                  }}
                />
              ))}
            </View>

            {audience === 'customer' ? (
              <>
                <Text style={styles.formLabel}>{t('Customer')}</Text>
                {tenants.length ? (
                  <ScrollView nestedScrollEnabled style={styles.targetPicker} contentContainerStyle={styles.targetPickerContent}>
                    {tenants.slice(0, 80).map((tenant) => (
                      <FilterPill
                        active={tenantId === tenant.id}
                        key={tenant.id}
                        label={`${getCustomerName(tenant)} / ${getCustomerAllocationLabel(tenant)}`}
                        onPress={() => {
                          setTenantId(tenant.id);
                          setFormError('');
                        }}
                      />
                    ))}
                  </ScrollView>
                ) : <Text style={styles.formHelpText}>{t('No customers found')}</Text>}
              </>
            ) : null}

            <Text style={styles.formLabel}>{t('Type')}</Text>
            <View style={styles.typeRail}>
              {editableNoticeTypes.map((item) => (
                <FilterPill active={type === item.value} key={item.value} label={item.label} onPress={() => setType(item.value)} />
              ))}
            </View>

            <View style={styles.formGrid}>
              <TextField
                label="Title"
                onChangeText={(value) => {
                  setTitle(value);
                  setFormError('');
                }}
                placeholder="Water supply interruption"
                value={title}
              />
              <TextField
                label="Message"
                multiline
                onChangeText={(value) => {
                  setMessage(value);
                  setFormError('');
                }}
                placeholder="Write the notice details..."
                value={message}
              />
            </View>

            <View style={styles.sheetActions}>
              <Pressable disabled={saving} onPress={onClose} style={[styles.sheetSecondaryAction, saving && styles.disabled]}>
                <Text style={styles.sheetSecondaryText}>{t('Cancel')}</Text>
              </Pressable>
              <Pressable disabled={saving} onPress={submit} style={[styles.sheetPrimaryAction, saving && styles.disabled]}>
                {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetPrimaryText}>{t(notice ? 'Save notice' : 'Publish notice')}</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NoticeCard({
  deleting,
  notice,
  onDelete,
  onEdit,
  styles,
}: {
  deleting: boolean;
  notice: NoticeRecord;
  onDelete: () => void;
  onEdit: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { t } = useLanguage();
  const noticeType = getNoticeType(notice.type);

  return (
    <View style={[styles.card, toneStyle(notice.type, styles)]}>
      <View style={styles.cardHeader}>
        <View style={styles.cardCopy}>
          <Text style={styles.typeLabel}>{t(noticeType.label)}</Text>
          <Text style={styles.audienceLabel}>
            {t(notice.audience === 'all' ? 'All customers' : notice.audience === 'customer' ? 'One customer' : 'Staff only')}
            {notice.audience === 'customer' && notice.tenantName ? ` · ${notice.tenantName}` : ''}
          </Text>
          <Text style={styles.cardTitle}>{notice.title || t('Notice')}</Text>
        </View>
        {formatDate(notice.createdAt) ? <Text style={styles.dateText}>{formatDate(notice.createdAt)}</Text> : null}
      </View>

      <Text style={styles.message}>{notice.message || '-'}</Text>

      <View style={styles.actions}>
        <Pressable onPress={onEdit} style={styles.actionButton}>
          <Text style={styles.actionText}>{t('Edit')}</Text>
        </Pressable>
        <Pressable disabled={deleting} onPress={onDelete} style={[styles.actionButton, styles.deleteButton, deleting && styles.disabled]}>
          <Text style={styles.deleteText}>{t(deleting ? 'Deleting...' : 'Delete')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function toneStyle(type: unknown, styles: ReturnType<typeof createStyles>) {
  if (type === 'success') return styles.successTone;
  if (type === 'warning') return styles.warningTone;
  if (type === 'danger') return styles.dangerTone;
  return styles.infoTone;
}

function Metric({
  danger = false,
  label,
  styles,
  value,
}: {
  danger?: boolean;
  label: string;
  styles: ReturnType<typeof createStyles>;
  value: string;
}) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, danger && styles.metricDanger]}>{value}</Text>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    wrap: {
      gap: spacing.lg,
    },
    hero: {
      backgroundColor: colors.ink,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadow.card,
    },
    heroTop: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
    },
    kicker: {
      color: colors.panelAccent,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    title: {
      color: colors.panelText,
      fontSize: 24,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    subtitle: {
      color: colors.panelMuted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.sm,
    },
    addButton: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    addButtonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
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
      color: colors.panelMuted,
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
    metricDanger: {
      color: colors.danger,
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing.sm,
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
      padding: spacing.md,
    },
    toolbar: {
      gap: spacing.md,
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
      borderLeftWidth: 4,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
      ...shadow.card,
    },
    infoTone: {
      borderLeftColor: colors.brand,
    },
    successTone: {
      borderLeftColor: colors.success,
    },
    warningTone: {
      borderLeftColor: colors.warning,
    },
    dangerTone: {
      borderLeftColor: colors.danger,
    },
    cardHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.sm,
    },
    cardCopy: {
      flex: 1,
    },
    typeLabel: {
      color: colors.muted,
      fontSize: 11,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    audienceLabel: {
      color: colors.brand,
      fontSize: 11,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
      textTransform: 'uppercase',
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: typography.weight.black,
      lineHeight: 22,
      marginTop: spacing.xs,
    },
    dateText: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.bold,
    },
    message: {
      color: colors.muted,
      fontSize: 14,
      lineHeight: 21,
      marginTop: spacing.md,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    actionButton: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 42,
      justifyContent: 'center',
    },
    actionText: {
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
    sheetBackdrop: {
      backgroundColor: 'rgba(0,0,0,0.54)',
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      maxHeight: '92%',
      padding: spacing.lg,
    },
    sheetHandle: {
      alignSelf: 'center',
      backgroundColor: colors.border,
      borderRadius: radius.sm,
      height: 4,
      marginBottom: spacing.lg,
      width: 44,
    },
    sheetHeader: {
      alignItems: 'flex-start',
      flexDirection: 'row',
      gap: spacing.md,
      justifyContent: 'space-between',
    },
    sheetKicker: {
      color: colors.muted,
      fontSize: 12,
      fontWeight: typography.weight.black,
      textTransform: 'uppercase',
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 24,
      fontWeight: typography.weight.black,
      marginTop: spacing.xs,
    },
    sheetCloseButton: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    sheetCloseText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
    },
    formLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: typography.weight.black,
      marginBottom: spacing.sm,
      marginTop: spacing.lg,
      textTransform: 'uppercase',
    },
    typeRail: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    targetPicker: {
      maxHeight: 180,
    },
    targetPickerContent: {
      gap: spacing.sm,
      paddingRight: spacing.sm,
    },
    formHelpText: {
      color: colors.muted,
      fontSize: 13,
    },
    formGrid: {
      gap: spacing.md,
      marginTop: spacing.lg,
    },
    sheetActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    sheetSecondaryAction: {
      alignItems: 'center',
      backgroundColor: colors.surfaceMuted,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 48,
      justifyContent: 'center',
    },
    sheetSecondaryText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: typography.weight.black,
    },
    sheetPrimaryAction: {
      alignItems: 'center',
      backgroundColor: colors.ink,
      borderRadius: radius.md,
      flex: 1,
      minHeight: 48,
      justifyContent: 'center',
    },
    sheetPrimaryText: {
      color: colors.onBrand,
      fontSize: 14,
      fontWeight: typography.weight.black,
    },
  });
}
