"use client"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { NumberInput } from "@/components/ui/number-input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from "@/components/ui/textarea"
import { useMaterials } from "@/hooks/useMaterials"
import { useToast } from "./ui/use-toast"
import { Material } from "@/types/material"
import { Scale } from "lucide-react"

const adjustmentSchema = z.object({
    type: z.enum(['IN', 'OUT']),
    quantity: z.number().min(0.01, { message: "Jumlah harus lebih dari 0." }),
    reason: z.string().min(3, { message: "Alasan minimal 3 karakter." }),
    unitCost: z.number().min(0).optional(),
})

type AdjustmentFormData = z.infer<typeof adjustmentSchema>

interface MaterialStockAdjustmentDialogProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    material: Material | null
}

export function MaterialStockAdjustmentDialog({ open, onOpenChange, material }: MaterialStockAdjustmentDialogProps) {
    const { toast } = useToast()
    const { adjustStock: adjustStockMutation } = useMaterials()

    const { control, handleSubmit, reset, watch, formState: { errors } } = useForm<AdjustmentFormData>({
        resolver: zodResolver(adjustmentSchema),
        defaultValues: {
            type: 'IN',
            quantity: 1,
            reason: 'Penyesuaian Stok Manual',
            unitCost: 0
        }
    })

    const selectedType = watch('type')

    const onSubmit = async (data: AdjustmentFormData) => {
        if (!material) return;

        // Convert IN/OUT to + / - quantity change
        const quantityChange = data.type === 'IN' ? data.quantity : -data.quantity;

        adjustStockMutation.mutate({
            materialId: material.id,
            quantityChange,
            reason: data.reason,
            unitCost: data.unitCost
        }, {
            onSuccess: () => {
                toast({
                    title: "Sukses!",
                    description: `Penyesuaian stok untuk ${material.name} berhasil disimpan.`,
                })
                reset()
                onOpenChange(false)
            },
            onError: (error) => {
                toast({
                    variant: "destructive",
                    title: "Gagal!",
                    description: error.message,
                })
            },
        })
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[425px]">
                <form onSubmit={handleSubmit(onSubmit)}>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Scale className="h-5 w-5 text-blue-500" />
                            Penyesuaian Stok: {material?.name}
                        </DialogTitle>
                        <DialogDescription>
                            Lakukan penyesuaian stok FIFO untuk material ini. Stok saat ini (FIFO): {material?.stock} {material?.unit}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="type">Tipe Penyesuaian</Label>
                                <Controller
                                    name="type"
                                    control={control}
                                    render={({ field }) => (
                                        <Select value={field.value} onValueChange={field.onChange}>
                                            <SelectTrigger id="type">
                                                <SelectValue placeholder="Pilih tipe" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="IN">Stok Masuk (+)</SelectItem>
                                                <SelectItem value="OUT">Stok Keluar (-)</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    )}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="quantity">Jumlah ({material?.unit})</Label>
                                <Controller
                                    name="quantity"
                                    control={control}
                                    render={({ field }) => (
                                        <NumberInput
                                            id="quantity"
                                            value={field.value}
                                            onChange={(value) => field.onChange(value || 1)}
                                            min={0.01}
                                            decimalPlaces={2}
                                        />
                                    )}
                                />
                                {errors.quantity && <p className="text-red-500 text-sm">{errors.quantity.message}</p>}
                            </div>
                        </div>

                        {selectedType === 'IN' && (
                            <div className="space-y-2">
                                <Label htmlFor="unitCost">Harga Beli per Unit (Opsional)</Label>
                                <Controller
                                    name="unitCost"
                                    control={control}
                                    render={({ field }) => (
                                        <NumberInput
                                            id="unitCost"
                                            value={field.value}
                                            onChange={(value) => field.onChange(value || 0)}
                                            min={0}
                                            decimalPlaces={2}
                                        />
                                    )}
                                />
                            </div>
                        )}

                        <div className="space-y-2">
                            <Label htmlFor="reason">Alasan / Catatan</Label>
                            <Controller
                                name="reason"
                                control={control}
                                render={({ field }) => (
                                    <Textarea
                                        id="reason"
                                        placeholder="Contoh: Koreksi opname, barang rusak, sampel, dll."
                                        {...field}
                                    />
                                )}
                            />
                            {errors.reason && <p className="text-red-500 text-sm">{errors.reason.message}</p>}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button
                            type="submit"
                            className={selectedType === 'OUT' ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}
                            disabled={adjustStockMutation.isPending}
                        >
                            {adjustStockMutation.isPending ? "Memproses..." : "Simpan Penyesuaian"}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    )
}
