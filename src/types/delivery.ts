export interface DeliveryItem {
  id: string;
  deliveryId: string;
  productId: string;
  productName: string;
  quantityDelivered: number;
  unit: string;
  width?: number;
  height?: number;
  notes?: string;
  isBonus?: boolean; // Menandai apakah item ini adalah bonus (tidak dihitung komisi)
  orderedQuantity?: number; // Added for history view
  remainingQuantity?: number; // Added for history view
  createdAt: Date;
}

export interface Delivery {
  id: string;
  transactionId: string;
  deliveryNumber: number;
  customerName?: string; // Customer name (stored in delivery for history)
  customerAddress?: string; // Customer address (stored in delivery for history)
  customerPhone?: string; // Customer phone (stored in delivery for history)
  deliveryDate: Date;
  status?: string; // Delivery status (for history)
  photoUrl?: string;
  notes?: string;
  driverId?: string;
  driverName?: string;
  helperId?: string;
  helperName?: string;
  helperId2?: string;
  helperName2?: string;
  helperId3?: string;
  helperName3?: string;
  branchId?: string;
  transactionTotal?: number; // Total nilai order
  cashierName?: string;
  items: DeliveryItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DeliverySummaryItem {
  productId: string;
  productName: string;
  orderedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  unit: string;
  isBonus?: boolean;
  width?: number;
  height?: number;
}

export interface TransactionDeliveryInfo {
  id: string;
  orderNumber: string;
  customerName: string;
  customerAddress?: string; // Alamat pelanggan
  customerPhone?: string;
  totalAmount: number;
  total: number; // Added for compatibility
  orderDate: Date;
  status: string;
  cashierName?: string;
  deliveries: Delivery[];
  deliverySummary: DeliverySummaryItem[];
}

export interface CreateDeliveryRequest {
  transactionId: string;
  deliveryDate: Date;
  notes?: string;
  driverId?: string;
  helperId?: string;
  helperId2?: string;
  helperId3?: string;
  items: {
    productId: string;
    productName: string;
    quantityDelivered: number;
    unit: string;
    width?: number;
    height?: number;
    notes?: string;
    isBonus?: boolean;
  }[];
  photo?: File;
}

export interface DeliveryFormData {
  transactionId: string;
  deliveryDate: string;
  notes: string;
  driverId: string;
  manualDriverName: string;
  helperId: string;
  helperId2: string;
  helperId3: string;
  items: {
    itemId: string; // Unique identifier per item row
    productId: string;
    productName: string;
    isBonus?: boolean;
    orderedQuantity: number;
    deliveredQuantity: number;
    remainingQuantity: number;
    quantityToDeliver: number;
    unit: string;
    width?: number;
    height?: number;
    notes: string;
  }[];
  photo?: File;
}

// Input for creating a delivery (used by useDeliveries hook)
export interface DeliveryInput {
  transactionId: string;
  customerName?: string;
  deliveryDate: Date;
  notes?: string;
  driverId?: string | null;
  driverName?: string;
  helperId?: string;
  helperId2?: string;
  helperId3?: string;
  photoUrl?: string;
  items: {
    productId: string;
    productName: string;
    quantityDelivered: number;
    unit?: string;
    width?: number;
    height?: number;
    notes?: string;
    isBonus?: boolean;
  }[];
  photo?: File;
}

// Input for updating a delivery
export interface DeliveryUpdateInput {
  id: string;
  deliveryDate?: Date;
  notes?: string;
  driverId?: string | null;
  helperId?: string;
  helperId2?: string;
  helperId3?: string;
  photoUrl?: string;
  items: {
    productId: string;
    productName: string;
    quantityDelivered: number;
    unit?: string;
    width?: number;
    height?: number;
    notes?: string;
    isBonus?: boolean;
  }[];
}

// Employee interface for dropdown options
export interface DeliveryEmployee {
  id: string;
  name: string;
  position?: string;
  role: 'supir' | 'helper' | 'kasir' | 'migration';
}
