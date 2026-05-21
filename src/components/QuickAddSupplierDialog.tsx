"use client"

import * as React from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, Building } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useSuppliers } from "@/hooks/useSuppliers"
import { CreateSupplierData } from "@/types/supplier"

const supplierSchema = z.object({
  name: z.string().min(2, "Nama supplier minimal 2 karakter"),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email("Email tidak valid").optional().or(z.literal("")),
  address: z.string().optional(),
  city: z.string().optional(),
  paymentTerms: z.string().default("Cash"),
  notes: z.string().optional(),
})

type SupplierFormData = z.infer<typeof supplierSchema>

interface QuickAddSupplierDialogProps {
  onCreated?: (supplierId: string) => void
}

export function QuickAddSupplierDialog({ onCreated }: QuickAddSupplierDialogProps) {
  const { toast } = useToast()
  const { createSupplier } = useSuppliers()
  const [open, setOpen] = React.useState(false)

  const { register, handleSubmit, setValue, reset, watch, formState: { errors } } = useForm<SupplierFormData>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: "",
      contactPerson: "",
      phone: "",
      email: "",
      address: "",
      city: "",
      paymentTerms: "Cash",
      notes: "",
    }
  })

  const onSubmit = (data: SupplierFormData) => {
    const payload: CreateSupplierData = {
      name: data.name,
      contactPerson: data.contactPerson || undefined,
      phone: data.phone || undefined,
      email: data.email || undefined,
      address: data.address || undefined,
      city: data.city || undefined,
      paymentTerms: data.paymentTerms,
      notes: data.notes || undefined,
    }

    createSupplier.mutate(payload, {
      onSuccess: (supplier) => {
        toast({ title: "Sukses", description: "Supplier berhasil ditambahkan" })
        onCreated?.(supplier.id)
        reset()
        setOpen(false)
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Error", description: error.message })
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Tambah Supplier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building className="h-5 w-5" />
            Tambah Supplier
          </DialogTitle>
          <DialogDescription>
            Tambah supplier langsung dari menu PO.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nama Supplier *</Label>
            <Input id="name" {...register("name")} placeholder="PT. Supplier ABC" />
            {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="contactPerson">Nama Kontak</Label>
              <Input id="contactPerson" {...register("contactPerson")} placeholder="Budi Santoso" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telepon</Label>
              <Input id="phone" {...register("phone")} placeholder="0812xxxxxxx" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} placeholder="info@supplier.com" />
              {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">Kota</Label>
              <Input id="city" {...register("city")} placeholder="Jakarta" />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">Alamat</Label>
            <Textarea id="address" {...register("address")} placeholder="Alamat supplier" rows={2} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentTerms">Syarat Pembayaran</Label>
            <Select value={watch("paymentTerms")} onValueChange={(value) => setValue("paymentTerms", value)}>
              <SelectTrigger>
                <SelectValue placeholder="Pilih syarat pembayaran" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Net 7">Net 7</SelectItem>
                <SelectItem value="Net 14">Net 14</SelectItem>
                <SelectItem value="Net 30">Net 30</SelectItem>
                <SelectItem value="Net 60">Net 60</SelectItem>
                <SelectItem value="Net 90">Net 90</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Catatan</Label>
            <Textarea id="notes" {...register("notes")} placeholder="Catatan tambahan" rows={2} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={createSupplier.isPending}>
              {createSupplier.isPending ? "Menyimpan..." : "Simpan Supplier"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
