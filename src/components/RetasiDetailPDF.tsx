"use client"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { FileDown } from "lucide-react"
import { Retasi, RetasiItem } from "@/types/retasi"
import { RetasiTransaction } from "@/hooks/useRetasi"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { useCompanySettings } from "@/hooks/useCompanySettings"
import { useBranch } from "@/contexts/BranchContext"
import { createCompressedPDF } from "@/utils/pdfUtils"

interface RetasiDetailPDFProps {
  retasi: Retasi
  items: RetasiItem[]
  transactions: RetasiTransaction[]
  children?: React.ReactNode
}

export function RetasiDetailPDF({ retasi, items, transactions, children }: RetasiDetailPDFProps) {
  const { settings } = useCompanySettings()
  const { currentBranch } = useBranch()
  const printRef = React.useRef<HTMLDivElement>(null)
  const [isGenerating, setIsGenerating] = React.useState(false)

  // Calculate totals
  const totalSold = transactions.reduce((sum, tx) =>
    sum + tx.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
  )
  const totalRevenue = transactions.reduce((sum, tx) => sum + tx.total_amount, 0)
  const selisih = (retasi.total_items || 0) - (retasi.returned_items_count || 0) - (retasi.error_items_count || 0) - (retasi.barang_laku || totalSold)

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(amount)
  }

  const handlePrintPDF = async () => {
    if (!printRef.current || isGenerating) return

    setIsGenerating(true)
    try {
      await createCompressedPDF(
        printRef.current,
        `Retasi-${retasi.retasi_number}-${format(retasi.departure_date, 'ddMMyyyy')}.pdf`,
        [148, 210], // Half A4 size (A5): 148mm x 210mm
        100 // Max 100KB
      )
    } catch (error) {
      console.error('Error generating PDF:', error)
      alert('Gagal membuat PDF: ' + (error as Error).message)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <>
      {children ? (
        <div onClick={handlePrintPDF} className="cursor-pointer">
          {children}
        </div>
      ) : (
        <Button
          onClick={handlePrintPDF}
          size="sm"
          variant="outline"
          className="gap-2"
          disabled={isGenerating}
        >
          <FileDown className="h-4 w-4" />
          {isGenerating ? "Membuat PDF..." : "PDF"}
        </Button>
      )}

      {/* Hidden printable content - Half A4 (A5) size */}
      <div className="fixed -left-[9999px] top-0 z-[-1]">
        <div
          ref={printRef}
          className="bg-white p-4 border"
          style={{
            width: '559px', // 148mm at 96 DPI
            minHeight: '794px', // 210mm at 96 DPI
            fontSize: '11px',
            fontFamily: 'Arial, sans-serif'
          }}
        >
          {/* Header */}
          <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-300">
            <div>
              {settings?.logo && (
                <img
                  src={settings.logo}
                  alt="Logo"
                  className="h-8 w-auto mb-1"
                />
              )}
              <h1 className="text-sm font-bold text-gray-900">
                {currentBranch?.name || settings?.name || 'AQUAVIT'}
              </h1>
              <p className="text-xs text-gray-600">{currentBranch?.phone || settings?.phone || ''}</p>
            </div>
            <div className="text-right">
              <h2 className="text-lg font-bold text-gray-400">RETASI</h2>
              <p className="text-xs"><strong>No:</strong> {retasi.retasi_number}</p>
              <p className="text-xs"><strong>Ke:</strong> {retasi.retasi_ke}</p>
            </div>
          </div>

          {/* Info Section */}
          <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
            <div>
              <p><strong>Supir:</strong> {retasi.driver_name || '-'}</p>
              <p><strong>Helper:</strong> {retasi.helper_name || '-'}</p>
              <p><strong>Berangkat:</strong> {format(retasi.departure_date, 'dd/MM/yyyy', { locale: id })} {retasi.departure_time || ''}</p>
            </div>
            <div>
              <p>
                <strong>Status:</strong>{' '}
                <span className={retasi.is_returned ? 'text-green-600' : 'text-orange-600'}>
                  {retasi.is_returned ? 'Kembali' : 'Berangkat'}
                </span>
              </p>
              {retasi.is_returned && (
                <p><strong>Kembali:</strong> {format(retasi.updated_at, 'dd/MM/yyyy HH:mm', { locale: id })}</p>
              )}
            </div>
          </div>

          {/* Summary Stats */}
          <div className="flex justify-between text-center border rounded p-2 mb-3 bg-gray-50 text-xs">
            <div>
              <p className="text-gray-500">Bawa</p>
              <p className="font-bold text-blue-600">{retasi.total_items || 0}</p>
            </div>
            <div>
              <p className="text-gray-500">Kembali</p>
              <p className="font-bold">{retasi.returned_items_count || 0}</p>
            </div>
            <div>
              <p className="text-gray-500">Error</p>
              <p className="font-bold text-red-600">{retasi.error_items_count || 0}</p>
            </div>
            <div>
              <p className="text-gray-500">Laku</p>
              <p className="font-bold text-green-600">{retasi.barang_laku || totalSold}</p>
            </div>
            <div>
              <p className="text-gray-500">Selisih</p>
              <p className={`font-bold ${selisih >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{selisih}</p>
            </div>
          </div>

          {/* Products Table */}
          <div className="mb-3">
            <h3 className="text-xs font-bold mb-1">Produk Dibawa</h3>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border border-gray-300 px-1 py-0.5 text-left">Produk</th>
                  <th className="border border-gray-300 px-1 py-0.5 text-center w-12">Qty</th>
                </tr>
              </thead>
              <tbody>
                {items.length > 0 ? items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="border border-gray-300 px-1 py-0.5">{item.product_name}</td>
                    <td className="border border-gray-300 px-1 py-0.5 text-center">{item.quantity}</td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={2} className="border border-gray-300 px-1 py-1 text-center text-gray-500">
                      Tidak ada data produk
                    </td>
                  </tr>
                )}
                {items.length > 0 && (
                  <tr className="bg-gray-50 font-bold">
                    <td className="border border-gray-300 px-1 py-0.5">Total</td>
                    <td className="border border-gray-300 px-1 py-0.5 text-center text-blue-600">
                      {items.reduce((sum, item) => sum + item.quantity, 0)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Sales/Transactions */}
          <div className="mb-3">
            <h3 className="text-xs font-bold mb-1">Penjualan ({transactions.length} transaksi)</h3>
            {transactions.length > 0 ? (
              <>
                <table className="w-full border-collapse text-xs mb-1">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border border-gray-300 px-1 py-0.5 text-left">Pelanggan</th>
                      <th className="border border-gray-300 px-1 py-0.5 text-left">Item</th>
                      <th className="border border-gray-300 px-1 py-0.5 text-right w-20">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.slice(0, 10).map((tx) => (
                      <tr key={tx.id}>
                        <td className="border border-gray-300 px-1 py-0.5">
                          {tx.customer_name}
                          <div className="text-gray-500">{format(tx.created_at, 'HH:mm')}</div>
                        </td>
                        <td className="border border-gray-300 px-1 py-0.5">
                          {tx.items.map((item, i) => (
                            <div key={i}>{item.product_name} x{item.quantity}</div>
                          ))}
                        </td>
                        <td className="border border-gray-300 px-1 py-0.5 text-right text-green-600">
                          {formatCurrency(tx.total_amount)}
                        </td>
                      </tr>
                    ))}
                    {transactions.length > 10 && (
                      <tr>
                        <td colSpan={3} className="border border-gray-300 px-1 py-0.5 text-center text-gray-500">
                          ... dan {transactions.length - 10} transaksi lainnya
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <div className="flex justify-between text-xs border-t pt-1">
                  <span>Total Terjual: <strong className="text-green-600">{totalSold} item</strong></span>
                  <span>Total: <strong className="text-green-600">{formatCurrency(totalRevenue)}</strong></span>
                </div>
              </>
            ) : (
              <p className="text-center text-gray-500 border rounded p-2">Belum ada penjualan</p>
            )}
          </div>

          {/* Notes */}
          {(retasi.notes || retasi.return_notes) && (
            <div className="mb-3">
              <h3 className="text-xs font-bold mb-1">Catatan</h3>
              <p className="text-xs bg-gray-50 p-2 rounded border">
                {retasi.return_notes || retasi.notes}
              </p>
            </div>
          )}

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="text-center text-xs">
              <p className="mb-8">Supir</p>
              <div className="border-t border-gray-400 pt-1">
                <p>{retasi.driver_name || '_______________'}</p>
              </div>
            </div>
            <div className="text-center text-xs">
              <p className="mb-8">Checker</p>
              <div className="border-t border-gray-400 pt-1">
                <p>_______________</p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-3 pt-1 border-t text-center text-xs text-gray-500">
            <p>Dicetak: {format(new Date(), "dd/MM/yyyy HH:mm", { locale: id })}</p>
          </div>
        </div>
      </div>
    </>
  )
}
