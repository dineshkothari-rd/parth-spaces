import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { auth, db } from '../../lib/firebase/client';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import type { SupportRequestRecord } from '../../shared/types/records';
import { TextField } from '../../shared/components/TextField';
import { FilterPill } from '../customers/FilterPill';

const statuses = [
  { label: 'All', value: '' },
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Resolved', value: 'resolved' },
];

export function SupportRequestsScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const requests = useFirestoreCollection<SupportRequestRecord>('supportRequests', { sortBy: 'createdAt' });
  const [filter, setFilter] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const visible = useMemo(() => requests.data.filter((request) => !filter || request.status === filter), [filter, requests.data]);

  async function updateStatus(request: SupportRequestRecord, status: 'in_progress' | 'resolved') {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) return setError(t('Please sign in again.'));
    const response = responses[request.id]?.trim() || request.response || '';
    if (status === 'resolved' && !response) return setError(t('Add a response before resolving.'));
    setBusyId(request.id);
    setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'supportRequests', request.id), {
        ...(status === 'resolved' ? { response } : {}),
        status,
        updatedAt: serverTimestamp(),
        updatedBy: actorUid,
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: `support_request.${status}`,
        actorUid,
        createdAt: serverTimestamp(),
        customerId: request.customerId || '',
        entityId: request.id,
      });
      await batch.commit();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : t('Could not update request.'));
    } finally {
      setBusyId('');
    }
  }

  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{t('Customer help')}</Text>
        <Text style={styles.title}>{t('Requests')}</Text>
        <Text style={styles.subtitle}>{t('Review customer issues and requested profile corrections.')}</Text>
      </View>
      <View style={styles.filters}>
        {statuses.map((status) => <FilterPill active={filter === status.value} key={status.label} label={status.label} onPress={() => setFilter(status.value)} />)}
      </View>
      {requests.loading ? <ActivityIndicator color={colors.brand} /> : null}
      {requests.error ? <Text style={styles.error}>{requests.error}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.list}>
        {visible.map((request) => {
          const busy = busyId === request.id;
          return (
            <View key={request.id} style={styles.card}>
              <View style={styles.header}>
                <View style={styles.copy}>
                  <Text style={styles.name}>{request.customerName || t('Customer')}</Text>
                  <Text style={styles.type}>{t(request.type === 'profile_correction' ? 'Profile correction' : 'Support issue')}</Text>
                </View>
                <Text style={styles.status}>{t(request.status === 'in_progress' ? 'In progress' : request.status === 'resolved' ? 'Resolved' : 'Open')}</Text>
              </View>
              <Text style={styles.message}>{request.message}</Text>
              {request.status !== 'resolved' ? (
                <>
                  <TextField label="Response to customer" multiline numberOfLines={3} onChangeText={(value) => setResponses((current) => ({ ...current, [request.id]: value }))} placeholder="Explain what was done..." style={styles.responseInput} textAlignVertical="top" value={responses[request.id] || ''} />
                  <View style={styles.actions}>
                    {request.status !== 'in_progress' ? <Pressable disabled={busy} onPress={() => updateStatus(request, 'in_progress')} style={styles.action}><Text style={styles.actionText}>{t('Start')}</Text></Pressable> : null}
                    <Pressable disabled={busy} onPress={() => updateStatus(request, 'resolved')} style={styles.resolveAction}><Text style={styles.resolveText}>{t('Mark resolved')}</Text></Pressable>
                  </View>
                </>
              ) : request.response ? <Text style={styles.response}>{request.response}</Text> : null}
            </View>
          );
        })}
        {!requests.loading && !visible.length ? <Text style={styles.empty}>{t('No requests found.')}</Text> : null}
      </View>
    </View>
  );
}

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    hero: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: spacing.lg, ...shadow.card },
    kicker: { color: colors.panelAccent, fontSize: 12, fontWeight: typography.weight.black, textTransform: 'uppercase' },
    title: { color: colors.onBrand, fontSize: 28, fontWeight: typography.weight.black, marginTop: spacing.xs },
    subtitle: { color: colors.panelMuted, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
    filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginVertical: spacing.lg },
    list: { gap: spacing.md },
    card: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, ...shadow.card },
    header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
    copy: { flex: 1 },
    name: { color: colors.text, fontSize: 17, fontWeight: typography.weight.black },
    type: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
    status: { color: colors.link, fontSize: 12, fontWeight: typography.weight.black },
    message: { color: colors.text, fontSize: 14, lineHeight: 21, marginTop: spacing.md },
    responseInput: { minHeight: 76, paddingTop: spacing.md },
    response: { backgroundColor: colors.successSoft, borderRadius: radius.md, color: colors.success, fontSize: 13, lineHeight: 19, marginTop: spacing.md, padding: spacing.md },
    actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
    action: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    actionText: { color: colors.text, fontSize: 12, fontWeight: typography.weight.black },
    resolveAction: { backgroundColor: colors.successSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    resolveText: { color: colors.success, fontSize: 12, fontWeight: typography.weight.black },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, marginTop: spacing.md, padding: spacing.md },
    empty: { color: colors.muted, padding: spacing.xl, textAlign: 'center' },
  });
}
