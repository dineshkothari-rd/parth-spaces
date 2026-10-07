import type { AppProfile } from './admin';

export const staffPermissions = {
  customers: 'Manage customers and allocations',
  money: 'Manage payments and settlements',
  operations: 'Manage enquiries, notices and requests',
} as const;

export type StaffPermission = keyof typeof staffPermissions;
export type StaffPermissions = Record<StaffPermission, boolean>;
export const defaultStaffPermissions: StaffPermissions = { customers: true, money: true, operations: true };

export function hasPermission(profile: AppProfile, permission: StaffPermission) {
  if (!profile.emailVerified || !['active', 'invited'].includes(profile.accessStatus)) return false;
  return profile.role === 'admin' || (profile.role === 'staff' && (profile.permissions?.[permission] ?? true));
}
