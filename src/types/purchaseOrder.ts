export type PurchaseOrderStatus = 'Pending' | 'Approved' | 'Dikirim' | 'Diterima' | 'Dibayar' | 'Selesai';

// Purchase Order Item (line item within a PO)
export interface PurchaseOrderItem {
  id?: string;
  purchaseOrderId?: string;
  materialId?: string;  // For material purchases
  productId?: string;   // For "Jual Langsung" product purchases
  itemType?: 'material' | 'product';  // Type of item being purchased
  materialName?: string;
  productName?: string;
  unit?: string; // Satuan pembelian / input PO
  baseUnit?: string; // Satuan dasar stok
  conversionQty?: number; // 1 unit pembelian = X satuan dasar
  baseQuantity?: number; // Qty dasar yang masuk stok
  quantity: number;
  unitPrice: number;
  quantityReceived?: number;
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

// Main Purchase Order (header)
export interface PurchaseOrder {
  id: string;
  poNumber?: string;

  // Supplier info
  supplierId?: string;
  supplierName?: string;
  supplierContact?: string;

  // Dates
  orderDate?: Date;
  expectedDeliveryDate?: Date;
  receivedDate?: Date;
  paymentDate?: Date;
  createdAt: Date;
  updatedAt?: Date;
  approvedAt?: Date;

  // Status and workflow
  status: PurchaseOrderStatus;
  requestedBy: string;
  approvedBy?: string;

  // Financial
  totalCost?: number;
  includePpn?: boolean;
  ppnMode?: 'include' | 'exclude'; // PPN Include = harga sudah termasuk PPN, Exclude = PPN ditambahkan
  ppnAmount?: number;
  subtotal?: number; // Subtotal sebelum PPN
  paymentAccountId?: string;

  // Additional info
  expedition?: string;
  notes?: string;
  branchId?: string;

  // Items (for multi-item PO)
  items?: PurchaseOrderItem[];

  // Legacy fields (for backward compatibility with single-item POs)
  materialId?: string;
  materialName?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  quotedPrice?: number;
}