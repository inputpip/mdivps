import { useMemo, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getRolePermissions } from '@/services/rolePermissionService';

// Simplified permission keys - hanya yang benar-benar dibutuhkan
export const PERMISSIONS = {
  // Core Data Access
  PRODUCTS: 'products',
  PRODUCTS_MANAGE: 'products_manage',
  MATERIALS: 'materials',
  MATERIALS_MANAGE: 'materials_manage',
  TRANSACTIONS: 'transactions',
  CUSTOMERS: 'customers',
  EMPLOYEES: 'employees',
  DELIVERIES: 'deliveries',
  ATTENDANCE: 'attendance',

  // Financial
  FINANCIAL: 'financial',
  RECEIVABLE_BACKDATE: 'receivable_backdate',
  RECEIVABLE_DELETE: 'receivable_delete',

  // Production
  PRODUCTION: 'production',

  // Reports
  REPORTS: 'reports',

  // System
  SETTINGS: 'settings',
  ROLES: 'roles'
} as const;

export type Permission = typeof PERMISSIONS[keyof typeof PERMISSIONS];

// Map granular permissions to simplified permissions
const mapGranularToSimplified = (granularPerms: Record<string, boolean>): Record<string, boolean> => {
  return {
    // Products - need at least view access
    products: granularPerms.products_view === true,
    products_manage: granularPerms.products_create === true || granularPerms.products_edit === true,

    // Materials - need at least view access
    materials: granularPerms.materials_view === true,
    materials_manage: granularPerms.materials_create === true || granularPerms.materials_edit === true,

    // Transactions - need POS or transaction view access
    transactions: granularPerms.pos_access === true || granularPerms.transactions_view === true,

    // Customers - need at least view access
    customers: granularPerms.customers_view === true,

    // Employees - need at least view access
    employees: granularPerms.employees_view === true,

    // Deliveries - need POS driver access OR delivery view
    deliveries: granularPerms.pos_driver_access === true ||
      granularPerms.delivery_view === true ||
      granularPerms.retasi_view === true,

    // Attendance - need attendance access or view
    attendance: granularPerms.attendance_access === true ||
      granularPerms.attendance_view === true,

    // Financial - need at least one financial permission
    financial: granularPerms.accounts_view === true ||
      granularPerms.receivables_view === true ||
      granularPerms.expenses_view === true ||
      granularPerms.advances_view === true ||
      granularPerms.financial_reports === true ||
      granularPerms.payables_view === true ||
      granularPerms.cash_flow_view === true,

    receivable_backdate: granularPerms.receivable_backdate === true,
    receivable_delete: granularPerms.receivable_delete === true,

    // Reports - need at least one report permission
    reports: granularPerms.stock_reports === true ||
      granularPerms.transaction_reports === true ||
      granularPerms.attendance_reports === true ||
      granularPerms.production_reports === true ||
      granularPerms.material_movement_report === true ||
      granularPerms.transaction_items_report === true,

    // Settings - need settings access
    settings: granularPerms.settings_access === true,

    // Roles - need role management permission
    roles: granularPerms.role_management === true,
  };
};

