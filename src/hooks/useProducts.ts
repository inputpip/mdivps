import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Product } from '@/types/product'
import { supabase } from '@/integrations/supabase/client'
import { logError, logDebug } from '@/utils/debugUtils'
import { useBranch } from '@/contexts/BranchContext'
import { restoreStockFIFO } from '@/services/stockService'
// journalService removed - now using RPC for all journal operations

// Calculate BOM cost for a product (HPP dari materials)
export const calculateBOMCost = async (productId: string): Promise<number> => {
  const { data: bomItems, error } = await supabase
    .from('product_materials')
    .select(`
      quantity,
      materials (price_per_unit)
    `)
    .eq('product_id', productId);

  if (error || !bomItems || bomItems.length === 0) return 0;

  return bomItems.reduce((total, item: any) => {
    const unitPrice = item.materials?.price_per_unit || 0;
    return total + (unitPrice * item.quantity);
  }, 0);
};

// Update product cost_price from BOM calculation
export const updateProductCostFromBOM = async (productId: string): Promise<number> => {
  const totalCost = await calculateBOMCost(productId);

  await supabase
    .from('products')
    .update({ cost_price: totalCost })
    .eq('id', productId);

  return totalCost;
};

// DB to App mapping
const fromDb = (dbProduct: any): Product => ({
  id: dbProduct.id,
  name: dbProduct.name,
  type: dbProduct.type || 'Produksi',
  basePrice: Number(dbProduct.base_price) || 0,
  costPrice: dbProduct.cost_price ? Number(dbProduct.cost_price) : undefined,
  unit: dbProduct.unit || 'pcs',
  initialStock: Number(dbProduct.initial_stock || 0),
  currentStock: Number(dbProduct.current_stock || 0),
  minStock: Number(dbProduct.min_stock || 0),
  isActive: dbProduct.is_active !== false, // default true
  minOrder: Number(dbProduct.min_order) || 1,
  description: dbProduct.description || '',
  specifications: dbProduct.specifications || [],
  materials: dbProduct.materials || [],
  createdAt: new Date(dbProduct.created_at),
  updatedAt: new Date(dbProduct.updated_at),
});

// App to DB mapping
const toDb = (appProduct: Partial<Product>) => {
  const { id, createdAt, updatedAt, basePrice, costPrice, minOrder, initialStock, currentStock, minStock, isActive, ...rest } = appProduct;
  const dbData: any = { ...rest };
  if (basePrice !== undefined) dbData.base_price = basePrice;
  if (costPrice !== undefined) dbData.cost_price = costPrice;
  if (minOrder !== undefined) dbData.min_order = minOrder;
  if (initialStock !== undefined) dbData.initial_stock = initialStock;
  if (currentStock !== undefined) dbData.current_stock = currentStock;
  if (minStock !== undefined) dbData.min_stock = minStock;
  if (appProduct.isActive !== undefined) dbData.is_active = appProduct.isActive;
  delete dbData.category;
  return dbData;
};

