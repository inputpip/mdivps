"use client"
import * as React from "react"
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { MoreHorizontal, ArrowUpDown, MapPin, Camera, Search, Clock } from "lucide-react"
import { format, differenceInDays } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCustomers } from "@/hooks/useCustomers"
import { Customer } from "@/types/customer"
import { Skeleton } from "./ui/skeleton"
import { useAuthContext } from "@/contexts/AuthContext"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { showSuccess, showError } from "@/utils/toast"
import { isOwner } from '@/utils/roleUtils'
import { PhotoUploadService } from "@/services/photoUploadService"

export const getColumns = (
  onEditClick: (customer: Customer) => void,
  onDeleteClick: (customer: Customer) => void,
  userRole?: string
): ColumnDef<Customer>[] => [
    {
      accessorKey: "name",
      header: "Nama",
    },
    {
      accessorKey: "phone",
      header: "No. Telepon",
    },
    {
      accessorKey: "address",
      header: "Alamat",
      cell: ({ row }) => {
        const address = row.getValue("address") as string;

        if (!address) return null;

        return (
          <div className="max-w-[200px] truncate" title={address}>
            {address}
          </div>
        );
      }
    },
    {
      accessorKey: "classification",
      header: "Klasifikasi",
      cell: ({ row }) => {
        const classification = row.getValue("classification") as string;
        if (!classification) return <span className="text-muted-foreground text-xs">-</span>;

        const isKios = classification === 'Kios/Toko';
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${isKios
            ? 'bg-blue-500/10 text-blue-500'
            : 'bg-green-500/10 text-green-500'
            }`}>
            {classification}
          </span>
        );
      }
    },
    {
      accessorKey: "orderCount",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation(); // Mencegah klik baris
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
          >
            Orderan
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => <div className="text-center">{row.getValue("orderCount")}</div>
    },
    {
      accessorKey: "lastOrderDate",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
          >
            Order Terakhir
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const lastOrderDate = row.getValue("lastOrderDate") as Date | null;
        if (!lastOrderDate) {
          return <span className="text-muted-foreground text-xs">Belum pernah</span>;
        }

        const daysSinceLastOrder = differenceInDays(new Date(), lastOrderDate);
        const formattedDate = format(lastOrderDate, "d MMM yyyy", { locale: idLocale });

        // Color coding based on days since last order
        let colorClass = "text-emerald-500"; // < 30 days
        if (daysSinceLastOrder > 90) {
          colorClass = "text-destructive";
        } else if (daysSinceLastOrder > 60) {
          colorClass = "text-orange-500";
        } else if (daysSinceLastOrder > 30) {
          colorClass = "text-amber-500";
        }

        return (
          <div className="text-xs">
            <div>{formattedDate}</div>
            <div className={`${colorClass} font-medium`}>
              {daysSinceLastOrder === 0 ? "Hari ini" : `${daysSinceLastOrder} hari lalu`}
            </div>
          </div>
        );
      },
      sortingFn: (rowA, rowB, columnId) => {
        const dateA = rowA.getValue(columnId) as Date | null;
        const dateB = rowB.getValue(columnId) as Date | null;
        if (!dateA && !dateB) return 0;
        if (!dateA) return 1;
        if (!dateB) return -1;
        return dateA.getTime() - dateB.getTime();
      }
    },
    {
      accessorKey: "jumlah_galon_titip",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
          >
            Galon Titip
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        )
      },
      cell: ({ row }) => {
        const galon = row.getValue("jumlah_galon_titip") as number | undefined;
        if (!galon || galon === 0) {
          return <span className="text-muted-foreground text-xs">-</span>;
        }
        return (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-orange-500/10 text-orange-500">
            {galon} galon
          </span>
        );
      },
      sortingFn: (rowA, rowB, columnId) => {
        const a = (rowA.getValue(columnId) as number) || 0;
        const b = (rowB.getValue(columnId) as number) || 0;
        return a - b;
      }
    },
    {
      id: "location",
      header: "Lokasi GPS",
      cell: ({ row }) => {
        const customer = row.original;
        if (!customer.latitude || !customer.longitude) {
          return (
            <div className="text-xs text-muted-foreground">
              Tidak ada koordinat
            </div>
          );
        }

        return (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              {customer.latitude.toFixed(6)}, {customer.longitude.toFixed(6)}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                window.open(`https://www.google.com/maps/dir//${customer.latitude},${customer.longitude}`, '_blank');
              }}
              className="h-6 text-xs btn-glossy"
            >
              <MapPin className="h-3 w-3 mr-1" />
              Buka Maps
            </Button>
          </div>
        );
      }
    },
    {
      id: "photo",
      header: "Foto",
      cell: ({ row }) => {
        const customer = row.original;
        if (!customer.store_photo_url) return (
          <div className="w-12 h-12 bg-muted rounded-md flex items-center justify-center">
            <Camera className="h-4 w-4 text-muted-foreground" />
          </div>
        );

        return (
          <div className="flex items-center gap-2">
            <img
              src={PhotoUploadService.getPhotoUrl(customer.store_photo_url, 'Customers_Images')}
              alt={`Foto toko ${customer.name}`}
              className="w-12 h-12 object-cover rounded-md cursor-pointer hover:opacity-80 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                window.open(PhotoUploadService.getPhotoUrl(customer.store_photo_url!, 'Customers_Images'), '_blank');
              }}
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
                const parent = target.parentElement;
                if (parent) {
                  parent.innerHTML = `
                  <div class="w-12 h-12 bg-muted rounded-md flex items-center justify-center">
                    <svg class="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                `;
                }
              }}
            />
          </div>
        );
      }
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const customer = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-haspopup="true"
                  size="icon"
                  variant="ghost"
                  onClick={(e) => e.stopPropagation()} // Mencegah klik baris
                  className="hover-glow"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(e) => e.stopPropagation()} // Mencegah klik baris
              >
                <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => onEditClick(customer)} className="dropdown-item-hover">
                  Edit
                </DropdownMenuItem>
                {userRole?.toLowerCase() === 'owner' && (
                  <DropdownMenuItem
                    className="text-red-500 hover:!text-red-500 hover:!bg-red-100 dropdown-item-hover"
                    onClick={() => onDeleteClick(customer)}
                  >
                    Hapus
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      },
    },
  ]