export const usePermissions = () => {
  const { user } = useAuth();
  const [rolePermissions, setRolePermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Load role permissions from database
  useEffect(() => {
    const loadPermissions = async () => {
      try {
        // First try localStorage for faster initial load
        const cachedPerms = localStorage.getItem('rolePermissions');
        if (cachedPerms) {
          setRolePermissions(JSON.parse(cachedPerms));
        }

        // Then fetch from database
        const dbPerms = await getRolePermissions();
        if (dbPerms && dbPerms.length > 0) {
          const permsByRole: Record<string, Record<string, boolean>> = {};
          dbPerms.forEach((rp: { role_id: string; permissions: Record<string, boolean> }) => {
            permsByRole[rp.role_id] = rp.permissions;
          });
          setRolePermissions(permsByRole);
          // Update localStorage cache
          localStorage.setItem('rolePermissions', JSON.stringify(permsByRole));
        }
      } catch (error) {
        console.warn('Error loading permissions from database:', error);
        // Fallback to localStorage
        try {
          const saved = localStorage.getItem('rolePermissions');
          if (saved) {
            setRolePermissions(JSON.parse(saved));
          }
        } catch (e) {
          console.error('Error loading from localStorage:', e);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadPermissions();

    // Listen for changes to rolePermissions in localStorage (from other tabs or after save)
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'rolePermissions') {
        try {
          const perms = e.newValue ? JSON.parse(e.newValue) : {};
          setRolePermissions(perms);
        } catch (error) {
          console.error('Error parsing storage change:', error);
        }
      }
    };

    // Also listen for custom storage event (same window)
    const handleCustomStorage = () => {
      try {
        const saved = localStorage.getItem('rolePermissions');
        if (saved) {
          setRolePermissions(JSON.parse(saved));
        }
      } catch (error) {
        console.error('Error handling custom storage:', error);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('storage', handleCustomStorage);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('storage', handleCustomStorage);
    };
  }, []);

  const userPermissions = useMemo(() => {
    if (!user) return {};

    // Owner memiliki akses penuh
    if (user.role === 'owner') {
      return Object.values(PERMISSIONS).reduce((acc, permission) => {
        acc[permission] = true;
        return acc;
      }, {} as Record<string, boolean>);
    }

    // Get granular permissions for user's role
    const granularPerms = rolePermissions[user.role] || {};

    // Map to simplified permissions
    return mapGranularToSimplified(granularPerms);
  }, [user, rolePermissions]);

  const hasPermission = (permission: Permission): boolean => {
    if (!user) return false;

    // Owner always has permission
    if (user.role === 'owner') return true;

    // Admin has all permissions except roles
    if (user.role === 'admin' && permission !== PERMISSIONS.ROLES) return true;

    // Check mapped permissions
    return userPermissions[permission] === true;
  };

  const hasAnyPermission = (permissions: Permission[]): boolean => {
    return permissions.some(permission => hasPermission(permission));
  };

  const hasAllPermissions = (permissions: Permission[]): boolean => {
    return permissions.every(permission => hasPermission(permission));
  };

  // Specific permission checks
  const canAccessProducts = () => hasPermission(PERMISSIONS.PRODUCTS);
  const canManageProducts = () => hasPermission(PERMISSIONS.PRODUCTS_MANAGE);
  const canAccessMaterials = () => hasPermission(PERMISSIONS.MATERIALS);
  const canManageMaterials = () => hasPermission(PERMISSIONS.MATERIALS_MANAGE);
  const canAccessTransactions = () => hasPermission(PERMISSIONS.TRANSACTIONS);
  const canAccessCustomers = () => hasPermission(PERMISSIONS.CUSTOMERS);
  const canAccessEmployees = () => hasPermission(PERMISSIONS.EMPLOYEES);
  const canAccessDeliveries = () => hasPermission(PERMISSIONS.DELIVERIES);
  const canAccessFinancial = () => hasPermission(PERMISSIONS.FINANCIAL);
  const canAccessReports = () => hasPermission(PERMISSIONS.REPORTS);
  const canAccessSettings = () => hasPermission(PERMISSIONS.SETTINGS);
  const canManageRoles = () => hasPermission(PERMISSIONS.ROLES);

  return {
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    userPermissions,
    isLoading,
    isOwner: user?.role === 'owner',
    isAdmin: user?.role === 'admin',
    userRole: user?.role,
    // Simplified access methods
    canAccessProducts,
    canManageProducts,
    canAccessMaterials,
    canManageMaterials,
    canAccessTransactions,
    canAccessCustomers,
    canAccessEmployees,
    canAccessDeliveries,
    canAccessFinancial,
    canAccessReports,
    canAccessSettings,
    canManageRoles,
  };
};

// Permission checker utility - no JSX in this file
export const checkPermission = (userRole: string, permission: Permission, roles: any[]): boolean => {
  if (userRole === 'owner') return true;

  const role = roles?.find(r => r.name === userRole);
  return role?.permissions?.[permission] === true;
};