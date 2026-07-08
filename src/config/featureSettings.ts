export type AppFeatureKey =
  | 'delivery'
  | 'delivery_reports'
  | 'production_bom'
  | 'purchase_orders'
  | 'quotations'
  | 'projects'
  | 'retasi'
  | 'sales_reports'
  | 'assets_maintenance'
  | 'zakat'
  | 'tax'
  | 'attendance';

export interface AppFeatureSetting {
  key: AppFeatureKey;
  label: string;
  description: string;
  category: 'Operasional' | 'Produksi' | 'Keuangan' | 'SDM';
  affectsJournal: boolean;
  impacts: string[];
  defaultEnabled: boolean;
}

export type ProductionWorkflowMode = 'stock' | 'order_based' | 'hybrid';

export interface AppFeatureToggleState {
  enabled: boolean;
  notes?: string;
  productionMode?: ProductionWorkflowMode;
}

export type AppFeatureSettingsMap = Record<AppFeatureKey, AppFeatureToggleState>;

export const APP_FEATURE_DEFINITIONS: AppFeatureSetting[] = [
  {
    key: 'delivery',
    label: 'Pengantaran',
    description: 'Mengaktifkan menu, route, dan alur pengantaran barang ke pelanggan.',
    category: 'Operasional',
    affectsJournal: true,
    impacts: ['Menu Pengantaran', 'POS Supir', 'Section delivery di detail transaksi'],
    defaultEnabled: true,
  },
  {
    key: 'delivery_reports',
    label: 'Laporan Pengantaran',
    description: 'Mengaktifkan menu dan route laporan pengantaran / lapor antar.',
    category: 'Operasional',
    affectsJournal: false,
    impacts: ['Menu Lapor Antar', 'Route delivery report desktop', 'Route delivery report mobile'],
    defaultEnabled: true,
  },
  {
    key: 'production_bom',
    label: 'Produksi BOM',
    description: 'Mengaktifkan konsumsi bahan baku dan alur produksi berbasis BOM.',
    category: 'Produksi',
    affectsJournal: true,
    impacts: ['Produksi', 'Pemakaian bahan', 'Mutasi persediaan produksi'],
    defaultEnabled: true,
  },
  {
    key: 'purchase_orders',
    label: 'Purchase Order',
    description: 'Mengaktifkan pembuatan, penerimaan, dan kontrol purchase order.',
    category: 'Keuangan',
    affectsJournal: true,
    impacts: ['Supplier', 'Purchase Order', 'Penerimaan barang'],
    defaultEnabled: true,
  },
  {
    key: 'quotations',
    label: 'Penawaran',
    description: 'Mengaktifkan jalur penawaran sebelum order masuk sebagai transaksi.',
    category: 'Operasional',
    affectsJournal: false,
    impacts: ['Menu Penawaran', 'Route quotation list/new', 'Konversi penawaran ke transaksi'],
    defaultEnabled: true,
  },
  {
    key: 'projects',
    label: 'Proyek',
    description: 'Menyiapkan pengelompokan transaksi atau pekerjaan per proyek.',
    category: 'Operasional',
    affectsJournal: true,
    impacts: ['Tag proyek', 'Laporan proyek', 'Grouping transaksi'],
    defaultEnabled: true,
  },
  {
    key: 'retasi',
    label: 'Retasi',
    description: 'Mengaktifkan menu dan alur retasi pengembalian/penolakan distribusi.',
    category: 'Operasional',
    affectsJournal: true,
    impacts: ['Menu Retasi', 'Route retasi', 'Event jurnal retasi'],
    defaultEnabled: true,
  },
  {
    key: 'sales_reports',
    label: 'Laporan Sales',
    description: 'Mengaktifkan menu dan route laporan sales pada web biasa maupun web mobile.',
    category: 'Operasional',
    affectsJournal: false,
    impacts: ['Menu Laporan Sales', 'Route sales report desktop', 'Route sales report mobile'],
    defaultEnabled: true,
  },
  {
    key: 'assets_maintenance',
    label: 'Aset & Maintenance',
    description: 'Mengaktifkan pencatatan aset tetap dan jadwal maintenance.',
    category: 'Keuangan',
    affectsJournal: true,
    impacts: ['Aset', 'Maintenance', 'Jurnal aset'],
    defaultEnabled: true,
  },
  {
    key: 'zakat',
    label: 'Zakat',
    description: 'Mengaktifkan pencatatan zakat dan sedekah perusahaan.',
    category: 'Keuangan',
    affectsJournal: true,
    impacts: ['Menu zakat', 'Posting zakat', 'Laporan zakat'],
    defaultEnabled: true,
  },
  {
    key: 'tax',
    label: 'Pajak',
    description: 'Mengaktifkan pengelolaan pajak seperti PPN dan pembayaran pajak.',
    category: 'Keuangan',
    affectsJournal: true,
    impacts: ['Menu pajak', 'PPN transaksi', 'Jurnal pajak'],
    defaultEnabled: true,
  },
  {
    key: 'attendance',
    label: 'Absensi',
    description: 'Mengaktifkan absensi karyawan berbasis lokasi dan laporan absensi.',
    category: 'SDM',
    affectsJournal: false,
    impacts: ['Menu absensi', 'Laporan absensi', 'Validasi lokasi'],
    defaultEnabled: true,
  },
];

export const createDefaultFeatureSettings = (): AppFeatureSettingsMap => {
  return APP_FEATURE_DEFINITIONS.reduce((acc, feature) => {
    acc[feature.key] = {
      enabled: feature.defaultEnabled,
      notes: '',
      ...(feature.key === 'production_bom' ? { productionMode: 'order_based' as ProductionWorkflowMode } : {}),
    };
    return acc;
  }, {} as AppFeatureSettingsMap);
};

export const mergeFeatureSettings = (
  saved?: Partial<Record<AppFeatureKey, Partial<AppFeatureToggleState>>> | null
): AppFeatureSettingsMap => {
  const defaults = createDefaultFeatureSettings();

  if (!saved) return defaults;

  for (const feature of APP_FEATURE_DEFINITIONS) {
    const savedValue = saved[feature.key];
    if (!savedValue) continue;

    defaults[feature.key] = {
      enabled: typeof savedValue.enabled === 'boolean' ? savedValue.enabled : defaults[feature.key].enabled,
      notes: typeof savedValue.notes === 'string' ? savedValue.notes : defaults[feature.key].notes,
      productionMode: feature.key === 'production_bom' && isProductionWorkflowMode(savedValue.productionMode)
        ? savedValue.productionMode
        : defaults[feature.key].productionMode,
    };
  }

  return defaults;
};

export const isProductionWorkflowMode = (value: unknown): value is ProductionWorkflowMode => {
  return value === 'stock' || value === 'order_based' || value === 'hybrid';
};

export const isFeatureEnabled = (
  settings: Partial<AppFeatureSettingsMap> | null | undefined,
  featureKey: AppFeatureKey
): boolean => {
  return mergeFeatureSettings(settings as Partial<Record<AppFeatureKey, Partial<AppFeatureToggleState>>> | null)[featureKey].enabled;
};

export const getProductionWorkflowMode = (
  settings: Partial<AppFeatureSettingsMap> | null | undefined
): ProductionWorkflowMode => {
  return mergeFeatureSettings(settings as Partial<Record<AppFeatureKey, Partial<AppFeatureToggleState>>> | null).production_bom.productionMode || 'order_based';
};
