import assert from 'node:assert/strict';
import test from 'node:test';
import { hasPermission } from './permissions';
import type { AdminProfile } from './admin';

test('staff permissions preserve existing access and respect restrictions and account status', () => {
  const profile: AdminProfile = { uid: 'staff', email: 'staff@example.com', emailVerified: true, name: 'Staff', role: 'staff', accessStatus: 'active' };
  assert.equal(hasPermission(profile, 'money'), true);
  assert.equal(hasPermission({ ...profile, permissions: { money: false } }, 'money'), false);
  assert.equal(hasPermission({ ...profile, permissions: { money: false } }, 'customers'), true);
  assert.equal(hasPermission({ ...profile, role: 'admin', permissions: { money: false } }, 'money'), true);
  assert.equal(hasPermission({ ...profile, accessStatus: 'suspended' }, 'customers'), false);
  assert.equal(hasPermission({ ...profile, accessStatus: 'revoked' }, 'customers'), false);
  assert.equal(hasPermission({ ...profile, emailVerified: false }, 'customers'), false);
});
