-- =====================================================
-- 10 RETASI
-- Generated: 2026-01-09T00:29:07.862Z
-- Total functions: 9
-- =====================================================
DROP FUNCTION IF EXISTS public.process_retasi_atomic(jsonb, jsonb, uuid, uuid, text);

-- Functions in this file:
--   create_retasi_atomic
--   driver_has_unreturned_retasi
--   generate_retasi_number
--   get_next_retasi_counter
--   mark_retasi_returned
--   mark_retasi_returned_atomic
--   set_retasi_ke
--   set_retasi_ke_and_number
--   void_retasi_atomic

-- =====================================================
-- Function: create_retasi_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.create_retasi_atomic(p_branch_id uuid, p_driver_name text, p_helper_name text DEFAULT NULL::text, p_truck_number text DEFAULT NULL::text, p_route text DEFAULT NULL::text, p_departure_date date DEFAULT CURRENT_DATE, p_departure_time text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, retasi_id uuid, retasi_number text, retasi_ke integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_retasi_id UUID := gen_random_uuid();
  v_retasi_number TEXT;
  v_retasi_ke INTEGER;
  v_item RECORD;
BEGIN
  -- ==================== VALIDASI ====================
  
  -- Check if driver has active retasi
  IF EXISTS (
    SELECT 1 FROM retasi 
    WHERE driver_name = p_driver_name 
      AND is_returned = FALSE
      AND (branch_id = p_branch_id OR branch_id IS NULL)
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::INTEGER, 
      format('Supir %s masih memiliki retasi yang belum dikembalikan', p_driver_name)::TEXT;
    RETURN;
  END IF;

  -- Generate Retasi Number: RET-YYYYMMDD-HHMISS
  v_retasi_number := 'RET-' || TO_CHAR(p_departure_date, 'YYYYMMDD') || '-' || TO_CHAR(NOW(), 'HH24MISS');

  -- Count retasi_ke for today
  SELECT COALESCE(COUNT(*), 0) + 1 INTO v_retasi_ke
  FROM retasi
  WHERE driver_name = p_driver_name
    AND departure_date = p_departure_date
    AND (branch_id = p_branch_id OR branch_id IS NULL);

  -- ==================== INSERT RETASI ====================
  
  INSERT INTO retasi (
    id,
    branch_id,
    retasi_number,
    truck_number,
    driver_name,
    helper_name,
    departure_date,
    departure_time,
    route,
    total_items,
    notes,
    retasi_ke,
    is_returned,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_retasi_id,
    p_branch_id,
    v_retasi_number,
    p_truck_number,
    p_driver_name,
    p_helper_name,
    p_departure_date,
    CASE WHEN p_departure_time IS NOT NULL AND p_departure_time != ''
         THEN p_departure_time::TIME
         ELSE NULL
    END,
    p_route,
    (SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) FROM jsonb_array_elements(p_items) AS item),
    p_notes,
    v_retasi_ke,
    FALSE,
    p_created_by,
    NOW(),
    NOW()
  );

  -- ==================== INSERT ITEMS ====================
  
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(
    product_id UUID, 
    product_name TEXT, 
    quantity NUMERIC, 
    weight NUMERIC, 
    notes TEXT
  ) LOOP
    INSERT INTO retasi_items (
      retasi_id,
      product_id,
      product_name,
      quantity,
      weight,
      notes,
      created_at
    ) VALUES (
      v_retasi_id,
      v_item.product_id,
      v_item.product_name,
      v_item.quantity,
      v_item.weight,
      v_item.notes,
      NOW()
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, v_retasi_id, v_retasi_number, v_retasi_ke, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::INTEGER, SQLERRM::TEXT;
END;
$function$
;


-- =====================================================
-- Function: driver_has_unreturned_retasi
-- =====================================================
CREATE OR REPLACE FUNCTION public.driver_has_unreturned_retasi(driver text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  count_unreturned INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO count_unreturned
  FROM public.retasi
  WHERE driver_name = driver 
    AND is_returned = FALSE;
  
  RETURN count_unreturned > 0;
END;
$function$
;


-- =====================================================
-- Function: generate_retasi_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_retasi_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  new_number TEXT;
  counter INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(retasi_number FROM 12 FOR 3) AS INTEGER)), 0) + 1
  INTO counter
  FROM public.retasi
  WHERE retasi_number LIKE 'RET-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-%';
  
  new_number := 'RET-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(counter::TEXT, 3, '0');
  
  RETURN new_number;
