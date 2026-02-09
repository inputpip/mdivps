/**
 * Quotation Service
 *
 * Handle CRUD operations for quotations (penawaran harga)
 */

import { supabase } from '@/integrations/supabase/client';
import { telegramService } from './telegramService';

export interface QuotationItem {
  id?: string;
  quotation_id?: string;
  product_id?: string | null;
  product_name: string;
  product_type?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent?: number;
  discount_amount?: number;
  subtotal: number;
  notes?: string;
}

export interface Quotation {
  id?: string;
  quotation_number?: string;
  customer_id: string;
  customer_name: string;
  customer_address?: string;
  customer_phone?: string;
  quotation_date?: string;
  valid_until?: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted';
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  total: number;
  notes?: string;
  terms?: string;
  prepared_by?: string; // Existing column in DB
  created_by?: string;
  created_by_name?: string;
  converted_to_invoice_id?: string;
  transaction_id?: string; // Existing column for linking to invoice
  converted_at?: string;
  branch_id: string;
  created_at?: string;
  updated_at?: string;
  items?: QuotationItem[]; // Stored as JSONB in DB
}

class QuotationService {
  /**
   * Generate quotation number using server-side RPC to ensure uniqueness across branches
   */
  async generateQuotationNumber(branchId: string): Promise<string> {
    const { data, error } = await supabase.rpc('generate_unique_quotation_number', {
      p_branch_id: branchId
    });

    if (error) {
      console.error('[QuotationService] Error generating quotation number via RPC:', error);
      // Fallback to client-side generation if RPC fails
      return this.generateQuotationNumberFallback(branchId);
    }

    return data;
  }

  /**
   * Fallback: Generate quotation number client-side (legacy method)
   * This may fail with 409 Conflict if RLS hides cross-branch collisions
   */
  private async generateQuotationNumberFallback(branchId: string): Promise<string> {
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');

    // Get count of quotations today
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);

    const { count } = await supabase
      .from('quotations')
      .select('*', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .gte('created_at', startOfDay.toISOString());

    let sequenceNum = (count || 0) + 1;
    let quotationNumber = '';
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 20;

    // Retry loop to ensure uniqueness
    while (!isUnique && attempts < maxAttempts) {
      const sequence = String(sequenceNum).padStart(4, '0');
      quotationNumber = `QT-${dateStr}-${sequence}`;

      // Check if this ID already exists
      const { data, error } = await supabase
        .from('quotations')
        .select('id')
        .eq('id', quotationNumber)
        .maybeSingle();

      if (error) {
        console.error('[QuotationService] Error checking uniqueness:', error);
        break;
      }

      if (!data) {
        isUnique = true;
      } else {
        console.warn(`[QuotationService] Collision detected for ${quotationNumber}, retrying...`);
        sequenceNum++; // Increment and try again
        attempts++;
      }
    }

    if (!isUnique) {
      // Fallback: Use timestamp to force uniqueness if loop failed
      const timestamp = Date.now().toString().slice(-4);
      quotationNumber = `QT-${dateStr}-${String(sequenceNum).padStart(4, '0')}-${timestamp}`;
    }

    return quotationNumber;
  }

  /**
   * Get all quotations for a branch
   */
  async getQuotations(branchId: string, options?: {
    status?: string;
    customerId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: Quotation[]; count: number }> {
    let query = supabase
      .from('quotations')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.customerId) {
      query = query.eq('customer_id', options.customerId);
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    if (options?.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      console.error('[QuotationService] Error fetching quotations:', error);
      throw error;
    }

    return { data: data || [], count: count || 0 };
  }

  /**
   * Get quotation by ID with items
   * Items are stored as JSONB in the quotations table
   */
  async getQuotationById(id: string): Promise<Quotation | null> {
    const { data: quotation, error } = await supabase
      .from('quotations')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('[QuotationService] Error fetching quotation:', error);
      return null;
    }

    // Items are already stored as JSONB in the quotation record
    return quotation;
  }

  /**
   * Create new quotation
   * Items are stored as JSONB in the quotations table
   */
  async createQuotation(
    quotation: Omit<Quotation, 'id' | 'quotation_number' | 'created_at' | 'updated_at'>,
    items: Omit<QuotationItem, 'id' | 'quotation_id'>[]
  ): Promise<Quotation> {
    // Generate quotation number and ID
    const quotationNumber = await this.generateQuotationNumber(quotation.branch_id);
    const quotationId = quotationNumber; // Use quotation number as ID (existing pattern)

    // Extract only valid DB columns (exclude created_by, created_by_name which don't exist in DB)
    const insertData = {
      id: quotationId,
      quotation_number: quotationNumber,
      customer_id: quotation.customer_id,
      customer_name: quotation.customer_name,
      customer_address: quotation.customer_address,
      customer_phone: quotation.customer_phone,
      quotation_date: quotation.quotation_date,
      valid_until: quotation.valid_until,
      status: quotation.status,
      subtotal: quotation.subtotal,
      discount_amount: quotation.discount_amount,
      tax_amount: quotation.tax_amount,
      total: quotation.total,
      notes: quotation.notes,
      terms: quotation.terms,
      prepared_by: quotation.created_by_name || quotation.prepared_by, // Map to existing column
      branch_id: quotation.branch_id,
      items: items, // Store items as JSONB
    };

    // Insert quotation with items as JSONB
    const { data: newQuotation, error: quotationError } = await supabase
      .from('quotations')
      .insert(insertData)
      .select()
      .single();

    if (quotationError) {
      console.error('[QuotationService] Error creating quotation:', quotationError);
      throw quotationError;
    }

    // Send Telegram notification
    telegramService.notifyNewQuotation({
      quotationNo: quotationNumber,
      customerName: quotation.customer_name,
      total: quotation.total,
      createdBy: quotation.created_by_name || 'Unknown',
    });

    return newQuotation;
  }

