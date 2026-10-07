import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail, signOut, type User } from 'firebase/auth';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { radius, shadow, spacing, typography, useAppTheme, type AppColors } from '../../design/tokens';
import { auth, db, getProvisioningAuth } from '../../lib/firebase/client';
import { PrimaryButton } from '../../shared/components/PrimaryButton';
import { TextField } from '../../shared/components/TextField';
import { useFirestoreCollection } from '../../shared/hooks/useFirestoreCollection';
import { useLanguage } from '../../shared/i18n/LanguageProvider';
import type { AccountAccessStatus } from '../../shared/types/admin';
import type { FirestoreRecord } from '../../shared/types/records';
import { defaultStaffPermissions, staffPermissions, type StaffPermission, type StaffPermissions } from '../../shared/types/permissions';

type StaffRecord = FirestoreRecord & {
  accessStatus?: AccountAccessStatus;
  email?: string;
  name?: string;
  role?: string;
  uid?: string;
  permissions?: StaffPermissions;
};

export function StaffScreen() {
  const { colors } = useAppTheme();
  const { t } = useLanguage();
  const styles = createStyles(colors);
  const users = useFirestoreCollection<StaffRecord>('users', { sortBy: 'createdAt' });
  const staff = useMemo(() => users.data.filter((user) => user.role === 'staff'), [users.data]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busyId, setBusyId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');

  async function inviteStaff() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!name.trim() || !normalizedEmail.includes('@')) {
      setError(t('Enter a staff name and valid email.'));
      return;
    }

    const actorUid = auth.currentUser?.uid;
    if (!actorUid) {
      setError(t('Please sign in again.'));
      return;
    }

    setInviting(true);
    setError('');
    const provisioningAuth = getProvisioningAuth();
    let createdUser: User | undefined;
    let profileCreated = false;

    try {
      const credential = await createUserWithEmailAndPassword(provisioningAuth, normalizedEmail, `${Crypto.randomUUID()}Aa1!`);
      createdUser = credential.user;

      const batch = writeBatch(db);
      batch.set(doc(db, 'users', createdUser.uid), {
        accessStatus: 'invited',
        createdAt: serverTimestamp(),
        createdBy: actorUid,
        email: normalizedEmail,
        name: name.trim(),
        role: 'staff',
        permissions: defaultStaffPermissions,
        uid: createdUser.uid,
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'staff.invited',
        actorUid,
        createdAt: serverTimestamp(),
        staffEmail: normalizedEmail,
        staffUid: createdUser.uid,
      });
      await batch.commit();
      profileCreated = true;
      await sendPasswordResetEmail(auth, normalizedEmail);
      setEmail('');
      setName('');
      Alert.alert(t('Staff invited'), `${t('Password setup instructions were sent to')} ${normalizedEmail}.`);
    } catch (inviteError) {
      if (createdUser && !profileCreated) await deleteUser(createdUser).catch(() => undefined);
      const code = inviteError && typeof inviteError === 'object' && 'code' in inviteError ? inviteError.code : '';
      setError(code === 'auth/email-already-in-use'
        ? t('This email already has an account and cannot be linked here.')
        : inviteError instanceof Error ? inviteError.message : t('Could not invite staff.'));
    } finally {
      await signOut(provisioningAuth).catch(() => undefined);
      setInviting(false);
    }
  }

  async function updateAccess(member: StaffRecord, accessStatus: AccountAccessStatus) {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) return setError(t('Please sign in again.'));

    setBusyId(member.id);
    setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', member.id), {
        accessStatus,
        accessUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: `staff.access_${accessStatus}`,
        actorUid,
        createdAt: serverTimestamp(),
        staffEmail: member.email || '',
        staffUid: member.id,
      });
      await batch.commit();
    } catch (accessError) {
      setError(accessError instanceof Error ? accessError.message : t('Could not update staff access.'));
    } finally {
      setBusyId('');
    }
  }

  async function resendAccess(member: StaffRecord) {
    if (!member.email) return;
    setBusyId(member.id);
    setError('');
    try {
      await sendPasswordResetEmail(auth, member.email);
      Alert.alert(t('Access email sent'), `${t('Password setup instructions were sent to')} ${member.email}.`);
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : t('Could not send access'));
    } finally {
      setBusyId('');
    }
  }

  async function changePermission(member: StaffRecord, permission: StaffPermission, enabled: boolean) {
    const actorUid = auth.currentUser?.uid;
    if (!actorUid) return setError(t('Please sign in again.'));
    setBusyId(member.id);
    setError('');
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', member.id), { [`permissions.${permission}`]: enabled, updatedAt: serverTimestamp() });
      batch.set(doc(collection(db, 'auditEvents')), {
        action: 'staff.permissions_updated', actorUid, createdAt: serverTimestamp(), staffUid: member.id, permission, enabled,
      });
      await batch.commit();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('Could not update staff permissions.'));
    } finally {
      setBusyId('');
    }
  }

  function confirmRevoke(member: StaffRecord) {
    Alert.alert(t('Revoke staff access?'), member.name || member.email || t('Staff'), [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Revoke'), style: 'destructive', onPress: () => updateAccess(member, 'revoked') },
    ]);
  }

  return (
    <View>
      <View style={styles.hero}>
        <Text style={styles.kicker}>{t('Admin only')}</Text>
        <Text style={styles.title}>{t('Team access')}</Text>
        <Text style={styles.subtitle}>{t('Invite staff and control who can manage daily operations.')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t('Invite staff')}</Text>
        <View style={styles.form}>
          <TextField label="Name" onChangeText={setName} placeholder="Staff name" value={name} />
          <TextField autoCapitalize="none" autoCorrect={false} keyboardType="email-address" label="Email" onChangeText={setEmail} placeholder="staff@example.com" value={email} />
          <PrimaryButton label="Send staff invite" loading={inviting} onPress={inviteStaff} />
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('Staff')}</Text>
        <Text style={styles.count}>{staff.length}</Text>
      </View>
      {users.loading ? <ActivityIndicator color={colors.brand} /> : null}
      {users.error ? <Text style={styles.error}>{users.error}</Text> : null}
      <View style={styles.list}>
        {staff.map((member) => {
          const status = member.accessStatus || 'active';
          const busy = busyId === member.id;
          return (
            <View key={member.id} style={styles.staffCard}>
              <View style={styles.staffHeader}>
                <View style={styles.staffCopy}>
                  <Text style={styles.staffName}>{member.name || t('Staff')}</Text>
                  <Text style={styles.staffEmail}>{member.email || '—'}</Text>
                </View>
                <Text style={styles.status}>{t(`${status.charAt(0).toUpperCase()}${status.slice(1)}`)}</Text>
              </View>
              <Text style={styles.staffEmail}>{t('Staff can view daily records. These permissions control changes. Checkout requires customer and money permissions.')}</Text>
              {(Object.keys(staffPermissions) as StaffPermission[]).map((permission) => <View key={permission} style={styles.staffHeader}>
                <Text style={[styles.staffEmail, styles.staffCopy]}>{t(staffPermissions[permission])}</Text>
                <Switch accessibilityLabel={t(staffPermissions[permission])} disabled={busy || status === 'revoked'} value={member.permissions?.[permission] ?? true} onValueChange={(value) => changePermission(member, permission, value)} />
              </View>)}
              <View style={styles.actions}>
                {status !== 'revoked' ? (
                  <Pressable disabled={busy} onPress={() => updateAccess(member, status === 'suspended' ? 'active' : 'suspended')} style={styles.action}>
                    <Text style={styles.actionText}>{t(status === 'suspended' ? 'Restore access' : 'Suspend access')}</Text>
                  </Pressable>
                ) : null}
                {status === 'active' || status === 'invited' ? (
                  <Pressable disabled={busy} onPress={() => resendAccess(member)} style={styles.action}>
                    <Text style={styles.actionText}>{t('Resend access email')}</Text>
                  </Pressable>
                ) : null}
                {status !== 'revoked' ? (
                  <Pressable disabled={busy} onPress={() => confirmRevoke(member)} style={styles.dangerAction}>
                    <Text style={styles.dangerText}>{t('Revoke')}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          );
        })}
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
    card: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, marginTop: spacing.lg, padding: spacing.lg, ...shadow.card },
    sectionTitle: { color: colors.text, fontSize: 18, fontWeight: typography.weight.black },
    form: { gap: spacing.md, marginTop: spacing.lg },
    error: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, color: colors.danger, marginTop: spacing.md, padding: spacing.md },
    sectionHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md, marginTop: spacing.xl },
    count: { color: colors.muted, fontSize: 13, fontWeight: typography.weight.bold },
    list: { gap: spacing.md },
    staffCard: { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radius.lg, borderWidth: 1, padding: spacing.lg, ...shadow.card },
    staffHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
    staffCopy: { flex: 1 },
    staffName: { color: colors.text, fontSize: 17, fontWeight: typography.weight.black },
    staffEmail: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
    status: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, color: colors.text, fontSize: 11, fontWeight: typography.weight.black, overflow: 'hidden', paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
    action: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    actionText: { color: colors.text, fontSize: 12, fontWeight: typography.weight.black },
    dangerAction: { backgroundColor: colors.dangerSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
    dangerText: { color: colors.danger, fontSize: 12, fontWeight: typography.weight.black },
  });
}
