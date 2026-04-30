"use client"

import { useState, useEffect } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useEmployees } from "@/hooks/useEmployees"
import { useAccounts } from "@/hooks/useAccounts"
import { usePayrollRecords } from "@/hooks/usePayroll"
import { PayrollCalculation } from "@/types/payroll"
import { Calculator, DollarSign, AlertTriangle, Users, CreditCard, Check, ChevronsUpDown } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"

interface PayrollRecordDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  selectedYear: number
  selectedMonth: number
}

export function PayrollRecordDialog({
  isOpen,
  onOpenChange,
  selectedYear,
  selectedMonth
}: PayrollRecordDialogProps) {
  const { toast } = useToast()
  const { employees } = useEmployees()
  const { accounts } = useAccounts()
  const { calculatePayroll, createPayrollRecord, payrollRecords: existingRecords } = usePayrollRecords({
    year: selectedYear,
    month: selectedMonth
  })

  // Filter employees who already have a payroll record for this period
  const existingEmployeeIds = new Set(existingRecords?.map(record => record.employeeId) || [])
  const availableEmployees = employees?.filter(emp => !existingEmployeeIds.has(emp.id))


  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("")
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false)
  const [calculation, setCalculation] = useState<PayrollCalculation | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // Form fields that can be adjusted
  const [bonusAmount, setBonusAmount] = useState(0)
  const [salaryDeduction, setSalaryDeduction] = useState(0) // Potongan gaji (keterlambatan, absensi, dll)
  const [salaryDeductionReason, setSalaryDeductionReason] = useState("") // Alasan potongan
  const [customAdvanceDeduction, setCustomAdvanceDeduction] = useState<number>(0) // Default 0, not auto
  const [paymentAccountId, setPaymentAccountId] = useState<string>("")
  const [notes, setNotes] = useState("")

  // Get payment accounts (accounts with isPaymentAccount = true)
  const cashAccounts = accounts?.filter(acc => acc.isPaymentAccount === true)

  // Debug logging (removed to reduce console spam)

  const handleCalculate = async () => {
    if (!selectedEmployeeId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Pilih karyawan terlebih dahulu"
      })
      return
    }

    setIsCalculating(true)

    try {
      const result = await calculatePayroll.mutateAsync({
        employeeId: selectedEmployeeId,
        year: selectedYear,
        month: selectedMonth
      })

      setCalculation(result)
      setBonusAmount(result.bonusAmount || result.bonus_amount || 0)

      toast({
        title: "Berhasil",
        description: "Gaji berhasil dihitung"
      })
    } catch (error: any) {
      console.error('Calculation error:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menghitung gaji"
      })
    } finally {
      setIsCalculating(false)
    }
  }

  const handleCreate = async () => {
    if (!calculation || !paymentAccountId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Lengkapi semua field yang diperlukan"
      })
      return
    }

    setIsCreating(true)
    try {
      // Combine notes with salary deduction reason if any
      const finalNotes = salaryDeduction > 0 && salaryDeductionReason
        ? `${notes}${notes ? '\n' : ''}Potongan Gaji: ${salaryDeductionReason}`
        : notes

      await createPayrollRecord.mutateAsync({
        employeeId: calculation.employeeId,
        periodYear: calculation.periodYear,
        periodMonth: calculation.periodMonth,
        baseSalaryAmount: calculation.baseSalary,
        commissionAmount: calculation.commissionAmount,
        bonusAmount: bonusAmount,
        deductionAmount: actualAdvanceDeduct, // Custom or auto-calculated advance deduction
        salaryDeduction: salaryDeduction, // Potongan gaji tambahan
        paymentAccountId,
        notes: finalNotes
      })

      toast({
        title: "Sukses",
        description: "Record payroll berhasil dibuat"
      })

      // Reset form
      setSelectedEmployeeId("")
      setCalculation(null)
      setBonusAmount(0)
      setSalaryDeduction(0)
      setSalaryDeductionReason("")
      setCustomAdvanceDeduction(0) // Reset to default 0
      setPaymentAccountId("")
      setNotes("")
      onOpenChange(false)
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal membuat record payroll"
      })
    } finally {
      setIsCreating(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  // Recalculate when bonus or advance deduction changes
  // RPC may return snake_case, so we cast to any for fallback access
  const calcAny = calculation as any
  const baseSal = calculation?.baseSalary || calcAny?.base_salary || 0
  const commissionAmt = calculation?.commissionAmount || calcAny?.commission_amount || 0
  const maxAdvanceDeduct = calculation?.advanceDeduction || calcAny?.advance_deduction || 0

  // Always use custom advance deduction (default 0, user can change)
  const actualAdvanceDeduct = Math.max(0, customAdvanceDeduction) // Ensure no negative values

  const recalculatedGross = calculation ? baseSal + commissionAmt + bonusAmount : 0
  const totalDeductions = actualAdvanceDeduct + salaryDeduction // Total potongan = potong panjar + potong gaji
  const recalculatedNet = calculation ? recalculatedGross - totalDeductions : 0

  const selectedEmployee = employees?.find(emp => emp.id === selectedEmployeeId)
  const paymentAccount = accounts?.find(acc => acc.id === paymentAccountId)

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Buat Record Payroll - {new Date(selectedYear, selectedMonth - 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
          </DialogTitle>
          <DialogDescription>
            Pilih karyawan dan hitung gaji dengan pemotongan panjar otomatis
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Section */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Pilih Karyawan</Label>
              <Popover open={employeePickerOpen} onOpenChange={setEmployeePickerOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={employeePickerOpen}
                    className="w-full justify-between font-normal"
                  >
                    {selectedEmployeeId
                      ? availableEmployees?.find((employee) => employee.id === selectedEmployeeId)?.name || "Pilih karyawan..."
                      : "Pilih karyawan..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                  <Command>
                    <CommandInput placeholder="Ketik nama karyawan..." />
                    <CommandList>
                      <CommandEmpty>Tidak ada karyawan ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {availableEmployees?.map((employee) => (
                          <CommandItem
                            key={employee.id}
                            value={`${employee.name} ${employee.role}`}
                            onSelect={() => {
                              setSelectedEmployeeId(employee.id)
                              setEmployeePickerOpen(false)
                            }}
                            className="flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Check
                                className={cn(
                                  "h-4 w-4",
                                  selectedEmployeeId === employee.id ? "opacity-100" : "opacity-0"
                                )}
                              />
                              <span className="truncate">{employee.name}</span>
                            </div>
                            <Badge variant="outline">{employee.role}</Badge>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {availableEmployees?.length === 0 && (
                <p className="text-sm text-muted-foreground">Semua karyawan sudah digaji bulan ini</p>
              )}
            </div>

            <Button
              onClick={handleCalculate}
              disabled={!selectedEmployeeId || isCalculating}
              className="w-full"
            >
              <Calculator className="h-4 w-4 mr-2" />
              {isCalculating ? "Menghitung..." : "Hitung Gaji"}
            </Button>

            {calculation && (
              <>
                <Separator />

                <div className="space-y-2">
                  <Label htmlFor="bonusAmount">Bonus Tambahan</Label>
                  <Input
                    id="bonusAmount"
                    type="number"
                    value={bonusAmount}
                    onChange={(e) => setBonusAmount(Number(e.target.value) || 0)}
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="salaryDeduction">Potongan Gaji</Label>
                  <Input
                    id="salaryDeduction"
                    type="number"
                    value={salaryDeduction}
                    onChange={(e) => setSalaryDeduction(Number(e.target.value) || 0)}
                    placeholder="0"
                    min={0}
                  />
                  {salaryDeduction > 0 && (
                    <Input
                      id="salaryDeductionReason"
                      value={salaryDeductionReason}
                      onChange={(e) => setSalaryDeductionReason(e.target.value)}
                      placeholder="Alasan potongan (keterlambatan, absensi, dll)"
                      className="mt-2"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">
                    Potongan gaji untuk keterlambatan, absensi, atau potongan lainnya
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="advanceDeduction">Potong Panjar (Opsional)</Label>
                  <Input
                    id="advanceDeduction"
                    type="number"
                    value={customAdvanceDeduction}
                    onChange={(e) => {
                      const value = Number(e.target.value) || 0
                      setCustomAdvanceDeduction(value)
                    }}
                    placeholder="0"
                    max={maxAdvanceDeduct}
                    min={0}
                  />
                  <p className="text-xs text-muted-foreground">
                    {maxAdvanceDeduct > 0 ? (
                      <>Default 0 (tidak potong). Maksimal bisa potong: {formatCurrency(maxAdvanceDeduct)}</>
                    ) : (
                      'Karyawan tidak memiliki panjar outstanding'
                    )}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Akun Pembayaran</Label>
                  <Select value={paymentAccountId} onValueChange={setPaymentAccountId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih akun pembayaran..." />
                    </SelectTrigger>
                    <SelectContent>
                      {cashAccounts?.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          <div className="flex items-center gap-2">
                            <CreditCard className="h-4 w-4" />
                            <span>{account.name}</span>
                            <span className={account.balance < 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                              {formatCurrency(account.balance)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="payrollNotes">Catatan</Label>
                  <Textarea
                    id="payrollNotes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Catatan tambahan..."
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>

          {/* Calculation Result Section */}
          <div className="space-y-4">
            {selectedEmployee && !calculation && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Users className="h-4 w-4" />
                    Karyawan Dipilih
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div><strong>Nama:</strong> {selectedEmployee.name}</div>
                    <div><strong>Email:</strong> {selectedEmployee.email}</div>
                    <div><strong>Jabatan:</strong> {selectedEmployee.role}</div>
                    <div><strong>Status:</strong> <Badge variant="outline">{selectedEmployee.status}</Badge></div>
                  </div>
                </CardContent>
              </Card>
            )}

            {calculation && (
              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4" />
                      Rincian Gaji
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span>Gaji Pokok:</span>
                      <span className="font-medium">
                        {formatCurrency(baseSal)}
                        <small className="text-muted-foreground ml-2">
                          ({baseSal})
                        </small>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Komisi:</span>
                      <span className="font-medium text-green-600">
                        {formatCurrency(commissionAmt)}
                        <small className="text-muted-foreground ml-2">
                          ({commissionAmt})
                        </small>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Bonus:</span>
                      <span className="font-medium text-blue-600">
                        {formatCurrency(bonusAmount)}
                        <small className="text-muted-foreground ml-2">({bonusAmount})</small>
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-medium">
                      <span>Gaji Kotor:</span>
                      <span>
                        {formatCurrency(recalculatedGross)}
                        <small className="text-muted-foreground ml-2">({recalculatedGross})</small>
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-orange-500" />
                      Pemotongan
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between">
                      <span>Sisa Panjar:</span>
                      <span className="font-medium text-orange-600">
                        {formatCurrency(calculation?.outstandingAdvances || calcAny?.outstanding_advances || 0)}
                        <small className="text-muted-foreground ml-2">
                          ({calculation?.outstandingAdvances || calcAny?.outstanding_advances || 0})
                        </small>
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Potong Panjar:</span>
                      <span className={`font-medium ${actualAdvanceDeduct > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {actualAdvanceDeduct > 0 ?
                          `- ${formatCurrency(actualAdvanceDeduct)}` :
                          'Tidak ada'
                        }
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Potongan Gaji:</span>
                      <span className={`font-medium ${salaryDeduction > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {salaryDeduction > 0 ?
                          `- ${formatCurrency(salaryDeduction)}` :
                          'Tidak ada'
                        }
                        {salaryDeduction > 0 && salaryDeductionReason && (
                          <small className="text-muted-foreground ml-2">
                            ({salaryDeductionReason})
                          </small>
                        )}
                      </span>
                    </div>
                    <Separator />
                    <div className="flex justify-between font-medium">
                      <span>Total Potongan:</span>
                      <span className={`${totalDeductions > 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {totalDeductions > 0 ?
                          `- ${formatCurrency(totalDeductions)}` :
                          'Rp 0'
                        }
                      </span>
                    </div>
                    {actualAdvanceDeduct > 0 && (
                      <div className="text-xs text-muted-foreground p-2 bg-orange-50 rounded">
                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                        Panjar akan otomatis dipotong dari gaji dan dicatat sebagai pelunasan
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-2 border-primary/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-primary" />
                      Gaji Bersih
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold text-primary">
                      {formatCurrency(recalculatedNet)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Tipe: <Badge variant="outline">{calculation.payrollType}</Badge>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          {calculation && (
            <Button
              onClick={handleCreate}
              disabled={!paymentAccountId || isCreating}
            >
              {isCreating ? "Membuat..." : "Buat Record Payroll"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}