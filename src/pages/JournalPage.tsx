import { useState, useMemo, useEffect } from 'react';
import { Plus, BookOpen, Filter, RefreshCw, List, FileText, ChevronLeft, ChevronRight, X, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useBranch } from '@/contexts/BranchContext';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { JournalEntryForm } from '@/components/JournalEntryForm';
import { JournalEntryTable } from '@/components/JournalEntryTable';
import { useJournalEntries } from '@/hooks/useJournalEntries';
import { JournalEntryFormData } from '@/types/journal';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';

const ITEMS_PER_PAGE = 20;

interface Account {
  id: string;
  code: string;
  name: string;
}

export function JournalPage() {
  const { currentBranch } = useBranch();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mainTab, setMainTab] = useState<string>('entries');
  const [entriesPage, setEntriesPage] = useState(1);
  const [linesPage, setLinesPage] = useState(1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Fetch accounts for filter - filtered by branch
  useEffect(() => {
    const fetchAccounts = async () => {
      if (!currentBranch?.id) {
        setAccounts([]);
        return;
      }

      // Get unique accounts from journal entries for this branch
      const { data: journalLines, error } = await supabase
        .from('journal_entry_lines')
        .select(`
          account_id,
          account_code,
          account_name,
          journal_entries!inner (
            branch_id
          )
        `)
        .eq('journal_entries.branch_id', currentBranch.id);

      if (!error && journalLines) {
        // Get unique accounts
        const uniqueAccounts = new Map<string, Account>();
        journalLines.forEach((line: any) => {
          if (line.account_id && !uniqueAccounts.has(line.account_id)) {
            uniqueAccounts.set(line.account_id, {
              id: line.account_id,
              code: line.account_code,
              name: line.account_name
            });
          }
        });

        // Convert to array and sort by code
        const accountsArray = Array.from(uniqueAccounts.values())
          .sort((a, b) => (a.code || '').localeCompare(b.code || ''));

        setAccounts(accountsArray);
      }
    };
    fetchAccounts();
  }, [currentBranch?.id]);

  // Reset filter when branch changes
  useEffect(() => {
    setSelectedAccountId('all');
    setSearchQuery('');
    setEntriesPage(1);
    setLinesPage(1);
  }, [currentBranch?.id]);

  const {
    journalEntries,
    isLoading,
    refetch,
    createJournalEntry,
    isCreating,
    postJournalEntry,
    isPosting,
    voidJournalEntry,
    isVoiding,
    deleteJournalEntry,
    isDeleting,
    allJournalLines,
    isLoadingLines,
    refetchLines,
  } = useJournalEntries();

  const handleSubmit = (data: JournalEntryFormData) => {
    createJournalEntry(data, {
      onSuccess: () => {
        setShowForm(false);
      },
    });
  };

  // Filter entries by status AND account
  const filteredEntries = useMemo(() => {
    let result = journalEntries || [];

    // Filter by Search Query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(entry => {
        const matchesJournal = entry.description?.toLowerCase().includes(lowerQuery) ||
          entry.entryNumber?.toLowerCase().includes(lowerQuery);

        const matchesLines = entry.lines?.some(line =>
          line.accountName?.toLowerCase().includes(lowerQuery) ||
          line.accountCode?.toLowerCase().includes(lowerQuery) ||
          line.description?.toLowerCase().includes(lowerQuery)
        );

        return matchesJournal || matchesLines;
      });
    }

    return result.filter(entry => {
      // Status filter
      if (statusFilter === 'voided' && !entry.isVoided) return false;
      if (statusFilter !== 'all' && statusFilter !== 'voided') {
        if (entry.status !== statusFilter || entry.isVoided) return false;
      }

      // Account filter - check if any line matches the selected account
      if (selectedAccountId !== 'all') {
        const hasMatchingAccount = entry.lines?.some(line => line.accountId === selectedAccountId);
        if (!hasMatchingAccount) return false;
      }

      return true;
    });
  }, [journalEntries, statusFilter, selectedAccountId, searchQuery]);

  // Filter journal lines by account
  const filteredJournalLines = useMemo(() => {
    let result = allJournalLines || [];

    // Filter by Search Query
    if (searchQuery) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(line =>
        line.accountName?.toLowerCase().includes(lowerQuery) ||
        line.accountCode?.toLowerCase().includes(lowerQuery) ||
        line.description?.toLowerCase().includes(lowerQuery) ||
        line.journalDescription?.toLowerCase().includes(lowerQuery) ||
        line.entryNumber?.toLowerCase().includes(lowerQuery)
      );
    }

    if (selectedAccountId === 'all') {
      return result;
    }
    return result.filter(line => line.accountId === selectedAccountId);
  }, [allJournalLines, selectedAccountId, searchQuery]);

  // Reset to page 1 when filter changes
  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setEntriesPage(1);
  };

  // Pagination for entries
  const entriesTotalPages = Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);
  const paginatedEntries = useMemo(() => {
    const start = (entriesPage - 1) * ITEMS_PER_PAGE;
    return filteredEntries.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredEntries, entriesPage]);

  // Pagination for lines (menggunakan filteredJournalLines)
  const linesTotalPages = Math.ceil(filteredJournalLines.length / ITEMS_PER_PAGE);
  const paginatedLines = useMemo(() => {
    const start = (linesPage - 1) * ITEMS_PER_PAGE;
    return filteredJournalLines.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredJournalLines, linesPage]);

  // Count by status
  const counts = {
    all: journalEntries?.length || 0,
    draft: journalEntries?.filter(e => e.status === 'draft' && !e.isVoided).length || 0,
    posted: journalEntries?.filter(e => e.status === 'posted' && !e.isVoided).length || 0,
    voided: journalEntries?.filter(e => e.isVoided).length || 0,
  };

  // Calculate totals for journal lines (menggunakan filteredJournalLines)
  const linesTotals = {
    totalDebit: filteredJournalLines.reduce((sum, line) => sum + line.debitAmount, 0),
    totalCredit: filteredJournalLines.reduce((sum, line) => sum + line.creditAmount, 0),
  };

  // Handler untuk account filter change
  const handleAccountFilterChange = (value: string) => {
    setSelectedAccountId(value);
    setEntriesPage(1);
    setLinesPage(1);
  };

  // Clear account filter
  const clearAccountFilter = () => {
    setSelectedAccountId('all');
    setEntriesPage(1);
    setLinesPage(1);
  };

  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BookOpen className="h-8 w-8" />
            Jurnal Umum
          </h1>
          <p className="text-muted-foreground">
            Kelola entri jurnal dengan sistem double-entry bookkeeping
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => { refetch(); refetchLines(); }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {mainTab === 'entries' && (
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus className="h-4 w-4 mr-2" />
              {showForm ? 'Tutup Form' : 'Buat Jurnal'}
            </Button>
          )}
        </div>
      </div>

      {/* Main Tabs: Entries vs Lines */}
      <Tabs value={mainTab} onValueChange={setMainTab} className="mb-6">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="entries" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Journal Entries ({counts.all})
          </TabsTrigger>
          <TabsTrigger value="lines" className="flex items-center gap-2">
            <List className="h-4 w-4" />
            Entry Lines ({allJournalLines?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Tab: Journal Entries */}
        <TabsContent value="entries">
          {/* Form Section */}
          {showForm && (
            <div className="mb-6">
              <JournalEntryForm
                onSubmit={handleSubmit}
                isLoading={isCreating}
                onCancel={() => setShowForm(false)}
              />
            </div>
          )}

          {/* Filter & List Section */}
          <div className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={selectedAccountId} onValueChange={handleAccountFilterChange}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Filter berdasarkan Akun" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Akun</SelectItem>
                      {accounts.map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.code} - {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAccountId !== 'all' && (
                    <Button variant="ghost" size="sm" onClick={clearAccountFilter}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari akun atau keterangan..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setEntriesPage(1);
                    setLinesPage(1);
                  }}
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => {
                      setSearchQuery('');
                      setEntriesPage(1);
                      setLinesPage(1);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Selected Account Badge */}
            {selectedAccountId !== 'all' && (
              <div className="flex items-center">
                <Badge variant="secondary">
                  Account: {accounts.find(a => a.id === selectedAccountId)?.code} - {accounts.find(a => a.id === selectedAccountId)?.name}
                </Badge>
              </div>
            )}

            {/* Tabs for quick filter */}
            <Tabs value={statusFilter} onValueChange={handleStatusFilterChange}>
              <div className="flex items-center justify-between">
                <TabsList>
                  <TabsTrigger value="all">
                    Semua ({counts.all})
                  </TabsTrigger>
                  <TabsTrigger value="draft">
                    Draft ({counts.draft})
                  </TabsTrigger>
                  <TabsTrigger value="posted">
                    Posted ({counts.posted})
                  </TabsTrigger>
                  <TabsTrigger value="voided">
                    Void ({counts.voided})
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value={statusFilter} className="mt-4">
                <JournalEntryTable
                  entries={paginatedEntries}
                  isLoading={isLoading}
                  onPost={postJournalEntry}
                  onVoid={(id, reason) => voidJournalEntry({ id, reason })}
                  onDelete={deleteJournalEntry}
                  isPosting={isPosting}
                  isVoiding={isVoiding}
                  isDeleting={isDeleting}
                />

                {/* Pagination for Entries */}
                {entriesTotalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Menampilkan {((entriesPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(entriesPage * ITEMS_PER_PAGE, filteredEntries.length)} dari {filteredEntries.length} jurnal
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEntriesPage(p => Math.max(1, p - 1))}
                        disabled={entriesPage === 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Prev
                      </Button>
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, entriesTotalPages) }, (_, i) => {
                          let pageNum;
                          if (entriesTotalPages <= 5) {
                            pageNum = i + 1;
                          } else if (entriesPage <= 3) {
                            pageNum = i + 1;
                          } else if (entriesPage >= entriesTotalPages - 2) {
                            pageNum = entriesTotalPages - 4 + i;
                          } else {
                            pageNum = entriesPage - 2 + i;
                          }
                          return (
                            <Button
                              key={pageNum}
                              variant={entriesPage === pageNum ? "default" : "outline"}
                              size="sm"
                              className="w-8 h-8 p-0"
                              onClick={() => setEntriesPage(pageNum)}
                            >
                              {pageNum}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEntriesPage(p => Math.min(entriesTotalPages, p + 1))}
                        disabled={entriesPage === entriesTotalPages}
                      >
                        Next
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>

          {/* Legend */}
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h3 className="font-semibold mb-2">Keterangan Status:</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="font-medium text-gray-600">Draft:</span>
                <span className="ml-2 text-muted-foreground">
                  Jurnal yang masih bisa diedit/dihapus. Belum mempengaruhi saldo akun.
                </span>
              </div>
              <div>
                <span className="font-medium text-green-600">Posted:</span>
                <span className="ml-2 text-muted-foreground">
                  Jurnal yang sudah final. Saldo akun sudah terupdate.
                </span>
              </div>
              <div>
                <span className="font-medium text-red-600">Void:</span>
                <span className="ml-2 text-muted-foreground">
                  Jurnal yang dibatalkan. Saldo akun sudah dikembalikan.
                </span>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Tab: Journal Entry Lines */}
        <TabsContent value="lines">
          <div className="space-y-4">
            {/* Account Filter & Search Bar for Lines */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <Select value={selectedAccountId} onValueChange={handleAccountFilterChange}>
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Filter berdasarkan Akun" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Semua Akun</SelectItem>
                      {accounts.map(account => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.code} - {account.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedAccountId !== 'all' && (
                    <Button variant="ghost" size="sm" onClick={clearAccountFilter}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="relative w-full md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Cari akun atau keterangan..."
                  className="pl-9"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setEntriesPage(1);
                    setLinesPage(1);
                  }}
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3 hover:bg-transparent"
                    onClick={() => {
                      setSearchQuery('');
                      setEntriesPage(1);
                      setLinesPage(1);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* Selected Account Badge */}
            {selectedAccountId !== 'all' && (
              <div className="flex items-center">
                <Badge variant="secondary">
                  Account: {accounts.find(a => a.id === selectedAccountId)?.code} - {accounts.find(a => a.id === selectedAccountId)?.name}
                </Badge>
              </div>
            )}

            {/* Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="text-sm text-blue-600 font-medium">Total Baris</div>
                <div className="text-2xl font-bold text-blue-800">{filteredJournalLines.length}</div>
              </div>
              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <div className="text-sm text-green-600 font-medium">Total Debit</div>
                <div className="text-2xl font-bold text-green-800">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(linesTotals.totalDebit)}
                </div>
              </div>
              <div className="p-4 bg-red-50 rounded-lg border border-red-200">
                <div className="text-sm text-red-600 font-medium">Total Credit</div>
                <div className="text-2xl font-bold text-red-800">
                  {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(linesTotals.totalCredit)}
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[140px]">No. Jurnal</TableHead>
                    <TableHead className="w-[100px]">Tanggal</TableHead>
                    <TableHead className="w-[80px]">Kode Akun</TableHead>
                    <TableHead>Nama Akun</TableHead>
                    <TableHead className="text-right w-[130px]">Debit</TableHead>
                    <TableHead className="text-right w-[130px]">Credit</TableHead>
                    <TableHead>Keterangan</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoadingLines ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Memuat data...
                      </TableCell>
                    </TableRow>
                  ) : !allJournalLines || allJournalLines.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                        Tidak ada data journal entry lines
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedLines.map((line) => (
                      <TableRow key={line.id} className={line.isVoided ? 'bg-red-50 opacity-60' : ''}>
                        <TableCell className="font-mono text-xs">{line.entryNumber}</TableCell>
                        <TableCell className="text-sm">
                          {line.entryDate ? format(line.entryDate, 'dd/MM/yy', { locale: idLocale }) : '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{line.accountCode}</TableCell>
                        <TableCell className="font-medium">{line.accountName}</TableCell>
                        <TableCell className="text-right font-mono">
                          {line.debitAmount > 0 ? (
                            <span className="text-green-600">
                              {new Intl.NumberFormat('id-ID').format(line.debitAmount)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {line.creditAmount > 0 ? (
                            <span className="text-red-600">
                              {new Intl.NumberFormat('id-ID').format(line.creditAmount)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                          {line.description || line.journalDescription}
                        </TableCell>
                        <TableCell>
                          {line.isVoided ? (
                            <Badge variant="destructive" className="text-xs">Void</Badge>
                          ) : line.journalStatus === 'posted' ? (
                            <Badge variant="default" className="bg-green-600 text-xs">Posted</Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">Draft</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination for Lines */}
            {linesTotalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Menampilkan {((linesPage - 1) * ITEMS_PER_PAGE) + 1} - {Math.min(linesPage * ITEMS_PER_PAGE, filteredJournalLines.length)} dari {filteredJournalLines.length} baris
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinesPage(p => Math.max(1, p - 1))}
                    disabled={linesPage === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Prev
                  </Button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: Math.min(5, linesTotalPages) }, (_, i) => {
                      let pageNum;
                      if (linesTotalPages <= 5) {
                        pageNum = i + 1;
                      } else if (linesPage <= 3) {
                        pageNum = i + 1;
                      } else if (linesPage >= linesTotalPages - 2) {
                        pageNum = linesTotalPages - 4 + i;
                      } else {
                        pageNum = linesPage - 2 + i;
                      }
                      return (
                        <Button
                          key={pageNum}
                          variant={linesPage === pageNum ? "default" : "outline"}
                          size="sm"
                          className="w-8 h-8 p-0"
                          onClick={() => setLinesPage(pageNum)}
                        >
                          {pageNum}
                        </Button>
                      );
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setLinesPage(p => Math.min(linesTotalPages, p + 1))}
                    disabled={linesPage === linesTotalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Balance Check */}
            {allJournalLines && allJournalLines.length > 0 && (
              <div className={`p-4 rounded-lg border ${Math.abs(linesTotals.totalDebit - linesTotals.totalCredit) < 0.01 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Balance Check:</span>
                  {Math.abs(linesTotals.totalDebit - linesTotals.totalCredit) < 0.01 ? (
                    <span className="text-green-600 font-bold">✓ BALANCED</span>
                  ) : (
                    <span className="text-red-600 font-bold">
                      ✗ UNBALANCED (Selisih: {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(Math.abs(linesTotals.totalDebit - linesTotals.totalCredit))})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default JournalPage;
