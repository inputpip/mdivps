"use client"
import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { supabase } from "@/integrations/supabase/client"
import { useAuth } from "@/hooks/useAuth"
import { useBranch } from "@/contexts/BranchContext"
import { useAccounts } from "@/hooks/useAccounts"
import { useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { id as idLocale } from "date-fns/locale"
import { Loader2, Wallet, Receipt, ArrowLeft } from "lucide-react"
import { Customer } from "@/types/customer"

interface UnpaidTransaction {
  id: string
  total: number
  paid_amount: number
  due_date: string | null
  order_date: string
}

interface DriverPayReceivableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  customer: Customer | null
  onSuccess?: () => void
}

export function DriverPayReceivableDialog({
  open,
  onOpenChange,
  customer,
  onSuccess,
}: DriverPayReceivableDialogProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { currentBranch } = useBranch()
  const { getEmployeeCashAccount } = useAccounts()
  const queryClient = useQueryClient()

  const [unpaidList, setUnpaidList] = useState<UnpaidTransaction[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [selectedTx, setSelectedTx] = useState<UnpaidTransaction | null>(null)
  const [payAmount, setPayAmount] = useState<number>(0)

  // Fetch unpaid transactions when dialog opens
  useEffect(() => {
    if (!open || !customer?.id) {
      setUnpaidList([])
      setSelectedTx(null)
      setPayAmount(0)
      return
    }

    const fetchUnpaid = async () => {
      setIsLoading(true)
      try {
        const { data, error } = await supabase
          .from("transactions")
          .select("id, total, paid_amount, due_date, order_date")
          .eq("customer_id", customer.id)
          .eq("payment_status", "Belum Lunas")
          .eq("is_cancelled", false)
          .eq("is_voided", false)
          .order("due_date", { ascending: true })

        if (error) throw error
        setUnpaidList(data || [])
      } catch (err: any) {
        toast({
          variant: "destructive",
          title: "Gagal load piutang",
          description: err.message || "Coba lagi",
        })
      } finally {
        setIsLoading(false)
      }
    }
    fetchUnpaid()
  }, [open, customer?.id, toast])

  const handleSelectTx = (tx: UnpaidTransaction) => {
    setSelectedTx(tx)
    setPayAmount(Number(tx.total) - Number(tx.paid_amount || 0)) // default: bayar penuh
  }

  const handleSubmit = async () => {
    if (!selectedTx || !customer?.id) return
    const sisa = Number(selectedTx.total) - Number(selectedTx.paid_amount || 0)
    if (payAmount <= 0 || payAmount > sisa) {
      toast({ variant: "destructive", title: "Jumlah tidak valid", description: `Maksimal Rp ${sisa.toLocaleString("id-ID")}` })
      return
    }

    // Get driver's cash account (Kas Supir)
    const driverCashAccount = getEmployeeCashAccount?.(user?.id || "")
    if (!driverCashAccount) {
      toast({
        variant: "destructive",
        title: "Akun tidak ditemukan",
        description: "Akun Kas Supir belum di-setup. Hubungi admin.",
      })
      return
    }

    setIsSubmitting(true)
    try {
      // Call RPC pay_receivable_complete_rpc (oid 43666 - signature dengan p_transaction_id)
      const { data, error } = await supabase.rpc("pay_receivable_complete_rpc", {
        p_transaction_id: selectedTx.id,
        p_amount: payAmount,
        p_payment_account_id: driverCashAccount.id,
        p_notes: `Bayar via POS Supir (${user?.name || "driver"})`,
        p_branch_id: currentBranch?.id || null,
        p_user_id: user?.id || null,
        p_recorded_by_name: user?.name || null,
      })

      if (error) throw error

      toast({
        title: "✅ Pelunasan Berhasil",
        description: `Rp ${payAmount.toLocaleString("id-ID")} dibayar untuk ${selectedTx.id}`,
      })

      // Refresh data
      queryClient.invalidateQueries({ queryKey: ["customers"] })
      queryClient.invalidateQueries({ queryKey: ["transactions"] })
      queryClient.invalidateQueries({ queryKey: ["receivables"] })

      onSuccess?.()
      onOpenChange(false)
    } catch (err: any) {
      console.error("Pelunasan error:", err)
      toast({
        variant: "destructive",
        title: "Gagal proses pelunasan",
        description: err.message || "Terjadi error, coba lagi",
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!customer) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5 text-orange-500" />
            Bayar Piutang
          </DialogTitle>
          <DialogDescription>
            Pelanggan: <strong>{customer.name}</strong>
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
          </div>
        ) : selectedTx ? (
          // Form bayar untuk transaksi terpilih
          <div className="space-y-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedTx(null)}
              className="self-start"
            >
              <ArrowLeft className="h-4 w-4 mr-1" /> Pilih piutang lain
            </Button>

            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 rounded-md p-3">
              <div className="text-sm font-medium text-orange-700 dark:text-orange-300">
                Transaksi: {selectedTx.id}
              </div>
              <div className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                {format(new Date(selectedTx.order_date), "dd MMM yyyy", { locale: idLocale })}
                {selectedTx.due_date && ` • JT: ${format(new Date(selectedTx.due_date), "dd MMM yyyy", { locale: idLocale })}`}
              </div>
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-300 mt-2">
                Rp {(Number(selectedTx.total) - Number(selectedTx.paid_amount || 0)).toLocaleString("id-ID")}
              </div>
              <div className="text-xs text-orange-700 dark:text-orange-400">
                Sisa piutang
              </div>
            </div>

            <div>
              <Label htmlFor="payAmount" className="text-base">Jumlah Bayar</Label>
              <Input
                id="payAmount"
                type="number"
                inputMode="numeric"
                min="0"
                max={Number(selectedTx.total) - Number(selectedTx.paid_amount || 0)}
                value={payAmount || ""}
                onChange={(e) => setPayAmount(Math.max(0, parseInt(e.target.value) || 0))}
                className="h-12 text-lg font-bold"
              />
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPayAmount(Number(selectedTx.total) - Number(selectedTx.paid_amount || 0))}
                  className="flex-1"
                >
                  Bayar Penuh
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPayAmount(Math.floor((Number(selectedTx.total) - Number(selectedTx.paid_amount || 0)) / 2))}
                  className="flex-1"
                >
                  Setengah
                </Button>
              </div>
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 rounded-md p-2 text-sm">
              <Wallet className="h-4 w-4 inline mr-1" />
              Diterima ke: <strong>Kas Supir ({user?.name})</strong>
            </div>

            <DialogFooter className="flex-col gap-2 sm:flex-row">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="text-base h-11"
              >
                Batal
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || payAmount <= 0}
                className="text-base h-11 bg-orange-600 hover:bg-orange-700"
              >
                {isSubmitting ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Memproses...</>
                ) : (
                  <>Bayar Rp {payAmount.toLocaleString("id-ID")}</>
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : unpaidList.length === 0 ? (
          <div className="py-8 text-center text-gray-500">
            Tidak ada piutang outstanding untuk pelanggan ini.
          </div>
        ) : (
          // List piutang untuk dipilih
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            <div className="text-sm text-gray-600 dark:text-gray-400">
              Pilih piutang yang mau dibayar:
            </div>
            {unpaidList.map((tx) => {
              const sisa = Number(tx.total) - Number(tx.paid_amount || 0)
              return (
                <button
                  key={tx.id}
                  onClick={() => handleSelectTx(tx)}
                  className="w-full text-left p-3 rounded-md border border-orange-200 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20 hover:bg-orange-100 dark:hover:bg-orange-900/40 transition-colors active:scale-95"
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                        {tx.id}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        {format(new Date(tx.order_date), "dd MMM yyyy", { locale: idLocale })}
                        {tx.due_date && ` • JT: ${format(new Date(tx.due_date), "dd MMM", { locale: idLocale })}`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-bold text-orange-600 dark:text-orange-400">
                        Rp {sisa.toLocaleString("id-ID")}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
