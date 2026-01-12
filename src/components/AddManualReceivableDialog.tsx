import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Plus, Upload, Download, Check, ChevronsUpDown, AlertCircle, CalendarIcon, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useBranch } from '@/contexts/BranchContext';
import { useCustomers } from '@/hooks/useCustomers';
import { generateSequentialId } from '@/utils/idGenerator';
import { formatCurrency } from '@/lib/utils';
// journalService removed - now using RPC for all journal operations
import { formatNumberWithCommas, parseNumberWithCommas } from '@/utils/formatNumber';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { useTimezone } from '@/contexts/TimezoneContext';
import { getOfficeTime } from '@/utils/officeTime';

interface AddManualReceivableDialogProps {
  onSuccess?: () => void;
}

interface ImportRow {
  customerName: string;
  customerPhone?: string;
  amount: number;
  dueDate?: string;
  notes?: string;
  isValid: boolean;
  error?: string;
  customerId?: string;
}

export function AddManualReceivableDialog({ onSuccess }: AddManualReceivableDialogProps) {
  const { currentBranch } = useBranch();
  const { customers } = useCustomers();
  const { timezone } = useTimezone();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('manual');
  const [isLoading, setIsLoading] = useState(false);

  // Manual input state
  const [customerOpen, setCustomerOpen] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedCustomerName, setSelectedCustomerName] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState<Date | undefined>(new Date());
  const [transactionDateOpen, setTransactionDateOpen] = useState(false);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [dueDateOpen, setDueDateOpen] = useState(false);
  const [notes, setNotes] = useState('');

  // Import state
  const [importData, setImportData] = useState<ImportRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setSelectedCustomerId('');
    setSelectedCustomerName('');
    setAmount('');
    setTransactionDate(getOfficeTime(timezone));
    setDueDate(undefined);
    setNotes('');
    setImportData([]);
    setActiveTab('manual');
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCustomerId || !selectedCustomerName) {
      toast.error('Pilih pelanggan terlebih dahulu');
      return;
    }

    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error('Jumlah piutang harus lebih dari 0');
      return;
    }

    setIsLoading(true);

    try {
      // Generate transaction ID for migration
      const transactionId = await generateSequentialId({
        branchName: currentBranch?.name,
        tableName: 'transactions',
        pageCode: 'MIG-AR',
        branchId: currentBranch?.id || null,
      });

      // Insert as transaction with migration info in items metadata
      const orderDate = transactionDate || getOfficeTime(timezone);
      const migrationMeta = {
        _isMigrationMeta: true,
        source: 'migration',
        notes: notes || 'Piutang migrasi dari sistem lain',
      };
      const { error } = await supabase.from('transactions').insert({
        id: transactionId,
        customer_id: selectedCustomerId,
        customer_name: selectedCustomerName,
        order_date: orderDate.toISOString().split('T')[0],
        due_date: dueDate ? dueDate.toISOString().split('T')[0] : null,
        items: [migrationMeta], // Store migration info in items
        subtotal: parsedAmount,
        total: parsedAmount,
        paid_amount: 0,
        payment_status: 'Belum Lunas',
        status: 'Selesai',
        branch_id: currentBranch?.id || null,
      });

      if (error) throw error;

      // Create migration journal entry via RPC
      if (currentBranch?.id) {
        const { data: journalResultRaw, error: journalError } = await supabase
          .rpc('create_migration_receivable_journal_rpc', {
            p_branch_id: currentBranch.id,
            p_receivable_id: transactionId,
            p_receivable_date: orderDate.toISOString().split('T')[0],
            p_amount: parsedAmount,
            p_customer_name: selectedCustomerName,
            p_description: notes || 'Piutang migrasi dari sistem lain',
          });

        const journalResult = Array.isArray(journalResultRaw) ? journalResultRaw[0] : journalResultRaw;
        if (journalError || !journalResult?.success) {
          console.warn('Gagal membuat jurnal migrasi:', journalError?.message || journalResult?.error_message);
          toast.warning(`Piutang tersimpan, tapi jurnal gagal: ${journalError?.message || journalResult?.error_message}`);
        } else {
          console.log('✅ Jurnal piutang migrasi berhasil via RPC:', journalResult.journal_id);
        }
      }

      toast.success(`Piutang migrasi ${formatCurrency(parsedAmount)} untuk ${selectedCustomerName} berhasil ditambahkan`);
      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Error adding migration receivable:', error);
      toast.error(`Gagal menambahkan piutang: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data);
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(worksheet) as any[];

      // Map and validate data
      const mappedData: ImportRow[] = jsonData.map((row) => {
        const customerName = row['Nama Pelanggan'] || row['Customer Name'] || row['nama'] || '';
        const customerPhone = row['Telepon'] || row['Phone'] || row['telepon'] || '';
        const amountRaw = row['Jumlah'] || row['Amount'] || row['jumlah'] || 0;
        const dueDateRaw = row['Jatuh Tempo'] || row['Due Date'] || row['jatuh_tempo'] || '';
        const notesRaw = row['Catatan'] || row['Notes'] || row['catatan'] || '';

        const amount = typeof amountRaw === 'string' ? parseNumberWithCommas(amountRaw) : Number(amountRaw);

        // Find customer by name or phone
        let foundCustomer = customers?.find(c =>
          c.name.toLowerCase() === customerName.toLowerCase() ||
          (customerPhone && c.phone === customerPhone)
        );

        const isValid = !!customerName && amount > 0 && !!foundCustomer;
        const error = !customerName
          ? 'Nama pelanggan kosong'
          : amount <= 0
            ? 'Jumlah tidak valid'
            : !foundCustomer
              ? 'Pelanggan tidak ditemukan'
              : undefined;

        return {
          customerName,
          customerPhone,
          amount,
          dueDate: dueDateRaw,
          notes: notesRaw,
          isValid,
          error,
          customerId: foundCustomer?.id,
        };
      });

      setImportData(mappedData);
    } catch (error: any) {
      console.error('Error reading file:', error);
      toast.error('Gagal membaca file Excel');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImportSubmit = async () => {
    const validRows = importData.filter(row => row.isValid);
    if (validRows.length === 0) {
      toast.error('Tidak ada data valid untuk diimport');
      return;
    }

    setIsLoading(true);
    let successCount = 0;
    let errorCount = 0;

    try {
      for (const row of validRows) {
        try {
          const transactionId = await generateSequentialId({
            branchName: currentBranch?.name,
            tableName: 'transactions',
            pageCode: 'MIG-AR',
            branchId: currentBranch?.id || null,
          });

          const orderDate = getOfficeTime(timezone);
          let parsedDueDate: Date | null = null;
          if (row.dueDate) {
            parsedDueDate = new Date(row.dueDate);
            if (isNaN(parsedDueDate.getTime())) parsedDueDate = null;
          }

          const importMigrationMeta = {
            _isMigrationMeta: true,
            source: 'migration',
            notes: row.notes || 'Piutang migrasi dari import Excel',
          };
          const { error } = await supabase.from('transactions').insert({
            id: transactionId,
            customer_id: row.customerId,
            customer_name: row.customerName,
            order_date: orderDate.toISOString().split('T')[0],
            due_date: parsedDueDate ? parsedDueDate.toISOString().split('T')[0] : null,
            items: [importMigrationMeta], // Store migration info in items
            subtotal: row.amount,
            total: row.amount,
            paid_amount: 0,
            payment_status: 'Belum Lunas',
            status: 'Selesai',
            branch_id: currentBranch?.id || null,
          });

          if (error) throw error;

          // Create journal via RPC
          if (currentBranch?.id) {
            await supabase.rpc('create_migration_receivable_journal_rpc', {
              p_branch_id: currentBranch.id,
              p_receivable_id: transactionId,
              p_receivable_date: orderDate.toISOString().split('T')[0],
              p_amount: row.amount,
              p_customer_name: row.customerName,
              p_description: row.notes || 'Import piutang migrasi',
            });
          }

          successCount++;
        } catch (err) {
          console.error('Error importing row:', err);
          errorCount++;
        }
      }

      if (successCount > 0) {
        toast.success(`Berhasil import ${successCount} piutang`);
      }
      if (errorCount > 0) {
        toast.warning(`${errorCount} data gagal diimport`);
      }

      resetForm();
      setOpen(false);
      onSuccess?.();
    } catch (error: any) {
      console.error('Import error:', error);
      toast.error(`Gagal import: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadTemplate = () => {
    const template = [
      {
        'Nama Pelanggan': 'Toko ABC',
        'Telepon': '08123456789',
        'Jumlah': 500000,
        'Jatuh Tempo': '2025-01-15',
        'Catatan': 'Migrasi dari sistem lama',
      },
      {
        'Nama Pelanggan': 'Warung XYZ',
        'Telepon': '08987654321',
        'Jumlah': 750000,
        'Jatuh Tempo': '2025-01-20',
        'Catatan': '',
      },
    ];

    const ws = XLSX.utils.json_to_sheet(template);
    ws['!cols'] = [
      { wch: 20 },
      { wch: 15 },
      { wch: 12 },
      { wch: 15 },
      { wch: 30 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Piutang');
    XLSX.writeFile(wb, 'Template_Import_Piutang.xlsx');
  };

  const validCount = importData.filter(r => r.isValid).length;
  const invalidCount = importData.filter(r => !r.isValid).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          Input Piutang
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Input Piutang (Migrasi Data)</DialogTitle>
          <DialogDescription>
            Tambahkan piutang dari sistem lain. Data ini akan tercatat di neraca tanpa mempengaruhi laporan pendapatan.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">Input Manual</TabsTrigger>
            <TabsTrigger value="import">Import Excel</TabsTrigger>
          </TabsList>

          {/* Manual Input Tab */}
          <TabsContent value="manual">
            <form onSubmit={handleManualSubmit} className="space-y-4 mt-4">
              {/* Customer Selection */}
              <div className="space-y-2">
                <Label>Pelanggan *</Label>
                <Popover open={customerOpen} onOpenChange={setCustomerOpen} modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={customerOpen}
                      className="w-full justify-between"
                    >
                      {selectedCustomerName || "Pilih pelanggan..."}
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-full p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Cari pelanggan..." />
                      <CommandList>
                        <CommandEmpty>Pelanggan tidak ditemukan.</CommandEmpty>
                        <CommandGroup>
                          {customers?.map((customer) => (
                            <CommandItem
                              key={customer.id}
                              value={customer.name}
                              onSelect={() => {
                                setSelectedCustomerId(customer.id);
                                setSelectedCustomerName(customer.name);
                                setCustomerOpen(false);
                              }}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4",
                                  selectedCustomerId === customer.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <div className="flex flex-col">
                                <span>{customer.name}</span>
                                {customer.phone && (
                                  <span className="text-xs text-muted-foreground">{customer.phone}</span>
                                )}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Amount */}
              <div className="space-y-2">
                <Label htmlFor="amount">Jumlah Piutang *</Label>
                <Input
                  id="amount"
                  type="number"
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  required
                />
              </div>

              {/* Transaction Date */}
              <div className="space-y-2">
                <Label>Tanggal Transaksi *</Label>
                <Popover open={transactionDateOpen} onOpenChange={setTransactionDateOpen} modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !transactionDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {transactionDate ? format(transactionDate, "d MMMM yyyy", { locale: id }) : "Pilih tanggal"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={transactionDate}
                      onSelect={(date) => {
                        setTransactionDate(date);
                        setTransactionDateOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label>Tanggal Jatuh Tempo (Opsional)</Label>
                <Popover open={dueDateOpen} onOpenChange={setDueDateOpen} modal={true}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !dueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDate ? format(dueDate, "d MMMM yyyy", { locale: id }) : "Pilih tanggal"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate}
                      onSelect={(date) => {
                        setDueDate(date);
                        setDueDateOpen(false);
                      }}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label htmlFor="notes">Catatan (Opsional)</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Catatan tambahan..."
                  rows={2}
                />
              </div>

              {/* Journal Info */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-300">
                    <p className="font-medium">Jurnal Otomatis:</p>
                    <p className="mt-1 font-mono text-xs">
                      Dr. Piutang Usaha (1210)<br />
                      &nbsp;&nbsp;&nbsp;Cr. Saldo Awal/Laba Ditahan (3100/3200)
                    </p>
                    <p className="mt-2 text-xs opacity-80">
                      Tidak mempengaruhi laporan pendapatan penjualan
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isLoading}
                >
                  Batal
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? 'Menyimpan...' : 'Simpan Piutang'}
                </Button>
              </div>
            </form>
          </TabsContent>

          {/* Import Excel Tab */}
          <TabsContent value="import">
            <div className="space-y-4 mt-4">
              {/* Upload Area */}
              <div className="border-2 border-dashed rounded-lg p-6 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="file-upload"
                />
                <label htmlFor="file-upload" className="cursor-pointer">
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="h-10 w-10 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      {isImporting ? 'Membaca file...' : 'Klik atau drag file Excel di sini'}
                    </p>
                    <p className="text-xs text-muted-foreground">Format: .xlsx, .xls</p>
                  </div>
                </label>
              </div>

              {/* Download Template */}
              <Button variant="outline" onClick={downloadTemplate} className="w-full gap-2">
                <Download className="h-4 w-4" />
                Download Template Excel
              </Button>

              {/* Preview Data */}
              {importData.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Preview Data</h4>
                    <div className="text-sm">
                      <span className="text-green-600">{validCount} valid</span>
                      {invalidCount > 0 && (
                        <span className="text-red-600 ml-2">{invalidCount} error</span>
                      )}
                    </div>
                  </div>

                  <div className="border rounded-lg max-h-60 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted sticky top-0">
                        <tr>
                          <th className="text-left p-2">Status</th>
                          <th className="text-left p-2">Pelanggan</th>
                          <th className="text-right p-2">Jumlah</th>
                          <th className="text-left p-2">Keterangan</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importData.map((row, idx) => (
                          <tr key={idx} className={cn(
                            "border-t",
                            !row.isValid && "bg-red-50 dark:bg-red-900/20"
                          )}>
                            <td className="p-2">
                              {row.isValid ? (
                                <Check className="h-4 w-4 text-green-600" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-red-600" />
                              )}
                            </td>
                            <td className="p-2">{row.customerName || '-'}</td>
                            <td className="p-2 text-right font-mono">
                              {formatCurrency(row.amount)}
                            </td>
                            <td className="p-2 text-xs text-muted-foreground">
                              {row.error || row.notes || '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Journal Info */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <Info className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                      <div className="text-sm text-blue-800 dark:text-blue-300">
                        <p>Setiap baris yang valid akan membuat jurnal:</p>
                        <p className="font-mono text-xs mt-1">
                          Dr. Piutang Usaha (1210) | Cr. Saldo Awal/Laba Ditahan (3100/3200)
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setImportData([])}
                      disabled={isLoading}
                    >
                      Reset
                    </Button>
                    <Button
                      onClick={handleImportSubmit}
                      disabled={isLoading || validCount === 0}
                    >
                      {isLoading ? 'Mengimport...' : `Import ${validCount} Data`}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