  /**
   * Update quotation
   * Items are stored as JSONB in the quotations table
   */
  async updateQuotation(
    id: string,
    quotation: Partial<Quotation>,
    items?: Omit<QuotationItem, 'id' | 'quotation_id'>[]
  ): Promise<Quotation> {
    // Prepare update data - only include valid DB columns
    const updateData: Record<string, unknown> = {};

    // Only include fields that exist in the DB
    if (quotation.customer_id !== undefined) updateData.customer_id = quotation.customer_id;
    if (quotation.customer_name !== undefined) updateData.customer_name = quotation.customer_name;
    if (quotation.customer_address !== undefined) updateData.customer_address = quotation.customer_address;
    if (quotation.customer_phone !== undefined) updateData.customer_phone = quotation.customer_phone;
    if (quotation.quotation_date !== undefined) updateData.quotation_date = quotation.quotation_date;
    if (quotation.valid_until !== undefined) updateData.valid_until = quotation.valid_until;
    if (quotation.status !== undefined) updateData.status = quotation.status;
    if (quotation.subtotal !== undefined) updateData.subtotal = quotation.subtotal;
    if (quotation.discount_amount !== undefined) updateData.discount_amount = quotation.discount_amount;
    if (quotation.tax_amount !== undefined) updateData.tax_amount = quotation.tax_amount;
    if (quotation.total !== undefined) updateData.total = quotation.total;
    if (quotation.notes !== undefined) updateData.notes = quotation.notes;
    if (quotation.terms !== undefined) updateData.terms = quotation.terms;
    if (quotation.prepared_by !== undefined) updateData.prepared_by = quotation.prepared_by;
    if (quotation.created_by_name !== undefined) updateData.prepared_by = quotation.created_by_name;
    if (quotation.transaction_id !== undefined) updateData.transaction_id = quotation.transaction_id;

    if (items) {
      updateData.items = items; // Update items as JSONB
    }

    // Update quotation
    const { data: updatedQuotation, error: quotationError } = await supabase
      .from('quotations')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (quotationError) {
      console.error('[QuotationService] Error updating quotation:', quotationError);
      throw quotationError;
    }

    return updatedQuotation;
  }

  /**
   * Delete quotation
   */
  async deleteQuotation(id: string): Promise<void> {
    // Items will be deleted by cascade
    const { error } = await supabase.from('quotations').delete().eq('id', id);

    if (error) {
      console.error('[QuotationService] Error deleting quotation:', error);
      throw error;
    }
  }

  /**
   * Update quotation status
   */
  async updateStatus(id: string, status: Quotation['status']): Promise<void> {
    const { error } = await supabase
      .from('quotations')
      .update({ status })
      .eq('id', id);

    if (error) {
      console.error('[QuotationService] Error updating quotation status:', error);
      throw error;
    }
  }

  /**
   * Convert quotation to invoice
   * Returns the transaction ID of the created invoice
   */
  async convertToInvoice(quotationId: string, transactionId: string): Promise<void> {
    const { error } = await supabase
      .from('quotations')
      .update({
        status: 'converted',
        converted_to_invoice_id: transactionId,
        converted_at: new Date().toISOString(),
      })
      .eq('id', quotationId);

    if (error) {
      console.error('[QuotationService] Error converting quotation:', error);
      throw error;
    }

    // Get quotation details for notification
    const quotation = await this.getQuotationById(quotationId);
    if (quotation) {
      // Get transaction number (id is used as transaction number)
      const { data: transaction } = await supabase
        .from('transactions')
        .select('id')
        .eq('id', transactionId)
        .single();

      if (transaction) {
        telegramService.notifyQuotationConverted({
          quotationNo: quotation.quotation_number,
          transactionNo: transaction.id,  // id is used as transaction number
          customerName: quotation.customer_name,
          total: quotation.total,
          convertedBy: quotation.created_by_name || 'Unknown',
        });
      }
    }
  }
}

// Export singleton instance
export const quotationService = new QuotationService();