interface CustomerTableProps {
  onEditCustomer?: (customer: Customer) => void
}

type InactivityFilter = 'all' | 'active' | 'inactive' | 'inactive_30' | 'inactive_60' | 'inactive_90';

export function CustomerTable({ onEditCustomer }: CustomerTableProps) {
  const { customers, isLoading, deleteCustomer } = useCustomers()
  const { user } = useAuthContext()
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [activityFilter, setActivityFilter] = React.useState<InactivityFilter>('all')
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize: 10 })
  const navigate = useNavigate()

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = React.useState(false)
  const [selectedCustomer, setSelectedCustomer] = React.useState<Customer | null>(null)

  // Filter customers by activity and inactivity period
  const filteredCustomers = React.useMemo(() => {
    const today = new Date();
    return (customers || []).filter(customer => {
      if (activityFilter === 'all') return true;
      if (activityFilter === 'active') return (customer.orderCount || 0) > 0;
      if (activityFilter === 'inactive') return (customer.orderCount || 0) === 0;

      // Inactivity filters based on last order date
      if (activityFilter === 'inactive_30') {
        if (!customer.lastOrderDate) return true; // Never ordered = inactive
        const days = differenceInDays(today, new Date(customer.lastOrderDate));
        return days > 30;
      }
      if (activityFilter === 'inactive_60') {
        if (!customer.lastOrderDate) return true;
        const days = differenceInDays(today, new Date(customer.lastOrderDate));
        return days > 60;
      }
      if (activityFilter === 'inactive_90') {
        if (!customer.lastOrderDate) return true;
        const days = differenceInDays(today, new Date(customer.lastOrderDate));
        return days > 90;
      }

      return true;
    });
  }, [customers, activityFilter]);

  const handleEditClick = (customer: Customer) => {
    if (onEditCustomer) {
      onEditCustomer(customer)
    }
  }

  const handleDeleteClick = (customer: Customer) => {
    setSelectedCustomer(customer)
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!selectedCustomer) return;

    try {
      await deleteCustomer.mutateAsync(selectedCustomer.id);
      showSuccess("Pelanggan berhasil dihapus.");
    } catch (error: any) {
      showError(error.message || "Gagal menghapus pelanggan.");
    } finally {
      setIsDeleteDialogOpen(false);
      setSelectedCustomer(null);
    }
  };

  const columns = React.useMemo(() => getColumns(handleEditClick, handleDeleteClick, user?.role), [user?.role]);

  const table = useReactTable({
    data: filteredCustomers,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    globalFilterFn: 'includesString',
    autoResetPageIndex: false,
    state: {
      sorting,
      globalFilter,
      pagination,
    },
  })

  return (
    <div className="w-full">
      {/* Search and filters - Mobile responsive */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-4 sm:px-0">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 flex-1">
          {/* Search input */}
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Cari nama pelanggan..."
              value={globalFilter ?? ''}
              onChange={(event) => setGlobalFilter(event.target.value)}
              className="pl-10 input-glow"
            />
          </div>
          {/* Activity Filter */}
          <Select value={activityFilter} onValueChange={(v) => setActivityFilter(v as InactivityFilter)}>
            <SelectTrigger className="w-[200px]">
              <Clock className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Pelanggan</SelectItem>
              <SelectItem value="active">Pernah Order</SelectItem>
              <SelectItem value="inactive">Belum Pernah Order</SelectItem>
              <SelectItem value="inactive_30">
                <span className="text-yellow-600">Tidak pesan &gt;30 hari</span>
              </SelectItem>
              <SelectItem value="inactive_60">
                <span className="text-orange-600">Tidak pesan &gt;60 hari</span>
              </SelectItem>
              <SelectItem value="inactive_90">
                <span className="text-red-600">Tidak pesan &gt;90 hari</span>
              </SelectItem>
            </SelectContent>
          </Select>
          <div className="text-sm text-muted-foreground">
            {table.getRowModel().rows.length} dari {customers?.length || 0} pelanggan
          </div>
        </div>
      </div>
      {/* Desktop Table */}
      <div className="hidden md:block rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <Table className="min-w-[600px]">
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs sm:text-sm">
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={columns.length}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    onClick={() => navigate(`/customers/${row.original.id}`)}
                    className="cursor-pointer table-row-hover"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="text-xs sm:text-sm">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-sm">
                    {globalFilter ? 'Tidak ada pelanggan yang cocok dengan pencarian' : 'Tidak ada data pelanggan.'}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      {/* Mobile-friendly pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-4 px-4 sm:px-0">
        <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
          <div className="sm:hidden">
            {table.getRowModel().rows.length} dari {customers?.length || 0}
          </div>
          <div className="hidden sm:block">
            Halaman {table.getState().pagination.pageIndex + 1} dari{" "}
            {table.getPageCount()} ({table.getRowModel().rows.length} dari {customers?.length || 0} ditampilkan)
          </div>
        </div>
        <div className="flex items-center justify-center gap-2 sm:gap-3 flex-wrap">
          <div className="hidden sm:flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Tampilkan:</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={(value) => {
                const newSize = value === 'all' ? (customers?.length || 1000) : Number(value);
                setPagination({ pageIndex: 0, pageSize: newSize });
              }}
            >
              <SelectTrigger className="h-8 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="all">Semua</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="text-xs sm:text-sm hover-glow"
          >
            <span className="hidden sm:inline">Sebelumnya</span>
            <span className="sm:hidden">‹</span>
          </Button>
          <div className="text-xs text-muted-foreground px-2">
            {table.getState().pagination.pageIndex + 1}/{table.getPageCount()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="text-xs sm:text-sm hover-glow"
          >
            <span className="hidden sm:inline">Selanjutnya</span>
            <span className="sm:hidden">›</span>
          </Button>
        </div>
      </div>

      {/* Mobile Card Layout */}
      <div className="md:hidden space-y-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="glass-card p-4">
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-3 w-1/2 mb-2" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))
        ) : table.getRowModel().rows?.length ? (
          table.getRowModel().rows.map((row) => {
            const customer = row.original
            return (
              <div key={row.id} className="glass-card p-4 hover:shadow-lg transition-all duration-200">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1 text-card-foreground">
                    <h3 className="font-semibold text-lg">{customer.name}</h3>
                    <p className="text-sm text-muted-foreground">{customer.phone}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" className="h-8 w-8 p-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Aksi</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => handleEditClick(customer)}>
                        Edit
                      </DropdownMenuItem>
                      {isOwner(user?.role) && (
                        <DropdownMenuItem
                          className="text-red-500 hover:!text-red-500 hover:!bg-red-100"
                          onClick={() => handleDeleteClick(customer)}
                        >
                          Hapus
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {customer.address && (
                  <div className="mb-3">
                    <p className="text-sm text-muted-foreground line-clamp-2">{customer.address}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-3 mb-3">
                  {customer.classification && (
                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${customer.classification === 'Kios/Toko'
                      ? 'bg-blue-500/10 text-blue-500'
                      : 'bg-green-500/10 text-green-500'
                      }`}>
                      {customer.classification}
                    </span>
                  )}
                  <div className="flex items-center gap-1 bg-blue-500/10 px-2 py-1 rounded-md">
                    <span className="text-xs font-medium text-blue-500">Orders:</span>
                    <span className="text-xs font-bold text-blue-600">{customer.orderCount || 0}</span>
                  </div>

                  {/* Last Order Date Badge */}
                  {customer.lastOrderDate ? (
                    (() => {
                      const daysSince = differenceInDays(new Date(), new Date(customer.lastOrderDate));
                      let bgColor = "bg-green-500/10";
                      let textColor = "text-green-500";
                      if (daysSince > 90) {
                        bgColor = "bg-destructive/10";
                        textColor = "text-destructive";
                      } else if (daysSince > 60) {
                        bgColor = "bg-orange-500/10";
                        textColor = "text-orange-500";
                      } else if (daysSince > 30) {
                        bgColor = "bg-amber-500/10";
                        textColor = "text-amber-500";
                      }
                      return (
                        <div className={`flex items-center gap-1 ${bgColor} px-2 py-1 rounded-md`}>
                          <Clock className="h-3 w-3" />
                          <span className={`text-xs font-medium ${textColor}`}>
                            {daysSince === 0 ? "Hari ini" : `${daysSince} hari lalu`}
                          </span>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="flex items-center gap-1 bg-muted px-2 py-1 rounded-md">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">Belum order</span>
                    </div>
                  )}

                  {customer.jumlah_galon_titip && customer.jumlah_galon_titip > 0 && (
                    <div className="flex items-center gap-1 bg-orange-500/10 px-2 py-1 rounded-md">
                      <span className="text-xs font-medium text-orange-500">Galon Titip:</span>
                      <span className="text-xs font-bold text-orange-600">{customer.jumlah_galon_titip}</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2 pt-2 border-t border-border">
                  {customer.latitude && customer.longitude ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => window.open(`https://www.google.com/maps?q=${customer.latitude},${customer.longitude}`, '_blank')}
                    >
                      <MapPin className="h-3 w-3 mr-1" />
                      Lihat Lokasi
                    </Button>
                  ) : (
                    <div className="flex-1 text-xs text-gray-400 text-center py-2">
                      Tidak ada koordinat
                    </div>
                  )}

                  {customer.store_photo_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 text-xs"
                      onClick={() => window.open(PhotoUploadService.getPhotoUrl(customer.store_photo_url!, 'Customers_Images'), '_blank')}
                    >
                      <Camera className="h-3 w-3 mr-1" />
                      Lihat Foto
                    </Button>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            Tidak ada pelanggan ditemukan.
          </div>
        )}

        {/* Mobile Pagination */}
        <div className="flex items-center justify-center space-x-2 pt-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            ‹ Prev
          </Button>
          <div className="text-sm text-muted-foreground px-3">
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next ›
          </Button>
        </div>
      </div>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apakah Anda yakin?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini akan menghapus pelanggan <strong>{selectedCustomer?.name}</strong> secara permanen. Pelanggan yang sudah memiliki transaksi tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Ya, Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}