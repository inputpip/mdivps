"use client"
import { PosForm } from '@/components/PosForm'
import { MobilePosForm } from '@/components/MobilePosForm'
import { useMobileDetection } from '@/hooks/useMobileDetection'

export default function PosPage() {
  const { shouldUseMobileLayout } = useMobileDetection()

  if (shouldUseMobileLayout) {
    return <MobilePosForm />
  }

  return (
    <div className="w-full max-w-none p-4 lg:p-6">
        <div className="sticky top-0 z-30 -mx-4 lg:-mx-6 mb-4 px-4 lg:px-6 pt-4 lg:pt-6 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <div className="bg-primary text-primary-foreground p-4 rounded-t-lg shadow-sm">
                <h1 className="text-xl font-bold">Buat Transaksi Baru</h1>
                <p className="text-sm text-primary-foreground/80">
                    Isi detail pesanan pelanggan pada form di bawah ini.
                </p>
            </div>
        </div>
        <PosForm />
    </div>
  )
}