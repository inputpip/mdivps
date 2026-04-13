import React, { useState, useMemo } from 'react';
import { format, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import { id as localeId } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import {
  Eye,
  Send,
  Trash2,
  Ban,
  ChevronDown,
  ChevronUp,
  FileText,
  CheckCircle,
  XCircle,
  Clock,
  FileDown,
  Printer,
  Calendar,
  X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { JournalEntry } from '@/types/journal';
import {
  downloadSingleJournalPDF,
  downloadJournalReportPDF,
  printSingleJournal
} from '@/components/JournalEntryPDF';

interface JournalEntryTableProps {
  entries: JournalEntry[];
  isLoading?: boolean;
  onPost?: (id: string) => void;
  onVoid?: (id: string, reason: string) => void;
  onDelete?: (id: string) => void;
  isPosting?: boolean;
  isVoiding?: boolean;
  isDeleting?: boolean;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
};


const getStatusBadge = (status: string, isVoided: boolean) => {
  if (isVoided) {
    return <Badge variant="destructive"><XCircle className="h-3 w-3 mr-1" />Void</Badge>;
  }
  switch (status) {
    case 'draft':
      return <Badge variant="secondary"><Clock className="h-3 w-3 mr-1" />Draft</Badge>;
    case 'posted':
      return <Badge variant="default" className="bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Posted</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
};

const getReferenceTypeBadge = (type?: string) => {
  switch (type) {
    case 'manual':
      return <Badge variant="outline">Manual</Badge>;
    case 'adjustment':
      return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20">Penyesuaian</Badge>;
    case 'closing':
      return <Badge variant="outline" className="bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20">Penutup</Badge>;
    case 'opening':
      return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20">Pembukaan</Badge>;
    case 'transaction':
      return <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20">Transaksi</Badge>;
    case 'expense':
      return <Badge variant="outline" className="bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20">Pengeluaran</Badge>;
    case 'payroll':
      return <Badge variant="outline" className="bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500/20">Gaji</Badge>;
    case 'receivable':
      return <Badge variant="outline" className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-500/20">Piutang</Badge>;
    case 'receivable_payment':
      return <Badge variant="outline" className="bg-teal-500/10 text-teal-600 dark:text-teal-400 hover:bg-teal-500/20">Bayar Piutang</Badge>;
    case 'payable':
      return <Badge variant="outline" className="bg-pink-500/10 text-pink-600 dark:text-pink-400 hover:bg-pink-500/20">Hutang</Badge>;
    default:
      return null;
  }
};

const getReferenceTypeLabel = (type?: string) => {
  const labels: Record<string, string> = {
    'manual': 'Manual',
    'adjustment': 'Penyesuaian',
    'closing': 'Penutup',
    'opening': 'Pembukaan',
    'transaction': 'Transaksi',
    'expense': 'Pengeluaran',
    'payroll': 'Gaji',
    'receivable': 'Piutang',
    'receivable_payment': 'Bayar Piutang',
    'payable': 'Hutang',
    'transfer': 'Transfer',
    'advance': 'Panjar',
  };
  return labels[type || ''] || type || '-';
};

export function JournalEntryTable({
  entries,
  isLoading,
  onPost,
  onVoid,
  onDelete,
  isPosting,
  isVoiding,
  isDeleting
}: JournalEntryTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined
  });

  // Filter entries by date range
  const filteredEntries = useMemo(() => {
    if (!dateRange.from || !entries) return entries;

    return entries.filter(entry => {
      const entryDate = new Date(entry.entryDate);
      if (dateRange.from && !dateRange.to) {
        return entryDate >= startOfDay(dateRange.from);
      }
      if (dateRange.from && dateRange.to) {
        return isWithinInterval(entryDate, {
          start: startOfDay(dateRange.from),
          end: endOfDay(dateRange.to)
        });
      }
      return true;
    });
  }, [entries, dateRange]);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const handleVoid = () => {
    if (selectedEntry && onVoid && voidReason) {
      onVoid(selectedEntry.id, voidReason);
      setShowVoidDialog(false);
      setVoidReason('');
      setSelectedEntry(null);
    }
  };

  const handleDelete = () => {
    if (selectedEntry && onDelete) {
      onDelete(selectedEntry.id);
      setShowDeleteDialog(false);
      setSelectedEntry(null);
    }
  };

  const clearDateFilter = () => {
    setDateRange({ from: undefined, to: undefined });
  };

  // Export to Excel
  const handleExportExcel = () => {
    const dataToExport = filteredEntries || [];

    // Create main entries sheet
    const entriesData = dataToExport.map(entry => ({
      'No. Jurnal': entry.entryNumber,
      'Tanggal': format(entry.entryDate, 'dd/MM/yyyy', { locale: localeId }),
      'Keterangan': entry.description,
      'Tipe': getReferenceTypeLabel(entry.referenceType),
      'Total Debit': entry.totalDebit,
      'Total Credit': entry.totalCredit,
      'Status': entry.isVoided ? 'VOID' : entry.status.toUpperCase(),
      'Dibuat Oleh': entry.createdByName || '-',
      'Tanggal Dibuat': format(entry.createdAt, 'dd/MM/yyyy HH:mm', { locale: localeId }),
    }));

    // Create detail lines sheet
    const linesData: any[] = [];
    dataToExport.forEach(entry => {
      entry.lines.forEach(line => {
        linesData.push({
          'No. Jurnal': entry.entryNumber,
          'Tanggal': format(entry.entryDate, 'dd/MM/yyyy', { locale: localeId }),
          'Kode Akun': line.accountCode,
          'Nama Akun': line.accountName,
          'Keterangan': line.description || '-',
          'Debit': line.debitAmount > 0 ? line.debitAmount : '',
          'Credit': line.creditAmount > 0 ? line.creditAmount : '',
        });
      });
    });

    const wb = XLSX.utils.book_new();

    // Add entries sheet
    const wsEntries = XLSX.utils.json_to_sheet(entriesData);
    XLSX.utils.book_append_sheet(wb, wsEntries, 'Jurnal');

    // Add lines sheet
    const wsLines = XLSX.utils.json_to_sheet(linesData);
    XLSX.utils.book_append_sheet(wb, wsLines, 'Detail Akun');

    // Generate filename
    const filename = dateRange.from && dateRange.to
      ? `Jurnal_${format(dateRange.from, 'yyyyMMdd')}_${format(dateRange.to, 'yyyyMMdd')}.xlsx`
      : `Jurnal_${format(new Date(), 'yyyyMMdd')}.xlsx`;

    XLSX.writeFile(wb, filename);
  };

  // Export to PDF
  const handleExportPdf = () => {
    const dataToExport = filteredEntries || [];
    downloadJournalReportPDF(dataToExport, dateRange.from, dateRange.to);
  };

  // Print single journal
  const handlePrintSingle = (entry: JournalEntry) => {
    printSingleJournal(entry);
  };

  // Download single journal PDF
  const handleDownloadSingle = (entry: JournalEntry) => {
    downloadSingleJournalPDF(entry);
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div className="flex gap-4 items-center flex-wrap">
          {/* Date Range Filter */}
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-[280px] justify-start text-left font-normal",
                    !dateRange.from && !dateRange.to && "text-muted-foreground"
                  )}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {dateRange.from ? (
                    dateRange.to ? (
                      `${format(dateRange.from, "d MMM yyyy", { locale: localeId })} - ${format(dateRange.to, "d MMM yyyy", { locale: localeId })}`
                    ) : (
                      `${format(dateRange.from, "d MMM yyyy", { locale: localeId })} - ...`
                    )
                  ) : (
                    "Filter Tanggal"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={dateRange.from && dateRange.to ? { from: dateRange.from, to: dateRange.to } : dateRange.from ? { from: dateRange.from, to: undefined } : undefined}
                  onSelect={(range) => {
                    if (range) {
                      setDateRange({ from: range.from, to: range.to });
                    } else {
                      setDateRange({ from: undefined, to: undefined });
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>

            {(dateRange.from || dateRange.to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearDateFilter}
                className="h-8 px-2"
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>

          {/* Entry count */}
          <div className="text-sm text-muted-foreground">
            Menampilkan {filteredEntries?.length || 0} dari {entries?.length || 0} jurnal
          </div>
        </div>

        {/* Export buttons */}
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExportExcel} disabled={!filteredEntries?.length}>
            <FileDown className="mr-2 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" onClick={handleExportPdf} disabled={!filteredEntries?.length}>
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      {/* Table */}
      {!filteredEntries || filteredEntries.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <p className="text-lg font-medium">Belum ada jurnal</p>
          <p className="text-sm text-muted-foreground">
            {dateRange.from ? 'Tidak ada jurnal pada periode yang dipilih' : 'Klik "Buat Jurnal" untuk membuat jurnal baru'}
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>No. Jurnal</TableHead>
                <TableHead>Tanggal</TableHead>
                <TableHead>Keterangan</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Debit</TableHead>
                <TableHead className="text-right">Credit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[150px]">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.map((entry) => (
                <React.Fragment key={entry.id}>
                  <TableRow
                    className={entry.isVoided ? 'bg-destructive/10 dark:bg-destructive/20' : ''}
                  >
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => toggleRow(entry.id)}
                      >
                        {expandedRows.has(entry.id) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono font-medium">
                      {entry.entryNumber}
                    </TableCell>
                    <TableCell>
                      <div>
                        <div>{format(entry.entryDate, 'dd MMM yyyy', { locale: localeId })}</div>
                        <div className="text-xs text-muted-foreground">
                          {format(entry.createdAt, 'HH:mm', { locale: localeId })}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={entry.description}>
                      {entry.description}
                    </TableCell>
                    <TableCell>
                      {getReferenceTypeBadge(entry.referenceType)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(entry.totalDebit)}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {formatCurrency(entry.totalCredit)}
                    </TableCell>
                    <TableCell>
                      {getStatusBadge(entry.status, entry.isVoided)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setSelectedEntry(entry);
                            setShowDetailDialog(true);
                          }}
                          title="Lihat Detail"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-blue-600"
                          onClick={() => handlePrintSingle(entry)}
                          title="Cetak Jurnal"
                        >
                          <Printer className="h-4 w-4" />
                        </Button>

                        {entry.status === 'draft' && !entry.isVoided && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600"
                              onClick={() => {
                                setSelectedEntry(entry);
                                if (onPost) onPost(entry.id);
                              }}
                              disabled={isPosting}
                              title="Post Jurnal"
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              onClick={() => {
                                setSelectedEntry(entry);
                                setShowDeleteDialog(true);
                              }}
                              disabled={isDeleting}
                              title="Hapus"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}

                        {entry.status === 'posted' && !entry.isVoided && entry.referenceType !== 'opening' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-orange-600"
                            onClick={() => {
                              setSelectedEntry(entry);
                              setShowVoidDialog(true);
                            }}
                            disabled={isVoiding}
                            title="Batalkan"
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expanded Row - Journal Lines */}
                  {expandedRows.has(entry.id) && (
                    <TableRow className="bg-muted/30">
                      <TableCell colSpan={9} className="p-0">
                        <div className="p-4">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="w-[50px]">No</TableHead>
                                <TableHead>Kode Akun</TableHead>
                                <TableHead>Nama Akun</TableHead>
                                <TableHead>Keterangan</TableHead>
                                <TableHead className="text-right">Debit</TableHead>
                                <TableHead className="text-right">Credit</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {entry.lines.map((line) => (
                                <TableRow key={line.id}>
                                  <TableCell>{line.lineNumber}</TableCell>
                                  <TableCell className="font-mono">{line.accountCode}</TableCell>
                                  <TableCell>{line.accountName}</TableCell>
                                  <TableCell className="text-muted-foreground">{line.description || '-'}</TableCell>
                                  <TableCell className="text-right font-mono">
                                    {line.debitAmount > 0 ? formatCurrency(line.debitAmount) : '-'}
                                  </TableCell>
                                  <TableCell className="text-right font-mono">
                                    {line.creditAmount > 0 ? formatCurrency(line.creditAmount) : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>

                          {/* Entry metadata */}
                          <div className="mt-4 text-xs text-muted-foreground space-y-1">
                            <p>Dibuat oleh: {entry.createdByName || '-'} pada {format(entry.createdAt, 'dd MMM yyyy HH:mm', { locale: localeId })}</p>
                            {entry.approvedByName && (
                              <p>Diposting oleh: {entry.approvedByName} pada {entry.approvedAt && format(entry.approvedAt, 'dd MMM yyyy HH:mm', { locale: localeId })}</p>
                            )}
                            {entry.isVoided && (
                              <p className="text-destructive">
                                Dibatalkan oleh: {entry.voidedByName} pada {entry.voidedAt && format(entry.voidedAt, 'dd MMM yyyy HH:mm', { locale: localeId })}
                                {entry.voidReason && ` - Alasan: ${entry.voidReason}`}
                              </p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Detail Jurnal {selectedEntry?.entryNumber}</DialogTitle>
            <DialogDescription>
              {selectedEntry && `${format(selectedEntry.entryDate, 'dd MMMM yyyy', { locale: localeId })} - ${format(selectedEntry.createdAt, 'HH:mm', { locale: localeId })}`}
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                {getStatusBadge(selectedEntry.status, selectedEntry.isVoided)}
                {getReferenceTypeBadge(selectedEntry.referenceType)}
              </div>

              <div>
                <Label>Keterangan</Label>
                <p className="mt-1">{selectedEntry.description}</p>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Akun</TableHead>
                    <TableHead className="text-right">Debit</TableHead>
                    <TableHead className="text-right">Credit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedEntry.lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>
                        <span className="font-mono text-xs mr-2">{line.accountCode}</span>
                        {line.accountName}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {line.debitAmount > 0 ? formatCurrency(line.debitAmount) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {line.creditAmount > 0 ? formatCurrency(line.creditAmount) : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => selectedEntry && handleDownloadSingle(selectedEntry)}>
              <FileDown className="mr-2 h-4 w-4" /> Download PDF
            </Button>
            <Button variant="outline" onClick={() => selectedEntry && handlePrintSingle(selectedEntry)}>
              <Printer className="mr-2 h-4 w-4" /> Cetak
            </Button>
            <Button variant="outline" onClick={() => setShowDetailDialog(false)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Void Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Batalkan Jurnal</DialogTitle>
            <DialogDescription>
              Jurnal yang sudah diposting tidak bisa dihapus, tapi bisa dibatalkan (void).
              Saldo akun akan dikembalikan.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Alasan Pembatalan</Label>
              <Input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Masukkan alasan pembatalan..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowVoidDialog(false)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleVoid}
              disabled={!voidReason || isVoiding}
            >
              {isVoiding ? 'Memproses...' : 'Batalkan Jurnal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Jurnal Draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Jurnal draft "{selectedEntry?.entryNumber}" akan dihapus permanen.
              Tindakan ini tidak dapat dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Menghapus...' : 'Hapus'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
