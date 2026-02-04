import React, { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Truck,
  Plus,
  Package,
  CheckCircle,
  ArrowLeft,
  AlertTriangle,
  ShoppingCart,
  X,
  Loader2
} from "lucide-react";
import { useRetasi } from "@/hooks/useRetasi";
import { useDrivers } from "@/hooks/useDrivers";
import { useProducts } from "@/hooks/useProducts";
import { format } from "date-fns";
import { id } from "date-fns/locale/id";
import { ReturnRetasiDialog } from "@/components/ReturnRetasiDialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CreateRetasiItemData } from "@/types/retasi";
import { useGranularPermission } from "@/hooks/useGranularPermission";
import { useTimezone } from "@/contexts/TimezoneContext";
import { getOfficeDateString } from "@/utils/officeTime";

export default function MobileRetasiPage() {
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [selectedRetasi, setSelectedRetasi] = useState<any>(null);
  const [selectedRetasiItems, setSelectedRetasiItems] = useState<any[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const { timezone } = useTimezone();
  const { canViewRetasi, canCreateRetasi, canEditRetasi, isLoading: permissionLoading } = useGranularPermission();

  // Access denied if user doesn't have retasi_view permission
  if (!permissionLoading && !canViewRetasi()) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-6">
        <AlertTriangle className="h-16 w-16 text-orange-500 mb-4" />
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Akses Ditolak</h2>
        <p className="text-gray-600 dark:text-gray-400 max-w-md text-sm">
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

  // Use office timezone for date filter to match how data is stored
  const todayDate = getOfficeDateString(timezone);
  const filters = {
    date_from: todayDate,
    date_to: todayDate,
  };

  const { retasiList, isLoading, markRetasiReturned, getRetasiItems, createRetasi, checkDriverAvailability, refetchRetasiList } = useRetasi(filters);
  const { drivers } = useDrivers();

  const filteredRetasi = retasiList || [];

  // Calculate totals
  const totals = useMemo(() => {
    const bawa = filteredRetasi.reduce((sum, r) => sum + (r.items?.reduce((isum, i) => isum + (i.quantity || 0), 0) || 0), 0);

    const kembali = filteredRetasi.reduce((sum, r) => sum + (r.items?.reduce((isum, i) => isum + (i.returned_quantity || 0), 0) || 0), 0);

    const error = filteredRetasi.reduce((sum, r) => sum + (r.items?.reduce((isum, i) => isum + (i.error_quantity || 0), 0) || 0), 0);

    const laku = filteredRetasi.reduce((sum, r) => sum + (r.items?.reduce((isum, i) => isum + (i.sold_quantity || 0), 0) || 0), 0);

    const tidakLaku = filteredRetasi.reduce((sum, r) => sum + (r.items?.reduce((isum, i) => isum + (i.unsold_quantity || 0), 0) || 0), 0);

    const selisih = bawa - kembali - error - laku - tidakLaku;

    return { bawa, kembali, error, laku, tidakLaku, selisih };
  }, [filteredRetasi]);

  const handleReturnRetasi = async (retasi: any) => {
    if (!retasi || !retasi.id) {
      toast.error('Data retasi tidak valid');
      return;
    }

    setSelectedRetasi(retasi);

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
    if (!selectedRetasi) {
      toast.error('Data retasi tidak ditemukan');
      return;
    }

    try {
      await markRetasiReturned.mutateAsync({
        retasiId: selectedRetasi.id,
        ...returnData,
      });

      toast.success('Retasi berhasil dikembalikan');
      setReturnDialogOpen(false);
      setSelectedRetasi(null);
      setSelectedRetasiItems([]);
    } catch (error: any) {
      toast.error(error.message || 'Gagal mengembalikan retasi');
    }
  };

  // Count active (not returned) retasi
  const activeCount = filteredRetasi.filter(r => !r.is_returned).length;
  const returnedCount = filteredRetasi.filter(r => r.is_returned).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            <h1 className="text-lg font-bold">Retasi</h1>
          </div>
          <div className="text-xs text-muted-foreground">
            {format(new Date(), 'dd MMM yyyy', { locale: id })}
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="p-4 grid grid-cols-3 gap-2">
        <Card className="bg-blue-50 border-blue-200">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-blue-600">Bawa</div>
            <div className="text-xl font-bold text-blue-700">{totals.bawa}</div>
          </CardContent>
        </Card>
        <Card className="bg-amber-50 border-amber-200">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-amber-600">Berangkat</div>
            <div className="text-xl font-bold text-amber-700">{activeCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-200">
          <CardContent className="p-3 text-center">
            <div className="text-xs text-green-600">Kembali</div>
            <div className="text-xl font-bold text-green-700">{returnedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Action Buttons */}
      <div className="px-4 grid grid-cols-2 gap-3 mb-4">
        {canCreateRetasi() && (
          <Button
            className="h-14 bg-blue-600 hover:bg-blue-700 text-white"
            onClick={() => setAddDialogOpen(true)}
          >
            <Plus className="h-5 w-5 mr-2" />
            Input Retasi
          </Button>
        )}
        {canEditRetasi() && activeCount > 0 && (
          <Button
            variant="outline"
            className="h-14 border-green-500 text-green-600 hover:bg-green-50"
            onClick={() => {
              const activeRetasi = filteredRetasi.find(r => !r.is_returned);
              if (activeRetasi) {
                handleReturnRetasi(activeRetasi);
              }
            }}
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Armada Kembali
          </Button>
        )}
      </div>

      {/* Retasi List */}
      <div className="px-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-medium text-sm text-gray-700">Daftar Retasi Hari Ini</h2>
          <span className="text-xs text-muted-foreground">{filteredRetasi.length} retasi</span>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRetasi.length === 0 ? (
          <Card className="bg-white">
            <CardContent className="p-6 text-center text-muted-foreground">
              <Truck className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Belum ada retasi hari ini</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredRetasi.map((retasi) => {
              // Calculate totals from items to match Web View
              const totalBawa = retasi.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0;
              const totalKembali = retasi.items?.reduce((sum, i) => sum + (i.returned_quantity || 0), 0) || 0;
              const totalLaku = retasi.items?.reduce((sum, i) => sum + (i.sold_quantity || 0), 0) || 0;
              const totalError = retasi.items?.reduce((sum, i) => sum + (i.error_quantity || 0), 0) || 0;
              const totalTidakLaku = retasi.items?.reduce((sum, i) => sum + (i.unsold_quantity || 0), 0) || 0;

              const selisih = totalBawa - totalKembali - totalError - totalLaku - totalTidakLaku;

              return (
                <Card
                  key={retasi.id}
                  className={`bg-white ${!retasi.is_returned ? 'border-amber-300' : 'border-green-300'}`}
                  onClick={() => !retasi.is_returned && canEditRetasi() && handleReturnRetasi(retasi)}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">Retasi {retasi.retasi_ke}</span>
                        {retasi.is_returned ? (
                          <Badge className="bg-green-100 text-green-700 text-xs">Kembali</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 text-xs">Berangkat</Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {retasi.departure_time || format(retasi.created_at, 'HH:mm', { locale: id })}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2 flex-wrap">
                      <Truck className="h-3 w-3 flex-shrink-0" />
                      <span className="font-medium text-slate-700">{retasi.driver_name || '-'}</span>
                      {retasi.helper_name && (
                        <>
                          <span className="text-slate-400">/</span>
                          <span className="text-slate-600">Helper: {retasi.helper_name}</span>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-5 gap-1 text-center text-xs">
                      <div>
                        <div className="text-blue-600 font-medium">{totalBawa}</div>
                        <div className="text-gray-400">Bawa</div>
                      </div>
                      <div>
                        <div className="text-gray-600 font-medium">{totalKembali}</div>
                        <div className="text-gray-400">Kembali</div>
                      </div>
                      <div>
                        <div className="text-green-600 font-medium">{totalLaku}</div>
                        <div className="text-gray-400">Laku</div>
                      </div>
                      <div>
                        <div className="text-red-600 font-medium">{totalError}</div>
                        <div className="text-gray-400">Error</div>
                      </div>
                      <div>
                        <div className={`font-medium ${selisih !== 0 ? 'text-red-600' : 'text-blue-600'}`}>
                          {selisih}
                        </div>
                        <div className="text-gray-400">Selisih</div>
                      </div>
                    </div>

                    {!retasi.is_returned && canEditRetasi() && (
                      <div className="mt-2 pt-2 border-t">
                        <span className="text-xs text-green-600 flex items-center justify-center gap-1">
                          <ArrowLeft className="h-3 w-3" />
                          Tap untuk input kembali
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Add Retasi Dialog */}
      <AddRetasiMobileDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        drivers={drivers}
        createRetasi={createRetasi}
        checkDriverAvailability={checkDriverAvailability}
        refetchRetasiList={refetchRetasiList}
      />

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
    </div>
  );
}

// Simplified Add Retasi Dialog for Mobile
function AddRetasiMobileDialog({
  open,
  onOpenChange,
  drivers,
  createRetasi,
  checkDriverAvailability,
  refetchRetasiList,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drivers: any[];
  createRetasi: any;
  checkDriverAvailability: (driverName: string) => Promise<boolean>;
  refetchRetasiList: () => Promise<any>;
}) {
  const { timezone } = useTimezone();
  const [driverId, setDriverId] = useState(drivers?.[0]?.id || "");
  const [helperId, setHelperId] = useState<string>("");
  const [retasiItems, setRetasiItems] = useState<CreateRetasiItemData[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [itemQuantity, setItemQuantity] = useState(1);
  const [blocked, setBlocked] = useState(false);
  const [nextSeq, setNextSeq] = useState(1);

  const { products, isLoading: isLoadingProducts } = useProducts();

  // Semua produk bisa dipilih untuk retasi (tidak dibatasi stock)
  const availableProducts = useMemo(() => {
    return products || [];
  }, [products]);

  const totalBawa = useMemo(() => {
    return retasiItems.reduce((sum, item) => sum + item.quantity, 0);
  }, [retasiItems]);

  const recomputeMeta = async (driverId: string) => {
    if (!driverId) return;

    const driver = drivers?.find((d: any) => d.id === driverId);
    if (!driver) return;

    try {
      const isBlocked = !(await checkDriverAvailability(driver.name));
      setBlocked(isBlocked);

      const todayDate = new Date().toISOString().slice(0, 10);
      const { data: todayRetasi } = await supabase
        .from('retasi')
        .select('retasi_ke')
        .eq('driver_name', driver.name)
        .eq('departure_date', todayDate);

      setNextSeq((todayRetasi?.length || 0) + 1);
    } catch (error) {
      setNextSeq(1);
    }
  };

  React.useEffect(() => {
    if (open && driverId) {
      recomputeMeta(driverId);
    }
  }, [open, driverId]);

  React.useEffect(() => {
    if (!open) {
      setRetasiItems([]);
      setHelperId("");
      setSelectedProductId("");
      setItemQuantity(1);
    }
  }, [open]);

  const addProductItem = () => {
    if (!selectedProductId) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }

    const product = availableProducts.find(p => p.id === selectedProductId);
    if (!product) return;

    if (itemQuantity <= 0) {
      toast.error("Jumlah harus lebih dari 0");
      return;
    }

    const existingIndex = retasiItems.findIndex(item => item.product_id === selectedProductId);
    if (existingIndex >= 0) {
      const updatedItems = [...retasiItems];
      updatedItems[existingIndex].quantity += itemQuantity;
      setRetasiItems(updatedItems);
    } else {
      setRetasiItems([...retasiItems, {
        product_id: product.id,
        product_name: product.name,
        quantity: itemQuantity,
      }]);
    }

    setSelectedProductId("");
    setItemQuantity(1);
  };

  const removeProductItem = (index: number) => {
    const updatedItems = [...retasiItems];
    updatedItems.splice(index, 1);
    setRetasiItems(updatedItems);
  };

  const save = async () => {
    if (blocked) {
      toast.error("Retasi sebelumnya masih berstatus Armada Berangkat");
      return;
    }

    if (!driverId) {
      toast.error("Pilih supir");
      return;
    }

    const driver = drivers?.find((d: any) => d.id === driverId);
    if (!driver) return;

    const helper = helperId ? drivers?.find((d: any) => d.id === helperId) : null;

    if (retasiItems.length === 0) {
      toast.error("Tambahkan minimal 1 produk");
      return;
    }

    try {
      // Use office timezone for departure date to ensure correct date
      const officeDateStr = getOfficeDateString(timezone);

      await createRetasi.mutateAsync({
        driver_name: driver.name,
        helper_name: helper?.name || undefined,
        departure_date: officeDateStr, // Pass string YYYY-MM-DD directly
        total_items: totalBawa,
        items: retasiItems,
      });

      toast.success(`Retasi disimpan (${totalBawa} item)`);
      // Explicitly refetch the retasi list to ensure new data appears
      await refetchRetasiList();
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Gagal menyimpan retasi");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] p-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5 text-blue-600" />
            Input Retasi Berangkat
          </DialogTitle>
          <DialogDescription>
            Retasi {nextSeq} - {format(getOfficeDateString(timezone), 'dd MMM yyyy HH:mm', { locale: id })}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="text-sm">Supir</Label>
                <Select value={driverId} onValueChange={setDriverId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Supir" />
                  </SelectTrigger>
                  <SelectContent>
                    {drivers?.map((driver: any) => (
                      <SelectItem key={driver.id} value={driver.id}>
                        {driver.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm">Helper (Opsional)</Label>
                <Select value={helperId || 'no-helper'} onValueChange={(v) => setHelperId(v === 'no-helper' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih Helper" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="no-helper">Tidak ada</SelectItem>
                    {drivers
                      ?.filter((d: any) => d.id !== driverId)
                      .map((driver: any) => (
                        <SelectItem key={driver.id} value={driver.id}>
                          {driver.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {blocked && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                <AlertTriangle className="h-4 w-4 inline mr-1" />
                Retasi sebelumnya masih berstatus Armada Berangkat
              </div>
            )}

            {/* Product Selection */}
            <div className="space-y-2">
              <Label className="text-sm">Tambah Produk</Label>
              <div className="flex gap-2">
                <Select value={selectedProductId} onValueChange={setSelectedProductId} disabled={isLoadingProducts}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder={isLoadingProducts ? "Memuat..." : "Pilih Produk"} />
                  </SelectTrigger>
                  <SelectContent>
                    {availableProducts.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.name} ({product.currentStock})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={itemQuantity}
                  onChange={(e) => setItemQuantity(Number(e.target.value) || 1)}
                  onFocus={(e) => e.target.select()}
                  className="w-16 text-center"
                />
                <Button onClick={addProductItem} size="icon" variant="secondary">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Product List */}
            {retasiItems.length > 0 ? (
              <div className="border rounded-lg divide-y">
                {retasiItems.map((item, index) => (
                  <div key={index} className="flex items-center justify-between p-3">
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.product_name}</div>
                      <div className="text-xs text-muted-foreground">Qty: {item.quantity}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProductItem(index)}
                      className="text-red-500 h-8 w-8 p-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <div className="p-3 bg-blue-50 flex justify-between items-center">
                  <span className="font-medium text-sm">Total Bawa</span>
                  <span className="font-bold text-blue-600 text-lg">{totalBawa}</span>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-muted-foreground text-sm border rounded-lg bg-gray-50">
                <Package className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Belum ada produk ditambahkan
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 border-t flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            onClick={save}
            disabled={blocked || createRetasi.isPending || retasiItems.length === 0}
          >
            {createRetasi.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Simpan ({totalBawa})
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
