-- =====================================================
-- 04 PRODUCTION
-- Generated: 2026-01-09T00:29:07.859Z
-- Total functions: 5
-- =====================================================

-- Functions in this file:
--   process_laku_kantor_atomic
--   process_production_atomic
--   process_spoilage_atomic
--   update_production_records_updated_at
--   void_production_atomic

-- =====================================================
-- Function: process_laku_kantor_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_laku_kantor_atomic(p_transaction_id text, p_branch_id uuid)
 RETURNS TABLE(success boolean, total_hpp numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_transaction RECORD;
  v_item RECORD;
  v_consume_result RECORD;
  v_total_hpp NUMERIC := 0;
  v_hpp_details TEXT := '';
  v_journal_id UUID;
  v_entry_number TEXT;
  v_hpp_account_id UUID;
  v_persediaan_id UUID;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;
  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID,
      'Transaction ID is required'::TEXT;
    RETURN;
  END IF;
  -- Get transaction info
  SELECT
    t.id,
    t.ref,
    t.branch_id,
    t.customer_id,
    c.name as customer_name,
    t.is_laku_kantor
  INTO v_transaction
  FROM transactions t
  LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.id = p_transaction_id AND t.branch_id = p_branch_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID,
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;
  -- ==================== CONSUME INVENTORY (FIFO) ====================
  FOR v_item IN
    SELECT
      ti.product_id,
      ti.quantity,
      p.name as product_name
    FROM transaction_items ti
    JOIN products p ON p.id = ti.product_id
    WHERE ti.transaction_id = p_transaction_id
      AND ti.quantity > 0
  LOOP
    SELECT * INTO v_consume_result
    FROM consume_stock_fifo_v2(
      v_item.product_id,
      v_item.quantity,
      v_transaction.ref,
      'sale',
      p_branch_id
    );
    IF NOT v_consume_result.success THEN
      RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID,
        format('Gagal consume stok %s: %s', v_item.product_name, v_consume_result.error_message);
      RETURN;
    END IF;
    v_total_hpp := v_total_hpp + v_consume_result.total_hpp;
    v_hpp_details := v_hpp_details || v_item.product_name || ' x' || v_item.quantity || ', ';
  END LOOP;
  -- ==================== UPDATE TRANSACTION ====================
  UPDATE transactions
  SET
    delivery_status = 'delivered',
    delivered_at = NOW(),
    updated_at = NOW()
  WHERE id = p_transaction_id;
  -- ==================== CREATE HPP JOURNAL ====================
  IF v_total_hpp > 0 THEN
    SELECT id INTO v_hpp_account_id
    FROM accounts
    WHERE code = '5100' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
    SELECT id INTO v_persediaan_id
    FROM accounts
    WHERE code = '1310' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
    IF v_hpp_account_id IS NOT NULL AND v_persediaan_id IS NOT NULL THEN
      v_entry_number := 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
        LPAD((SELECT COUNT(*) + 1 FROM journal_entries
              WHERE branch_id = p_branch_id
              AND DATE(created_at) = CURRENT_DATE)::TEXT, 4, '0');
      INSERT INTO journal_entries (
        entry_number,
        entry_date,
        description,
        reference_type,
        reference_id,
        branch_id,
        status,
        total_debit,
        total_credit
      ) VALUES (
        v_entry_number,
        NOW(),
        format('HPP Laku Kantor %s: %s', v_transaction.ref, COALESCE(v_transaction.customer_name, 'Customer')),
        'transaction',
        p_transaction_id::TEXT,
        p_branch_id,
        'draft',
        v_total_hpp,
        v_total_hpp
      )
      RETURNING id INTO v_journal_id;
      INSERT INTO journal_entry_lines (
        journal_entry_id,
        line_number,
        account_id,
        description,
        debit_amount,
        credit_amount
      ) VALUES (
        v_journal_id,
        1,
        v_hpp_account_id,
        format('HPP Laku Kantor: %s', RTRIM(v_hpp_details, ', ')),
        v_total_hpp,
        0
      );
      INSERT INTO journal_entry_lines (
        journal_entry_id,
        line_number,
        account_id,
        description,
        debit_amount,
        credit_amount
      ) VALUES (
        v_journal_id,
        2,
        v_persediaan_id,
        format('Stock keluar: %s', v_transaction.ref),
        0,
        v_total_hpp
      );
      UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_id;
    END IF;
  END IF;
  RETURN QUERY SELECT
    TRUE,
    v_total_hpp,
    v_journal_id,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: process_production_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_production_atomic(p_product_id uuid, p_quantity numeric, p_consume_bom boolean DEFAULT true, p_note text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, production_id uuid, production_ref text, total_material_cost numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_production_id UUID;
  v_ref TEXT;
  v_bom_item RECORD;
  v_consume_result RECORD;
  v_total_material_cost NUMERIC := 0;
  v_material_details TEXT := '';
  v_bom_snapshot JSONB := '[]'::JSONB;
  v_product RECORD;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_persediaan_barang_id TEXT;  -- accounts.id is TEXT not UUID
  v_persediaan_bahan_id TEXT;   -- accounts.id is TEXT not UUID
  v_unit_cost NUMERIC;
  v_required_qty NUMERIC;
  v_available_stock NUMERIC;
  v_material_name TEXT;
  v_seq INTEGER;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Product ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get product info
  SELECT id, name INTO v_product
  FROM products WHERE id = p_product_id;

  IF v_product.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Product not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE REFERENCE ====================

  v_ref := 'PRD-' || TO_CHAR(NOW(), 'YYMMDD') || '-' ||
    LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CONSUME MATERIALS (FIFO) ====================

  IF p_consume_bom THEN
    -- Fetch BOM from product_materials
    FOR v_bom_item IN
      SELECT
        pm.material_id,
        pm.quantity as bom_qty,
        m.name as material_name,
        m.unit as material_unit
      FROM product_materials pm
      JOIN materials m ON m.id = pm.material_id
      WHERE pm.product_id = p_product_id
    LOOP
      v_required_qty := v_bom_item.bom_qty * p_quantity;

      -- Check stock availability first
      SELECT COALESCE(SUM(remaining_quantity), 0)
      INTO v_available_stock
      FROM inventory_batches
      WHERE material_id = v_bom_item.material_id
        AND (branch_id = p_branch_id OR branch_id IS NULL)
        AND remaining_quantity > 0;

      IF v_available_stock < v_required_qty THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
          format('Stok %s tidak cukup: butuh %s, tersedia %s',
            v_bom_item.material_name, v_required_qty, v_available_stock)::TEXT;
        RETURN;
      END IF;

      -- Call consume_material_fifo_v2
      SELECT * INTO v_consume_result
      FROM consume_material_fifo_v2(
        v_bom_item.material_id,
        v_required_qty,
        v_ref,
        'production',
        p_branch_id
      );

      IF NOT v_consume_result.success THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
          v_consume_result.error_message;
        RETURN;
      END IF;

      v_total_material_cost := v_total_material_cost + v_consume_result.total_cost;

      -- Build material details for journal notes
      v_material_details := v_material_details ||
        v_bom_item.material_name || ' x' || v_required_qty ||
        ' (Rp' || ROUND(v_consume_result.total_cost) || '), ';

      -- Build BOM snapshot for record
      v_bom_snapshot := v_bom_snapshot || jsonb_build_object(
        'id', gen_random_uuid(),
        'materialId', v_bom_item.material_id,
        'materialName', v_bom_item.material_name,
        'quantity', v_bom_item.bom_qty,
        'unit', v_bom_item.material_unit,
        'consumed', v_required_qty,
        'cost', v_consume_result.total_cost
      );
    END LOOP;
  END IF;

  -- Calculate unit cost for produced product
  v_unit_cost := CASE WHEN p_quantity > 0 AND v_total_material_cost > 0
    THEN v_total_material_cost / p_quantity ELSE 0 END;

  -- ==================== CREATE PRODUCTION RECORD ====================

  INSERT INTO production_records (
    ref,
    product_id,
    quantity,
    note,
    consume_bom,
    bom_snapshot,
    created_by,
    user_input_id,
    user_input_name,
    branch_id,
    created_at,
    updated_at
  ) VALUES (
    v_ref,
    p_product_id,
    p_quantity,
    p_note,
    p_consume_bom,
    CASE WHEN jsonb_array_length(v_bom_snapshot) > 0 THEN v_bom_snapshot ELSE NULL END,
    COALESCE(p_user_id, '00000000-0000-0000-0000-000000000000'::UUID),  -- Required NOT NULL
    p_user_id,
    COALESCE(p_user_name, 'System'),
    p_branch_id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_production_id;

  -- ==================== CREATE PRODUCT INVENTORY BATCH ====================

  IF p_consume_bom AND v_total_material_cost > 0 THEN
    INSERT INTO inventory_batches (
      product_id,
      branch_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes,
      production_id
    ) VALUES (
      p_product_id,
      p_branch_id,
      p_quantity,
      p_quantity,
      v_unit_cost,
      NOW(),
      format('Produksi %s', v_ref),
      v_production_id
    );
  END IF;

  -- ==================== CREATE JOURNAL ENTRY ====================

  IF p_consume_bom AND v_total_material_cost > 0 THEN
    -- Get account IDs
    SELECT id INTO v_persediaan_barang_id
    FROM accounts
    WHERE code = '1310' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;

    SELECT id INTO v_persediaan_bahan_id
    FROM accounts
    WHERE code = '1320' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;

    IF v_persediaan_barang_id IS NOT NULL AND v_persediaan_bahan_id IS NOT NULL THEN
       -- Build Journal Lines for create_journal_atomic
       -- Dr. Persediaan Barang Dagang (1310)
       -- Cr. Persediaan Bahan Baku (1320)
       
       DECLARE
         v_journal_lines JSONB;
         v_journal_res RECORD;
       BEGIN
         v_journal_lines := jsonb_build_array(
           jsonb_build_object(
             'account_id', v_persediaan_barang_id,
             'debit_amount', v_total_material_cost,
             'credit_amount', 0,
             'description', format('Hasil produksi: %s x%s', v_product.name, p_quantity)
           ),
           jsonb_build_object(
             'account_id', v_persediaan_bahan_id,
             'credit_amount', v_total_material_cost,
             'debit_amount', 0,
             'description', format('Bahan terpakai: %s', RTRIM(v_material_details, ', '))
           )
         );

         SELECT * INTO v_journal_res FROM create_journal_atomic(
           p_branch_id,
           CURRENT_DATE,
           format('Produksi %s: %s x%s', v_ref, v_product.name, p_quantity),
           'production',
           v_production_id::TEXT,
           v_journal_lines,
           TRUE -- auto_post
         );

         IF v_journal_res.success THEN
            v_journal_id := v_journal_res.journal_id;
         ELSE
            -- Log error but don't fail transaction? Or fail? 
            -- Better to fail if journal fails.
            RAISE EXCEPTION 'Gagal membuat jurnal: %', v_journal_res.error_message;
         END IF;
       END;
    END IF;
  END IF;

  -- Note: Stok produk sekarang di-track via inventory_batches (FIFO)
  -- Tidak perlu log ke stock_movements karena inventory_batches sudah dibuat di atas

  RETURN QUERY SELECT
    TRUE,
    v_production_id,
    v_ref,
    v_total_material_cost,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: process_spoilage_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.process_spoilage_atomic(p_material_id uuid, p_quantity numeric, p_note text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text)
 RETURNS TABLE(success boolean, record_id uuid, record_ref text, spoilage_cost numeric, journal_id uuid, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_record_id UUID;
  v_ref TEXT;
  v_consume_result RECORD;
  v_spoilage_cost NUMERIC := 0;
  v_material RECORD;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_lain_id TEXT;         -- accounts.id is TEXT not UUID
  v_persediaan_bahan_id TEXT;   -- accounts.id is TEXT not UUID
  v_seq INTEGER;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Material ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get material info
  SELECT id, name, unit, stock INTO v_material
  FROM materials WHERE id = p_material_id;

  IF v_material.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      'Material not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE REFERENCE ====================

  v_ref := 'ERR-' || TO_CHAR(NOW(), 'YYMMDD') || '-' ||
    LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CONSUME MATERIAL (FIFO) ====================
  -- This will deduct stock from batches and log to material_stock_movements

  SELECT * INTO v_consume_result
  FROM consume_material_fifo_v2(
    p_material_id,
    p_quantity,
    v_ref,
    'spoilage',
    p_branch_id
  );

  IF NOT v_consume_result.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID,
      v_consume_result.error_message;
    RETURN;
  END IF;

  v_spoilage_cost := v_consume_result.total_cost;

  -- ==================== UPDATE MATERIALS.STOCK (backward compat) ====================
  -- REMOVED: consume_material_fifo already updates the legacy stock column.
  --          Keeping it here would cause double deduction.

  -- ==================== CREATE PRODUCTION RECORD (as error) ====================

  INSERT INTO production_records (
    ref,
    product_id,
    quantity,
    note,
    consume_bom,
    created_by,
    user_input_id,
    user_input_name,
    branch_id,
    created_at,
    updated_at
  ) VALUES (
    v_ref,
    NULL,  -- No product for spoilage
    -p_quantity,  -- Negative quantity indicates error/spoilage
    format('BAHAN RUSAK: %s - %s', v_material.name, COALESCE(p_note, 'Tidak ada catatan')),
    FALSE,
    p_user_id,
    p_user_id,
    COALESCE(p_user_name, 'System'),
    p_branch_id,
    NOW(),
    NOW()
  )
  RETURNING id INTO v_record_id;

  -- ==================== LOG MATERIAL MOVEMENT ====================
  -- REMOVED: consume_material_fifo already logs to material_stock_movements with correct Reason.
  --          Double logging caused constraint errors and redundant data.

  -- ==================== CREATE JOURNAL ENTRY ====================

  IF v_spoilage_cost > 0 THEN
    SELECT id INTO v_beban_lain_id
    FROM accounts
    WHERE code = '8100' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;

    SELECT id INTO v_persediaan_bahan_id
    FROM accounts
    WHERE code = '1320' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;

    IF v_beban_lain_id IS NOT NULL AND v_persediaan_bahan_id IS NOT NULL THEN
       -- Use create_journal_atomic
       DECLARE
         v_journal_lines JSONB;
         v_journal_res RECORD;
       BEGIN
         v_journal_lines := jsonb_build_array(
           jsonb_build_object(
             'account_id', v_beban_lain_id,
             'debit_amount', v_spoilage_cost,
             'credit_amount', 0,
             'description', format('Bahan rusak: %s x%s', v_material.name, p_quantity)
           ),
           jsonb_build_object(
             'account_id', v_persediaan_bahan_id,
             'debit_amount', 0,
             'credit_amount', v_spoilage_cost,
             'description', format('Bahan keluar: %s x%s', v_material.name, p_quantity)
           )
         );

         SELECT * INTO v_journal_res FROM create_journal_atomic(
           p_branch_id,
           CURRENT_DATE,
           format('Bahan Rusak %s: %s x%s %s', v_ref, v_material.name, p_quantity, COALESCE(v_material.unit, 'pcs')),
           'adjustment',
           v_record_id::TEXT,
           v_journal_lines,
           TRUE
         );

         IF v_journal_res.success THEN
            v_journal_id := v_journal_res.journal_id;
         ELSE
            RAISE EXCEPTION 'Gagal membuat jurnal spoilage: %', v_journal_res.error_message;
         END IF;
       END;
    END IF;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_record_id,
    v_ref,
    v_spoilage_cost,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: update_production_records_updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_production_records_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: void_production_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_production_atomic(p_production_id uuid, p_branch_id uuid)
 RETURNS TABLE(success boolean, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_record RECORD;
  v_consumption RECORD;
  v_movement RECORD;
  v_journal_id UUID;
BEGIN
  -- 1. Get Production Record
  SELECT * INTO v_record FROM production_records 
  WHERE id = p_production_id AND branch_id = p_branch_id;
  
  IF v_record.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Data produksi tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- 2. Handle Stock Rollback (FIFO)
  -- Rollback Materials (Ingredients)
  IF v_record.consume_bom THEN
    FOR v_movement IN 
      SELECT material_id, quantity FROM material_stock_movements 
      WHERE reference_id = v_record.id::TEXT AND reference_type = 'production' AND type = 'OUT'
    LOOP
      PERFORM public.restore_material_fifo_v2(
        v_movement.material_id, 
        v_movement.quantity, 
        0, -- cost handled by batch
        v_record.id::TEXT, 
        'void_production',
        p_branch_id
      );
    END LOOP;
  ELSIF v_record.quantity < 0 AND v_record.product_id IS NULL THEN
    -- This was a spoilage/error record
    FOR v_movement IN 
      SELECT material_id, quantity FROM material_stock_movements 
      WHERE reference_id = v_record.id::TEXT AND reference_type = 'production' AND type = 'OUT'
    LOOP
      PERFORM public.restore_material_fifo_v2(
        v_movement.material_id, 
        v_movement.quantity, 
        0, -- cost handled by batch
        v_record.id::TEXT, 
        'void_production_error',
        p_branch_id
      );
    END LOOP;
  END IF;

  -- 3. Delete Produced Product Batch (Hasil Produksi)
  -- Instead of just deleting, we should check if the stock is still there
  -- For production, we usually delete the batch if it's still full, 
  -- but since produced items might have been sold, the safest path for void_production 
  -- is often to consume it back if sold, or simply delete the remaining.
  -- Current logic: Hard delete produced batch.
  IF v_record.quantity > 0 AND v_record.product_id IS NOT NULL THEN
    DELETE FROM inventory_batches 
    WHERE product_id = v_record.product_id 
      AND (production_id = v_record.id OR notes = 'Produksi ' || v_record.ref);
    
    -- Update product stock (legacy column but kept for products in v2)
    UPDATE products 
    SET current_stock = GREATEST(0, current_stock - v_record.quantity), 
        updated_at = NOW()
    WHERE id = v_record.product_id;
  END IF;

  -- 4. Delete Material Stock Movements
  DELETE FROM material_stock_movements 
  WHERE reference_id = v_record.id::TEXT AND reference_type = 'production';

  -- 5. Void Related Journals
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

  -- 6. Finally Delete Production Record
  DELETE FROM production_records WHERE id = p_production_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$function$
;


