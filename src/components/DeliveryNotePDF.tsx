"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileDown, Printer, Download, Loader2 } from "lucide-react"
import { Delivery, TransactionDeliveryInfo } from "@/types/delivery"
import { format, isValid } from "date-fns"
import { id } from "date-fns/locale/id"

// Helper function to safely format date
function safeFormatDate(date: Date | string | null | undefined, formatStr: string): string {
  if (!date) return '-';
  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    if (!isValid(dateObj)) return '-';
    return format(dateObj, formatStr, { locale: id });
  } catch {
    return '-';
  }
}
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useTransactionDeliveryInfo } from "@/hooks/useDeliveries"
import { useBranch } from "@/contexts/BranchContext"
import { createCompressedPDF } from "@/utils/pdfUtils"
import { useIsMobile } from "@/hooks/use-mobile"

interface DeliveryNotePDFProps {
  delivery: Delivery
  transactionInfo?: TransactionDeliveryInfo
  children?: React.ReactNode
}

export function DeliveryNotePDF({ delivery, transactionInfo, children }: DeliveryNotePDFProps) {
  const { settings } = useCompanySettings()
  const { currentBranch } = useBranch()
  const printRef = React.useRef<HTMLDivElement>(null)
  const dotMatrixRef = React.useRef<HTMLDivElement>(null)
  const [isDialogOpen, setIsDialogOpen] = React.useState(false)
  const isMobile = useIsMobile()

  // Use useTransactionDeliveryInfo to get complete delivery summary with correct remaining quantities
  // Only fetch if transactionInfo is not provided AND the dialog is open (optimization)

  const { data: fetchedTransactionInfo, isLoading } = useTransactionDeliveryInfo(delivery.transactionId, {
    enabled: !transactionInfo && isDialogOpen
  })


  // Prioritize: transactionInfo prop > fetched data (which has deliverySummary)
  const transaction = transactionInfo || fetchedTransactionInfo

  // Generate PDF using browser print dialog (more stable than html2canvas)
  const handlePrintPDF = () => {
    if (!transaction) {
      alert('Data transaksi belum dimuat. Mohon tunggu sebentar.')
      return
    }

    const orderDate = delivery.deliveryDate ? new Date(delivery.deliveryDate) : new Date()

    const formatNumber = (num: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)
    const shortUnit = (unit: string) => {
      const unitMap: Record<string, string> = {
        'Karton': 'Krt', 'karton': 'Krt',
        'Lusin': 'Lsn', 'lusin': 'Lsn',
        'Botol': 'Btl', 'botol': 'Btl',
        'Pieces': 'Pcs', 'pieces': 'Pcs', 'Pcs': 'Pcs', 'pcs': 'Pcs',
      }
      return unitMap[unit] || unit
    }

    const pdfContent = `
      <div style="font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto;">
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #e5e7eb;">
          <div>
            ${settings?.logo ? `<img src="${settings.logo}" alt="Company Logo" style="height: 64px; width: auto; margin-bottom: 16px;" />` : ''}
            <div>
              <h1 style="font-size: 24px; font-weight: bold; color: #111827; margin: 0 0 8px 0;">
                ${currentBranch?.name || settings?.name || 'PT. AQUAVIT'}
              </h1>
              <p style="font-size: 14px; color: #4b5563; margin: 0;">
                ${currentBranch?.address || settings?.address || 'Alamat Perusahaan'}
              </p>
              <p style="font-size: 14px; color: #4b5563; margin: 0;">
                Telp: ${currentBranch?.phone || settings?.phone || '-'}
              </p>
            </div>
          </div>
          <div style="text-align: right;">
            <h2 style="font-size: 30px; font-weight: bold; color: #d1d5db; margin: 0 0 16px 0;">SURAT JALAN</h2>
            <div style="font-size: 14px; color: #4b5563;">
              <p style="margin: 4px 0;"><strong style="color: #1f2937;">No:</strong> ${delivery.transactionId}-${delivery.deliveryNumber}</p>
              <p style="margin: 4px 0;"><strong style="color: #1f2937;">Tanggal:</strong> ${safeFormatDate(orderDate, "d MMMM yyyy")}</p>
              <p style="margin: 4px 0;"><strong style="color: #1f2937;">Jam:</strong> ${safeFormatDate(orderDate, "HH:mm")} WIB</p>
            </div>
          </div>
        </div>

        <!-- Customer & Delivery Info -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-bottom: 32px;">
          <div>
            <h3 style="font-size: 18px; font-weight: 600; color: #111827; margin: 0 0 12px 0;">Dikirim Kepada:</h3>
            <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px;">
              <p style="font-size: 18px; font-weight: bold; color: #111827; margin: 0;">${transaction?.customerName || delivery.customerName || '-'}</p>
              <p style="font-size: 14px; color: #4b5563; margin: 4px 0 0 0;">Customer</p>
            </div>
            ${(transaction?.customerAddress || delivery.customerAddress) ? `<p style="margin-top: 8px; font-size: 14px; color: #4b5563;">${transaction?.customerAddress || delivery.customerAddress}</p>` : ''}
          </div>
          <div style="font-size: 14px;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 8px;">
              <span style="color: #4b5563;">Driver:</span>
              <span style="font-weight: 500; color: #111827;">${delivery.driverName || '-'}</span>
            </div>
            ${delivery.helperName ? `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 8px;">
              <span style="color: #4b5563;">Helper 1:</span>
              <span style="font-weight: 500; color: #111827;">${delivery.helperName}</span>
            </div>` : ''}
            ${delivery.helperName2 ? `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 8px;">
              <span style="color: #4b5563;">Helper 2:</span>
              <span style="font-weight: 500; color: #111827;">${delivery.helperName2}</span>
            </div>` : ''}
            ${delivery.helperName3 ? `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 8px;">
              <span style="color: #4b5563;">Helper 3:</span>
              <span style="font-weight: 500; color: #111827;">${delivery.helperName3}</span>
            </div>` : ''}
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #4b5563;">Status:</span>
              <span style="font-weight: 500; color: #16a34a;">Siap Dikirim</span>
            </div>
          </div>
        </div>

        <!-- Items Table -->
        <div style="margin-bottom: 32px;">
          <h3 style="font-size: 18px; font-weight: 600; color: #111827; margin: 0 0 16px 0;">Daftar Barang</h3>
          <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <thead style="background-color: #f3f4f6;">
              <tr>
                <th style="padding: 12px 16px; text-align: center; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb; width: 60px;">No</th>
                <th style="padding: 12px 16px; text-align: left; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb;">Nama Barang</th>
                <th style="padding: 12px 16px; text-align: center; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb; width: 100px;">Antar</th>
                <th style="padding: 12px 16px; text-align: center; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb; width: 100px;">Satuan</th>
                <th style="padding: 12px 16px; text-align: center; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb; width: 120px;">Total Antar</th>
                <th style="padding: 12px 16px; text-align: center; color: #4b5563; font-weight: 600; border: 1px solid #e5e7eb; width: 100px;">Sisa</th>
              </tr>
            </thead>
            <tbody>
              ${delivery.items.map((item, index) => {
      const itemProductId = item.productId || item.product_id
      const itemProductName = (item.productName || item.product_name || '').toLowerCase()
      const itemIsBonus = !!(item.isBonus || itemProductName.includes('bonus'))
      const deliveryCreatedAt = delivery.createdAt ? new Date(delivery.createdAt).getTime() : Date.now()

      const deliverySummaryItem = transaction?.deliverySummary?.find(ds =>
        (ds.productId === itemProductId || ds.productName?.toLowerCase() === itemProductName) &&
        (!!((ds as any).isBonus || (ds.productName || '').toLowerCase().includes('bonus')) === itemIsBonus)
      )

      const orderedQuantity = item.orderedQuantity || deliverySummaryItem?.orderedQuantity || item.quantityDelivered

      const deliveries = transaction?.deliveries || []
      const cumulativeDeliveredAtThisPoint = deliveries
        .filter(d => {
          const dCreatedAt = d.createdAt ? new Date(d.createdAt).getTime() : 0
          return !isNaN(dCreatedAt) && dCreatedAt <= deliveryCreatedAt
        })
        .reduce((sum, d) => {
          const productItem = d.items.find(di => {
            const diId = di.productId || di.product_id
            const diName = (di.productName || di.product_name || '').toLowerCase()
            const diIsBonus = !!(di.isBonus || diName.includes('bonus'))
            return (diId === itemProductId || diName === itemProductName) &&
              (diIsBonus === itemIsBonus)
          })
          return sum + (productItem?.quantityDelivered || 0)
        }, 0) || item.quantityDelivered

      // Ensure current delivery is counted even if not yet in deliveries array
      const finalTotalAntar = Math.max(cumulativeDeliveredAtThisPoint, item.quantityDelivered)
      const remainingAtThisPoint = orderedQuantity - finalTotalAntar

      // Coloring for remaining
      const remainingColor = remainingAtThisPoint > 0 ? '#ea580c' : remainingAtThisPoint < 0 ? '#dc2626' : '#16a34a';

      return `
                <tr>
                  <td style="padding: 12px 16px; text-align: center; border: 1px solid #e5e7eb; color: #6b7280;">${index + 1}</td>
                  <td style="padding: 12px 16px; border: 1px solid #e5e7eb; font-weight: 500; color: #111827;">${item.productName}</td>
                  <td style="padding: 12px 16px; text-align: center; border: 1px solid #e5e7eb; font-weight: 600; color: #111827;">${formatNumber(item.quantityDelivered)}</td>
                  <td style="padding: 12px 16px; text-align: center; border: 1px solid #e5e7eb; color: #6b7280;">${item.unit}</td>
                  <td style="padding: 12px 16px; text-align: center; border: 1px solid #e5e7eb; font-weight: 600; color: #2563eb;">${formatNumber(finalTotalAntar)}</td>
                  <td style="padding: 12px 16px; text-align: center; border: 1px solid #e5e7eb; font-weight: 600; color: ${remainingColor};">${formatNumber(remainingAtThisPoint)}</td>
                </tr>
                `
    }).join('')}
              <!-- Empty rows to maintain height if needed -->
              ${Array.from({ length: Math.max(0, 5 - delivery.items.length) }).map(() => `
                <tr style="height: 45px;">
                  <td style="border: 1px solid #e5e7eb;"></td>
                  <td style="border: 1px solid #e5e7eb;"></td>
                  <td style="border: 1px solid #e5e7eb;"></td>
                  <td style="border: 1px solid #e5e7eb;"></td>
                  <td style="border: 1px solid #e5e7eb;"></td>
                  <td style="border: 1px solid #e5e7eb;"></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <!-- Notes -->
        <div style="margin-bottom: 48px;">
          <h3 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 8px 0;">Catatan:</h3>
          <div style="background-color: #f9fafb; padding: 16px; border-radius: 8px; border: 1px solid #e5e7eb; min-height: 60px;">
            <p style="font-size: 14px; color: #4b5563; margin: 0;">${delivery.notes || 'Barang sudah diterima dalam kondisi baik dan sesuai pesanan.'}</p>
          </div>
        </div>

        <!-- Signatures -->
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 32px; margin-bottom: 48px; text-align: center;">
          <div>
            <p style="font-size: 14px; color: #4b5563; margin-bottom: 64px;">Supir</p>
            <p style="font-size: 14px; font-weight: 600; color: #111827; border-top: 1px solid #d1d5db; padding-top: 8px; display: inline-block; min-width: 120px;">
              ${delivery.driverName || '..................'}
            </p>
          </div>
          <div>
            <p style="font-size: 14px; color: #4b5563; margin-bottom: 64px;">Kepala Gudang</p>
            <p style="font-size: 14px; font-weight: 600; color: #111827; border-top: 1px solid #d1d5db; padding-top: 8px; display: inline-block; min-width: 120px;">
              ..................
            </p>
          </div>
          <div>
            <p style="font-size: 14px; color: #4b5563; margin-bottom: 64px;">Penerima</p>
            <p style="font-size: 14px; font-weight: 600; color: #111827; border-top: 1px solid #d1d5db; padding-top: 8px; display: inline-block; min-width: 120px;">
              ..................
            </p>
          </div>
        </div>
        
        <!-- Safety Warning Footer -->
        <div style="margin-top: 40px; padding: 16px; background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px;">
          <h4 style="font-size: 14px; font-weight: 600; color: #92400e; margin: 0 0 8px 0;">Ketentuan Penting:</h4>
          <ul style="margin: 0; padding-left: 20px; font-size: 12px; color: #b45309;">
            <li style="margin-bottom: 4px;">Barang yang sudah diterima dan ditandatangani tidak dapat dikembalikan</li>
            <li style="margin-bottom: 4px;">Harap periksa kondisi dan jumlah barang sebelum menandatangani surat jalan</li>
            <li>Simpan surat jalan ini sebagai bukti pengiriman barang</li>
          </ul>
        </div>
      </div>
    `

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Surat Jalan ${delivery.transactionId}-${delivery.deliveryNumber}</title>
            <meta charset="UTF-8">
            <style>
              @page { size: A4; margin: 15mm; }
              @media print {
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
              }
              body { margin: 0; padding: 0; background: white; }
            </style>
          </head>
          <body onload="window.print();">
            ${pdfContent}
          </body>
        </html>
      `)
      printWindow.document.close()
      setIsDialogOpen(false)
    }
  }

  // Cetak Dot Matrix - format sama dengan Faktur di TransactionDetailPage (A5 landscape)
  const handleDotMatrixPrint = () => {
    const orderDate = delivery.deliveryDate ? new Date(delivery.deliveryDate) : new Date()

    // Singkat satuan - sama dengan Faktur
    const shortUnit = (unit: string) => {
      const unitMap: Record<string, string> = {
        'Karton': 'Krt', 'karton': 'Krt',
        'Lusin': 'Lsn', 'lusin': 'Lsn',
        'Botol': 'Btl', 'botol': 'Btl',
        'Pieces': 'Pcs', 'pieces': 'Pcs', 'Pcs': 'Pcs', 'pcs': 'Pcs',
        'Kilogram': 'Kg', 'kilogram': 'Kg',
        'Gram': 'Gr', 'gram': 'Gr',
        'Liter': 'Ltr', 'liter': 'Ltr',
        'Pack': 'Pck', 'pack': 'Pck',
        'Dus': 'Dus', 'dus': 'Dus',
        'Box': 'Box', 'box': 'Box',
        'Unit': 'Unt', 'unit': 'Unt',
      }
      return unitMap[unit] || unit
    }

    const formatNumber = (num: number) => new Intl.NumberFormat("id-ID", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(num)

    // Format sama persis dengan Faktur di TransactionDetailPage
    const dotMatrixContent = `
      <table class="main-table" style="width: 100%; border-collapse: collapse;">
        <!-- Header Row -->
        <tr>
          <td colspan="5" style="border-bottom: 1px solid #000; padding-bottom: 2mm;">
            <table style="width: 100%;">
              <tr>
                <td style="width: 40%; vertical-align: top;">
                  <div style="font-size: 17pt; font-weight: bold;">SURAT JALAN</div>
                  <div style="font-size: 13pt; font-weight: bold;">${currentBranch?.name || settings?.name || ''}</div>
                  <div style="font-size: 11pt;">
                    ${currentBranch?.address || settings?.address || ''}<br/>
                    KANTOR: ${String(currentBranch?.phone || settings?.phone || '').replace(/,/g, '')}${settings?.salesPhone ? ` | SALES: ${String(settings.salesPhone).replace(/,/g, '')}` : ''}
                  </div>
                </td>
                <td style="width: 60%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td width="80">No</td><td>: ${delivery.transactionId}-${delivery.deliveryNumber}</td><td width="50">Driver</td><td>: ${delivery.driverName?.split(' ')[0] || '-'}</td></tr>
                    <tr><td>Tanggal</td><td>: ${safeFormatDate(orderDate, "dd/MM/yy HH:mm")}</td><td>Helper 1</td><td>: ${delivery.helperName?.split(' ')[0] || '-'}</td></tr>
                    ${delivery.helperId2 ? `<tr><td></td><td></td><td>Helper 2</td><td>: ${delivery.helperName2?.split(' ')[0] || '-'}</td></tr>` : ''}
                    ${delivery.helperId3 ? `<tr><td></td><td></td><td>Helper 3</td><td>: ${delivery.helperName3?.split(' ')[0] || '-'}</td></tr>` : ''}
                    <tr><td>Pelanggan</td><td colspan="3">: ${transaction?.customerName || delivery.customerName || '-'}</td></tr>
                    <tr><td>Alamat</td><td colspan="3">: ${transaction?.customerAddress || delivery.customerAddress || '-'}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Table Header -->
        <tr style="border-top: 1.5pt solid #000; border-bottom: 1.5pt solid #000;">
          <th style="padding: 1mm; text-align: left; width: 5%; font-size: 11pt; border-bottom: 1.5pt solid #000;">No</th>
          <th style="padding: 1mm; text-align: left; width: 40%; font-size: 11pt; border-bottom: 1.5pt solid #000;">Nama Item</th>
          <th style="padding: 1mm; text-align: center; width: 20%; font-size: 11pt; border-bottom: 1.5pt solid #000;">Jml Antar</th>
          <th style="padding: 1mm; text-align: center; width: 17%; font-size: 11pt; border-bottom: 1.5pt solid #000;">Total Antar</th>
          <th style="padding: 1mm; text-align: center; width: 18%; font-size: 11pt; border-bottom: 1.5pt solid #000;">Sisa</th>
        </tr>

        <!-- Items -->
        ${delivery.items.map((item, index) => {
      const itemProductId = item.productId || item.product_id
      const itemProductName = (item.productName || item.product_name || '').toLowerCase()
      const itemIsBonus = !!(item.isBonus || itemProductName.includes('bonus'))
      const deliveryCreatedAt = delivery.createdAt ? new Date(delivery.createdAt).getTime() : Date.now()

      const deliverySummaryItem = transaction?.deliverySummary?.find(ds =>
        (ds.productId === itemProductId || ds.productName?.toLowerCase() === itemProductName) &&
        (!!((ds as any).isBonus || (ds.productName || '').toLowerCase().includes('bonus')) === itemIsBonus)
      )

      const orderedQuantity = item.orderedQuantity || deliverySummaryItem?.orderedQuantity || item.quantityDelivered

      const deliveries = transaction?.deliveries || []
      const cumulativeDeliveredAtThisPoint = deliveries
        .filter(d => {
          const dCreatedAt = d.createdAt ? new Date(d.createdAt).getTime() : 0
          return !isNaN(dCreatedAt) && dCreatedAt <= deliveryCreatedAt
        })
        .reduce((sum, d) => {
          const productItem = d.items.find(di => {
            const diId = di.productId || di.product_id
            const diName = (di.productName || di.product_name || '').toLowerCase()
            const diIsBonus = !!(di.isBonus || diName.includes('bonus'))
            return (diId === itemProductId || diName === itemProductName) &&
              (diIsBonus === itemIsBonus)
          })
          return sum + (productItem?.quantityDelivered || 0)
        }, 0) || item.quantityDelivered

      // Ensure current delivery is counted even if not yet in deliveries array
      const finalTotalAntar = Math.max(cumulativeDeliveredAtThisPoint, item.quantityDelivered)
      const remainingAtThisPoint = orderedQuantity - finalTotalAntar
      return `
            <tr>
              <td style="padding: 0.5mm 1mm; font-size: 11pt;">${index + 1}</td>
              <td style="padding: 0.5mm 1mm; font-size: 11pt;">${item.productName}</td>
              <td style="padding: 0.5mm 1mm; text-align: center; font-size: 11pt;">${formatNumber(item.quantityDelivered)} ${shortUnit(item.unit)}</td>
              <td style="padding: 0.5mm 1mm; text-align: center; font-size: 11pt;">${formatNumber(finalTotalAntar)} ${shortUnit(item.unit)}</td>
              <td style="padding: 0.5mm 1mm; text-align: center; font-size: 11pt;">${formatNumber(remainingAtThisPoint)} ${shortUnit(item.unit)}</td>
            </tr>
          `
    }).join('')}

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
                  <div style="font-size: 11pt; margin-bottom: 1mm;">Keterangan: ${delivery.notes || '-'}</div>
                  <table style="width: 90%; margin-top: 3mm;">
                    <tr>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Supir</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(${delivery.driverName || '.................'})</div>
                      </td>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Kepala Gudang</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                      <td style="width: 33%; text-align: center;">
                        <div style="font-size: 11pt;">Pelanggan</div>
                        <div style="height: 12mm;"></div>
                        <div style="font-size: 11pt;">(.................)</div>
                      </td>
                    </tr>
                  </table>
                </td>
                <td style="width: 45%; vertical-align: top; font-size: 11pt;">
                  <table style="width: 100%;">
                    <tr><td>Total Item</td><td style="text-align: right;">:</td><td style="text-align: right; width: 40%;">${delivery.items.length} item</td></tr>
                    <tr><td>Total Qty Antar</td><td style="text-align: right;">:</td><td style="text-align: right;">${formatNumber(delivery.items.reduce((sum, i) => sum + i.quantityDelivered, 0))}</td></tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Warning Footer -->
        <tr>
          <td colspan="5" style="border-top: 1.5pt solid #000; padding-top: 1mm; font-size: 10pt;">
            WAJIB CEK BARANG ANDA SENDIRI SEBELUM BARANG TURUN, KEHILANGAN BUKAN TANGGUNG JAWAB KAMI
          </td>
        </tr>
      </table>
    `

    const printWindow = window.open('', '_blank')
    if (printWindow) {
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Surat Jalan ${delivery.transactionId}-${delivery.deliveryNumber}</title>
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
      `)
      printWindow.document.close()
      setIsDialogOpen(false)
    }
  }

  const handleButtonClick = () => {
    setIsDialogOpen(true)
  }

  return (
    <>
      {children ? (
        <div onClick={handleButtonClick} className="cursor-pointer">
          {children}
        </div>
      ) : (
        <Button
          onClick={() => setIsDialogOpen(true)}
          size="icon"
          variant="outline"
          className="rounded-full shadow-sm hover:shadow-md transition-shadow h-8 w-8"
          title="Cetak Surat Jalan"
        >
          <Printer className="h-4 w-4" />
        </Button>
      )}

      {/* Print Format Selection Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Pilih Format Cetak</DialogTitle>
            <DialogDescription>
              Pilih format cetak untuk surat jalan {delivery.transactionId}-{delivery.deliveryNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            {isLoading || !transaction ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <Loader2 className="h-8 w-8 animate-spin" />
                <p>Memuat data transaksi...</p>
              </div>
            ) : (
              <>

                <Button
                  onClick={handlePrintPDF}
                  className="justify-start gap-3 h-12"
                  variant="outline"
                >
                  <Download className="h-5 w-5" />
                  <div className="text-left">
                    <div className="font-medium">Download PDF</div>
                    <div className="text-xs text-muted-foreground">Format PDF 8.5" x 5.5"</div>
                  </div>
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Hidden printable content - Full A4 size */}
      {transaction && (
        <div className="fixed -left-[9999px] top-0 z-[-1]">
          <div ref={printRef} className="w-[794px] h-auto bg-white p-8 border" style={{ fontSize: '14px', minHeight: '1123px' }}>
            {/* Header */}
            <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-gray-200">
              <div>
                {settings?.logo && (
                  <img
                    src={settings.logo}
                    alt="Company Logo"
                    className="h-16 w-auto mb-4"
                  />
                )}
                <div>
                  <h1 className="text-2xl font-bold text-gray-900 mb-2">
                    {currentBranch?.name || settings?.name || 'PT. AQUAVIT'}
                  </h1>
                  <p className="text-sm text-gray-600">
                    {currentBranch?.address || settings?.address || 'Alamat Perusahaan'}
                  </p>
                  <p className="text-sm text-gray-600">
                    Telp: {currentBranch?.phone || settings?.phone || '-'}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-bold text-gray-300 mb-4">SURAT JALAN</h2>
                <div className="text-sm text-gray-600 space-y-1">
                  <p><strong className="text-gray-800">No:</strong> {delivery.transactionId}-{delivery.deliveryNumber}</p>
                  <p><strong className="text-gray-800">Tanggal:</strong> {safeFormatDate(delivery.deliveryDate, "d MMMM yyyy")}</p>
                  <p><strong className="text-gray-800">Jam:</strong> {safeFormatDate(delivery.deliveryDate, "HH:mm")} WIB</p>
                </div>
              </div>
            </div>

            {/* Customer & Delivery Info */}
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-3">Dikirim Kepada:</h3>
                <div className="bg-gray-50 p-4 rounded-lg">
                  <p className="text-lg font-bold text-gray-900">{transaction.customerName}</p>
                  <p className="text-sm text-gray-600 mt-1">Customer</p>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-gray-200 pb-2">
                  <span className="text-gray-600">Driver:</span>
                  <span className="font-medium text-gray-900">{delivery.driverName || '-'}</span>
                </div>
                {delivery.helperName && (
                  <div className="flex justify-between border-b border-gray-200 pb-2">
                    <span className="text-gray-600">Helper 1:</span>
                    <span className="font-medium text-gray-900">{delivery.helperName}</span>
                  </div>
                )}
                {delivery.helperName2 && (
                  <div className="flex justify-between border-b border-gray-200 pb-2">
                    <span className="text-gray-600">Helper 2:</span>
                    <span className="font-medium text-gray-900">{delivery.helperName2}</span>
                  </div>
                )}
                {delivery.helperName3 && (
                  <div className="flex justify-between border-b border-gray-200 pb-2">
                    <span className="text-gray-600">Helper 3:</span>
                    <span className="font-medium text-gray-900">{delivery.helperName3}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Status:</span>
                  <span className="font-medium text-green-600">Siap Dikirim</span>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Daftar Barang</h3>
              <table className="w-full border-collapse border border-gray-300 text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border border-gray-300 px-4 py-3 text-left text-gray-700 font-semibold">No</th>
                    <th className="border border-gray-300 px-4 py-3 text-left text-gray-700 font-semibold">Nama Barang</th>
                    <th className="border border-gray-300 px-4 py-3 text-center text-gray-700 font-semibold">Antar</th>
                    <th className="border border-gray-300 px-4 py-3 text-center text-gray-700 font-semibold">Satuan</th>
                    <th className="border border-gray-300 px-4 py-3 text-center text-gray-700 font-semibold">Total Antar</th>
                    <th className="border border-gray-300 px-4 py-3 text-center text-gray-700 font-semibold">Sisa</th>
                  </tr>
                </thead>
                <tbody>
                  {delivery.items.map((item, index) => {
                    const itemProductId = item.productId || item.product_id
                    const itemProductName = (item.productName || item.product_name || '').toLowerCase()
                    const itemIsBonus = !!(item.isBonus || itemProductName.includes('bonus'))
                    const deliveryCreatedAt = delivery.createdAt ? new Date(delivery.createdAt).getTime() : Date.now()

                    const deliverySummaryItem = transaction.deliverySummary?.find(ds =>
                      (ds.productId === itemProductId || ds.productName?.toLowerCase() === itemProductName) &&
                      (!!(ds.isBonus || (ds.productName || '').toLowerCase().includes('bonus')) === itemIsBonus)
                    )

                    const orderedQuantity = (item as any).orderedQuantity || deliverySummaryItem?.orderedQuantity || 0

                    const deliveries = transaction.deliveries || []
                    const cumulativeDeliveredAtThisPoint = deliveries
                      .filter(d => {
                        const dCreatedAt = d.createdAt ? new Date(d.createdAt).getTime() : 0
                        return !isNaN(dCreatedAt) && dCreatedAt <= deliveryCreatedAt
                      })
                      .reduce((sum, d) => {
                        const productItem = d.items.find(di => {
                          const diId = di.productId || di.product_id
                          const diName = (di.productName || di.product_name || '').toLowerCase()
                          const diIsBonus = !!(di.isBonus || diName.includes('bonus'))
                          return (diId === itemProductId || diName === itemProductName) &&
                            (diIsBonus === itemIsBonus)
                        })
                        return sum + (productItem?.quantityDelivered || 0)
                      }, 0) || item.quantityDelivered

                    const finalTotalAntar = Math.max(cumulativeDeliveredAtThisPoint, item.quantityDelivered)
                    const remainingAtThisPoint = orderedQuantity - finalTotalAntar

                    return (
                      <tr key={item.id} className="border-b border-gray-200">
                        <td className="border border-gray-300 px-4 py-3 text-center">{index + 1}</td>
                        <td className="border border-gray-300 px-4 py-3 font-medium text-gray-800">{item.productName}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-medium">{item.quantityDelivered}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center text-gray-600">{item.unit}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-medium text-blue-600">{finalTotalAntar}</td>
                        <td className="border border-gray-300 px-4 py-3 text-center font-medium text-orange-600">{remainingAtThisPoint}</td>
                      </tr>
                    )
                  })}
                  {/* Add empty rows to fill space */}
                  {Array.from({ length: Math.max(0, 5 - delivery.items.length) }).map((_, index) => (
                    <tr key={`empty-${index}`}>
                      <td className="border border-gray-300 px-4 py-3 h-12 text-center text-gray-400">{delivery.items.length + index + 1}</td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                      <td className="border border-gray-300 px-4 py-3"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Notes */}
            <div className="mb-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">Catatan:</h3>
              <div className="bg-gray-50 p-4 rounded-lg min-h-[80px] border border-gray-200">
                <p className="text-sm text-gray-700">{delivery.notes || 'Barang sudah diterima dalam kondisi baik dan sesuai pesanan.'}</p>
              </div>
            </div>

            {/* Important Notes */}
            <div className="mb-8">
              <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                <p className="text-sm text-yellow-800 font-semibold mb-2">Ketentuan Penting:</p>
                <ul className="text-sm text-yellow-700 space-y-2">
                  <li>• Barang yang sudah diterima dan ditandatangani tidak dapat dikembalikan</li>
                  <li>• Harap periksa kondisi dan jumlah barang sebelum menandatangani surat jalan</li>
                  <li>• Simpan surat jalan ini sebagai bukti resmi pengiriman barang</li>
                  <li>• Jika ada kerusakan atau kekurangan, harap segera laporkan kepada penanggung jawab</li>
                </ul>
              </div>
            </div>

            {/* Signatures */}
            <div className="grid grid-cols-2 gap-12">
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700 mb-16">Yang Mengirim</p>
                <div className="border-t-2 border-gray-400 pt-3">
                  <p className="text-sm font-medium text-gray-900">{delivery.driverName || '_______________'}</p>
                  <p className="text-sm text-gray-600 mt-1">Driver Pengiriman</p>
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-gray-700 mb-16">Yang Menerima</p>
                <div className="border-t-2 border-gray-400 pt-3">
                  <p className="text-sm font-medium text-gray-900">_______________</p>
                  <p className="text-sm text-gray-600 mt-1">{transaction.customerName}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="mt-8 pt-4 border-t-2 border-gray-300 text-center">
              <div className="text-sm text-gray-500 space-y-1">
                <p>Dicetak pada: {format(new Date(), "d MMMM yyyy, HH:mm", { locale: id })} WIB</p>
                <p>Dokumen ini adalah salinan resmi surat jalan pengiriman barang</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden dot matrix format */}
      {transaction && (
        <div className="fixed -left-[9999px] top-0 z-[-1]">
          <div ref={dotMatrixRef} className="font-mono">
            <div className="flex justify-between items-start mb-2">
              <div className="text-left">
                <h1 className="text-sm font-bold">{currentBranch?.name || settings?.name || 'PT. AQUAVIT'}</h1>
                <p className="text-xs">{currentBranch?.address || settings?.address || 'Alamat Perusahaan'}</p>
                <p className="text-xs">Telp: {currentBranch?.phone || settings?.phone || '-'}</p>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold mb-1">SURAT JALAN</div>
                <div className="text-xs space-y-0.5">
                  <div><strong>No:</strong> {delivery.transactionId}-{delivery.deliveryNumber}</div>
                  <div><strong>Tgl:</strong> {safeFormatDate(delivery.deliveryDate, "dd/MM/yy HH:mm")}</div>
                  <div><strong>Kepada:</strong> {transaction.customerName}</div>
                  <div><strong>Driver:</strong> {delivery.driverName || '-'}</div>
                  {delivery.helperName && (
                    <div><strong>H1:</strong> {delivery.helperName}</div>
                  )}
                  {delivery.helperName2 && (
                    <div><strong>H2:</strong> {delivery.helperName2}</div>
                  )}
                  {delivery.helperName3 && (
                    <div><strong>H3:</strong> {delivery.helperName3}</div>
                  )}
                </div>
              </div>
            </div>

            <div className="border-b border-dashed border-black mb-2"></div>

            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-dashed border-black">
                  <th className="text-left font-normal pb-1">No</th>
                  <th className="text-left font-normal pb-1">Nama Barang</th>
                  <th className="text-right font-normal pb-1">Antar</th>
                  <th className="text-center font-normal pb-1">Sat</th>
                  <th className="text-right font-normal pb-1">Total Antar</th>
                  <th className="text-right font-normal pb-1">Sisa</th>
                </tr>
              </thead>
              <tbody>
                {delivery.items.map((item, index) => {
                  const itemProductId = item.productId || item.product_id
                  const itemProductName = (item.productName || item.product_name || '').toLowerCase()
                  const itemIsBonus = !!(item.isBonus || itemProductName.includes('bonus'))
                  const deliveryCreatedAt = delivery.createdAt ? new Date(delivery.createdAt).getTime() : Date.now()

                  const deliverySummaryItem = transaction.deliverySummary?.find(ds =>
                    (ds.productId === itemProductId || ds.productName?.toLowerCase() === itemProductName) &&
                    (!!(ds.isBonus || (ds.productName || '').toLowerCase().includes('bonus')) === itemIsBonus)
                  )

                  const orderedQuantity = (item as any).orderedQuantity || deliverySummaryItem?.orderedQuantity || 0

                  const deliveries = transaction.deliveries || []
                  const cumulativeDeliveredAtThisPoint = deliveries
                    .filter(d => {
                      const dCreatedAt = d.createdAt ? new Date(d.createdAt).getTime() : 0
                      return !isNaN(dCreatedAt) && dCreatedAt <= deliveryCreatedAt
                    })
                    .reduce((sum, d) => {
                      const productItem = d.items.find(di => {
                        const diId = di.productId || di.product_id
                        const diName = (di.productName || di.product_name || '').toLowerCase()
                        const diIsBonus = !!(di.isBonus || diName.includes('bonus'))
                        return (diId === itemProductId || diName === itemProductName) &&
                          (diIsBonus === itemIsBonus)
                      })
                      return sum + (productItem?.quantityDelivered || 0)
                    }, 0) || item.quantityDelivered

                  const finalTotalAntar = Math.max(cumulativeDeliveredAtThisPoint, item.quantityDelivered)
                  const remainingAtThisPoint = orderedQuantity - finalTotalAntar

                  return (
                    <tr key={item.id}>
                      <td className="pt-1 align-top">{index + 1}</td>
                      <td className="pt-1 align-top">{item.productName}</td>
                      <td className="pt-1 text-right align-top">{item.quantityDelivered}</td>
                      <td className="pt-1 text-center align-top">{item.unit}</td>
                      <td className="pt-1 text-right align-top">{finalTotalAntar}</td>
                      <td className="pt-1 text-right align-top">{remainingAtThisPoint}</td>
                    </tr>
                  )
                })}
                {/* Add empty rows if needed */}
                {delivery.items.length < 5 && Array.from({ length: 5 - delivery.items.length }).map((_, index) => (
                  <tr key={`empty-${index}`}>
                    <td className="pt-1">{delivery.items.length + index + 1}</td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                    <td></td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-2 pt-1 border-t border-dashed border-black text-xs">
              <div><strong>Catatan:</strong> {delivery.notes || 'Barang sudah diterima dalam kondisi baik'}</div>
            </div>

            <div className="flex justify-between mt-3 text-xs">
              <div className="text-center">
                <div className="mb-2">Yang Mengirim</div>
                <div style={{ height: '30px' }}></div>
                <div className="border-t border-black inline-block px-4">
                  <div className="mt-1">{delivery.driverName || '_______________'}</div>
                  <div>Driver</div>
                </div>
              </div>
              <div className="text-center">
                <div className="mb-2">Yang Menerima</div>
                <div style={{ height: '30px' }}></div>
                <div className="border-t border-black inline-block px-4">
                  <div className="mt-1">_______________</div>
                  <div>{transaction.customerName}</div>
                </div>
              </div>
            </div>

            <div className="text-center mt-3 text-xs border-t border-dashed border-black pt-1">
              Dicetak: {format(new Date(), "dd/MM/yy HH:mm", { locale: id })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
