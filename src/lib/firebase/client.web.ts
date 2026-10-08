import { getApp, getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, inMemoryPersistence, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

import firebaseConfig from '../../config/firebaseConfig';

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

export function getProvisioningAuth() {
  const provisioningApp = getApps().find(({ name }) => name === 'account-provisioning' || name === 'customer-provisioning')
    ?? initializeApp(firebaseConfig, 'account-provisioning');
  try {
    return initializeAuth(provisioningApp, { persistence: inMemoryPersistence });
  } catch {
    return getAuth(provisioningApp);
  }
}

export default app;
