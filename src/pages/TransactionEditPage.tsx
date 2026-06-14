import { Link, useParams } from "react-router-dom"
import { ArrowLeft, Ban, FileText } from "lucide-react"

import PageLoader from "@/components/PageLoader"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useTransactions } from "@/hooks/useTransactions"

export default function TransactionEditPage() {
  const { id } = useParams<{ id: string }>()
  const { transactions, isLoading } = useTransactions()

  if (isLoading) {
    return <PageLoader />
  }

  const transaction = transactions?.find((item) => item.id === id)

  if (!transaction) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Button asChild variant="outline">
          <Link to="/transactions">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke Transaksi
          </Link>
        </Button>

        <Card>
          <CardHeader>
            <CardTitle>Transaksi Tidak Ditemukan</CardTitle>
            <CardDescription>
              Data transaksi yang ingin diedit tidak tersedia di branch aktif.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold md:text-3xl">Edit Transaksi</h1>
          <p className="text-muted-foreground">Order #{transaction.id}</p>
        </div>

        <Button asChild variant="outline">
          <Link to={`/transactions/${transaction.id}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke Detail
          </Link>
        </Button>
      </div>

      <Card className="border-amber-200 bg-amber-50/60">
        <CardHeader>
          <div className="flex items-center gap-2 text-amber-700">
            <Ban className="h-5 w-5" />
            <CardTitle className="text-amber-800">Fitur Masih Dinonaktifkan</CardTitle>
          </div>
          <CardDescription className="text-amber-700">
            Halaman edit sudah dipisah dari tabel transaksi, tetapi akses edit belum dibuka lagi
            sampai sinkronisasi stok, jurnal, pembayaran, dan pengantaran dinyatakan aman.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-amber-900">
          <p>Ringkasan transaksi:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Pelanggan: {transaction.customerName}</li>
            <li>Status: {transaction.status}</li>
            <li>Total: {new Intl.NumberFormat("id-ID").format(transaction.total)}</li>
            <li>Laku kantor: {transaction.isOfficeSale ? "Ya" : "Tidak"}</li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Rencana Fase Berikutnya</CardTitle>
          </div>
          <CardDescription>
            Langkah berikutnya adalah memindahkan form edit lama ke modul reusable dan
            menambahkan business guard terpusat sebelum fitur ini dihidupkan kembali.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
