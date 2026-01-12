CREATE OR REPLACE FUNCTION public.void_transaction_atomic(p_transaction_id text, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, items_restored integer, journals_voided integer, commissions_deleted integer, deliveries_deleted integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_transaction RECORD;
  v_items_restored INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_commissions_deleted INTEGER := 0;
  v_deliveries_deleted INTEGER := 0;
  v_item RECORD;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get transaction with row lock
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id = p_transaction_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 0, 'Transaction not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== RESTORE INVENTORY ====================

  -- IF Office Sale (immediate consume) OR has any deliveries
  -- Note: We check LOWER() to be case-insensitive
  IF v_transaction.is_office_sale OR LOWER(COALESCE(v_transaction.delivery_status, '')) = 'delivered' OR EXISTS(SELECT 1 FROM deliveries WHERE transaction_id = p_transaction_id) THEN
    -- Parse items from JSONB
    FOR v_item IN 
      SELECT 
        (elem->>'productId')::TEXT as product_id_str,
        (elem->>'quantity')::NUMERIC as quantity,
        (elem->>'productType')::TEXT as product_type
      FROM jsonb_array_elements(v_transaction.items) as elem
      WHERE (elem->>'productId') IS NOT NULL OR (elem->>'materialId') IS NOT NULL
    LOOP
      -- Handle Products
      IF v_item.product_type IS NULL OR v_item.product_type = 'product' THEN
        -- Use the smart restorer (v2)
        PERFORM public.restore_stock_fifo_v2(
          v_item.product_id_str::UUID,
          v_item.quantity,
          p_transaction_id,
          'transaction',
          p_branch_id
        );
        v_items_restored := v_items_restored + 1;
      
      -- Handle Materials
      ELSIF v_item.product_type = 'material' THEN
        -- Use the smart restorer (v2)
        PERFORM public.restore_material_fifo_v2(
          v_item.product_id_str::UUID,
          v_item.quantity,
          0, -- cost handled by batch logic
          p_transaction_id,
          'void_transaction',
          p_branch_id
        );
        v_items_restored := v_items_restored + 1;
      END IF;
    END LOOP;
  END IF;

  -- ==================== VOID JOURNALS ====================

  -- Void Main Transaction Journal AND Receivable Journal (Migration)
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE (reference_type = 'transaction' OR reference_type = 'receivable')
    AND reference_id = p_transaction_id
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- Void ALL related delivery journals
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Parent Transaction voided: ' || p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'delivery'
    AND reference_id IN (SELECT id::TEXT FROM deliveries WHERE transaction_id = p_transaction_id)
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  -- ==================== DELETE COMMISSIONS ====================

  DELETE FROM commission_entries
  WHERE (transaction_id = p_transaction_id OR delivery_id IN (SELECT id::TEXT FROM deliveries WHERE transaction_id = p_transaction_id))
    AND branch_id = p_branch_id;

  GET DIAGNOSTICS v_commissions_deleted = ROW_COUNT;

  -- ==================== DELETE DELIVERIES ====================

  DELETE FROM delivery_items
  WHERE delivery_id IN (SELECT id FROM deliveries WHERE transaction_id = p_transaction_id);

  DELETE FROM deliveries
  WHERE transaction_id = p_transaction_id AND branch_id = p_branch_id;

  GET DIAGNOSTICS v_deliveries_deleted = ROW_COUNT;

  -- ==================== DELETE STOCK MOVEMENTS ====================
  DELETE FROM product_stock_movements
  WHERE (reference_id = p_transaction_id OR reference_id IN (SELECT id::TEXT FROM deliveries WHERE transaction_id = p_transaction_id))
    AND reference_type IN ('transaction', 'delivery', 'fifo_consume');

  -- ==================== CANCEL RECEIVABLES ====================
  
  UPDATE receivables
  SET status = 'cancelled', updated_at = NOW()
  WHERE transaction_id = p_transaction_id AND branch_id = p_branch_id;

  -- ==================== DELETE TRANSACTION ====================

  DELETE FROM transactions
  WHERE id = p_transaction_id AND branch_id = p_branch_id;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT
    TRUE,
    v_items_restored,
    v_journals_voided,
    v_commissions_deleted,
    v_deliveries_deleted,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, 0, SQLERRM::TEXT;
END;
$function$;
