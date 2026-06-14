export type MaterialType = 'Stock' | 'Beli' | 'Jasa';

export interface Material {
  id: string;
  name: string;
  barcode?: string;
  type: MaterialType; // Stock (punya stok), Beli (konsumsi/usage tracking), Jasa (layanan)
  unit: string; // satuan (meter, lembar, kg, etc)
  pricePerUnit: number;
  stock: number;
  minStock: number;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}