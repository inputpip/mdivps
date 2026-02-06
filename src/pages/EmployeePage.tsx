"use client"
import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  UserPlus,
  Edit,
  Trash2,
  KeyRound,
  DollarSign,
  Users,
  Calculator,
  Settings,
  Plus,
  CheckCircle,
  Clock,
  AlertTriangle,
  Shield,
  FileText,
  Printer
} from "lucide-react"
import { useEmployees } from "@/hooks/useEmployees"
import { Employee } from "@/types/employee"
import { EmployeeDialog } from "@/components/EmployeeDialog"
import { ResetPasswordDialog } from "@/components/ResetPasswordDialog"
import { SalaryConfigDialog } from "@/components/SalaryConfigDialog"
import { PayrollRecordDialog } from "@/components/PayrollRecordDialog"
import { EditPayrollDialog } from "@/components/EditPayrollDialog"
import { PaymentConfirmationDialog } from "@/components/PaymentConfirmationDialog"
import { RoleCommissionSetup } from "@/components/RoleCommissionSetup"
import { PayrollSlipPDF } from "@/components/PayrollSlipPDF"
import { PinSetupDialog } from "@/components/PinSetupDialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useToast } from "@/components/ui/use-toast"
import { isOwner, isAdmin } from "@/utils/roleUtils"
import { useEmployeeSalaries, usePayrollRecords, usePayrollSummary } from "@/hooks/usePayroll"
import { useAccounts } from "@/hooks/useAccounts"
import { EmployeeSalary, PayrollRecord } from "@/types/payroll"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"

