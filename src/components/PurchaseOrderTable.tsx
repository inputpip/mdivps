"use client"
import * as React from "react"
import { ColumnDef, flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table"
import { Badge, badgeVariants } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useToast } from "./ui/use-toast"
import { cn } from "@/lib/utils"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { PurchaseOrder, PurchaseOrderStatus } from "@/types/purchaseOrder"
import { usePurchaseOrders } from "@/hooks/usePurchaseOrders"
import { useAuth } from "@/hooks/useAuth"
import { Skeleton } from "./ui/skeleton"
import { isAdminOrOwner, isOwner } from '@/utils/roleUtils'
import { PurchaseOrderPDF } from "./PurchaseOrderPDF"
import { ReceivePODialog } from "./ReceivePODialog"
import { EditPurchaseOrderDialog } from "./EditPurchaseOrderDialog"
import { Trash2, Pencil, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

// Status yang bisa dipilih manual (tidak termasuk Diterima dan Selesai karena diatur otomatis)
// Dibayar dihilangkan karena pembayaran PO dilakukan melalui halaman Hutang
const statusOptions: PurchaseOrderStatus[] = ['Pending', 'Approved', 'Dikirim'];

const getStatusVariant = (status: PurchaseOrderStatus) => {
  switch (status) {
    case 'Approved': return 'success';
    case 'Dikirim': return 'info';
    case 'Diterima': return 'success';
    case 'Pending': return 'secondary';
    case 'Dibayar': return 'warning';
    case 'Selesai': return 'outline';
    default: return 'outline';
  }
}

export function PurchaseOrderTable() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { purchaseOrders, isLoading, updatePoStatus, receivePurchaseOrder, deletePurchaseOrder } = usePurchaseOrders();
  const [isReceiveDialogOpen, setIsReceiveDialogOpen] = React.useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = React.useState(false);
  const [selectedPo, setSelectedPo] = React.useState<PurchaseOrder | null>(null);
  const [searchTerm, setSearchTerm] = React.useState("");
  const [ppnFilter, setPpnFilter] = React.useState<'all' | 'with_ppn' | 'without_ppn'>('all');

  // Filter purchase orders
  const filteredPurchaseOrders = React.useMemo(() => {
    return (purchaseOrders || []).filter(po => {
      // Search filter
      const matchesSearch = searchTerm === '' ||
        po.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.supplierName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.requestedBy?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        po.expedition?.toLowerCase().includes(searchTerm.toLowerCase());

      // PPN filter
      const matchesPpn = ppnFilter === 'all' ||
        (ppnFilter === 'with_ppn' && po.includePpn) ||
        (ppnFilter === 'without_ppn' && !po.includePpn);

      return matchesSearch && matchesPpn;
    });
  }, [purchaseOrders, searchTerm, ppnFilter]);

  const handleStatusChange = (po: PurchaseOrder, newStatus: PurchaseOrderStatus) => {
    updatePoStatus.mutate({ poId: po.id, status: newStatus }, {
      onSuccess: () => toast({ title: "Status PO Diperbarui" }),
      onError: (error) => toast({ variant: "destructive", title: "Gagal", description: error.message }),
    });
  };

  const handleCompletePo = (po: PurchaseOrder) => {
    updatePoStatus.mutate({ poId: po.id, status: 'Selesai' }, {
      onSuccess: () => toast({ title: "Sukses", description: "Purchase Order telah diselesaikan." }),
      onError: (error) => toast({ variant: "destructive", title: "Gagal", description: error.message }),
    });
  };

  const handleDeletePo = (poId: string) => {
    deletePurchaseOrder.mutate({ poId }, {
      onSuccess: () => toast({ title: "Sukses", description: "Purchase Order berhasil dihapus." }),
      onError: (error) => toast({ variant: "destructive", title: "Gagal", description: error.message }),
    });
  };

  const columns: ColumnDef<PurchaseOrder>[] = [
    { accessorKey: "id", header: "No. PO" },
    {
      accessorKey: "totalCost",
      header: "Total Cost",
      cell: ({ row }) => {
        const cost = row.original.totalCost;
        return cost ? `Rp ${cost.toLocaleString('id-ID')}` : '-';
      }
    },
    {
      accessorKey: "includePpn",
      header: "PPN",
      cell: ({ row }) => {
        const po = row.original;
        if (po.includePpn && po.ppnAmount) {
          return `Rp ${po.ppnAmount.toLocaleString('id-ID')}`;
        }
        return '-';
      }
    },
    {
      accessorKey: "nonPpn",
      header: "Non-PPN",
      cell: ({ row }) => {
        const po = row.original;
        if (po.includePpn && po.ppnAmount && po.totalCost) {
          const nonPpn = po.totalCost - po.ppnAmount;
          return `Rp ${nonPpn.toLocaleString('id-ID')}`;
        } else if (po.totalCost) {
          return `Rp ${po.totalCost.toLocaleString('id-ID')}`;
        }
        return '-';
      }
    },
    { accessorKey: "supplierName", header: "Supplier", cell: ({ row }) => row.original.supplierName || '-' },
    { accessorKey: "expedition", header: "Ekspedisi", cell: ({ row }) => row.original.expedition || '-' },
    { accessorKey: "requestedBy", header: "Pemohon" },
    { accessorKey: "createdAt", header: "Tgl Request", cell: ({ row }) => format(new Date(row.getValue("createdAt")), "d MMM yyyy", { locale: id }) },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const po = row.original;
        const isAdmin = isAdminOrOwner(user);

        // Allow manual status change only for: Pending, Approved, Dikirim, Dibayar
        // Diterima and Selesai are managed by buttons
        if (isAdmin && !['Diterima', 'Selesai'].includes(po.status)) {
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <Select
                value={po.status}
                onValueChange={(value: PurchaseOrderStatus) => handleStatusChange(po, value)}
                disabled={updatePoStatus.isPending}
              >
                <SelectTrigger className={cn("w-[150px] border-0 focus:ring-0 focus:ring-offset-0", badgeVariants({ variant: getStatusVariant(po.status) }))}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4} align="center">
                  {statusOptions.map(status => (
                    <SelectItem key={status} value={status}>{status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        }
        return <Badge variant={getStatusVariant(po.status)}>{po.status}</Badge>
      },
    },
    {
      id: "actions",
      header: "Aksi",
      cell: ({ row }) => {
        const po = row.original;
        const isOwnerRole = isOwner(user);
        const isAdmin = isAdminOrOwner(user);
        return (
          <div className="flex items-center gap-1">
            <PurchaseOrderPDF purchaseOrder={po} />
            {isAdmin && po.status === 'Pending' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSelectedPo(po); setIsEditDialogOpen(true); }}
                title="Edit PO"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {(po.status === 'Dikirim' || po.status === 'Approved') && (
              <Button size="sm" onClick={() => { setSelectedPo(po); setIsReceiveDialogOpen(true); }}>Terima Barang</Button>
            )}
            {po.status === 'Diterima' && (
              <Button size="sm" onClick={() => handleCompletePo(po)} disabled={updatePoStatus.isPending}>Selesaikan</Button>
            )}
            {isOwnerRole && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" title="Hapus PO">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Anda yakin?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Tindakan ini akan menghapus Purchase Order #{po.id} secara permanen.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Batal</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => handleDeletePo(po.id)}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      disabled={deletePurchaseOrder.isPending}
                    >
                      Ya, Hapus
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        );
      }
    }
  ]

  const table = useReactTable({
    data: filteredPurchaseOrders,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <>
      <ReceivePODialog open={isReceiveDialogOpen} onOpenChange={setIsReceiveDialogOpen} purchaseOrder={selectedPo} />
      <EditPurchaseOrderDialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen} purchaseOrder={selectedPo} />

      {/* Search and Filter */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Cari No. PO, supplier, pemohon, ekspedisi..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={ppnFilter} onValueChange={(v) => setPpnFilter(v as 'all' | 'with_ppn' | 'without_ppn')}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Filter PPN" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua</SelectItem>
            <SelectItem value="with_ppn">Dengan PPN</SelectItem>
            <SelectItem value="without_ppn">Tanpa PPN</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>{table.getHeaderGroups().map(hg => <TableRow key={hg.id}>{hg.headers.map(h => <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>)}</TableRow>)}</TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => <TableRow key={i}><TableCell colSpan={columns.length}><Skeleton className="h-8 w-full" /></TableCell></TableRow>)
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map(cell => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}
                </TableRow>
              ))
            ) : (
              <TableRow><TableCell colSpan={columns.length} className="h-24 text-center">Belum ada permintaan PO.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}