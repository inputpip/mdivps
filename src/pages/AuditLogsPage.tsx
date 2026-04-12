import React, { useState, useEffect } from 'react';
import { useAuditLogs, AuditLog } from '@/hooks/useAuditLogs';
import { format } from 'date-fns';
import { id as idLocale } from 'date-fns/locale';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, History, Eye, Wrench, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';

export default function AuditLogsPage() {
  const { user } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTable, setSelectedTable] = useState('all');
  const { data: logs, isLoading, refetch } = useAuditLogs(1000, selectedTable);
  const [selectedLogGroup, setSelectedLogGroup] = useState<AuditLog[] | null>(null);
  const [isFixing, setIsFixing] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 15;

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedTable]);

  if (user?.role !== 'owner') {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <Card className="max-w-md bg-red-50 text-center">
          <CardContent className="pt-6">
            <h2 className="text-xl font-bold text-red-700">Akses Ditolak</h2>
            <p className="text-red-600 mt-2">Halaman Log Aktivitas khusus untuk Pemilik (Owner).</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // FORCE FIX TRIGGERS FUNCTION (Tombol Darurat untuk VPS Manokwari)
  const forceFixTriggers = async () => {
    if (!confirm("Ini akan menanam paksa alat penyadap log ke database yang sedang aktif (VITE_POSTGREST_URL). Lanjutkan?")) return;
    setIsFixing(true);
    let successCount = 0;
    try {
      const tables = [
        'transactions', 'journal_entries', 'journal_entry_lines', 
        'accounts', 'inventory_batches', 'production_records', 
        'retasi', 'deliveries', 'payment_history'
      ];
      
      for (const table of tables) {
        const { error } = await supabase.rpc('enable_audit_for_table', { target_table: table });
        if (!error) successCount++;
      }
      
      if (successCount > 0) {
        alert(`✅ BERHASIL! Alat penyadap telah ditanam di ${successCount} Tabel! Silakan buat Transaksi percobaan di POS sekarang.`);
      } else {
        alert("⚠️ Wah, operasi gagal! Cek console browser Anda.");
      }
    } catch (err: any) {
      alert("Error: " + err.message);
    } finally {
      setIsFixing(false);
      refetch(); // Refresh data otomatis
    }
  };

  const getOperationColor = (op: string, isVoid: boolean = false) => {
    if (isVoid) return 'bg-red-600 text-white font-bold tracking-wider';
    switch (op) {
      case 'INSERT': return 'bg-emerald-100 text-emerald-800';
      case 'UPDATE': return 'bg-blue-100 text-blue-800';
      case 'DELETE': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const isVoidAction = (log: AuditLog) => {
    if (log.operation !== 'UPDATE' || !log.changed_fields) return false;
    const changes = log.changed_fields as any;
    // Cek ciri khas tabel transaksi dibatalkan
    return (
      changes.is_voided?.new === true || 
      changes.is_cancelled?.new === true || 
      changes.status?.new === 'voided'
    );
  };

  const filteredLogs = logs?.filter(log => 
    log.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.table_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.record_id?.toLowerCase().includes(searchTerm.toLowerCase())
  ) || [];

  // PENGGABUNGAN LOG CERDAS (GROUPING BY TRANSAKSI/WAKTU)
  // PostgreSQL NOW() identik untuk proses yang dipicu secara beruntun dalam 1 query.
  const groupLogs = (ungroupedLogs: AuditLog[]) => {
    const groups: { [key: string]: AuditLog[] } = {};
    ungroupedLogs.forEach(log => {
      // Gunakan string waktu hingga resolusi milidetik sebagai identifier grup. 
      // Atau bisa pakai format yg lebih robus jika backend support
      const key = log.created_at; 
      if (!groups[key]) groups[key] = [];
      groups[key].push(log);
    });
    
    return Object.values(groups).sort((a, b) => new Date(b[0].created_at).getTime() - new Date(a[0].created_at).getTime());
  };

  const groupedLogs = groupLogs(filteredLogs);
  const totalPages = Math.max(1, Math.ceil(groupedLogs.length / itemsPerPage));
  const currentGroups = groupedLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const renderUserInfo = (log: AuditLog | null) => {
    if (!log) return '';
    if (log.user_email && log.user_email !== 'system' && log.user_email !== 'postgres') {
      return log.user_email;
    }
    if (log.user_role && log.user_role !== 'unknown') {
      return `Sistem Otomatis (${log.user_role})`;
    }
    return 'Gagal Menyadap (Arahkan Ulang Trigger!)';
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Log Aktivitas Sistem</h1>
          <p className="text-muted-foreground mt-2">
            Pantau ringkasan kejadian dan perubahan beruntun (Transaksi, Akuntansi, Stok) per-kejadian. Khusus Owner.
          </p>
        </div>
        
        <Button 
          onClick={forceFixTriggers} 
          disabled={isFixing} 
          variant="destructive"
          className="shadow-md hover:scale-105 transition-transform"
        >
          <Wrench className="w-4 h-4 mr-2" />
          {isFixing ? "Memasang Pelacak..." : "🛠️ Tombol Darurat Perbaiki Log"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Kejadian Terakhir {groupedLogs.length ? `(${groupedLogs.length} Sesi)` : ''}
          </CardTitle>
          <div className="flex gap-4 mt-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari email pengguna, tabel, atau ID..."
                className="pl-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="px-3 py-2 border rounded-md text-sm"
              value={selectedTable}
              onChange={(e) => setSelectedTable(e.target.value)}
            >
              <option value="all">Semua Tabel (Ringkasan)</option>
              <option value="transactions">Transaksi (POS)</option>
              <option value="payment_history">Riwayat Pembayaran</option>
              <option value="products">Produk</option>
              <option value="journal_entries">Jurnal Akuntansi</option>
              <option value="attendance">Absensi</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu Kejadian</TableHead>
                  <TableHead>Pengguna / Eksekutor</TableHead>
                  <TableHead>Aksi Utama</TableHead>
                  <TableHead>Dampak Tabel</TableHead>
                  <TableHead className="w-[100px]">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8">Memuat Log...</TableCell></TableRow>
                ) : currentGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-12">
                      <div className="flex flex-col items-center justify-center space-y-3">
                        <History className="h-10 w-10 text-slate-300" />
                        <span className="font-semibold text-lg text-slate-500">Masa Lalu Telah Terhapus</span>
                        <span className="text-sm text-slate-400">Silakan tes membuat Transaksi atau klik <b className="text-red-500">Tombol Darurat</b> di pojok kanan atas untuk memastikan pelacak Database cloud aktif.</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  currentGroups.map((group, groupIdx) => {
                    // Cari tabel utama sebagai perwakilan (prioritas: transactions, retasi, lalu ambil saja indeks 0)
                    const mainLog = group.find(l => l.table_name === 'transactions' || l.table_name === 'retasi') || group[0];
                    const isMulti = group.length > 1;

                    return (
                      <TableRow key={mainLog.id + '-group-' + groupIdx}>
                        <TableCell className="font-medium whitespace-nowrap text-sm">
                          {format(new Date(mainLog.created_at), 'dd MMM yyyy, HH:mm:ss', { locale: idLocale })}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-700">{renderUserInfo(mainLog)}</span>
                            <span className="text-xs text-slate-400">{mainLog.user_role}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getOperationColor(mainLog.operation, isVoidAction(mainLog))}>
                            {isVoidAction(mainLog) ? 'VOID TRANSAKSI' : mainLog.operation}
                          </Badge>
                          {isMulti && (
                            <Badge variant="secondary" className="ml-2 bg-indigo-50 text-indigo-700">
                              +{group.length - 1} Aksi
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium text-slate-800">{mainLog.table_name}</div>
                          {isMulti ? (
                            <span className="text-xs text-slate-500 font-mono">
                              Efek beruntun mengenai {group.length} baris data
                            </span>
                          ) : (
                            <span className="text-xs text-slate-500 font-mono" title={mainLog.record_id}>
                              ID: {mainLog.record_id?.substring(0, 12)}...
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="default" size="sm" onClick={() => setSelectedLogGroup(group)} className="bg-indigo-600 hover:bg-indigo-700">
                            <Eye className="h-4 w-4 mr-1" /> Rincian
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          {groupedLogs.length > 0 && (
            <div className="flex items-center justify-between pt-4 border-t mt-4">
              <div className="text-sm text-slate-500">
                Menampilkan <span className="font-medium">{(currentPage - 1) * itemsPerPage + 1}</span> - <span className="font-medium">{Math.min(currentPage * itemsPerPage, groupedLogs.length)}</span> dari <span className="font-medium">{groupedLogs.length}</span> sesi kejadian
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                >
                  Sebelumnya
                </Button>
                <div className="text-sm font-medium px-2">Halaman {currentPage} / {totalPages}</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                >
                  Selanjutnya
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* JSON Viewer Dialog (Grouping Mode) */}
      <Dialog open={!!selectedLogGroup} onOpenChange={() => setSelectedLogGroup(null)}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto bg-slate-50">
          <DialogHeader className="pb-4 border-b">
            <DialogTitle className="text-2xl font-bold flex items-center gap-2">
              <Layers className="w-6 h-6 text-indigo-600"/> Detail Rangkaian Kejadian
            </DialogTitle>
            <div className="flex items-center flex-wrap gap-4 text-sm text-muted-foreground mt-2">
              <span className="font-medium text-slate-700 px-3 py-1 bg-white border rounded-full">
                Waktu: {selectedLogGroup?.[0]?.created_at && format(new Date(selectedLogGroup[0].created_at), 'dd MMMM yyyy, HH:mm:ss', { locale: idLocale })}
              </span>
              <span className="font-medium text-slate-700 px-3 py-1 bg-white border rounded-full text-indigo-700">
                Pelaku Utama: {renderUserInfo(selectedLogGroup?.[0] || null)}
              </span>
              <span className="font-medium text-slate-700 px-3 py-1 bg-white border rounded-full">
                Total Pergerakan Data: {selectedLogGroup?.length} Tindakan Beruntun
              </span>
            </div>
          </DialogHeader>

          <div className="flex flex-col gap-6 mt-4">
            {selectedLogGroup?.map((log, idx) => (
              <Card key={log.id} className="shadow-sm border-slate-200">
                <div className="bg-slate-100/50 p-4 border-b flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600">
                      {idx + 1}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-800 capitalize">
                        {log.table_name.replace(/_/g, ' ')}
                      </h4>
                      <p className="text-xs font-mono text-slate-500 mt-0.5">ID: {log.record_id?.substring(0, 18)}...</p>
                    </div>
                  </div>
                  <Badge variant="outline" className={`px-3 py-1 ${getOperationColor(log.operation, isVoidAction(log))}`}>
                    {isVoidAction(log) ? 'VOID / BATAL' : log.operation}
                  </Badge>
                </div>

                <div className="p-4 bg-white">
                  {log.operation === 'UPDATE' && (
                    <div className={`mb-4 p-3 border rounded-md text-sm ${isVoidAction(log) ? 'bg-red-50 border-red-200 text-red-900' : 'bg-amber-50/50 border-amber-100 text-amber-900'}`}>
                      <span className={`font-bold ${isVoidAction(log) ? 'text-red-700' : 'text-amber-700'}`}>
                        {isVoidAction(log) ? '⚠️ Peringatan Void! Kolom ini dinonaktifkan:' : 'Terdeteksi Perubahan pada Kolom:'}
                      </span>{' '}
                      {log.changed_fields && typeof log.changed_fields === 'object' ? Object.keys(log.changed_fields).join(', ') : 'N/A'}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Render Old Data unconditionally if not INSERT */}
                    {log.operation !== 'INSERT' && (
                      <div className="border rounded-md flex flex-col shadow-sm">
                        <div className="bg-slate-50 p-2 font-semibold border-b text-xs text-slate-600 uppercase tracking-wider flex justify-between">
                          <span>Data Sebelum</span>
                          {log.operation === 'DELETE' && <span className="text-red-500">Dihapus</span>}
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-300 text-xs overflow-auto h-48 font-mono">
                          {log.old_data ? JSON.stringify(log.old_data, null, 2) : 'Kosong'}
                        </pre>
                      </div>
                    )}
                    
                    {/* Render New Data unconditionally if not DELETE */}
                    {log.operation !== 'DELETE' && (
                      <div className="border rounded-md flex flex-col shadow-sm">
                        <div className="bg-slate-50 p-2 font-semibold border-b text-xs text-slate-600 uppercase tracking-wider flex justify-between">
                          <span>Data Sesudah</span>
                          {log.operation === 'INSERT' && <span className="text-emerald-600">Ditambahkan</span>}
                        </div>
                        <pre className="p-3 bg-slate-900 text-emerald-400 text-xs overflow-auto h-48 font-mono">
                          {log.new_data ? JSON.stringify(log.new_data, null, 2) : 'Kosong'}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