export const useProducts = () => {
  const queryClient = useQueryClient();
  const { currentBranch, canAccessAllBranches } = useBranch();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ['products', currentBranch?.id],
    queryFn: async () => {
      // Fetch products
      let query = supabase.from('products').select('*').order('name', { ascending: true });
      if (currentBranch?.id) query = query.eq('branch_id', currentBranch.id);
      const { data, error } = await query;
      if (error) throw new Error(error.message);

      // Fetch actual stock from v_product_current_stock VIEW for the fetched products
      let stockQuery = supabase.from('v_product_current_stock').select('product_id, current_stock');

      if (currentBranch?.id) {
        // Fetch stock for current branch AND global products (branch_id is null)
        stockQuery = stockQuery.or(`branch_id.eq.${currentBranch.id},branch_id.is.null`);
      }

      // If no currentBranch (Head Office/All), fetch all stock (no filter needed)

      const { data: stockData } = await stockQuery;

      // Create stock map for quick lookup
      const stockMap = new Map<string, number>();
      if (stockData) {
        stockData.forEach((s: any) => stockMap.set(s.product_id, Number(s.current_stock) || 0));
      }

      // Map products with actual stock from VIEW
      return data ? data.map(p => {
        const product = fromDb(p);
        // Override current_stock with value from VIEW (source of truth)
        // If not found in view (e.g. new product or global product issue), default to 0
        // DO NOT fallback to product.currentStock as it is deprecated and misleading
        product.currentStock = stockMap.get(p.id) ?? 0;
        return product;
      }) : [];
    },
    enabled: !!currentBranch,
    staleTime: 10 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
    retryDelay: 1000,
  })

  const upsertProduct = useMutation({
    mutationFn: async (product: Partial<Product>): Promise<Product> => {
      const dbData = toDb(product);
      logDebug('Product Upsert', { originalProduct: product, dbData });

      const isUpdate = !!product.id;
      let existing: any = null;

      if (isUpdate) {
        // Validate product.id is actually set
        if (!product.id) {
          throw new Error('Product ID is required for update operation');
        }

        const { data: currentProduct } = await supabase
          .from('products')
          .select('current_stock, initial_stock, cost_price, name')
          .eq('id', product.id)
          .single();
        existing = currentProduct;

        // products.current_stock is DEPRECATED
        delete dbData.current_stock;

        const { data: dataRaw, error } = await supabase
          .from('products')
          .update(dbData)
          .eq('id', product.id)
          .select()
          .single();

        if (error) throw error;
        if (!dataRaw) {
          throw new Error('Failed to get product data from update operation');
        }
      } else {
        // Generate UUID for new product on client side
        const newProductId = crypto.randomUUID();

        const insertData = {
          ...dbData,
          id: newProductId,
          branch_id: currentBranch?.id || null,
        };
        delete insertData.current_stock;

        logDebug('Product Insert', { insertData });

        const { data: dataRaw, error } = await supabase
          .from('products')
          .insert(insertData)
          .select()
          .single();

        logDebug('Product Insert Result', { dataRaw, error });

        if (error) {
          logError('Product Insert Error', { error, insertData });
          throw error;
        }

        // Use the generated ID
        product.id = newProductId;
        dbData.id = newProductId;

        // Validate we got data back (optional, since we already have the ID)
        if (!dataRaw) {
          logDebug('Product Insert Warning', 'No data returned but insert succeeded with ID: ' + newProductId);
        }
      }

      // Ensure product.id is set
      if (!product.id) {
        throw new Error('Product ID is missing after insert/update');
      }

      // Fetch the updated/inserted product
      const { data: finalProductRaw } = await supabase.from('products').select('*').eq('id', product.id).single();
      const finalProduct = fromDb(finalProductRaw);

      // ============================================================================
      // SYNC INITIAL STOCK via RPC
      // ============================================================================
      const initialStock = dbData.initial_stock !== undefined ? Number(dbData.initial_stock) : (existing ? Number(existing.initial_stock) : 0);
      const costPrice = dbData.cost_price || (existing ? Number(existing.cost_price) : 0) || 0;

      if (initialStock > 0 || (existing && initialStock !== Number(existing.initial_stock))) {
        if (!currentBranch?.id) throw new Error('Branch required for stock sync');

        const { data: rpcResultRaw, error: rpcError } = await supabase.rpc('sync_product_initial_stock_atomic', {
          p_product_id: product.id!,
          p_branch_id: currentBranch.id,
          p_new_initial_stock: initialStock,
          p_unit_cost: costPrice
        });

        if (rpcError) throw rpcError;
        const rpcResult = Array.isArray(rpcResultRaw) ? rpcResultRaw[0] : rpcResultRaw;
        if (!rpcResult?.success) throw new Error(rpcResult?.error_message || 'Failed to sync initial stock');
        // Note: Journal entry is handled by the RPC function sync_product_initial_stock_atomic
      }

      return finalProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['journalEntries'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });

  // ============================================================================
  // DEPRECATED: updateStock - products.current_stock tidak lagi digunakan
  // Stock dihitung dari v_product_current_stock
  // ============================================================================
  const updateStock = useMutation({
    mutationFn: async ({ productId, newStock }: { productId: string, newStock: number }): Promise<Product> => {
      console.warn('⚠️ updateStock is DEPRECATED - stock should be managed via inventory_batches');
      // Return current product without update
      const { data: dataRaw, error } = await supabase
        .from('products')
        .select()
        .eq('id', productId)
        .order('id')
        .limit(1);
      if (error) throw new Error(error.message);
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw;
      if (!data) throw new Error('Product not found');
      return fromDb(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  });

  const deleteProduct = useMutation({
    mutationFn: async (productId: string): Promise<void> => {
      const { error } = await supabase.from('products').delete().eq('id', productId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  });

  useEffect(() => {
    const handleProductionComplete = () => {
      console.log('Production completed, refreshing products...');
      queryClient.invalidateQueries({ queryKey: ['products'] });
    };
    window.addEventListener('production-completed', handleProductionComplete);
    return () => window.removeEventListener('production-completed', handleProductionComplete);
  }, [queryClient]);

  return { products, isLoading, upsertProduct, updateStock, deleteProduct }
}
