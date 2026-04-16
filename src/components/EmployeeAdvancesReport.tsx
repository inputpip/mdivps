"use client"
import * as React from "react"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { saveCompressedPDF } from "@/utils/pdfUtils"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { Button } from "@/components/ui/button"
import { FileDown, FileSpreadsheet, Printer } from "lucide-react"
import { EmployeeAdvance } from "@/types/employeeAdvance"
import * as XLSX from 'xlsx'
import { useBranch } from "@/contexts/BranchContext"
import { useCompanySettings } from "@/hooks/useCompanySettings"

interface EmployeeAdvancesReportProps {
    advances: EmployeeAdvance[];
    titleSuffix?: string;
}

export function EmployeeAdvancesReport({ advances, titleSuffix }: EmployeeAdvancesReportProps) {
    const { currentBranch } = useBranch()
    const { settings } = useCompanySettings()

    const generatePDF = (action: 'download' | 'print' = 'download') => {
        const doc = new jsPDF('p', 'mm', 'a4'); // Portrait orientation

        // Company header
        doc.setFontSize(16);
        doc.setFont('helvetica', 'bold');
        doc.text(currentBranch?.name || settings?.name || 'AQUVIT', 105, 15, { align: 'center' });

        doc.setFontSize(14);
        doc.text(`LAPORAN DAFTAR PANJAR KARYAWAN${titleSuffix ? ` ${titleSuffix}` : ''}`, 105, 23, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Tanggal Cetak: ${format(new Date(), 'dd MMMM yyyy HH:mm', { locale: id })}`, 105, 30, { align: 'center' });

        // Add line separator
        doc.setLineWidth(0.5);
        doc.line(15, 35, 195, 35);

        let currentY = 45;

        // Summary Section
        const unpaidAdvances = advances.filter(adv => adv.remainingAmount > 0);
        const totalAmount = unpaidAdvances.reduce((sum, item) => sum + item.amount, 0);
        const totalRemaining = unpaidAdvances.reduce((sum, item) => sum + item.remainingAmount, 0);
        const totalPaid = totalAmount - totalRemaining;

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('RINGKASAN PANJAR (BELUM LUNAS)', 15, currentY);
        currentY += 8;

        const summaryData = [
            ['Total Karyawan dengan Panjar', Array.from(new Set(unpaidAdvances.map(a => a.employeeId))).length.toString()],
            ['Total Transaksi Panjar Belum Lunas', unpaidAdvances.length.toString()],
            ['Total Nilai Panjar Original', formatCurrency(totalAmount)],
            ['Total Telah Dicicil', formatCurrency(totalPaid)],
            ['TOTAL SISA PIUTANG KARYAWAN', formatCurrency(totalRemaining)]
        ];

        autoTable(doc, {
            startY: currentY,
            body: summaryData,
            theme: 'grid',
            styles: { fontSize: 9 },
            columnStyles: {
                0: { cellWidth: 100 },
                1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' }
            }
        });

        currentY = (doc as any).lastAutoTable.finalY + 12;

        // Group by employee to calculate individual totals
        const employeeTotals = unpaidAdvances.reduce((acc, current) => {
            acc[current.employeeName] = (acc[current.employeeName] || 0) + current.remainingAmount;
            return acc;
        }, {} as Record<string, number>);

        // Detail Table
        if (unpaidAdvances.length === 0) {
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text('Tidak ada data panjar yang belum lunas.', 15, currentY);
        } else {
            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text(`DETAIL PANJAR PER KARYAWAN`, 15, currentY);
            currentY += 8;

            // Prepare table data
            const tableData = unpaidAdvances
                .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.getTime() - b.date.getTime())
                .map((adv, idx, arr) => {
                    // Check if this is the first entry for this employee to show the total only once or every time?
                    // Usually showing it on the first row or as a merged cell is better.
                    // For simplicity and clarity, let's show it on every line or just the first of the group.
                    const isFirstInGroup = idx === 0 || arr[idx - 1].employeeName !== adv.employeeName;

                    return [
                        (idx + 1).toString(),
                        adv.employeeName,
                        format(new Date(adv.date), 'dd/MM/yy', { locale: id }),
                        formatCurrency(adv.amount),
                        formatCurrency(adv.remainingAmount),
                        formatCurrency(employeeTotals[adv.employeeName]), // Total for this specific employee
                        adv.notes || '-'
                    ];
                });

            autoTable(doc, {
                startY: currentY,
                head: [['No', 'Karyawan', 'Tanggal', 'Panjar', 'Sisa Cicilan', 'Total Utang (Nama)', 'Catatan']],
                body: tableData,
                theme: 'striped',
                headStyles: {
                    fillColor: [71, 85, 105],
                    textColor: [255, 255, 255],
                    fontSize: 8
                },
                styles: { fontSize: 7 },
                columnStyles: {
                    0: { cellWidth: 8 },
                    1: { cellWidth: 32 },
                    2: { cellWidth: 17 },
                    3: { cellWidth: 23, halign: 'right' },
                    4: { cellWidth: 23, halign: 'right' },
                    5: { cellWidth: 28, halign: 'right', fontStyle: 'bold' },
                    6: { cellWidth: 49 }
                }
            });
        }

        // Footer
        const pageCount = doc.internal.pages.length - 1;
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(
                `Laporan Panjar Karyawan - ${currentBranch?.name || ''}`,
                15, 285
            );
            doc.text(`Halaman ${i} dari ${pageCount}`, 195, 285, { align: 'right' });
        }

        // Action based on type
        if (action === 'print') {
            doc.autoPrint();
            window.open(doc.output('bloburl'), '_blank');
        } else {
            const fileName = `Laporan-Panjar-Karyawan-${format(new Date(), 'yyyy-MM-dd')}.pdf`;
            saveCompressedPDF(doc, fileName, 100);
        }
    };

    const generateExcel = () => {
        const unpaidAdvances = advances.filter(adv => adv.remainingAmount > 0);

        // Group by employee to calculate individual totals
        const employeeTotals = unpaidAdvances.reduce((acc, current) => {
            acc[current.employeeName] = (acc[current.employeeName] || 0) + current.remainingAmount;
            return acc;
        }, {} as Record<string, number>);

        const exportData = unpaidAdvances
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName) || a.date.getTime() - b.date.getTime())
            .map((adv, idx) => ({
                'No': idx + 1,
                'Nama Karyawan': adv.employeeName,
                'Tanggal Panjar': format(new Date(adv.date), 'dd/MM/yyyy', { locale: id }),
                'Total Panjar (Rp)': adv.amount,
                'Sisa Cicilan (Rp)': adv.remainingAmount,
                'Total Sisa Utang (Karyawan)': employeeTotals[adv.employeeName],
                'Akun Sumber': adv.accountName || '-',
                'Catatan': adv.notes || '-',
            }));

        // Summary calculation
        const totalRemaining = unpaidAdvances.reduce((sum, item) => sum + item.remainingAmount, 0);

        const summaryData = [
            {},
            { 'No': 'RINGKASAN TOTAL', 'Nama Karyawan': '', 'Tanggal Panjar': '', 'Total Panjar (Rp)': '', 'Sisa Utang (Rp)': totalRemaining }
        ];

        const ws = XLSX.utils.json_to_sheet([...exportData, ...summaryData]);

        // Set column widths
        ws['!cols'] = [
            { wch: 5 },   // No
            { wch: 25 },  // Nama Karyawan
            { wch: 15 },  // Tanggal Panjar
            { wch: 18 },  // Total Panjar
            { wch: 18 },  // Sisa Utang
            { wch: 20 },  // Akun Sumber
            { wch: 30 },  // Catatan
            { wch: 35 },  // ID Transaksi
        ];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Panjar Karyawan');

        const fileName = `Laporan-Panjar-Karyawan-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat("id-ID", {
            style: "currency",
            currency: "IDR",
            minimumFractionDigits: 0,
        }).format(amount);
    };

    return (
        <div className="flex flex-wrap gap-2">
            <Button onClick={() => generatePDF('download')} variant="outline" size="sm" className="bg-white hover:bg-slate-50 border-slate-200">
                <FileDown className="mr-2 h-4 w-4 text-blue-600" />
                PDF
            </Button>
            <Button onClick={() => generatePDF('print')} variant="outline" size="sm" className="bg-white hover:bg-slate-50 border-slate-200">
                <Printer className="mr-2 h-4 w-4 text-slate-600" />
                Cetak
            </Button>
            <Button onClick={generateExcel} variant="outline" size="sm" className="bg-white hover:bg-slate-50 border-slate-200">
                <FileSpreadsheet className="mr-2 h-4 w-4 text-emerald-600" />
                Excel
            </Button>
        </div>
    );
}
