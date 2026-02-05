import { Employee } from '@/types/employee';

/**
 * Helper functions for role comparison that handles case insensitive matching
 * Supports both Employee object and raw role string
 */

type RoleInput = Employee | string | null | undefined;

const getRoleString = (input: RoleInput): string | undefined => {
  if (!input) return undefined;
  if (typeof input === 'string') return input;
  return input.role;
};

export const isUserRole = (user: RoleInput, role: string): boolean => {
  const userRole = getRoleString(user);
  return userRole?.toLowerCase() === role.toLowerCase();
};

export const hasAnyRole = (user: RoleInput, roles: string[]): boolean => {
  const userRole = getRoleString(user);
  if (!userRole) return false;
  return roles.some(role => userRole.toLowerCase() === role.toLowerCase());
};

export const isOwner = (user: RoleInput): boolean => {
  return isUserRole(user, 'owner');
};

export const isAdmin = (user: RoleInput): boolean => {
  return isUserRole(user, 'admin');
};

export const isCashier = (user: RoleInput): boolean => {
  return isUserRole(user, 'cashier');
};

export const isAdminOrOwner = (user: RoleInput): boolean => {
  return hasAnyRole(user, ['admin', 'owner']);
};

export const canManageCash = (user: RoleInput): boolean => {
  return hasAnyRole(user, ['owner', 'admin', 'cashier', 'kasir', 'kasir sales']);
};

export const canManageEmployees = (user: RoleInput): boolean => {
  return hasAnyRole(user, ['owner', 'admin', 'kasir', 'kasir sales']);
};

export const canDeleteTransactions = (user: RoleInput): boolean => {
  return hasAnyRole(user, ['owner', 'admin']);
};

export const canManageRoles = (user: RoleInput): boolean => {
  return isUserRole(user, 'owner');
};

// Check if user can create delivery without driver (web view only)
// Allowed for: cashier, kasir, kasir sales, admin, owner
export const canDeliverWithoutDriver = (user: RoleInput): boolean => {
  return hasAnyRole(user, ['owner', 'admin', 'kasir sales', 'kasir', 'cashier']);
};

// Backward compatibility aliases
export const userIsOwner = isOwner;
export const userIsAdmin = isAdmin;
export const userIsAdminOrOwner = isAdminOrOwner;