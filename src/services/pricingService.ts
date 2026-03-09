import { supabase } from '@/integrations/supabase/client'
import {
  StockPricing,
  BonusPricing,
  ProductPricing,
  PriceCalculationResult,
  CreateStockPricingRequest,
  CreateBonusPricingRequest,
  CustomerPricing,
  CreateCustomerPricingRequest,
  CustomerPriceCalculationResult,
  CustomerClassificationType
} from '@/types/pricing'

// Cache untuk product pricing - berlaku 30 detik
const pricingCache = new Map<string, { data: ProductPricing; timestamp: number }>();
const CACHE_TTL_MS = 30 * 1000; // 30 detik

export class PricingService {

  /**
   * Clear cache for a specific product or all
   */
  static clearCache(productId?: string) {
    if (productId) {
      pricingCache.delete(productId);
    } else {
      pricingCache.clear();
    }
  }

  /**
   * Calculate final price based on current stock and quantity
   */
  static calculatePrice(
    basePrice: number,
    currentStock: number,
    quantity: number,
    stockPricings: StockPricing[],
    bonusPricings: BonusPricing[]
  ): PriceCalculationResult {

    // Ensure arrays are defined
    const safeStockPricings = stockPricings || [];
    const safeBonusPricings = bonusPricings || [];

    // Find applicable stock pricing rule
    const applicableStockRule = safeStockPricings
      .filter(rule => rule.isActive)
      .find(rule => {
        const meetsMin = currentStock >= rule.minStock
        const meetsMax = rule.maxStock === null || currentStock <= rule.maxStock
        return meetsMin && meetsMax
      })

    const stockAdjustedPrice = applicableStockRule?.price || basePrice

    // Find available bonuses for the quantity
    const availableBonuses = safeBonusPricings
      .filter(bonus => bonus.isActive)
      .filter(bonus => {
        const meetsMin = quantity >= bonus.minQuantity
        const meetsMax = bonus.maxQuantity === null || quantity <= bonus.maxQuantity
        return meetsMin && meetsMax
      })

    let finalPrice = stockAdjustedPrice
    let calculatedBonus = undefined

    // Apply the best bonus if available (highest minQuantity that still qualifies)
    if (availableBonuses.length > 0) {
      // Sort by minQuantity descending to get the bonus with highest threshold that still qualifies
      const bestBonus = availableBonuses.sort((a, b) => {
        // First, sort by minQuantity descending (highest threshold first)
        if (a.minQuantity !== b.minQuantity) {
          return b.minQuantity - a.minQuantity
        }
        // If minQuantity is the same, prioritize by bonus value (higher is better)
        if (a.bonusType === 'percentage' && b.bonusType === 'percentage') {
          return b.bonusValue - a.bonusValue
        }
        if (a.bonusType === 'fixed_discount' && b.bonusType === 'fixed_discount') {
          return b.bonusValue - a.bonusValue
        }
        if (a.bonusType === 'quantity' && b.bonusType === 'quantity') {
          return b.bonusValue - a.bonusValue
        }
        return 0
      })[0]

      // Best bonus selected based on highest minQuantity threshold

      if (bestBonus.bonusType === 'percentage') {
        const discountAmount = (stockAdjustedPrice * bestBonus.bonusValue) / 100
        finalPrice = stockAdjustedPrice - discountAmount
        calculatedBonus = {
          rule: bestBonus,
          bonusQuantity: 0,
          discountAmount
        }
      } else if (bestBonus.bonusType === 'fixed_discount') {
        finalPrice = Math.max(0, stockAdjustedPrice - bestBonus.bonusValue)
        calculatedBonus = {
          rule: bestBonus,
          bonusQuantity: 0,
          discountAmount: bestBonus.bonusValue
        }
      } else if (bestBonus.bonusType === 'quantity') {
        // For quantity bonus, we don't change price but calculate bonus quantity
        // Proportional Calculation: e.g. if buy 10 get 1, then buy 30 get 3
        const ruleMin = bestBonus.minQuantity || 1;
        const multiplier = Math.floor(quantity / ruleMin);

        // Use bonusQuantity if available, otherwise fallback to bonusValue
        const baseBonusQty = bestBonus.bonusQuantity > 0 ? bestBonus.bonusQuantity : bestBonus.bonusValue;
        const totalBonusQty = baseBonusQty * multiplier;

        calculatedBonus = {
          rule: bestBonus,
          bonusQuantity: totalBonusQty,
          discountAmount: 0
        }
      }
    }

    // Format bonuses for easier consumption
    const bonuses = calculatedBonus ? [{
      type: calculatedBonus.rule.bonusType,
      bonusQuantity: calculatedBonus.bonusQuantity,
      description: calculatedBonus.rule.description || `${calculatedBonus.rule.bonusType} bonus`,
      discountAmount: calculatedBonus.discountAmount
    }] : []

    return {
      basePrice,
      stockAdjustedPrice,
      finalPrice,
      appliedStockRule: applicableStockRule,
      availableBonuses,
      calculatedBonus,
      bonuses
    }
  }

