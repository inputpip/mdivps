import { supabase } from '@/integrations/supabase/client';

export async function getRolePermissions() {
  try {
    const { data, error } = await supabase.from('role_permissions').select('*');
    if (error) {
      // If table doesn't exist, return default data
      console.warn('role_permissions table not found, using default data');
      return [];
    }
    return data;
  } catch (error) {
    console.warn('Error fetching role permissions, using default data:', error);
    return [];
  }
}

export async function updateRolePermissions(roleId: string, permissions: Record<string, boolean>) {
  // First try to check if record exists (without .single() to avoid 406 error)
  const { data: existingRecords, error: selectError } = await supabase
    .from('role_permissions')
    .select('id')
    .eq('role_id', roleId);

  if (selectError) {
    console.warn('Error checking existing record:', selectError);
  }

  const existing = existingRecords && existingRecords.length > 0;

  if (existing) {
    // Update existing record
    const { error } = await supabase
      .from('role_permissions')
      .update({ permissions, updated_at: new Date().toISOString() })
      .eq('role_id', roleId);
    if (error) throw error;
  } else {
    // Insert new record
    const { error } = await supabase
      .from('role_permissions')
      .insert({ role_id: roleId, permissions });
    if (error) throw error;
  }
  return true;
}

// RLS Management Functions
export async function getRLSStatus() {
  try {
    const { data, error } = await supabase.rpc('get_rls_status');
    if (error) {
      console.warn('RLS functions not available, returning mock data:', error);
      // Return mock data if functions don't exist
      return [
        { schema_name: 'public', table_name: 'users', rls_enabled: false },
        { schema_name: 'public', table_name: 'products', rls_enabled: false },
        { schema_name: 'public', table_name: 'transactions', rls_enabled: false },
        { schema_name: 'public', table_name: 'employees', rls_enabled: false },
        { schema_name: 'public', table_name: 'customers', rls_enabled: false },
      ];
    }
    return data;
  } catch (error) {
    console.error('Error getting RLS status:', error);
    // Return mock data for demo
    return [
      { schema_name: 'public', table_name: 'users', rls_enabled: false },
      { schema_name: 'public', table_name: 'products', rls_enabled: false },
      { schema_name: 'public', table_name: 'transactions', rls_enabled: false },
    ];
  }
}

export async function enableRLS(tableName: string) {
  try {
    const { data, error } = await supabase.rpc('enable_rls', { table_name: tableName });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error enabling RLS:', error);
    throw error;
  }
}

export async function disableRLS(tableName: string) {
  try {
    const { data, error } = await supabase.rpc('disable_rls', { table_name: tableName });
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error disabling RLS:', error);
    throw error;
  }
}

export async function getRLSPolicies(tableName?: string) {
  try {
    const { data, error } = await supabase.rpc('get_rls_policies', { table_name: tableName });
    if (error) {
      console.warn('RLS policies function not available:', error);
      return [];
    }
    return data;
  } catch (error) {
    console.error('Error getting RLS policies:', error);
    return [];
  }
}
