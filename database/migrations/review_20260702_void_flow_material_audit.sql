-- Keep material stock movements auditable when PO / production / spoilage are voided.
-- Instead of deleting historical rows, mark them void so operational reports can exclude them.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_po_atomic(
  p_po_id text,
  p_branch_id uuid,
  p_skip_validation boolean DEFAULT false
)
RETURNS TABLE(
  success boolean,
  batches_deleted integer,
  stock_rolled_back integer,
  journals_voided integer,
  error_message text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_po RECORD;
  v_batch RECORD;
  v_batches_deleted INTEGER := 0;
  v_stock_rolled_back INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_current_stock NUMERIC;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_po_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT id, status INTO v_po
  FROM purchase_orders
  WHERE id = p_po_id AND branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF NOT p_skip_validation THEN
    IF EXISTS (
      SELECT 1 FROM inventory_batches
      WHERE purchase_order_id = p_po_id
        AND remaining_quantity < initial_quantity
    ) THEN
      RETURN QUERY SELECT FALSE, 0, 0, 0,
        'Tidak dapat menghapus PO karena batch inventory sudah terpakai (FIFO)'::TEXT;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1 FROM accounts_payable
      WHERE purchase_order_id = p_po_id
        AND paid_amount > 0
    ) THEN
      RETURN QUERY SELECT FALSE, 0, 0, 0,
        'Tidak dapat menghapus PO karena hutang sudah ada pembayaran'::TEXT;
      RETURN;
    END IF;
  END IF;

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = format('PO %s dihapus', p_po_id),
    updated_at = NOW()
  WHERE reference_id = p_po_id
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  FOR v_batch IN
    SELECT id, material_id, product_id, remaining_quantity
    FROM inventory_batches
    WHERE purchase_order_id = p_po_id
  LOOP
    IF v_batch.material_id IS NOT NULL THEN
      SELECT stock INTO v_current_stock
      FROM materials
      WHERE id = v_batch.material_id;

      UPDATE materials
      SET stock = GREATEST(0, COALESCE(v_current_stock, 0) - v_batch.remaining_quantity),
          updated_at = NOW()
      WHERE id = v_batch.material_id;

      v_stock_rolled_back := v_stock_rolled_back + 1;
    END IF;

    IF v_batch.product_id IS NOT NULL THEN
      v_stock_rolled_back := v_stock_rolled_back + 1;
    END IF;

    v_batches_deleted := v_batches_deleted + 1;
  END LOOP;

  DELETE FROM inventory_batches WHERE purchase_order_id = p_po_id;

  UPDATE material_stock_movements
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    void_reason = format('PO %s dihapus', p_po_id),
    voided_by_name = COALESCE(voided_by_name, 'System')
  WHERE reference_id = p_po_id
    AND reference_type = 'purchase_order'
    AND COALESCE(is_voided, FALSE) = FALSE;

  DELETE FROM accounts_payable WHERE purchase_order_id = p_po_id;
  DELETE FROM purchase_order_items WHERE purchase_order_id = p_po_id;
  DELETE FROM purchase_orders WHERE id = p_po_id;

  RETURN QUERY SELECT
    TRUE,
    v_batches_deleted,
    v_stock_rolled_back,
    v_journals_voided,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.void_production_atomic(
  p_production_id uuid,
  p_branch_id uuid
)
RETURNS TABLE(success boolean, error_message text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_record RECORD;
  v_consumption RECORD;
  v_movement RECORD;
  v_journal_id UUID;
  v_material_reference_type TEXT;
BEGIN
  SELECT * INTO v_record FROM production_records
  WHERE id = p_production_id AND branch_id = p_branch_id;

  IF v_record.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Data produksi tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  v_material_reference_type := CASE
    WHEN v_record.quantity < 0 AND v_record.product_id IS NULL THEN 'spoilage'
    ELSE 'production'
  END;

  IF v_record.consume_bom THEN
    FOR v_movement IN
      SELECT material_id, quantity FROM material_stock_movements
      WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref)
        AND reference_type = v_material_reference_type
        AND type = 'OUT'
        AND COALESCE(is_voided, FALSE) = FALSE
    LOOP
      PERFORM public.restore_material_fifo_v2(
        v_movement.material_id,
        v_movement.quantity,
        0,
        v_record.ref,
        'void_production',
        p_branch_id
      );
    END LOOP;
  ELSIF v_record.quantity < 0 AND v_record.product_id IS NULL THEN
    FOR v_movement IN
      SELECT material_id, quantity FROM material_stock_movements
      WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref)
        AND reference_type = v_material_reference_type
        AND type = 'OUT'
        AND COALESCE(is_voided, FALSE) = FALSE
    LOOP
      PERFORM public.restore_material_fifo_v2(
        v_movement.material_id,
        v_movement.quantity,
        0,
        v_record.ref,
        'void_production_error',
        p_branch_id
      );
    END LOOP;
  END IF;

  IF v_record.quantity > 0 AND v_record.product_id IS NOT NULL THEN
    DELETE FROM inventory_batches
    WHERE product_id = v_record.product_id
      AND (production_id = v_record.id OR notes = 'Produksi ' || v_record.ref);

    UPDATE products
    SET current_stock = GREATEST(0, current_stock - v_record.quantity),
        updated_at = NOW()
    WHERE id = v_record.product_id;
  END IF;

  UPDATE material_stock_movements
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    void_reason = 'Production deleted: ' || v_record.ref,
    voided_by_name = COALESCE(voided_by_name, 'System')
  WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref)
    AND reference_type = v_material_reference_type
    AND COALESCE(is_voided, FALSE) = FALSE;

  FOR v_journal_id IN
    SELECT id FROM journal_entries
    WHERE reference_id = v_record.id::TEXT
      AND reference_type IN ('production', 'adjustment')
      AND is_voided = FALSE
  LOOP
    UPDATE journal_entries
    SET is_voided = TRUE,
        voided_reason = 'Production deleted: ' || v_record.ref,
        status = 'voided',
        updated_at = NOW()
    WHERE id = v_journal_id;
  END LOOP;

  DELETE FROM production_records WHERE id = p_production_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$;

COMMIT;
