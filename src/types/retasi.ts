export interface Retasi {
  id: string;
  retasi_number: string;
  truck_number?: string;
  driver_name?: string;
  helper_id?: string;
  helper_name?: string;
  helper_id_2?: string;
  helper_name_2?: string;
  helper_id_3?: string;
  helper_name_3?: string;
  departure_date: Date;
  departure_time?: string;
  route?: string;
  total_items: number;
  total_weight?: number;
  notes?: string;
  retasi_ke: number;
  is_returned: boolean;
  returned_items_count?: number;
  error_items_count?: number;
  barang_laku?: number; // Jumlah barang yang laku terjual
  barang_tidak_laku?: number; // Jumlah barang yang tidak laku (kembali utuh)
  return_notes?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface RetasiItem {
  id: string;
  retasi_id: string;
  delivery_id?: string;
  product_id: string;
  product_name: string;
  quantity: number;
  returned_quantity?: number;
  sold_quantity?: number;
  error_quantity?: number;
  unsold_quantity?: number; // Barang tidak laku (kembali utuh)
  weight?: number;
  volume?: number;
  notes?: string;
  created_at: Date;
}

export interface CreateRetasiItemData {
  product_id: string;
  product_name: string;
  quantity: number;
  weight?: number;
  notes?: string;
}

export interface CreateRetasiData {
  truck_number?: string;
  driver_name?: string;
  helper_id?: string;
  helper_name?: string;
  helper_id_2?: string;
  helper_name_2?: string;
  helper_id_3?: string;
  helper_name_3?: string;
  departure_date: Date;
  departure_time?: string;
  route?: string;
  total_items?: number;
  notes?: string;
  items?: CreateRetasiItemData[];
}

export interface UpdateRetasiData {
  truck_number?: string;
  driver_name?: string;
  helper_id?: string;
  helper_name?: string;
  helper_id_2?: string;
  helper_name_2?: string;
  helper_id_3?: string;
  helper_name_3?: string;
  departure_date?: Date;
  departure_time?: string;
  route?: string;
  total_items?: number;
  total_weight?: number;
  notes?: string;
  is_returned?: boolean;
  returned_items_count?: number;
  error_items_count?: number;
  barang_laku?: number;
  barang_tidak_laku?: number;
  return_notes?: string;
}

export interface ReturnItemsData {
  returned_items_count: number;
  error_items_count: number;
  barang_laku: number;
  barang_tidak_laku: number;
  return_notes?: string;
  // Detail per produk
  item_returns?: {
    item_id: string;
    product_id: string;
    product_name: string;
    quantity: number; // Jumlah dibawa
    returned_quantity: number;
    sold_quantity: number;
    error_quantity: number;
    unsold_quantity: number;
  }[];
}