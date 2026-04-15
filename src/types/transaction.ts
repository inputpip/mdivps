import { Product } from "./product";
import { CustomerClassification } from "./customer";

export interface TransactionItem {
  product: Product;
  width: number;
  height: number;
  quantity: number;
  notes?: string;
  price: number; // Menambahkan harga per item
  unit: string; // Satuan produk (pcs, m, box, etc.)
  designFile?: File | null; // Untuk upload file
  designFileName?: string; // Untuk menyimpan nama file
  isBonus?: boolean; // Menandai apakah item ini adalah bonus (tidak dihitung komisi)
}

export type TransactionStatus =
  | 'Pesanan Masuk'     // Order baru dibuat, siap diantar
  | 'Diantar Sebagian'  // Sebagian sudah diantar
  | 'Selesai'           // Semua sudah berhasil diantar
  | 'Dibatalkan';       // Order dibatalkan

export type PaymentStatus =
  | 'Lunas'             // Sudah dibayar penuh
  | 'Belum Lunas'       // Belum dibayar atau bayar sebagian
  | 'Kredit';           // Pembayaran kredit

// Status delivery untuk tracking pengantaran
export type DeliveryStatus =
  | 'Pending'           // Belum diantar
  | 'In Progress'       // Sedang dalam perjalanan
  | 'Partial'           // Sebagian sudah sampai
  | 'Completed'         // Semua sudah sampai
  | 'Cancelled';        // Pengantaran dibatalkan

export interface Transaction {
  id: string;
  customerId: string;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  customerClassification?: CustomerClassification; // Klasifikasi pelanggan: Rumahan atau Kios/Toko
  cashierId: string;
  cashierName: string;
  salesId?: string | null;
  salesName?: string | null;
  designerId?: string | null;
  operatorId?: string | null;
  paymentAccountId?: string | null;
  retasiId?: string | null; // ID retasi terkait (untuk transaksi driver)
  retasiNumber?: string | null; // Nomor retasi (untuk display)
  branchId?: string; // Branch ID untuk multi-branch support
  orderDate: Date;
  finishDate?: Date | null;
  items: TransactionItem[];
  subtotal: number; // Total sebelum PPN
  ppnEnabled: boolean; // Apakah PPN diaktifkan
  ppnMode?: 'include' | 'exclude'; // Mode PPN: include (sudah termasuk) atau exclude (belum termasuk)
  ppnPercentage: number; // Persentase PPN (default 11)
  ppnAmount: number; // Jumlah PPN dalam rupiah
  total: number; // Total setelah PPN
  paidAmount: number; // Jumlah yang sudah dibayar
  paymentStatus: PaymentStatus; // Status pembayaran
  dueDate?: Date | null; // Tanggal jatuh tempo untuk pembayaran kredit
  status: TransactionStatus;
  notes?: string; // Catatan transaksi
  isOfficeSale?: boolean; // Tandai jika produk laku kantor
  createdAt: Date;
}