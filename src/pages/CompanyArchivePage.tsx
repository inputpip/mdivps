"use client"

import { useState, useRef, useMemo } from "react"
import { useAuth } from "@/hooks/useAuth"
import { useBranch } from "@/contexts/BranchContext"
import { supabase } from "@/integrations/supabase/client"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import {
  FolderArchive,
  Upload,
  Download,
  Trash2,
  FileText,
  FileSpreadsheet,
  Search,
  Plus,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Edit2,
  Lock,
} from "lucide-react"
import { format } from "date-fns"
import { id } from "date-fns/locale/id"

// ─── Konstanta ────────────────────────────────────────────────────────────────
const ALLOWED_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]
const ALLOWED_EXT = [".pdf", ".xlsx", ".xls"]

const CATEGORIES = ["Legalitas", "Keuangan", "SDM", "Kontrak", "Izin Usaha", "Operasional", "Lainnya"]

// ─── Types ────────────────────────────────────────────────────────────────────
interface CompanyDocument {
  id: string
  name: string
  description: string | null
  category: string
  file_name: string
  file_type: string
  file_size: number
  file_data: string   // base64
  branch_id: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fileTypeIcon(fileType: string) {
  if (fileType === "application/pdf") return <FileText className="h-5 w-5 text-red-500" />
  return <FileSpreadsheet className="h-5 w-5 text-green-600" />
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

function categoryColor(cat: string) {
  const map: Record<string, string> = {
    "Legalitas": "bg-blue-100 text-blue-800",
    "Keuangan": "bg-amber-100 text-amber-800",
    "SDM": "bg-purple-100 text-purple-800",
    "Kontrak": "bg-slate-100 text-slate-800",
    "Izin Usaha": "bg-green-100 text-green-800",
    "Operasional": "bg-teal-100 text-teal-800",
    "Lainnya": "bg-gray-100 text-gray-700",
  }
  return map[cat] ?? "bg-gray-100 text-gray-700"
}

// ─── Upload Dialog ─────────────────────────────────────────────────────────────
interface UploadFormProps {
  onClose: () => void
  editDoc?: CompanyDocument | null
}

function UploadForm({ onClose, editDoc }: UploadFormProps) {
  const { user } = useAuth()
  const { currentBranch } = useBranch()
  const { toast } = useToast()
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name, setName] = useState(editDoc?.name ?? "")
  const [description, setDescription] = useState(editDoc?.description ?? "")
  const [category, setCategory] = useState(editDoc?.category ?? "Lainnya")
  const [fileInfo, setFileInfo] = useState<{ base64: string; name: string; type: string; size: number } | null>(null)
  const [fileError, setFileError] = useState("")
  const [saving, setSaving] = useState(false)

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError("")
    const file = e.target.files?.[0]
    if (!file) return

    // Validate type — hanya PDF dan Excel
    if (!ALLOWED_TYPES.includes(file.type)) {
      setFileError("Hanya file PDF atau Excel (.xlsx/.xls) yang diizinkan.")
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1]
      setFileInfo({ base64, name: file.name, type: file.type, size: file.size })
      if (!name) setName(file.name.replace(/\.[^.]+$/, ""))
    }
    reader.readAsDataURL(file)
  }

  const handleSave = async () => {
    if (!name.trim()) { toast({ variant: "destructive", title: "Nama berkas wajib diisi" }); return }
    if (!editDoc && !fileInfo) { toast({ variant: "destructive", title: "Pilih file terlebih dahulu" }); return }

    setSaving(true)
    try {
      const payload: any = {
        name: name.trim(),
        description: description.trim() || null,
        category,
        branch_id: currentBranch?.id ?? null,
        updated_at: new Date().toISOString(),
      }
      if (fileInfo) {
        payload.file_name = fileInfo.name
        payload.file_type = fileInfo.type
        payload.file_size = fileInfo.size
        payload.file_data = fileInfo.base64
      }

      if (editDoc) {
        const { error } = await supabase.from("company_documents").update(payload).eq("id", editDoc.id)
        if (error) throw error
        toast({ title: "✅ Berkas berhasil diperbarui" })
      } else {
        payload.created_by = user?.id ?? null
        payload.created_at = new Date().toISOString()
        const { error } = await supabase.from("company_documents").insert(payload)
        if (error) throw error
        toast({ title: "✅ Berkas berhasil diupload" })
      }
      qc.invalidateQueries({ queryKey: ["company_documents"] })
      onClose()
    } catch (err: any) {
      toast({ variant: "destructive", title: "Gagal menyimpan", description: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg p-6 space-y-4 mx-4">
        <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
          <Upload className="h-5 w-5 text-indigo-600" />
          {editDoc ? "Edit Berkas" : "Upload Berkas Baru"}
        </h2>

        {/* Name */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Nama Berkas *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="cth: SIUP Perusahaan 2025" />
        </div>

        {/* Description */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Keterangan</label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="opsional" />
        </div>

        {/* Category */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">Kategori</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {/* File Upload */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1 block">
            File {editDoc ? "(kosongkan jika tidak diganti)" : "*"}
          </label>
          <div
            className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-xl p-4 text-center cursor-pointer hover:border-indigo-400 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {fileInfo ? (
              <div className="flex items-center justify-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                {fileTypeIcon(fileInfo.type)}
                <span className="font-medium">{fileInfo.name}</span>
                <span className="text-muted-foreground">({formatBytes(fileInfo.size)})</span>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <Upload className="h-6 w-6 mx-auto mb-1 text-slate-400" />
                Klik untuk pilih file <span className="font-medium text-indigo-600">PDF atau Excel</span>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={ALLOWED_EXT.join(",")}
            className="hidden"
            onChange={handleFile}
          />
          {fileError && <p className="text-xs text-red-500 mt-1">{fileError}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
          <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
            {editDoc ? "Perbarui" : "Upload"}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function CompanyArchivePage() {
  const { user } = useAuth()
  const { currentBranch } = useBranch()
  const { toast } = useToast()
  const qc = useQueryClient()

  const [search, setSearch] = useState("")
  const [filterCat, setFilterCat] = useState("all")
  const [showUpload, setShowUpload] = useState(false)
  const [editDoc, setEditDoc] = useState<CompanyDocument | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // ── Owner-only guard ──────────────────────────────────────────────────────
  if (user?.role !== "owner") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center p-8">
        <div className="w-20 h-20 rounded-full bg-red-100 flex items-center justify-center">
          <Lock className="h-10 w-10 text-red-500" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Akses Dibatasi</h2>
        <p className="text-slate-500 max-w-sm">
          Halaman Arsip Berkas Perusahaan hanya dapat diakses oleh <strong>Owner</strong>.
        </p>
      </div>
    )
  }

  // ── Fetch docs ────────────────────────────────────────────────────────────
  const { data: docs = [], isLoading, refetch } = useQuery<CompanyDocument[]>({
    queryKey: ["company_documents", currentBranch?.id],
    queryFn: async () => {
      let q = supabase
        .from("company_documents")
        .select("id,name,description,category,file_name,file_type,file_size,file_data,branch_id,created_at,updated_at,created_by")
        .order("created_at", { ascending: false })
      if (currentBranch?.id) q = q.eq("branch_id", currentBranch.id)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
    staleTime: 30_000,
  })

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = async (doc: CompanyDocument) => {
    if (!confirm(`Hapus berkas "${doc.name}"? Tindakan ini tidak dapat dibatalkan.`)) return
    setDeletingId(doc.id)
    const { error } = await supabase.from("company_documents").delete().eq("id", doc.id)
    setDeletingId(null)
    if (error) { toast({ variant: "destructive", title: "Gagal hapus", description: error.message }); return }
    toast({ title: "🗑️ Berkas dihapus" })
    qc.invalidateQueries({ queryKey: ["company_documents"] })
  }

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = (doc: CompanyDocument) => {
    try {
      const byteChars = atob(doc.file_data)
      const byteArr = new Uint8Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i)
      const blob = new Blob([byteArr], { type: doc.file_type })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = doc.file_name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ variant: "destructive", title: "Gagal download file" })
    }
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return docs.filter(d => {
      const matchSearch = d.name.toLowerCase().includes(search.toLowerCase()) ||
        (d.description ?? "").toLowerCase().includes(search.toLowerCase())
      const matchCat = filterCat === "all" || d.category === filterCat
      return matchSearch && matchCat
    })
  }, [docs, search, filterCat])

  // ── Stats ─────────────────────────────────────────────────────────────────
  const totalSize = docs.reduce((s, d) => s + (d.file_size ?? 0), 0)

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <Card className="bg-gradient-to-r from-indigo-700 to-slate-800 text-white border-0 shadow-xl">
          <CardHeader className="py-6 px-6">
            <CardTitle className="flex items-center gap-3 text-2xl font-bold">
              <FolderArchive className="h-8 w-8" />
              Arsip Berkas Perusahaan
            </CardTitle>
            <CardDescription className="text-indigo-200 text-base mt-1">
              Kelola dokumen resmi perusahaan — hanya dapat diakses Owner
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Berkas", value: docs.length, color: "text-indigo-600" },
            { label: "Total Ukuran", value: formatBytes(totalSize), color: "text-slate-700" },
            { label: "Kategori", value: new Set(docs.map(d => d.category)).size, color: "text-teal-600" },
            { label: "Cabang", value: currentBranch?.name ?? "Semua", color: "text-amber-600" },
          ].map(s => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className={`text-xl font-bold mt-1 ${s.color}`}>{s.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Toolbar */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-center justify-between">
              <div className="flex gap-2 flex-1 min-w-0">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Cari nama berkas..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
                <Select value={filterCat} onValueChange={setFilterCat}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Semua Kategori" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Semua Kategori</SelectItem>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4 mr-1" /> Refresh
                </Button>
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  onClick={() => { setEditDoc(null); setShowUpload(true) }}
                >
                  <Plus className="h-4 w-4 mr-1" /> Upload Berkas
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Document List */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              Daftar Berkas
              <Badge variant="outline" className="ml-auto">{filtered.length} berkas</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-16 text-muted-foreground">
                <FolderArchive className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Belum ada berkas</p>
                <p className="text-sm mt-1">Klik "Upload Berkas" untuk menambahkan dokumen pertama</p>
              </div>
            ) : (
              <div className="divide-y">
                {filtered.map(doc => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                  >
                    {/* Icon */}
                    <div className="flex-shrink-0">{fileTypeIcon(doc.file_type)}</div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-800 dark:text-white truncate">{doc.name}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor(doc.category)}`}>
                          {doc.category}
                        </span>
                      </div>
                      {doc.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">{doc.description}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{doc.file_name}</span>
                        <span>·</span>
                        <span>{formatBytes(doc.file_size ?? 0)}</span>
                        <span>·</span>
                        <span>Upload: {format(new Date(doc.created_at), "dd MMM yyyy", { locale: id })}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex-shrink-0 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        onClick={() => handleDownload(doc)}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setEditDoc(doc); setShowUpload(true) }}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-500 border-red-200 hover:bg-red-50"
                        onClick={() => handleDelete(doc)}
                        disabled={deletingId === doc.id}
                      >
                        {deletingId === doc.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Info Box */}
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-4 flex gap-3 items-start">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-amber-800 dark:text-amber-300">
              <p className="font-semibold mb-1">Ketentuan Upload Berkas</p>
              <ul className="list-disc pl-4 space-y-0.5 text-xs">
                <li>Format yang diizinkan: <strong>PDF</strong> dan <strong>Excel (.xlsx / .xls)</strong></li>
                <li>Berkas disimpan secara terenkripsi di database</li>
                <li>Hanya <strong>Owner</strong> yang dapat mengakses, upload, dan menghapus berkas</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upload / Edit Modal */}
      {showUpload && (
        <UploadForm
          editDoc={editDoc}
          onClose={() => { setShowUpload(false); setEditDoc(null) }}
        />
      )}
    </div>
  )
}
