import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, connectAuthEmulator, getAuth, inMemoryPersistence, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

import firebaseConfig from '../../config/firebaseConfig';

const useEmulators = process.env.EXPO_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
if (useEmulators && !firebaseConfig.projectId?.startsWith('demo-')) {
  throw new Error('Emulators require a demo-* Firebase project.');
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createAuth() {
  try {
    return initializeAuth(app, { persistence: browserLocalPersistence });
  } catch {
    return getAuth(app);
  }
}

export const auth = createAuth();
export const db = getFirestore(app);
if (useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

export function getProvisioningAuth() {
  const provisioningApp = getApps().find(({ name }) => name === 'account-provisioning' || name === 'customer-provisioning')
    ?? initializeApp(firebaseConfig, 'account-provisioning');
  try {
    const provisioningAuth = initializeAuth(provisioningApp, { persistence: inMemoryPersistence });
    if (useEmulators) connectAuthEmulator(provisioningAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
    return provisioningAuth;
  } catch {
    return getAuth(provisioningApp);
  }
}

export default app;
