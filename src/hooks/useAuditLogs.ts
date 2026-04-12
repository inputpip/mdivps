import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface AuditLog {
  id: string;
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | string;
  record_id: string;
  old_data: any;
  new_data: any;
  user_id: string;
  user_email: string;
  user_role: string;
  changed_fields: Record<string, any> | null;
  created_at: string;
  ip_address: string;
  user_agent: string;
}

export const useAuditLogs = (limit = 100, tableName?: string) => {
  return useQuery({
    queryKey: ['audit_logs', limit, tableName],
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (tableName && tableName !== 'all') {
        query = query.eq('table_name', tableName);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as AuditLog[];
    },
    // staleTime dihapus agar data tidak tertahan di cache dan selalu diperbarui
  });
};
