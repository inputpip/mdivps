import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { ArrowRight, BriefcaseBusiness, CalendarClock, FolderKanban, ReceiptText, Users } from 'lucide-react'

const PROJECT_SUMMARY = [
  {
    title: 'Proyek Aktif',
    value: '3',
    description: 'Pekerjaan yang sedang berjalan',
    icon: FolderKanban,
  },
  {
    title: 'Butuh Follow Up',
    value: '2',
    description: 'Menunggu approval / keputusan',
    icon: CalendarClock,
  },
  {
    title: 'Tim Terlibat',
    value: '6',
    description: 'Sales, desain, produksi, admin',
    icon: Users,
  },
  {
    title: 'Biaya Tercatat',
    value: 'Rp 8.450.000',
    description: 'Expense proyek yang sudah masuk',
    icon: ReceiptText,
  },
] as const

const PROJECT_ROWS = [
  {
    code: 'PRJ-001',
    name: 'Cetak Brosur Promo Ramadhan',
    customer: 'Toko Barokah',
    status: 'Produksi',
    deadline: '18 Juni 2026',
    pic: 'Admin Produksi',
    budget: 'Rp 12.000.000',
    spent: 'Rp 4.250.000',
  },
  {
    code: 'PRJ-002',
    name: 'Banner Opening Cabang Baru',
    customer: 'PT Surya Niaga',
    status: 'Menunggu Approval',
    deadline: '20 Juni 2026',
    pic: 'Tim Desain',
    budget: 'Rp 6.500.000',
    spent: 'Rp 1.200.000',
  },
  {
    code: 'PRJ-003',
    name: 'Kemasan Produk Event Sekolah',
    customer: 'CV Sinar Pelajar',
    status: 'Finishing',
    deadline: '22 Juni 2026',
    pic: 'Supervisor Finishing',
    budget: 'Rp 15.000.000',
    spent: 'Rp 3.000.000',
  },
] as const

const STATUS_BADGE: Record<string, string> = {
  Produksi: 'default',
  'Menunggu Approval': 'secondary',
  Finishing: 'outline',
}

export default function ProjectsPage() {
  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-primary">
            <BriefcaseBusiness className="h-5 w-5" />
            <span className="text-sm font-medium">Modul Proyek</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Proyek</h1>
          <p className="max-w-3xl text-muted-foreground">
            Halaman awal untuk memantau pekerjaan per proyek. Di tahap ini proyek sudah punya page sendiri
            dan siap dijadikan pusat relasi untuk quotation, transaksi, pengeluaran, komisi, dan laporan.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button variant="outline">Tambah Pengeluaran Proyek</Button>
          <Button>
            Buat Proyek
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PROJECT_SUMMARY.map((item) => {
          const Icon = item.icon
          return (
            <Card key={item.title}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{item.title}</CardTitle>
                  <div className="text-2xl font-bold">{item.value}</div>
                </div>
                <Icon className="h-5 w-5 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Daftar Proyek</CardTitle>
            <CardDescription>
              Placeholder operasional awal. Nanti daftar ini bisa dihubungkan ke database proyek sesungguhnya.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {PROJECT_ROWS.map((project, index) => (
              <div key={project.code} className="space-y-4">
                <div className="flex flex-col gap-4 rounded-lg border p-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{project.code}</Badge>
                      <Badge variant={(STATUS_BADGE[project.status] as 'default' | 'secondary' | 'outline') ?? 'secondary'}>
                        {project.status}
                      </Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold">{project.name}</h3>
                      <p className="text-sm text-muted-foreground">{project.customer}</p>
                    </div>
                    <div className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2">
                      <div>Deadline: {project.deadline}</div>
                      <div>PIC: {project.pic}</div>
                      <div>Budget: {project.budget}</div>
                      <div>Biaya masuk: {project.spent}</div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" size="sm">Lihat Detail</Button>
                    <Button size="sm">Tambah Biaya</Button>
                  </div>
                </div>
                {index < PROJECT_ROWS.length - 1 && <Separator />}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rencana Integrasi</CardTitle>
            <CardDescription>Supaya page proyek ini nyambung ke ERP yang sudah ada.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="rounded-lg border p-4">
              <p className="font-medium">Phase 1</p>
              <p className="text-muted-foreground">Master proyek + route + toggle global.</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Phase 2</p>
              <p className="text-muted-foreground">Hubungkan quotation, transaksi, dan pengeluaran ke projectId.</p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-medium">Phase 3</p>
              <p className="text-muted-foreground">Masukkan komisi proyek, produksi, dan laporan margin proyek.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
