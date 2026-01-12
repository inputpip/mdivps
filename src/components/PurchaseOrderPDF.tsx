"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { FileDown } from "lucide-react"
import { PurchaseOrder, PurchaseOrderItem } from "@/types/purchaseOrder"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useBranch } from "@/contexts/BranchContext"
import { createCompressedPDF } from "@/utils/pdfUtils"
import { supabase } from "@/integrations/supabase/client"

interface PurchaseOrderPDFProps {
  purchaseOrder: PurchaseOrder
}

export function PurchaseOrderPDF({ purchaseOrder }: PurchaseOrderPDFProps) {
  const { settings } = useCompanySettings()
  const { currentBranch } = useBranch()
  const printRef = React.useRef<HTMLDivElement>(null)
  const [poItems, setPoItems] = React.useState<PurchaseOrderItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = React.useState(false)
  const [isGeneratingPdf, setIsGeneratingPdf] = React.useState(false)
  const [hasLoadedItems, setHasLoadedItems] = React.useState(false)



  const handlePrintPDF = async () => {
    if (!printRef.current) {
      console.error('Print reference not found')
      alert('Error: Tidak dapat menemukan konten untuk dicetak')
      return
    }

    // If items not loaded yet, fetch first and wait for render
    if (!hasLoadedItems) {
      setIsLoadingItems(true)
      try {
        const { data, error } = await supabase
          .from('purchase_order_items')
          .select(`
            id,
            material_id,
            quantity,
            unit_price,
            quantity_received,
            notes,
            materials:material_id (
              name,
              unit
            )
          `)
          .eq('purchase_order_id', purchaseOrder.id)

        let items: PurchaseOrderItem[] = []

        if (error) {
          console.error('Error fetching PO items:', error)
          if (purchaseOrder.materialId) {
            items = [{
              materialId: purchaseOrder.materialId,
              materialName: purchaseOrder.materialName,
              unit: purchaseOrder.unit,
              quantity: purchaseOrder.quantity || 0,
              unitPrice: purchaseOrder.unitPrice || 0,
            }]
          }
        } else if (data && data.length > 0) {
          items = data.map((item: any) => ({
            id: item.id,
            materialId: item.material_id,
            materialName: item.materials?.name,
            unit: item.materials?.unit,
            quantity: item.quantity,
            unitPrice: item.unit_price,
            quantityReceived: item.quantity_received,
            notes: item.notes,
          }))
        } else if (purchaseOrder.materialId) {
          items = [{
            materialId: purchaseOrder.materialId,
            materialName: purchaseOrder.materialName,
            unit: purchaseOrder.unit,
            quantity: purchaseOrder.quantity || 0,
            unitPrice: purchaseOrder.unitPrice || 0,
          }]
        }

        if (items.length === 0) {
          alert('Error: Tidak ada item untuk dicetak')
          setIsLoadingItems(false)
          return
        }

        setPoItems(items)
        setHasLoadedItems(true)
        setIsLoadingItems(false)

        // Wait for React to render the items
        await new Promise(resolve => setTimeout(resolve, 200))
      } catch (error) {
        console.error('Error fetching PO items:', error)
        setIsLoadingItems(false)
        alert('Error: Gagal memuat data item')
        return
      }
    }

    // Check if items are available
    if (poItems.length === 0 && !hasLoadedItems) {
      alert('Error: Tidak ada item untuk dicetak')
      return
    }

    setIsGeneratingPdf(true)

    try {
      await createCompressedPDF(
        printRef.current,
        `PO-${purchaseOrder.id}.pdf`,
        [210, 297], // A4 format
        100 // Max 100KB
      )
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert(`Gagal membuat PDF: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsGeneratingPdf(false)
    }
  }

  return (
    <>
      <Button
        onClick={handlePrintPDF}
        size="sm"
        variant="outline"
        className="gap-2"
        disabled={isLoadingItems || isGeneratingPdf}
      >
        {isGeneratingPdf ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
            Membuat PDF...
          </>
        ) : isLoadingItems ? (
          <>
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />
            Memuat...
          </>
        ) : (
          <>
            <FileDown className="h-4 w-4" />
            Cetak PO
          </>
        )}
      </Button>

      {/* Hidden printable content */}
      <div className="fixed left-0 top-0 -z-50 opacity-0 pointer-events-none">
        <div ref={printRef} className="w-[794px] bg-white p-8" style={{ minHeight: '1122px' }}>
          {/* Header */}
          <div className="flex justify-between items-start mb-8">
            <div>
              {settings?.logo && (
                <img
                  src={settings.logo}
                  alt="Company Logo"
                  className="h-16 w-auto mb-4"
                />
              )}
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {currentBranch?.name || settings?.companyName || 'Nama Perusahaan'}
                </h1>
                <p className="text-sm text-gray-600">
                  {settings?.address || 'Alamat Perusahaan'}
                </p>
                <p className="text-sm text-gray-600">
                  Telp: {settings?.phone || '-'} | Email: {settings?.email || '-'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <h2 className="text-xl font-bold text-gray-900">PURCHASE ORDER</h2>
              <p className="text-sm font-semibold">No. PO: {purchaseOrder.id}</p>
              <p className="text-sm">Tanggal: {format(purchaseOrder.createdAt, "dd MMMM yyyy", { locale: id })}</p>
            </div>
          </div>

          {/* Supplier Info */}
          <div className="grid grid-cols-2 gap-8 mb-8">
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Kepada:</h3>
              <div className="bg-gray-50 p-4 rounded">
                <p className="font-medium">{purchaseOrder.supplierName || 'Supplier'}</p>
                {purchaseOrder.supplierContact && (
                  <p className="text-sm text-gray-600">{purchaseOrder.supplierContact}</p>
                )}
              </div>
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 mb-2">Detail Request:</h3>
              <div className="space-y-1">
                {/* Pemohon removed as requested */}
                {purchaseOrder.expectedDeliveryDate && (
                  <p className="text-sm">
                    Target Kirim: {format(purchaseOrder.expectedDeliveryDate, "dd MMMM yyyy", { locale: id })}
                  </p>
                )}
                <p className="text-sm">Status: {purchaseOrder.status}</p>
              </div>
            </div>
          </div>

          {/* Item Details */}
          <div className="mb-8">
            <h3 className="font-semibold text-gray-900 mb-4">Detail Pembelian:</h3>
            <table className="w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-4 py-2 text-left">No</th>
                  <th className="border border-gray-300 px-4 py-2 text-left">Nama Barang</th>
                  <th className="border border-gray-300 px-4 py-2 text-center">Jumlah</th>
                  <th className="border border-gray-300 px-4 py-2 text-center">Satuan</th>
                  <th className="border border-gray-300 px-4 py-2 text-right">Harga Satuan</th>
                  <th className="border border-gray-300 px-4 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {poItems.length > 0 ? (
                  poItems.map((item, index) => {
                    const itemTotal = item.quantity * item.unitPrice
                    return (
                      <tr key={item.id || index}>
                        <td className="border border-gray-300 px-4 py-2">{index + 1}</td>
                        <td className="border border-gray-300 px-4 py-2">{item.materialName || '-'}</td>
                        <td className="border border-gray-300 px-4 py-2 text-center">{item.quantity}</td>
                        <td className="border border-gray-300 px-4 py-2 text-center">{item.unit || '-'}</td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          Rp {item.unitPrice.toLocaleString('id-ID')}
                        </td>
                        <td className="border border-gray-300 px-4 py-2 text-right">
                          Rp {itemTotal.toLocaleString('id-ID')}
                        </td>
                      </tr>
                    )
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="border border-gray-300 px-4 py-2 text-center text-gray-500">
                      {isLoadingItems ? 'Memuat data...' : 'Tidak ada item'}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                {/* Subtotal */}
                <tr className="bg-gray-50">
                  <td colSpan={5} className="border border-gray-300 px-4 py-2 text-right">
                    Subtotal:
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-right">
                    Rp {(() => {
                      const subtotal = poItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0)
                      return subtotal.toLocaleString('id-ID')
                    })()}
                  </td>
                </tr>
                {/* PPN if applicable */}
                {purchaseOrder.includePpn && (
                  <tr className="bg-gray-50">
                    <td colSpan={5} className="border border-gray-300 px-4 py-2 text-right">
                      PPN 11%:
                    </td>
                    <td className="border border-gray-300 px-4 py-2 text-right">
                      Rp {(purchaseOrder.ppnAmount || 0).toLocaleString('id-ID')}
                    </td>
                  </tr>
                )}
                {/* Grand Total */}
                <tr className="bg-gray-50">
                  <td colSpan={5} className="border border-gray-300 px-4 py-2 text-right font-semibold">
                    GRAND TOTAL:
                  </td>
                  <td className="border border-gray-300 px-4 py-2 text-right font-bold">
                    Rp {(purchaseOrder.totalCost || 0).toLocaleString('id-ID')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Expedition Info */}
          {purchaseOrder.expedition && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Ekspedisi / Pengiriman:</h3>
              <div className="bg-blue-50 p-4 rounded border border-blue-200">
                <p className="text-sm font-medium text-blue-900">{purchaseOrder.expedition}</p>
              </div>
            </div>
          )}

          {/* Notes */}
          {purchaseOrder.notes && (
            <div className="mb-6">
              <h3 className="font-semibold text-gray-900 mb-2">Catatan:</h3>
              <p className="text-sm bg-gray-50 p-4 rounded">{purchaseOrder.notes}</p>
            </div>
          )}

          {/* Terms */}
          <div className="mb-8">
            <h3 className="font-semibold text-gray-900 mb-2">Syarat & Ketentuan:</h3>
            <ul className="text-sm text-gray-700 space-y-1">
              <li>• Barang harus sesuai dengan spesifikasi yang diminta</li>
              <li>• Pengiriman sesuai dengan jadwal yang telah disepakati</li>
              <li>• Pembayaran akan dilakukan setelah barang diterima dengan baik</li>
              <li>• Harap konfirmasi penerimaan PO ini dalam 2 x 24 jam</li>
            </ul>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-3 gap-8 mt-12">
            <div className="text-center">
              <p className="font-semibold mb-16">Diajukan oleh:</p>
              <div className="border-t border-gray-400">
                <p className="mt-2 text-sm">_______________</p>
                <p className="text-xs text-gray-600">Staff</p>
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold mb-16">Disetujui oleh:</p>
              <div className="border-t border-gray-400">
                <p className="mt-2 text-sm">_______________</p>
                <p className="text-xs text-gray-600">Manager</p>
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold mb-16">Supplier:</p>
              <div className="border-t border-gray-400">
                <p className="mt-2 text-sm">_______________</p>
                <p className="text-xs text-gray-600">{purchaseOrder.supplierName}</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-8 pt-4 border-t border-gray-300 text-center">
            <p className="text-xs text-gray-500">
              Dokumen ini dibuat secara elektronik dan sah tanpa tanda tangan basah
            </p>
          </div>
        </div>
      </div>
    </>
  )
}