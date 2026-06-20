"use client"

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { useCompanySettings } from '@/hooks/useCompanySettings'
import { isOwner } from '@/utils/roleUtils'
import {
  APP_FEATURE_DEFINITIONS,
  AppFeatureKey,
  AppFeatureSettingsMap,
  createDefaultFeatureSettings,
  mergeFeatureSettings,
  ProductionWorkflowMode,
} from '@/config/featureSettings'
import { CheckCircle2, FileCog, Workflow } from 'lucide-react'

export function FeatureSettings() {
  const { settings, isLoading, updateSettings } = useCompanySettings()
  const { user } = useAuth()
  const { toast } = useToast()
  const [localSettings, setLocalSettings] = useState<AppFeatureSettingsMap>(createDefaultFeatureSettings())

  useEffect(() => {
    if (settings?.appFeatureSettings) {
      setLocalSettings(mergeFeatureSettings(settings.appFeatureSettings))
      return
    }

    if (settings) {
      setLocalSettings(createDefaultFeatureSettings())
    }
  }, [settings])

  const enabledCount = useMemo(
    () => Object.values(localSettings).filter((feature) => feature.enabled).length,
    [localSettings]
  )

  const handleToggle = (featureKey: AppFeatureKey, enabled: boolean) => {
    setLocalSettings((prev) => ({
      ...prev,
      [featureKey]: {
        ...prev[featureKey],
        enabled,
      },
    }))
  }

  const handleNotesChange = (featureKey: AppFeatureKey, notes: string) => {
    setLocalSettings((prev) => ({
      ...prev,
      [featureKey]: {
        ...prev[featureKey],
        notes,
      },
    }))
  }

  const handleProductionModeChange = (mode: ProductionWorkflowMode) => {
    setLocalSettings((prev) => ({
      ...prev,
      production_bom: {
        ...prev.production_bom,
        productionMode: mode,
      },
    }))
  }

  const handleSave = () => {
    if (!settings) return

    if (!isOwner(user)) {
      toast({
        variant: 'destructive',
        title: 'Akses Ditolak',
        description: 'Hanya Owner yang dapat mengubah Feature Settings.',
      })
      return
    }

    updateSettings.mutate(
      {
        ...settings,
        appFeatureSettings: localSettings,
      },
      {
        onSuccess: () => {
          toast({
            title: 'Sukses',
            description: 'Feature Settings berhasil disimpan.',
          })
        },
        onError: (error) => {
          toast({
            variant: 'destructive',
            title: 'Gagal',
            description: error.message,
          })
        },
      }
    )
  }

  if (isLoading) {
    return <Card><CardContent className="py-12" /></Card>
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCog className="h-5 w-5" />
            Feature Settings
          </CardTitle>
          <CardDescription>
            Aktifkan atau nonaktifkan fitur global aplikasi. Pengaturan ini menjadi dasar untuk menu,
            route, workflow, dan nantinya jalur jurnal custom.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-4 text-sm">
            <Badge variant="secondary">Preset: Default</Badge>
            <span className="text-muted-foreground">
              {enabledCount} dari {APP_FEATURE_DEFINITIONS.length} fitur sedang aktif.
            </span>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {APP_FEATURE_DEFINITIONS.map((feature) => {
              const state = localSettings[feature.key]
              return (
                <Card key={feature.key} className="border-border/70">
                  <CardHeader className="space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <CardTitle className="text-base">{feature.label}</CardTitle>
                        <CardDescription>{feature.description}</CardDescription>
                      </div>
                      <Switch
                        checked={state?.enabled ?? feature.defaultEnabled}
                        onCheckedChange={(checked) => handleToggle(feature.key, checked)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{feature.category}</Badge>
                      <Badge variant={feature.affectsJournal ? 'default' : 'secondary'}>
                        {feature.affectsJournal ? 'Mempengaruhi Jurnal' : 'UI / Workflow Only'}
                      </Badge>
                      <Badge variant={state?.enabled ? 'default' : 'secondary'}>
                        {state?.enabled ? 'Aktif' : 'Nonaktif'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label className="text-sm">Komponen / dampak yang terpengaruh</Label>
                      <div className="space-y-2 rounded-md border bg-muted/20 p-3 text-sm">
                        {feature.impacts.map((impact) => (
                          <div key={impact} className="flex items-start gap-2 text-muted-foreground">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                            <span>{impact}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {feature.key === 'production_bom' && (
                      <div className="space-y-2 rounded-md border bg-muted/20 p-3">
                        <Label>Mode Produksi</Label>
                        <Select
                          value={state?.productionMode || 'order_based'}
                          onValueChange={(value) => handleProductionModeChange(value as ProductionWorkflowMode)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih mode produksi" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="stock">Produksi Stok / Manufaktur Umum</SelectItem>
                            <SelectItem value="order_based">Produksi Berdasarkan Pesanan</SelectItem>
                            <SelectItem value="hybrid">Hybrid</SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          Mode ini mengatur apakah produksi berjalan dari stok, dari antrian pesanan, atau keduanya.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <Label htmlFor={`notes-${feature.key}`}>Catatan internal</Label>
                      <Textarea
                        id={`notes-${feature.key}`}
                        rows={3}
                        value={state?.notes || ''}
                        onChange={(e) => handleNotesChange(feature.key, e.target.value)}
                        placeholder={`Contoh: ${feature.label} tidak dipakai pada operasional aktif.`}
                      />
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <Workflow className="h-4 w-4" />
              Catatan implementasi
            </div>
            <ul className="list-disc space-y-1 pl-5">
              <li>Phase ini baru menyimpan konfigurasi global fitur dari UI.</li>
              <li>Gating menu, route, section, field, dan kolom tabel akan membaca setting ini pada fase berikutnya.</li>
              <li>Event jurnal terkait akan diarahkan dari tab Journal Settings pada tahap lanjutan.</li>
            </ul>
          </div>

          <div className="flex justify-end border-t pt-4">
            <Button onClick={handleSave} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? 'Menyimpan...' : 'Simpan Feature Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
