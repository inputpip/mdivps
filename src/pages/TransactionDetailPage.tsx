"use client"
import { useParams, Link, useNavigate, useSearchParams } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ArrowLeft, Printer, FileDown, Calendar, User, Package, CreditCard, Truck, MapPin, Phone } from "lucide-react"
import { useTransactions } from "@/hooks/useTransactions"
import { useTransactionDeliveryInfo } from "@/hooks/useDeliveries"
import { useCustomers } from "@/hooks/useCustomers"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { Skeleton } from "@/components/ui/skeleton"
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { useToast } from "@/components/ui/use-toast"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useState, useEffect } from "react"
import { DeliveryManagement } from "@/components/DeliveryManagement"
import { DeliveryCompletionDialog } from "@/components/DeliveryCompletionDialog"
import { Delivery } from "@/types/delivery"

export default function TransactionDetailPage() {
  const { id: transactionId } = useParams<{ id: string }>()
  const { transactions, isLoading } = useTransactions()
  const { data: deliveryInfo, isLoading: isLoadingDelivery, error: deliveryError } = useTransactionDeliveryInfo(transactionId || '')
  const { customers } = useCustomers()
  const { toast } = useToast()
  const { settings: companyInfo } = useCompanySettings()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [showDeliveryForm, setShowDeliveryForm] = useState(false)

  // Auto-open delivery form if action=delivery
  const action = searchParams.get('action');

  // Use effect to handle auto-opening
  useEffect(() => {
    if (action === 'delivery') {
      setShowDeliveryForm(true);
    }
  }, [action]);
  const [completionDialogOpen, setCompletionDialogOpen] = useState(false)
  const [completedDelivery, setCompletedDelivery] = useState<Delivery | null>(null)
  const [completedTransaction, setCompletedTransaction] = useState<any>(null)

  // Handle delivery completion
  const handleDeliveryCompleted = (delivery: Delivery, transaction: any) => {
    setCompletedDelivery(delivery)
    setCompletedTransaction(transaction)
    setCompletionDialogOpen(true)
    setShowDeliveryForm(false) // Close the form dialog
  }

  const transaction = transactions?.find(t => t.id === transactionId)
  const customer = customers?.find(c => c.id === transaction?.customerId)

  if (!transactionId) {
    return (
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold">ID Transaksi tidak valid</h2>
        <Button asChild>
          <Link to="/transactions">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke Daftar Transaksi
          </Link>
        </Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline">
            <Link to="/transactions">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali
            </Link>
          </Button>
          <div>
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-96 mt-2" />
          </div>
        </div>
        <Card>
          <CardContent className="p-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!transaction) {
    return (
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold">Transaksi tidak ditemukan</h2>
        <p className="text-muted-foreground">
          Transaksi dengan ID {transactionId} tidak dapat ditemukan.
        </p>
        <Button asChild>
          <Link to="/transactions">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke Daftar Transaksi
          </Link>
        </Button>
      </div>
    )
  }

  const getStatusVariant = (status: string) => {
    switch (status) {
      case 'Pesanan Masuk': return 'secondary';
      case 'Siap Antar': return 'default';
      case 'Diantar Sebagian': return 'secondary';
      case 'Selesai': return 'success';
      case 'Dibatalkan': return 'destructive';
      default: return 'outline';
    }
  }

  const getPaymentStatusVariant = (paidAmount: number, total: number) => {
    if (paidAmount === 0) return 'destructive';
    if (paidAmount >= total) return 'success';
    return 'warning';
  }

  const getPaymentStatusText = (paidAmount: number, total: number) => {
    if (paidAmount === 0) return 'Kredit';
    if (paidAmount >= total) return 'Tunai';
    return 'Kredit';
  }

  // Generate PDF Invoice - langsung tanpa dialog
  const handleGenerateInvoicePdf = () => {
    if (!transaction) return;
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    const pageWidth = doc.internal.pageSize.width;
    const margin = 15;

    // Currency formatting function
    const formatCurrency = (amount: number): string => {
      return new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(amount);
    };

    // Add logo with better proportions
    const logoWidth = 25;
    const logoHeight = 20;
    if (companyInfo?.logo) {
      try {
        doc.addImage(companyInfo.logo, 'PNG', margin, 12, logoWidth, logoHeight, undefined, 'FAST');
      } catch (e) { console.error(e); }
    }

    // Company info
    doc.setFontSize(18).setFont("helvetica", "bold").text(companyInfo?.name || '', margin, 32);
    doc.setFontSize(10).setFont("helvetica", "normal").text(companyInfo?.address || '', margin, 38).text(companyInfo?.phone || '', margin, 43);

    if (companyInfo?.npwp && transaction.ppnEnabled) {
      doc.text(`NPWP: ${companyInfo.npwp}`, margin, 48);
      doc.setDrawColor(200).line(margin, 52, pageWidth - margin, 52);
    } else {
      doc.setDrawColor(200).line(margin, 48, pageWidth - margin, 48);
    }

    // Faktur Penjualan header
    doc.setFontSize(18).setFont("helvetica", "bold").setTextColor(150).text("FAKTUR PENJUALAN", pageWidth - margin, 32, { align: 'right' });
    const orderDate = transaction.orderDate ? new Date(transaction.orderDate) : new Date();
    doc.setFontSize(11).setTextColor(0).text(`No: ${transaction.id}`, pageWidth - margin, 38, { align: 'right' }).text(`Tanggal: ${format(orderDate, "d MMMM yyyy", { locale: id })}`, pageWidth - margin, 43, { align: 'right' });

    // Customer info
    let y = 55;
    doc.setFontSize(10).setTextColor(100).text("DITAGIHKAN KEPADA:", margin, y);
    doc.setFontSize(12).setFont("helvetica", "bold").setTextColor(0).text(transaction.customerName, margin, y + 6);
    y += 16;

    // Items table
    const tableData = transaction.items.filter(item => item.product?.name).map(item => [item.product.name, item.quantity, formatCurrency(item.price), formatCurrency(item.price * item.quantity)]);
    autoTable(doc, {
      startY: y,
      head: [['Deskripsi', 'Jumlah', 'Harga Satuan', 'Total']],
      body: tableData,
      theme: 'plain',
      headStyles: { fillColor: [240, 240, 240], textColor: [50, 50, 50], fontStyle: 'bold', fontSize: 10 },
      bodyStyles: { fontSize: 10 },
      columnStyles: { 0: { cellWidth: 80 }, 1: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      didDrawPage: (data) => { doc.setFontSize(8).setTextColor(150).text(`Halaman ${data.pageNumber}`, pageWidth / 2, pageHeight - 10, { align: 'center' }); }
    });

    // Summary
    const finalY = (doc as any).lastAutoTable.finalY;
    let summaryY = finalY + 10;
    doc.setFontSize(10).setFont("helvetica", "normal").text("Subtotal:", 140, summaryY);
    doc.text(formatCurrency(transaction.subtotal), pageWidth - margin, summaryY, { align: 'right' });
    summaryY += 5;

    if (transaction.ppnEnabled) {
      doc.text(`PPN (${transaction.ppnPercentage}%):`, 140, summaryY);
      doc.text(formatCurrency(transaction.ppnAmount), pageWidth - margin, summaryY, { align: 'right' });
      summaryY += 5;
    }

    doc.setDrawColor(200).line(140, summaryY, pageWidth - margin, summaryY);
    summaryY += 7;
    doc.setFontSize(12).setFont("helvetica", "bold").text("TOTAL:", 140, summaryY);
    doc.text(formatCurrency(transaction.total), pageWidth - margin, summaryY, { align: 'right' });
    summaryY += 10;

    // Payment Information
    doc.setDrawColor(200).line(140, summaryY, pageWidth - margin, summaryY);
    summaryY += 7;
    doc.setFontSize(10).setFont("helvetica", "normal").text("Status Pembayaran:", 140, summaryY);
    doc.text(getPaymentStatusText(transaction.paidAmount || 0, transaction.total), pageWidth - margin, summaryY, { align: 'right' });
    summaryY += 5;
    doc.text("Jumlah Dibayar:", 140, summaryY);
    doc.text(formatCurrency(transaction.paidAmount || 0), pageWidth - margin, summaryY, { align: 'right' });
    summaryY += 5;

    if (transaction.total > (transaction.paidAmount || 0)) {
      doc.text("Sisa Tagihan:", 140, summaryY);
      doc.text(formatCurrency(transaction.total - (transaction.paidAmount || 0)), pageWidth - margin, summaryY, { align: 'right' });
      summaryY += 5;
    }

    // Signature
    let signatureY = summaryY + 15;
    doc.setFontSize(12).setFont("helvetica", "normal");
    doc.text("Hormat Kami", margin, signatureY);
    doc.setFontSize(10).setFont("helvetica", "bold");
    doc.text((transaction.cashierName || ""), margin, signatureY + 8);
    doc.setFontSize(10).setFont("helvetica", "normal");
    doc.text("Terima kasih atas kepercayaan Anda.", margin, signatureY + 20);

    const filename = `Faktur_Penjualan-${transaction.id}-${format(new Date(), 'yyyyMMdd-HHmmss')}.pdf`;
    doc.save(filename);
  };

  // Cetak Thermal - langsung print tanpa dialog
  const handleThermalPrint = () => {
    if (!transaction) return;

    // Buat preview content thermal receipt
    const receiptContent = `
      <div class="font-mono w-full max-w-sm mx-auto">
        <header class="text-center mb-2">
          ${companyInfo?.logo ? `<img src="${companyInfo.logo}" alt="Logo" class="mx-auto max-h-6 max-w-12 mb-1 object-contain" />` : ''}
          <h1 class="text-sm font-bold break-words">${companyInfo?.name || 'Nota Transaksi'}</h1>
          <p class="text-xs break-words">${companyInfo?.address || ''}</p>
          <p class="text-xs break-words">${companyInfo?.phone || ''}</p>
        </header>
        <div class="text-xs space-y-0.5 my-2 border-y border-dashed border-black py-1">
          <div class="flex justify-between"><span>No:</span> <strong>${transaction.id}</strong></div>
          <div class="flex justify-between"><span>Tgl:</span> <span>${transaction.orderDate ? format(new Date(transaction.orderDate), "dd/MM/yy HH:mm", { locale: id }) : 'N/A'}</span></div>
          <div class="flex justify-between"><span>Plgn:</span> <span>${transaction.customerName}</span></div>
          <div class="flex justify-between"><span>Kasir:</span> <span>${transaction.cashierName}</span></div>
        </div>
        <div class="w-full text-xs overflow-x-auto">
          <table class="w-full min-w-full">
            <thead>
              <tr class="border-b border-dashed border-black">
                <th class="text-left font-normal pb-1 pr-2">Item</th>
                <th class="text-right font-normal pb-1">Total</th>
              </tr>
            </thead>
            <tbody>
              ${transaction.items.filter(item => item.product?.name).map(item => `
                <tr>
                  <td class="pt-1 align-top pr-2">
                    <div class="break-words">${item.product.name}</div>
                    <div class="whitespace-nowrap">${item.quantity}x @${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(item.price)}</div>
                  </td>
                  <td class="pt-1 text-right align-top whitespace-nowrap">${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(item.price * item.quantity)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
        <div class="mt-2 pt-1 border-t border-dashed border-black text-xs space-y-1">
          <div class="flex justify-between">
            <span>Subtotal:</span>
            <span>${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.subtotal)}</span>
          </div>
          ${transaction.ppnEnabled ? `
            <div class="flex justify-between">
              <span>PPN (${transaction.ppnPercentage}%):</span>
              <span>${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.ppnAmount)}</span>
            </div>
          ` : ''}
          <div class="flex justify-between font-semibold border-t border-dashed border-black pt-1">
            <span>Total:</span>
            <span>${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.total)}</span>
          </div>
          <div class="border-t border-dashed border-black pt-1 space-y-1">
                            <div class="flex justify-between items-center">
                              <span>Status:</span>
                              <span class="text-right break-words">${getPaymentStatusText(transaction.paidAmount || 0, transaction.total)}</span>
                            </div>
            <div class="flex justify-between items-center">
              <span>Jumlah Bayar:</span>
              <span class="text-right whitespace-nowrap">${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.paidAmount || 0)}</span>
            </div>
            ${transaction.total > (transaction.paidAmount || 0) ? `
              <div class="flex justify-between items-center">
                <span>Sisa Tagihan:</span>
                <span class="text-right whitespace-nowrap">${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(transaction.total - (transaction.paidAmount || 0))}</span>
              </div>
            ` : ''}
          </div>
        </div>
        <div class="text-center mt-3 text-xs">
          Terima kasih!
        </div>
      </div>
    `;

    const printWindow = window.open('', '_blank');
    printWindow?.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Cetak Nota Thermal</title>
          <meta charset="UTF-8">
          <style>
            /* Reset dan setup untuk thermal printer */
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            /* Setup halaman untuk thermal 80mm */
            @page {
              size: 80mm auto;
              margin: 0;
            }

            @media print {
              body {
                width: 80mm;
                margin: 0 auto;
              }
            }

            /* Font optimal untuk thermal printer */
            body {
              font-family: 'Courier New', 'Consolas', 'Monaco', monospace;
              font-size: 9pt;
              line-height: 1.3;
              margin: 0;
              padding: 3mm 2mm;
              width: 80mm;
              background: white;
              color: black;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            table {
              width: 100%;
              border-collapse: collapse;
              margin: 2px 0;
            }

            td, th {
              padding: 1px 2px;
              font-size: 8pt;
              vertical-align: top;
            }

            .text-center { text-align: center; }
            .text-right { text-align: right; }
            .text-left { text-align: left; }
            .font-bold { font-weight: bold; }
            .font-normal { font-weight: normal; }
            .border-y {
              border-top: 1px dashed black;
              border-bottom: 1px dashed black;
            }
            .border-b {
              border-bottom: 1px dashed black;
            }
            .border-t {
              border-top: 1px dashed black;
            }
            .py-1 {
              padding-top: 2px;
              padding-bottom: 2px;
            }
            .pt-1 {
              padding-top: 2px;
            }
            .pb-1 {
              padding-bottom: 2px;
            }
            .pr-2 {
              padding-right: 4px;
            }
            .mb-1 {
              margin-bottom: 2px;
            }
            .mb-2 {
              margin-bottom: 4px;
            }
            .mt-2 {
              margin-top: 4px;
            }
            .mt-3 {
              margin-top: 6px;
            }
            .my-2 {
              margin-top: 4px;
              margin-bottom: 4px;
            }
            .mx-auto {
              margin-left: auto;
              margin-right: auto;
            }
            .max-h-6 {
              max-height: 12mm;
            }
            .max-w-12 {
              max-width: 20mm;
            }
            .object-contain {
              object-fit: contain;
              display: block;
            }
            .flex {
              display: flex;
            }
            .justify-between {
              justify-content: space-between;
            }
            .space-y-0\\.5 > * + * {
              margin-top: 1px;
            }
            .space-y-1 > * + * {
              margin-top: 2px;
            }
            .break-words {
              word-break: break-word;
              hyphens: auto;
            }
            .whitespace-nowrap {
              white-space: nowrap;
            }
            .align-top {
              vertical-align: top;
            }
            .w-full {
              width: 100%;
            }
            .min-w-full {
              min-width: 100%;
            }
            .overflow-x-auto {
              overflow-x: auto;
            }
            header h1 {
              font-size: 10pt;
              margin: 1px 0;
              font-weight: bold;
            }
            header p {
              font-size: 8pt;
              margin: 1px 0;
            }

            /* Prevent page breaks */
            table, .flex, .border-y, .border-t {
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body onload="window.print(); window.onafterprint = function(){ window.close(); }">
          ${receiptContent}
        </body>
      </html>
    `);
    printWindow?.document.close();
    printWindow?.focus();
    printWindow?.print();
  };

  // Cetak Dot Matrix - optimal untuk 1/2 A4 (A5: 148mm x 210mm)
  const handleDotMatrixPrint = () => {
    if (!transaction) return;
    const orderDate = transaction.orderDate ? new Date(transaction.orderDate) : null;
    const paidAmount = transaction.paidAmount || 0;
    const remaining = transaction.total - paidAmount;

    const formatNumber = (num: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num);

    // Singkat satuan
    const shortUnit = (unit: string) => {
      const unitMap: Record<string, string> = {
        'Karton': 'Krt',
        'karton': 'Krt',
        'Lusin': 'Lsn',
        'lusin': 'Lsn',
        'Botol': 'Btl',
        'botol': 'Btl',
        'Pieces': 'Pcs',
        'pieces': 'Pcs',
        'Pcs': 'Pcs',
        'pcs': 'Pcs',
        'Kilogram': 'Kg',
        'kilogram': 'Kg',
        'Gram': 'Gr',
        'gram': 'Gr',
        'Liter': 'Ltr',
        'liter': 'Ltr',
        'Pack': 'Pck',
        'pack': 'Pck',
        'Dus': 'Dus',
        'dus': 'Dus',
        'Box': 'Box',
        'box': 'Box',
        'Unit': 'Unt',
        'unit': 'Unt',
      };
      return unitMap[unit] || unit;
    };

    const dotMatrixContent = `
      <table class="main-table" style="width: 100%; border-collapse: collapse;">
        <!-- Header Row -->
        <tr>
          <td colspan="5" style="border-bottom: 1px solid #000; padding-bottom: 2mm;">
            <table style="width: 100%;">
              <tr>
                <td style="width: 40%; vertical-align: top;">
                  <div style="font-size: 17pt; font-weight: bold;">FAKTUR PENJUALAN</div>
                  <div style="font-size: 13pt; font-weight: bold;">${companyInfo?.name || ''}</div>
                  <div style="font-size: 11pt;">
                    ${companyInfo?.address || ''}<br/>
                    KANTOR: ${String(companyInfo?.phone || '').replace(/,/g, '')}${companyInfo?.salesPhone ? ` | SALES: ${String(companyInfo.salesPhone).replace(/,/g, '')}` : ''}
                  </div>
                </td>
                <td style="width: 60%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td width="80">No</td><td>: ${transaction.id}</td><td width="50">SALES</td><td>: ${transaction.cashierName?.split(' ')[0] || 'KANTOR'}</td></tr>
                    <tr><td>Tanggal</td><td>: ${orderDate ? format(orderDate, "dd/MM/yy HH:mm", { locale: id }) : '-'}</td><td>PPN</td><td>: ${transaction.ppnEnabled ? 'Ya' : '-'}</td></tr>
                    <tr><td>Pelanggan</td><td colspan="3">: ${transaction.customerName}</td></tr>
                    <tr><td>Alamat</td><td colspan="3">: ${customer?.address || customer?.full_address || '-'}</td></tr>
                    <tr><td>Telepon</td><td colspan="3">: ${String(customer?.phone || '-').replace(/,/g, '')}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Table Header -->
        <tr style="border-top: 1px solid #000; border-bottom: 1px solid #000;">
          <th style="padding: 1mm; text-align: left; width: 5%; font-size: 11pt;">No</th>
          <th style="padding: 1mm; text-align: left; width: 45%; font-size: 11pt;">Nama Item</th>
          <th style="padding: 1mm; text-align: center; width: 15%; font-size: 11pt;">Jml</th>
          <th style="padding: 1mm; text-align: right; width: 17%; font-size: 11pt;">Harga</th>
          <th style="padding: 1mm; text-align: right; width: 18%; font-size: 11pt;">Total</th>
        </tr>

        <!-- Items -->
        ${transaction.items.filter(item => item.product?.name).map((item, idx) => `
          <tr>
            <td style="padding: 0.5mm 1mm; font-size: 11pt;">${idx + 1}</td>
            <td style="padding: 0.5mm 1mm; font-size: 11pt;">${item.product.name}</td>
            <td style="padding: 0.5mm 1mm; text-align: center; font-size: 11pt;">${formatNumber(item.quantity)} ${shortUnit(item.unit)}</td>
            <td style="padding: 0.5mm 1mm; text-align: right; font-size: 11pt;">${formatNumber(item.price)}</td>
            <td style="padding: 0.5mm 1mm; text-align: right; font-size: 11pt;">${formatNumber(item.price * item.quantity)}</td>
          </tr>
        `).join('')}

        <!-- Spacer row to push footer to bottom -->
        <tr style="height: 100%;">
          <td colspan="5" style="vertical-align: bottom;"></td>
        </tr>

        <!-- Footer -->
        <tr>
          <td colspan="5" style="border-top: 1px solid #000; padding-top: 2mm;">
            <table style="width: 100%;">
              <tr>
                <td style="width: 55%; vertical-align: top;">
                  <div style="font-size: 11pt; margin-bottom: 1mm;">Keterangan:</div>
                  <table style="width: 90%; margin-top: 3mm;">
                    <tr>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Hormat Kami</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Penerima</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                    </tr>
                  </table>
                  <div style="font-size: 10pt; margin-top: 2mm;">
                    ${companyInfo?.bankAccount1 ? `<strong>${companyInfo.bankAccount1}</strong> A.N ${companyInfo?.bankAccountName1 || companyInfo?.name || '-'}` : ''}
                    ${companyInfo?.bankAccount2 ? `<br/><strong>${companyInfo.bankAccount2}</strong> A.N ${companyInfo?.bankAccountName2 || companyInfo?.name || '-'}` : ''}
                    ${companyInfo?.bankAccount3 ? `<br/><strong>${companyInfo.bankAccount3}</strong> A.N ${companyInfo?.bankAccountName3 || companyInfo?.name || '-'}` : ''}
                  </div>
                </td>
                <td style="width: 45%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td>Sub Total</td><td style="text-align: right;">:</td><td style="text-align: right; width: 40%;">${formatNumber(transaction.subtotal)}</td></tr>
                    ${transaction.ppnEnabled && transaction.ppnAmount > 0 ? `<tr><td>PPN (${transaction.ppnPercentage || 11}%)</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(transaction.ppnAmount)}</td></tr>` : ''}
                    <tr><td>Total Akhir</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(transaction.total)}</td></tr>
                    ${paidAmount > 0 ? `<tr><td>Tunai</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(paidAmount)}</td></tr>` : ''}
                    ${remaining > 0 ? `<tr><td>Kredit</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(remaining)}</td></tr>` : ''}
                    ${paidAmount > transaction.total ? `<tr><td>Kembali</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(paidAmount - transaction.total)}</td></tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Warning Footer -->
        <tr>
          <td colspan="5" style="border-top: 1px solid #000; padding-top: 1mm; font-size: 10pt;">
            WAJIB CEK STOK ANDA SENDIRI SEBELUM BARANG TURUN, KEHILANGAN BUKAN TANGGUNG JAWAB KAMI
          </td>
        </tr>
      </table>
    `;

    const printWindow = window.open('', '_blank');
    printWindow?.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Faktur ${transaction.id}</title>
          <meta charset="UTF-8">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold !important; }
            @page { size: A5 landscape; margin: 10mm 5mm 5mm 5mm; }
            @media print {
              html, body { height: 100%; margin: 0; padding: 0; }
            }
            html, body {
              height: 100%;
            }
            body {
              font-family: 'Courier New', Courier, monospace;
              font-weight: bold;
              font-size: 10pt;
              line-height: 1.4;
              padding: 3mm 0 0 0;
              background: white;
              color: black;
              display: flex;
              flex-direction: column;
            }
            .main-table {
              border-collapse: collapse;
              width: 100%;
              height: 100%;
            }
            table { border-collapse: collapse; width: 100%; }
            td, th, div, span, p { font-weight: bold !important; }
          </style>
        </head>
        <body onload="window.print(); window.onafterprint = function(){ window.close(); }">
          ${dotMatrixContent}
        </body>
      </html>
    `);
    printWindow?.document.close();
  };

  // Fungsi cetak Rawbt Thermal - ukuran sesuai setting (58mm atau 80mm)
  const handleRawbtPrint = () => {
    if (!transaction) return;

    const orderDate = transaction.orderDate ? new Date(transaction.orderDate) : null;

    // Lebar karakter berdasarkan setting: 58mm = 32 char, 80mm = 48 char
    const paperWidth = companyInfo?.thermalPrinterWidth || '58mm';
    const charWidth = paperWidth === '80mm' ? 48 : 32;
    const separator = '-'.repeat(charWidth);

    const formatCurrency = (amount: number): string => {
      if (amount === null || amount === undefined || isNaN(amount)) {
        return "Rp 0";
      }
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      let result = new Intl.NumberFormat("id-ID", {
        style: "currency",
        currency: "IDR",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(numAmount);
      result = result.replace(/\u00A0/g, ' ');
      return result;
    };

    const formatNumber = (amount: number): string => {
      if (amount === null || amount === undefined || isNaN(amount)) {
        return "0";
      }
      const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
      let result = new Intl.NumberFormat("id-ID", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(numAmount);
      result = result.replace(/\u00A0/g, ' ');
      return result;
    };

    let receiptText = '';
    receiptText += '\x1B\x40';
    receiptText += '\x1B\x61\x01';
    receiptText += (companyInfo?.name || 'Nota Transaksi') + '\n';
    if (companyInfo?.address) {
      receiptText += companyInfo.address + '\n';
    }
    if (companyInfo?.phone) {
      receiptText += String(companyInfo.phone).replace(/,/g, '') + '\n';
    }
    receiptText += '\x1B\x61\x00';
    receiptText += separator + '\n';
    receiptText += `No: ${transaction.id}\n`;
    receiptText += `Tgl: ${orderDate ? format(orderDate, "dd/MM/yy HH:mm", { locale: id }) : 'N/A'}\n`;
    receiptText += `Plgn: ${transaction.customerName}\n`;
    receiptText += `Kasir: ${transaction.cashierName}\n`;
    receiptText += separator + '\n';

    // Header item dengan lebar dinamis
    if (paperWidth === '80mm') {
      receiptText += 'Item                                    Total\n';
    } else {
      receiptText += 'Item                        Total\n';
    }
    receiptText += separator + '\n';

    transaction.items.filter(item => item.product?.name).forEach((item) => {
      receiptText += item.product.name + '\n';
      const qtyPrice = `${item.quantity}x @${formatNumber(item.price)}`;
      const itemTotal = formatNumber(item.price * item.quantity);
      const spacing = charWidth - qtyPrice.length - itemTotal.length;
      receiptText += qtyPrice + ' '.repeat(Math.max(0, spacing)) + itemTotal + '\n';
    });

    receiptText += separator + '\n';
    const subtotalText = 'Subtotal:';
    const subtotalAmount = formatCurrency(transaction.subtotal);
    const subtotalSpacing = charWidth - subtotalText.length - subtotalAmount.length;
    receiptText += subtotalText + ' '.repeat(Math.max(0, subtotalSpacing)) + subtotalAmount + '\n';

    if (transaction.ppnEnabled) {
      const ppnText = `PPN (${transaction.ppnPercentage}%):`;
      const ppnAmount = formatCurrency(transaction.ppnAmount);
      const ppnSpacing = charWidth - ppnText.length - ppnAmount.length;
      receiptText += ppnText + ' '.repeat(Math.max(0, ppnSpacing)) + ppnAmount + '\n';
    }

    receiptText += separator + '\n';
    const totalText = 'Total:';
    const totalAmount = formatCurrency(transaction.total);
    const totalSpacing = charWidth - totalText.length - totalAmount.length;

    receiptText += '\x1B\x45\x01';
    receiptText += totalText + ' '.repeat(Math.max(0, totalSpacing)) + totalAmount + '\n';
    receiptText += '\x1B\x45\x00';
    receiptText += separator + '\n';

    const statusText = 'Status:';
    const statusValue = getPaymentStatusText(transaction.paidAmount || 0, transaction.total);
    const statusSpacing = charWidth - statusText.length - statusValue.length;
    receiptText += statusText + ' '.repeat(Math.max(0, statusSpacing)) + statusValue + '\n';

    const paidText = 'Jumlah Bayar:';
    const paidAmountFormatted = formatCurrency(transaction.paidAmount || 0);
    const paidSpacing = charWidth - paidText.length - paidAmountFormatted.length;
    receiptText += paidText + ' '.repeat(Math.max(0, paidSpacing)) + paidAmountFormatted + '\n';

    if (transaction.total > (transaction.paidAmount || 0)) {
      const remainingText = 'Sisa Tagihan:';
      const remainingAmount = formatCurrency(transaction.total - (transaction.paidAmount || 0));
      const remainingSpacing = charWidth - remainingText.length - remainingAmount.length;
      receiptText += remainingText + ' '.repeat(Math.max(0, remainingSpacing)) + remainingAmount + '\n';
    }

    receiptText += '\n';
    receiptText += '\x1B\x61\x01';
    receiptText += 'Terima kasih!\n';
    receiptText += '\x1B\x61\x00';
    receiptText += '\n\n\n';
    receiptText += '\x1D\x56\x41';

    const encodedText = encodeURIComponent(receiptText);
    const rawbtUrl = `rawbt:${encodedText}`;

    try {
      window.location.href = rawbtUrl;
    } catch (error) {
      console.error('Failed to open RawBT protocol:', error);
    }

    setTimeout(() => {
      navigate('/transactions');
    }, 500);
  };


  return (
    <div className="space-y-6">
      {/* Mobile and Desktop Header */}
      <div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
        <div className="flex items-center gap-4">
          <Button asChild variant="outline" size="lg" className="px-6">
            <Link to="/transactions">
              <ArrowLeft className="mr-2 h-5 w-5" />
              <span>Kembali</span>
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Detail Transaksi</h1>
            <p className="text-muted-foreground">
              #{transaction.id}
            </p>
          </div>
        </div>

        {/* Action Buttons - Hidden on mobile, shown on desktop */}
        <div className="hidden md:flex gap-2">
          {/* Show delivery button if transaction has delivery info and not office sale */}
          {deliveryInfo && !transaction?.isOfficeSale && (
            <Button
              variant="outline"
              className="bg-green-50 border-green-200 text-green-700 hover:bg-green-100"
              onClick={() => setShowDeliveryForm(true)}
            >
              <Truck className="mr-2 h-4 w-4" />
              Input Pengantaran
            </Button>
          )}
          <Button variant="outline" onClick={handleGenerateInvoicePdf}>
            <FileDown className="mr-2 h-4 w-4" />
            Simpan PDF
          </Button>
          <Button variant="outline" onClick={handleThermalPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Cetak Thermal
          </Button>
          <Button variant="outline" onClick={handleDotMatrixPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Cetak Dot Matrix
          </Button>
          <Button onClick={handleRawbtPrint}>
            <Printer className="mr-2 h-4 w-4" />
            Rawbt Thermal
          </Button>
        </div>
      </div>

      {/* Mobile Actions - Sticky at top (hanya tampilkan thermal/RawBT) */}
      <div className="md:hidden sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b border-border/40 -mx-6 px-6 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {/* Show delivery button if transaction has delivery info and not office sale */}
          {deliveryInfo && !transaction?.isOfficeSale && (
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0 bg-green-50 border-green-200 text-green-700"
              onClick={() => setShowDeliveryForm(true)}
            >
              <Truck className="mr-2 h-4 w-4" />
              Antar
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 bg-blue-600 hover:bg-blue-700"
            onClick={handleRawbtPrint}
          >
            <Printer className="mr-1 h-3 w-3" />
            <span className="text-xs">Cetak Thermal</span>
          </Button>
        </div>
      </div>

      {/* Transaction Info Cards - Mobile optimized */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Status Order</CardTitle>
            <Package className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-1 md:pt-0">
            <Badge variant={getStatusVariant(transaction.status)} className="text-xs">
              {transaction.status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Status Bayar</CardTitle>
            <CreditCard className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-1 md:pt-0">
            <Badge variant={getPaymentStatusVariant(transaction.paidAmount || 0, transaction.total)} className="text-xs">
              {getPaymentStatusText(transaction.paidAmount || 0, transaction.total)}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Total</CardTitle>
            <CreditCard className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-1 md:pt-0">
            <div className="text-lg md:text-2xl font-bold">
              {new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(transaction.total)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 md:pb-2">
            <CardTitle className="text-xs md:text-sm font-medium">Sisa</CardTitle>
            <CreditCard className="h-3 w-3 md:h-4 md:w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="pt-1 md:pt-0">
            <div className="text-lg md:text-2xl font-bold text-red-600">
              {new Intl.NumberFormat("id-ID", {
                style: "currency",
                currency: "IDR",
                minimumFractionDigits: 0,
              }).format(Math.max(0, transaction.total - (transaction.paidAmount || 0)))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content - Mobile optimized */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left Column - Transaction Details */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Transaksi</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 md:space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Tanggal Order</p>
                    <p className="text-sm text-muted-foreground">
                      {transaction.orderDate ? format(new Date(transaction.orderDate), "d MMMM yyyy, HH:mm", { locale: id }) : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Target Selesai</p>
                    <p className="text-sm text-muted-foreground">
                      {transaction.finishDate ? format(new Date(transaction.finishDate), "d MMMM yyyy, HH:mm", { locale: id }) : 'Belum ditentukan'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Kasir</p>
                    <p className="text-sm text-muted-foreground">{transaction.cashierName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">Pelanggan</p>
                    <p className="text-sm text-muted-foreground">{transaction.customerName}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Items Table - Mobile optimized */}
          <Card>
            <CardHeader>
              <CardTitle>Detail Produk</CardTitle>
            </CardHeader>
            <CardContent>
              {/* Mobile View - Card List */}
              <div className="md:hidden space-y-3">
                {transaction.items.filter(item => item.product?.id).map((item, index) => (
                  <Card key={index} className="p-3">
                    <div className="space-y-2">
                      <div className="flex justify-between items-start">
                        <div className="flex-1">
                          <Link
                            to={`/products/${item.product.id}`}
                            className="font-medium text-sm text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {item.product.name}
                          </Link>
                          {item.notes && (
                            <p className="text-xs text-muted-foreground">{item.notes}</p>
                          )}
                        </div>
                        <div className="text-right ml-2">
                          <p className="font-medium text-sm">
                            {new Intl.NumberFormat("id-ID", {
                              style: "currency",
                              currency: "IDR",
                              minimumFractionDigits: 0,
                            }).format(item.price * item.quantity)}
                          </p>
                        </div>
                      </div>
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>{item.quantity} {item.unit}</span>
                        <span>@{new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                          minimumFractionDigits: 0,
                        }).format(item.price)}</span>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Desktop View - Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Produk</TableHead>
                      <TableHead className="text-center">Qty</TableHead>
                      <TableHead className="text-right">Harga Satuan</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transaction.items.filter(item => item.product?.id).map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div>
                            <Link
                              to={`/products/${item.product.id}`}
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              {item.product.name}
                            </Link>
                            {item.notes && (
                              <p className="text-sm text-muted-foreground">{item.notes}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          {item.quantity} {item.unit}
                        </TableCell>
                        <TableCell className="text-right">
                          {new Intl.NumberFormat("id-ID", {
                            style: "currency",
                            currency: "IDR",
                            minimumFractionDigits: 0,
                          }).format(item.price)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {new Intl.NumberFormat("id-ID", {
                            style: "currency",
                            currency: "IDR",
                            minimumFractionDigits: 0,
                          }).format(item.price * item.quantity)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Separator className="my-4" />

              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span>
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    }).format(transaction.subtotal)}
                  </span>
                </div>

                {transaction.ppnEnabled && (
                  <div className="flex justify-between">
                    <span>PPN ({transaction.ppnPercentage}%):</span>
                    <span>
                      {new Intl.NumberFormat("id-ID", {
                        style: "currency",
                        currency: "IDR",
                        minimumFractionDigits: 0,
                      }).format(transaction.ppnAmount)}
                    </span>
                  </div>
                )}

                <div className="flex justify-between font-semibold text-lg">
                  <span>Total:</span>
                  <span>
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    }).format(transaction.total)}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column - Payment Info */}
        <div className="space-y-4 md:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Pembayaran</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm">Total Tagihan:</span>
                  <span className="text-sm font-medium">
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    }).format(transaction.total)}
                  </span>
                </div>

                <div className="flex justify-between">
                  <span className="text-sm">Sudah Dibayar:</span>
                  <span className="text-sm font-medium text-green-600">
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    }).format(transaction.paidAmount || 0)}
                  </span>
                </div>

                <Separator />

                <div className="flex justify-between">
                  <span className="font-medium">Sisa Tagihan:</span>
                  <span className={`font-bold ${(transaction.total - (transaction.paidAmount || 0)) > 0 ? 'text-red-600' : 'text-green-600'
                    }`}>
                    {new Intl.NumberFormat("id-ID", {
                      style: "currency",
                      currency: "IDR",
                      minimumFractionDigits: 0,
                    }).format(Math.max(0, transaction.total - (transaction.paidAmount || 0)))}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Customer Address Card */}
          <Card>
            <CardHeader>
              <CardTitle>Alamat Pelanggan</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-start gap-2">
                <User className="h-4 w-4 text-muted-foreground mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{transaction.customerName}</p>
                </div>
              </div>

              {customer?.phone && (
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">{customer.phone}</p>
                  </div>
                </div>
              )}

              {(customer?.full_address || customer?.address) && (
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="text-sm text-muted-foreground">
                      {customer.full_address || customer.address}
                    </p>
                  </div>
                </div>
              )}

              {!customer && (
                <p className="text-sm text-muted-foreground italic">
                  Data pelanggan tidak ditemukan
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Delivery Management Section */}
      {showDeliveryForm && deliveryInfo && (
        <div className="mt-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Input Pengantaran</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeliveryForm(false)}
                >
                  Tutup
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DeliveryManagement
                transaction={deliveryInfo}
                defaultOpen={action === 'delivery'}
                onClose={() => {
                  setShowDeliveryForm(false)
                  // Refresh data when delivery is updated
                  window.location.reload()
                }}
                onDeliveryCreated={handleDeliveryCompleted}
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Delivery Completion Dialog */}
      <DeliveryCompletionDialog
        open={completionDialogOpen}
        onOpenChange={setCompletionDialogOpen}
        delivery={completedDelivery}
        transaction={completedTransaction}
      />

      {/* Mobile Floating Print Button - Alternative option */}
      <div className="md:hidden fixed bottom-6 right-4 z-20">
        <div className="flex flex-col gap-2">
          <Button
            size="lg"
            className="rounded-full shadow-lg"
            onClick={handleThermalPrint}
          >
            <Printer className="h-5 w-5" />
          </Button>
        </div>
      </div>

    </div>
  )
}