END;
$function$
;


-- =====================================================
-- Function: get_next_retasi_counter
-- =====================================================
CREATE OR REPLACE FUNCTION public.get_next_retasi_counter(driver text, target_date date DEFAULT CURRENT_DATE)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  counter INTEGER;
BEGIN
  -- Get the highest retasi_ke for the driver on the specific date
  SELECT COALESCE(MAX(retasi_ke), 0) + 1
  INTO counter
  FROM public.retasi
  WHERE driver_name = driver 
    AND departure_date = target_date;
  
  RETURN counter;
END;
$function$
;


-- =====================================================
-- Function: mark_retasi_returned
-- =====================================================
CREATE OR REPLACE FUNCTION public.mark_retasi_returned(retasi_id uuid, returned_count integer DEFAULT 0, error_count integer DEFAULT 0, notes text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE public.retasi 
  SET 
    is_returned = TRUE,
    returned_items_count = returned_count,
    error_items_count = error_count,
    return_notes = notes,
    updated_at = NOW()
  WHERE id = retasi_id;
  
  RETURN FOUND;
END;
$function$
;


-- =====================================================
-- Function: mark_retasi_returned_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.mark_retasi_returned_atomic(p_branch_id uuid, p_retasi_id uuid, p_return_notes text, p_item_returns jsonb, p_manual_kembali numeric DEFAULT NULL::numeric, p_manual_laku numeric DEFAULT NULL::numeric, p_manual_tidak_laku numeric DEFAULT NULL::numeric, p_manual_error numeric DEFAULT NULL::numeric)
 RETURNS TABLE(success boolean, barang_laku numeric, barang_tidak_laku numeric, returned_items_count numeric, error_items_count numeric, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_item RECORD;
  v_total_kembali NUMERIC := 0;    -- SUM of returned_qty (barang kembali utuh)
  v_total_laku NUMERIC := 0;       -- SUM of sold_qty (barang terjual)
  v_total_tidak_laku NUMERIC := 0; -- SUM of unsold_qty (barang tidak laku)
  v_total_error NUMERIC := 0;      -- SUM of error_qty (barang rusak/error)
  v_has_items BOOLEAN := FALSE;
BEGIN
  -- ==================== VALIDASI ====================

  IF NOT EXISTS (SELECT 1 FROM retasi WHERE id = p_retasi_id AND is_returned = FALSE) THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC,
      'Retasi tidak ditemukan atau sudah dikembalikan'::TEXT;
    RETURN;
  END IF;

  -- ==================== CEK APAKAH ADA ITEM DETAILS ====================

  -- Cek apakah p_item_returns memiliki data
  IF p_item_returns IS NOT NULL AND jsonb_array_length(p_item_returns) > 0 THEN
    v_has_items := TRUE;
  END IF;

  -- ==================== UPDATE ITEMS & HITUNG TOTAL ====================

  IF v_has_items THEN
    -- Ada item details: hitung dari item_returns
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_item_returns) AS x(
      item_id UUID,
      returned_qty NUMERIC,
      sold_qty NUMERIC,
      error_qty NUMERIC,
      unsold_qty NUMERIC
    ) LOOP
      -- Update item dengan nilai yang dikirim
      UPDATE retasi_items
      SET
        returned_qty = COALESCE(v_item.returned_qty, 0),
        sold_qty = COALESCE(v_item.sold_qty, 0),
        error_qty = COALESCE(v_item.error_qty, 0),
        unsold_qty = COALESCE(v_item.unsold_qty, 0)
      WHERE id = v_item.item_id AND retasi_id = p_retasi_id;

      -- Hitung total (SUM, bukan COUNT)
      v_total_kembali := v_total_kembali + COALESCE(v_item.returned_qty, 0);
      v_total_laku := v_total_laku + COALESCE(v_item.sold_qty, 0);
      v_total_tidak_laku := v_total_tidak_laku + COALESCE(v_item.unsold_qty, 0);
      v_total_error := v_total_error + COALESCE(v_item.error_qty, 0);
    END LOOP;
  ELSE
    -- Tidak ada item details (data lama): gunakan manual totals
    v_total_kembali := COALESCE(p_manual_kembali, 0);
    v_total_laku := COALESCE(p_manual_laku, 0);
    v_total_tidak_laku := COALESCE(p_manual_tidak_laku, 0);
    v_total_error := COALESCE(p_manual_error, 0);
  END IF;

  -- ==================== UPDATE RETASI ====================
  -- Rumus: Bawa = Kembali + Laku + Tidak Laku + Error + Selisih
  -- returned_items_count = total qty kembali (bukan count produk)
  -- error_items_count = total qty error (bukan count produk)

  UPDATE retasi
  SET
    is_returned = TRUE,
    return_notes = p_return_notes,
    returned_items_count = v_total_kembali,
    barang_laku = v_total_laku,
    barang_tidak_laku = v_total_tidak_laku,
    error_items_count = v_total_error,
    updated_at = NOW()
  WHERE id = p_retasi_id;

  RETURN QUERY SELECT TRUE, v_total_laku, v_total_tidak_laku, v_total_kembali, v_total_error, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, SQLERRM::TEXT;
END;
$function$
;




-- =====================================================
-- Function: set_retasi_ke
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_retasi_ke()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Auto-generate retasi number if not provided
  IF NEW.retasi_number IS NULL OR NEW.retasi_number = '' THEN
    NEW.retasi_number := generate_retasi_number();
  END IF;
  
  -- Auto-set retasi_ke based on driver and date
  IF NEW.driver_name IS NOT NULL THEN
    NEW.retasi_ke := get_next_retasi_counter(NEW.driver_name, NEW.departure_date);
  END IF;
  
  RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: set_retasi_ke_and_number
-- =====================================================
CREATE OR REPLACE FUNCTION public.set_retasi_ke_and_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Auto-generate retasi number if not provided
  IF NEW.retasi_number IS NULL OR NEW.retasi_number = '' THEN
    NEW.retasi_number := generate_retasi_number();
  END IF;
  
  -- Auto-set retasi_ke based on driver and date
  IF NEW.driver_name IS NOT NULL THEN
    NEW.retasi_ke := get_next_retasi_counter(NEW.driver_name, NEW.departure_date);
  END IF;
  
  RETURN NEW;
END;
$function$
;


-- =====================================================
-- Function: void_retasi_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.void_retasi_atomic(p_retasi_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(success boolean, batches_removed integer, journals_voided integer, error_message text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_retasi RECORD;
  v_batches_removed INTEGER := 0;
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Get retasi record
  SELECT * INTO v_retasi
  FROM retasi
  WHERE id = p_retasi_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF v_retasi.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Retasi tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_retasi.status = 'cancelled' THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Retasi sudah dibatalkan'::TEXT;
    RETURN;
  END IF;
  -- ==================== REMOVE INVENTORY BATCHES ====================
  DELETE FROM inventory_batches
  WHERE reference_type = 'retasi'
    AND reference_id = p_retasi_id::TEXT
    AND branch_id = p_branch_id;
  GET DIAGNOSTICS v_batches_removed = ROW_COUNT;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'retasi'
    AND reference_id = p_retasi_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== UPDATE STATUS ====================
  UPDATE retasi
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_retasi_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_batches_removed, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, SQLERRM::TEXT;
END;
$function$
;


