"use client"

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/use-toast'
import { Plus, FileText, Search, Loader2, Trash2, Edit, Send, CheckCircle, XCircle, ArrowRight, Eye, Printer } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useBranch } from '@/contexts/BranchContext'
import { useCustomers } from '@/hooks/useCustomers'
import { useProducts } from '@/hooks/useProducts'
import { quotationService, Quotation, QuotationItem } from '@/services/quotationService'
import { format } from 'date-fns'
import { id as localeId } from 'date-fns/locale/id'
import { formatCurrency } from '@/utils/currency'
import { useTransactions } from '@/hooks/useTransactions'

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  sent: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  accepted: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
  expired: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  converted: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Terkirim',
  accepted: 'Diterima',
  rejected: 'Ditolak',
  expired: 'Kadaluarsa',
  converted: 'Jadi Invoice',
}

export default function QuotationsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { currentBranch } = useBranch()
  const { toast } = useToast()
  const { customers } = useCustomers()
  const { products } = useProducts()
  const { addTransaction } = useTransactions()

  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Dialog states
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedQuotation, setSelectedQuotation] = useState<Quotation | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Preview State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

  // Conversion State
  const [isConversionOpen, setIsConversionOpen] = useState(false)
  const [selectedQuotationToConvert, setSelectedQuotationToConvert] = useState<Quotation | null>(null)
  const [conversionData, setConversionData] = useState({
    isOfficeSale: false,
    paymentStatus: 'Lunas',
    paidAmount: 0,
    paymentMethod: 'Tunai'
  })

  // Conversion Handlers
  const handleConvertClick = async (quotation: Quotation) => {
    try {
      setIsSaving(true);
      console.log('[Convert] Fetching quotation details for:', quotation.id)
      const fullQuotation = await quotationService.getQuotationById(quotation.id!)
      console.log('[Convert] Full quotation fetched:', fullQuotation)

      // Merge with existing quotation data as fallback
      const dataToUse = { ...quotation, ...(fullQuotation || {}) };

      if (dataToUse) {
        // Handle case where items might be a JSON string instead of array
        if (dataToUse.items && typeof dataToUse.items === 'string') {
          try {
            dataToUse.items = JSON.parse(dataToUse.items)
          } catch (e) {
            console.error('[Convert] Failed to parse items:', e)
            dataToUse.items = []
          }
        }

        // Ensure we have minimal data
        if (!dataToUse.customer_name) {
          console.warn('[Convert] Customer name missing, using default');
        }

        setSelectedQuotationToConvert(dataToUse)
        setConversionData({
          isOfficeSale: false,
          paymentStatus: 'Lunas',
          paidAmount: dataToUse.total || 0,
          paymentMethod: 'Tunai'
        })
        setIsConversionOpen(true)
      }
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: 'Gagal memuat detail penawaran' })
    } finally {
      setIsSaving(false);
    }
  }

  const handleConvertSubmit = async () => {
    if (!selectedQuotationToConvert) return
    setIsSaving(true)
    try {
      const newTransactionId = `TRX-${format(new Date(), 'yyMMdd')}-${Math.floor(Math.random() * 10000)}`

      const newTransaction = {
        id: newTransactionId,
        customerId: selectedQuotationToConvert.customer_id,
        customerName: selectedQuotationToConvert.customer_name,
        items: selectedQuotationToConvert.items?.map(item => ({
          product: { id: item.product_id, name: item.product_name, type: item.product_type },
          productId: item.product_id,
          productName: item.product_name,
          quantity: item.quantity,
          unit: item.unit,
          price: item.unit_price,
          discount: item.discount_amount || 0,
          subtotal: item.subtotal
        })) || [],
        total: selectedQuotationToConvert.total,
        paidAmount: conversionData.paidAmount,
        paymentMethod: conversionData.paymentMethod,
        isOfficeSale: conversionData.isOfficeSale,
        orderDate: new Date(),
        paymentStatus: conversionData.paymentStatus,
        notes: `Dari Penawaran #${selectedQuotationToConvert.quotation_number || selectedQuotationToConvert.id}. ${selectedQuotationToConvert.notes || ''}`
      }

      const result = await addTransaction.mutateAsync({
        newTransaction: newTransaction as any,
        quotationId: selectedQuotationToConvert.id
      })

      await quotationService.updateStatus(selectedQuotationToConvert.id!, 'converted')

      toast({ title: 'Berhasil', description: 'Invoice berhasil dibuat' })
      setIsConversionOpen(false)
      navigate(`/transactions/${result.id}`)
    } catch (err: any) {
      console.error(err)
      toast({ variant: 'destructive', title: 'Gagal', description: err.message || 'Gagal membuat invoice' })
    } finally {
      setIsSaving(false)
    }
  }

  // Form states
  const [formData, setFormData] = useState({
    customer_id: '',
    customer_name: '',
    customer_address: '',
    customer_phone: '',
    valid_until: undefined as unknown as string,
    notes: '',
    terms: 'Harga belum termasuk PPN\nBerlaku 7 hari sejak tanggal penawaran\nPembayaran: Cash / Transfer',
  })
  const [items, setItems] = useState<QuotationItem[]>([])

  // Load quotations
  useEffect(() => {
    if (currentBranch?.id) {
      loadQuotations()
    }
  }, [currentBranch?.id])

  // Check if coming from customer map with customerId
  useEffect(() => {
    const customerId = searchParams.get('customerId')
    if (customerId && customers) {
      const customer = customers.find((c) => c.id === customerId)
      if (customer) {
        setFormData((prev) => ({
          ...prev,
          customer_id: customer.id,
          customer_name: customer.name,
          customer_address: customer.address || '',
          customer_phone: customer.phone || '',
        }))
        setIsFormOpen(true)
      }
    }
  }, [searchParams, customers])

  const loadQuotations = async () => {
    if (!currentBranch?.id) return

    setIsLoading(true)
    try {
      const result = await quotationService.getQuotations(currentBranch.id, {
        status: statusFilter !== 'all' ? statusFilter : undefined,
      })
      setQuotations(result.data)
    } catch (err) {
      console.error('Error loading quotations:', err)
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Gagal memuat data penawaran',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCustomerChange = (customerId: string) => {
    const customer = customers?.find((c) => c.id === customerId)
    if (customer) {
      setFormData((prev) => ({
        ...prev,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_address: customer.address || '',
        customer_phone: customer.phone || '',
      }))
    }
  }

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        product_id: '',
        product_name: '',
        product_type: '',
        quantity: 1,
        unit: 'pcs',
        unit_price: 0,
        discount_percent: 0,
        discount_amount: 0,
        subtotal: 0,
      },
    ])
  }

  const handleItemChange = (index: number, field: keyof QuotationItem, value: any) => {
    setItems((prev) => {
      const newItems = [...prev]
      newItems[index] = { ...newItems[index], [field]: value }

      // Recalculate subtotal
      const item = newItems[index]
      const baseAmount = item.quantity * item.unit_price
      const discountAmount = item.discount_percent
        ? (baseAmount * item.discount_percent) / 100
        : item.discount_amount || 0
      item.discount_amount = discountAmount
      item.subtotal = baseAmount - discountAmount

      return newItems
    })
  }

  const handleProductSelect = (index: number, productId: string) => {
    const product = products?.find((p) => p.id === productId)
    if (product) {
      setItems((prev) => {
        const newItems = [...prev]
        newItems[index] = {
          ...newItems[index],
          product_id: product.id,
          product_name: product.name,
          product_type: product.type,
          unit: 'pcs',
          unit_price: product.basePrice,
          subtotal: product.basePrice,
        }
        return newItems
      })
    }
  }

  const handleRemoveItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + item.subtotal, 0)
    return { subtotal, total: subtotal }
  }

  const handleSubmit = async () => {
    if (!currentBranch?.id || !user) {
      toast({ variant: 'destructive', title: 'Error', description: 'Data tidak lengkap' })
      return
    }

    if (!formData.customer_id) {
      toast({ variant: 'destructive', title: 'Error', description: 'Pilih pelanggan' })
      return
    }

    if (items.length === 0) {
      toast({ variant: 'destructive', title: 'Error', description: 'Tambahkan minimal 1 item' })
      return
    }

    const { subtotal, total } = calculateTotals()

    setIsSaving(true)
    try {
      if (isEditing && selectedQuotation) {
        await quotationService.updateQuotation(
          selectedQuotation.id!,
          {
            ...formData,
            valid_until: formData.valid_until || undefined,
            subtotal,
            total,
          },
          items
        )
        toast({ title: 'Berhasil', description: 'Penawaran berhasil diperbarui' })
      } else {
        await quotationService.createQuotation(
          {
            ...formData,
            valid_until: formData.valid_until || undefined,
            quotation_date: new Date().toISOString(),
            status: 'draft',
            subtotal,
            total,
            created_by: user.id,
            created_by_name: user.name,
            branch_id: currentBranch.id,
          },
          items
        )
        toast({ title: 'Berhasil', description: 'Penawaran berhasil dibuat' })
      }

      setIsFormOpen(false)
      resetForm()
      loadQuotations()
    } catch (err) {
      console.error('Error saving quotation:', err)
      toast({ variant: 'destructive', title: 'Gagal', description: 'Tidak dapat menyimpan penawaran' })
    } finally {
      setIsSaving(false)
    }
  }

  const resetForm = () => {
    setFormData({
      customer_id: '',
      customer_name: '',
      customer_address: '',
      customer_phone: '',
      valid_until: undefined as unknown as string,
      notes: '',
      terms: 'Harga belum termasuk PPN\nBerlaku 7 hari sejak tanggal penawaran\nPembayaran: Cash / Transfer',
    })
    setItems([])
    setSelectedQuotation(null)
    setIsEditing(false)
  }

  const handleEdit = async (quotation: Quotation) => {
    const fullQuotation = await quotationService.getQuotationById(quotation.id!)
    if (fullQuotation) {
      setSelectedQuotation(fullQuotation)
      setFormData({
        customer_id: fullQuotation.customer_id,
        customer_name: fullQuotation.customer_name,
        customer_address: fullQuotation.customer_address || '',
        customer_phone: fullQuotation.customer_phone || '',
        valid_until: fullQuotation.valid_until || undefined as unknown as string,
        notes: fullQuotation.notes || '',
        terms: fullQuotation.terms || '',
      })
      setItems(fullQuotation.items || [])
      setIsEditing(true)
      setIsFormOpen(true)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Yakin ingin menghapus penawaran ini?')) return

    try {
      await quotationService.deleteQuotation(id)
      toast({ title: 'Berhasil', description: 'Penawaran berhasil dihapus' })
      loadQuotations()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Gagal', description: 'Tidak dapat menghapus penawaran' })
    }
  }

  const handleStatusChange = async (id: string, status: Quotation['status']) => {
    try {
      await quotationService.updateStatus(id, status)
      toast({ title: 'Berhasil', description: `Status berhasil diubah ke ${STATUS_LABELS[status]}` })
      loadQuotations()
    } catch (err) {
      toast({ variant: 'destructive', title: 'Gagal', description: 'Tidak dapat mengubah status' })
    }
  }

  // Preview Handler
  const handlePreview = async (quotation: Quotation) => {
    setIsLoadingPreview(true)
    setIsPreviewOpen(true)
    try {
      console.log('[Preview] Fetching details for:', quotation.id)
      const fullQuotation = await quotationService.getQuotationById(quotation.id!)
      console.log('[Preview] Full quotation data:', fullQuotation)

      // Merge with existing quotation data as fallback
      const dataToUse = { ...quotation, ...(fullQuotation || {}) };

      // Handle case where items might be a JSON string instead of array
      if (dataToUse.items && typeof dataToUse.items === 'string') {
        try {
          dataToUse.items = JSON.parse(dataToUse.items)
        } catch (e) {
          console.error('[Preview] Failed to parse items:', e)
          dataToUse.items = []
        }
      }

      setPreviewQuotation(dataToUse)
    } catch (err) {
      console.error('[Preview] Error:', err)
      toast({ variant: 'destructive', title: 'Error', description: 'Gagal memuat detail penawaran' })

      // Fallback to basic data if fetch fails
      const dataToUse = { ...quotation };
      if (dataToUse.items && typeof dataToUse.items === 'string') {
        try { dataToUse.items = JSON.parse(dataToUse.items) } catch (e) { dataToUse.items = [] }
      }
      setPreviewQuotation(dataToUse)
    } finally {
      setIsLoadingPreview(false)
    }
  }

  const handlePrint = () => {
    if (!previewQuotation) return

    const printWindow = window.open('', '_blank')
    if (!printWindow) {
      toast({ variant: 'destructive', title: 'Error', description: 'Pop-up blocker mungkin aktif' })
      return
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Penawaran ${previewQuotation.quotation_number || previewQuotation.id}</title>
          <style>
            body { font-family: sans-serif; padding: 40px; color: #333; }
            .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
            .company-info h1 { margin: 0 0 5px 0; font-size: 24px; color: #2563eb; }
            .company-info p { margin: 0; font-size: 14px; color: #666; }
            .doc-info { text-align: right; }
            .doc-info h2 { margin: 0 0 10px 0; font-size: 28px; color: #1e40af; }
            .meta-table td { padding: 3px 0; font-size: 14px; }
            .meta-table td:first-child { padding-right: 20px; font-weight: bold; color: #666; }
            
            .recipient { margin-bottom: 40px; padding: 20px; background: #f8fafc; border-radius: 8px; }
            .recipient h3 { margin: 0 0 10px 0; font-size: 14px; text-transform: uppercase; color: #64748b; letter-spacing: 1px; }
            .recipient p { margin: 3px 0; font-size: 16px; }

            table.items { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
            table.items th { background: #f1f5f9; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; border-bottom: 2px solid #e2e8f0; }
            table.items td { padding: 12px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
            table.items th.right, table.items td.right { text-align: right; }
            table.items th.center, table.items td.center { text-align: center; }

            .totals { float: right; width: 300px; }
            .totals-row { display: flex; justify-content: space-between; padding: 8px 0; font-size: 14px; }
            .totals-row.final { font-weight: bold; font-size: 18px; border-top: 2px solid #e2e8f0; margin-top: 8px; padding-top: 15px; color: #2563eb; }

            .notes { clear: both; margin-top: 60px; padding-top: 20px; border-top: 1px solid #e2e8f0; display: flex; gap: 40px; }
            .notes-col { flex: 1; font-size: 13px; line-height: 1.6; }
            .notes-col h4 { margin: 0 0 8px 0; font-size: 12px; text-transform: uppercase; color: #64748b; }

            .footer { margin-top: 50px; text-align: center; font-size: 12px; color: #94a3b8; }
            
            @media print {
              body { padding: 0; }
              .recipient { background: none; border: 1px solid #e2e8f0; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="company-info">
              <h1>${currentBranch?.name || 'PT. AQUAVIT'}</h1>
              <p>${currentBranch?.address || 'Alamat Perusahaan'}</p>
              <p>Telp: ${currentBranch?.phone || '-'}</p>
            </div>
            <div class="doc-info">
              <h2>PENAWARAN</h2>
              <table class="meta-table">
                <tr><td>Nomor</td><td>${previewQuotation.quotation_number || previewQuotation.id}</td></tr>
                <tr><td>Tanggal</td><td>${previewQuotation.quotation_date ? format(new Date(previewQuotation.quotation_date), 'd MMM yyyy', { locale: localeId }) : '-'}</td></tr>
                <tr><td>Berlaku s/d</td><td>${previewQuotation.valid_until ? format(new Date(previewQuotation.valid_until), 'd MMM yyyy', { locale: localeId }) : '-'}</td></tr>
              </table>
            </div>
          </div>

          <div class="recipient">
            <h3>Kepada Yang Terhormat</h3>
            <p style="font-weight: bold">${previewQuotation.customer_name}</p>
            ${previewQuotation.customer_address ? `<p>${previewQuotation.customer_address}</p>` : ''}
            ${previewQuotation.customer_phone ? `<p>${previewQuotation.customer_phone}</p>` : ''}
          </div>

          <table class="items">
            <thead>
              <tr>
                <th style="width: 5%">No</th>
                <th style="width: 45%">Deskripsi Item</th>
                <th class="center" style="width: 15%">Qty</th>
                <th class="right" style="width: 15%">Harga Satuan</th>
                <th class="right" style="width: 20%">Total</th>
              </tr>
            </thead>
            <tbody>
              ${(previewQuotation.items || []).map((item, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>
                    <div style="font-weight: 500">${item.product_name}</div>
                    ${item.notes ? `<div style="font-size: 12px; color: #666; margin-top: 2px">${item.notes}</div>` : ''}
                  </td>
                  <td class="center">${item.quantity} ${item.unit}</td>
                  <td class="right">${formatCurrency(item.unit_price)}</td>
                  <td class="right">${formatCurrency(item.subtotal)}</td>
                </tr>
              `).join('')}
              ${(!previewQuotation.items || previewQuotation.items.length === 0) ?
        `<tr><td colspan="5" class="center" style="padding: 30px; color: #999;">Belum ada item</td></tr>` : ''
      }
            </tbody>
          </table>

          <div class="totals">
            <div class="totals-row">
              <span>Subtotal</span>
              <span>${formatCurrency(previewQuotation.items?.reduce((a, b) => a + (b.subtotal || 0), 0) || 0)}</span>
            </div>
            ${(previewQuotation.discount_amount || 0) > 0 ? `
              <div class="totals-row">
                <span>Diskon</span>
                <span>-${formatCurrency(previewQuotation.discount_amount || 0)}</span>
              </div>
            ` : ''}
            ${(previewQuotation.tax_amount || 0) > 0 ? `
              <div class="totals-row">
                <span>Pajak (PPN)</span>
                <span>${formatCurrency(previewQuotation.tax_amount || 0)}</span>
              </div>
            ` : ''}
            <div class="totals-row final">
              <span>Total</span>
              <span>${formatCurrency(previewQuotation.total)}</span>
            </div>
          </div>

          <div class="notes">
            ${previewQuotation.notes ? `
              <div class="notes-col">
                <h4>Catatan</h4>
                <div>${previewQuotation.notes.replace(/\n/g, '<br>')}</div>
              </div>
            ` : ''}
            ${previewQuotation.terms ? `
              <div class="notes-col">
                <h4>Syarat & Ketentuan</h4>
                <div>${previewQuotation.terms.replace(/\n/g, '<br>')}</div>
              </div>
            ` : ''}
          </div>

          <div class="footer">
            <p>Terima kasih atas kepercayaan Anda</p>
            <p style="margin-top: 5px">Dicetak: ${format(new Date(), 'd MMM yyyy HH:mm', { locale: localeId })} oleh ${user?.name || 'Admin'}</p>
          </div>

          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `

    printWindow.document.write(htmlContent)
    printWindow.document.close()
  }

  const filteredQuotations = quotations.filter((q) => {
    const qNumber = q.quotation_number || q.id || ''
    const matchesSearch =
      qNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (q.customer_name || '').toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === 'all' || q.status === statusFilter
    return matchesSearch && matchesStatus
  })

  const { total: formTotal } = calculateTotals()

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Penawaran Harga
              </CardTitle>
              <CardDescription>Kelola penawaran harga untuk pelanggan</CardDescription>
            </div>
            <Button
              onClick={() => {
                resetForm()
                setIsFormOpen(true)
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Buat Penawaran
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Cari nomor atau nama pelanggan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="sent">Terkirim</SelectItem>
                <SelectItem value="accepted">Diterima</SelectItem>
                <SelectItem value="rejected">Ditolak</SelectItem>
                <SelectItem value="converted">Jadi Invoice</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Quotations List */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredQuotations.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Belum ada penawaran</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredQuotations.map((quotation) => (
                <Card key={quotation.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium">{quotation.quotation_number || quotation.id}</span>
                          <Badge className={STATUS_COLORS[quotation.status] || STATUS_COLORS.draft}>
                            {STATUS_LABELS[quotation.status] || 'Draft'}
                          </Badge>
                        </div>
                        <p className="font-medium">{quotation.customer_name}</p>
                        <p className="text-sm text-muted-foreground">
                          {quotation.quotation_date || quotation.created_at
                            ? format(new Date(quotation.quotation_date || quotation.created_at!), 'd MMM yyyy', { locale: localeId })
                            : '-'}
                          {quotation.valid_until && (
                            <> - Berlaku s/d {format(new Date(quotation.valid_until), 'd MMM yyyy', { locale: localeId })}</>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold">{formatCurrency(quotation.total)}</p>
                        <div className="flex gap-1 mt-2 justify-end flex-wrap">
                          <Button variant="ghost" size="sm" onClick={() => handlePreview(quotation)} title="Lihat Detail">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {quotation.status === 'draft' && (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => handleEdit(quotation)}>
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStatusChange(quotation.id!, 'sent')}
                              >
                                <Send className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {quotation.status === 'sent' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-green-600"
                                onClick={() => handleStatusChange(quotation.id!, 'accepted')}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600"
                                onClick={() => handleStatusChange(quotation.id!, 'rejected')}
                              >
                                <XCircle className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {quotation.status === 'accepted' && !quotation.converted_to_invoice_id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-purple-600"
                              onClick={() => handleConvertClick(quotation)}
                            >
                              <ArrowRight className="h-4 w-4 mr-1" />
                              Invoice
                            </Button>
                          )}
                          {quotation.status !== 'converted' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-600"
                              onClick={() => handleDelete(quotation.id!)}
                              title="Hapus penawaran"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditing ? 'Edit Penawaran' : 'Buat Penawaran Baru'}</DialogTitle>
            <DialogDescription>
              Isi detail penawaran harga untuk pelanggan
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Customer Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pelanggan *</Label>
                <Select value={formData.customer_id} onValueChange={handleCustomerChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pilih pelanggan" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers?.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Berlaku Hingga</Label>
                <Input
                  type="date"
                  value={formData.valid_until}
                  onChange={(e) => setFormData((prev) => ({ ...prev, valid_until: e.target.value }))}
                />
              </div>
            </div>

            {formData.customer_name && (
              <div className="p-3 bg-muted rounded-lg text-sm">
                <p className="font-medium">{formData.customer_name}</p>
                <p className="text-muted-foreground">{formData.customer_address}</p>
                <p className="text-muted-foreground">{formData.customer_phone}</p>
              </div>
            )}

            {/* Items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Item Penawaran</Label>
                <Button variant="outline" size="sm" onClick={handleAddItem}>
                  <Plus className="h-4 w-4 mr-1" />
                  Tambah Item
                </Button>
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-lg">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Belum ada item. Klik "Tambah Item" untuk menambahkan.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item, index) => (
                    <Card key={index}>
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between">
                          <span className="text-sm font-medium text-muted-foreground">Item #{index + 1}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 h-6 w-6 p-0"
                            onClick={() => handleRemoveItem(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="col-span-2 sm:col-span-2 space-y-1">
                            <Label className="text-xs">Produk</Label>
                            <Select
                              value={item.product_id || ''}
                              onValueChange={(v) => handleProductSelect(index, v)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Pilih produk" />
                              </SelectTrigger>
                              <SelectContent>
                                {products?.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Qty</Label>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', Number(e.target.value))}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Harga Satuan</Label>
                            <Input
                              type="number"
                              value={item.unit_price}
                              onChange={(e) => handleItemChange(index, 'unit_price', Number(e.target.value))}
                            />
                          </div>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t">
                          <span className="text-sm text-muted-foreground">Subtotal:</span>
                          <span className="font-medium">{formatCurrency(item.subtotal)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>

            {/* Notes & Terms */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Catatan</Label>
                <Textarea
                  value={formData.notes}
                  onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Catatan tambahan..."
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Syarat & Ketentuan</Label>
                <Textarea
                  value={formData.terms}
                  onChange={(e) => setFormData((prev) => ({ ...prev, terms: e.target.value }))}
                  rows={3}
                />
              </div>
            </div>

            {/* Totals */}
            {items.length > 0 && (
              <div className="p-4 bg-muted rounded-lg">
                <div className="flex justify-between items-center text-lg font-bold">
                  <span>Total:</span>
                  <span>{formatCurrency(formTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={isSaving}>
              Batal
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Menyimpan...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  {isEditing ? 'Simpan Perubahan' : 'Buat Penawaran'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Preview Dialog - Popup Dokumen */}
      <Dialog open={isPreviewOpen} onOpenChange={setIsPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Detail Penawaran
            </DialogTitle>
          </DialogHeader>

          {isLoadingPreview ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewQuotation && (
            <div className="space-y-4 py-2">
              {/* Header Dokumen */}
              <div className="border rounded-lg p-4 bg-gradient-to-r from-blue-50 to-white dark:from-blue-950 dark:to-gray-900">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-bold text-lg">PENAWARAN HARGA</h3>
                    <p className="font-mono text-sm text-muted-foreground">{previewQuotation.quotation_number || previewQuotation.id}</p>
                  </div>
                  <Badge className={STATUS_COLORS[previewQuotation.status] || STATUS_COLORS.draft}>
                    {STATUS_LABELS[previewQuotation.status] || 'Draft'}
                  </Badge>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  <p>Tanggal: {previewQuotation.quotation_date ? format(new Date(previewQuotation.quotation_date), 'd MMMM yyyy', { locale: localeId }) : '-'}</p>
                  {previewQuotation.valid_until && (
                    <p>Berlaku s/d: {format(new Date(previewQuotation.valid_until), 'd MMMM yyyy', { locale: localeId })}</p>
                  )}
                </div>
              </div>

              {/* Info Pelanggan */}
              <div className="border rounded-lg p-4">
                <p className="text-sm text-muted-foreground mb-1">Kepada:</p>
                <p className="font-medium">{previewQuotation.customer_name || '-'}</p>
                {previewQuotation.customer_address && <p className="text-sm text-muted-foreground">{previewQuotation.customer_address}</p>}
                {previewQuotation.customer_phone && <p className="text-sm text-muted-foreground">{previewQuotation.customer_phone}</p>}
              </div>

              {/* Tabel Item */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-3">Item</th>
                      <th className="text-center p-3">Qty</th>
                      <th className="text-right p-3">Harga</th>
                      <th className="text-right p-3">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewQuotation.items && previewQuotation.items.length > 0 ? (
                      previewQuotation.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-3">{item.product_name}</td>
                          <td className="text-center p-3">{item.quantity} {item.unit}</td>
                          <td className="text-right p-3">{formatCurrency(item.unit_price || 0)}</td>
                          <td className="text-right p-3">{formatCurrency(item.subtotal || 0)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr className="border-t">
                        <td colSpan={4} className="p-3 text-center text-muted-foreground">Belum ada item</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-muted font-bold">
                    <tr>
                      <td colSpan={3} className="text-right p-3">TOTAL:</td>
                      <td className="text-right p-3">{formatCurrency(previewQuotation.total || 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Catatan & Syarat */}
              {(previewQuotation.notes || previewQuotation.terms) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  {previewQuotation.notes && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-medium mb-1">Catatan:</p>
                      <p className="text-muted-foreground whitespace-pre-line">{previewQuotation.notes}</p>
                    </div>
                  )}
                  {previewQuotation.terms && (
                    <div className="p-3 bg-muted rounded-lg">
                      <p className="font-medium mb-1">Syarat & Ketentuan:</p>
                      <p className="text-muted-foreground whitespace-pre-line">{previewQuotation.terms}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsPreviewOpen(false)}>
              Tutup
            </Button>
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Cetak
            </Button>
            {previewQuotation && previewQuotation.status === 'accepted' && !previewQuotation.converted_to_invoice_id && (
              <Button
                className="bg-purple-600 hover:bg-purple-700"
                onClick={() => {
                  setIsPreviewOpen(false)
                  handleConvertClick(previewQuotation)
                }}
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Buat Invoice
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conversion Dialog - Dengan Preview Dokumen di samping form pembayaran */}
      <Dialog open={isConversionOpen} onOpenChange={setIsConversionOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Buat Invoice dari Penawaran</DialogTitle>
            <DialogDescription>
              Konversi penawaran menjadi transaksi penjualan resmi.
            </DialogDescription>
          </DialogHeader>

          {selectedQuotationToConvert && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 py-4">
              {/* Kolom Kiri - Preview Dokumen */}
              <div className="space-y-4 border rounded-lg p-4 bg-gray-50 dark:bg-gray-900">
                <h4 className="font-medium text-sm text-muted-foreground">Preview Dokumen</h4>

                {/* Header Dokumen */}
                <div className="border rounded-lg p-3 bg-white dark:bg-gray-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bold">INVOICE</h3>
                      <p className="font-mono text-xs text-muted-foreground">
                        Dari: {selectedQuotationToConvert.quotation_number || selectedQuotationToConvert.id}
                      </p>
                    </div>
                    <Badge className="bg-purple-100 text-purple-800">Baru</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Tanggal: {format(new Date(), 'd MMMM yyyy', { locale: localeId })}
                  </p>
                </div>

                {/* Info Pelanggan */}
                <div className="border rounded-lg p-3 bg-white dark:bg-gray-800">
                  <p className="text-xs text-muted-foreground mb-1">Pelanggan:</p>
                  <p className="font-medium text-sm">{selectedQuotationToConvert.customer_name}</p>
                  {selectedQuotationToConvert.customer_address && (
                    <p className="text-xs text-muted-foreground">{selectedQuotationToConvert.customer_address}</p>
                  )}
                </div>

                {/* Tabel Item Mini */}
                <div className="border rounded-lg overflow-hidden bg-white dark:bg-gray-800">
                  <table className="w-full text-xs">
                    <thead className="bg-muted">
                      <tr>
                        <th className="text-left p-2">Item</th>
                        <th className="text-center p-2">Qty</th>
                        <th className="text-right p-2">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedQuotationToConvert.items && selectedQuotationToConvert.items.length > 0 ? (
                        selectedQuotationToConvert.items.map((item, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2">{item.product_name}</td>
                            <td className="text-center p-2">{item.quantity}</td>
                            <td className="text-right p-2">{formatCurrency(item.subtotal || 0)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr className="border-t">
                          <td colSpan={3} className="p-2 text-center text-muted-foreground">Belum ada item</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot className="bg-muted font-bold">
                      <tr>
                        <td colSpan={2} className="text-right p-2">TOTAL:</td>
                        <td className="text-right p-2">{formatCurrency(selectedQuotationToConvert.total || 0)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Kolom Kanan - Form Pembayaran */}
              <div className="space-y-4">
                <h4 className="font-medium text-sm text-muted-foreground">Detail Pembayaran</h4>

                <div className="p-4 bg-muted rounded-lg space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Pelanggan:</span>
                    <span className="font-medium">{selectedQuotationToConvert.customer_name}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total Tagihan:</span>
                    <span>{formatCurrency(selectedQuotationToConvert.total || 0)}</span>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="officeSale"
                      className="h-4 w-4 rounded border-gray-300"
                      checked={conversionData.isOfficeSale}
                      onChange={(e) => setConversionData(prev => ({ ...prev, isOfficeSale: e.target.checked }))}
                    />
                    <Label htmlFor="officeSale" className="cursor-pointer">
                      Laku Kantor (Barang dibawa langsung)
                    </Label>
                  </div>

                  <div className="space-y-2">
                    <Label>Status Pembayaran</Label>
                    <Select
                      value={conversionData.paymentStatus}
                      onValueChange={(val) => {
                        setConversionData(prev => ({
                          ...prev,
                          paymentStatus: val,
                          paidAmount: val === 'Lunas' ? selectedQuotationToConvert.total : 0
                        }))
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Lunas">Lunas (Tunai)</SelectItem>
                        <SelectItem value="Belum Lunas">Belum Lunas (Kredit/Tempo)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {conversionData.paymentStatus === 'Belum Lunas' && (
                    <div className="space-y-2">
                      <Label>Jumlah DP (Opsional)</Label>
                      <Input
                        type="number"
                        value={conversionData.paidAmount}
                        onChange={(e) => setConversionData(prev => ({ ...prev, paidAmount: Number(e.target.value) }))}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Metode Pembayaran</Label>
                    <Select
                      value={conversionData.paymentMethod}
                      onValueChange={(val) => setConversionData(prev => ({ ...prev, paymentMethod: val }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Tunai">Tunai</SelectItem>
                        <SelectItem value="Transfer">Transfer Bank</SelectItem>
                        <SelectItem value="QRIS">QRIS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Summary */}
                <div className="p-4 border-2 border-dashed rounded-lg space-y-2 mt-4">
                  <div className="flex justify-between text-sm">
                    <span>Total Tagihan:</span>
                    <span>{formatCurrency(selectedQuotationToConvert.total || 0)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Dibayar:</span>
                    <span className="text-green-600">{formatCurrency(conversionData.paidAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold border-t pt-2">
                    <span>Sisa:</span>
                    <span className={(selectedQuotationToConvert.total || 0) - (conversionData.paidAmount || 0) > 0 ? 'text-red-600' : 'text-green-600'}>
                      {formatCurrency((selectedQuotationToConvert.total || 0) - (conversionData.paidAmount || 0))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsConversionOpen(false)} disabled={isSaving}>
              Batal
            </Button>
            <Button onClick={handleConvertSubmit} disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Memproses...
                </>
              ) : (
                <>
                  <CheckCircle className="mr-2 h-4 w-4" />
                  Simpan & Lihat Transaksi
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
