"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Transaction } from "@/types/transaction"
import { safeFormatDate } from "@/utils/officeTime"
import { Printer, Check, FileDown, Download } from "lucide-react"
import { PrintReceiptDialog } from "@/components/PrintReceiptDialog"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { format, isValid } from "date-fns"
import { id } from "date-fns/locale/id"
import { saveCompressedPDF } from "@/utils/pdfUtils"

// Helper function to safely format date for PDF
function safePdfFormatDate(date: Date | string | null | undefined, formatStr: string): string {
  if (!date) return '-';
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    if (!isValid(dateObj)) return '-';
    return format(dateObj, formatStr, { locale: id });
  } catch {
    return '-';
  }
}

interface DriverPrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction
  onComplete: () => void
}

export function DriverPrintDialog({
  open,
  onOpenChange,
  transaction,
  onComplete
}: DriverPrintDialogProps) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false)
  const [printTemplate, setPrintTemplate] = useState<'receipt' | 'invoice'>('receipt')
  const { settings: companyInfo } = useCompanySettings()

  const handlePrintReceipt = () => {
    setPrintTemplate('receipt')
    setPrintDialogOpen(true)
  }

  // Direct PDF download for invoice (no preview)
  const handleDownloadInvoicePdf = () => {
    if (!transaction) return;
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    const margin = 20;

    // Modern header with blue accent
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, pageWidth, 50, 'F');

    // Company logo and info
    const logoWidth = 35;
    const logoHeight = 14;
    if (companyInfo?.logo) {
      try {
        doc.addImage(companyInfo.logo, 'PNG', margin, 15, logoWidth, logoHeight, undefined, 'FAST');
      } catch (e) { console.error(e); }
    }

    // Company name in white
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20).setFont("helvetica", "bold").text(companyInfo?.name || 'PT. COMPANY NAME', margin + logoWidth + 10, 25);
    doc.setFontSize(10).setFont("helvetica", "normal");
    doc.text(companyInfo?.address || 'Company Address', margin + logoWidth + 10, 32);
    doc.text(companyInfo?.phone || 'Company Phone', margin + logoWidth + 10, 37);
    if (companyInfo?.npwp && transaction.ppnEnabled) {
      doc.text(`NPWP: ${companyInfo.npwp}`, margin + logoWidth + 10, 42);
    }

    // Faktur Penjualan title and info in white
    doc.setFontSize(24).setFont("helvetica", "bold").setTextColor(255, 255, 255);
    doc.text("FAKTUR PENJUALAN", pageWidth - margin, 25, { align: 'right' });
    const orderDate = transaction.orderDate ? new Date(transaction.orderDate) : new Date();
    doc.setFontSize(11).setTextColor(255, 255, 255);
    doc.text(`No: ${transaction.id}`, pageWidth - margin, 33, { align: 'right' });
    doc.text(`Tanggal: ${safePdfFormatDate(orderDate, "d MMMM yyyy")}`, pageWidth - margin, 39, { align: 'right' });

    // Customer info section with background
    let y = 65;
    doc.setTextColor(0, 0, 0);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(margin, y, pageWidth - 2 * margin, 20, 3, 3, 'F');

    doc.setFontSize(10).setFont("helvetica", "bold").setTextColor(59, 130, 246);
    doc.text("DITAGIHKAN KEPADA:", margin + 5, y + 8);
    doc.setFontSize(14).setFont("helvetica", "bold").setTextColor(0, 0, 0);
    doc.text(transaction.customerName, margin + 5, y + 16);
    y += 35;

    const tableData = transaction.items.map(item => [item.product.name, item.quantity, new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(item.price), new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(item.price * item.quantity)]);

    // Professional table
    autoTable(doc, {
      startY: y,
      head: [['Deskripsi Produk', 'Qty', 'Harga Satuan', 'Total']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 11, halign: 'center' },
      bodyStyles: { fontSize: 10, cellPadding: 6 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: { 0: { cellWidth: 70, halign: 'left' }, 1: { cellWidth: 25, halign: 'center' }, 2: { cellWidth: 40, halign: 'right' }, 3: { cellWidth: 45, halign: 'right', fontStyle: 'bold' } },
      margin: { left: margin, right: margin },
      didDrawPage: (data) => {
        doc.setFontSize(8).setTextColor(150);
        doc.text(`Halaman ${data.pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      }
    });

    // Summary section
    const finalY = (doc as any).lastAutoTable.finalY;
    let summaryY = finalY + 15;

    const summaryWidth = 80;
    const summaryX = pageWidth - margin - summaryWidth;
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(summaryX, summaryY - 5, summaryWidth, 35, 3, 3, 'F');

    doc.setFontSize(11).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    doc.text("Subtotal:", summaryX + 5, summaryY + 3);
    doc.text(new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.subtotal), pageWidth - margin - 5, summaryY + 3, { align: 'right' });
    summaryY += 7;

    if (transaction.ppnEnabled) {
      doc.text(`PPN (${transaction.ppnPercentage}%):`, summaryX + 5, summaryY);
      doc.text(new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.ppnAmount), pageWidth - margin - 5, summaryY, { align: 'right' });
      summaryY += 7;
    }

    // Total with blue background
    doc.setFillColor(59, 130, 246);
    doc.roundedRect(summaryX, summaryY, summaryWidth, 12, 3, 3, 'F');
    doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(255, 255, 255);
    doc.text("TOTAL TAGIHAN:", summaryX + 5, summaryY + 8);
    doc.text(new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.total), pageWidth - margin - 5, summaryY + 8, { align: 'right' });
    summaryY += 15;

    // Payment status section
    summaryY += 8;
    const isLunas = transaction.paymentStatus === 'Lunas';
    doc.setFillColor(isLunas ? 209 : 254, isLunas ? 250 : 249, isLunas ? 229 : 195);
    doc.roundedRect(summaryX, summaryY, summaryWidth, 10, 3, 3, 'F');
    doc.setFontSize(10).setFont("helvetica", "bold");
    doc.setTextColor(isLunas ? 22 : 133, isLunas ? 101 : 77, isLunas ? 52 : 14);
    doc.text("STATUS:", summaryX + 5, summaryY + 6);
    doc.text(isLunas ? "LUNAS" : "BELUM LUNAS", pageWidth - margin - 5, summaryY + 6, { align: 'right' });
    summaryY += 12;

    if (!isLunas) {
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10).setFont("helvetica", "normal");
      doc.text("Sudah Dibayar:", summaryX + 5, summaryY + 3);
      doc.text(new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.paidAmount || 0), pageWidth - margin - 5, summaryY + 3, { align: 'right' });
      summaryY += 7;

      doc.setFillColor(254, 226, 226);
      doc.roundedRect(summaryX, summaryY, summaryWidth, 10, 3, 3, 'F');
      doc.setFontSize(10).setFont("helvetica", "bold").setTextColor(185, 28, 28);
      doc.text("SISA BAYAR:", summaryX + 5, summaryY + 6);
      doc.text(new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(transaction.total - (transaction.paidAmount || 0)), pageWidth - margin - 5, summaryY + 6, { align: 'right' });
      summaryY += 12;
    }

    if (transaction.paymentStatus !== 'Lunas' && (transaction.dueDate || (transaction as any).due_date)) {
      doc.setFillColor(254, 226, 226);
      doc.roundedRect(summaryX, summaryY, summaryWidth, 10, 3, 3, 'F');
      doc.setFontSize(10).setFont("helvetica", "bold").setTextColor(185, 28, 28);
      doc.text("JATUH TEMPO:", summaryX + 5, summaryY + 6);
      doc.text(safePdfFormatDate(transaction.dueDate || (transaction as any).due_date, "d MMMM yyyy"), pageWidth - margin - 5, summaryY + 6, { align: 'right' });
      summaryY += 12;
    }

    doc.setTextColor(0);

    // Footer with signature
    let footerY = summaryY + 25;
    doc.setFontSize(9).setFont("helvetica", "normal").setTextColor(100, 100, 100);
    doc.text("Catatan Pembayaran:", margin, footerY);
    doc.text("• Pembayaran dapat dilakukan melalui transfer bank", margin, footerY + 5);
    doc.text("• Harap sertakan nomor faktur penjualan saat melakukan pembayaran", margin, footerY + 10);
    doc.text("• Konfirmasi pembayaran ke nomor telepon di atas", margin, footerY + 15);

    // Signature section
    const sigY = footerY + 30;
    const colWidth = (pageWidth - 2 * margin) / 3;

    doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    doc.text("Penerima,", margin + colWidth / 2, sigY, { align: 'center' });
    doc.line(margin + 10, sigY + 25, margin + colWidth - 10, sigY + 25);
    doc.setFontSize(9).setTextColor(100, 100, 100);
    doc.text("(..............................)", margin + colWidth / 2, sigY + 30, { align: 'center' });

    doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    doc.text("Pengirim,", margin + colWidth + colWidth / 2, sigY, { align: 'center' });
    doc.line(margin + colWidth + 10, sigY + 25, margin + 2 * colWidth - 10, sigY + 25);
    doc.setFontSize(9).setTextColor(100, 100, 100);
    doc.text("(..............................)", margin + colWidth + colWidth / 2, sigY + 30, { align: 'center' });

    doc.setFontSize(10).setFont("helvetica", "normal").setTextColor(0, 0, 0);
    doc.text("Hormat Kami,", margin + 2 * colWidth + colWidth / 2, sigY, { align: 'center' });
    doc.line(margin + 2 * colWidth + 10, sigY + 25, pageWidth - margin - 10, sigY + 25);
    doc.setFontSize(10).setFont("helvetica", "bold").setTextColor(0, 0, 0);
    doc.text((transaction.cashierName || ""), margin + 2 * colWidth + colWidth / 2, sigY + 30, { align: 'center' });

    // Thank you footer
    const thankYouY = pageHeight - 30;
    doc.setFillColor(59, 130, 246);
    doc.rect(0, thankYouY - 5, pageWidth, 20, 'F');
    doc.setFontSize(14).setFont("helvetica", "bold").setTextColor(255, 255, 255);
    doc.text("Terima kasih atas kepercayaan Anda!", pageWidth / 2, thankYouY + 3, { align: 'center' });
    doc.setFontSize(8).setFont("helvetica", "normal");
    doc.text(`Dicetak pada: ${format(new Date(), "d MMMM yyyy, HH:mm", { locale: id })} WIB`, pageWidth / 2, thankYouY + 9, { align: 'center' });

    const filename = `Faktur_Penjualan-${transaction.id}-${format(new Date(), 'yyyyMMdd-HHmmss')}.pdf`;
    saveCompressedPDF(doc, filename, 100);
  }

  const handleComplete = () => {
    onComplete()
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={() => { }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-green-600">
              <Check className="h-5 w-5" />
              Transaksi Berhasil!
            </DialogTitle>
            <DialogDescription>
              Transaksi dan pengantaran berhasil dibuat
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Transaction Summary */}
            <Card className="bg-green-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-green-700">
                  Ringkasan Transaksi
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>No. Transaksi:</span>
                  <span className="font-medium">{transaction.id}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pelanggan:</span>
                  <span className="font-medium">{transaction.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tanggal:</span>
                  <span className="font-medium">
                    {safeFormatDate(transaction.orderDate)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2">
                  <span>Total:</span>
                  <span className="font-bold text-green-600">
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0
                    }).format(transaction.total)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Status:</span>
                  <span className="font-medium text-blue-600">
                    {transaction.paymentStatus} • Siap Diantar
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Print Options */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Printer className="h-4 w-4" />
                  Pilihan Cetak
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handlePrintReceipt}
                  className="w-full justify-start"
                  variant="outline"
                >
                  <FileDown className="h-4 w-4 mr-2" />
                  Cetak Nota (Thermal/Struk)
                </Button>
                <Button
                  onClick={handleDownloadInvoicePdf}
                  className="w-full justify-start"
                  variant="outline"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Faktur PDF (A4)
                </Button>
              </CardContent>
            </Card>

            {/* Success Message */}
            <div className="bg-blue-50 p-4 rounded-lg text-center">
              <Check className="h-8 w-8 text-blue-600 mx-auto mb-2" />
              <p className="text-sm text-blue-800 font-medium">
                Pesanan berhasil dibuat dan siap diantar!
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Data pengantaran telah tercatat dalam sistem
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              onClick={handleComplete}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              <Check className="h-4 w-4 mr-2" />
              Selesai
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Receipt Dialog */}
      <PrintReceiptDialog
        open={printDialogOpen}
        onOpenChange={setPrintDialogOpen}
        transaction={transaction}
        template={printTemplate}
      />
    </>
  )
}