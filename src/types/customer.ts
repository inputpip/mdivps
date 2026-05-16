export type CustomerClassification = 'Rumahan' | 'Kios/Toko';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  latitude?: number;
  longitude?: number;
  full_address?: string;
  store_photo_url?: string;
  jumlah_galon_titip?: number; // Jumlah galon yang dititip di pelanggan
  classification?: CustomerClassification; // Klasifikasi pelanggan: Rumahan atau Kios/Toko
  totalPiutang?: number;
  sisaPiutang?: number;
  jumlahPiutang?: number;
  jatuhTempoTerdekat?: string | Date | null;
  orderCount: number; // Menambahkan jumlah orderan
  lastOrderDate?: Date | null; // Tanggal order terakhir
  branchId?: string; // Branch ID untuk multi-branch support
  createdAt: Date;
  // Last gallon movement (from gallon_movements table)
  lastGallonDelta?: number | null; // Delta perubahan terakhir (+: penambahan, -: penarikan)
  lastGallonType?: string | null; // 'addition' | 'withdrawal' | 'adjustment'
  lastGallonChangeAt?: Date | null; // Tanggal perubahan terakhir
}