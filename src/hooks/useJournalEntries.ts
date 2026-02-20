import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useBranch } from '@/contexts/BranchContext';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  JournalEntry,
  JournalEntryLine,
  JournalEntryFormData,
  DbJournalEntry,
  DbJournalEntryLine
} from '@/types/journal';

// Convert DB to App format
const fromDbToApp = (db: DbJournalEntry, lines: DbJournalEntryLine[] = []): JournalEntry => ({
  id: db.id,
  entryNumber: db.entry_number,
  entryDate: new Date(db.entry_date),
  description: db.description,
  referenceType: db.reference_type as JournalEntry['referenceType'],
  referenceId: db.reference_id,
  status: db.status as JournalEntry['status'],
  totalDebit: Number(db.total_debit) || 0,
  totalCredit: Number(db.total_credit) || 0,
  createdBy: db.created_by,
  createdByName: db.created_by_name,
  createdAt: new Date(db.created_at),
  approvedBy: db.approved_by,
  approvedByName: db.approved_by_name,
  approvedAt: db.approved_at ? new Date(db.approved_at) : undefined,
  isVoided: db.is_voided,
  voidedBy: db.voided_by,
  voidedByName: db.voided_by_name,
  voidedAt: db.voided_at ? new Date(db.voided_at) : undefined,
  voidReason: db.void_reason,
  branchId: db.branch_id,
  lines: lines.map(line => ({
    id: line.id,
    journalEntryId: line.journal_entry_id,
    lineNumber: line.line_number,
    accountId: line.account_id,
    accountCode: line.account_code,
    accountName: line.account_name,
    debitAmount: Number(line.debit_amount) || 0,
    creditAmount: Number(line.credit_amount) || 0,
    description: line.description,
    createdAt: new Date(line.created_at)
  }))
});

