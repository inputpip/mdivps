import { useMemo, useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { getRolePermissions } from '@/services/rolePermissionService';

/**
 * Hook to check granular permissions directly from role_permissions table.
 * This is used for fine-grained permission checks like retasi_create, delivery_edit, etc.
 */
export const useGranularPermission = () => {
  const { user } = useAuth();
  const [rolePermissions, setRolePermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [isLoading, setIsLoading] = useState(true);

  // Load role permissions from database - ALWAYS fetch from DB first
  useEffect(() => {
    const loadPermissions = async () => {
      try {
        // ALWAYS fetch from database first (tidak pakai cache sebagai prioritas)
        const dbPerms = await getRolePermissions();
        if (dbPerms && dbPerms.length > 0) {
          const permsByRole: Record<string, Record<string, boolean>> = {};
          dbPerms.forEach((rp: { role_id: string; permissions: Record<string, boolean> }) => {
            permsByRole[rp.role_id] = rp.permissions;
          });
          setRolePermissions(permsByRole);
          // Update localStorage cache sebagai backup
          localStorage.setItem('rolePermissions', JSON.stringify(permsByRole));
        }
      } catch (error) {
        console.warn('Error loading granular permissions from DB, using cache:', error);
        // Fallback to localStorage only if DB fails
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

    // Refresh permissions setiap 5 menit untuk mendapat update terbaru
    const refreshInterval = setInterval(loadPermissions, 5 * 60 * 1000);

    // Listen for changes from other tabs
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

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(refreshInterval);
    };
  }, []);

  /**
   * Get all granular permissions for the current user's role
   */
  const userGranularPermissions = useMemo(() => {
    if (!user) return {};

    // Owner has all permissions
    if (user.role === 'owner') {
      return {
        // Return a proxy-like object that returns true for everything
        _isOwner: true
      };
    }

    // Admin has most permissions except role management
    if (user.role === 'admin') {
      return {
        _isAdmin: true
      };
    }

    return rolePermissions[user.role] || {};
  }, [user, rolePermissions]);

  /**
   * Check if user has a specific granular permission
   * @param permission - The granular permission key (e.g., 'retasi_create', 'delivery_edit')
   */
  const hasGranularPermission = (permission: string): boolean => {
    if (!user) return false;

    // Owner always has permission
    if (user.role === 'owner') return true;

    // Admin has all permissions except role_management
    if (user.role === 'admin' && permission !== 'role_management') return true;

    // If role is 'authenticated', it might be a fallback from Supabase.
    // Try to check if any role has this permission, or if we can find the real role.
    let currentRole = user.role;

    // Check specific permission
    const perms = rolePermissions[currentRole] || {};
    if (perms[permission] === true) return true;

    // Fallback: If role is authenticated and we're checking a mobile delivery permission,
    // check supir/helper roles as well for wider compatibility
    if (currentRole === 'authenticated' && (permission === 'mobile_delivery_report' || permission === 'delivery_report_view')) {
      return (rolePermissions['supir']?.[permission] === true) || (rolePermissions['helper']?.[permission] === true);
    }

    return false;
  };

  /**
   * Check if user can create retasi
   */
  const canCreateRetasi = (): boolean => {
    return hasGranularPermission('retasi_create');
  };

  /**
   * Check if user can edit delivery
   */
  const canEditDelivery = (): boolean => {
    return hasGranularPermission('delivery_edit');
  };

  /**
   * Check if user can create delivery
   */
  const canCreateDelivery = (): boolean => {
    return hasGranularPermission('delivery_create');
  };

  /**
   * Check if user can edit retasi (mark as returned, edit data)
   */
  const canEditRetasi = (): boolean => {
    return hasGranularPermission('retasi_edit');
  };

  /**
   * Check if user can delete retasi
   */
  const canDeleteRetasi = (): boolean => {
    return hasGranularPermission('retasi_delete');
  };

  /**
   * Check if user can view retasi
   */
  const canViewRetasi = (): boolean => {
    return hasGranularPermission('retasi_view');
  };

  /**
   * Check if user can view delivery
   */
  const canViewDelivery = (): boolean => {
    return hasGranularPermission('delivery_view');
  };

  /**
   * Check if user can delete delivery
   */
  const canDeleteDelivery = (): boolean => {
    return hasGranularPermission('delivery_delete');
  };

  /**
   * Check if user can view delivery history
   * History access requires delivery_view or delivery_edit permission
   */
  const canViewDeliveryHistory = (): boolean => {
    return hasGranularPermission('delivery_view') || hasGranularPermission('delivery_edit');
  };

  /**
   * Check if user can view delivery report
   */
  const canViewDeliveryReport = (): boolean => {
    return hasGranularPermission('delivery_report_view') || hasGranularPermission('mobile_delivery_report');
  };

  /**
   * Check if user can create delivery report
   */
  const canCreateDeliveryReport = (): boolean => {
    return hasGranularPermission('delivery_report_create') || hasGranularPermission('mobile_delivery_report');
  };

  return {
    hasGranularPermission,
    userGranularPermissions,
    isLoading,
    // Convenience methods
    canCreateRetasi,
    canEditDelivery,
    canCreateDelivery,
    canEditRetasi,
    canDeleteRetasi,
    canViewRetasi,
    canViewDelivery,
    canDeleteDelivery,
    canViewDeliveryHistory,
    canViewDeliveryReport,
    canCreateDeliveryReport,
  };
};
