"use client"
import { Button } from "@/components/ui/button"
import { PayrollRecord } from "@/types/payroll"
import { format } from 'date-fns'
import { id } from 'date-fns/locale'
import { Download, Printer } from "lucide-react"
import jsPDF from 'jspdf'
import { terbilang } from '@/utils/terbilang'
import { saveCompressedPDF } from '@/utils/pdfUtils'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { useBranch } from '@/contexts/BranchContext'

interface PayrollSlipPDFProps {
    record: PayrollRecord
}

export function PayrollSlipPDF({ record }: PayrollSlipPDFProps) {
    const { settings } = useCompanySettings()
    const { currentBranch } = useBranch()

    const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
        }).format(amount)
    }

    const generatePDF = (action: 'download' | 'print' = 'download') => {
        // A5 size: 148mm x 210mm
        const doc = new jsPDF({
            orientation: 'portrait',
            unit: 'mm',
            format: 'a5'
        })

        const pageWidth = 148
        const pageHeight = 210
        const margin = 15

        // --- Header ---
        doc.setFontSize(12)
        doc.setFont('helvetica', 'bold')
        doc.text(currentBranch?.name || settings?.name || 'AQUVIT', pageWidth / 2, 15, { align: 'center' })

        doc.setFontSize(10)
        doc.text('SLIP GAJI KARYAWAN', pageWidth / 2, 22, { align: 'center' })

        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        const periodText = `Periode: ${record.periodDisplay || format(record.periodStart, 'MMMM yyyy', { locale: id })}`
        doc.text(periodText, pageWidth / 2, 28, { align: 'center' })

        // Divider
        doc.setLineWidth(0.5)
        doc.line(margin, 32, pageWidth - margin, 32)

        // --- Employee Info ---
        let yPos = 40
        doc.setFontSize(9)
        doc.setFont('helvetica', 'bold')
        doc.text('Data Karyawan:', margin, yPos)

        yPos += 6
        doc.setFont('helvetica', 'normal')
        doc.text(`Nama: ${record.employeeName}`, margin, yPos)
        doc.text(`Jabatan: ${record.employeeRole || '-'}`, pageWidth - margin, yPos, { align: 'right' })

        // --- Salary Details Box ---
        yPos += 10
        doc.setDrawColor(200, 200, 200)
        doc.rect(margin, yPos, pageWidth - (margin * 2), 70)

        // Internal headers
        const boxInnerMargin = margin + 5
        const innerWidth = pageWidth - (margin * 2) - 10
        const midPoint = margin + (pageWidth - (margin * 2)) / 2

        yPos += 8
        doc.setFont('helvetica', 'bold')
        doc.text('PENERIMAAN', boxInnerMargin, yPos)
        doc.text('POTONGAN', midPoint + 5, yPos)

        doc.setLineWidth(0.1)
        doc.line(margin + 2, yPos + 2, pageWidth - margin - 2, yPos + 2)
        doc.line(midPoint, yPos - 5, midPoint, yPos + 55)

        yPos += 8
        doc.setFont('helvetica', 'normal')
        // Earnings
        doc.text('Gaji Pokok', boxInnerMargin, yPos)
        doc.text(formatCurrency(record.baseSalaryAmount), midPoint - 5, yPos, { align: 'right' })

        // Deductions (Initial)
        doc.text('Panjar/Kasbon', midPoint + 5, yPos)
        doc.text(formatCurrency(record.outstandingAdvances || 0), pageWidth - boxInnerMargin, yPos, { align: 'right' })

        yPos += 6
        doc.text('Komisi', boxInnerMargin, yPos)
        doc.text(formatCurrency(record.commissionAmount), midPoint - 5, yPos, { align: 'right' })

        doc.text('Potongan Lain', midPoint + 5, yPos)
        doc.text(formatCurrency(record.deductionAmount), pageWidth - boxInnerMargin, yPos, { align: 'right' })

        yPos += 6
        doc.text('Bonus', boxInnerMargin, yPos)
        doc.text(formatCurrency(record.bonusAmount), midPoint - 5, yPos, { align: 'right' })

        // Subtotals
        yPos += 12
        doc.setFont('helvetica', 'bold')
        const totalEarnings = record.baseSalaryAmount + record.commissionAmount + record.bonusAmount
        doc.text('Total Penerimaan', boxInnerMargin, yPos)
        doc.text(formatCurrency(totalEarnings), midPoint - 5, yPos, { align: 'right' })

        const totalDeductions = (record.outstandingAdvances || 0) + record.deductionAmount
        doc.text('Total Potongan', midPoint + 5, yPos)
        doc.text(formatCurrency(totalDeductions), pageWidth - boxInnerMargin, yPos, { align: 'right' })

        // --- Net Salary Big Box ---
        yPos = 115
        doc.setFillColor(245, 245, 245)
        doc.rect(margin, yPos, pageWidth - (margin * 2), 15, 'F')
        doc.rect(margin, yPos, pageWidth - (margin * 2), 15, 'S')

        doc.setFontSize(11)
        doc.text('TAKE HOME PAY (NET)', margin + 5, yPos + 9)
        doc.setFontSize(12)
        doc.setTextColor(0, 100, 0)
        doc.text(formatCurrency(record.netSalary), pageWidth - margin - 5, yPos + 9, { align: 'right' })
        doc.setTextColor(0, 0, 0)

        // Terbilang
        yPos += 20
        doc.setFontSize(8)
        doc.setFont('helvetica', 'italic')
        doc.text(`Terbilang: ${terbilang(record.netSalary)}`, margin, yPos, { maxWidth: pageWidth - (margin * 2) })

        // --- Signatures ---
        yPos += 25
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')

        const signatureWidth = 40

        // Left side: Penerima
        doc.text('Penerima,', margin + 5, yPos)
        doc.line(margin + 5, yPos + 15, margin + 5 + signatureWidth, yPos + 15)
        doc.text(record.employeeName, margin + 5, yPos + 19)

        // Right side: Bendahara/Admin
        doc.text('Dibayar Oleh,', pageWidth - margin - signatureWidth - 5, yPos)
        doc.line(pageWidth - margin - signatureWidth - 5, yPos + 15, pageWidth - margin - 5, yPos + 15)
        doc.text(record.paidBy || 'Admin Payroll', pageWidth - margin - signatureWidth - 5, yPos + 19)

        // Footer
        doc.setFontSize(7)
        doc.setTextColor(150, 150, 150)
        const footerText = `Dicetak otomatis pada ${format(new Date(), 'dd/MM/yyyy HH:mm')}`
        doc.text(footerText, pageWidth / 2, pageHeight - 10, { align: 'center' })

        if (action === 'print') {
            doc.autoPrint()
            window.open(doc.output('bloburl'), '_blank')
        } else {
            const filename = `Slip-Gaji-${record.employeeName.replace(/\s+/g, '-')}-${record.periodDisplay}.pdf`
            saveCompressedPDF(doc, filename)
        }
    }

    return (
        <div className="flex gap-1">
            <Button
                size="sm"
                variant="outline"
                onClick={() => generatePDF('download')}
                title="Download Slip Gaji"
                className="h-7 px-2"
            >
                <Download className="h-3.5 w-3.5 mr-1" />
                PDF
            </Button>
            <Button
                size="sm"
                variant="outline"
                onClick={() => generatePDF('print')}
                title="Cetak Slip Gaji"
                className="h-7 px-2"
            >
                <Printer className="h-3.5 w-3.5 mr-1" />
                Cetak
            </Button>
        </div>
    )
}
