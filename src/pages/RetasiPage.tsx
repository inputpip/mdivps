import React, { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Truck,
  Plus,
  Calendar,
  Eye,
  Edit,
  Trash2,
  Package,
  Clock,
  MapPin,
  CheckCircle,
  ArrowLeft,
  AlertTriangle,
  Download,
  FileText,
  X,
  ShoppingCart,
  User,
  Phone
} from "lucide-react";
import { useRetasi, useRetasiItems, useRetasiTransactions } from "@/hooks/useRetasi";
import { useDrivers } from "@/hooks/useDrivers";
import { useProducts } from "@/hooks/useProducts";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { id } from "date-fns/locale/id";
import { ReturnRetasiDialog } from "@/components/ReturnRetasiDialog";
import { RetasiDetailPDF } from "@/components/RetasiDetailPDF";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { CreateRetasiItemData } from "@/types/retasi";
import { useGranularPermission } from "@/hooks/useGranularPermission";
import { useTimezone } from "@/contexts/TimezoneContext";
import { getOfficeDateString, getOfficeDateWithOffset } from "@/utils/officeTime";

export default function RetasiPage() {
  const { timezone } = useTimezone();
  const [statusFilter, setStatusFilter] = useState("all");
  // Default filter: 4 hari lalu sampai hari ini (menggunakan office timezone)
  // Use Asia/Jayapura as default for initial render, then update when timezone is available
  const [dateFrom, setDateFrom] = useState(() => getOfficeDateWithOffset(-4, 'Asia/Jayapura'));
  const [dateTo, setDateTo] = useState(() => getOfficeDateWithOffset(0, 'Asia/Jayapura'));
  const [driverFilter, setDriverFilter] = useState("all");
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedRetasi, setSelectedRetasi] = useState<any>(null);
  const [selectedRetasiItems, setSelectedRetasiItems] = useState<any[]>([]);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [detailRetasi, setDetailRetasi] = useState<any>(null);

  // Get granular permissions for retasi view, create, edit, delete
  const { canViewRetasi, canCreateRetasi, canEditRetasi, canDeleteRetasi, isLoading: permissionLoading } = useGranularPermission();

  // Access denied if user doesn't have retasi_view permission
  if (!permissionLoading && !canViewRetasi()) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <AlertTriangle className="h-16 w-16 text-orange-500 mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Akses Ditolak</h2>
        <p className="text-gray-600 max-w-md">
          Anda tidak memiliki izin untuk melihat halaman Retasi. Hubungi administrator untuk mendapatkan akses.
        </p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Kembali
        </Button>
      </div>
    );
  }

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [retasiToDelete, setRetasiToDelete] = useState<any>(null);

  // Edit retasi state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [retasiToEdit, setRetasiToEdit] = useState<any>(null);

  const filters = {
    is_returned: statusFilter === "active" ? false : statusFilter === "returned" ? true : undefined,
    driver_name: driverFilter && driverFilter !== "all" ? driverFilter : undefined,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  };

  const { retasiList, stats, isLoading, markRetasiReturned, getRetasiItems, deleteRetasi, updateRetasi } = useRetasi(filters);
  const { drivers } = useDrivers();

  const filteredRetasi = retasiList || [];

  // Calculate totals with correct formula: Bawa = Kembali + Error + Laku + Tidak Laku + Selisih
  const totals = useMemo(() => {
    const bawa = filteredRetasi.reduce((sum, r) => sum + (r.total_items || 0), 0);
    const kembali = filteredRetasi.reduce((sum, r) => sum + (r.returned_items_count || 0), 0);
    const error = filteredRetasi.reduce((sum, r) => sum + (r.error_items_count || 0), 0);
    const laku = filteredRetasi.reduce((sum, r) => sum + (r.barang_laku || 0), 0);
    const tidakLaku = filteredRetasi.reduce((sum, r) => sum + (r.barang_tidak_laku || 0), 0);
    const selisih = bawa - kembali - error - laku - tidakLaku;

    return { bawa, kembali, error, laku, tidakLaku, selisih };
  }, [filteredRetasi]);

  const handleReturnRetasi = async (retasi: any) => {
    if (!retasi || !retasi.id) {
      toast.error('Data retasi tidak valid');
      return;
    }

    setSelectedRetasi(retasi);

    // Fetch items for this retasi
    try {
      const items = await getRetasiItems(retasi.id);
      setSelectedRetasiItems(items);
    } catch (error) {
      console.error('Failed to fetch retasi items:', error);
      setSelectedRetasiItems([]);
    }

    setReturnDialogOpen(true);
  };

  const handleConfirmReturn = async (returnData: any) => {
    console.log('handleConfirmReturn called with:', returnData);
    console.log('selectedRetasi:', selectedRetasi);

    if (!selectedRetasi) {
      console.error('selectedRetasi is null!');
      toast.error('Data retasi tidak ditemukan');
      return;
    }

    try {
      console.log('Calling markRetasiReturned.mutateAsync...');
      await markRetasiReturned.mutateAsync({
        retasiId: selectedRetasi.id,
        ...returnData,
      });

      console.log('markRetasiReturned success');
      toast.success('Retasi berhasil dikembalikan');
      setReturnDialogOpen(false);
      setSelectedRetasi(null);
      setSelectedRetasiItems([]);
    } catch (error: any) {
      console.error('markRetasiReturned error:', error);
      toast.error(error.message || 'Gagal mengembalikan retasi');
    }
  };

  const handleDeleteRetasi = (retasi: any) => {
    setRetasiToDelete(retasi);
    setDeleteDialogOpen(true);
  };

  const handleEditRetasi = (retasi: any) => {
    setRetasiToEdit(retasi);
    setEditDialogOpen(true);
  };

  const confirmDeleteRetasi = async () => {
    if (!retasiToDelete) return;

    try {
      await deleteRetasi.mutateAsync(retasiToDelete.id);
      toast.success(`Retasi ${retasiToDelete.retasi_number} berhasil dihapus`);
      setDeleteDialogOpen(false);
      setRetasiToDelete(null);
    } catch (error: any) {
      toast.error(error.message || 'Gagal menghapus retasi');
    }
  };

  const exportExcel = async () => {
    try {
      toast.info('Mengambil data detail...');

      // Fetch all retasi items for each retasi
      const detailData: any[] = [];

      for (const r of filteredRetasi) {
        // Fetch items for this retasi
        const { data: items } = await supabase
          .from('retasi_items')
          .select('*')
          .eq('retasi_id', r.id)
          .order('created_at', { ascending: true });

        if (items && items.length > 0) {
          // Add each item as a separate row
          items.forEach((item, idx) => {
            detailData.push({
              "Tgl Berangkat": idx === 0 ? format(r.departure_date, 'dd/MM/yyyy', { locale: id }) : "",
              "Tgl Kembali": idx === 0 ? (r.is_returned ? format(r.updated_at, 'dd/MM/yyyy HH:mm', { locale: id }) : "-") : "",
              "No Retasi": idx === 0 ? r.retasi_number : "",
              "Retasi Ke": idx === 0 ? r.retasi_ke : "",
              "Status": idx === 0 ? (r.is_returned ? "KEMBALI" : "BERANGKAT") : "",
              "Supir": idx === 0 ? (r.driver_name || "-") : "",
              "Helper": idx === 0 ? (r.helper_name || "-") : "",
              "Produk": item.product_name,
              "Qty Bawa": item.quantity,
              "Qty Kembali": item.returned_qty || 0,
              "Qty Terjual": item.sold_qty || 0,
              "Catatan": idx === 0 ? (r.return_notes || r.notes || "-") : "",
            });
          });

          // Add subtotal row for this retasi
          const totalBawa = items.reduce((sum, i) => sum + (i.quantity || 0), 0);
          const totalKembali = items.reduce((sum, i) => sum + (i.returned_qty || 0), 0);
          const totalTerjual = items.reduce((sum, i) => sum + (i.sold_qty || 0), 0);

          detailData.push({
            "Tgl Berangkat": "",
            "Tgl Kembali": "",
            "No Retasi": "",
            "Retasi Ke": "",
            "Status": "",
            "Supir": `Subtotal ${r.retasi_number}`,
            "Produk": "",
            "Qty Bawa": totalBawa,
            "Qty Kembali": totalKembali,
            "Qty Terjual": totalTerjual,
            "Catatan": "",
          });

          // Add empty row separator
          detailData.push({
            "Tgl Berangkat": "",
            "Tgl Kembali": "",
            "No Retasi": "",
            "Retasi Ke": "",
            "Status": "",
            "Supir": "",
            "Produk": "",
            "Qty Bawa": "",
            "Qty Kembali": "",
            "Qty Terjual": "",
            "Catatan": "",
          });
        } else {
          // Retasi without items (old data)
          detailData.push({
            "Tgl Berangkat": format(r.departure_date, 'dd/MM/yyyy', { locale: id }),
            "Tgl Kembali": r.is_returned ? format(r.updated_at, 'dd/MM/yyyy HH:mm', { locale: id }) : "-",
            "No Retasi": r.retasi_number,
            "Retasi Ke": r.retasi_ke,
            "Status": r.is_returned ? "KEMBALI" : "BERANGKAT",
            "Supir": r.driver_name || "-",
            "Helper": r.helper_name || "-",
            "Produk": "(Data lama tanpa detail)",
            "Qty Bawa": r.total_items,
            "Qty Kembali": r.returned_items_count || 0,
            "Qty Terjual": r.barang_laku || 0,
            "Catatan": r.return_notes || r.notes || "-",
          });
        }
      }

      // Add grand total row
      detailData.push({
        "Tgl Berangkat": "GRAND TOTAL",
        "Tgl Kembali": "",
        "No Retasi": "",
        "Retasi Ke": "",
        "Status": "",
        "Supir": "",
        "Produk": "",
        "Qty Bawa": totals.bawa,
        "Qty Kembali": totals.kembali,
        "Qty Terjual": totals.laku,
        "Catatan": "",
      });

      const ws = XLSX.utils.json_to_sheet(detailData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Retasi Detail");
      XLSX.writeFile(wb, `retasi-detail-${dateFrom}-${dateTo}.xlsx`);

      toast.success('File Excel berhasil diunduh');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Gagal mengexport data');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Manajemen Retasi</h1>
          <p className="text-muted-foreground">
            Alur Status: Armada Berangkat → Armada Kembali
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportExcel}>
            <Download className="h-4 w-4 mr-2" />
            Export Excel
          </Button>
          {canCreateRetasi() && (
            <AddRetasiDialog
              drivers={drivers}
              onSaved={() => window.location.reload()}
            />
          )}
        </div>
      </div>


      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filter</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Tanggal Dari</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Tanggal Sampai</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Supir</Label>
                <Select value={driverFilter} onValueChange={setDriverFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua Supir" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Supir</SelectItem>
                    {drivers.map((driver) => (
                      <SelectItem key={driver.id} value={driver.name}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Semua status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Status</SelectItem>
                    <SelectItem value="active">Armada Berangkat</SelectItem>
                    <SelectItem value="returned">Armada Kembali</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Retasi Table */}
        <Card>
          <CardHeader>
            <CardTitle>Daftar Retasi (Detail per Produk)</CardTitle>
            <CardDescription>
              Daftar semua retasi dengan detail produk per baris
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tgl Berangkat</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Retasi Ke</TableHead>
                  <TableHead>Supir</TableHead>
                  <TableHead>Helper</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead className="text-center">Bawa</TableHead>
                  <TableHead className="text-center">Kembali</TableHead>
                  <TableHead className="text-center">Terjual</TableHead>
                  <TableHead className="text-center">Selisih</TableHead>
                  <TableHead>Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={11}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : filteredRetasi.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground">
                      Tidak ada data
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredRetasi.flatMap((retasi) => {
                    const items = (retasi as any).items || [];
                    const selisih = (retasi.total_items || 0) -
                      (retasi.returned_items_count || 0) -
                      (retasi.barang_laku || 0) -
                      (retasi.barang_tidak_laku || 0) -
                      (retasi.error_items_count || 0);

                    if (items.length === 0) {
                      // Retasi tanpa detail item (data lama)
                      return [(
                        <TableRow
                          key={retasi.id}
                          className="hover:bg-slate-50/80 cursor-pointer"
                          onClick={() => {
                            setDetailRetasi(retasi);
                            setDetailDialogOpen(true);
                          }}
                        >
                          <TableCell>
                            {format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })}
                            {retasi.departure_time ? (
                              <div className="text-xs text-muted-foreground">{retasi.departure_time}</div>
                            ) : (
                              <div className="text-xs text-muted-foreground">{format(new Date(retasi.created_at), 'HH:mm')}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            {retasi.is_returned ? (
                              <Badge variant="default" className="bg-emerald-100 text-emerald-700">Kembali</Badge>
                            ) : (
                              <Badge variant="default" className="bg-amber-100 text-amber-700">Berangkat</Badge>
                            )}
                          </TableCell>
                          <TableCell>Retasi {retasi.retasi_ke}</TableCell>
                          <TableCell>{retasi.driver_name || '-'}</TableCell>
                          <TableCell>{retasi.helper_name || '-'}</TableCell>
                          <TableCell className="text-muted-foreground italic">(Data lama)</TableCell>
                          <TableCell className="text-center">{retasi.total_items}</TableCell>
                          <TableCell className="text-center">{retasi.returned_items_count || 0}</TableCell>
                          <TableCell className="text-center">{retasi.barang_laku || 0}</TableCell>
                          <TableCell className={`text-center font-bold ${selisih !== 0 ? 'text-red-500' : 'text-green-500'}`}>
                            {selisih}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-1">
                              <Button variant="outline" size="sm" title="Lihat Detail"
                                onClick={() => { setDetailRetasi(retasi); setDetailDialogOpen(true); }}>
                                <Eye className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )];
                    }

                    // Render setiap item sebagai baris terpisah
                    return items.map((item: any, idx: number) => {
                      // Calculate item level discrepancy if possible, mostly implicit here
                      // Item discrepancy = Qty - Returned - Sold - (Damaged? usually not passed here)
                      // For now, only show Retasi level discrepancy on the first row
                      return (
                        <TableRow
                          key={`${retasi.id}-${item.id}`}
                          className={`hover:bg-slate-50/80 cursor-pointer ${idx === 0 ? 'border-t-2 border-slate-200' : ''}`}
                          onClick={() => {
                            setDetailRetasi(retasi);
                            setDetailDialogOpen(true);
                          }}
                        >
                          <TableCell>
                            {idx === 0 ? (
                              <>
                                {format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })}
                                {retasi.departure_time ? (
                                  <div className="text-xs text-muted-foreground">{retasi.departure_time}</div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">{format(new Date(retasi.created_at), 'HH:mm')}</div>
                                )}
                              </>
                            ) : ''}
                          </TableCell>
                          <TableCell>
                            {idx === 0 ? (
                              retasi.is_returned ? (
                                <Badge variant="default" className="bg-emerald-100 text-emerald-700">Kembali</Badge>
                              ) : (
                                <Badge variant="default" className="bg-amber-100 text-amber-700">Berangkat</Badge>
                              )
                            ) : ''}
                          </TableCell>
                          <TableCell>{idx === 0 ? `Retasi ${retasi.retasi_ke}` : ''}</TableCell>
                          <TableCell>{idx === 0 ? (retasi.driver_name || '-') : ''}</TableCell>
                          <TableCell>{idx === 0 ? (retasi.helper_name || '-') : ''}</TableCell>
                          <TableCell className="font-medium">{item.product_name}</TableCell>
                          <TableCell className="text-center">{item.quantity || 0}</TableCell>
                          <TableCell className="text-center">{item.returned_quantity || 0}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="bg-green-50 text-green-700">
                              {item.sold_quantity || 0}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            {idx === 0 ? (
                              <span className={`font-bold ${selisih !== 0 ? 'text-red-500' : 'text-green-500'}`}>
                                {selisih}
                              </span>
                            ) : ''}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {idx === 0 && (
                              <div className="flex gap-1">
                                {!retasi.is_returned && canEditRetasi() && (
                                  <Button variant="outline" size="sm" title="Tandai Kembali"
                                    onClick={(e) => { e.stopPropagation(); handleReturnRetasi(retasi); }}
                                    className="text-green-600 hover:text-green-700">
                                    <ArrowLeft className="h-4 w-4" />
                                  </Button>
                                )}
                                {canEditRetasi() && (
                                  <Button variant="outline" size="sm" title="Edit"
                                    onClick={() => handleEditRetasi(retasi)}
                                    className="text-blue-600 hover:text-blue-700">
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                )}
                                <Button variant="outline" size="sm" title="Detail"
                                  onClick={() => { setDetailRetasi(retasi); setDetailDialogOpen(true); }}>
                                  <Eye className="h-4 w-4" />
                                </Button>
                                {canDeleteRetasi() && (
                                  <Button variant="outline" size="sm" title="Hapus"
                                    onClick={() => handleDeleteRetasi(retasi)}
                                    className="text-red-600 hover:text-red-700">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    });
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Summary Card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Ringkasan Total</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-6 gap-4 text-center">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-600">Bawa</p>
                <p className="text-xl font-bold text-blue-700">{totals.bawa}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-600">Kembali</p>
                <p className="text-xl font-bold text-slate-700">{totals.kembali}</p>
              </div>
              <div className="p-3 bg-red-50 rounded-lg">
                <p className="text-xs text-red-600">Error</p>
                <p className="text-xl font-bold text-red-700">{totals.error}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-green-600">Laku</p>
                <p className="text-xl font-bold text-green-700">{totals.laku}</p>
              </div>
              <div className="p-3 bg-orange-50 rounded-lg">
                <p className="text-xs text-orange-600">Tidak Laku</p>
                <p className="text-xl font-bold text-orange-700">{totals.tidakLaku}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg">
                <p className="text-xs text-purple-600">Selisih</p>
                <p className={`text-xl font-bold ${totals.selisih >= 0 ? 'text-purple-700' : 'text-red-700'}`}>{totals.selisih}</p>
              </div>
            </div>
          </CardContent>
        </Card>

      </div>

      {/* Return Retasi Dialog */}
      <ReturnRetasiDialog
        isOpen={returnDialogOpen}
        onClose={() => {
          setReturnDialogOpen(false);
          setSelectedRetasi(null);
          setSelectedRetasiItems([]);
        }}
        onConfirm={handleConfirmReturn}
        retasiNumber={selectedRetasi?.retasi_number || ''}
        totalItems={selectedRetasi?.total_items || 0}
        items={selectedRetasiItems}
        isLoading={markRetasiReturned.isPending}
      />

      {/* Detail Retasi Dialog (Controlled) */}
      {detailRetasi && (
        <RetasiDetailDialogControlled
          retasi={detailRetasi}
          open={detailDialogOpen}
          onOpenChange={(open) => {
            setDetailDialogOpen(open);
            if (!open) setDetailRetasi(null);
          }}
        />
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Retasi?</AlertDialogTitle>
            <AlertDialogDescription>
              Apakah Anda yakin ingin menghapus retasi <strong>{retasiToDelete?.retasi_number}</strong>?
              {retasiToDelete?.driver_name && (
                <> Supir: <strong>{retasiToDelete.driver_name}</strong>.</>
              )}
              <br /><br />
              Tindakan ini tidak dapat dibatalkan dan akan menghapus semua data terkait retasi ini.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRetasiToDelete(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteRetasi}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleteRetasi.isPending}
            >
              {deleteRetasi.isPending ? "Menghapus..." : "Ya, Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Retasi Dialog */}
      {retasiToEdit && (
        <EditRetasiDialog
          retasi={retasiToEdit}
          drivers={drivers || []}
          open={editDialogOpen}
          onOpenChange={(open) => {
            setEditDialogOpen(open);
            if (!open) setRetasiToEdit(null);
          }}
          onSave={async (data) => {
            try {
              await updateRetasi.mutateAsync({ id: retasiToEdit.id, ...data });
              toast.success(`Retasi ${retasiToEdit.retasi_number} berhasil diupdate`);
              setEditDialogOpen(false);
              setRetasiToEdit(null);
            } catch (error: any) {
              toast.error(error.message || 'Gagal mengupdate retasi');
            }
          }}
          isLoading={updateRetasi.isPending}
        />
      )}
    </div>
  );
}

function AddRetasiDialog({
  drivers,
  onSaved = () => { },
}: {
  drivers: { id: string; name: string }[]
  onSaved?: () => void
}) {
  const [open, setOpen] = useState(false);
  const [driverId, setDriverId] = useState(drivers[0]?.id || "");
  const [helperId, setHelperId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [retasiItems, setRetasiItems] = useState<CreateRetasiItemData[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [itemQuantity, setItemQuantity] = useState(1);

  const { createRetasi, checkDriverAvailability } = useRetasi();
  const { products, isLoading: isLoadingProducts } = useProducts();
  const { timezone } = useTimezone();
  const [nextSeq, setNextSeq] = useState<number>(1);

  // Semua produk bisa dipilih untuk retasi (tidak dibatasi stock)
  const availableProducts = useMemo(() => {
    return products || [];
  }, [products]);
  const [blocked, setBlocked] = useState<boolean>(false);

  // Calculate total items from retasi items
  const totalBawa = useMemo(() => {
    return retasiItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [retasiItems]);

  const recomputeMeta = async (driverId: string) => {
    if (!driverId) return;

    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return;

    try {
      const isBlocked = !(await checkDriverAvailability(driver.name));
      setBlocked(isBlocked);

      // Get actual next retasi_ke from backend using office timezone
      const todayDate = getOfficeDateString(timezone);
      const { data: todayRetasi } = await supabase
        .from('retasi')
        .select('retasi_ke')
        .eq('driver_name', driver.name)
        .eq('departure_date', todayDate);

      const nextRetasiKe = (todayRetasi?.length || 0) + 1;
      setNextSeq(nextRetasiKe);

      console.log('[RetasiPage] Today date (office timezone):', todayDate);
      console.log('[RetasiPage] Today retasi for', driver.name, ':', todayRetasi);
      console.log('[RetasiPage] Next retasi_ke will be:', nextRetasiKe);
    } catch (error) {
      console.error('Error checking driver availability:', error);
      setNextSeq(1); // Fallback
    }
  };

  React.useEffect(() => {
    if (open && driverId) {
      recomputeMeta(driverId);
    }
  }, [open, driverId]);

  const nowText = new Date().toLocaleString("id-ID");

  const addProductItem = () => {
    if (!selectedProductId) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }

    const product = availableProducts.find(p => p.id === selectedProductId);
    if (!product) {
      toast.error("Produk tidak ditemukan");
      return;
    }

    if (itemQuantity <= 0) {
      toast.error("Jumlah harus lebih dari 0");
      return;
    }

    // Check if product already exists in list
    const existingIndex = retasiItems.findIndex(item => item.product_id === selectedProductId);
    if (existingIndex >= 0) {
      // Update quantity if already exists
      const updatedItems = [...retasiItems];
      updatedItems[existingIndex].quantity += itemQuantity;
      setRetasiItems(updatedItems);
    } else {
      // Add new item
      setRetasiItems([...retasiItems, {
        product_id: product.id,
        product_name: product.name,
        quantity: itemQuantity,
      }]);
    }

    // Reset selection
    setSelectedProductId("");
    setItemQuantity(1);
  };

  const removeProductItem = (index: number) => {
    const updatedItems = [...retasiItems];
    updatedItems.splice(index, 1);
    setRetasiItems(updatedItems);
  };

  const updateItemQuantity = (index: number, newQty: number) => {
    if (newQty <= 0) return;
    const updatedItems = [...retasiItems];
    updatedItems[index].quantity = newQty;
    setRetasiItems(updatedItems);
  };

  const save = async () => {
    if (blocked) {
      toast.error("Tidak bisa membuat Retasi baru: retasi sebelumnya masih berstatus Armada Berangkat.");
      return;
    }

    if (!driverId) {
      toast.error("Pilih supir");
      return;
    }

    const driver = drivers.find(d => d.id === driverId);
    if (!driver) {
      toast.error("Supir tidak ditemukan");
      return;
    }

    if (retasiItems.length === 0) {
      toast.error("Tambahkan minimal 1 produk");
      return;
    }

    // Get helper name if selected
    const helper = helperId ? drivers.find(d => d.id === helperId) : null;

    try {
      // Use office timezone for departure date to ensure correct date
      const officeDateStr = getOfficeDateString(timezone);

      await createRetasi.mutateAsync({
        driver_name: driver.name,
        helper_name: helper?.name || undefined,
        departure_date: officeDateStr, // Pass string YYYY-MM-DD directly for DATE type
        total_items: totalBawa,
        notes: notes || undefined,
        items: retasiItems,
      });

      setOpen(false);
      setRetasiItems([]);
      setNotes("");
      onSaved();
      toast.success(`Retasi Berangkat disimpan dengan ${retasiItems.length} jenis produk`);
    } catch (error: any) {
      toast.error(error?.message || "Gagal menyimpan retasi");
    }
  };

  const resetForm = () => {
    setRetasiItems([]);
    setNotes("");
    setHelperId("");
    setSelectedProductId("");
    setItemQuantity(1);
  };

  React.useEffect(() => {
    if (!open) {
      resetForm();
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-blue-600 hover:bg-blue-700 text-white">
          <Plus className="h-4 w-4 mr-2" />
          Input Retasi (Berangkat)
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Retasi Berangkat</DialogTitle>
          <DialogDescription>
            Input data retasi armada berangkat dengan detail produk yang dibawa
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-600">Waktu Berangkat</Label>
              <Input value={nowText} readOnly />
            </div>
            <div>
              <Label className="text-xs text-slate-600">Retasi Hari Ini</Label>
              <Input value={`Retasi ${nextSeq}`} readOnly />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-slate-600">Supir</Label>
              <Select value={driverId} onValueChange={setDriverId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Supir" />
                </SelectTrigger>
                <SelectContent>
                  {drivers.map((driver) => (
                    <SelectItem key={driver.id} value={driver.id}>
                      {driver.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-slate-600">Helper (Opsional)</Label>
              <Select value={helperId || "no-helper"} onValueChange={(v) => setHelperId(v === "no-helper" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih Helper" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no-helper">Tidak ada helper</SelectItem>
                  {drivers
                    .filter((driver) => driver.id !== driverId)
                    .map((driver) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Product Selection */}
          <div className="border rounded-lg p-4 space-y-3">
            <Label className="text-sm font-medium">Produk yang Dibawa</Label>
            <div className="grid grid-cols-12 gap-2">
              <div className="col-span-6">
                <Select value={selectedProductId} onValueChange={setSelectedProductId} disabled={isLoadingProducts}>
                  <SelectTrigger>
                    <SelectValue placeholder={isLoadingProducts ? "Memuat produk..." : "Pilih Produk"} />
                  </SelectTrigger>
                  <SelectContent>
                    {isLoadingProducts ? (
                      <SelectItem value="loading" disabled>Memuat produk...</SelectItem>
                    ) : availableProducts.length === 0 ? (
                      <SelectItem value="empty" disabled>Tidak ada produk tersedia</SelectItem>
                    ) : (
                      availableProducts.map((product) => (
                        <SelectItem key={product.id} value={product.id}>
                          {product.name} (Stok: {product.currentStock}) {product.type === 'Jual Langsung' && '- JL'}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-3">
                <Input
                  type="number"
                  min={1}
                  value={itemQuantity}
                  onChange={(e) => setItemQuantity(Number(e.target.value) || 1)}
                  onFocus={(e) => e.target.select()}
                  placeholder="Qty"
                />
              </div>
              <div className="col-span-3">
                <Button
                  type="button"
                  onClick={addProductItem}
                  className="w-full"
                  variant="secondary"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Tambah
                </Button>
              </div>
            </div>

            {/* Product List */}
            {retasiItems.length > 0 && (
              <div className="border rounded mt-3">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="w-24 text-center">Qty</TableHead>
                      <TableHead className="w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {retasiItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateItemQuantity(index, Number(e.target.value))}
                            onFocus={(e) => e.target.select()}
                            className="w-20 text-center"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeProductItem(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50">
                      <TableCell className="font-bold">Total Bawa</TableCell>
                      <TableCell className="text-center font-bold text-blue-600">{totalBawa}</TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            )}

            {retasiItems.length === 0 && (
              <div className="text-center py-4 text-slate-500 text-sm">
                Belum ada produk ditambahkan
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs text-slate-600">Catatan</Label>
            <Input
              placeholder="Opsional"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {blocked && (
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              Retasi sebelumnya masih berstatus Armada Berangkat. Selesaikan (Armada Kembali) sebelum membuat Retasi
              berikutnya.
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Batal
            </Button>
            <Button
              onClick={save}
              disabled={blocked || createRetasi.isPending || retasiItems.length === 0}
            >
              {createRetasi.isPending ? "Menyimpan..." : `Simpan (${totalBawa} item)`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Dialog to view retasi details including products and sales
function RetasiDetailDialog({ retasi }: { retasi: any }) {
  const [open, setOpen] = useState(false);
  const { data: items, isLoading: isLoadingItems } = useRetasiItems(open ? retasi.id : undefined);
  const { data: transactions, isLoading: isLoadingTx } = useRetasiTransactions(open ? retasi.id : undefined);

  // Calculate total sold from transactions
  const totalSoldFromTx = useMemo(() => {
    if (!transactions) return 0;
    return transactions.reduce((sum, tx) =>
      sum + tx.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
    );
  }, [transactions]);

  // Calculate total revenue
  const totalRevenue = useMemo(() => {
    if (!transactions) return 0;
    return transactions.reduce((sum, tx) => sum + tx.total_amount, 0);
  }, [transactions]);

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Lihat Detail">
          <Eye className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Retasi</DialogTitle>
          <DialogDescription>
            {retasi.retasi_number} - Retasi ke-{retasi.retasi_ke}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info Retasi */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Supir:</span>
              <p className="font-medium">{retasi.driver_name || '-'}</p>
            </div>
            <div>
              <span className="text-slate-500">Helper:</span>
              <p className="font-medium">{retasi.helper_name || '-'}</p>
            </div>
            <div>
              <span className="text-slate-500">Status:</span>
              <p>
                {retasi.is_returned ? (
                  <Badge variant="default" className="bg-emerald-100 text-emerald-700">
                    Armada Kembali
                  </Badge>
                ) : (
                  <Badge variant="default" className="bg-amber-100 text-amber-700">
                    Armada Berangkat
                  </Badge>
                )}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Tgl Berangkat:</span>
              <p className="font-medium">
                {format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })}
                {retasi.departure_time && ` ${retasi.departure_time}`}
              </p>
            </div>
            {retasi.is_returned && (
              <div>
                <span className="text-slate-500">Tgl Kembali:</span>
                <p className="font-medium">
                  {format(retasi.updated_at, 'dd/MM/yyyy HH:mm', { locale: id })}
                </p>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-6 gap-2 text-center border rounded-lg p-3 bg-slate-50">
            <div>
              <p className="text-xs text-slate-500">Bawa</p>
              <p className="font-bold text-blue-600">{retasi.total_items || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Kembali</p>
              <p className="font-bold text-slate-600">{retasi.returned_items_count || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Error</p>
              <p className="font-bold text-red-600">{retasi.error_items_count || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Laku</p>
              <p className="font-bold text-green-600">{retasi.barang_laku || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tdk Laku</p>
              <p className="font-bold text-orange-600">{retasi.barang_tidak_laku || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Selisih</p>
              <p className="font-bold">
                {(retasi.total_items || 0) - (retasi.returned_items_count || 0) - (retasi.error_items_count || 0) - (retasi.barang_laku || 0) - (retasi.barang_tidak_laku || 0)}
              </p>
            </div>
          </div>

          {/* Product List */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Produk yang Dibawa
            </h4>
            {isLoadingItems ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : items && items.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="w-20 text-center">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-center text-blue-600">
                        {items.reduce((sum, item) => sum + item.quantity, 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm border rounded-lg">
                Tidak ada data produk (retasi lama tanpa detail produk)
              </div>
            )}
          </div>

          {/* Sales/Transactions List */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Penjualan ({transactions?.length || 0} transaksi)
            </h4>
            {isLoadingTx ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : transactions && transactions.length > 0 ? (
              <div className="space-y-3">
                {transactions.map((tx, idx) => (
                  <div key={tx.id} className="border rounded-lg p-3 bg-white">
                    {/* Transaction Header */}
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-slate-400" />
                          <span className="font-medium text-sm">{tx.customer_name}</span>
                        </div>
                        {tx.customer_phone && (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Phone className="h-3 w-3" />
                            {tx.customer_phone}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          {format(tx.created_at, 'HH:mm', { locale: id })}
                        </p>
                        <p className="font-bold text-green-600 text-sm">
                          {formatCurrency(tx.total_amount)}
                        </p>
                      </div>
                    </div>

                    {/* Transaction Items */}
                    <div className="bg-slate-50 rounded p-2 text-xs">
                      {tx.items.map((item, itemIdx) => (
                        <div key={itemIdx} className="flex justify-between py-0.5">
                          <span>{item.product_name} x{item.quantity}</span>
                          <span className="text-slate-600">{formatCurrency(item.subtotal)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Total Revenue */}
                <div className="border-t pt-3 flex justify-between items-center">
                  <div className="text-sm">
                    <span className="text-slate-500">Total Terjual: </span>
                    <span className="font-bold text-green-600">{totalSoldFromTx} item</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-slate-500">Total Pendapatan: </span>
                    <span className="font-bold text-green-600">{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm border rounded-lg">
                Belum ada penjualan untuk retasi ini
              </div>
            )}
          </div>

          {/* Notes */}
          {(retasi.notes || retasi.return_notes) && (
            <div>
              <h4 className="text-sm font-medium mb-1">Catatan</h4>
              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                {retasi.return_notes || retasi.notes}
              </p>
            </div>
          )}

          {/* Print PDF Button */}
          <div className="pt-4 border-t flex justify-end">
            <RetasiDetailPDF
              retasi={retasi}
              items={items || []}
              transactions={transactions || []}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Edit Retasi Dialog component - now supports marking retasi as returned
function EditRetasiDialog({
  retasi,
  drivers,
  open,
  onOpenChange,
  onSave,
  isLoading
}: {
  retasi: any;
  drivers: { id: string; name: string }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (data: any) => Promise<void>;
  isLoading: boolean;
}) {
  const [driverName, setDriverName] = useState(retasi?.driver_name || "");
  const [helperName, setHelperName] = useState(retasi?.helper_name || "");
  const [truckNumber, setTruckNumber] = useState(retasi?.truck_number || "");
  const [notes, setNotes] = useState(retasi?.notes || "");

  // Return quantities - now editable for both returned and active retasi
  const [returnedCount, setReturnedCount] = useState(retasi?.returned_items_count || 0);
  const [errorCount, setErrorCount] = useState(retasi?.error_items_count || 0);
  const [lakuCount, setLakuCount] = useState(retasi?.barang_laku || 0);
  const [tidakLakuCount, setTidakLakuCount] = useState(retasi?.barang_tidak_laku || 0);

  // Option to mark as returned (only for active retasi)
  const [markAsReturned, setMarkAsReturned] = useState(false);
  // Option to unmark as returned (only for returned retasi)
  const [unmarkAsReturned, setUnmarkAsReturned] = useState(false);

  // Reset form when retasi changes
  React.useEffect(() => {
    if (retasi) {
      setDriverName(retasi.driver_name || "");
      setHelperName(retasi.helper_name || "");
      setTruckNumber(retasi.truck_number || "");
      setNotes(retasi.notes || "");
      setReturnedCount(retasi.returned_items_count || 0);
      setErrorCount(retasi.error_items_count || 0);
      setLakuCount(retasi.barang_laku || 0);
      setTidakLakuCount(retasi.barang_tidak_laku || 0);
      setMarkAsReturned(false);
      setUnmarkAsReturned(false);
    }
  }, [retasi]);

  const totalInput = returnedCount + lakuCount + tidakLakuCount + errorCount;
  const selisih = (retasi?.total_items || 0) - totalInput;

  const handleSave = async () => {
    const data: any = {
      driver_name: driverName || undefined,
      helper_name: helperName || undefined,
      truck_number: truckNumber || undefined,
      notes: notes || undefined,
    };

    // Handle unmark as returned (change from Kembali to Berangkat)
    if (unmarkAsReturned) {
      data.is_returned = false;
      data.returned_items_count = 0;
      data.error_items_count = 0;
      data.barang_laku = 0;
      data.barang_tidak_laku = 0;
      data.return_notes = null;
    }
    // Include return quantities if retasi is already returned (and not unmarking) OR if marking as returned
    else if ((retasi?.is_returned && !unmarkAsReturned) || markAsReturned) {
      data.is_returned = true;
      data.returned_items_count = returnedCount;
      data.error_items_count = errorCount;
      data.barang_laku = lakuCount;
      data.barang_tidak_laku = tidakLakuCount;
    }

    await onSave(data);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Retasi</DialogTitle>
          <DialogDescription>
            {retasi?.retasi_number} - Retasi ke-{retasi?.retasi_ke}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Driver */}
          <div className="space-y-2">
            <Label>Supir</Label>
            <Select value={driverName} onValueChange={setDriverName}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih Supir" />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((driver) => (
                  <SelectItem key={driver.id} value={driver.name}>
                    {driver.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Helper */}
          <div className="space-y-2">
            <Label>Helper (Opsional)</Label>
            <Select value={helperName || "no-helper"} onValueChange={(v) => setHelperName(v === "no-helper" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih Helper" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-helper">Tidak ada helper</SelectItem>
                {drivers
                  .filter((driver) => driver.name !== driverName)
                  .map((driver) => (
                    <SelectItem key={driver.id} value={driver.name}>
                      {driver.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          {/* Truck Number */}
          <div className="space-y-2">
            <Label>Nomor Kendaraan</Label>
            <Input
              value={truckNumber}
              onChange={(e) => setTruckNumber(e.target.value)}
              placeholder="Contoh: B 1234 XYZ"
            />
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Catatan</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Catatan retasi"
            />
          </div>

          {/* Mark as Returned checkbox - only show if retasi is not returned yet */}
          {!retasi?.is_returned && (
            <div className="flex items-center space-x-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <input
                type="checkbox"
                id="markAsReturned"
                checked={markAsReturned}
                onChange={(e) => setMarkAsReturned(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="markAsReturned" className="text-amber-800 cursor-pointer">
                Tandai sebagai Armada Kembali
              </Label>
            </div>
          )}

          {/* Unmark as Returned checkbox - only show if retasi is already returned */}
          {retasi?.is_returned && (
            <div className="flex items-center space-x-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <input
                type="checkbox"
                id="unmarkAsReturned"
                checked={unmarkAsReturned}
                onChange={(e) => setUnmarkAsReturned(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="unmarkAsReturned" className="text-orange-800 cursor-pointer">
                Ubah status menjadi Armada Berangkat (batalkan kembali)
              </Label>
            </div>
          )}

          {/* Return quantities - show if retasi is_returned (and not unmarking) OR if markAsReturned is checked */}
          {((retasi?.is_returned && !unmarkAsReturned) || markAsReturned) && (
            <div className="space-y-3 border-t pt-3">
              <Label className="text-sm font-medium">
                {retasi?.is_returned ? 'Edit Jumlah Kembali' : 'Input Jumlah Kembali'}
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Kembali
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={returnedCount}
                    onChange={(e) => setReturnedCount(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-blue-600 flex items-center gap-1">
                    <ShoppingCart className="h-3 w-3" /> Laku
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={lakuCount}
                    onChange={(e) => setLakuCount(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-orange-600 flex items-center gap-1">
                    <Package className="h-3 w-3" /> Tidak Laku
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={tidakLakuCount}
                    onChange={(e) => setTidakLakuCount(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Error
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={errorCount}
                    onChange={(e) => setErrorCount(Number(e.target.value) || 0)}
                  />
                </div>
              </div>
              <div className={`text-xs p-2 rounded ${selisih === 0 ? 'bg-green-50 text-green-700' : selisih > 0 ? 'bg-orange-50 text-orange-700' : 'bg-red-50 text-red-700'}`}>
                Total: {totalInput} / Bawa: {retasi?.total_items || 0} / Selisih: {selisih}
                {selisih > 0 && ' (ada barang belum diinput)'}
                {selisih < 0 && ' (melebihi jumlah bawa!)'}
              </div>
            </div>
          )}

          {/* Summary info */}
          <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-500">Tanggal Berangkat:</span>
              <span className="font-medium">
                {retasi?.departure_date && format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Total Item Bawa:</span>
              <span className="font-medium">{retasi?.total_items || 0}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status:</span>
              <span className={`font-medium ${unmarkAsReturned ? 'text-orange-600' :
                (retasi?.is_returned || markAsReturned) ? 'text-green-600' : 'text-amber-600'
                }`}>
                {unmarkAsReturned ? 'Akan Diubah ke Berangkat' :
                  retasi?.is_returned ? 'Armada Kembali' :
                    markAsReturned ? 'Akan Ditandai Kembali' : 'Armada Berangkat'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            onClick={handleSave}
            disabled={isLoading || (markAsReturned && selisih < 0)}
            className={
              unmarkAsReturned ? 'bg-orange-600 hover:bg-orange-700' :
                markAsReturned ? 'bg-green-600 hover:bg-green-700' : ''
            }
          >
            {isLoading ? "Menyimpan..." :
              unmarkAsReturned ? "Ubah ke Berangkat" :
                markAsReturned ? "Simpan & Tandai Kembali" : "Simpan Perubahan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Controlled version of RetasiDetailDialog (for external state management)
function RetasiDetailDialogControlled({ retasi, open, onOpenChange }: {
  retasi: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: items, isLoading: isLoadingItems } = useRetasiItems(open ? retasi.id : undefined);
  const { data: transactions, isLoading: isLoadingTx } = useRetasiTransactions(open ? retasi.id : undefined);

  // Calculate total sold from transactions
  const totalSoldFromTx = useMemo(() => {
    if (!transactions) return 0;
    return transactions.reduce((sum, tx) =>
      sum + tx.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
    );
  }, [transactions]);

  // Calculate total revenue
  const totalRevenue = useMemo(() => {
    if (!transactions) return 0;
    return transactions.reduce((sum, tx) => sum + tx.total_amount, 0);
  }, [transactions]);

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Detail Retasi</DialogTitle>
          <DialogDescription>
            {retasi.retasi_number} - Retasi ke-{retasi.retasi_ke}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Info Retasi */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-slate-500">Supir:</span>
              <p className="font-medium">{retasi.driver_name || '-'}</p>
            </div>
            <div>
              <span className="text-slate-500">Status:</span>
              <p>
                {retasi.is_returned ? (
                  <Badge variant="default" className="bg-emerald-100 text-emerald-700">
                    Armada Kembali
                  </Badge>
                ) : (
                  <Badge variant="default" className="bg-amber-100 text-amber-700">
                    Armada Berangkat
                  </Badge>
                )}
              </p>
            </div>
            <div>
              <span className="text-slate-500">Tgl Berangkat:</span>
              <p className="font-medium">
                {format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })}
                {retasi.departure_time && ` ${retasi.departure_time}`}
              </p>
            </div>
            {retasi.is_returned && (
              <div>
                <span className="text-slate-500">Tgl Kembali:</span>
                <p className="font-medium">
                  {format(retasi.updated_at, 'dd/MM/yyyy HH:mm', { locale: id })}
                </p>
              </div>
            )}
          </div>

          {/* Summary */}
          <div className="grid grid-cols-6 gap-2 text-center border rounded-lg p-3 bg-slate-50">
            <div>
              <p className="text-xs text-slate-500">Bawa</p>
              <p className="font-bold text-blue-600">{retasi.total_items || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Kembali</p>
              <p className="font-bold text-slate-600">{retasi.returned_items_count || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Error</p>
              <p className="font-bold text-red-600">{retasi.error_items_count || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Laku</p>
              <p className="font-bold text-green-600">{retasi.barang_laku || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Tdk Laku</p>
              <p className="font-bold text-orange-600">{retasi.barang_tidak_laku || 0}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Selisih</p>
              <p className="font-bold">
                {(retasi.total_items || 0) - (retasi.returned_items_count || 0) - (retasi.error_items_count || 0) - (retasi.barang_laku || 0) - (retasi.barang_tidak_laku || 0)}
              </p>
            </div>
          </div>

          {/* Product List */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Produk yang Dibawa
            </h4>
            {isLoadingItems ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : items && items.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="w-20 text-center">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{item.product_name}</TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-slate-50 font-bold">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-center text-blue-600">
                        {items.reduce((sum, item) => sum + item.quantity, 0)}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm border rounded-lg">
                Tidak ada data produk (retasi lama tanpa detail produk)
              </div>
            )}
          </div>

          {/* Sales/Transactions List */}
          <div>
            <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
              <ShoppingCart className="h-4 w-4" />
              Penjualan ({transactions?.length || 0} transaksi)
            </h4>
            {isLoadingTx ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : transactions && transactions.length > 0 ? (
              <div className="space-y-3">
                {transactions.map((tx) => (
                  <div key={tx.id} className="border rounded-lg p-3 bg-white">
                    {/* Transaction Header */}
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <User className="h-3 w-3 text-slate-400" />
                          <span className="font-medium text-sm">{tx.customer_name}</span>
                        </div>
                        {tx.customer_phone && (
                          <div className="flex items-center gap-2 text-xs text-slate-500">
                            <Phone className="h-3 w-3" />
                            {tx.customer_phone}
                          </div>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-slate-500">
                          {format(tx.created_at, 'HH:mm', { locale: id })}
                        </p>
                        <p className="font-bold text-green-600 text-sm">
                          {formatCurrency(tx.total_amount)}
                        </p>
                      </div>
                    </div>

                    {/* Transaction Items */}
                    <div className="bg-slate-50 rounded p-2 text-xs">
                      {tx.items.map((item, itemIdx) => (
                        <div key={itemIdx} className="flex justify-between py-0.5">
                          <span>{item.product_name} x{item.quantity}</span>
                          <span className="text-slate-600">{formatCurrency(item.subtotal)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Total Revenue */}
                <div className="border-t pt-3 flex justify-between items-center">
                  <div className="text-sm">
                    <span className="text-slate-500">Total Terjual: </span>
                    <span className="font-bold text-green-600">{totalSoldFromTx} item</span>
                  </div>
                  <div className="text-sm">
                    <span className="text-slate-500">Total Pendapatan: </span>
                    <span className="font-bold text-green-600">{formatCurrency(totalRevenue)}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4 text-slate-500 text-sm border rounded-lg">
                Belum ada penjualan untuk retasi ini
              </div>
            )}
          </div>

          {/* Notes */}
          {(retasi.notes || retasi.return_notes) && (
            <div>
              <h4 className="text-sm font-medium mb-1">Catatan</h4>
              <p className="text-sm text-slate-600 bg-slate-50 p-2 rounded">
                {retasi.return_notes || retasi.notes}
              </p>
            </div>
          )}

          {/* Print PDF Button */}
          <div className="pt-4 border-t flex justify-end">
            <RetasiDetailPDF
              retasi={retasi}
              items={items || []}
              transactions={transactions || []}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}