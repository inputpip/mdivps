"use client"
import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "./ui/use-toast"
import { Transaction } from "@/types/transaction"
import { useTransactions } from "@/hooks/useTransactions"
import { useAccounts } from "@/hooks/useAccounts"
import { useAuth } from "@/hooks/useAuth"
import { useBranch } from "@/contexts/BranchContext"
import { useQueryClient } from "@tanstack/react-query"
import { supabase } from "@/integrations/supabase/client"
import { Wallet, Calendar as CalendarIcon } from "lucide-react"
import { useTimezone } from "@/contexts/TimezoneContext"
import { getOfficeDateString } from "@/utils/officeTime"
import { usePermissions } from "@/hooks/usePermissions"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { Calendar } from "./ui/calendar"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"
import { cn } from "@/lib/utils"
// journalService removed - now using RPC for all journal operations

// ============================================================================
// CATATAN PENTING: DOUBLE-ENTRY ACCOUNTING SYSTEM
// ============================================================================
// Semua saldo akun HANYA dihitung dari journal_entries (tidak ada updateAccountBalance)
// Pembayaran piutang menggunakan RPC create_receivable_payment_journal_rpc
// ============================================================================

// Base payment schema - will be refined per transaction
const getPaymentSchema = (maxAmount: number) => z.object({
  amount: z.coerce.number()
    .min(1, "Jumlah pembayaran harus lebih dari 0.")
    .max(maxAmount, `Jumlah pembayaran tidak boleh melebihi sisa tagihan (${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(maxAmount)})`),
  paymentAccountId: z.string().min(1, "Akun pembayaran harus dipilih."),
  paymentDate: z.date({
    required_error: "Tanggal pembayaran harus dipilih.",
  }),
  notes: z.string().optional(),
})

type PaymentFormData = {
  amount: number;
  paymentAccountId: string;
  paymentDate: Date;
  notes?: string;
}

interface PayReceivableDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: Transaction | null
}