export default function EmployeePage() {
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false)
  const [isResetPasswordDialogOpen, setIsResetPasswordDialogOpen] = useState(false)
  const [isPinSetupDialogOpen, setIsPinSetupDialogOpen] = useState(false)
  const [isSalaryConfigDialogOpen, setIsSalaryConfigDialogOpen] = useState(false)
  const [isPayrollRecordDialogOpen, setIsPayrollRecordDialogOpen] = useState(false)
  const [isEditPayrollDialogOpen, setIsEditPayrollDialogOpen] = useState(false)
  const [isPaymentConfirmDialogOpen, setIsPaymentConfirmDialogOpen] = useState(false)
  const [isDeletePayrollDialogOpen, setIsDeletePayrollDialogOpen] = useState(false)
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null)
  const [selectedSalaryConfig, setSelectedSalaryConfig] = useState<EmployeeSalary | null>(null)
  const [selectedPayrollRecord, setSelectedPayrollRecord] = useState<PayrollRecord | null>(null)
  const [payrollToDelete, setPayrollToDelete] = useState<PayrollRecord | null>(null)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1)

  const { user } = useAuth()
  const { toast } = useToast()
  const { accounts } = useAccounts()
  const { employees, isLoading, deleteEmployee, isError, error } = useEmployees()
  const { salaryConfigs, isLoading: isLoadingSalaries } = useEmployeeSalaries()
  const { payrollRecords, approvePayrollRecord, processPayment, deletePayrollRecord } = usePayrollRecords({
    year: selectedYear,
    month: selectedMonth,
  })
  const { summary } = usePayrollSummary(selectedYear, selectedMonth)

  // Check for owner role (case insensitive)
  const userIsOwnerRole = isOwner(user)
  const userCanManagePayroll = isOwner(user) || isAdmin(user)

  const handleOpenDialog = (employee: Employee | null) => {
    setSelectedEmployee(employee)
    setIsEmployeeDialogOpen(true)
  }

  const handleOpenResetPasswordDialog = (employee: Employee) => {
    setSelectedEmployee(employee)
    setIsResetPasswordDialogOpen(true)
  }

  const handleOpenPinSetupDialog = (employee: Employee) => {
    setSelectedEmployee(employee)
    setIsPinSetupDialogOpen(true)
  }

  const handleOpenSalaryConfigDialog = (employee: Employee, existingConfig?: EmployeeSalary) => {
    setSelectedEmployee(employee)
    setSelectedSalaryConfig(existingConfig || null)
    setIsSalaryConfigDialogOpen(true)
  }

  const getSalaryConfig = (employeeId: string) => {
    return salaryConfigs?.find(config => config.employeeId === employeeId && config.isActive)
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount)
  }

  const getPayrollStatusBadge = (status: string) => {
    switch (status) {
      case 'paid':
        return <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle className="h-3 w-3 mr-1" />Dibayar</Badge>
      case 'approved':
        return <Badge variant="outline" className="text-blue-600 border-blue-600"><Clock className="h-3 w-3 mr-1" />Disetujui</Badge>
      case 'draft':
        return <Badge variant="secondary"><Edit className="h-3 w-3 mr-1" />Draft</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const getPayrollTypeBadge = (type: string) => {
    switch (type) {
      case 'monthly':
        return <Badge variant="outline" className="text-blue-600">Gaji Bulanan</Badge>
      case 'commission_only':
        return <Badge variant="outline" className="text-green-600">Komisi Saja</Badge>
      case 'mixed':
        return <Badge variant="outline" className="text-purple-600">Gaji + Komisi</Badge>
      default:
        return <Badge variant="outline">Unknown</Badge>
    }
  }

  const handleDelete = (employeeToDelete: Employee) => {
    deleteEmployee.mutate(employeeToDelete.id, {
      onSuccess: () => {
        toast({ title: "Sukses", description: `Karyawan ${employeeToDelete.name} berhasil dihapus.` })
      },
      onError: (error: any) => {
        toast({ variant: "destructive", title: "Gagal", description: error.message })
      }
    })
  }

  const handleApprovePayroll = async (payrollId: string) => {
    try {
      await approvePayrollRecord.mutateAsync(payrollId)
      toast({
        title: "Sukses",
        description: "Payroll berhasil disetujui"
      })
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menyetujui payroll"
      })
    }
  }

  const handlePayPayroll = (record: PayrollRecord) => {
    // Set selected record and open confirmation dialog
    // Payment account will be selected in the dialog
    setSelectedPayrollRecord(record)
    setIsPaymentConfirmDialogOpen(true)
  }

  const handleConfirmPayment = async (paymentAccountId: string) => {
    if (!selectedPayrollRecord) return

    // Find salary expense account (priority: Code 6110 -> search by name "Beban Gaji")
    const expenseAccount = accounts?.find(a =>
      a.code === '6110' ||
      (a.name.toLowerCase().includes('beban') && a.name.toLowerCase().includes('gaji'))
    )

    try {
      await processPayment.mutateAsync({
        id: selectedPayrollRecord.id,
        paymentAccountId: paymentAccountId,
        paymentDate: new Date(),
        expenseAccountId: expenseAccount?.id
      })
      toast({
        title: "Sukses",
        description: "Pembayaran gaji berhasil diproses dan jurnal otomatis dibuat"
      })

      // Close dialog after a short delay to allow query invalidation
      setTimeout(() => {
        setIsPaymentConfirmDialogOpen(false)
        setSelectedPayrollRecord(null)
      }, 300)
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal memproses pembayaran"
      })
    }
  }

  const handleEditPayroll = (record: PayrollRecord) => {
    setSelectedPayrollRecord(record)
    setIsEditPayrollDialogOpen(true)
  }

  const handleDeletePayrollClick = (record: PayrollRecord) => {
    setPayrollToDelete(record)
    setIsDeletePayrollDialogOpen(true)
  }

  const handleConfirmDeletePayroll = async () => {
    if (!payrollToDelete) return

    try {
      await deletePayrollRecord.mutateAsync(payrollToDelete.id)
      toast({
        title: "Sukses",
        description: `Catatan gaji ${payrollToDelete.employeeName} berhasil dihapus`
      })
      setIsDeletePayrollDialogOpen(false)
      setPayrollToDelete(null)
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Gagal menghapus catatan gaji"
      })
    }
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-destructive">Gagal Memuat Data</CardTitle>
          <CardDescription>
            Terjadi kesalahan saat mengambil data karyawan. Silakan coba muat ulang halaman.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Detail Error: {error?.message}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Dialogs */}
      <EmployeeDialog
        open={isEmployeeDialogOpen}
        onOpenChange={setIsEmployeeDialogOpen}
        employee={selectedEmployee}
      />
      <ResetPasswordDialog
        open={isResetPasswordDialogOpen}
        onOpenChange={setIsResetPasswordDialogOpen}
        employee={selectedEmployee}
      />
      <PinSetupDialog
        open={isPinSetupDialogOpen}
        onOpenChange={setIsPinSetupDialogOpen}
        employee={selectedEmployee}
      />
      <SalaryConfigDialog
        isOpen={isSalaryConfigDialogOpen}
        onOpenChange={setIsSalaryConfigDialogOpen}
        employee={selectedEmployee}
        existingConfig={selectedSalaryConfig}
      />
      <PayrollRecordDialog
        isOpen={isPayrollRecordDialogOpen}
        onOpenChange={setIsPayrollRecordDialogOpen}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
      />
      <EditPayrollDialog
        isOpen={isEditPayrollDialogOpen}
        onOpenChange={setIsEditPayrollDialogOpen}
        payrollRecord={selectedPayrollRecord}
      />
      <PaymentConfirmationDialog
        isOpen={isPaymentConfirmDialogOpen}
        onOpenChange={setIsPaymentConfirmDialogOpen}
        payrollRecord={selectedPayrollRecord}
        onConfirm={handleConfirmPayment}
        isProcessing={processPayment.isPending}
      />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Users className="h-8 w-8" />
            Manajemen Karyawan
          </h1>
          <p className="text-muted-foreground">
            Kelola data karyawan dan sistem penggajian
          </p>
        </div>
        {userIsOwnerRole && (
          <Button onClick={() => handleOpenDialog(null)}>
            <UserPlus className="mr-2 h-4 w-4" /> Tambah Karyawan Baru
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      {summary && userCanManagePayroll && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Karyawan</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalEmployees}</div>
              <p className="text-xs text-muted-foreground">
                {summary.period.display}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Gaji Kotor</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {formatCurrency(summary.totalGrossSalary)}
              </div>
              <p className="text-xs text-muted-foreground">
                Gaji: {formatCurrency(summary.totalBaseSalary)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Komisi</CardTitle>
              <Calculator className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(summary.totalCommission)}
              </div>
              <p className="text-xs text-muted-foreground">
                Bonus: {formatCurrency(summary.totalBonus)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Status Pembayaran</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{summary.paidCount}</div>
              <p className="text-xs text-muted-foreground">
                Pending: {summary.pendingCount} | Draft: {summary.draftCount}
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="employees" className="w-full">
        <TabsList className={`grid w-full ${userCanManagePayroll ? 'grid-cols-5' : 'grid-cols-1'}`}>
          <TabsTrigger value="employees" className="gap-2">
            <Users className="h-4 w-4" />
            Data Karyawan
          </TabsTrigger>
          {userCanManagePayroll && (
            <>
              <TabsTrigger value="salary-config" className="gap-2">
                <Settings className="h-4 w-4" />
                Konfigurasi Gaji
              </TabsTrigger>
              <TabsTrigger value="commission-setup" className="gap-2">
                <DollarSign className="h-4 w-4" />
                Setup Komisi
              </TabsTrigger>
              <TabsTrigger value="payroll-records" className="gap-2">
                <FileText className="h-4 w-4" />
                Catatan Gaji
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Employees Tab */}
        <TabsContent value="employees" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Data Karyawan</CardTitle>
              <CardDescription>Daftar semua karyawan di perusahaan</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nama</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Jabatan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <TableRow key={i}>
                          <TableCell colSpan={5}><Skeleton className="h-6 w-full" /></TableCell>
                        </TableRow>
                      ))
                    ) : employees?.length ? (
                      employees.map((employee) => (
                        <TableRow key={employee.id}>
                          <TableCell className="font-medium">{employee.name}</TableCell>
                          <TableCell>{employee.email}</TableCell>
                          <TableCell>{employee.role}</TableCell>
                          <TableCell>
                            <Badge variant={employee.status === 'Aktif' ? 'success' : 'destructive'}>
                              {employee.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {userIsOwnerRole ? (
                              <>
                                <Button variant="ghost" size="icon" onClick={() => handleOpenPinSetupDialog(employee)} title="Set PIN">
                                  <Shield className="h-4 w-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleOpenResetPasswordDialog(employee)} title="Reset Password">
                                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(employee)} title="Edit">
                                  <Edit className="h-4 w-4" />
                                </Button>
                                {employee.id !== user?.id && (
                                  <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                      <Button variant="ghost" size="icon" title="Hapus">
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                      </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                      <AlertDialogHeader>
                                        <AlertDialogTitle>Anda yakin?</AlertDialogTitle>
                                        <AlertDialogDescription>
                                          Tindakan ini akan menghapus karyawan "{employee.name}" secara permanen.
                                        </AlertDialogDescription>
                                      </AlertDialogHeader>
                                      <AlertDialogFooter>
                                        <AlertDialogCancel>Batal</AlertDialogCancel>
                                        <AlertDialogAction
                                          onClick={() => handleDelete(employee)}
                                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                        >
                                          Ya, Hapus
                                        </AlertDialogAction>
                                      </AlertDialogFooter>
                                    </AlertDialogContent>
                                  </AlertDialog>
                                )}
                              </>
                            ) : (
                              <span className="text-xs text-muted-foreground">Hanya Owner</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-24 text-center">
                          Belum ada data karyawan.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Salary Configuration Tab */}
        {userCanManagePayroll && (
          <TabsContent value="salary-config" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Konfigurasi Gaji Karyawan</CardTitle>
                    <CardDescription>
                      Atur gaji pokok dan komisi untuk setiap karyawan
                    </CardDescription>
                  </div>
                  <Button onClick={() => setIsSalaryConfigDialogOpen(true)} className="gap-2">
                    <Plus className="h-4 w-4" />
                    Tambah Konfigurasi
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Karyawan</TableHead>
                        <TableHead>Jabatan</TableHead>
                        <TableHead>Tipe Gaji</TableHead>
                        <TableHead className="text-right">Gaji Pokok</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees?.map((employee) => {
                        const salaryConfig = getSalaryConfig(employee.id)
                        return (
                          <TableRow key={employee.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium">{employee.name}</p>
                                <p className="text-xs text-muted-foreground">{employee.email}</p>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{employee.role}</Badge>
                            </TableCell>
                            <TableCell>
                              {salaryConfig ? (
                                getPayrollTypeBadge(salaryConfig.payrollType)
                              ) : (
                                <Badge variant="secondary">Belum diatur</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              {salaryConfig ? (
                                <span className="font-medium">
                                  {formatCurrency(salaryConfig.baseSalary)}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {salaryConfig ? (
                                salaryConfig.isActive ? (
                                  <Badge variant="outline" className="text-green-600">Aktif</Badge>
                                ) : (
                                  <Badge variant="outline" className="text-red-600">Tidak Aktif</Badge>
                                )
                              ) : (
                                <Badge variant="secondary">Belum diatur</Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenSalaryConfigDialog(employee, salaryConfig)}
                              >
                                {salaryConfig ? <Edit className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
                              </Button>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}

        {/* Commission Setup Tab */}
        {userCanManagePayroll && (
          <TabsContent value="commission-setup" className="space-y-4">
            <RoleCommissionSetup />
          </TabsContent>
        )}

        {/* Payroll Records Tab */}
        {userCanManagePayroll && (
          <TabsContent value="payroll-records" className="space-y-4">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Catatan Gaji Bulanan</CardTitle>
                    <CardDescription>
                      Kelola pembayaran gaji per periode
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Select value={selectedMonth.toString()} onValueChange={(value) => setSelectedMonth(Number(value))}>
                      <SelectTrigger className="w-[130px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 12 }, (_, i) => (
                          <SelectItem key={i + 1} value={(i + 1).toString()}>
                            {new Date(0, i).toLocaleDateString('id-ID', { month: 'long' })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={selectedYear.toString()} onValueChange={(value) => setSelectedYear(Number(value))}>
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from({ length: 5 }, (_, i) => (
                          <SelectItem key={i} value={(new Date().getFullYear() - i).toString()}>
                            {new Date().getFullYear() - i}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={() => setIsPayrollRecordDialogOpen(true)} className="gap-2">
                      <Plus className="h-4 w-4" />
                      Buat Record Gaji
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Karyawan</TableHead>
                        <TableHead className="text-right">Gaji Pokok</TableHead>
                        <TableHead className="text-right">Komisi/Bonus</TableHead>
                        <TableHead className="text-right">Potongan/Panjar</TableHead>
                        <TableHead className="text-right">Total Net</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tgl Bayar</TableHead>
                        <TableHead>Akun Bayar</TableHead>
                        <TableHead>Dibayar Oleh</TableHead>
                        <TableHead className="text-right">Aksi</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRecords?.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{record.employeeName}</p>
                              <p className="text-xs text-muted-foreground">{record.employeeRole}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(record.baseSalaryAmount)}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.commissionAmount + record.bonusAmount > 0 ? (
                              <div className="text-xs">
                                {record.commissionAmount > 0 && <p className="text-green-600">K: {formatCurrency(record.commissionAmount)}</p>}
                                {record.bonusAmount > 0 && <p className="text-blue-600">B: {formatCurrency(record.bonusAmount)}</p>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {record.deductionAmount + record.outstandingAdvances > 0 ? (
                              <div className="text-xs">
                                {record.outstandingAdvances > 0 && <p className="text-orange-600">Pj: {formatCurrency(record.outstandingAdvances)}</p>}
                                {record.deductionAmount > 0 && <p className="text-red-600">Pt: ({formatCurrency(record.deductionAmount)})</p>}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="font-bold">
                              {formatCurrency(record.netSalary)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {getPayrollStatusBadge(record.status)}
                          </TableCell>
                          <TableCell>
                            {record.status === 'paid' && record.paymentDate ? (
                              <span className="text-xs text-muted-foreground">{record.paymentDate.toLocaleDateString('id-ID')}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {record.status === 'paid' && record.paymentAccountName ? (
                              <span className="text-xs text-muted-foreground">{record.paymentAccountName}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {record.status === 'paid' && record.paidBy ? (
                              <span className="text-xs text-muted-foreground">{record.paidBy}</span>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-2 justify-end">
                              {record.status === 'draft' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleApprovePayroll(record.id)}
                                    title="Setujui"
                                  >
                                    <CheckCircle className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    title="Edit"
                                    onClick={() => handleEditPayroll(record)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  {userIsOwnerRole && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Hapus"
                                      onClick={() => handleDeletePayrollClick(record)}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {record.status === 'approved' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    title="Edit"
                                    onClick={() => handleEditPayroll(record)}
                                  >
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => handlePayPayroll(record)}
                                    title="Bayar"
                                    className="bg-green-600 hover:bg-green-700"
                                  >
                                    <DollarSign className="h-3 w-3 mr-1" />
                                    Bayar
                                  </Button>
                                  {userIsOwnerRole && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Hapus"
                                      onClick={() => handleDeletePayrollClick(record)}
                                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </>
                              )}
                              {record.status === 'paid' && (
                                <div className="flex gap-2 justify-end">
                                  <span className="text-xs text-green-600 font-medium self-center">
                                    ✓ Selesai
                                  </span>
                                  <PayrollSlipPDF record={record} />
                                  {userIsOwnerRole && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      title="Hapus / Batalkan Bayar"
                                      onClick={() => handleDeletePayrollClick(record)}
                                      className="text-red-500 hover:text-red-700 h-7 w-7 p-0"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Delete Payroll Confirmation Dialog */}
      <AlertDialog open={isDeletePayrollDialogOpen} onOpenChange={setIsDeletePayrollDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus Catatan Gaji</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                {payrollToDelete && (
                  <>
                    Apakah Anda yakin ingin menghapus catatan gaji untuk{' '}
                    <span className="font-semibold">{payrollToDelete.employeeName}</span> periode{' '}
                    <span className="font-semibold">{payrollToDelete.periodDisplay}</span>?
                    <br /><br />
                    <span className="text-amber-600 font-medium">
                      ⚠️ Tindakan ini tidak dapat dibatalkan. Jurnal akuntansi terkait akan otomatis dibatalkan (void).
                    </span>
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPayrollToDelete(null)}>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeletePayroll}
              className="bg-red-600 hover:bg-red-700"
              disabled={deletePayrollRecord.isPending}
            >
              {deletePayrollRecord.isPending ? "Menghapus..." : "Hapus"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}