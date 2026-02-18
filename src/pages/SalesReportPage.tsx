import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBranch } from "@/contexts/BranchContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { id } from "date-fns/locale";
import { Eye, MapPin, Search, Loader2, Calendar as CalendarIcon, Filter } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Types
interface SalesVisitReport {
    id: string;
    created_at: string;
    sales_id: string;
    customer_id: string;
    notes: string;
    latitude: number;
    longitude: number;
    photo_url: string;
    customer: {
        name: string;
        address: string;
    };
    sales_person: {
        name: string;
        email: string;
    };
}

export default function SalesReportPage() {
    const { currentBranch } = useBranch();
    const [page, setPage] = useState(1);
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
    const [selectedReport, setSelectedReport] = useState<SalesVisitReport | null>(null);
    const [isDetailOpen, setIsDetailOpen] = useState(false);

    // Fetch Reports
    const { data: reports, isLoading } = useQuery({
        queryKey: ['sales-reports', currentBranch?.id, page, searchQuery, selectedDate],
        queryFn: async () => {
            let query = supabase
                .from('sales_visit_reports')
                .select(`
                    *,
                    customer:customers(name, address),
                    sales_person:created_by(name, email)
                `)
                .order('created_at', { ascending: false });

            if (currentBranch?.id) {
                query = query.eq('branch_id', currentBranch.id);
            }

            if (selectedDate) {
                const startOfDay = new Date(selectedDate);
                startOfDay.setHours(0, 0, 0, 0);
                const endOfDay = new Date(selectedDate);
                endOfDay.setHours(23, 59, 59, 999);

                query = query
                    .gte('created_at', startOfDay.toISOString())
                    .lte('created_at', endOfDay.toISOString());
            }

            if (searchQuery) {
                // Determine if searching for customer or sales person based on query logic or just client-side filter
                // Note: Supabase complex filtering on joined tables can be tricky.
                // For now, let's filter client-side if dataset is small, or just fetch all and filter in memory for robust search.
                // To keep it simple and performant, we might want to just fetch latest 50 and filter.
            }

            const { data, error } = await query.limit(50);

            if (error) {
                console.error("Error fetching reports:", error);
                throw error;
            }

            return data as any[] as SalesVisitReport[]; // Type assertion for joined fields
        },
        enabled: !!currentBranch,
    });

    // Client-side filtering for search query (Customer Name or Sales Name)
    const filteredReports = reports?.filter(report => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
            report.customer?.name?.toLowerCase().includes(query) ||
            report.sales_person?.name?.toLowerCase().includes(query) ||
            report.notes?.toLowerCase().includes(query)
        );
    }) || [];

    const handleViewDetail = (report: SalesVisitReport) => {
        setSelectedReport(report);
        setIsDetailOpen(true);
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">Laporan Sales</h1>
                    <p className="text-muted-foreground">Monitoring aktivitas kunjungan sales di lapangan.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col sm:flex-row gap-4 justify-between">
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Cari pelanggan atau sales..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-8"
                            />
                        </div>
                        <div className="flex gap-2">
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-[240px] justify-start text-left font-normal",
                                            !selectedDate && "text-muted-foreground"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {selectedDate ? format(selectedDate, "PHP", { locale: id }) : <span>Pilih Tanggal</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                        mode="single"
                                        selected={selectedDate}
                                        onSelect={setSelectedDate}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                            {selectedDate && (
                                <Button variant="ghost" size="icon" onClick={() => setSelectedDate(undefined)}>
                                    <span className="sr-only">Reset</span>
                                    ✕
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Tanggal</TableHead>
                                    <TableHead>Sales</TableHead>
                                    <TableHead>Pelanggan</TableHead>
                                    <TableHead>Lokasi</TableHead>
                                    <TableHead>Catatan</TableHead>
                                    <TableHead>Foto</TableHead>
                                    <TableHead className="text-right">Aksi</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center">
                                            <div className="flex justify-center items-center gap-2">
                                                <Loader2 className="h-4 w-4 animate-spin" /> Loading...
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ) : filteredReports.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                            Tidak ada laporan ditemukan.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredReports.map((report) => (
                                        <TableRow key={report.id}>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{format(new Date(report.created_at), 'dd MMM yyyy', { locale: id })}</span>
                                                    <span className="text-xs text-muted-foreground">{format(new Date(report.created_at), 'HH:mm', { locale: id })}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{report.sales_person?.name || 'Unknown'}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{report.customer?.name || 'Unknown Customer'}</span>
                                                    <span className="text-xs text-muted-foreground truncate max-w-[150px]">{report.customer?.address}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                {report.latitude && report.longitude ? (
                                                    <a
                                                        href={`https://www.google.com/maps?q=${report.latitude},${report.longitude}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800 text-xs"
                                                    >
                                                        <MapPin className="h-3 w-3" />
                                                        Lihat Peta
                                                    </a>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="max-w-[200px] truncate">
                                                {report.notes}
                                            </TableCell>
                                            <TableCell>
                                                {report.photo_url ? (
                                                    <div className="h-10 w-10 relative rounded overflow-hidden bg-slate-100 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => handleViewDetail(report)}>
                                                        <img src={report.photo_url} alt="Visit" className="w-full h-full object-cover" />
                                                    </div>
                                                ) : (
                                                    <span className="text-xs text-muted-foreground">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="icon" onClick={() => handleViewDetail(report)}>
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            {/* Detail Dialog */}
            <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
                <DialogContent className="sm:max-w-xl md:max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Detail Kunjungan Sales</DialogTitle>
                    </DialogHeader>
                    {selectedReport && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                    <div className="text-muted-foreground">Waktu</div>
                                    <div className="font-medium">{format(new Date(selectedReport.created_at), 'dd MMMM yyyy, HH:mm', { locale: id })}</div>

                                    <div className="text-muted-foreground">Sales</div>
                                    <div className="font-medium">{selectedReport.sales_person?.name}</div>

                                    <div className="text-muted-foreground">Pelanggan</div>
                                    <div className="font-medium">{selectedReport.customer?.name}</div>
                                </div>

                                {selectedReport.latitude && (
                                    <div className="bg-slate-50 p-3 rounded-md border text-sm">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-muted-foreground">Lokasi GPS</span>
                                            <a
                                                href={`https://www.google.com/maps?q=${selectedReport.latitude},${selectedReport.longitude}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                                            >
                                                <MapPin className="h-3 w-3" />
                                                Buka Peta
                                            </a>
                                        </div>
                                        <div className="font-mono text-xs text-slate-600">{selectedReport.latitude}, {selectedReport.longitude}</div>
                                    </div>
                                )}

                                <div>
                                    <h4 className="text-sm font-medium mb-1.5 text-muted-foreground">Catatan Kunjungan</h4>
                                    <div className="p-3 bg-white border rounded-md text-sm min-h-[80px]">
                                        {selectedReport.notes}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <h4 className="text-sm font-medium text-muted-foreground">Dokumentasi Foto</h4>
                                {selectedReport.photo_url ? (
                                    <div className="rounded-lg overflow-hidden border bg-slate-100 shadow-sm">
                                        <a href={selectedReport.photo_url} target="_blank" rel="noopener noreferrer">
                                            <img
                                                src={selectedReport.photo_url}
                                                alt="Dokumentasi Kunjungan"
                                                className="w-full h-auto object-contain max-h-[400px] hover:scale-105 transition-transform duration-300"
                                            />
                                        </a>
                                    </div>
                                ) : (
                                    <div className="flex items-center justify-center h-48 bg-slate-100 rounded-lg border text-muted-foreground text-sm">
                                        <div className="text-center">
                                            <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-20" />
                                            Tidak ada foto
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
