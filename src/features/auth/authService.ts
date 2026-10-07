import { onAuthStateChanged, reload, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

import { auth, db } from '../../lib/firebase/client';
import type { AccountAccessStatus, AppProfile, AppRole } from '../../shared/types/admin';

export function watchAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export function watchAppProfile(user: User, callback: (profile: AppProfile | null) => void, onError: () => void) {
  return onSnapshot(doc(db, 'users', user.uid), () => {
    getAppProfile(user).then(callback).catch(onError);
  }, onError);
}

function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'staff' || value === 'customer';
}

function getAccountAccessStatus(value: unknown, fallback: AccountAccessStatus): AccountAccessStatus {
  return value === 'active' || value === 'invited' || value === 'suspended' || value === 'revoked' ? value : fallback;
}

export async function getAppProfile(user: User | null): Promise<AppProfile | null> {
  if (!user?.email) return null;

  const data = await getDoc(doc(db, 'users', user.uid)).then((snapshot) => snapshot.data()).catch(() => undefined);
  const role = isAppRole(data?.role) ? data.role : null;

  if (role) {
    const customerId = String(data?.customerId || '').trim();

    const base = {
      email: user.email,
      emailVerified: user.emailVerified,
      name: String(data?.name || user.displayName || user.email),
      uid: user.uid,
    };

    if (role === 'customer') {
      return customerId ? { ...base, accessStatus: getAccountAccessStatus(data?.accessStatus, 'invited'), customerId, role } : null;
    }

    return { ...base, accessStatus: getAccountAccessStatus(data?.accessStatus, 'active'), role, permissions: data?.permissions };
  }

  // Keep existing admin accounts working while roles are provisioned server-side.
  const adminRef = doc(db, 'admins', user.email);
  const adminSnap = await getDoc(adminRef);

  if (!adminSnap.exists()) return null;

  return {
    email: user.email,
    emailVerified: user.emailVerified,
    accessStatus: 'active',
    name: String(adminSnap.data().name || user.email),
    role: 'admin',
    uid: user.uid,
  };
}

export async function signInAccount(email: string, password: string) {
  const result = await signInWithEmailAndPassword(auth, email.trim(), password);
  const profile = await getAppProfile(result.user);

  if (!profile) {
    await signOut(auth);
    throw new Error('Access denied. This account has not been approved.');
  }

  return profile;
}

export async function signOutAccount() {
  await signOut(auth);
}

export async function requestPasswordReset(email: string) {
  try {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') return;
    throw error;
  }
}

export async function sendAccountVerification() {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  if (!user.emailVerified) await sendEmailVerification(user);
}

export async function refreshSignedInProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  await reload(user);
  await user.getIdToken(true);
  return getAppProfile(user);
}
