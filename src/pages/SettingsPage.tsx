"use client"
import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { Upload, Image as ImageIcon, MapPin, Printer } from 'lucide-react'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { TelegramSettings } from '@/components/TelegramSettings'
import { compressImage } from '@/utils/imageCompression'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/hooks/useAuth'
import { VPSServerSettings } from '@/components/VPSServerSettings'
import { isOwner } from '@/utils/roleUtils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import BranchManagementPage from './BranchManagementPage'
import { INDONESIA_TIMEZONES } from '@/utils/officeTime'
import { FeatureSettings } from '@/components/FeatureSettings'

export default function SettingsPage() {
  const { settings, isLoading, updateSettings } = useCompanySettings();
  const { toast } = useToast();
  const { user } = useAuth();

  const [localInfo, setLocalInfo] = useState({
    name: '',
    address: '',
    phone: '',
    logo: '',
    latitude: null as number | null,
    longitude: null as number | null,
    attendanceRadius: 50 as number | null,
    timezone: 'Asia/Jakarta',
    bankAccount1: '',
    bankAccountName1: '',
    bankAccount2: '',
    bankAccountName2: '',
    bankAccount3: '',
    bankAccountName3: '',
    salesPhone: '',
    thermalPrinterWidth: '58mm' as '58mm' | '80mm',
    npwp: '',
  });

  useEffect(() => {
    if (settings) {
      setLocalInfo({
        name: settings.name || '',
        address: settings.address || '',
        phone: settings.phone || '',
        logo: settings.logo || '',
        latitude: settings.latitude || null,
        longitude: settings.longitude || null,
        attendanceRadius: settings.attendanceRadius || 50,
        timezone: settings.timezone || 'Asia/Jakarta',
        bankAccount1: settings.bankAccount1 || '',
        bankAccountName1: settings.bankAccountName1 || '',
        bankAccount2: settings.bankAccount2 || '',
        bankAccountName2: settings.bankAccountName2 || '',
        bankAccount3: settings.bankAccount3 || '',
        bankAccountName3: settings.bankAccountName3 || '',
        salesPhone: settings.salesPhone || '',
        thermalPrinterWidth: settings.thermalPrinterWidth || '58mm',
        npwp: settings.npwp || '',
      });
    }
  }, [settings]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setLocalInfo(prev => ({ ...prev, [id]: value }));
  };

  const handleNumberInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { id, value } = e.target;
    setLocalInfo(prev => ({ ...prev, [id]: value === '' ? null : Number(value) }));
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        // Compress image to max 100KB
        const compressedFile = await compressImage(file, 100);
        console.log(`Logo compressed: ${(file.size / 1024).toFixed(1)}KB -> ${(compressedFile.size / 1024).toFixed(1)}KB`);

        const reader = new FileReader();
        reader.onloadend = () => {
          setLocalInfo(prev => ({ ...prev, logo: reader.result as string }));
          toast({ title: "Logo berhasil diupload", description: `Ukuran: ${(compressedFile.size / 1024).toFixed(1)}KB` });
        };
        reader.readAsDataURL(compressedFile);
      } catch (error) {
        console.error('Error compressing logo:', error);
        toast({ variant: "destructive", title: "Gagal", description: "Gagal mengkompresi gambar" });
      }
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({ variant: "destructive", title: "Gagal", description: "Geolocation tidak didukung oleh browser ini." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocalInfo(prev => ({
          ...prev,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }));
        toast({ title: "Sukses", description: "Lokasi saat ini berhasil didapatkan." });
      },
      () => {
        toast({ variant: "destructive", title: "Gagal", description: "Tidak dapat mengambil lokasi. Pastikan Anda memberikan izin." });
      }
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwner(user)) {
      toast({ variant: "destructive", title: "Akses Ditolak", description: "Hanya Owner yang dapat mengubah info perusahaan." });
      return;
    }
    updateSettings.mutate(localInfo as any, {
      onSuccess: () => {
        toast({ title: "Sukses", description: "Informasi perusahaan berhasil diperbarui." });
      },
      onError: (error) => {
        toast({ variant: "destructive", title: "Gagal", description: error.message });
      }
    });
  };

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />
  }

  return (
    <div className="space-y-6">
      <Tabs defaultValue="company" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="company">Company</TabsTrigger>
          <TabsTrigger value="features">Feature Settings</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
          <TabsTrigger value="telegram">Telegram</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="company">
          <form onSubmit={handleSubmit}>
            <Card>
              <CardHeader>
                <CardTitle>Pengaturan Perusahaan</CardTitle>
                <CardDescription>
                  Atur informasi, logo, dan lokasi kantor untuk fitur absensi.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid md:grid-cols-3 gap-6">
                  {/* Kolom 1: Info Dasar */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Nama Perusahaan</Label>
                      <Input id="name" value={localInfo.name} onChange={handleInputChange} placeholder="Contoh: Percetakan Maju Jaya" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="address">Alamat</Label>
                      <Textarea id="address" value={localInfo.address} onChange={handleInputChange} placeholder="Contoh: Jl. Pahlawan No. 123" rows={2} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="phone">Nomor Telepon Kantor</Label>
                      <Input id="phone" value={localInfo.phone} onChange={handleInputChange} placeholder="0812-3456-7890" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="salesPhone">Nomor HP Sales</Label>
                      <Input id="salesPhone" value={localInfo.salesPhone} onChange={handleInputChange} placeholder="0813-4470-7573" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="npwp">NPWP (Jika ada)</Label>
                      <Input id="npwp" value={localInfo.npwp} onChange={handleInputChange} placeholder="XX.XXX.XXX.X-XXX.XXX" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timezone">Zona Waktu</Label>
                      <Select value={localInfo.timezone} onValueChange={(value) => setLocalInfo(prev => ({ ...prev, timezone: value }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih zona waktu" />
                        </SelectTrigger>
                        <SelectContent>
                          {INDONESIA_TIMEZONES.map((tz) => (
                            <SelectItem key={tz.value} value={tz.value}>
                              {tz.label} ({tz.offset})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Kolom 2: Rekening Bank */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="bankAccount1">Rekening 1</Label>
                      <Input id="bankAccount1" value={localInfo.bankAccount1} onChange={handleInputChange} placeholder="MANDIRI-1540020855197" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccountName1">A.N Rekening 1</Label>
                      <Input id="bankAccountName1" value={localInfo.bankAccountName1} onChange={handleInputChange} placeholder="CV. PERSADA INTIM PUSAKA" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccount2">Rekening 2</Label>
                      <Input id="bankAccount2" value={localInfo.bankAccount2} onChange={handleInputChange} placeholder="BNI-2990213245" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccountName2">A.N Rekening 2</Label>
                      <Input id="bankAccountName2" value={localInfo.bankAccountName2} onChange={handleInputChange} placeholder="CV. PERSADA INTIM PUSAKA" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccount3">Rekening 3</Label>
                      <Input id="bankAccount3" value={localInfo.bankAccount3} onChange={handleInputChange} placeholder="BRI-777201000033304" noFormat />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="bankAccountName3">A.N Rekening 3</Label>
                      <Input id="bankAccountName3" value={localInfo.bankAccountName3} onChange={handleInputChange} placeholder="CV. PERSADA INTIM PUSAKA" noFormat />
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Rekening ini akan tampil di faktur cetak (PDF, Dot Matrix, Thermal)
                    </p>
                  </div>

                  {/* Kolom 3: Logo */}
                  <div className="space-y-2">
                    <Label>Logo Perusahaan</Label>
                    <div className="border-2 border-dashed rounded-lg p-4 flex flex-col items-center justify-center text-center">
                      {localInfo.logo ? (
                        <img src={localInfo.logo} alt="Logo Preview" className="max-h-20 mb-2" />
                      ) : (
                        <div className="mb-2 text-muted-foreground">
                          <ImageIcon className="mx-auto h-8 w-8" />
                          <p className="text-xs">Belum ada logo</p>
                        </div>
                      )}
                      <Button asChild variant="outline" size="sm">
                        <label htmlFor="logo-upload" className="cursor-pointer">
                          <Upload className="mr-2 h-3 w-3" />
                          {localInfo.logo ? 'Ganti' : 'Unggah'}
                          <input id="logo-upload" type="file" className="sr-only" accept="image/*" onChange={handleLogoUpload} />
                        </label>
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">PNG, JPG, GIF</p>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t">
                  <CardTitle className="text-lg mb-2">Pengaturan Absensi Lokasi</CardTitle>
                  <CardDescription className="mb-4">
                    Tetapkan titik koordinat pusat dan radius toleransi untuk lokasi kantor yang dianggap sah untuk absensi.
                  </CardDescription>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="latitude">Latitude</Label>
                      <Input id="latitude" type="number" step="any" value={localInfo.latitude ?? ''} onChange={handleNumberInputChange} placeholder="-6.200000" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="longitude">Longitude</Label>
                      <Input id="longitude" type="number" step="any" value={localInfo.longitude ?? ''} onChange={handleNumberInputChange} placeholder="106.816666" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="attendanceRadius">Radius Toleransi (meter)</Label>
                      <Input id="attendanceRadius" type="number" value={localInfo.attendanceRadius ?? ''} onChange={handleNumberInputChange} placeholder="50" />
                    </div>
                  </div>
                  <Button type="button" variant="secondary" onClick={handleGetCurrentLocation} className="mt-4">
                    <MapPin className="mr-2 h-4 w-4" /> Gunakan Lokasi Saat Ini
                  </Button>
                </div>

                <div className="pt-6 border-t">
                  <CardTitle className="text-lg mb-2 flex items-center gap-2">
                    <Printer className="h-5 w-5" /> Pengaturan Printer Thermal
                  </CardTitle>
                  <CardDescription className="mb-4">
                    Atur ukuran kertas thermal untuk cetak struk via RawBT atau printer thermal lainnya.
                  </CardDescription>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="thermalPrinterWidth">Ukuran Kertas Thermal</Label>
                      <Select
                        value={localInfo.thermalPrinterWidth}
                        onValueChange={(value: '58mm' | '80mm') => setLocalInfo(prev => ({ ...prev, thermalPrinterWidth: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Pilih ukuran kertas" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="58mm">58mm (Kecil/Mobile)</SelectItem>
                          <SelectItem value="80mm">80mm (Standar Kasir)</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        58mm = 32 karakter/baris, 80mm = 48 karakter/baris
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end pt-6 border-t">
                  <Button type="submit" disabled={updateSettings.isPending}>
                    {updateSettings.isPending ? "Menyimpan..." : "Simpan Semua Perubahan"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </form>
        </TabsContent>

        <TabsContent value="features" className="space-y-6">
          <FeatureSettings />
        </TabsContent>

        <TabsContent value="branches" className="space-y-6">
          <BranchManagementPage />
        </TabsContent>

        <TabsContent value="telegram" className="space-y-6">
          <TelegramSettings />
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <VPSServerSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}