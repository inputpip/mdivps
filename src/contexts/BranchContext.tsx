import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode, useRef } from 'react';
import { Branch, Company } from '@/types/branch';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';

interface BranchContextType {
  currentBranch: Branch | null;
  availableBranches: Branch[];
  currentCompany: Company | null;
  isHeadOffice: boolean;
  canAccessAllBranches: boolean;
  switchBranch: (branchId: string) => void;
  refreshBranches: () => Promise<void>;
  loading: boolean;
}

const BranchContext = createContext<BranchContextType | undefined>(undefined);

export function BranchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentBranch, setCurrentBranch] = useState<Branch | null>(null);
  const [availableBranches, setAvailableBranches] = useState<Branch[]>([]);
  const [currentCompany, setCurrentCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  // Use refs to track previous values and prevent unnecessary re-fetches
  const fetchedUserIdRef = useRef<string | null>(null);
  const restoredBranchRef = useRef<boolean>(false);

  // Check if user is head office or can access all branches - memoize to prevent recalculation
  const isHeadOffice = useMemo(() =>
    user?.role === 'super_admin' || user?.role === 'head_office_admin' || user?.role === 'owner',
    [user?.role]
  );

  // Roles that can switch branches by default: owner, admin, sales, cashier, kasir, kasir sales
  const canAccessAllBranches = useMemo(() => {
    const role = user?.role?.toLowerCase();
    return isHeadOffice ||
      role === 'admin' ||
      role === 'sales' ||
      role === 'kasir' ||
      role === 'cashier' ||
      role === 'kasir sales' ||
      role === 'kasir_sales';
  }, [user?.role, isHeadOffice]);

  // Fetch user's branch and available branches
  const fetchBranches = async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Get user's profile with branch info
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('branch_id')
        .eq('id', user.id)
        .order('id').limit(1);

      // Handle both array and object response (PostgREST compatibility)
      const profile = Array.isArray(profileData) ? profileData[0] : profileData;

      if (!profile?.branch_id) {
        // Jika user belum ada branch_id, coba ambil branch pertama yang aktif sebagai fallback
        const { data: fallbackBranches } = await supabase
          .from('branches')
          .select('*')
          .eq('is_active', true)
          .order('id').limit(1);

        if (fallbackBranches && fallbackBranches.length > 0) {
          const fallbackBranch = fallbackBranches[0];
          setCurrentBranch({
            id: fallbackBranch.id,
            companyId: fallbackBranch.company_id,
            name: fallbackBranch.name,
            code: fallbackBranch.code,
            address: fallbackBranch.address,
            phone: fallbackBranch.phone,
            email: fallbackBranch.email,
            managerId: fallbackBranch.manager_id,
            managerName: fallbackBranch.manager_name,
            isActive: fallbackBranch.is_active,
            settings: fallbackBranch.settings,
            createdAt: new Date(fallbackBranch.created_at),
            updatedAt: new Date(fallbackBranch.updated_at),
          });
          setAvailableBranches([{
            id: fallbackBranch.id,
            companyId: fallbackBranch.company_id,
            name: fallbackBranch.name,
            code: fallbackBranch.code,
            address: fallbackBranch.address,
            phone: fallbackBranch.phone,
            email: fallbackBranch.email,
            managerId: fallbackBranch.manager_id,
            managerName: fallbackBranch.manager_name,
            isActive: fallbackBranch.is_active,
            settings: fallbackBranch.settings,
            createdAt: new Date(fallbackBranch.created_at),
            updatedAt: new Date(fallbackBranch.updated_at),
          }]);
        }
        setLoading(false);
        return;
      }

      // Get current branch details
      const { data: branchData } = await supabase
        .from('branches')
        .select('*')
        .eq('id', profile.branch_id)
        .order('id').limit(1);

      // Handle both array and object response
      const branch = Array.isArray(branchData) ? branchData[0] : branchData;

      if (branch) {
        // For users who can access all branches, check localStorage first
        // This ensures branch selection persists across page refreshes
        const savedBranchId = localStorage.getItem('selectedBranchId');

        if (canAccessAllBranches && savedBranchId && savedBranchId !== branch.id) {
          // User previously selected a different branch, load that one instead
          const { data: savedBranchData } = await supabase
            .from('branches')
            .select('*')
            .eq('id', savedBranchId)
            .order('id').limit(1);

          const savedBranch = Array.isArray(savedBranchData) ? savedBranchData[0] : savedBranchData;

          if (savedBranch) {
            setCurrentBranch({
              id: savedBranch.id,
              companyId: savedBranch.company_id,
              name: savedBranch.name,
              code: savedBranch.code,
              address: savedBranch.address,
              phone: savedBranch.phone,
              email: savedBranch.email,
              managerId: savedBranch.manager_id,
              managerName: savedBranch.manager_name,
              isActive: savedBranch.is_active,
              settings: savedBranch.settings,
              createdAt: new Date(savedBranch.created_at),
              updatedAt: new Date(savedBranch.updated_at),
            });
            restoredBranchRef.current = true;
          } else {
            // Saved branch not found, fallback to user's branch
            setCurrentBranch({
              id: branch.id,
              companyId: branch.company_id,
              name: branch.name,
              code: branch.code,
              address: branch.address,
              phone: branch.phone,
              email: branch.email,
              managerId: branch.manager_id,
              managerName: branch.manager_name,
              isActive: branch.is_active,
              settings: branch.settings,
              createdAt: new Date(branch.created_at),
              updatedAt: new Date(branch.updated_at),
            });
          }
        } else {
          setCurrentBranch({
            id: branch.id,
            companyId: branch.company_id,
            name: branch.name,
            code: branch.code,
            address: branch.address,
            phone: branch.phone,
            email: branch.email,
            managerId: branch.manager_id,
            managerName: branch.manager_name,
            isActive: branch.is_active,
            settings: branch.settings,
            createdAt: new Date(branch.created_at),
            updatedAt: new Date(branch.updated_at),
          });
        }

        // Get company details (only if company_id exists)
        if (branch.company_id) {
          const { data: companyData } = await supabase
            .from('companies')
            .select('*')
            .eq('id', branch.company_id)
            .order('id').limit(1);

          const company = Array.isArray(companyData) ? companyData[0] : companyData;

          if (company) {
            setCurrentCompany({
              id: company.id,
              name: company.name,
              code: company.code,
              isHeadOffice: company.is_head_office,
              address: company.address,
              phone: company.phone,
              email: company.email,
              taxId: company.tax_id,
              logoUrl: company.logo_url,
              isActive: company.is_active,
              createdAt: new Date(company.created_at),
              updatedAt: new Date(company.updated_at),
            });
          }
        }
      }

      // Fetch role permissions to check for granular branch access
      let granularPermissions: Record<string, boolean> = {};
      if (user.role && user.role !== 'owner') {
        const { data: rolePermData } = await supabase
          .from('role_permissions')
          .select('permissions')
          .eq('role_id', user.role)
          .limit(1);

        const rolePerm = Array.isArray(rolePermData) ? rolePermData[0] : rolePermData;
        if (rolePerm?.permissions) {
          granularPermissions = rolePerm.permissions;
        }
      }

      // Get all active branches
      const { data: allBranches } = await supabase
        .from('branches')
        .select('*')
        .eq('is_active', true);

      if (allBranches) {
        let accessibleBranches = allBranches;

        // If not head office/admin and not a default role with full access, filter by granular permissions
        if (!isHeadOffice && user.role !== 'admin') {
          accessibleBranches = allBranches.filter(b =>
            b.id === profile.branch_id || // Always include home branch
            granularPermissions[`branch_access_${b.id}`] === true // include branches with explicit access
          );
        }

        setAvailableBranches(
          accessibleBranches.map((b) => ({
            id: b.id,
            companyId: b.company_id,
            name: b.name,
            code: b.code,
            address: b.address,
            phone: b.phone,
            email: b.email,
            managerId: b.manager_id,
            managerName: b.manager_name,
            isActive: b.is_active,
            settings: b.settings,
            createdAt: new Date(b.created_at),
            updatedAt: new Date(b.updated_at),
          }))
        );
      }
    } catch (error) {
      // Silent error handling
    } finally {
      setLoading(false);
    }
  };

  // Switch to different branch (only for head office users)
  // PENTING: Refresh halaman setelah switch branch untuk memastikan semua data fresh
  const switchBranch = (branchId: string) => {
    if (!canAccessAllBranches) {
      return;
    }

    const branch = availableBranches.find((b) => b.id === branchId);
    if (branch) {
      localStorage.setItem('selectedBranchId', branchId);
      window.location.reload();
    }
  };

  // Restore selected branch from localStorage - only run once when branches are first loaded
  useEffect(() => {
    if (canAccessAllBranches && availableBranches.length > 0 && !restoredBranchRef.current) {
      const savedBranchId = localStorage.getItem('selectedBranchId');
      if (savedBranchId) {
        const branch = availableBranches.find((b) => b.id === savedBranchId);
        if (branch) {
          setCurrentBranch(branch);
        } else {
          localStorage.removeItem('selectedBranchId');
        }
      }
      restoredBranchRef.current = true;
    }
  }, [availableBranches.length, canAccessAllBranches]);

  // Fetch branches only when user ID changes (not on every user object change)
  useEffect(() => {
    const userId = user?.id;
    if (userId && fetchedUserIdRef.current !== userId) {
      fetchedUserIdRef.current = userId;
      fetchBranches();
    } else if (!userId) {
      fetchedUserIdRef.current = null;
      setLoading(false);
    }
  }, [user?.id]);

  const value: BranchContextType = {
    currentBranch,
    availableBranches,
    currentCompany,
    isHeadOffice,
    canAccessAllBranches,
    switchBranch,
    refreshBranches: fetchBranches,
    loading,
  };

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const context = useContext(BranchContext);
  if (context === undefined) {
    throw new Error('useBranch must be used within a BranchProvider');
  }
  return context;
}