  /**
   * Get product pricing with all rules (with caching)
   */
  static async getProductPricing(productId: string): Promise<ProductPricing | null> {
    try {
      // Check cache first
      const cached = pricingCache.get(productId);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }

      // Get product details - try products table first
      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      let productData: { id: string; name: string; base_price: number; current_stock: number } | null = null;

      const { data: productDataRaw, error: productError } = await supabase
        .from('products')
        .select('id, name, base_price')
        .eq('id', productId)
        .order('id').limit(1)

      const productRaw = Array.isArray(productDataRaw) ? productDataRaw[0] : productDataRaw;

      if (productRaw) {
        // Get stock from VIEW (source of truth)
        const { data: stockDataRaw } = await supabase
          .from('v_product_current_stock')
          .select('current_stock')
          .eq('product_id', productId)
          .order('product_id').limit(1);
        const stockData = Array.isArray(stockDataRaw) ? stockDataRaw[0] : stockDataRaw;

        productData = {
          id: productRaw.id,
          name: productRaw.name,
          base_price: productRaw.base_price || 0,
          current_stock: Number(stockData?.current_stock) || 0
        };
      }

      // If not found in products, try materials table
      if (!productData) {
        const { data: materialDataRaw, error: materialError } = await supabase
          .from('materials')
          .select('id, name, price_per_unit')
          .eq('id', productId)
          .order('id').limit(1)

        const materialData = Array.isArray(materialDataRaw) ? materialDataRaw[0] : materialDataRaw;

        if (materialData) {
          // Get stock from VIEW for materials
          const { data: matStockRaw } = await supabase
            .from('v_material_current_stock')
            .select('current_stock')
            .eq('material_id', productId)
            .order('material_id').limit(1);
          const matStock = Array.isArray(matStockRaw) ? matStockRaw[0] : matStockRaw;

          productData = {
            id: materialData.id,
            name: materialData.name,
            base_price: materialData.price_per_unit || 0,
            current_stock: Number(matStock?.current_stock) || 0
          };
        } else if (materialError) {
          console.error('Failed to fetch material:', materialError);
        }
      }

      if (!productData) {
        console.error('Failed to fetch product/material:', productError);
        return null;
      }

      // Get ALL stock pricing rules (including inactive for display)
      const { data: stockPricings, error: stockError } = await supabase
        .from('stock_pricings')
        .select('*')
        .eq('product_id', productId)
        .order('min_stock', { ascending: true })

      if (stockError) {
        console.error('Failed to fetch stock pricings:', stockError)
      }

      // Get ALL bonus pricing rules (including inactive for display)
      const { data: bonusPricings, error: bonusError } = await supabase
        .from('bonus_pricings')
        .select('*')
        .eq('product_id', productId)
        .order('min_quantity', { ascending: true })

      if (bonusError) {
        console.error('Failed to fetch bonus pricings:', bonusError)
      }

      const stockRules: StockPricing[] = (stockPricings || []).map(rule => ({
        id: rule.id,
        productId: rule.product_id,
        minStock: rule.min_stock,
        maxStock: rule.max_stock,
        price: rule.price,
        isActive: rule.is_active,
        createdAt: new Date(rule.created_at),
        updatedAt: new Date(rule.updated_at),
      }))

      const bonusRules: BonusPricing[] = (bonusPricings || []).map(bonus => ({
        id: bonus.id,
        productId: bonus.product_id,
        minQuantity: bonus.min_quantity,
        maxQuantity: bonus.max_quantity,
        bonusQuantity: bonus.bonus_quantity,
        bonusType: bonus.bonus_type,
        bonusValue: bonus.bonus_value,
        description: bonus.description,
        isActive: bonus.is_active,
        createdAt: new Date(bonus.created_at),
        updatedAt: new Date(bonus.updated_at),
      }))

      // Calculate current final price based on stock
      const priceCalculation = this.calculatePrice(
        productData.base_price,
        productData.current_stock,
        1, // Default quantity for display
        stockRules,
        bonusRules
      )

      const result: ProductPricing = {
        id: productData.id,
        productId: productData.id,
        productName: productData.name,
        basePrice: productData.base_price,
        currentStock: productData.current_stock,
        stockPricings: stockRules,
        bonusPricings: bonusRules,
        finalPrice: priceCalculation.stockAdjustedPrice,
        availableBonuses: priceCalculation.availableBonuses
      }

      // Save to cache
      pricingCache.set(productId, { data: result, timestamp: Date.now() });

      return result;

    } catch (error) {
      console.error('Error in getProductPricing:', error)
      return null
    }
  }

  /**
   * Create stock pricing rule
   */
  static async createStockPricing(request: CreateStockPricingRequest): Promise<StockPricing | null> {
    try {
      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('stock_pricings')
        .insert({
          product_id: request.productId,
          min_stock: request.minStock,
          max_stock: request.maxStock || null,
          price: request.price,
          is_active: true
        })
        .select()
        .order('id', { ascending: false }).limit(1)
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw

      if (error) {
        console.error('Failed to create stock pricing:', error)
        return null
      }

      return {
        id: data.id,
        productId: data.product_id,
        minStock: data.min_stock,
        maxStock: data.max_stock,
        price: data.price,
        isActive: data.is_active,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      }
    } catch (error) {
      console.error('Error creating stock pricing:', error)
      return null
    }
  }

  /**
   * Create bonus pricing rule
   */
  static async createBonusPricing(request: CreateBonusPricingRequest): Promise<BonusPricing | null> {
    try {
      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('bonus_pricings')
        .insert({
          product_id: request.productId,
          min_quantity: request.minQuantity,
          max_quantity: request.maxQuantity || null,
          bonus_quantity: request.bonusQuantity,
          bonus_type: request.bonusType,
          bonus_value: request.bonusValue,
          description: request.description,
          is_active: true
        })
        .select()
        .order('id', { ascending: false }).limit(1)
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw

      if (error) {
        console.error('Failed to create bonus pricing:', error)
        return null
      }

      return {
        id: data.id,
        productId: data.product_id,
        minQuantity: data.min_quantity,
        maxQuantity: data.max_quantity,
        bonusQuantity: data.bonus_quantity,
        bonusType: data.bonus_type,
        bonusValue: data.bonus_value,
        description: data.description,
        isActive: data.is_active,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      }
    } catch (error) {
      console.error('Error creating bonus pricing:', error)
      return null
    }
  }

  /**
   * Delete stock pricing rule
   */
  static async deleteStockPricing(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('stock_pricings')
        .delete()
        .eq('id', id)

      return !error
    } catch (error) {
      console.error('Error deleting stock pricing:', error)
      return false
    }
  }

  /**
   * Delete bonus pricing rule
   */
  static async deleteBonusPricing(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('bonus_pricings')
        .delete()
        .eq('id', id)

      return !error
    } catch (error) {
      console.error('Error deleting bonus pricing:', error)
      return false
    }
  }

  /**
   * Toggle stock pricing active status
   */
  static async toggleStockPricingActive(id: string, isActive: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('stock_pricings')
        .update({ is_active: isActive })
        .eq('id', id)

      return !error
    } catch (error) {
      console.error('Error toggling stock pricing active status:', error)
      return false
    }
  }

  /**
   * Toggle bonus pricing active status
   */
  static async toggleBonusPricingActive(id: string, isActive: boolean): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('bonus_pricings')
        .update({ is_active: isActive })
        .eq('id', id)

      return !error
    } catch (error) {
      console.error('Error toggling bonus pricing active status:', error)
      return false
    }
  }

  // ============================================
  // Customer-based Pricing Methods
  // ============================================

  /**
   * Calculate price for a specific customer
   */
  static calculateCustomerPrice(
    basePrice: number,
    customerId: string | undefined,
    customerClassification: CustomerClassificationType | undefined,
    customerPricings: CustomerPricing[]
  ): CustomerPriceCalculationResult {
    // Filter active rules
    const activeRules = customerPricings.filter(rule => rule.isActive)

    // Find applicable rules (sorted by priority, highest first)
    const applicableRules = activeRules
      .filter(rule => {
        // Match specific customer
        if (rule.customerId && rule.customerId === customerId) {
          return true
        }
        // Match classification
        if (rule.customerClassification && rule.customerClassification === customerClassification) {
          return true
        }
        return false
      })
      .sort((a, b) => b.priority - a.priority)

    // Get the highest priority rule
    const appliedRule = applicableRules[0]

    if (!appliedRule) {
      return {
        basePrice,
        customerAdjustedPrice: basePrice,
        discountAmount: 0,
        discountPercentage: 0
      }
    }

    let customerAdjustedPrice = basePrice
    let discountAmount = 0
    let discountPercentage = 0

    switch (appliedRule.priceType) {
      case 'fixed':
        customerAdjustedPrice = appliedRule.priceValue
        discountAmount = basePrice - customerAdjustedPrice
        discountPercentage = (discountAmount / basePrice) * 100
        break
      case 'discount_percentage':
        discountPercentage = appliedRule.priceValue
        discountAmount = (basePrice * discountPercentage) / 100
        customerAdjustedPrice = basePrice - discountAmount
        break
      case 'discount_amount':
        discountAmount = appliedRule.priceValue
        customerAdjustedPrice = Math.max(0, basePrice - discountAmount)
        discountPercentage = (discountAmount / basePrice) * 100
        break
    }

    return {
      basePrice,
      customerAdjustedPrice,
      appliedRule,
      discountAmount,
      discountPercentage
    }
  }

  /**
   * Get customer pricings for a product
   */
  static async getCustomerPricings(productId: string): Promise<CustomerPricing[]> {
    try {
      const { data, error } = await supabase
        .from('customer_pricings')
        .select(`
          *,
          customers:customer_id (name)
        `)
        .eq('product_id', productId)
        .order('priority', { ascending: false })

      if (error) {
        console.error('Failed to fetch customer pricings:', error)
        return []
      }

      return (data || []).map((rule: any) => ({
        id: rule.id,
        productId: rule.product_id,
        customerId: rule.customer_id,
        customerName: rule.customers?.name,
        customerClassification: rule.customer_classification,
        priceType: rule.price_type,
        priceValue: rule.price_value,
        priority: rule.priority,
        description: rule.description,
        isActive: rule.is_active,
        branchId: rule.branch_id,
        createdAt: new Date(rule.created_at),
        updatedAt: new Date(rule.updated_at),
      }))
    } catch (error) {
      console.error('Error fetching customer pricings:', error)
      return []
    }
  }

  /**
   * Create customer pricing rule
   */
  static async createCustomerPricing(request: CreateCustomerPricingRequest): Promise<CustomerPricing | null> {
    try {
      // Determine priority: customer-specific = 100, classification = 50
      const priority = request.priority ?? (request.customerId ? 100 : 50)

      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('customer_pricings')
        .insert({
          product_id: request.productId,
          customer_id: request.customerId || null,
          customer_classification: request.customerClassification || null,
          price_type: request.priceType,
          price_value: request.priceValue,
          priority: priority,
          description: request.description,
          branch_id: request.branchId || null,
          is_active: true
        })
        .select(`
          *,
          customers:customer_id (name)
        `)
        .order('id', { ascending: false }).limit(1)
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw

      if (error) {
        console.error('Failed to create customer pricing:', error)
        return null
      }

      return {
        id: data.id,
        productId: data.product_id,
        customerId: data.customer_id,
        customerName: (data as any).customers?.name,
        customerClassification: data.customer_classification,
        priceType: data.price_type,
        priceValue: data.price_value,
        priority: data.priority,
        description: data.description,
        isActive: data.is_active,
        branchId: data.branch_id,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      }
    } catch (error) {
      console.error('Error creating customer pricing:', error)
      return null
    }
  }

  /**
   * Update customer pricing rule
   */
  static async updateCustomerPricing(
    id: string,
    updates: Partial<CreateCustomerPricingRequest>
  ): Promise<CustomerPricing | null> {
    try {
      const updateData: any = {}
      if (updates.priceType !== undefined) updateData.price_type = updates.priceType
      if (updates.priceValue !== undefined) updateData.price_value = updates.priceValue
      if (updates.priority !== undefined) updateData.priority = updates.priority
      if (updates.description !== undefined) updateData.description = updates.description

      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: dataRaw, error } = await supabase
        .from('customer_pricings')
        .update(updateData)
        .eq('id', id)
        .select(`
          *,
          customers:customer_id (name)
        `)
        .order('id').limit(1)
      const data = Array.isArray(dataRaw) ? dataRaw[0] : dataRaw

      if (error) {
        console.error('Failed to update customer pricing:', error)
        return null
      }

      return {
        id: data.id,
        productId: data.product_id,
        customerId: data.customer_id,
        customerName: (data as any).customers?.name,
        customerClassification: data.customer_classification,
        priceType: data.price_type,
        priceValue: data.price_value,
        priority: data.priority,
        description: data.description,
        isActive: data.is_active,
        branchId: data.branch_id,
        createdAt: new Date(data.created_at),
        updatedAt: new Date(data.updated_at),
      }
    } catch (error) {
      console.error('Error updating customer pricing:', error)
      return null
    }
  }

  /**
   * Delete customer pricing rule
   */
  static async deleteCustomerPricing(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('customer_pricings')
        .delete()
        .eq('id', id)

      return !error
    } catch (error) {
      console.error('Error deleting customer pricing:', error)
      return false
    }
  }

  /**
   * Get price for a specific customer on a specific product
   */
  static async getCustomerProductPrice(
    productId: string,
    customerId: string,
    customerClassification?: CustomerClassificationType
  ): Promise<CustomerPriceCalculationResult | null> {
    try {
      // Get product base price
      // Use .order('id').limit(1) instead of .single() because our client forces Accept: application/json
      const { data: productRaw, error: productError } = await supabase
        .from('products')
        .select('base_price')
        .eq('id', productId)
        .order('id').limit(1)
      const product = Array.isArray(productRaw) ? productRaw[0] : productRaw

      if (productError || !product) {
        console.error('Failed to fetch product:', productError)
        return null
      }

      // Get customer pricings
      const customerPricings = await this.getCustomerPricings(productId)

      return this.calculateCustomerPrice(
        product.base_price,
        customerId,
        customerClassification,
        customerPricings
      )
    } catch (error) {
      console.error('Error getting customer product price:', error)
      return null
    }
  }
}