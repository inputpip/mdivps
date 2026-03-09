export interface ProductSpecification {
  key: string;
  value: string;
}

export type ProductType = 'Produksi' | 'Jual Langsung';

export interface Product {
  id: string;
  name: string;
  type: ProductType; // Jenis barang (Produksi/Jual Langsung)
  basePrice: number;
  costPrice?: number; // Harga pokok/modal untuk produk Jual Langsung
  unit: string; // Satuan produk
  initialStock: number; // Stock awal untuk balancing
  currentStock: number; // Stock saat ini
  minStock: number; // Stock minimum
  minOrder: number;
  description?: string;
  specifications: ProductSpecification[];
  materials: ProductMaterial[]; // Ini adalah BOM (Bill of Materials)
  branchId?: string; // Branch ID untuk multi-branch support
  isShared?: boolean; // True jika produk dapat digunakan oleh semua cabang
  isActive: boolean; // True jika produk aktif (tampil di POS)
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductMaterial {
  materialId: string;
  quantity: number;
  notes?: string;
}