export function PayReceivableDialog({ open, onOpenChange, transaction }: PayReceivableDialogProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const { timezone } = useTimezone()
  const { currentBranch } = useBranch()
  const queryClient = useQueryClient()
  const { accounts, getEmployeeCashAccount } = useAccounts()

  const { hasPermission } = usePermissions();

  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const remainingAmount = transaction ? transaction.total - (transaction.paidAmount || 0) : 0

  const canBackdate = hasPermission('receivable_backdate');

  const { register, handleSubmit, reset, setValue, formState: { errors }, watch, trigger } = useForm<PaymentFormData>({
    resolver: zodResolver(getPaymentSchema(remainingAmount)),
    defaultValues: {
      paymentDate: new Date(),
    }
  })

  const watchedDate = watch("paymentDate");

  const watchedAmount = watch("amount")

  // Re-trigger validation when remaining amount changes
  React.useEffect(() => {
    if (watchedAmount) {
      trigger("amount");
    }
  }, [remainingAmount, watchedAmount, trigger]);

  // Auto-select payment account based on logged-in user's assigned cash account
  React.useEffect(() => {
    if (open && user?.id && accounts && accounts.length > 0) {
      const employeeCashAccount = getEmployeeCashAccount(user.id);
      if (employeeCashAccount) {
        setValue("paymentAccountId", employeeCashAccount.id);
        console.log(`[PayReceivable] Auto-selected cash account "${employeeCashAccount.name}" for user ${user.name}`);
      }
    }
  }, [open, user?.id, accounts, setValue, getEmployeeCashAccount]);

  const onSubmit = async (data: PaymentFormData) => {
    if (!transaction || !user) return;
    if (data.amount > remainingAmount) {
      toast({ variant: "destructive", title: "Gagal", description: "Jumlah pembayaran melebihi sisa tagihan." });
      return;
    }

    setIsSubmitting(true);
    try {
      const selectedAccount = accounts?.find(acc => acc.id === data.paymentAccountId);
      if (!selectedAccount) {
        throw new Error("Akun pembayaran tidak ditemukan");
      }

      // ============================================================================
      // Use COMPLETE RPC that handles:
      // 1. Update transaction (paid_amount, payment_status)
      // 2. Insert payment_history
      // 3. Create journal entry (Dr. Kas, Cr. Piutang)
      // ============================================================================
      const { data: resultRaw, error: rpcError } = await supabase.rpc('pay_receivable_complete_rpc', {
        p_transaction_id: transaction.id,
        p_amount: data.amount,
        p_payment_account_id: data.paymentAccountId,
        p_notes: data.notes || null,
        p_branch_id: currentBranch?.id,
        p_recorded_by_name: user.name || user.email || 'Unknown User',
        p_payment_date: format(data.paymentDate, 'yyyy-MM-dd')
      });

      if (rpcError) {
        console.error('❌ Payment RPC Error:', rpcError);
        throw new Error(`Gagal memproses pembayaran: ${rpcError.message}`);
      }

      const result = Array.isArray(resultRaw) ? resultRaw[0] : resultRaw;
      if (!result?.success) {
        throw new Error(result?.error_message || 'Payment failed');
      }

      console.log('✅ Payment Success:', {
        payment_id: result.payment_id,
        journal_id: result.journal_id
      });

      // Invalidate all transaction-related queries to ensure fresh data
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['transactions'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['cashier-recap'] }),
        queryClient.invalidateQueries({ queryKey: ['cashFlow'] }),
        queryClient.invalidateQueries({ queryKey: ['cashBalance'] }),
        queryClient.invalidateQueries({ queryKey: ['paymentHistory'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['journalEntries'] }),
      ]);

      // Force immediate refetch to update UI without waiting for background refetch
      await queryClient.refetchQueries({
        queryKey: ['transactions'],
        type: 'active' // Only refetch currently mounted queries
      });

      toast({
        title: "Sukses",
        description: `Pembayaran piutang sebesar ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(data.amount)} berhasil dicatat ke ${selectedAccount?.name}.`
      });

      reset();
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Gagal",
        description: error instanceof Error ? error.message : "Terjadi kesalahan saat memproses pembayaran"
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bayar Piutang: {transaction?.customerName}</DialogTitle>
          <DialogDescription>
            No. Order: {transaction?.id}. Sisa tagihan: <strong className="text-destructive">{new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(remainingAmount)}</strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <div className="py-4 space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">Jumlah Pembayaran</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setValue("amount", remainingAmount);
                    trigger("amount");
                  }}
                  className="text-xs h-6 px-2"
                >
                  Bayar Penuh
                </Button>
              </div>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="1"
                max={remainingAmount}
                placeholder={`Maksimal: ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(remainingAmount)}`}
                {...register("amount")}
              />
              {errors.amount && <p className="text-sm text-destructive mt-1">{errors.amount.message}</p>}
              {watchedAmount && watchedAmount > remainingAmount && (
                <p className="text-sm text-destructive mt-1">
                  Jumlah melebihi sisa tagihan ({new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR" }).format(remainingAmount)})
                </p>
              )}
              <div>
                <Label htmlFor="paymentDate" className="mb-2 block">Tanggal Pembayaran</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !watchedDate && "text-muted-foreground"
                      )}
                      disabled={!canBackdate}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {watchedDate ? format(watchedDate, "PPP", { locale: id }) : <span>Pilih tanggal</span>}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={watchedDate}
                      onSelect={(date) => setValue("paymentDate", date as Date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                {!canBackdate && <p className="text-[10px] text-muted-foreground mt-1">Anda tidak memiliki izin untuk mengubah tanggal (Backdate).</p>}
                {errors.paymentDate && <p className="text-sm text-destructive mt-1">{errors.paymentDate.message}</p>}
              </div>
              <div>
                <Label htmlFor="paymentAccountId">Setor Ke Akun</Label>
                <Select
                  value={watch("paymentAccountId") || ""}
                  onValueChange={(value) => setValue("paymentAccountId", value)}
                >
                  <SelectTrigger><SelectValue placeholder="Pilih Akun..." /></SelectTrigger>
                  <SelectContent>
                    {accounts?.filter(a => a.isPaymentAccount).map(acc => {
                      const isMyAccount = acc.employeeId === user?.id;
                      return (
                        <SelectItem key={acc.id} value={acc.id}>
                          <Wallet className="inline-block mr-2 h-4 w-4" />
                          {acc.name}
                          {isMyAccount && <span className="text-green-600 font-medium ml-2">(Kas Saya)</span>}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                {errors.paymentAccountId && <p className="text-sm text-destructive mt-1">{errors.paymentAccountId.message}</p>}
              </div>
              <div>
                <Label htmlFor="notes">Catatan (Opsional)</Label>
                <Textarea
                  id="notes"
                  placeholder="Catatan tambahan untuk pembayaran ini..."
                  {...register("notes")}
                  rows={2}
                />
                {errors.notes && <p className="text-sm text-destructive mt-1">{errors.notes.message}</p>}
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Menyimpan..." : "Simpan Pembayaran"}
              </Button>
            </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}