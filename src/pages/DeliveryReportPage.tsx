"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import {
    Truck, Search, Filter, MapPin, Clock, Camera,
    CheckCircle2, XCircle, Package, RotateCcw, Calendar,
    FileText, Eye, RefreshCcw, ExternalLink
} from "lucide-react"
import { format } from "date-fns"
import { id as localeId } from "date-fns/locale"
import { useDeliveryReports } from "@/hooks/useDeliveryReports"
import { PhotoUploadService } from "@/services/photoUploadService"

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
    delivered: { label: 'Terkirim', color: 'bg-emerald-100 text-emerald-800', icon: CheckCircle2 },
    partial: { label: 'Sebagian', color: 'bg-amber-100 text-amber-800', icon: Package },
    failed: { label: 'Gagal', color: 'bg-red-100 text-red-800', icon: XCircle },
    returned: { label: 'Dikembalikan', color: 'bg-orange-100 text-orange-800', icon: RotateCcw },
    rescheduled: { label: 'Dijadwalkan Ulang', color: 'bg-blue-100 text-blue-800', icon: Calendar },
    pending: { label: 'Pending', color: 'bg-gray-100 text-gray-800', icon: Clock },
}

export default function DeliveryReportPage() {
    const { data: reports, isLoading, refetch } = useDeliveryReports()
    const [searchTerm, setSearchTerm] = useState('')
    const [filterStatus, setFilterStatus] = useState<string>('all')
    const [detailReport, setDetailReport] = useState<any>(null)

    const filteredReports = (reports || []).filter(r => {
        const matchSearch = !searchTerm ||
            r.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.driverName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.transactionId?.toLowerCase().includes(searchTerm.toLowerCase())
        const matchStatus = filterStatus === 'all' || r.status === filterStatus
        return matchSearch && matchStatus
    })

    // Stats
    const stats = {
        total: reports?.length || 0,
        delivered: reports?.filter(r => r.status === 'delivered').length || 0,
        partial: reports?.filter(r => r.status === 'partial').length || 0,
        failed: reports?.filter(r => r.status === 'failed' || r.status === 'returned').length || 0,
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Laporan Pengantaran</h1>
                    <p className="text-muted-foreground">Monitor status pengantaran dari supir & helper</p>
                </div>
                <Button variant="outline" onClick={() => refetch()} className="flex items-center gap-2">
                    <RefreshCcw className="h-4 w-4" />
                    Refresh
                </Button>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-blue-100 p-2 rounded-lg">
                                <FileText className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.total}</p>
                                <p className="text-xs text-muted-foreground">Total Laporan</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-emerald-100 p-2 rounded-lg">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.delivered}</p>
                                <p className="text-xs text-muted-foreground">Terkirim</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-amber-100 p-2 rounded-lg">
                                <Package className="h-5 w-5 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.partial}</p>
                                <p className="text-xs text-muted-foreground">Sebagian</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="pt-4">
                        <div className="flex items-center gap-3">
                            <div className="bg-red-100 p-2 rounded-lg">
                                <XCircle className="h-5 w-5 text-red-600" />
                            </div>
                            <div>
                                <p className="text-2xl font-bold">{stats.failed}</p>
                                <p className="text-xs text-muted-foreground">Gagal / Kembali</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Filter className="h-4 w-4" />
                        Filter
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col sm:flex-row gap-3">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari pelanggan, supir, atau ID transaksi..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                        <Select value={filterStatus} onValueChange={setFilterStatus}>
                            <SelectTrigger className="w-full sm:w-[200px]">
                                <SelectValue placeholder="Semua Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Semua Status</SelectItem>
                                <SelectItem value="delivered">Terkirim</SelectItem>
                                <SelectItem value="partial">Sebagian</SelectItem>
                                <SelectItem value="failed">Gagal</SelectItem>
                                <SelectItem value="returned">Dikembalikan</SelectItem>
                                <SelectItem value="rescheduled">Dijadwalkan Ulang</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Truck className="h-4 w-4" />
                        Daftar Laporan ({filteredReports.length})
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-lg border overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow className="bg-slate-50">
                                    <TableHead className="w-[120px]">Waktu Lapor</TableHead>
                                    <TableHead>Transaksi</TableHead>
                                    <TableHead>Pelanggan</TableHead>
                                    <TableHead>Supir</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead>Catatan</TableHead>
                                    <TableHead className="text-center w-[60px]">Lokasi</TableHead>
                                    <TableHead className="text-center w-[60px]">Foto</TableHead>
                                    <TableHead className="text-center w-[60px]">Aksi</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8">
                                            <div className="flex flex-col items-center gap-2">
                                                <RefreshCcw className="h-6 w-6 animate-spin text-muted-foreground" />
                                                <span className="text-sm text-muted-foreground">Memuat data...</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : filteredReports.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8">
                                            <div className="flex flex-col items-center gap-2">
                                                <Truck className="h-8 w-8 text-muted-foreground" />
                                                <span className="text-sm text-muted-foreground">Belum ada laporan pengantaran</span>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredReports.map(report => {
                                        const statusConfig = STATUS_CONFIG[report.status] || STATUS_CONFIG.pending
                                        const StatusIcon = statusConfig.icon
                                        return (
                                            <TableRow key={report.id} className="hover:bg-slate-50/50">
                                                <TableCell className="text-xs whitespace-nowrap">
                                                    {format(report.reportedAt, 'dd MMM yyyy', { locale: localeId })}
                                                    <br />
                                                    <span className="text-muted-foreground">
                                                        {format(report.reportedAt, 'HH:mm')}
                                                    </span>
                                                </TableCell>
                                                <TableCell className="font-mono text-xs">{report.transactionId}</TableCell>
                                                <TableCell className="text-sm font-medium">{report.customerName}</TableCell>
                                                <TableCell className="text-sm">{report.driverName}</TableCell>
                                                <TableCell className="text-center">
                                                    <Badge className={`${statusConfig.color} text-xs`}>
                                                        <StatusIcon className="h-3 w-3 mr-1" />
                                                        {statusConfig.label}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-xs max-w-[200px] truncate">
                                                    {report.notes || '-'}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {report.latitude && report.longitude ? (
                                                        <a
                                                            href={`https://maps.google.com/?q=${report.latitude},${report.longitude}`}
                                                            target="_blank" rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-800"
                                                        >
                                                            <MapPin className="h-4 w-4 mx-auto" />
                                                        </a>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {report.photoUrl ? (
                                                        <button
                                                            onClick={() => window.open(PhotoUploadService.getPhotoUrl(report.photoUrl, 'delivery-reports'), '_blank')}
                                                            className="text-blue-600 hover:text-blue-800"
                                                        >
                                                            <Camera className="h-4 w-4 mx-auto" />
                                                        </button>
                                                    ) : (
                                                        <span className="text-muted-foreground">-</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Button variant="ghost" size="icon" className="h-7 w-7"
                                                        onClick={() => setDetailReport(report)}>
                                                        <Eye className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Detail Dialog */}
            <Dialog open={!!detailReport} onOpenChange={() => setDetailReport(null)}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Truck className="h-5 w-5 text-blue-600" />
                            Detail Laporan Pengantaran
                        </DialogTitle>
                        <DialogDescription>
                            {detailReport?.transactionId}
                        </DialogDescription>
                    </DialogHeader>
                    {detailReport && (
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-3 text-sm">
                                <div>
                                    <span className="text-muted-foreground text-xs block">Pelanggan</span>
                                    <span className="font-medium">{detailReport.customerName}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">Supir</span>
                                    <span className="font-medium">{detailReport.driverName}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">Waktu Lapor</span>
                                    <span>{format(detailReport.reportedAt, 'dd MMM yyyy, HH:mm', { locale: localeId })}</span>
                                </div>
                                <div>
                                    <span className="text-muted-foreground text-xs block">Status</span>
                                    {(() => {
                                        const sc = STATUS_CONFIG[detailReport.status] || STATUS_CONFIG.pending
                                        const Icon = sc.icon
                                        return (
                                            <Badge className={`${sc.color} text-xs`}>
                                                <Icon className="h-3 w-3 mr-1" />{sc.label}
                                            </Badge>
                                        )
                                    })()}
                                </div>
                            </div>
                            {detailReport.notes && (
                                <div>
                                    <span className="text-muted-foreground text-xs block mb-1">Catatan</span>
                                    <div className="bg-slate-50 p-3 rounded-lg text-sm">{detailReport.notes}</div>
                                </div>
                            )}
                            {detailReport.latitude && detailReport.longitude && (
                                <div>
                                    <span className="text-muted-foreground text-xs block mb-1">Lokasi GPS</span>
                                    <a
                                        href={`https://maps.google.com/?q=${detailReport.latitude},${detailReport.longitude}`}
                                        target="_blank" rel="noopener noreferrer"
                                        className="flex items-center gap-2 text-blue-600 hover:underline text-sm"
                                    >
                                        <MapPin className="h-4 w-4" />
                                        {detailReport.latitude.toFixed(4)}, {detailReport.longitude.toFixed(4)}
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            )}
                            {detailReport.photoUrl && (
                                <div>
                                    <span className="text-muted-foreground text-xs block mb-1">Foto Bukti</span>
                                    <Button variant="outline" className="w-full"
                                        onClick={() => window.open(PhotoUploadService.getPhotoUrl(detailReport.photoUrl, 'delivery-reports'), '_blank')}>
                                        <Camera className="h-4 w-4 mr-2" />
                                        Lihat Foto
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