export const useJournalEntries = () => {
  const { currentBranch } = useBranch();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch all journal entries with lines in a single query (avoid N+1 problem)
  const {
    data: journalEntries,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['journalEntries', currentBranch?.id],
    queryFn: async () => {
      // Fetch entries with nested lines and account info in ONE query
      let query = supabase
        .from('journal_entries')
        .select(`
          *,
          journal_entry_lines (
            *,
            accounts (
              id,
              code,
              name
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (currentBranch?.id) {
        query = query.eq('branch_id', currentBranch.id);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Extract unique profile IDs needed 
      const profileIds = new Set<string>();
      (data || []).forEach((entry: any) => {
        if (entry.created_by) profileIds.add(entry.created_by);
        if (entry.voided_by) profileIds.add(entry.voided_by);
        if (entry.approved_by) profileIds.add(entry.approved_by);
      });

      // Fetch profiles mapping
      const profileMap: Record<string, string> = {};
      if (profileIds.size > 0) {
        const { data: profilesData, error: profilesError } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', Array.from(profileIds));

        if (!profilesError && profilesData) {
          profilesData.forEach((p: any) => {
            profileMap[p.id] = p.full_name;
          });
        }
      }

      // Transform to app format - lines are already included with account fallback
      const entries: JournalEntry[] = (data || []).map((entry: any) => {
        const lines = (entry.journal_entry_lines || [])
          .sort((a: any, b: any) => a.line_number - b.line_number)
          .map((line: any) => ({
            ...line,
            // Fallback to accounts table if account_code/account_name is empty
            account_code: line.account_code || line.accounts?.code || '',
            account_name: line.account_name || line.accounts?.name || ''
          }));

        // Use joined profiles to populate names if the generic db columns are empty
        const createdByName = entry.created_by_name || (entry.created_by ? profileMap[entry.created_by] : '') || 'System';
        const voidedByName = entry.voided_by_name || (entry.voided_by ? profileMap[entry.voided_by] : '');
        const approvedByName = entry.approved_by_name || (entry.approved_by ? profileMap[entry.approved_by] : '');

        const dbEntryWithNames = {
          ...entry,
          created_by_name: createdByName,
          voided_by_name: voidedByName,
          approved_by_name: approvedByName
        };

        return fromDbToApp(dbEntryWithNames as DbJournalEntry, lines as DbJournalEntryLine[]);
      });

      console.log(`[useJournalEntries] Loaded ${entries.length} journal entries`);
      return entries;
    },
    enabled: !!currentBranch,
    staleTime: 1000 * 60 * 2, // 2 minutes
    gcTime: 1000 * 60 * 5, // 5 minutes cache
    refetchOnWindowFocus: false,
  });

  // Create journal entry - STRICTLY RPC
  const createMutation = useMutation({
    mutationFn: async (formData: JournalEntryFormData) => {
      // Validate balance
      const totalDebit = formData.lines.reduce((sum, line) => sum + (line.debitAmount || 0), 0);
      const totalCredit = formData.lines.reduce((sum, line) => sum + (line.creditAmount || 0), 0);

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error('Debit dan Credit harus seimbang');
      }

      if (formData.lines.length < 2) {
        throw new Error('Minimal harus ada 2 baris jurnal');
      }

      if (!currentBranch?.id) {
        throw new Error('Branch tidak dipilih. Silakan pilih branch terlebih dahulu.');
      }

      // ============================================================================
      // USE RPC: create_journal_atomic
      // Creates journal entry with all lines in single atomic transaction
      // ============================================================================

      // Convert lines to RPC format
      const rpcLines = formData.lines.map(line => ({
        account_id: line.accountId,
        debit_amount: line.debitAmount || 0,
        credit_amount: line.creditAmount || 0,
        description: line.description || '',
      }));

      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('create_journal_atomic', {
          p_branch_id: currentBranch.id,
          p_entry_date: formData.entryDate.toISOString().split('T')[0],
          p_description: formData.description,
          p_reference_type: formData.referenceType || 'manual',
          p_reference_id: formData.referenceId || null,
          p_lines: rpcLines,
          p_auto_post: false, // Manual journals start as draft
          p_created_by: user?.id, // Menambahkan p_created_by agar tidak ambigu dengan overload funct yg lain
        });

      if (rpcError) {
        console.error('RPC create_journal_atomic error:', JSON.stringify(rpcError, null, 2));
        throw new Error(rpcError.message || 'Unknown RPC error');
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.error_message || 'Gagal membuat jurnal');
      }

      console.log('✅ Journal created via RPC:', rpcResult.journal_id, 'Entry:', rpcResult.entry_number);
      return { id: rpcResult.journal_id, entry_number: rpcResult.entry_number };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      toast({
        title: 'Berhasil',
        description: 'Jurnal berhasil dibuat',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Gagal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Post journal entry (change status to posted) - RPC Atomik
  const postMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!id) throw new Error('Journal entry ID is required');
      if (!currentBranch?.id) throw new Error('Branch required');

      console.log('[postJournalEntry] Calling RPC:', id);

      const { data: rpcResultRaw, error } = await supabase.rpc('post_journal_atomic', {
        p_journal_id: id,
        p_branch_id: currentBranch.id
      });

      if (error) {
        console.error('[postJournalEntry] RPC error:', error);
        throw new Error(error.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
      if (!rpcResult?.success) {
        throw new Error(rpcResult?.message || 'Failed to post journal entry');
      }

      return rpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({
        title: 'Berhasil',
        description: 'Jurnal berhasil diposting',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Gagal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Void journal entry - STRICTLY RPC
  const voidMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      // Guard
      if (!id) throw new Error('Journal entry ID is required for voiding');
      if (!currentBranch?.id) throw new Error('Branch context is missing');

      // Call RPC void_journal_entry
      const { data: rpcResultRaw, error: rpcError } = await supabase
        .rpc('void_journal_entry', {
          p_journal_id: id,
          p_branch_id: currentBranch.id,
          p_reason: reason
        });

      if (rpcError) {
        console.error('RPC void_journal_entry error:', rpcError);
        throw new Error(rpcError.message);
      }

      const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;

      if (rpcResult && rpcResult.success === false) {
        throw new Error(rpcResult.error_message || 'Gagal membatalkan jurnal');
      }

      console.log('✅ Journal voided via RPC');
      return rpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      toast({
        title: 'Berhasil',
        description: 'Jurnal berhasil dibatalkan (void)',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Gagal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete draft journal entry
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Guard: pastikan id tidak undefined
      if (!id) {
        throw new Error('Journal entry ID is required for deletion');
      }

      // Only allow deleting draft entries
      const { error } = await supabase
        .from('journal_entries')
        .delete()
        .eq('id', id)
        .eq('status', 'draft');

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      toast({
        title: 'Berhasil',
        description: 'Jurnal draft berhasil dihapus',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Gagal',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Fetch all journal entry lines (for separate tab view)
  const {
    data: allJournalLines,
    isLoading: isLoadingLines,
    refetch: refetchLines
  } = useQuery({
    queryKey: ['journalEntryLines', currentBranch?.id],
    queryFn: async () => {
      // Fetch all lines with their journal entry info AND account info
      const { data, error } = await supabase
        .from('journal_entry_lines')
        .select(`
          *,
          journal_entries!inner (
            id,
            entry_number,
            entry_date,
            description,
            status,
            is_voided,
            reference_type,
            branch_id
          ),
          accounts (
            id,
            code,
            name
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Filter by branch and map to app format
      const filteredData = (data || []).filter((line: any) => {
        if (!currentBranch?.id) return true;
        return line.journal_entries?.branch_id === currentBranch.id;
      });

      return filteredData.map((line: any) => ({
        id: line.id,
        journalEntryId: line.journal_entry_id,
        entryNumber: line.journal_entries?.entry_number || '',
        entryDate: line.journal_entries?.entry_date ? new Date(line.journal_entries.entry_date) : null,
        journalDescription: line.journal_entries?.description || '',
        journalStatus: line.journal_entries?.status || '',
        isVoided: line.journal_entries?.is_voided || false,
        referenceType: line.journal_entries?.reference_type || '',
        lineNumber: line.line_number,
        accountId: line.account_id,
        accountCode: line.account_code || line.accounts?.code || '',
        accountName: line.account_name || line.accounts?.name || '',
        debitAmount: Number(line.debit_amount) || 0,
        creditAmount: Number(line.credit_amount) || 0,
        description: line.description,
        createdAt: new Date(line.created_at)
      }));
    },
    enabled: !!currentBranch,
    staleTime: 1000 * 60 * 2, // 2 minutes
    gcTime: 1000 * 60 * 5, // 5 minutes cache
    refetchOnWindowFocus: false,
  });

  return {
    journalEntries,
    isLoading,
    error,
    refetch,
    createJournalEntry: createMutation.mutate,
    isCreating: createMutation.isPending,
    postJournalEntry: postMutation.mutate,
    isPosting: postMutation.isPending,
    voidJournalEntry: voidMutation.mutate,
    isVoiding: voidMutation.isPending,
    deleteJournalEntry: deleteMutation.mutate,
    isDeleting: deleteMutation.isPending,
    // New: all journal lines
    allJournalLines,
    isLoadingLines,
    refetchLines,
  };
};
