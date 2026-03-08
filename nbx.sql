--
-- PostgreSQL database dump
--

\restrict sHNMMZvVD5W15EnwTLf5qe21Npxrz49tmWx8k7vsMAxLORsgdNrZMAxide44mav

-- Dumped from database version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)
-- Dumped by pg_dump version 14.22 (Ubuntu 14.22-0ubuntu0.22.04.1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: attendance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.attendance_status AS ENUM (
    'Hadir',
    'Pulang'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    jwt_claims JSON;
BEGIN
    jwt_claims := current_setting('request.jwt.claims', true)::JSON;
    IF jwt_claims IS NULL THEN RETURN NULL; END IF;
    RETURN jwt_claims->>'email';
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


--
-- Name: has_role(text); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.has_role(required_role text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    user_role := auth.role();
    -- owner has all permissions
    IF user_role = 'owner' THEN RETURN TRUE; END IF;
    -- admin has most permissions
    IF user_role = 'admin' AND required_role IN ('admin', 'manager', 'cashier', 'authenticated') THEN RETURN TRUE; END IF;
    -- manager has manager and below
    IF user_role = 'manager' AND required_role IN ('manager', 'cashier', 'authenticated') THEN RETURN TRUE; END IF;
    -- cashier has cashier and authenticated
    IF user_role = 'cashier' AND required_role IN ('cashier', 'authenticated') THEN RETURN TRUE; END IF;
    -- exact match
    RETURN user_role = required_role;
END;
$$;


--
-- Name: is_authenticated(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.is_authenticated() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN
    RETURN auth.uid() IS NOT NULL;
END;
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    jwt_claims JSON;
    user_role TEXT;
    user_uuid UUID;
BEGIN
    -- First try to get role from JWT
    jwt_claims := current_setting('request.jwt.claims', true)::JSON;
    IF jwt_claims IS NOT NULL THEN
        user_role := jwt_claims->>'role';
        IF user_role IS NOT NULL AND user_role != '' THEN
            RETURN user_role;
        END IF;
    END IF;
    
    -- Fallback: get role from profiles using auth.uid()
    user_uuid := auth.uid();
    IF user_uuid IS NOT NULL THEN
        SELECT role INTO user_role
        FROM profiles
        WHERE id = user_uuid;
        
        IF user_role IS NOT NULL THEN
            RETURN user_role;
        END IF;
    END IF;
    
    RETURN 'authenticated';
EXCEPTION WHEN OTHERS THEN
    RETURN 'authenticated';
END;
$$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    jwt_claims JSON;
    user_id TEXT;
BEGIN
    jwt_claims := current_setting('request.jwt.claims', true)::JSON;
    IF jwt_claims IS NULL THEN RETURN NULL; END IF;

    user_id := jwt_claims->>'user_id';
    IF user_id IS NULL THEN user_id := jwt_claims->>'sub'; END IF;
    IF user_id IS NULL OR user_id = '' THEN RETURN NULL; END IF;

    RETURN user_id::UUID;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;


--
-- Name: add_material_batch(uuid, uuid, numeric, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_material_batch(p_material_id uuid, p_branch_id uuid, p_quantity numeric, p_unit_cost numeric, p_reference_id text DEFAULT NULL::text, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, batch_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_batch_id UUID;
  v_material_name TEXT;
  v_current_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Material ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get material name
  SELECT name INTO v_material_name
  FROM materials WHERE id = p_material_id;

  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Material not found'::TEXT;
    RETURN;
  END IF;

  -- Get current stock
  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_current_stock
  FROM inventory_batches
  WHERE material_id = p_material_id AND remaining_quantity > 0;

  -- ==================== CREATE BATCH ====================

  INSERT INTO inventory_batches (
    material_id,
    branch_id,
    initial_quantity,
    remaining_quantity,
    unit_cost,
    batch_date,
    notes
  ) VALUES (
    p_material_id,
    p_branch_id,
    p_quantity,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    NOW(),
    COALESCE(p_notes, format('Purchase: %s', COALESCE(p_reference_id, 'direct')))
  )
  RETURNING id INTO v_new_batch_id;

  -- ==================== LOGGING ====================

  INSERT INTO material_stock_movements (
    material_id,
    material_name,
    type,
    reason,
    quantity,
    previous_stock,
    new_stock,
    reference_id,
    reference_type,
    notes,
    branch_id,
    created_at
  ) VALUES (
    p_material_id,
    v_material_name,
    'IN',
    'PURCHASE',
    p_quantity,
    v_current_stock,
    v_current_stock + p_quantity,
    p_reference_id,
    'purchase',
    format('New batch %s: %s units @ %s', v_new_batch_id, p_quantity, p_unit_cost),
    p_branch_id,
    NOW()
  );

  -- Update legacy stock column in materials table
  UPDATE materials 
  SET stock = stock + p_quantity,
      updated_at = NOW()
  WHERE id = p_material_id;

  RETURN QUERY SELECT TRUE, v_new_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: add_material_stock(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.add_material_stock(material_id uuid, quantity_to_add numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE public.materials
  SET stock = stock + quantity_to_add
  WHERE id = material_id;
END;
$$;


--
-- Name: approve_purchase_order_atomic(text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.approve_purchase_order_atomic(p_po_id text, p_branch_id uuid, p_user_id uuid, p_user_name text) RETURNS TABLE(success boolean, journal_ids uuid[], ap_id text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_journal_id UUID;
  v_journal_ids UUID[] := ARRAY[]::UUID[];
  v_ap_id TEXT;
  v_entry_number TEXT;
  v_acc_persediaan_bahan TEXT;
  v_acc_persediaan_produk TEXT;
  v_acc_hutang_usaha TEXT;
  v_acc_piutang_pajak TEXT;
  v_total_material NUMERIC := 0;
  v_total_product NUMERIC := 0;
  v_material_ppn NUMERIC := 0;
  v_product_ppn NUMERIC := 0;
  v_material_names TEXT := '';
  v_product_names TEXT := '';
  v_subtotal_all NUMERIC := 0;
  v_days INTEGER;
  v_due_date DATE;
  v_supplier_terms TEXT;
  v_existing_journal_count INTEGER;
  v_existing_ap_count INTEGER;
BEGIN
  SELECT * INTO v_po FROM purchase_orders WHERE id = p_po_id AND branch_id = p_branch_id;
  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Purchase Order tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_po.status <> 'Pending' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Hanya PO status Pending yang bisa disetujui'::TEXT;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing_journal_count
  FROM journal_entries
  WHERE reference_id = p_po_id
    AND reference_type = 'purchase_order'
    AND is_voided = FALSE;

  IF v_existing_journal_count > 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      format('Journal sudah ada untuk PO ini (%s entries). Tidak dapat approve lagi.', v_existing_journal_count)::TEXT;
    RETURN;
  END IF;

  SELECT COUNT(*) INTO v_existing_ap_count
  FROM accounts_payable
  WHERE purchase_order_id = p_po_id;

  IF v_existing_ap_count > 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      'Accounts Payable sudah ada untuk PO ini. Tidak dapat approve lagi.'::TEXT;
    RETURN;
  END IF;

  SELECT id INTO v_acc_persediaan_bahan FROM accounts WHERE code = '1320' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_persediaan_produk FROM accounts WHERE code = '1310' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_hutang_usaha FROM accounts WHERE code = '2110' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_acc_piutang_pajak FROM accounts WHERE code = '1230' AND branch_id = p_branch_id LIMIT 1;

  IF v_acc_hutang_usaha IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Hutang Usaha (2110) tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- FIX: Validasi akun PPN harus ada jika PPN diaktifkan
  IF v_po.include_ppn AND v_po.ppn_amount > 0 AND v_acc_piutang_pajak IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 
      'PPN diaktifkan tapi Akun Piutang Pajak / PPN Masukan (1230) tidak ditemukan. Buat akun tersebut terlebih dahulu.'::TEXT;
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM purchase_order_items WHERE purchase_order_id = p_po_id LOOP
    v_subtotal_all := v_subtotal_all + COALESCE(v_item.subtotal, 0);
    IF v_item.item_type = 'material' OR v_item.material_id IS NOT NULL THEN
      v_total_material := v_total_material + COALESCE(v_item.subtotal, 0);
      v_material_names := v_material_names || v_item.material_name || ' x' || v_item.quantity || ', ';
    ELSE
      v_total_product := v_total_product + COALESCE(v_item.subtotal, 0);
      v_product_names := v_product_names || v_item.product_name || ' x' || v_item.quantity || ', ';
    END IF;
  END LOOP;

  v_material_names := RTRIM(v_material_names, ', ');
  v_product_names := RTRIM(v_product_names, ', ');

  IF v_po.include_ppn AND v_po.ppn_amount > 0 AND v_subtotal_all > 0 THEN
    v_material_ppn := ROUND(v_po.ppn_amount * (v_total_material / v_subtotal_all));
    v_product_ppn := v_po.ppn_amount - v_material_ppn;
  END IF;

  -- 4. Material Journal
  IF v_total_material > 0 THEN
    IF v_acc_persediaan_bahan IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Persediaan Bahan Baku (1320) tidak ditemukan'::TEXT;
      RETURN;
    END IF;

    DECLARE
       v_journal_lines JSONB := '[]'::JSONB;
       v_journal_res RECORD;
       v_material_ppn_applied NUMERIC := 0;
    BEGIN
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_persediaan_bahan,
          'debit_amount', v_total_material,
          'credit_amount', 0,
          'description', 'Persediaan: ' || v_material_names
       );
       
       IF v_material_ppn > 0 AND v_acc_piutang_pajak IS NOT NULL THEN
          v_journal_lines := v_journal_lines || jsonb_build_object(
            'account_id', v_acc_piutang_pajak,
            'debit_amount', v_material_ppn,
            'credit_amount', 0,
            'description', 'PPN Masukan (PO ' || p_po_id || ')'
          );
          v_material_ppn_applied := v_material_ppn;
       END IF;

       -- FIX: Credit = persediaan + PPN yang BENAR-BENAR di-debit (bukan selalu + ppn)
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_hutang_usaha,
          'debit_amount', 0,
          'credit_amount', v_total_material + v_material_ppn_applied,
          'description', 'Hutang: ' || v_po.supplier_name
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id, CURRENT_DATE,
         'Pembelian Bahan Baku: ' || v_po.supplier_name || ' (' || p_po_id || ')',
         'purchase_order', p_po_id, v_journal_lines, TRUE
       );

       IF v_journal_res.success THEN
         v_journal_ids := array_append(v_journal_ids, v_journal_res.journal_id);
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal bahan baku PO: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  -- 5. Product Journal
  IF v_total_product > 0 THEN
    IF v_acc_persediaan_produk IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, 'Akun Persediaan Barang Dagang (1310) tidak ditemukan'::TEXT;
      RETURN;
    END IF;

    DECLARE
       v_journal_lines JSONB := '[]'::JSONB;
       v_journal_res RECORD;
       v_product_ppn_applied NUMERIC := 0;
    BEGIN
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_persediaan_produk,
          'debit_amount', v_total_product,
          'credit_amount', 0,
          'description', 'Persediaan: ' || v_product_names
       );

       IF v_product_ppn > 0 AND v_acc_piutang_pajak IS NOT NULL THEN
           v_journal_lines := v_journal_lines || jsonb_build_object(
            'account_id', v_acc_piutang_pajak,
            'debit_amount', v_product_ppn,
            'credit_amount', 0,
            'description', 'PPN Masukan (PO ' || p_po_id || ')'
           );
           v_product_ppn_applied := v_product_ppn;
       END IF;

       -- FIX: Credit = persediaan + PPN yang BENAR-BENAR di-debit
       v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_acc_hutang_usaha,
          'debit_amount', 0,
          'credit_amount', v_total_product + v_product_ppn_applied,
          'description', 'Hutang: ' || v_po.supplier_name
       );
       
       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id, CURRENT_DATE,
         'Pembelian Produk Jadi: ' || v_po.supplier_name || ' (' || p_po_id || ')',
         'purchase_order', p_po_id, v_journal_lines, TRUE
       );

       IF v_journal_res.success THEN
         v_journal_ids := array_append(v_journal_ids, v_journal_res.journal_id);
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal produk PO: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  -- 6. Create AP
  v_due_date := NOW()::DATE + INTERVAL '30 days';
  SELECT payment_terms INTO v_supplier_terms FROM suppliers WHERE id = v_po.supplier_id;
  IF v_supplier_terms ILIKE '%net%' THEN
    v_days := (regexp_matches(v_supplier_terms, '\d+'))[1]::INTEGER;
    v_due_date := NOW()::DATE + (v_days || ' days')::INTERVAL;
  ELSIF v_supplier_terms ILIKE '%cash%' THEN
    v_due_date := NOW()::DATE;
  END IF;

  v_ap_id := 'AP-PO-' || p_po_id;

  INSERT INTO accounts_payable (
    id, purchase_order_id, supplier_name, amount, due_date,
    description, status, paid_amount, branch_id, created_at
  ) VALUES (
    v_ap_id, p_po_id, v_po.supplier_name, v_po.total_cost, v_due_date,
    'Purchase Order ' || p_po_id || ' - ' || COALESCE(v_material_names, '') || COALESCE(v_product_names, ''), 
    'Outstanding', 0, p_branch_id, NOW()
  );

  -- 7. Update PO Status
  UPDATE purchase_orders
  SET status = 'Approved', approved_at = NOW(), approved_by = p_user_name
  WHERE id = p_po_id;

  RETURN QUERY SELECT TRUE, v_journal_ids, v_ap_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID[], NULL::TEXT, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION approve_purchase_order_atomic(p_po_id text, p_branch_id uuid, p_user_id uuid, p_user_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.approve_purchase_order_atomic(p_po_id text, p_branch_id uuid, p_user_id uuid, p_user_name text) IS 'FIXED: Added duplicate check to prevent double journal/AP creation. Creates journal (Dr. Persediaan, Cr. Hutang) and AP record.';


--
-- Name: assign_driver_to_transaction(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.assign_driver_to_transaction(p_transaction_id text, p_driver_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE public.transactions
    SET assigned_driver_id = p_driver_id,
        updated_at = NOW()
    WHERE id = p_transaction_id;
    
    RETURN FOUND;
END;
$$;


--
-- Name: audit_profiles_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_profiles_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'DELETE',
      OLD.id::TEXT,
      row_to_json(OLD)::JSONB,
      NULL,
      jsonb_build_object('deleted_user_name', OLD.full_name)
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'UPDATE',
      NEW.id::TEXT,
      row_to_json(OLD)::JSONB,
      row_to_json(NEW)::JSONB,
      jsonb_build_object('updated_fields', (
        SELECT jsonb_object_agg(key, value)
        FROM jsonb_each(row_to_json(NEW)::JSONB)
        WHERE value != (row_to_json(OLD)::JSONB ->> key)::JSONB
      ))
    );
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.create_audit_log(
      'profiles',
      'INSERT',
      NEW.id::TEXT,
      NULL,
      row_to_json(NEW)::JSONB,
      jsonb_build_object('new_user_name', NEW.full_name)
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: audit_transactions_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_transactions_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.create_audit_log(
      'transactions',
      'DELETE',
      OLD.id,
      row_to_json(OLD)::JSONB,
      NULL,
      jsonb_build_object(
        'transaction_total', OLD.total,
        'customer_name', OLD.customer_name
      )
    );
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Only log significant updates
    IF OLD.total != NEW.total OR OLD.payment_status != NEW.payment_status OR OLD.status != NEW.status THEN
      PERFORM public.create_audit_log(
        'transactions',
        'UPDATE',
        NEW.id,
        row_to_json(OLD)::JSONB,
        row_to_json(NEW)::JSONB,
        jsonb_build_object(
          'customer_name', NEW.customer_name,
          'old_total', OLD.total,
          'new_total', NEW.total,
          'old_status', OLD.status,
          'new_status', NEW.status
        )
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM public.create_audit_log(
      'transactions',
      'INSERT',
      NEW.id,
      NULL,
      row_to_json(NEW)::JSONB,
      jsonb_build_object(
        'customer_name', NEW.customer_name,
        'total_amount', NEW.total
      )
    );
    RETURN NEW;
  END IF;
  RETURN NULL;
END;
$$;


--
-- Name: audit_trigger_func(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_trigger_func() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  old_data jsonb := NULL;
  new_data jsonb := NULL;
  changed_fields jsonb := NULL;
  record_id text := NULL;
  current_user_id uuid := NULL;
  current_user_email text := NULL;
  current_user_role text := NULL;
  key text;
  old_value jsonb;
  new_value jsonb;
BEGIN
  -- Coba ambil info user dari JWT
  BEGIN
    current_user_id := (current_setting('request.jwt.claims', true)::jsonb->>'sub')::uuid;
    current_user_email := current_setting('request.jwt.claims', true)::jsonb->>'email';
    current_user_role := current_setting('request.jwt.claims', true)::jsonb->>'role';
  EXCEPTION WHEN OTHERS THEN
    current_user_email := current_user;
  END;
  IF (TG_OP = 'DELETE') THEN
    old_data := to_jsonb(OLD);
    record_id := COALESCE(OLD.id::text, 'unknown');
  ELSIF (TG_OP = 'UPDATE') THEN
    old_data := to_jsonb(OLD);
    new_data := to_jsonb(NEW);
    record_id := COALESCE(NEW.id::text, OLD.id::text, 'unknown');
    -- Hitung field yang berubah
    changed_fields := '{}'::jsonb;
    FOR key IN SELECT jsonb_object_keys(new_data)
    LOOP
      old_value := old_data->key;
      new_value := new_data->key;
      IF old_value IS DISTINCT FROM new_value AND key NOT IN ('updated_at') THEN
        changed_fields := changed_fields || jsonb_build_object(
          key, jsonb_build_object('old', old_value, 'new', new_value)
        );
      END IF;
    END LOOP;
    IF changed_fields = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF (TG_OP = 'INSERT') THEN
    new_data := to_jsonb(NEW);
    record_id := COALESCE(NEW.id::text, 'unknown');
  END IF;
  INSERT INTO audit_logs (table_name, operation, record_id, old_data, new_data, changed_fields, user_id, user_email, user_role, created_at)
  VALUES (TG_TABLE_NAME, TG_OP, record_id, old_data, new_data, changed_fields, current_user_id, current_user_email, current_user_role, NOW());
  IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;


--
-- Name: calculate_asset_current_value(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_asset_current_value(p_asset_id text) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_purchase_price NUMERIC;
    v_purchase_date DATE;
    v_useful_life_years INTEGER;
    v_salvage_value NUMERIC;
    v_depreciation_method TEXT;
    v_years_elapsed NUMERIC;
    v_current_value NUMERIC;
BEGIN
    -- Get asset details
    SELECT
        purchase_price,
        purchase_date,
        useful_life_years,
        salvage_value,
        depreciation_method
    INTO
        v_purchase_price,
        v_purchase_date,
        v_useful_life_years,
        v_salvage_value,
        v_depreciation_method
    FROM assets
    WHERE id = p_asset_id;
    -- Calculate years elapsed
    v_years_elapsed := EXTRACT(YEAR FROM AGE(CURRENT_DATE, v_purchase_date)) +
                      (EXTRACT(MONTH FROM AGE(CURRENT_DATE, v_purchase_date)) / 12.0);
    -- Calculate depreciation based on method
    IF v_depreciation_method = 'straight_line' THEN
        -- Straight-line depreciation
        v_current_value := v_purchase_price -
                          ((v_purchase_price - v_salvage_value) / v_useful_life_years * v_years_elapsed);
    ELSE
        -- Declining balance (double declining)
        v_current_value := v_purchase_price * POWER(1 - (2.0 / v_useful_life_years), v_years_elapsed);
    END IF;
    -- Ensure value doesn't go below salvage value
    IF v_current_value < v_salvage_value THEN
        v_current_value := v_salvage_value;
    END IF;
    RETURN GREATEST(v_current_value, 0);
END;
$$;


--
-- Name: calculate_balance_delta(text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_balance_delta(p_account_id text, p_debit numeric, p_credit numeric) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_type TEXT;
    v_delta NUMERIC;
BEGIN
    SELECT type INTO v_type FROM accounts WHERE id = p_account_id;
    
    -- Default to Aset logic if type not found (safe fallback)
    v_type := COALESCE(v_type, 'Aset');

    IF v_type IN ('Aset', 'Beban') THEN
        v_delta := p_debit - p_credit;
    ELSE
        -- Kewajiban, Modal, Pendapatan: Credit increases balance
        v_delta := p_credit - p_debit;
    END IF;

    RETURN v_delta;
END;
$$;


--
-- Name: calculate_commission_amount(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission_amount() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.amount = NEW.quantity * NEW.rate_per_qty;
  RETURN NEW;
END;
$$;


--
-- Name: calculate_commission_for_period(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_commission_for_period(emp_id uuid, start_date date, end_date date) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_commission DECIMAL(15,2) := 0;
BEGIN
  -- Calculate commission from commission_entries table
  SELECT COALESCE(SUM(amount), 0) INTO total_commission
  FROM commission_entries
  WHERE user_id = emp_id::text
    AND status = 'pending'
    AND created_at >= start_date
    AND created_at < (end_date + INTERVAL '1 day');
  RETURN total_commission;
END;
$$;


--
-- Name: calculate_fifo_cost(uuid, uuid, numeric, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_fifo_cost(p_product_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid, p_quantity numeric DEFAULT 0, p_material_id uuid DEFAULT NULL::uuid) RETURNS TABLE(total_hpp numeric, batches_info jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  remaining_qty NUMERIC := p_quantity;
  batch_record RECORD;
  consume_qty NUMERIC;
  total_cost NUMERIC := 0;
  batch_list JSONB := '[]'::JSONB;
BEGIN
  IF p_product_id IS NULL AND p_material_id IS NULL THEN RETURN QUERY SELECT 0::NUMERIC, '[]'::JSONB; RETURN; END IF;
  FOR batch_record IN
    SELECT id, remaining_quantity, unit_cost FROM inventory_batches
    WHERE ((p_product_id IS NOT NULL AND product_id = p_product_id) OR (p_material_id IS NOT NULL AND material_id = p_material_id))
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
      AND remaining_quantity > 0
    ORDER BY batch_date ASC, created_at ASC
  LOOP
    IF remaining_qty <= 0 THEN EXIT; END IF;
    consume_qty := LEAST(remaining_qty, batch_record.remaining_quantity);
    total_cost := total_cost + (consume_qty * COALESCE(batch_record.unit_cost, 0));
    batch_list := batch_list || jsonb_build_object('batch_id', batch_record.id, 'quantity', consume_qty, 'unit_cost', batch_record.unit_cost, 'subtotal', consume_qty * COALESCE(batch_record.unit_cost, 0));
    remaining_qty := remaining_qty - consume_qty;
  END LOOP;
  IF remaining_qty > 0 AND p_product_id IS NOT NULL THEN
    DECLARE fallback_cost NUMERIC := 0;
    BEGIN
      SELECT COALESCE(cost_price, base_price, 0) INTO fallback_cost FROM products WHERE id = p_product_id;
      IF fallback_cost > 0 THEN total_cost := total_cost + (fallback_cost * remaining_qty); batch_list := batch_list || jsonb_build_object('batch_id', 'fallback', 'cost', fallback_cost); END IF;
    END;
  END IF;
  RETURN QUERY SELECT total_cost, batch_list;
END;
$$;


--
-- Name: calculate_payroll_with_advances(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_payroll_with_advances(emp_id uuid, period_year integer, period_month integer) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  salary_config public.employee_salaries;
  period_start DATE;
  period_end DATE;
  base_salary DECIMAL(15,2) := 0;
  commission_amount DECIMAL(15,2) := 0;
  outstanding_advances DECIMAL(15,2) := 0;
  advance_deduction DECIMAL(15,2) := 0;
  bonus_amount DECIMAL(15,2) := 0;
  total_deduction DECIMAL(15,2) := 0;
  gross_salary DECIMAL(15,2) := 0;
  net_salary DECIMAL(15,2) := 0;
  result JSONB;
BEGIN
  -- Calculate period dates
  period_start := DATE(period_year || '-' || period_month || '-01');
  period_end := (period_start + INTERVAL '1 month - 1 day')::DATE;
  -- Get active salary configuration
  SELECT * INTO salary_config FROM public.get_active_salary_config(emp_id, period_start);
  IF salary_config IS NULL THEN
    RAISE EXCEPTION 'No active salary configuration found for employee';
  END IF;
  -- Calculate base salary
  IF salary_config.payroll_type IN ('monthly', 'mixed') THEN
    base_salary := salary_config.base_salary;
  END IF;
  -- ALWAYS calculate commission from commission_entries table
  -- (regardless of commission_rate setting in salary config)
  IF salary_config.payroll_type IN ('commission_only', 'mixed') THEN
    commission_amount := public.calculate_commission_for_period(emp_id, period_start, period_end);
  END IF;
  -- Calculate outstanding advances (up to end of payroll period)
  outstanding_advances := public.get_outstanding_advances(emp_id, period_end);
  -- Calculate gross salary
  gross_salary := base_salary + commission_amount + bonus_amount;
  -- Calculate advance deduction (don't deduct more than net salary)
  advance_deduction := LEAST(outstanding_advances, gross_salary);
  total_deduction := advance_deduction;
  -- Calculate net salary
  net_salary := gross_salary - total_deduction;
  -- Build result JSON
  result := jsonb_build_object(
    'employeeId', emp_id,
    'periodYear', period_year,
    'periodMonth', period_month,
    'periodStart', period_start,
    'periodEnd', period_end,
    'baseSalary', base_salary,
    'commissionAmount', commission_amount,
    'bonusAmount', bonus_amount,
    'outstandingAdvances', outstanding_advances,
    'advanceDeduction', advance_deduction,
    'totalDeduction', total_deduction,
    'grossSalary', gross_salary,
    'netSalary', net_salary,
    'salaryConfigId', salary_config.id,
    'payrollType', salary_config.payroll_type
  );
  RETURN result;
END;
$$;


--
-- Name: calculate_transaction_payment_status(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_transaction_payment_status(p_transaction_id text) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  transaction_total NUMERIC;
  total_paid NUMERIC;
BEGIN
  -- Get transaction total
  SELECT total INTO transaction_total FROM transactions WHERE id = p_transaction_id;
  IF transaction_total IS NULL THEN RETURN 'unknown'; END IF;
  
  -- Calculate total payments (active only)
  SELECT COALESCE(SUM(amount), 0) INTO total_paid
  FROM transaction_payments 
  WHERE transaction_id = p_transaction_id AND status = 'active';
  
  -- Return status
  IF total_paid = 0 THEN RETURN 'unpaid';
  ELSIF total_paid >= transaction_total THEN RETURN 'paid';
  ELSE RETURN 'partial';
  END IF;
END;
$$;


--
-- Name: calculate_zakat_amount(numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calculate_zakat_amount(p_asset_value numeric, p_nishab_type text DEFAULT 'gold'::text) RETURNS TABLE(asset_value numeric, nishab_value numeric, is_obligatory boolean, zakat_amount numeric, rate numeric)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_nishab_value NUMERIC;
  v_rate NUMERIC;
BEGIN
  -- Get current nishab values
  SELECT 
    CASE WHEN p_nishab_type = 'gold' THEN nr.gold_price * nr.gold_nishab
         ELSE nr.silver_price * nr.silver_nishab END,
    nr.zakat_rate
  INTO v_nishab_value, v_rate
  FROM nishab_reference nr
  WHERE nr.effective_date <= CURRENT_DATE
  ORDER BY nr.effective_date DESC
  LIMIT 1;
  
  -- Use defaults if not found
  IF v_nishab_value IS NULL THEN
    v_nishab_value := CASE WHEN p_nishab_type = 'gold' THEN 93500000 ELSE 8925000 END;
    v_rate := 0.025;
  END IF;
  
  RETURN QUERY SELECT
    p_asset_value,
    v_nishab_value,
    (p_asset_value >= v_nishab_value),
    CASE WHEN p_asset_value >= v_nishab_value THEN p_asset_value * v_rate ELSE 0 END,
    v_rate * 100; -- Convert to percentage
END;
$$;


--
-- Name: FUNCTION calculate_zakat_amount(p_asset_value numeric, p_nishab_type text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.calculate_zakat_amount(p_asset_value numeric, p_nishab_type text) IS 'Calculate zakat obligation based on asset value and nishab threshold';


--
-- Name: can_access_branch(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_branch(branch_uuid uuid) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
    user_branch UUID;
BEGIN
    -- If no branch specified, allow (for shared data)
    IF branch_uuid IS NULL THEN
        RETURN true;
    END IF;
    SELECT role, branch_id INTO user_role, user_branch
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    -- Super admins, owners, and head office admins can access all branches
    IF user_role IN ('super_admin', 'head_office_admin', 'owner', 'admin') THEN
        RETURN true;
    END IF;
    -- Regular users can only access their own branch
    RETURN user_branch = branch_uuid;
END;
$$;


--
-- Name: can_access_pos(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_pos() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('pos_access'); END;
$$;


--
-- Name: can_access_settings(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_access_settings() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('settings_access'); END;
$$;


--
-- Name: can_create_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_accounts() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('accounts_create'); END;
$$;


--
-- Name: can_create_advances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_advances() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('advances_create'); END;
$$;


--
-- Name: can_create_customers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('customers_create'); END;
$$;


--
-- Name: can_create_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('employees_create'); END;
$$;


--
-- Name: can_create_expenses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_expenses() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('expenses_create'); END;
$$;


--
-- Name: can_create_materials(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('materials_create'); END;
$$;


--
-- Name: can_create_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('products_create'); END;
$$;


--
-- Name: can_create_quotations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('quotations_create'); END;
$$;


--
-- Name: can_create_transactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_create_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('transactions_create'); END;
$$;


--
-- Name: can_delete_customers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('customers_delete'); END;
$$;


--
-- Name: can_delete_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('employees_delete'); END;
$$;


--
-- Name: can_delete_materials(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('materials_delete'); END;
$$;


--
-- Name: can_delete_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('products_delete'); END;
$$;


--
-- Name: can_delete_transactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_delete_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('transactions_delete'); END;
$$;


--
-- Name: can_edit_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_accounts() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('accounts_edit'); END;
$$;


--
-- Name: can_edit_customers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('customers_edit'); END;
$$;


--
-- Name: can_edit_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('employees_edit'); END;
$$;


--
-- Name: can_edit_materials(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('materials_edit'); END;
$$;


--
-- Name: can_edit_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('products_edit'); END;
$$;


--
-- Name: can_edit_quotations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('quotations_edit'); END;
$$;


--
-- Name: can_edit_transactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_edit_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('transactions_edit'); END;
$$;


--
-- Name: can_manage_roles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_manage_roles() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('role_management'); END;
$$;


--
-- Name: can_view_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_accounts() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('accounts_view'); END;
$$;


--
-- Name: can_view_advances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_advances() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('advances_view'); END;
$$;


--
-- Name: can_view_customers(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_customers() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('customers_view'); END;
$$;


--
-- Name: can_view_employees(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_employees() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('employees_view'); END;
$$;


--
-- Name: can_view_expenses(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_expenses() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('expenses_view'); END;
$$;


--
-- Name: can_view_financial_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_financial_reports() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('financial_reports'); END;
$$;


--
-- Name: can_view_materials(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_materials() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('materials_view'); END;
$$;


--
-- Name: can_view_products(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_products() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('products_view'); END;
$$;


--
-- Name: can_view_quotations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_quotations() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('quotations_view'); END;
$$;


--
-- Name: can_view_receivables(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_receivables() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('receivables_view'); END;
$$;


--
-- Name: can_view_stock_reports(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_stock_reports() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('stock_reports'); END;
$$;


--
-- Name: can_view_transactions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.can_view_transactions() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
BEGIN RETURN has_permission('transactions_view'); END;
$$;


--
-- Name: cancel_transaction_payment(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_transaction_payment(p_payment_id uuid, p_cancelled_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'Payment cancelled'::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  transaction_id_var TEXT;
  payment_amount NUMERIC;
  new_paid_amount NUMERIC;
BEGIN
  -- Get payment info
  SELECT transaction_id, amount INTO transaction_id_var, payment_amount
  FROM transaction_payments WHERE id = p_payment_id AND status = 'active';
  
  IF transaction_id_var IS NULL THEN
    RAISE EXCEPTION 'Payment not found or already cancelled';
  END IF;
  
  -- Cancel payment
  UPDATE transaction_payments 
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = p_cancelled_by, cancelled_reason = p_reason
  WHERE id = p_payment_id;
  
  -- Update transaction
  SELECT COALESCE(SUM(amount), 0) INTO new_paid_amount
  FROM transaction_payments WHERE transaction_id = transaction_id_var AND status = 'active';
  
  UPDATE transactions 
  SET paid_amount = new_paid_amount,
      payment_status = CASE WHEN new_paid_amount >= total THEN 'Lunas'::text ELSE 'Belum Lunas'::text END
  WHERE id = transaction_id_var;
  
  RETURN TRUE;
END;
$$;


--
-- Name: cancel_transaction_v2(text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cancel_transaction_v2(p_transaction_id text, p_user_id uuid, p_user_name text, p_reason text DEFAULT 'Cancelled'::text) RETURNS TABLE(success boolean, message text, journal_voided boolean, stock_restored boolean)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_transaction RECORD;
  v_item RECORD;
  v_journal_id UUID;
  v_restore_result RECORD;
BEGIN
  -- Get transaction
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id = p_transaction_id;
  IF v_transaction IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Transaction not found'::TEXT, FALSE, FALSE;
    RETURN;
  END IF;
  IF v_transaction.is_cancelled = TRUE THEN
    RETURN QUERY SELECT FALSE, 'Transaction already cancelled'::TEXT, FALSE, FALSE;
    RETURN;
  END IF;
  -- 1. Mark transaction as cancelled
  UPDATE transactions
  SET
    is_cancelled = TRUE,
    cancelled_at = NOW(),
    cancelled_by = p_user_id,
    cancelled_by_name = p_user_name,
    cancel_reason = p_reason,
    updated_at = NOW()
  WHERE id = p_transaction_id;
  -- 2. Void related journal entry
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_by = p_user_id,
    voided_by_name = p_user_name,
    void_reason = p_reason,
    status = 'voided'
  WHERE reference_id = p_transaction_id
    AND reference_type = 'transaction'
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journal_id = ROW_COUNT;
  -- 3. Restore stock for each item (if office sale or already delivered)
  IF v_transaction.is_office_sale = TRUE THEN
    FOR v_item IN
      SELECT
        (elem->>'productId')::UUID as product_id,
        (elem->>'quantity')::NUMERIC as quantity
      FROM jsonb_array_elements(v_transaction.items) as elem
      WHERE elem->>'productId' IS NOT NULL
    LOOP
      PERFORM restore_stock_fifo_v2(
        v_item.product_id,
        v_item.quantity,
        p_transaction_id,
        'transaction',
        v_transaction.branch_id
      );
    END LOOP;
  END IF;
  RETURN QUERY SELECT TRUE, 'Transaction cancelled successfully'::TEXT, v_journal_id > 0, TRUE;
END;
$$;


--
-- Name: FUNCTION cancel_transaction_v2(p_transaction_id text, p_user_id uuid, p_user_name text, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.cancel_transaction_v2(p_transaction_id text, p_user_id uuid, p_user_name text, p_reason text) IS 'Soft delete transaction, void journal, and restore stock';


--
-- Name: check_quotation_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_quotation_access(p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
BEGIN
    -- Get user details
    SELECT role, branch_id, allowed_branches 
    INTO v_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- 1. Check if user found
    IF v_role IS NULL THEN
        RETURN false;
    END IF;

    -- 2. Owner/Admin Access (Case-insensitive)
    IF lower(v_role) IN ('owner', 'admin', 'superadmin', 'administrator') THEN
        RETURN true;
    END IF;
    
    -- 3. Primary Branch Access
    IF v_user_branch_id = p_branch_id THEN
        RETURN true;
    END IF;
    
    -- 4. Allowed Branches Access
    -- Handle NULL allowed_branches gracefully
    IF v_allowed_branches IS NOT NULL AND p_branch_id = ANY(v_allowed_branches) THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;


--
-- Name: check_quotation_access_v3(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_quotation_access_v3(p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
BEGIN
    -- Get user details
    SELECT role, branch_id, allowed_branches 
    INTO v_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- 1. Check if user found
    IF v_role IS NULL THEN
        RAISE NOTICE 'User not found for uid %', auth.uid();
        RETURN false;
    END IF;

    -- 2. Owner/Admin Access (Case-insensitive)
    IF lower(v_role) IN ('owner', 'admin', 'superadmin', 'administrator') THEN
        RETURN true;
    END IF;
    
    -- 3. Primary Branch Access
    IF v_user_branch_id = p_branch_id THEN
        RETURN true;
    END IF;
    
    -- 4. Allowed Branches Access
    -- Handle allowed_branches being NULL or empty
    IF v_allowed_branches IS NOT NULL THEN
        IF p_branch_id = ANY(v_allowed_branches) THEN
            RETURN true;
        END IF;
    END IF;
    
    RAISE NOTICE 'Access denied: User branch % | Allowed % | Requested %', v_user_branch_id, v_allowed_branches, p_branch_id;
    RETURN false;
END;
$$;


--
-- Name: check_quotation_access_v4(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_quotation_access_v4(p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_uid uuid;
    v_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
BEGIN
    v_uid := auth.uid();
    
    -- Get user details
    SELECT role, branch_id, allowed_branches 
    INTO v_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = v_uid;
    
    -- 1. Check if user found
    IF v_role IS NULL THEN
        -- DEBUG: Raise exception to see why
        RAISE EXCEPTION 'RLS_DEBUG: User not found in profiles. UID: %', v_uid;
    END IF;

    -- 2. Owner/Admin Access (Case-insensitive)
    IF lower(v_role) IN ('owner', 'admin', 'superadmin', 'administrator') THEN
        RETURN true;
    END IF;
    
    -- 3. Primary Branch Access
    IF v_user_branch_id = p_branch_id THEN
        RETURN true;
    END IF;
    
    -- 4. Allowed Branches Access
    IF v_allowed_branches IS NOT NULL THEN
        IF p_branch_id = ANY(v_allowed_branches) THEN
            RETURN true;
        END IF;
    END IF;
    
    -- DEBUG: Raise exception with details on failure
    RAISE EXCEPTION 'RLS_DEBUG: Access Denied. Role: %, UserBranch: %, TargetBranch: %, Allowed: %', 
        v_role, v_user_branch_id, p_branch_id, v_allowed_branches;
        
    RETURN false;
END;
$$;


--
-- Name: check_quotation_access_v5(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_quotation_access_v5(p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
    v_user_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
BEGIN
    -- Get user details directly
    SELECT role, branch_id, allowed_branches 
    INTO v_user_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = auth.uid();
    
    -- 1. Check if user found
    IF v_user_role IS NULL THEN
        RETURN false;
    END IF;

    -- 2. Owner/Admin Access (Case-insensitive)
    IF v_user_role ILIKE 'owner' OR v_user_role ILIKE 'admin' OR v_user_role ILIKE 'superadmin' THEN
        RETURN true;
    END IF;
    
    -- 3. Primary Branch Access
    IF v_user_branch_id = p_branch_id THEN
        RETURN true;
    END IF;
    
    -- 4. Allowed Branches Access
    IF v_allowed_branches IS NOT NULL AND p_branch_id = ANY(v_allowed_branches) THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;


--
-- Name: check_user_permission(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_permission(p_user_id uuid, p_permission text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_role TEXT;
  v_has_permission BOOLEAN := FALSE;
BEGIN
  -- Jika user_id NULL, return FALSE
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Get user role from profiles table (localhost uses profiles, not employees)
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  -- Jika user tidak ditemukan atau tidak aktif
  IF v_role IS NULL THEN
    RETURN FALSE;
  END IF;
  -- Owner SELALU punya akses penuh
  IF v_role = 'owner' THEN
    RETURN TRUE;
  END IF;
  -- Admin punya semua akses kecuali role_management
  IF v_role = 'admin' AND p_permission != 'role_management' THEN
    RETURN TRUE;
  END IF;
  -- Cek dari role_permissions table
  SELECT (permissions->>p_permission)::BOOLEAN INTO v_has_permission
  FROM role_permissions
  WHERE role_id = v_role;
  RETURN COALESCE(v_has_permission, FALSE);
END;
$$;


--
-- Name: FUNCTION check_user_permission(p_user_id uuid, p_permission text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_user_permission(p_user_id uuid, p_permission text) IS 'Check if user has specific granular permission. Owner always TRUE, Admin TRUE except role_management.';


--
-- Name: check_user_permission_all(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_permission_all(p_user_id uuid, p_permissions text[]) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_permission TEXT;
BEGIN
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF NOT check_user_permission(p_user_id, v_permission) THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$$;


--
-- Name: FUNCTION check_user_permission_all(p_user_id uuid, p_permissions text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_user_permission_all(p_user_id uuid, p_permissions text[]) IS 'Check if user has ALL of the specified permissions.';


--
-- Name: check_user_permission_any(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_user_permission_any(p_user_id uuid, p_permissions text[]) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_permission TEXT;
BEGIN
  FOREACH v_permission IN ARRAY p_permissions
  LOOP
    IF check_user_permission(p_user_id, v_permission) THEN
      RETURN TRUE;
    END IF;
  END LOOP;
  RETURN FALSE;
END;
$$;


--
-- Name: FUNCTION check_user_permission_any(p_user_id uuid, p_permissions text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.check_user_permission_any(p_user_id uuid, p_permissions text[]) IS 'Check if user has ANY of the specified permissions.';


--
-- Name: cleanup_old_audit_logs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_audit_logs() RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.audit_logs 
  WHERE timestamp < NOW() - INTERVAL '90 days';
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  -- Log the cleanup operation
  PERFORM public.create_audit_log(
    'audit_logs',
    'CLEANUP',
    'system',
    NULL,
    jsonb_build_object('deleted_count', deleted_count),
    jsonb_build_object('operation', 'automatic_cleanup')
  );
  
  RETURN deleted_count;
END;
$$;


--
-- Name: consume_inventory_fifo(uuid, uuid, numeric, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_inventory_fifo(p_product_id uuid, p_branch_id uuid, p_quantity numeric, p_reference_id text DEFAULT NULL::text, p_reason text DEFAULT 'usage'::text, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, total_hpp numeric, batches_consumed jsonb, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_total_hpp NUMERIC := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_deduct_qty NUMERIC;
  v_available_stock NUMERIC;
  v_product_name TEXT;
  v_fallback_cost NUMERIC := 0;
  v_final_notes TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Product ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get product name AND cost_price for fallback
  SELECT name, COALESCE(cost_price, base_price, 0) 
  INTO v_product_name, v_fallback_cost
  FROM products WHERE id = p_product_id;

  IF v_product_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Product not found'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_available_stock
  FROM inventory_batches
  WHERE product_id = p_product_id AND branch_id = p_branch_id AND remaining_quantity > 0;

  FOR v_batch IN
    SELECT id, remaining_quantity, unit_cost, batch_date, notes
    FROM inventory_batches
    WHERE product_id = p_product_id AND branch_id = p_branch_id AND remaining_quantity > 0
    ORDER BY batch_date ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct_qty := LEAST(v_batch.remaining_quantity, v_remaining);
    UPDATE inventory_batches SET remaining_quantity = remaining_quantity - v_deduct_qty, updated_at = NOW() WHERE id = v_batch.id;
    v_total_hpp := v_total_hpp + (v_deduct_qty * COALESCE(v_batch.unit_cost, 0));
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id, 'quantity', v_deduct_qty,
      'unit_cost', COALESCE(v_batch.unit_cost, 0),
      'subtotal', v_deduct_qty * COALESCE(v_batch.unit_cost, 0)
    );
    v_remaining := v_remaining - v_deduct_qty;
  END LOOP;

  -- Handle negative stock with fallback cost
  IF v_remaining > 0 THEN
    INSERT INTO inventory_batches (product_id, branch_id, initial_quantity, remaining_quantity, unit_cost, batch_date, notes)
    VALUES (p_product_id, p_branch_id, 0, -v_remaining, v_fallback_cost, NOW(),
      format('Negative Stock fallback (cost: %s) for %s', v_fallback_cost, COALESCE(p_reference_id, 'sale')))
    RETURNING id INTO v_batch.id;
    
    v_total_hpp := v_total_hpp + (v_remaining * v_fallback_cost);
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id, 'quantity', v_remaining,
      'unit_cost', v_fallback_cost, 'subtotal', v_remaining * v_fallback_cost,
      'notes', 'negative_fallback_with_cost'
    );
    v_remaining := 0;
  END IF;

  -- Create Log Notes
  v_final_notes := format('FIFO consume: %s batches, HPP %s', jsonb_array_length(v_consumed), v_total_hpp);
  IF p_notes IS NOT NULL AND p_notes <> '' THEN
      v_final_notes := p_notes || ' | ' || v_final_notes;
  END IF;

  INSERT INTO product_stock_movements (
    product_id, 
    branch_id, 
    type, 
    reason, 
    quantity, 
    reference_id, 
    reference_type, 
    notes, 
    user_id,
    user_name,
    created_at
  )
  VALUES (
    p_product_id, 
    p_branch_id, 
    'OUT', 
    p_reason, 
    p_quantity, 
    p_reference_id, 
    'fifo_consume',
    v_final_notes, 
    p_user_id,
    p_user_name,
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_total_hpp, v_consumed, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, SQLERRM::TEXT;
END;
$$;


--
-- Name: consume_inventory_fifo_v3(uuid, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_inventory_fifo_v3(p_product_id uuid, p_branch_id uuid, p_quantity numeric, p_reference_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, total_hpp numeric, batches_consumed jsonb, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_total_hpp NUMERIC := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_deduct_qty NUMERIC;
  v_available_stock NUMERIC;
  v_product_name TEXT;
BEGIN
  -- ==================== VALIDASI ====================

  -- Validasi branch_id WAJIB
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB,
      'Product ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB,
      'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get product name untuk logging
  SELECT name INTO v_product_name
  FROM products WHERE id = p_product_id;

  IF v_product_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB,
      'Product not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== CEK STOK (MODIFIED: ALLOW NEGATIVE) ====================
  -- We still calculate available stock for logging/HPP purposes
  SELECT COALESCE(SUM(remaining_quantity), 0)
  INTO v_available_stock
  FROM inventory_batches
  WHERE product_id = p_product_id
    AND branch_id = p_branch_id      -- WAJIB filter branch
    AND remaining_quantity > 0;

  -- ==================== CONSUME FIFO ====================

  -- Loop through batches in FIFO order (oldest first)
  FOR v_batch IN
    SELECT id, remaining_quantity, unit_cost, batch_date, notes
    FROM inventory_batches
    WHERE product_id = p_product_id
      AND branch_id = p_branch_id    -- WAJIB filter branch
      AND remaining_quantity > 0
    ORDER BY batch_date ASC, created_at ASC
    FOR UPDATE                       -- Lock rows
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_deduct_qty := LEAST(v_batch.remaining_quantity, v_remaining);

    -- Update batch
    UPDATE inventory_batches
    SET remaining_quantity = remaining_quantity - v_deduct_qty,
        updated_at = NOW()
    WHERE id = v_batch.id;

    -- Calculate HPP
    v_total_hpp := v_total_hpp + (v_deduct_qty * COALESCE(v_batch.unit_cost, 0));

    -- Track consumed batches
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id,
      'quantity', v_deduct_qty,
      'unit_cost', COALESCE(v_batch.unit_cost, 0),
      'subtotal', v_deduct_qty * COALESCE(v_batch.unit_cost, 0)
    );

    v_remaining := v_remaining - v_deduct_qty;
  END LOOP;

  -- ==================== HANDLE DEFICIT (NEGATIVE STOCK) ====================
  -- If there is still quantity to consume, create a negative batch
  IF v_remaining > 0 THEN
    INSERT INTO inventory_batches (
      product_id,
      branch_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes
    ) VALUES (
      p_product_id,
      p_branch_id,
      0,
      -v_remaining, -- Negative stock
      0,            -- Cost unknown for negative stock
      NOW(),
      format('Negative Stock fallback for %s', COALESCE(p_reference_id, 'sale'))
    ) RETURNING id INTO v_batch.id;

    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id,
      'quantity', v_remaining,
      'unit_cost', 0,
      'subtotal', 0,
      'notes', 'negative_fallback'
    );
    
    v_remaining := 0;
  END IF;

  -- ==================== LOGGING ====================

  -- Log consumption untuk audit
  INSERT INTO product_stock_movements (
    product_id,
    branch_id,
    type,
    reason,
    quantity,
    reference_id,
    reference_type,
    notes,
    created_at
  ) VALUES (
    p_product_id,
    p_branch_id,
    'OUT',
    'delivery',
    p_quantity,
    p_reference_id,
    'fifo_consume',
    -- unit_cost REMOVED
    format('FIFO consume: %s batches, HPP %s', jsonb_array_length(v_consumed), v_total_hpp),
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_total_hpp, v_consumed, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, SQLERRM::TEXT;
END;
$$;


--
-- Name: consume_material_fifo(uuid, uuid, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_material_fifo(p_material_id uuid, p_branch_id uuid, p_quantity numeric, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT 'production'::text, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, total_cost numeric, batches_consumed jsonb, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_total_cost NUMERIC := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_deduct_qty NUMERIC;
  v_available_stock NUMERIC;
  v_material_name TEXT;
  v_details TEXT;
  v_fallback_cost NUMERIC := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Material ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get material name AND price_per_unit for fallback
  SELECT name, COALESCE(price_per_unit, 0) 
  INTO v_material_name, v_fallback_cost
  FROM materials WHERE id = p_material_id;

  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Material not found'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_available_stock
  FROM inventory_batches
  WHERE material_id = p_material_id AND (branch_id = p_branch_id OR branch_id IS NULL) AND remaining_quantity > 0;

  FOR v_batch IN
    SELECT id, remaining_quantity, unit_cost, batch_date, notes
    FROM inventory_batches
    WHERE material_id = p_material_id AND (branch_id = p_branch_id OR branch_id IS NULL) AND remaining_quantity > 0
    ORDER BY batch_date ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct_qty := LEAST(v_batch.remaining_quantity, v_remaining);
    UPDATE inventory_batches SET remaining_quantity = remaining_quantity - v_deduct_qty, updated_at = NOW() WHERE id = v_batch.id;
    v_total_cost := v_total_cost + (v_deduct_qty * COALESCE(v_batch.unit_cost, 0));
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id, 'quantity', v_deduct_qty,
      'unit_cost', COALESCE(v_batch.unit_cost, 0),
      'subtotal', v_deduct_qty * COALESCE(v_batch.unit_cost, 0)
    );
    BEGIN
      INSERT INTO inventory_batch_consumptions (batch_id, quantity_consumed, consumed_at, reference_id, reference_type, unit_cost, total_cost)
      VALUES (v_batch.id, v_deduct_qty, NOW(), p_reference_id, p_reference_type, COALESCE(v_batch.unit_cost, 0), v_deduct_qty * COALESCE(v_batch.unit_cost, 0));
    EXCEPTION WHEN undefined_table THEN NULL;
    END;
    v_remaining := v_remaining - v_deduct_qty;
  END LOOP;

  -- FIX: Handle negative stock with fallback cost
  IF v_remaining > 0 THEN
    INSERT INTO inventory_batches (id, material_id, branch_id, initial_quantity, remaining_quantity, unit_cost, batch_date, notes, created_at, updated_at)
    VALUES (gen_random_uuid(), p_material_id, p_branch_id, 0, -v_remaining, v_fallback_cost, NOW(),
      format('Negative Stock fallback (cost: %s) for %s', v_fallback_cost, COALESCE(p_reference_id, 'production')), NOW(), NOW())
    RETURNING id INTO v_batch.id;
    
    v_total_cost := v_total_cost + (v_remaining * v_fallback_cost);
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id, 'quantity', v_remaining,
      'unit_cost', v_fallback_cost, 'subtotal', v_remaining * v_fallback_cost,
      'notes', 'negative_fallback_with_cost'
    );
    v_remaining := 0;
  END IF;

  v_details := format('FIFO consume: %s batches, total cost %s', jsonb_array_length(v_consumed), v_total_cost);
  IF p_notes IS NOT NULL THEN v_details := p_notes || ' (' || v_details || ')'; END IF;

  INSERT INTO material_stock_movements (material_id, material_name, type, reason, quantity, previous_stock, new_stock, reference_id, reference_type, notes, branch_id, created_at)
  VALUES (p_material_id, v_material_name, 'OUT',
    CASE WHEN p_reference_type = 'production' THEN 'PRODUCTION_CONSUMPTION' WHEN p_reference_type = 'spoilage' THEN 'PRODUCTION_ERROR' ELSE 'ADJUSTMENT' END,
    p_quantity, v_available_stock, v_available_stock - p_quantity, p_reference_id, p_reference_type, v_details, p_branch_id, NOW());

  UPDATE materials SET stock = GREATEST(0, stock - p_quantity), updated_at = NOW() WHERE id = p_material_id;

  RETURN QUERY SELECT TRUE, v_total_cost, v_consumed, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, SQLERRM::TEXT;
END;
$$;


--
-- Name: consume_material_fifo_v2(uuid, numeric, text, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_material_fifo_v2(p_material_id uuid, p_quantity numeric, p_reference_id text, p_reference_type text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, total_cost numeric, quantity_consumed numeric, batches_consumed jsonb, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_total_cost NUMERIC := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_deduct_qty NUMERIC;
  v_material_name TEXT;
  v_available_stock NUMERIC;
BEGIN
  -- Validate input
  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, '[]'::JSONB, 'Material ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, '[]'::JSONB, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get material info
  SELECT name INTO v_material_name
  FROM materials WHERE id = p_material_id;
  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, 0::NUMERIC, '[]'::JSONB, 'Material not found'::TEXT;
    RETURN;
  END IF;
  -- Check available stock from batches
  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_available_stock
  FROM inventory_batches
  WHERE material_id = p_material_id
    AND remaining_quantity > 0
    AND (p_branch_id IS NULL OR branch_id = p_branch_id OR branch_id IS NULL);
  IF v_available_stock < p_quantity THEN
    RETURN QUERY SELECT
      FALSE,
      0::NUMERIC,
      0::NUMERIC,
      '[]'::JSONB,
      format('Insufficient stock: need %s, available %s', p_quantity, v_available_stock)::TEXT;
    RETURN;
  END IF;
  -- Consume from batches using FIFO (oldest first)
  FOR v_batch IN
    SELECT
      id,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes
    FROM inventory_batches
    WHERE material_id = p_material_id
      AND remaining_quantity > 0
      AND (p_branch_id IS NULL OR branch_id = p_branch_id OR branch_id IS NULL)
    ORDER BY batch_date ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct_qty := LEAST(v_batch.remaining_quantity, v_remaining);
    -- Update batch remaining quantity
    UPDATE inventory_batches
    SET
      remaining_quantity = remaining_quantity - v_deduct_qty,
      updated_at = NOW()
    WHERE id = v_batch.id;
    -- Track consumption for inventory_batch_consumptions table
    INSERT INTO inventory_batch_consumptions (
      batch_id,
      quantity_consumed,
      consumed_at,
      reference_id,
      reference_type,
      unit_cost,
      total_cost,
      total_hpp
    ) VALUES (
      v_batch.id,
      v_deduct_qty,
      NOW(),
      p_reference_id,
      p_reference_type,
      COALESCE(v_batch.unit_cost, 0),
      v_deduct_qty * COALESCE(v_batch.unit_cost, 0),
      v_deduct_qty * COALESCE(v_batch.unit_cost, 0)
    );
    v_total_cost := v_total_cost + (v_deduct_qty * COALESCE(v_batch.unit_cost, 0));
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id,
      'quantity', v_deduct_qty,
      'unit_cost', COALESCE(v_batch.unit_cost, 0),
      'subtotal', v_deduct_qty * COALESCE(v_batch.unit_cost, 0)
    );
    v_remaining := v_remaining - v_deduct_qty;
  END LOOP;
  -- Log to material_stock_movements for audit trail
  INSERT INTO material_stock_movements (
    material_id,
    material_name,
    type,
    reason,
    quantity,
    previous_stock,
    new_stock,
    reference_id,
    reference_type,
    user_id,
    user_name,
    notes,
    branch_id
  ) VALUES (
    p_material_id,
    v_material_name,
    'OUT',
    'PRODUCTION_CONSUMPTION',
    p_quantity,
    v_available_stock,
    v_available_stock - p_quantity,
    p_reference_id,
    p_reference_type,
    p_user_id,
    COALESCE(p_user_name, 'System'),
    format('FIFO v2 consume: %s batches, total cost %s', jsonb_array_length(v_consumed), v_total_cost),
    p_branch_id
  );
  -- NOTE: We do NOT update materials.stock anymore
  -- Stock is derived from v_material_current_stock view
  RETURN QUERY SELECT TRUE, v_total_cost, p_quantity - v_remaining, v_consumed, NULL::TEXT;
END;
$$;


--
-- Name: consume_stock_fifo_v2(uuid, numeric, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_stock_fifo_v2(p_product_id uuid, p_quantity numeric, p_reference_id text, p_reference_type text, p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, total_hpp numeric, batches_consumed jsonb, remaining_to_consume numeric, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_total_hpp NUMERIC := 0;
  v_consumed JSONB := '[]'::JSONB;
  v_deduct_qty NUMERIC;
  v_available_stock NUMERIC;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, p_quantity, 'Product ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 0::NUMERIC, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;
  SELECT COALESCE(SUM(remaining_quantity), 0)
  INTO v_available_stock
  FROM inventory_batches
  WHERE product_id = p_product_id
    AND remaining_quantity > 0
    AND (p_branch_id IS NULL OR branch_id = p_branch_id);
  IF v_available_stock < p_quantity THEN
    RETURN QUERY SELECT
      FALSE,
      0::NUMERIC,
      '[]'::JSONB,
      p_quantity,
      format('Insufficient stock. Available: %s, Requested: %s', v_available_stock, p_quantity)::TEXT;
    RETURN;
  END IF;
  FOR v_batch IN
    SELECT
      id,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes
    FROM inventory_batches
    WHERE product_id = p_product_id
      AND remaining_quantity > 0
      AND (p_branch_id IS NULL OR branch_id = p_branch_id)
    ORDER BY batch_date ASC, created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_deduct_qty := LEAST(v_batch.remaining_quantity, v_remaining);
    
    UPDATE inventory_batches
    SET
      remaining_quantity = remaining_quantity - v_deduct_qty,
      updated_at = NOW()
    WHERE id = v_batch.id;

    -- Track consumption for each batch
    INSERT INTO inventory_batch_consumptions (
      batch_id,
      reference_id,
      reference_type,
      quantity_consumed,
      unit_cost,
      total_cost,
      total_hpp,
      consumed_at
    ) VALUES (
      v_batch.id,
      p_reference_id,
      p_reference_type,
      v_deduct_qty,
      COALESCE(v_batch.unit_cost, 0),
      v_deduct_qty * COALESCE(v_batch.unit_cost, 0),
      v_deduct_qty * COALESCE(v_batch.unit_cost, 0),
      NOW()
    );

    v_total_hpp := v_total_hpp + (v_deduct_qty * COALESCE(v_batch.unit_cost, 0));
    v_consumed := v_consumed || jsonb_build_object(
      'batch_id', v_batch.id,
      'quantity', v_deduct_qty,
      'unit_cost', COALESCE(v_batch.unit_cost, 0),
      'subtotal', v_deduct_qty * COALESCE(v_batch.unit_cost, 0),
      'batch_date', v_batch.batch_date,
      'notes', v_batch.notes
    );
    v_remaining := v_remaining - v_deduct_qty;
  END LOOP;

  UPDATE products
  SET
    current_stock = current_stock - (p_quantity - v_remaining),
    updated_at = NOW()
  WHERE id = p_product_id;

  RETURN QUERY SELECT
    TRUE,
    v_total_hpp,
    v_consumed,
    v_remaining,
    NULL::TEXT;
END;
$$;


--
-- Name: create_account(text, text, text, text, numeric, boolean, text, integer, boolean, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_account(p_branch_id text, p_name text, p_code text, p_type text, p_initial_balance numeric DEFAULT 0, p_is_payment_account boolean DEFAULT false, p_parent_id text DEFAULT NULL::text, p_level integer DEFAULT 1, p_is_header boolean DEFAULT false, p_sort_order integer DEFAULT 0, p_employee_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, account_id text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_account_id UUID;
  v_code_exists BOOLEAN;
BEGIN
  -- Validate Branch ID
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Branch ID is required';
    RETURN;
  END IF;

  -- Validate Code Uniqueness in Branch
  IF p_code IS NOT NULL AND p_code != '' THEN
    SELECT EXISTS (
      SELECT 1 FROM accounts 
      WHERE branch_id = p_branch_id::UUID 
      AND code = p_code
    ) INTO v_code_exists;
    
    IF v_code_exists THEN
      RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account code already exists in this branch';
      RETURN;
    END IF;
  END IF;

  -- Generate ID Explicitly
  v_account_id := gen_random_uuid();

  -- Insert Account
  INSERT INTO accounts (
    id,
    branch_id,
    name,
    code,
    type,
    initial_balance,
    balance, -- CORRECT FIX: Initialize to 0. Journal Trigger will populate this.
    is_payment_account,
    parent_id,
    level,
    is_header,
    sort_order,
    employee_id,
    is_active
  ) VALUES (
    v_account_id,
    p_branch_id::UUID,
    p_name,
    p_code,
    p_type,
    p_initial_balance,
    0, -- Start at 0. Do NOT double count.
    p_is_payment_account,
    p_parent_id, -- Removed ::UUID cast to support legacy text IDs
    p_level,
    p_is_header,
    p_sort_order,
    p_employee_id::UUID,
    true
  );

  -- Create Journal for Opening Balance if not zero
  IF p_initial_balance <> 0 THEN
      -- This creates a Journal -> Trigger Fires -> Updates Balance (+1.5M)
      PERFORM update_account_initial_balance_atomic(
          v_account_id::TEXT, 
          p_initial_balance, 
          p_branch_id::UUID
      );
  END IF;

  RETURN QUERY SELECT TRUE, v_account_id::TEXT, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM;
END;
$$;


--
-- Name: create_accounts_payable_atomic(uuid, text, numeric, date, text, text, text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_accounts_payable_atomic(p_branch_id uuid, p_supplier_name text, p_amount numeric, p_due_date date DEFAULT NULL::date, p_description text DEFAULT NULL::text, p_creditor_type text DEFAULT 'supplier'::text, p_purchase_order_id text DEFAULT NULL::text, p_skip_journal boolean DEFAULT false) RETURNS TABLE(success boolean, payable_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payable_id TEXT;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_hutang_account_id TEXT;
  v_lawan_account_id TEXT; -- Usually Cash or Inventory depending on context
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- ðŸ”¥ NEW: Check if AP already exists for this PO
  IF p_purchase_order_id IS NOT NULL THEN
    DECLARE
      v_existing_ap_count INTEGER;
    BEGIN
      SELECT COUNT(*) INTO v_existing_ap_count
      FROM accounts_payable
      WHERE purchase_order_id = p_purchase_order_id;

      IF v_existing_ap_count > 0 THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
          'Accounts Payable sudah ada untuk PO ini. Gunakan approve_purchase_order_atomic untuk PO.'::TEXT;
        RETURN;
      END IF;
    END;

    -- ðŸ”¥ FORCE skip_journal for PO (journal should be created by approve_purchase_order_atomic)
    p_skip_journal := TRUE;
  END IF;

  -- Generate Sequential ID
  v_payable_id := 'AP-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');

  -- ==================== INSERT ACCOUNTS PAYABLE ====================

  INSERT INTO accounts_payable (
    id,
    branch_id,
    supplier_name,
    creditor_type,
    amount,
    due_date,
    description,
    purchase_order_id,
    status,
    paid_amount,
    created_at
  ) VALUES (
    v_payable_id,
    p_branch_id,
    p_supplier_name,
    p_creditor_type,
    p_amount,
    p_due_date,
    p_description,
    p_purchase_order_id,
    'Outstanding',
    0,
    NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  IF NOT p_skip_journal THEN
    -- Get Account IDs
    -- Default Hutang Usaha: 2110
    SELECT id INTO v_hutang_account_id FROM accounts WHERE code = '2110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;
    
    -- Lawan: 5110 (Pembelian) as default
    SELECT id INTO v_lawan_account_id FROM accounts WHERE code = '5110' AND branch_id = p_branch_id AND is_active = TRUE LIMIT 1;

    IF v_hutang_account_id IS NOT NULL AND v_lawan_account_id IS NOT NULL THEN
       DECLARE
         v_journal_lines JSONB;
         v_journal_res RECORD;
       BEGIN
         -- Dr. Lawan
         -- Cr. Hutang
         v_journal_lines := jsonb_build_array(
           jsonb_build_object(
             'account_id', v_lawan_account_id,
             'debit_amount', p_amount,
             'credit_amount', 0,
             'description', COALESCE(p_description, 'Hutang Baru')
           ),
           jsonb_build_object(
             'account_id', v_hutang_account_id,
             'debit_amount', 0,
             'credit_amount', p_amount,
             'description', COALESCE(p_description, 'Hutang Baru')
           )
         );

         SELECT * INTO v_journal_res FROM create_journal_atomic(
           p_branch_id,
           CURRENT_DATE,
           COALESCE(p_description, 'Hutang Baru: ' || p_supplier_name),
           'accounts_payable',
           v_payable_id,
           v_journal_lines,
           TRUE -- auto post
         );

         IF v_journal_res.success THEN
           v_journal_id := v_journal_res.journal_id;
         ELSE
           RAISE EXCEPTION 'Gagal membuat jurnal hutang: %', v_journal_res.error_message;
         END IF;
       END;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_payable_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_accounts_payable_atomic(p_branch_id uuid, p_supplier_name text, p_amount numeric, p_due_date date, p_description text, p_creditor_type text, p_purchase_order_id text, p_skip_journal boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_accounts_payable_atomic(p_branch_id uuid, p_supplier_name text, p_amount numeric, p_due_date date, p_description text, p_creditor_type text, p_purchase_order_id text, p_skip_journal boolean) IS 'Atomic creation of accounts payable with optional automatic journal entry. WAJIB branch_id. PREVENTS duplicate AP for PO (use approve_purchase_order_atomic instead).';


--
-- Name: create_all_opening_balance_journal_rpc(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_all_opening_balance_journal_rpc(p_branch_id uuid, p_opening_date date DEFAULT CURRENT_DATE) RETURNS TABLE(success boolean, journal_id uuid, accounts_processed integer, total_debit numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_laba_ditahan_id UUID;
  v_account RECORD;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line_number INTEGER := 1;
  v_accounts_processed INTEGER := 0;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- GET LABA DITAHAN ACCOUNT
  SELECT id INTO v_laba_ditahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    SELECT id INTO v_laba_ditahan_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_laba_ditahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, 'Akun Laba Ditahan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_opening_date,
    'Saldo Awal Semua Akun',
    'opening', 'ALL-OPENING', 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- LOOP THROUGH ALL ACCOUNTS WITH INITIAL BALANCE
  FOR v_account IN
    SELECT id, code, name, type, initial_balance, normal_balance
    FROM accounts
    WHERE branch_id = p_branch_id
      AND initial_balance IS NOT NULL
      AND initial_balance <> 0
      AND code NOT IN ('1310', '1320') -- Exclude inventory (handled separately)
      AND is_active = TRUE
    ORDER BY code
  LOOP
    -- Determine debit/credit based on account type and normal balance
    IF v_account.type IN ('Aset', 'Beban') OR v_account.normal_balance = 'DEBIT' THEN
      -- Debit entry for asset/expense accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_account.id, v_account.code, v_account.name,
        ABS(v_account.initial_balance), 0, 'Saldo awal ' || v_account.name, v_line_number
      );
      v_total_debit := v_total_debit + ABS(v_account.initial_balance);
    ELSE
      -- Credit entry for liability/equity/revenue accounts
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_account.id, v_account.code, v_account.name,
        0, ABS(v_account.initial_balance), 'Saldo awal ' || v_account.name, v_line_number
      );
      v_total_credit := v_total_credit + ABS(v_account.initial_balance);
    END IF;
    v_line_number := v_line_number + 1;
    v_accounts_processed := v_accounts_processed + 1;
  END LOOP;
  -- ADD BALANCING ENTRY TO LABA DITAHAN
  IF v_total_debit <> v_total_credit THEN
    IF v_total_debit > v_total_credit THEN
      -- Need more credit
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_laba_ditahan_id,
        (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
        (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
        0, v_total_debit - v_total_credit, 'Penyeimbang saldo awal', v_line_number
      );
    ELSE
      -- Need more debit
      INSERT INTO journal_entry_lines (
        journal_entry_id, account_id, account_code, account_name,
        debit_amount, credit_amount, description, line_number
      ) VALUES (
        v_journal_id, v_laba_ditahan_id,
        (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
        (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
        v_total_credit - v_total_debit, 0, 'Penyeimbang saldo awal', v_line_number
      );
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, v_accounts_processed, v_total_debit, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_all_opening_balance_journal_rpc(p_branch_id uuid, p_opening_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_all_opening_balance_journal_rpc(p_branch_id uuid, p_opening_date date) IS 'Create opening balance journal for all accounts with initial_balance';


--
-- Name: create_asset_atomic(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_asset_atomic(p_asset jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, asset_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_asset_id UUID;
  v_name TEXT;
  v_code TEXT;
  v_category TEXT;
  v_purchase_date DATE;
  v_purchase_price NUMERIC;
  v_useful_life_years INTEGER;
  v_salvage_value NUMERIC;
  v_depreciation_method TEXT;
  v_source TEXT;  -- 'cash', 'credit', 'migration'
  v_asset_account_id UUID;
  v_cash_account_id UUID;
  v_hutang_account_id UUID;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_category_mapping JSONB;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_asset IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Asset data is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_name := COALESCE(p_asset->>'name', p_asset->>'asset_name', 'Aset Tetap');
  v_code := COALESCE(p_asset->>'code', p_asset->>'asset_code');
  v_category := COALESCE(p_asset->>'category', 'other');
  v_purchase_date := COALESCE((p_asset->>'purchase_date')::DATE, CURRENT_DATE);
  v_purchase_price := COALESCE((p_asset->>'purchase_price')::NUMERIC, 0);
  v_useful_life_years := COALESCE((p_asset->>'useful_life_years')::INTEGER, 5);
  v_salvage_value := COALESCE((p_asset->>'salvage_value')::NUMERIC, 0);
  v_depreciation_method := COALESCE(p_asset->>'depreciation_method', 'straight_line');
  v_source := COALESCE(p_asset->>'source', 'cash');
  IF v_name IS NULL OR v_name = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Asset name is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== MAP CATEGORY TO ACCOUNT ====================
  -- Category to account code mapping
  v_category_mapping := '{
    "vehicle": {"codes": ["1410"], "names": ["kendaraan"]},
    "equipment": {"codes": ["1420"], "names": ["peralatan", "mesin"]},
    "building": {"codes": ["1440"], "names": ["bangunan", "gedung"]},
    "furniture": {"codes": ["1450"], "names": ["furniture", "inventaris"]},
    "computer": {"codes": ["1460"], "names": ["komputer", "laptop"]},
    "other": {"codes": ["1490"], "names": ["aset lain"]}
  }'::JSONB;
  -- Find asset account by category
  DECLARE
    v_mapping JSONB := v_category_mapping->v_category;
    v_search_code TEXT;
    v_search_name TEXT;
  BEGIN
    IF v_mapping IS NOT NULL THEN
      -- Try by code first
      FOR v_search_code IN SELECT jsonb_array_elements_text(v_mapping->'codes')
      LOOP
        SELECT id INTO v_asset_account_id
        FROM accounts
        WHERE branch_id = p_branch_id
          AND code = v_search_code
          AND is_active = TRUE
        LIMIT 1;
        EXIT WHEN v_asset_account_id IS NOT NULL;
      END LOOP;
      -- Try by name if not found
      IF v_asset_account_id IS NULL THEN
        FOR v_search_name IN SELECT jsonb_array_elements_text(v_mapping->'names')
        LOOP
          SELECT id INTO v_asset_account_id
          FROM accounts
          WHERE branch_id = p_branch_id
            AND LOWER(name) LIKE '%' || v_search_name || '%'
            AND is_active = TRUE
            AND is_header = FALSE
          LIMIT 1;
          EXIT WHEN v_asset_account_id IS NOT NULL;
        END LOOP;
      END IF;
    END IF;
    -- Fallback to any fixed asset account
    IF v_asset_account_id IS NULL THEN
      SELECT id INTO v_asset_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND code LIKE '14%'
        AND is_active = TRUE
        AND is_header = FALSE
      ORDER BY code
      LIMIT 1;
    END IF;
  END;
  -- Find cash account
  SELECT id INTO v_cash_account_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND is_active = TRUE
    AND is_payment_account = TRUE
    AND code LIKE '11%'
  ORDER BY code
  LIMIT 1;
  -- Find hutang account (for credit purchases)
  SELECT id INTO v_hutang_account_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND code IN ('2100', '2110')
    AND is_active = TRUE
  LIMIT 1;
  -- Validate asset account found
  IF v_asset_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
      'Akun aset tetap tidak ditemukan. Pastikan ada akun dengan kode 14xx.'::TEXT;
    RETURN;
  END IF;
  -- ==================== GENERATE ASSET ID ====================
  v_asset_id := gen_random_uuid();
  -- Generate code if not provided
  IF v_code IS NULL OR v_code = '' THEN
    v_code := 'AST-' || TO_CHAR(v_purchase_date, 'YYYYMM') || '-' ||
              LPAD((SELECT COUNT(*) + 1 FROM assets WHERE branch_id = p_branch_id)::TEXT, 4, '0');
  END IF;
  -- ==================== CREATE ASSET RECORD ====================
  INSERT INTO assets (
    id,
    name,
    code,
    asset_code,
    category,
    purchase_date,
    purchase_price,
    current_value,
    useful_life_years,
    salvage_value,
    depreciation_method,
    location,
    brand,
    model,
    serial_number,
    supplier_name,
    notes,
    status,
    condition,
    account_id,
    branch_id,
    created_at
  ) VALUES (
    v_asset_id,
    v_name,
    v_code,
    v_code,
    v_category,
    v_purchase_date,
    v_purchase_price,
    v_purchase_price,  -- current_value starts at purchase_price
    v_useful_life_years,
    v_salvage_value,
    v_depreciation_method,
    p_asset->>'location',
    COALESCE(p_asset->>'brand', v_name),
    p_asset->>'model',
    p_asset->>'serial_number',
    p_asset->>'supplier_name',
    p_asset->>'notes',
    COALESCE(p_asset->>'status', 'active'),
    COALESCE(p_asset->>'condition', 'good'),
    v_asset_account_id,
    p_branch_id,
    NOW()
  );
  -- ==================== CREATE JOURNAL (if not migration) ====================
  IF v_purchase_price > 0 AND v_source != 'migration' THEN
    -- Debit: Aset Tetap
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_id', v_asset_account_id,
      'debit_amount', v_purchase_price,
      'credit_amount', 0,
      'description', format('Pembelian %s', v_name)
    );
    -- Credit: Kas atau Hutang
    IF v_source = 'credit' AND v_hutang_account_id IS NOT NULL THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_hutang_account_id,
        'debit_amount', 0,
        'credit_amount', v_purchase_price,
        'description', 'Hutang pembelian aset'
      );
    ELSIF v_cash_account_id IS NOT NULL THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_cash_account_id,
        'debit_amount', 0,
        'credit_amount', v_purchase_price,
        'description', 'Pembayaran tunai aset'
      );
    ELSE
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID,
        'Akun pembayaran tidak ditemukan'::TEXT;
      RETURN;
    END IF;
    SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
      p_branch_id,
      v_purchase_date,
      format('Pembelian Aset - %s', v_name),
      'asset',
      v_asset_id::TEXT,
      v_journal_lines,
      TRUE
    );
  END IF;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_asset_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_asset_atomic(p_asset jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_asset_atomic(p_asset jsonb, p_branch_id uuid) IS 'Create asset dengan auto journal pembelian. WAJIB branch_id.';


--
-- Name: create_audit_log(text, text, text, jsonb, jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_audit_log(p_table_name text, p_operation text, p_record_id text, p_old_data jsonb DEFAULT NULL::jsonb, p_new_data jsonb DEFAULT NULL::jsonb, p_additional_info jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  audit_id UUID;
  current_user_id UUID;
  current_user_role TEXT;
  current_user_email TEXT;
  current_user_name TEXT;
BEGIN
  -- Get current user from JWT claims (PostgREST compatible)
  BEGIN
    current_user_id := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    current_user_id := NULL;
  END;
  
  -- Get user info from profiles table (not auth.users)
  IF current_user_id IS NOT NULL THEN
    SELECT p.role, p.email, p.full_name INTO current_user_role, current_user_email, current_user_name
    FROM public.profiles p
    WHERE p.id = current_user_id;
  ELSE
    -- Fallback to JWT role claim
    BEGIN
      current_user_role := current_setting('request.jwt.claims', true)::json->>'role';
    EXCEPTION WHEN OTHERS THEN
      current_user_role := 'unknown';
    END;
  END IF;
  
  -- Insert audit log
  INSERT INTO public.audit_logs (
    table_name,
    operation,
    record_id,
    old_data,
    new_data,
    user_id,
    user_email,
    user_role,
    additional_info
  ) VALUES (
    p_table_name,
    p_operation,
    p_record_id,
    p_old_data,
    p_new_data,
    current_user_id,
    COALESCE(current_user_email, 'system'),
    COALESCE(current_user_role, 'unknown'),
    p_additional_info
  ) RETURNING id INTO audit_id;
  
  RETURN audit_id;
END;
$$;


--
-- Name: create_debt_journal_rpc(uuid, text, date, numeric, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text DEFAULT 'other'::text, p_description text DEFAULT NULL::text, p_cash_account_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;  -- Changed to TEXT
  v_hutang_account_id TEXT; -- Changed to TEXT
  v_hutang_code TEXT;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- GET KAS ACCOUNT
  IF p_cash_account_id IS NOT NULL THEN
    v_kas_account_id := p_cash_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1120' AND is_active = TRUE LIMIT 1;
  END IF;

  -- GET HUTANG ACCOUNT BASED ON CREDITOR TYPE
  CASE p_creditor_type
    WHEN 'bank' THEN v_hutang_code := '2120';
    WHEN 'supplier' THEN v_hutang_code := '2110';
    ELSE v_hutang_code := '2190';
  END CASE;

  SELECT id INTO v_hutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = v_hutang_code AND is_active = TRUE LIMIT 1;

  IF v_hutang_account_id IS NULL THEN
    SELECT id INTO v_hutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '2110' AND is_active = TRUE LIMIT 1;
    v_hutang_code := '2110';
  END IF;

  IF v_kas_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Kas/Bank tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_hutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Hutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER (GLOBAL SEQUENCE)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_debt_date,
    COALESCE(p_description, 'Pinjaman dari ' || p_creditor_name),
    'payable', p_debt_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT code FROM accounts WHERE id = v_kas_account_id),
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    p_amount, 0, 'Penerimaan pinjaman dari ' || p_creditor_name, 1
  );

  -- Cr. Hutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_hutang_account_id, v_hutang_code,
    (SELECT name FROM accounts WHERE id = v_hutang_account_id),
    0, p_amount, 'Hutang kepada ' || p_creditor_name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_delivery_report(text, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_delivery_report(p_transaction_id text, p_driver_id uuid, p_status text, p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_report_id UUID;
BEGIN
    INSERT INTO public.delivery_reports (
        transaction_id, driver_id, status, notes, photo_url, reported_at
    )
    VALUES (
        p_transaction_id, p_driver_id, p_status, p_notes, p_photo_url, NOW()
    )
    RETURNING id INTO v_report_id;
    
    -- Optional: If status is 'delivered', we could auto-trigger actual delivery processing here?
    -- For now, we just mark the report. The user asked for "status sudah lapor".
    
    RETURN v_report_id;
END;
$$;


--
-- Name: create_delivery_report(text, uuid, text, text, text, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_delivery_report(p_transaction_id text, p_driver_id uuid, p_status text, p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_latitude numeric DEFAULT NULL::numeric, p_longitude numeric DEFAULT NULL::numeric) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_report_id UUID;
BEGIN
    INSERT INTO public.delivery_reports (
        transaction_id, driver_id, status, notes, photo_url, latitude, longitude, reported_at
    )
    VALUES (
        p_transaction_id, p_driver_id, p_status, p_notes, p_photo_url, p_latitude, p_longitude, NOW()
    )
    RETURNING id INTO v_report_id;
    
    -- Optional: If status is 'delivered', we could auto-trigger actual delivery processing here?
    -- For now, we just mark the report. The user asked for "status sudah lapor".
    
    RETURN v_report_id;
END;
$$;


--
-- Name: create_employee_advance_atomic(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_employee_advance_atomic(p_advance jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, advance_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_advance_id UUID;
  v_journal_id UUID;
  v_employee_id UUID;
  v_employee_name TEXT;
  v_amount NUMERIC;
  v_advance_date DATE;
  v_reason TEXT;
  v_payment_account_id TEXT;

  v_kas_account_id TEXT;
  v_piutang_karyawan_id TEXT;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Permission check
  IF auth.uid() IS NOT NULL THEN
    IF NOT check_user_permission(auth.uid(), 'advances_manage') THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Tidak memiliki akses untuk membuat kasbon'::TEXT;
      RETURN;
    END IF;
  END IF;

  -- ==================== PARSE DATA ====================

  v_advance_id := COALESCE((p_advance->>'id')::UUID, gen_random_uuid());
  v_employee_id := (p_advance->>'employee_id')::UUID;
  v_employee_name := p_advance->>'employee_name';
  v_amount := COALESCE((p_advance->>'amount')::NUMERIC, 0);
  v_advance_date := COALESCE((p_advance->>'advance_date')::DATE, CURRENT_DATE);
  v_reason := COALESCE(p_advance->>'reason', 'Kasbon karyawan');
  v_payment_account_id := (p_advance->>'payment_account_id'); -- No cast to UUID, it's TEXT

  IF v_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get employee name if not provided (localhost uses profiles, not employees)
  IF v_employee_name IS NULL THEN
    SELECT full_name INTO v_employee_name FROM profiles WHERE id = v_employee_id;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  -- Kas account
  IF v_payment_account_id IS NOT NULL THEN
    v_kas_account_id := v_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  -- Piutang Karyawan (1220 atau sesuai chart of accounts)
  SELECT id INTO v_piutang_karyawan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1220' AND is_active = TRUE LIMIT 1;

  -- Fallback: cari akun dengan nama mengandung "Piutang Karyawan"
  IF v_piutang_karyawan_id IS NULL THEN
    SELECT id INTO v_piutang_karyawan_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%piutang karyawan%' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_kas_account_id IS NULL OR v_piutang_karyawan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun Kas atau Piutang Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- ==================== INSERT ADVANCE RECORD ====================

  INSERT INTO employee_advances (
    id,
    branch_id,
    employee_id,
    employee_name,
    amount,
    remaining_amount,
    date,      -- Correct column name
    notes,     -- Map reason to notes
    status,
    created_at, -- No created_by column in schema output, let's omit or check if it exists differently? schema said no created_by
    account_id  -- Map payment account
  ) VALUES (
    v_advance_id::TEXT, -- Cast to TEXT as ID in table is TEXT
    p_branch_id,
    v_employee_id,
    v_employee_name,
    v_amount,
    v_amount, 
    v_advance_date,
    v_reason,
    'active',
    NOW(),
    v_payment_account_id
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_piutang_karyawan_id,
      'debit_amount', v_amount,
      'credit_amount', 0,
      'description', 'Kasbon ' || v_employee_name
    ),
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', 0,
      'credit_amount', v_amount,
      'description', 'Pengeluaran kas untuk kasbon'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Kasbon Karyawan - ' || v_employee_name || ' - ' || v_reason,
    'advance',
    v_advance_id::TEXT,
    v_journal_lines,
    v_advance_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_advance_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_employee_advance_atomic(p_advance jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_employee_advance_atomic(p_advance jsonb, p_branch_id uuid) IS 'Create employee advance (kasbon) with auto journal. Dr. Piutang Karyawan, Cr. Kas.';


--
-- Name: create_expense_atomic(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_expense_atomic(p_expense jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, expense_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_expense_id TEXT;
  v_description TEXT;
  v_amount NUMERIC;
  v_category TEXT;
  v_date TIMESTAMPTZ;
  v_cash_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_expense_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_expense_account_name TEXT;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_expense IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Expense data is required'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_description := COALESCE(p_expense->>'description', 'Pengeluaran');
  v_amount := COALESCE((p_expense->>'amount')::NUMERIC, 0);
  v_category := COALESCE(p_expense->>'category', 'Beban Umum');
  v_date := COALESCE((p_expense->>'date')::TIMESTAMPTZ, NOW());
  v_cash_account_id := p_expense->>'account_id';  -- TEXT, no cast needed
  v_expense_account_id := p_expense->>'expense_account_id';  -- TEXT, no cast needed
  v_expense_account_name := p_expense->>'expense_account_name';

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- ==================== FIND ACCOUNTS ====================

  -- Find expense account by ID or fallback to category-based search
  IF v_expense_account_id IS NULL THEN
    -- Search by category name
    SELECT id INTO v_expense_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_header = FALSE
      AND (
        code LIKE '6%'  -- Expense accounts
        OR type IN ('Beban', 'Expense')
      )
      AND (
        LOWER(name) LIKE '%' || LOWER(v_category) || '%'
        OR name ILIKE '%beban umum%'
      )
    ORDER BY
      CASE WHEN LOWER(name) LIKE '%' || LOWER(v_category) || '%' THEN 1 ELSE 2 END,
      code
    LIMIT 1;

    -- Fallback to default expense account (6200 - Beban Operasional or 6100)
    IF v_expense_account_id IS NULL THEN
      SELECT id INTO v_expense_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_active = TRUE
        AND is_header = FALSE
        AND code IN ('6200', '6100', '6000')
      ORDER BY code
      LIMIT 1;
    END IF;
  END IF;

  -- Find cash/payment account
  IF v_cash_account_id IS NULL THEN
    SELECT id INTO v_cash_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_payment_account = TRUE
      AND code LIKE '11%'
    ORDER BY code
    LIMIT 1;
  END IF;

  -- Validate accounts found
  IF v_expense_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun beban tidak ditemukan. Pastikan ada akun dengan kode 6xxx.'::TEXT;
    RETURN;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun kas tidak ditemukan. Pastikan ada akun payment dengan kode 11xx.'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE EXPENSE ID ====================

  v_expense_id := 'exp-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT ||
                  '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE EXPENSE RECORD ====================

  INSERT INTO expenses (
    id,
    description,
    amount,
    category,
    date,
    account_id,
    expense_account_id,
    expense_account_name,
    branch_id,
    created_at
  ) VALUES (
    v_expense_id,
    v_description,
    v_amount,
    v_category,
    v_date,
    v_cash_account_id,
    v_expense_account_id,
    v_expense_account_name,
    p_branch_id,
    NOW()
  );

  -- ==================== CREATE JOURNAL ====================

  -- Debit: Beban (expense account)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_expense_account_id,
    'debit_amount', v_amount,
    'credit_amount', 0,
    'description', v_category || ': ' || v_description
  );

  -- Credit: Kas (payment account)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_cash_account_id,
    'debit_amount', 0,
    'credit_amount', v_amount,
    'description', 'Pengeluaran kas'
  );

  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_date::DATE,  -- Journal only needs DATE
    format('Pengeluaran - %s', v_description),
    'expense',
    v_expense_id,
    v_journal_lines,
    TRUE
  ) AS cja;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_expense_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_expense_atomic(p_expense jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_expense_atomic(p_expense jsonb, p_branch_id uuid) IS 'Create expense dengan auto journal (Dr. Beban, Cr. Kas). WAJIB branch_id.';


--
-- Name: create_expense_atomic(jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_expense_atomic(p_expense jsonb, p_branch_id uuid, p_photo_url text DEFAULT NULL::text) RETURNS TABLE(success boolean, expense_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_expense_id TEXT;
  v_description TEXT;
  v_amount NUMERIC;
  v_category TEXT;
  v_date TIMESTAMPTZ;
  v_cash_account_id TEXT;
  v_expense_account_id TEXT;
  v_expense_account_name TEXT;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_expense IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Expense data is required'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_description := COALESCE(p_expense->>'description', 'Pengeluaran');
  v_amount := COALESCE((p_expense->>'amount')::NUMERIC, 0);
  v_category := COALESCE(p_expense->>'category', 'Beban Umum');
  v_date := COALESCE((p_expense->>'date')::TIMESTAMPTZ, NOW());
  v_cash_account_id := p_expense->>'account_id';
  v_expense_account_id := p_expense->>'expense_account_id';
  v_expense_account_name := p_expense->>'expense_account_name';

  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- ==================== FIND ACCOUNTS ====================

  IF v_expense_account_id IS NULL THEN
    SELECT id INTO v_expense_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_header = FALSE
      AND (
        code LIKE '6%'
        OR type IN ('Beban', 'Expense')
      )
      AND (
        LOWER(name) LIKE '%' || LOWER(v_category) || '%'
        OR name ILIKE '%beban umum%'
      )
    ORDER BY
      CASE WHEN LOWER(name) LIKE '%' || LOWER(v_category) || '%' THEN 1 ELSE 2 END,
      code
    LIMIT 1;

    IF v_expense_account_id IS NULL THEN
      SELECT id INTO v_expense_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_active = TRUE
        AND is_header = FALSE
        AND code IN ('6200', '6100', '6000')
      ORDER BY code
      LIMIT 1;
    END IF;
  END IF;

  IF v_cash_account_id IS NULL THEN
    SELECT id INTO v_cash_account_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_active = TRUE
      AND is_payment_account = TRUE
      AND code LIKE '11%'
    ORDER BY code
    LIMIT 1;
  END IF;

  IF v_expense_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun beban tidak ditemukan. Pastikan ada akun dengan kode 6xxx.'::TEXT;
    RETURN;
  END IF;

  IF v_cash_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID,
      'Akun kas tidak ditemukan. Pastikan ada akun payment dengan kode 11xx.'::TEXT;
    RETURN;
  END IF;

  -- ==================== GENERATE EXPENSE ID ====================

  v_expense_id := 'exp-' || EXTRACT(EPOCH FROM NOW())::BIGINT::TEXT ||
                  '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE EXPENSE RECORD ====================

  INSERT INTO expenses (
    id,
    description,
    amount,
    category,
    date,
    account_id,
    expense_account_id,
    expense_account_name,
    branch_id,
    created_at,
    photo_url  -- ADDED
  ) VALUES (
    v_expense_id,
    v_description,
    v_amount,
    v_category,
    v_date,
    v_cash_account_id,
    v_expense_account_id,
    v_expense_account_name,
    p_branch_id,
    NOW(),
    p_photo_url -- ADDED
  );

  -- ==================== CREATE JOURNAL ====================

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_expense_account_id,
    'debit_amount', v_amount,
    'credit_amount', 0,
    'description', v_category || ': ' || v_description
  );

  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_cash_account_id,
    'debit_amount', 0,
    'credit_amount', v_amount,
    'description', 'Pengeluaran kas'
  );

  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_date::DATE,
    format('Pengeluaran - %s', v_description),
    'expense',
    v_expense_id,
    v_journal_lines,
    TRUE
  ) AS cja;

  RETURN QUERY SELECT TRUE, v_expense_id, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_inventory_opening_balance_journal_rpc(uuid, numeric, numeric, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_inventory_opening_balance_journal_rpc(p_branch_id uuid, p_products_value numeric DEFAULT 0, p_materials_value numeric DEFAULT 0, p_opening_date date DEFAULT CURRENT_DATE) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_persediaan_barang_id UUID;
  v_persediaan_bahan_id UUID;
  v_laba_ditahan_id UUID;
  v_total_amount NUMERIC;
  v_line_number INTEGER := 1;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  v_total_amount := COALESCE(p_products_value, 0) + COALESCE(p_materials_value, 0);
  IF v_total_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Total value must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- GET ACCOUNT IDS
  SELECT id INTO v_persediaan_barang_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_persediaan_bahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_laba_ditahan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    -- Fallback to Modal Disetor
    SELECT id INTO v_laba_ditahan_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_laba_ditahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Laba Ditahan/Modal tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_opening_date,
    'Saldo Awal Persediaan',
    'opening', 'INVENTORY-OPENING', 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Persediaan Barang Dagang (if > 0)
  IF p_products_value > 0 AND v_persediaan_barang_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_code, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_persediaan_barang_id, '1310',
      (SELECT name FROM accounts WHERE id = v_persediaan_barang_id),
      p_products_value, 0, 'Saldo awal persediaan barang dagang', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- Dr. Persediaan Bahan Baku (if > 0)
  IF p_materials_value > 0 AND v_persediaan_bahan_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_code, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_persediaan_bahan_id, '1320',
      (SELECT name FROM accounts WHERE id = v_persediaan_bahan_id),
      p_materials_value, 0, 'Saldo awal persediaan bahan baku', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- Cr. Laba Ditahan (penyeimbang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_laba_ditahan_id,
    (SELECT code FROM accounts WHERE id = v_laba_ditahan_id),
    (SELECT name FROM accounts WHERE id = v_laba_ditahan_id),
    0, v_total_amount, 'Penyeimbang saldo awal persediaan', v_line_number
  );
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_inventory_opening_balance_journal_rpc(p_branch_id uuid, p_products_value numeric, p_materials_value numeric, p_opening_date date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_inventory_opening_balance_journal_rpc(p_branch_id uuid, p_products_value numeric, p_materials_value numeric, p_opening_date date) IS 'Create opening balance journal for inventory';


--
-- Name: create_journal_atomic(uuid, date, text, text, text, jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_journal_atomic(p_branch_id uuid, p_entry_date date, p_description text, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_auto_post boolean DEFAULT true) RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line RECORD;
  v_line_number INTEGER := 0;
  v_period_closed BOOLEAN := FALSE;
BEGIN
  -- ==================== VALIDASI ====================

  -- Validasi branch_id WAJIB
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT AS error_message;
    RETURN;
  END IF;

  -- Validasi lines tidak kosong
  IF p_lines IS NULL OR jsonb_array_length(p_lines) = 0 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Journal lines are required'::TEXT AS error_message;
    RETURN;
  END IF;

  -- Validasi minimal 2 lines
  IF jsonb_array_length(p_lines) < 2 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Minimal 2 journal lines required (double-entry)'::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== CEK PERIOD LOCK ====================

  -- Cek apakah periode sudah ditutup
  BEGIN
    SELECT EXISTS (
      SELECT 1 FROM closing_entries
      WHERE branch_id = p_branch_id
        AND closing_type = 'year_end'
        AND status = 'posted'
        AND closing_date >= p_entry_date
    ) INTO v_period_closed;
  EXCEPTION WHEN undefined_table THEN
    v_period_closed := FALSE;
  END;

  IF v_period_closed THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      format('Periode %s sudah ditutup. Tidak dapat membuat jurnal.', p_entry_date)::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== VALIDASI LINES ====================

  -- Hitung total dan validasi accounts
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    -- Validasi account exists
    IF v_line.account_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE id = v_line.account_id
          AND branch_id = p_branch_id
          AND is_active = TRUE
      ) THEN
        RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
          format('Account ID %s tidak ditemukan di branch ini', v_line.account_id)::TEXT AS error_message;
        RETURN;
      END IF;
    ELSIF v_line.account_code IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM accounts
        WHERE code = v_line.account_code
          AND branch_id = p_branch_id
          AND is_active = TRUE
      ) THEN
         -- Fallback validation for 2140
         IF v_line.account_code = '2140' AND EXISTS (
            SELECT 1 FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id AND is_active = TRUE
         ) THEN
            -- Valid by fallback
            NULL;
         ELSE
            RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
              format('Account code %s tidak ditemukan di branch ini', v_line.account_code)::TEXT AS error_message;
            RETURN;
         END IF;
      END IF;
    ELSE
      RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
        'Setiap line harus memiliki account_id atau account_code'::TEXT AS error_message;
      RETURN;
    END IF;

    v_total_debit := v_total_debit + COALESCE(v_line.debit_amount, 0);
    v_total_credit := v_total_credit + COALESCE(v_line.credit_amount, 0);
  END LOOP;

  -- ==================== VALIDASI BALANCE ====================

  IF v_total_debit != v_total_credit THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      format('Jurnal tidak balance! Debit: %s, Credit: %s', v_total_debit, v_total_credit)::TEXT AS error_message;
    RETURN;
  END IF;

  IF v_total_debit = 0 THEN
    RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number,
      'Total debit/credit tidak boleh 0'::TEXT AS error_message;
    RETURN;
  END IF;

  -- ==================== GENERATE ENTRY NUMBER ====================

  v_entry_number := 'JE-' || TO_CHAR(p_entry_date, 'YYYYMMDD') || '-' ||
    LPAD((SELECT COUNT(*) + 1 FROM journal_entries
          WHERE branch_id = p_branch_id
          AND DATE(created_at) = DATE(p_entry_date))::TEXT, 4, '0') ||
    LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  -- ==================== CREATE JOURNAL HEADER ====================

  -- Create as draft first (trigger may block lines on posted)
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
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_branch_id,
    'draft',
    v_total_debit,
    v_total_credit
  )
  RETURNING id INTO v_journal_id;

  -- ==================== CREATE JOURNAL LINES ====================

  v_line_number := 0;
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_line_number := v_line_number + 1;

    DECLARE
      v_resolved_id TEXT;
    BEGIN
       IF v_line.account_id IS NOT NULL THEN
          v_resolved_id := v_line.account_id;
       ELSE
          SELECT id INTO v_resolved_id FROM accounts WHERE code = v_line.account_code AND branch_id = p_branch_id LIMIT 1;
          
          -- Fallback
          IF v_resolved_id IS NULL AND v_line.account_code = '2140' THEN
             SELECT id INTO v_resolved_id FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id LIMIT 1;
          END IF;
       END IF;

       INSERT INTO journal_entry_lines (
         journal_entry_id,
         line_number,
         account_id,
         account_code,
         description,
         debit_amount,
         credit_amount
       ) VALUES (
         v_journal_id,
         v_line_number,
         v_resolved_id,
         COALESCE(v_line.account_code,
           (SELECT code FROM accounts WHERE id = v_resolved_id LIMIT 1)),
         COALESCE(v_line.description, p_description),
         COALESCE(v_line.debit_amount, 0),
         COALESCE(v_line.credit_amount, 0)
       );
    END;
  END LOOP;

  -- ==================== POST JOURNAL ====================

  IF p_auto_post THEN
    UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_id;
  END IF;

  RETURN QUERY SELECT TRUE AS success, v_journal_id AS journal_id, v_entry_number AS entry_number, NULL::TEXT AS error_message;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE AS success, NULL::UUID AS journal_id, NULL::TEXT AS entry_number, SQLERRM::TEXT AS error_message;
END;
$$;


--
-- Name: FUNCTION create_journal_atomic(p_branch_id uuid, p_entry_date date, p_description text, p_reference_type text, p_reference_id text, p_lines jsonb, p_auto_post boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_journal_atomic(p_branch_id uuid, p_entry_date date, p_description text, p_reference_type text, p_reference_id text, p_lines jsonb, p_auto_post boolean) IS 'Create journal entry atomic dengan validasi balance. WAJIB branch_id.';


--
-- Name: create_journal_atomic(uuid, text, text, text, jsonb, date, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_journal_atomic(p_branch_id uuid, p_description text, p_reference_type text DEFAULT NULL::text, p_reference_id text DEFAULT NULL::text, p_lines jsonb DEFAULT '[]'::jsonb, p_entry_date date DEFAULT CURRENT_DATE, p_auto_post boolean DEFAULT true, p_created_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_journal_id UUID := gen_random_uuid();
  v_next_num INTEGER;
  v_entry_number TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_line RECORD;
  v_line_number INT := 0;
  v_account_exists BOOLEAN;
BEGIN
  -- Validate branch_id
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID wajib diisi'::TEXT;
    RETURN;
  END IF;

  -- Validate lines
  IF p_lines IS NULL OR jsonb_array_length(p_lines) < 2 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Minimal 2 baris jurnal diperlukan'::TEXT;
    RETURN;
  END IF;

  -- Calculate totals and validate accounts
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_total_debit := v_total_debit + COALESCE(v_line.debit_amount, 0);
    v_total_credit := v_total_credit + COALESCE(v_line.credit_amount, 0);

    -- Validate account exists
    IF v_line.account_id IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM accounts WHERE id = v_line.account_id AND branch_id = p_branch_id) INTO v_account_exists;
    ELSIF v_line.account_code IS NOT NULL THEN
      SELECT EXISTS(SELECT 1 FROM accounts WHERE code = v_line.account_code AND branch_id = p_branch_id) INTO v_account_exists;
    ELSE
      v_account_exists := FALSE;
    END IF;

    IF NOT v_account_exists THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT,
        format('Akun tidak ditemukan: %s', COALESCE(v_line.account_id, v_line.account_code, 'NULL'))::TEXT;
      RETURN;
    END IF;
  END LOOP;

  -- Validate balance
  IF ABS(v_total_debit - v_total_credit) > 0.01 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT,
      format('Jurnal tidak balance. Debit: %s, Credit: %s', v_total_debit, v_total_credit)::TEXT;
    RETURN;
  END IF;

  -- Generate entry number (Global across all branches)
  -- Generate entry number (Global across all branches)
  -- Uses Loop to prevent Duplicate Key Exception
  v_next_num := COALESCE(
      (SELECT MAX(CAST(SUBSTRING(je.entry_number FROM '-(\d+)$') AS INTEGER))
       FROM journal_entries je
       WHERE DATE(je.entry_date) = p_entry_date),
      0
  );

  LOOP
    v_next_num := v_next_num + 1;
    v_entry_number := 'JE-' || TO_CHAR(p_entry_date, 'YYYYMMDD') || '-' || LPAD(v_next_num::TEXT, 4, '0');
    
    -- Exit loop if this entry number does NOT exist
    EXIT WHEN NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.entry_number = v_entry_number);
  END LOOP;

  -- Create journal entry
  INSERT INTO journal_entries (
    id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    total_debit,
    total_credit,
    branch_id,
    created_by,
    created_at,
    is_voided
  ) VALUES (
    v_journal_id,
    v_entry_number,
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    CASE WHEN p_auto_post THEN 'posted' ELSE 'draft' END,
    v_total_debit,
    v_total_credit,
    p_branch_id,
    p_created_by,
    NOW(),
    FALSE
  );

  -- Create journal lines with account_code and account_name from accounts table
  FOR v_line IN SELECT * FROM jsonb_to_recordset(p_lines) AS x(
    account_id TEXT,
    account_code TEXT,
    debit_amount NUMERIC,
    credit_amount NUMERIC,
    description TEXT
  )
  LOOP
    v_line_number := v_line_number + 1;

    INSERT INTO journal_entry_lines (
      journal_entry_id,
      line_number,
      account_id,
      account_code,
      account_name,
      description,
      debit_amount,
      credit_amount
    )
    SELECT
      v_journal_id,
      v_line_number,
      a.id,
      a.code,
      a.name,
      COALESCE(v_line.description, p_description),
      COALESCE(v_line.debit_amount, 0),
      COALESCE(v_line.credit_amount, 0)
    FROM accounts a
    WHERE a.branch_id = p_branch_id
      AND (
        (v_line.account_id IS NOT NULL AND a.id = v_line.account_id)
        OR (v_line.account_id IS NULL AND a.code = v_line.account_code)
      )
    LIMIT 1;
  END LOOP;

  -- Post if auto_post
  IF p_auto_post THEN
    UPDATE journal_entries SET status = 'posted' WHERE id = v_journal_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$_$;


--
-- Name: create_maintenance_reminders(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_maintenance_reminders() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Create notifications for upcoming maintenance
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority, user_id)
    SELECT
        'NOTIF-REMINDER-' || am.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'Upcoming Maintenance: ' || a.asset_name,
        'Maintenance "' || am.title || '" for asset "' || a.asset_name || '" is scheduled for ' || am.scheduled_date::TEXT,
        'maintenance_due',
        'maintenance',
        am.id,
        '/maintenance',
        CASE
            WHEN am.priority = 'critical' THEN 'urgent'
            WHEN am.priority = 'high' THEN 'high'
            ELSE 'normal'
        END,
        am.created_by
    FROM asset_maintenance am
    JOIN assets a ON am.asset_id = a.id
    WHERE am.status = 'scheduled'
      AND am.scheduled_date <= CURRENT_DATE + (am.notify_before_days || ' days')::INTERVAL
      AND am.scheduled_date >= CURRENT_DATE
      AND am.notification_sent = FALSE;
    -- Mark notifications as sent
    UPDATE asset_maintenance
    SET notification_sent = TRUE
    WHERE status = 'scheduled'
      AND scheduled_date <= CURRENT_DATE + (notify_before_days || ' days')::INTERVAL
      AND scheduled_date >= CURRENT_DATE
      AND notification_sent = FALSE;
END;
$$;


--
-- Name: create_manual_cash_in_journal_rpc(uuid, text, date, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_manual_cash_in_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_description text, p_cash_account_id text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_pendapatan_lain_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_pendapatan_lain_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('4200', '4900') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_pendapatan_lain_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Pendapatan Lain-lain tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    'Kas Masuk: ' || p_description, 'manual', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    p_amount, 0, 'Kas masuk - ' || p_description, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_pendapatan_lain_account_id,
    (SELECT code FROM accounts WHERE id = v_pendapatan_lain_account_id),
    (SELECT name FROM accounts WHERE id = v_pendapatan_lain_account_id),
    0, p_amount, 'Pendapatan lain-lain', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_manual_cash_out_journal_rpc(uuid, text, date, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_manual_cash_out_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_description text, p_cash_account_id text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_lain_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_beban_lain_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('8100', '6900') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_beban_lain_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Beban Lain-lain tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    'Kas Keluar: ' || p_description, 'manual', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_lain_account_id,
    (SELECT code FROM accounts WHERE id = v_beban_lain_account_id),
    (SELECT name FROM accounts WHERE id = v_beban_lain_account_id),
    p_amount, 0, 'Beban lain-lain - ' || p_description, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    0, p_amount, 'Kas keluar - ' || p_description, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_material_payment_journal_rpc(uuid, text, date, numeric, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_material_payment_journal_rpc(p_branch_id uuid, p_reference_id text, p_transaction_date date, p_amount numeric, p_material_id uuid, p_material_name text, p_description text, p_cash_account_id text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_beban_bahan_account_id TEXT;  -- Changed to TEXT
BEGIN
  IF p_branch_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT; RETURN; END IF;
  IF p_amount <= 0 THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT; RETURN; END IF;
  IF p_cash_account_id IS NULL THEN RETURN QUERY SELECT FALSE, NULL::UUID, 'Cash account is required'::TEXT; RETURN; END IF;

  SELECT id INTO v_beban_bahan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code IN ('5300', '6300', '6310') AND is_active = TRUE ORDER BY code LIMIT 1;

  IF v_beban_bahan_account_id IS NULL THEN
    SELECT id INTO v_beban_bahan_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_beban_bahan_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Beban Bahan Baku tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GLOBAL SEQUENCE
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transaction_date,
    COALESCE(p_description, 'Pembayaran bahan - ' || p_material_name),
    'expense', p_reference_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_bahan_account_id,
    (SELECT code FROM accounts WHERE id = v_beban_bahan_account_id),
    (SELECT name FROM accounts WHERE id = v_beban_bahan_account_id),
    p_amount, 0, 'Beban bahan - ' || p_material_name, 1
  );

  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_cash_account_id,
    (SELECT code FROM accounts WHERE id = p_cash_account_id),
    (SELECT name FROM accounts WHERE id = p_cash_account_id),
    0, p_amount, 'Pembayaran bahan ' || p_material_name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_material_stock_adjustment_atomic(uuid, uuid, numeric, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_material_stock_adjustment_atomic(p_material_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text DEFAULT 'Stock Adjustment'::text, p_unit_cost numeric DEFAULT 0) RETURNS TABLE(success boolean, adjustment_id uuid, journal_id uuid, new_stock numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_adjustment_id UUID;
  v_journal_id UUID;
  v_material_name TEXT;
  v_current_stock NUMERIC;
  v_new_stock NUMERIC;
  v_adjustment_value NUMERIC;
  v_bahan_baku_account_id TEXT;
  v_modal_account_id TEXT;
  v_entry_number TEXT;
  v_fifo_success BOOLEAN;
  v_actual_unit_cost NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Material ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity_change = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Quantity change cannot be zero'::TEXT;
    RETURN;
  END IF;

  -- Get material info
  SELECT name, COALESCE(stock, 0) INTO v_material_name, v_current_stock
  FROM materials WHERE id = p_material_id;

  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Material tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  v_new_stock := v_current_stock + p_quantity_change;
  IF v_new_stock < 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC,
      format('Stok tidak cukup. Stok saat ini: %s', v_current_stock)::TEXT;
    RETURN;
  END IF;

  v_actual_unit_cost := COALESCE(p_unit_cost, 0);
  
  -- If actual unit cost is 0, try to get the last known cost from inventory_batches
  IF v_actual_unit_cost <= 0 THEN
    SELECT unit_cost INTO v_actual_unit_cost
    FROM inventory_batches
    WHERE material_id = p_material_id AND unit_cost > 0
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Fallback to materials.price_per_unit if still 0
    IF v_actual_unit_cost IS NULL OR v_actual_unit_cost <= 0 THEN
      SELECT COALESCE(price_per_unit, 0) INTO v_actual_unit_cost
      FROM materials WHERE id = p_material_id;
    END IF;
  END IF;

  v_adjustment_value := ABS(p_quantity_change) * COALESCE(v_actual_unit_cost, 0);

  -- ==================== GET ACCOUNT IDS ====================

  SELECT id INTO v_bahan_baku_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_modal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;

  -- Generate primary key for adjustment
  v_adjustment_id := gen_random_uuid();

  -- LEGACY UPDATE REMOVED: Using v2 FIFO functions instead


  -- ==================== CREATE/CONSUME MATERIAL BATCH ====================
  -- NEW: Using v2 functions that handle batches and movements correctly
  IF p_quantity_change > 0 THEN
    SELECT f.success INTO v_fifo_success
    FROM restore_material_fifo_v2(
      p_material_id,
      p_quantity_change,
      COALESCE(v_actual_unit_cost, 0),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  ELSE
    SELECT f.success INTO v_fifo_success
    FROM consume_material_fifo_v2(
      p_material_id,
      ABS(p_quantity_change),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  END IF;

  IF NOT v_fifo_success THEN
    RAISE EXCEPTION 'Gagal memproses FIFO adjustment';
  END IF;


  -- ==================== CREATE JOURNAL ENTRY ====================

  IF v_adjustment_value > 0 AND v_bahan_baku_account_id IS NOT NULL AND v_modal_account_id IS NOT NULL THEN
    -- Generate entry number (Global across all branches)
    SELECT 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(
      (COALESCE(
        (SELECT MAX(CAST(SUBSTRING(entry_number FROM '-(\d+)$') AS INTEGER))
         FROM journal_entries
         WHERE DATE(entry_date) = CURRENT_DATE),
        0
      ) + 1)::TEXT, 4, '0')
    INTO v_entry_number;

    INSERT INTO journal_entries (id, branch_id, entry_number, entry_date, description, reference_type, reference_id, status, is_voided, created_at, updated_at, total_debit, total_credit)
    VALUES (gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE, 'Penyesuaian Stok Bahan - ' || v_material_name || ' - ' || p_reason, 'adjustment', v_adjustment_id::TEXT, 'posted', FALSE, NOW(), NOW(), v_adjustment_value, v_adjustment_value)
    RETURNING id INTO v_journal_id;

    IF p_quantity_change > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_bahan_baku_account_id, '1320', (SELECT name FROM accounts WHERE id = v_bahan_baku_account_id), v_adjustment_value, 0, 'Penambahan bahan baku (Koreksi Modal Disetor)', 1);
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_modal_account_id, '3100', (SELECT name FROM accounts WHERE id = v_modal_account_id), 0, v_adjustment_value, 'Penyesuaian Modal Disetor', 2);
    ELSE
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_modal_account_id, '3100', (SELECT name FROM accounts WHERE id = v_modal_account_id), v_adjustment_value, 0, 'Penyesuaian Modal Disetor', 1);
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_bahan_baku_account_id, '1320', (SELECT name FROM accounts WHERE id = v_bahan_baku_account_id), 0, v_adjustment_value, 'Pengurangan bahan baku (Koreksi Modal Disetor)', 2);
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_adjustment_id, v_journal_id, v_new_stock, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$_$;


--
-- Name: FUNCTION create_material_stock_adjustment_atomic(p_material_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text, p_unit_cost numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_material_stock_adjustment_atomic(p_material_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text, p_unit_cost numeric) IS 'Adjust material stock with FIFO batch and journal entry.';


--
-- Name: create_migration_debt_journal_rpc(uuid, text, date, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_migration_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text DEFAULT 'other'::text, p_description text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_saldo_awal_account_id UUID;
  v_hutang_account_id UUID;
  v_hutang_code TEXT;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- GET SALDO AWAL ACCOUNT
  SELECT id INTO v_saldo_awal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  -- GET HUTANG ACCOUNT BASED ON CREDITOR TYPE
  CASE p_creditor_type
    WHEN 'bank' THEN v_hutang_code := '2120';
    WHEN 'supplier' THEN v_hutang_code := '2110';
    ELSE v_hutang_code := '2190';
  END CASE;
  SELECT id INTO v_hutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = v_hutang_code AND is_active = TRUE LIMIT 1;
  IF v_hutang_account_id IS NULL THEN
    SELECT id INTO v_hutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '2110' AND is_active = TRUE LIMIT 1;
    v_hutang_code := '2110';
  END IF;
  IF v_saldo_awal_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Saldo Awal (3100) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_hutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Hutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_debt_date,
    COALESCE(p_description, 'Migrasi hutang dari ' || p_creditor_name),
    'payable', p_debt_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Saldo Awal (penyeimbang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_saldo_awal_account_id, '3100',
    (SELECT name FROM accounts WHERE id = v_saldo_awal_account_id),
    p_amount, 0, 'Saldo awal hutang migrasi', 1
  );
  -- Cr. Hutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_hutang_account_id, v_hutang_code,
    (SELECT name FROM accounts WHERE id = v_hutang_account_id),
    0, p_amount, 'Hutang migrasi - ' || p_creditor_name, 2
  );
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_migration_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text, p_description text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_migration_debt_journal_rpc(p_branch_id uuid, p_debt_id text, p_debt_date date, p_amount numeric, p_creditor_name text, p_creditor_type text, p_description text) IS 'Create migration journal for debt: Dr. Saldo Awal, Cr. Hutang';


--
-- Name: create_migration_receivable_journal_rpc(uuid, text, date, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_migration_receivable_journal_rpc(p_branch_id uuid, p_receivable_id text, p_receivable_date date, p_amount numeric, p_customer_name text, p_description text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_piutang_account_id TEXT;
  v_saldo_awal_account_id TEXT;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  -- GET ACCOUNT IDS
  
  -- Try 1210 (Piutang Usaha) then 1130 (Piutang Dagang)
  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;

  IF v_piutang_account_id IS NULL THEN
    SELECT id INTO v_piutang_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1130' AND is_active = TRUE LIMIT 1;
  END IF;

  -- Try 3200 (Laba Ditahan) then 3100 (Modal Disetor)
  SELECT id INTO v_saldo_awal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3200' AND is_active = TRUE LIMIT 1;

  IF v_saldo_awal_account_id IS NULL THEN
    SELECT id INTO v_saldo_awal_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;
  END IF;

  IF v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Piutang Usaha (1210/1130) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_saldo_awal_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Saldo Awal (3200/3100) tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_receivable_date,
    COALESCE(p_description, 'Piutang Migrasi - ' || p_customer_name),
    'receivable', p_receivable_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Piutang Usaha
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_piutang_account_id, 
    (SELECT code FROM accounts WHERE id = v_piutang_account_id),
    (SELECT name FROM accounts WHERE id = v_piutang_account_id),
    p_amount, 0, 'Piutang migrasi - ' || p_customer_name, 1
  );

  -- Cr. Saldo Awal / Laba Ditahan
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_saldo_awal_account_id, 
    (SELECT code FROM accounts WHERE id = v_saldo_awal_account_id),
    (SELECT name FROM accounts WHERE id = v_saldo_awal_account_id),
    0, p_amount, 'Saldo awal piutang migrasi', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_migration_receivable_journal_rpc(p_branch_id uuid, p_receivable_id text, p_receivable_date date, p_amount numeric, p_customer_name text, p_description text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_migration_receivable_journal_rpc(p_branch_id uuid, p_receivable_id text, p_receivable_date date, p_amount numeric, p_customer_name text, p_description text) IS 'Create migration journal for receivable: Dr. Piutang, Cr. Saldo Awal';


--
-- Name: create_migration_transaction(text, uuid, text, date, jsonb, numeric, numeric, numeric, text, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_migration_transaction(p_transaction_id text, p_customer_id uuid, p_customer_name text, p_order_date date, p_items jsonb, p_total numeric, p_delivered_value numeric, p_paid_amount numeric DEFAULT 0, p_payment_account_id text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_cashier_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, transaction_id text, journal_id uuid, delivery_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_delivery_id UUID;
  v_entry_number TEXT;
  v_piutang_account_id TEXT;
  v_modal_tertahan_account_id TEXT;
  v_kas_account_id TEXT;
  v_payment_status TEXT;
  v_transaction_notes TEXT;
  v_remaining_value NUMERIC;
  v_item JSONB;
  v_has_remaining_delivery BOOLEAN := FALSE;
  v_remaining_items JSONB := '[]'::JSONB;
  v_transaction_items JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID,
      'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  IF p_customer_name IS NULL OR p_customer_name = '' THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID,
      'Customer name is required'::TEXT;
    RETURN;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID,
      'At least one item is required'::TEXT;
    RETURN;
  END IF;

  IF p_total <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID,
      'Total must be positive'::TEXT;
    RETURN;
  END IF;

  -- ==================== LOOKUP ACCOUNTS ====================

  -- Find Piutang Dagang account (1130)
  SELECT id INTO v_piutang_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%piutang%dagang%' OR
    LOWER(name) LIKE '%piutang%usaha%' OR
    code = '1130'
  )
  AND is_header = FALSE
  LIMIT 1;

  IF v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID,
      'Akun Piutang Dagang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Find Modal Barang Dagang Tertahan account (2140)
  SELECT id INTO v_modal_tertahan_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%modal%barang%tertahan%' OR
    LOWER(name) LIKE '%modal%dagang%tertahan%' OR
    code = '2140'
  )
  AND is_header = FALSE
  LIMIT 1;

  -- If not found, create it
  IF v_modal_tertahan_account_id IS NULL THEN
    INSERT INTO accounts (id, code, name, type, parent_id, is_header, balance, is_active, description)
    VALUES (
      '2140',
      '2140',
      'Modal Barang Dagang Tertahan',
      'liability',
      '2100', -- Assuming 2100 is Kewajiban Jangka Pendek header
      FALSE,
      0,
      TRUE,
      'Modal untuk barang yang sudah dijual tapi belum dikirim dari migrasi sistem lama'
    )
    ON CONFLICT (id) DO NOTHING;

    v_modal_tertahan_account_id := '2140';
  END IF;

  -- ==================== CALCULATE VALUES ====================

  -- Calculate remaining value (undelivered items)
  v_remaining_value := p_total - p_delivered_value;

  -- ==================== DETERMINE PAYMENT STATUS ====================

  IF p_paid_amount >= p_total THEN
    v_payment_status := 'Lunas';
  ELSE
    v_payment_status := 'Belum Lunas';
  END IF;

  -- ==================== BUILD TRANSACTION ITEMS ====================

  -- Process items and build remaining items for delivery
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    DECLARE
      v_qty INT := (v_item->>'quantity')::INT;
      v_delivered INT := COALESCE((v_item->>'delivered_qty')::INT, 0);
      v_remaining INT := v_qty - v_delivered;
      v_price NUMERIC := (v_item->>'price')::NUMERIC;
    BEGIN
      -- Add to transaction items with delivered info
      v_transaction_items := v_transaction_items || jsonb_build_object(
        'product_id', v_item->>'product_id',
        'product_name', v_item->>'product_name',
        'quantity', v_qty,
        'delivered_qty', v_delivered,
        'remaining_qty', v_remaining,
        'price', v_price,
        'unit', v_item->>'unit',
        'subtotal', v_qty * v_price,
        'is_migration', true
      );

      -- If there's remaining, mark for delivery
      IF v_remaining > 0 THEN
        v_has_remaining_delivery := TRUE;
        v_remaining_items := v_remaining_items || jsonb_build_object(
          'product_id', v_item->>'product_id',
          'product_name', v_item->>'product_name',
          'quantity', v_remaining,
          'price', v_price,
          'unit', v_item->>'unit'
        );
      END IF;
    END;
  END LOOP;

  -- ==================== BUILD NOTES ====================

  v_transaction_notes := '[MIGRASI] ';
  IF p_notes IS NOT NULL AND p_notes != '' THEN
    v_transaction_notes := v_transaction_notes || p_notes;
  ELSE
    v_transaction_notes := v_transaction_notes || 'Import data dari sistem lama';
  END IF;

  -- ==================== INSERT TRANSACTION ====================

  INSERT INTO transactions (
    id,
    customer_id,
    customer_name,
    cashier_id,
    cashier_name,
    order_date,
    items,
    total,
    subtotal,
    paid_amount,
    payment_status,
    payment_account_id,
    status,
    notes,
    branch_id,
    ppn_enabled,
    ppn_percentage,
    ppn_amount,
    created_at,
    updated_at
  ) VALUES (
    p_transaction_id,
    p_customer_id,
    p_customer_name,
    p_cashier_id,
    p_cashier_name,
    p_order_date,
    v_transaction_items,
    p_total,
    p_total, -- subtotal = total (no PPN for migration)
    p_paid_amount,
    v_payment_status,
    p_payment_account_id,
    CASE
      WHEN NOT v_has_remaining_delivery THEN 'Selesai'
      WHEN p_delivered_value > 0 THEN 'Diantar Sebagian'
      ELSE 'Pesanan Masuk'
    END,
    v_transaction_notes,
    p_branch_id,
    FALSE, -- No PPN
    0,
    0,
    NOW(),
    NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Generate entry number
  v_entry_number := 'JE-MIG-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                    LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');

  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    branch_id,
    created_by,
    created_at
  ) VALUES (
    v_entry_number,
    p_order_date,
    format('[MIGRASI] Penjualan - %s', p_customer_name),
    'transaction',
    p_transaction_id,
    'posted',
    p_branch_id,
    p_cashier_id,
    NOW()
  )
  RETURNING id INTO v_journal_id;

  -- ==================== JOURNAL LINE ITEMS ====================

  -- Jurnal migrasi:
  -- TIDAK mempengaruhi kas saat input
  -- TIDAK mempengaruhi pendapatan saat input
  --
  -- Untuk barang yang SUDAH dikirim (delivered):
  --   Debit: Piutang Dagang (delivered_value)
  --   Credit: Modal Barang Dagang Tertahan (delivered_value)
  --   (Pendapatan akan tercatat saat pembayaran piutang normal)
  --
  -- Untuk barang yang BELUM dikirim (remaining):
  --   Akan masuk ke daftar pengiriman, jurnal dicatat saat pengiriman
  --
  -- Jika ada pembayaran (paid_amount > 0):
  --   Jurnal terpisah untuk penerimaan kas
  --   Debit: Kas (paid_amount)
  --   Credit: Piutang Dagang (paid_amount)

  -- Journal for delivered items (Piutang vs Modal Tertahan)
  -- Journal Logic V9 (User Request Alignment):
  -- 1. Initial Journal: Record ONLY the Remaining Balance as Receivable (Piutang).
  --    Debit: Piutang Dagang (Remaining Balance)
  --    Credit: Modal Barang Dagang Tertahan (Remaining Balance)
  --
  -- 2. Payment Journal: Record the Paid Amount as Cash.
  --    Debit: Kas/Bank (Paid Amount)
  --    Credit: Modal Barang Dagang Tertahan (Paid Amount) [Instead of AR!]
  --
  -- Result:
  -- AR = Remaining (Correct)
  -- Cash = Paid (Correct)
  -- Modal = Remaining + Paid = Total Transaction (Correct)

  IF v_remaining_value > 0 THEN
    -- Debit: Piutang Dagang (Sisa Tagihan)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_piutang_account_id, v_remaining_value, 0,
      format('Piutang penjualan migrasi - %s (Sisa Tagihan)', p_customer_name), 1);

    -- Credit: Modal Barang Dagang Tertahan (Sisa Tagihan)
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_modal_tertahan_account_id, 0, v_remaining_value,
      format('Modal barang tertahan migrasi - %s (Sisa Tagihan)', p_customer_name), 2);
  ELSE
    -- If fully paid, we still need at least 2 lines for the journal to be valid if we are creating one.
    -- Or we can skip creating the main journal if remaining is 0?
    -- The RPC creates v_journal_id unconditionally above.
    -- Let's insert a dummy balanced 0 entry or handle it?
    -- Actually, if remaining is 0, we can just insert 0-value lines or structure it differently.
    -- However, let's stick to the structure:
    -- If remaining > 0, insert lines.
    -- If remaining = 0, we might have an empty journal which is invalid?
    -- But the payment journal is separate.
    -- Let's put a check. If v_remaining_value = 0, we might not want to create the "Transaction" journal at all?
    -- But the code already inserted into journal_entries table RETURNING id.
    -- So we must add lines.
    
    -- Edge case: Fully paid migration.
    -- Use Total Amount for records, but effect is 0?
    -- No, if fully paid, AR is 0.
    
    -- Let's look at the case where Remaining > 0.
    -- The code block above ALREADY created the journal header.
    NULL; -- distinct from previous block
  END IF;

  -- Handle case where remaining is 0 (Fully Paid users)
  -- If remaining is 0, we shouldn't leave the journal empty.
  -- Maybe we just use the Modal account for both sides? (Dummy)
  -- Or better: If remaining is 0, DELETE the journal header we just created?
  -- Refactoring slightly: Create journal header ONLY if needed?
  -- But we return journal_id.
  
  -- Let's stick to: If remaining > 0, create AR lines.
  -- If remaining == 0, we insert "Info Only" lines or 0 value lines?
  -- Journal validation requires > 0 sums usually.
  
  -- Let's change strategy:
  -- Main Journal contains BOTH parts if we want?
  -- No, keep them separate as per logical flow.
  
  -- Fix for valid journal lines if remaining = 0:
  IF v_remaining_value = 0 THEN
     -- Insert a "Completed" marker entry (0 value might be rejected by validation)
     -- Let's use 1 rupiah dummy or just allow it?
     -- Actually, if v_remaining_value = 0, this journal represents "0 Receivable".
     -- Let's Insert 0 value lines. The validation check `v_total_debit = 0` in `create_journal_atomic` might block it.
     -- BUT we are inserting directly into tables here, bypassing `create_journal_atomic`!
     -- So we can do whatever we want.
     
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_piutang_account_id, 0, 0,
      format('Piutang penjualan migrasi - %s (Lunas)', p_customer_name), 1);

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_modal_tertahan_account_id, 0, 0,
      format('Modal barang tertahan migrasi - %s (Lunas)', p_customer_name), 2);
  END IF;


  -- Journal Logic V10 (Final Adjustment):
  -- 1. Initial Journal (Piutang): Record ONLY the Remaining Balance.
  --    Debit: Piutang Dagang (Sisa Tagihan)
  --    Credit: Modal Barang Dagang Tertahan (Sisa Tagihan)
  --
  -- 2. Payment Journal (Pembayaran Lama): DO NOT RECORD.
  --    Reason: Money was received in the past, effectively "Opening Equity" which we are not recording explicitly here as Cash.
  --    If we record Debit Cash, it artificially inflates current Cash on Hand.
  --    We only care about tracking what is STILL OWED (Piutang).
  --
  -- Result:
  -- AR = Remaining (Correct)
  -- Cash = No Change (Correct, money is already gone/banked in legacy system)
  -- Modal = Remaining Balance (Valid offset for the AR)

  -- ==================== JOURNAL FOR PAYMENT REMOVED ====================
  -- Historical payments do not generate new Cash entries.

  -- ==================== CREATE PENDING DELIVERY (if remaining) ====================

  IF v_has_remaining_delivery THEN
    v_delivery_id := gen_random_uuid();

    INSERT INTO deliveries (
      id,
      transaction_id,
      delivery_number,
      delivery_date,
      customer_name,
      status,
      notes,
      branch_id,
      created_at,
      updated_at
    ) VALUES (
      v_delivery_id,
      p_transaction_id,
      1, -- First delivery for this transaction
      p_order_date, -- Set delivery date to order date
      p_customer_name,
      'Menunggu',
      '[MIGRASI] Sisa pengiriman dari sistem lama',
      p_branch_id,
      NOW(),
      NOW()
    );

    -- Insert Delivery Items
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_remaining_items)
    LOOP
      INSERT INTO delivery_items (
        delivery_id,
        product_id,
        product_name,
        quantity_delivered,
        unit,
        is_bonus,
        notes,
        created_at
      ) VALUES (
        v_delivery_id,
        (v_item->>'product_id')::UUID,
        v_item->>'product_name',
        (v_item->>'quantity')::NUMERIC,
        COALESCE(v_item->>'unit', 'pcs'),
        FALSE,
        'Sisa migrasi',
        NOW()
      );
    END LOOP;

    RAISE NOTICE '[Migration] Delivery % created for remaining items from transaction %',
      v_delivery_id, p_transaction_id;
  END IF;

  -- ==================== LOG ====================

  RAISE NOTICE '[Migration] Transaction % created for % (Total: %, Delivered: %, Remaining: %, Paid: %)',
    p_transaction_id, p_customer_name, p_total, p_delivered_value, v_remaining_value, p_paid_amount;

  RETURN QUERY SELECT TRUE, p_transaction_id, v_journal_id, v_delivery_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_migration_transaction(p_transaction_id text, p_customer_id uuid, p_customer_name text, p_order_date date, p_items jsonb, p_total numeric, p_delivered_value numeric, p_paid_amount numeric, p_payment_account_id text, p_notes text, p_branch_id uuid, p_cashier_id uuid, p_cashier_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_migration_transaction(p_transaction_id text, p_customer_id uuid, p_customer_name text, p_order_date date, p_items jsonb, p_total numeric, p_delivered_value numeric, p_paid_amount numeric, p_payment_account_id text, p_notes text, p_branch_id uuid, p_cashier_id uuid, p_cashier_name text) IS 'Import transaksi historis tanpa potong stok dan tanpa komisi.
   - Tidak mempengaruhi kas atau pendapatan saat input
   - Mencatat jurnal: Piutang vs Modal Barang Dagang Tertahan (2140)
   - Sisa barang belum terkirim masuk ke daftar pengiriman
   - Pembayaran dicatat sebagai jurnal terpisah';


--
-- Name: create_payroll_record(jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_payroll_record(p_payroll jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, payroll_id uuid, net_salary numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payroll_id UUID;
  v_employee_id UUID;
  v_period_year INTEGER;
  v_period_month INTEGER;
  v_period_start DATE;
  v_period_end DATE;
  v_base_salary NUMERIC;
  v_commission NUMERIC;
  v_bonus NUMERIC;
  v_advance_deduction NUMERIC;
  v_salary_deduction NUMERIC;
  v_total_deductions NUMERIC;
  v_gross_salary NUMERIC;
  v_net_salary NUMERIC;
  v_notes TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_payroll IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Payroll data is required'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_employee_id := (p_payroll->>'employee_id')::UUID;
  v_period_year := COALESCE((p_payroll->>'period_year')::INTEGER, EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER);
  v_period_month := COALESCE((p_payroll->>'period_month')::INTEGER, EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER);
  v_base_salary := COALESCE((p_payroll->>'base_salary')::NUMERIC, 0);
  v_commission := COALESCE((p_payroll->>'commission')::NUMERIC, 0);
  v_bonus := COALESCE((p_payroll->>'bonus')::NUMERIC, 0);
  v_advance_deduction := COALESCE((p_payroll->>'advance_deduction')::NUMERIC, 0);
  v_salary_deduction := COALESCE((p_payroll->>'salary_deduction')::NUMERIC, 0);
  v_notes := p_payroll->>'notes';
  IF v_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  -- Calculate period dates
  v_period_start := make_date(v_period_year, v_period_month, 1);
  v_period_end := (v_period_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  -- Calculate amounts
  v_total_deductions := v_advance_deduction + v_salary_deduction;
  v_gross_salary := v_base_salary + v_commission + v_bonus;
  v_net_salary := v_gross_salary - v_total_deductions;
  
  -- Prevent negative net salary (walaupun frontend validasi, backend harus jaga)
  IF v_net_salary < 0 THEN
    v_net_salary := 0; -- Atau throw error jika kebijakan tidak membolehkan
  END IF;

  -- ==================== CHECK DUPLICATE ====================
  IF EXISTS (
    SELECT 1 FROM payroll_records
    WHERE employee_id = v_employee_id
      AND period_start = v_period_start
      AND period_end = v_period_end
      AND branch_id = p_branch_id
      AND status != 'voided' -- Validasi tambahan, avoid voided records blocking new ones? usually deleted
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      format('Payroll untuk karyawan ini periode %s-%s sudah ada', v_period_year, v_period_month)::TEXT;
    RETURN;
  END IF;
  -- ==================== INSERT PAYROLL RECORD ====================
  INSERT INTO payroll_records (
    employee_id,
    period_start,
    period_end,
    base_salary,
    total_commission,
    total_bonus,
    total_deductions,
    advance_deduction,
    salary_deduction,
    net_salary,
    status,
    notes,
    branch_id,
    created_at
  ) VALUES (
    v_employee_id,
    v_period_start,
    v_period_end,
    v_base_salary,
    v_commission,
    v_bonus,
    v_total_deductions,
    v_advance_deduction,
    v_salary_deduction,
    v_net_salary,
    'draft',
    v_notes,
    p_branch_id,
    NOW()
  )
  RETURNING id INTO v_payroll_id;
  RETURN QUERY SELECT TRUE, v_payroll_id, v_net_salary, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_payroll_record(p_payroll jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_payroll_record(p_payroll jsonb, p_branch_id uuid) IS 'Create payroll record dalam status draft. WAJIB branch_id.';


--
-- Name: create_product_stock_adjustment_atomic(uuid, uuid, numeric, text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_product_stock_adjustment_atomic(p_product_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text DEFAULT 'Stock Adjustment'::text, p_unit_cost numeric DEFAULT 0) RETURNS TABLE(success boolean, adjustment_id uuid, journal_id uuid, new_stock numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_adjustment_id UUID;
  v_journal_id UUID;
  v_product_name TEXT;
  v_current_stock NUMERIC;
  v_new_stock NUMERIC;
  v_adjustment_value NUMERIC;
  v_persediaan_account_id TEXT;
  v_modal_account_id TEXT;
  v_entry_number TEXT;
  v_fifo_success BOOLEAN;
  v_actual_unit_cost NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Product ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity_change = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Quantity change cannot be zero'::TEXT;
    RETURN;
  END IF;

  -- Get product info
  SELECT name, COALESCE(current_stock, 0) INTO v_product_name, v_current_stock
  FROM products WHERE id = p_product_id;

  IF v_product_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Produk tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Calculate new stock (cannot go negative)
  v_new_stock := v_current_stock + p_quantity_change;
  IF v_new_stock < 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC,
      format('Stok tidak cukup. Stok saat ini: %s, pengurangan: %s', v_current_stock, ABS(p_quantity_change))::TEXT;
    RETURN;
  END IF;

  v_actual_unit_cost := COALESCE(p_unit_cost, 0);

  -- If actual unit cost is 0, try to get the last known cost from inventory_batches
  IF v_actual_unit_cost <= 0 THEN
    SELECT unit_cost INTO v_actual_unit_cost
    FROM inventory_batches
    WHERE product_id = p_product_id AND unit_cost > 0
    ORDER BY created_at DESC
    LIMIT 1;
    
    -- Fallback to products.cost_price if still 0
    IF v_actual_unit_cost IS NULL OR v_actual_unit_cost <= 0 THEN
      SELECT COALESCE(cost_price, 0) INTO v_actual_unit_cost
      FROM products WHERE id = p_product_id;
    END IF;
  END IF;

  -- Calculate adjustment value
  v_adjustment_value := ABS(p_quantity_change) * COALESCE(v_actual_unit_cost, 0);

  -- ==================== GET ACCOUNT IDS ====================

  SELECT id INTO v_persediaan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;

  -- Modal Disetor account (3100)
  SELECT id INTO v_modal_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '3100' AND is_active = TRUE LIMIT 1;

  -- Generate primary key for adjustment
  v_adjustment_id := gen_random_uuid();

  -- LEGACY UPDATE REMOVED: Using v2 FIFO functions instead


  -- ==================== CREATE/CONSUME PRODUCT BATCH ====================
  -- NEW: Using v2 functions
  IF p_quantity_change > 0 THEN
    SELECT f.success INTO v_fifo_success
    FROM restore_stock_fifo_v2(
      p_product_id,
      p_quantity_change,
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  ELSE
    SELECT f.success INTO v_fifo_success
    FROM consume_stock_fifo_v2(
      p_product_id,
      ABS(p_quantity_change),
      v_adjustment_id::TEXT,
      'adjustment',
      p_branch_id
    ) f;
  END IF;

  IF NOT v_fifo_success THEN
    RAISE EXCEPTION 'Gagal memproses FIFO adjustment';
  END IF;


  -- ==================== CREATE JOURNAL ENTRY (if value > 0) ====================

  IF v_adjustment_value > 0 AND v_persediaan_account_id IS NOT NULL AND v_modal_account_id IS NOT NULL THEN
    -- Generate entry number (Global across all branches)
    SELECT 'JE-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(
      (COALESCE(
        (SELECT MAX(CAST(SUBSTRING(entry_number FROM '-(\d+)$') AS INTEGER))
         FROM journal_entries
         WHERE DATE(entry_date) = CURRENT_DATE),
        0
      ) + 1)::TEXT, 4, '0')
    INTO v_entry_number;

    INSERT INTO journal_entries (
      id, branch_id, entry_number, entry_date, description,
      reference_type, reference_id, status, is_voided, created_at, updated_at, total_debit, total_credit
    ) VALUES (
      gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE,
      'Penyesuaian Stok - ' || v_product_name || ' - ' || p_reason,
      'adjustment', v_adjustment_id::TEXT, 'posted', FALSE, NOW(), NOW(), v_adjustment_value, v_adjustment_value
    ) RETURNING id INTO v_journal_id;

    IF p_quantity_change > 0 THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_persediaan_account_id, '1310', (SELECT name FROM accounts WHERE id = v_persediaan_account_id), v_adjustment_value, 0, 'Penambahan produk (Koreksi Modal Disetor)', 1);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_modal_account_id, '3100', (SELECT name FROM accounts WHERE id = v_modal_account_id), 0, v_adjustment_value, 'Penyesuaian Modal Disetor', 2);
    ELSE
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_modal_account_id, '3100', (SELECT name FROM accounts WHERE id = v_modal_account_id), v_adjustment_value, 0, 'Penyesuaian Modal Disetor', 1);

      INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_code, account_name, debit_amount, credit_amount, description, line_number)
      VALUES (v_journal_id, v_persediaan_account_id, '1310', (SELECT name FROM accounts WHERE id = v_persediaan_account_id), 0, v_adjustment_value, 'Pengurangan produk (Koreksi Modal Disetor)', 2);
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_adjustment_id, v_journal_id, v_new_stock, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$_$;


--
-- Name: FUNCTION create_product_stock_adjustment_atomic(p_product_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text, p_unit_cost numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_product_stock_adjustment_atomic(p_product_id uuid, p_branch_id uuid, p_quantity_change numeric, p_reason text, p_unit_cost numeric) IS 'Adjust product stock with FIFO batch and journal entry.';


--
-- Name: create_purchase_order_atomic(jsonb, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_purchase_order_atomic(p_po_header jsonb, p_po_items jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, po_id text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_po_id TEXT;
  v_item JSONB;
BEGIN
  -- Validate required fields
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_po_header->>'supplier_id' IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 'Supplier ID is required'::TEXT;
    RETURN;
  END IF;

  -- Generate PO ID if not provided
  v_po_id := p_po_header->>'id';
  IF v_po_id IS NULL THEN
    v_po_id := 'PO-' || EXTRACT(EPOCH FROM NOW())::TEXT;
  END IF;

  -- Insert Header
  INSERT INTO purchase_orders (
    id,
    po_number,
    status,
    requested_by,
    supplier_id,
    supplier_name,
    total_cost,
    subtotal,
    include_ppn,
    ppn_mode,
    ppn_amount,
    expedition,
    order_date,
    expected_delivery_date,
    notes,
    branch_id,
    created_at
  ) VALUES (
    v_po_id,
    p_po_header->>'po_number',
    'Pending',
    COALESCE(p_po_header->>'requested_by', 'System'),
    (p_po_header->>'supplier_id')::UUID,
    p_po_header->>'supplier_name',
    (p_po_header->>'total_cost')::NUMERIC,
    (p_po_header->>'subtotal')::NUMERIC,
    COALESCE((p_po_header->>'include_ppn')::BOOLEAN, FALSE),
    COALESCE(p_po_header->>'ppn_mode', 'exclude'),
    COALESCE((p_po_header->>'ppn_amount')::NUMERIC, 0),
    p_po_header->>'expedition',
    COALESCE((p_po_header->>'order_date')::TIMESTAMP, NOW()),
    (p_po_header->>'expected_delivery_date')::TIMESTAMP,
    p_po_header->>'notes',
    p_branch_id,
    NOW()
  );

  -- Insert Items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_po_items)
  LOOP
    INSERT INTO purchase_order_items (
      purchase_order_id,
      material_id,
      product_id,
      material_name,
      product_name,
      item_type,
      quantity,
      unit_price,
      unit,
      subtotal,
      notes
    ) VALUES (
      v_po_id,
      (v_item->>'material_id')::UUID,
      (v_item->>'product_id')::UUID,
      v_item->>'material_name',
      v_item->>'product_name',
      COALESCE(v_item->>'item_type', CASE WHEN v_item->>'material_id' IS NOT NULL THEN 'material' ELSE 'product' END),
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      v_item->>'unit',
      COALESCE((v_item->>'subtotal')::NUMERIC, (v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC),
      v_item->>'notes'
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, v_po_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_receivable_payment_journal_rpc(uuid, text, date, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_receivable_payment_journal_rpc(p_branch_id uuid, p_transaction_id text, p_payment_date date, p_amount numeric, p_customer_name text DEFAULT 'Pelanggan'::text, p_payment_account_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  -- Validate
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get account IDs
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;

  IF v_kas_account_id IS NULL OR v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Required accounts not found'::TEXT;
    RETURN;
  END IF;

  -- Generate entry number (global sequence)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- Create journal entry header
  INSERT INTO journal_entries (
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    total_debit,
    total_credit,
    created_at,
    updated_at
  ) VALUES (
    p_branch_id,
    v_entry_number,
    p_payment_date,
    'Pembayaran Piutang - ' || p_transaction_id || ' - ' || p_customer_name,
    'receivable_payment', -- FIXED: was 'receivable', now 'receivable_payment'
    p_transaction_id,
    'posted',
    FALSE,
    p_amount,
    p_amount,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    p_amount, 0, 'Penerimaan kas pembayaran piutang', 1
  );

  -- Cr. Piutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_piutang_account_id,
    (SELECT name FROM accounts WHERE id = v_piutang_account_id),
    0, p_amount, 'Pelunasan piutang usaha', 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_receivable_payment_journal_rpc(p_branch_id uuid, p_transaction_id text, p_payment_date date, p_amount numeric, p_customer_name text, p_payment_account_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_receivable_payment_journal_rpc(p_branch_id uuid, p_transaction_id text, p_payment_date date, p_amount numeric, p_customer_name text, p_payment_account_id text) IS 'Create receivable payment journal entry with correct reference_type for cash flow tracking';


--
-- Name: create_receivable_payment_journal_rpc(uuid, text, date, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_receivable_payment_journal_rpc(p_branch_id uuid, p_transaction_id text, p_payment_date date, p_amount numeric, p_customer_name text DEFAULT 'Pelanggan'::text, p_payment_account_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id UUID;
  v_piutang_account_id UUID;
BEGIN
  -- Validate
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get account IDs
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;
  IF v_kas_account_id IS NULL OR v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Required accounts not found'::TEXT;
    RETURN;
  END IF;
  -- Generate entry number
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- Create journal entry header
  INSERT INTO journal_entries (
    id,
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_branch_id,
    v_entry_number,
    p_payment_date,
    'Pembayaran Piutang - ' || p_transaction_id || ' - ' || p_customer_name,
    'receivable',
    p_transaction_id,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    p_amount, 0, 'Penerimaan kas pembayaran piutang', 1
  );
  -- Cr. Piutang
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_piutang_account_id,
    (SELECT name FROM accounts WHERE id = v_piutang_account_id),
    0, p_amount, 'Pelunasan piutang usaha', 2
  );
  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_retasi_atomic(uuid, text, text, text, text, date, text, text, jsonb, uuid, uuid, text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_retasi_atomic(p_branch_id uuid, p_driver_name text, p_helper_name text DEFAULT NULL::text, p_truck_number text DEFAULT NULL::text, p_route text DEFAULT NULL::text, p_departure_date date DEFAULT CURRENT_DATE, p_departure_time text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb, p_created_by uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_helper_name_2 text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_name_3 text DEFAULT NULL::text, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, retasi_id uuid, retasi_number text, retasi_ke integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_retasi_id UUID := gen_random_uuid();
  v_retasi_number TEXT;
  v_retasi_ke INTEGER;
  v_item RECORD;
BEGIN
  -- Validasi: Supir tidak boleh punya retasi aktif
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

  -- Generate Nomor Retasi
  v_retasi_number := 'RET-' || TO_CHAR(p_departure_date, 'YYYYMMDD') || '-' || TO_CHAR(NOW(), 'HH24MISS');

  -- Hitung Retasi Ke-berapa hari ini
  SELECT COALESCE(COUNT(*), 0) + 1 INTO v_retasi_ke
  FROM retasi
  WHERE driver_name = p_driver_name
    AND departure_date = p_departure_date
    AND (branch_id = p_branch_id OR branch_id IS NULL);

  -- Insert Header Retasi
  INSERT INTO retasi (
    id, branch_id, retasi_number, truck_number, driver_name,
    helper_id, helper_name, helper_id_2, helper_name_2, helper_id_3, helper_name_3,
    departure_date, departure_time, route, total_items, notes, retasi_ke, is_returned, created_by, created_at, updated_at
  ) VALUES (
    v_retasi_id, p_branch_id, v_retasi_number, p_truck_number, p_driver_name,
    p_helper_id, p_helper_name, p_helper_id_2, p_helper_name_2, p_helper_id_3, p_helper_name_3,
    p_departure_date, 
    CASE WHEN p_departure_time IS NOT NULL AND p_departure_time != '' THEN p_departure_time::TIME ELSE NULL END,
    p_route, 
    (SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) FROM jsonb_array_elements(p_items) AS item),
    p_notes, v_retasi_ke, FALSE, p_created_by, NOW(), NOW()
  );

  -- Insert Detail Item
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id UUID, product_name TEXT, quantity NUMERIC, weight NUMERIC, notes TEXT) LOOP
    INSERT INTO retasi_items (retasi_id, product_id, product_name, quantity, weight, notes, created_at)
    VALUES (v_retasi_id, v_item.product_id, v_item.product_name, v_item.quantity, v_item.weight, v_item.notes, NOW());
  END LOOP;

  RETURN QUERY SELECT TRUE, v_retasi_id, v_retasi_number, v_retasi_ke, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, NULL::INTEGER, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_sales_journal_rpc(uuid, text, date, numeric, numeric, text, numeric, numeric, boolean, numeric, numeric, boolean, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_sales_journal_rpc(p_branch_id uuid, p_transaction_id text, p_transaction_date date, p_total_amount numeric, p_paid_amount numeric DEFAULT 0, p_customer_name text DEFAULT 'Umum'::text, p_hpp_amount numeric DEFAULT 0, p_hpp_bonus_amount numeric DEFAULT 0, p_ppn_enabled boolean DEFAULT false, p_ppn_amount numeric DEFAULT 0, p_subtotal numeric DEFAULT 0, p_is_office_sale boolean DEFAULT false, p_payment_account_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, journal_id uuid, entry_number text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_line_number INTEGER := 1;
  v_cash_amount NUMERIC;
  v_credit_amount NUMERIC;
  v_revenue_amount NUMERIC;
  v_total_hpp NUMERIC;
  -- Account IDs
  v_kas_account_id UUID;
  v_piutang_account_id UUID;
  v_pendapatan_account_id UUID;
  v_hpp_account_id UUID;
  v_hpp_bonus_account_id UUID;
  v_persediaan_account_id UUID;
  v_hutang_bd_account_id UUID;
  v_ppn_account_id UUID;
BEGIN
  -- Validate branch
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;
  -- Calculate amounts
  v_cash_amount := LEAST(p_paid_amount, p_total_amount);
  v_credit_amount := p_total_amount - v_cash_amount;
  v_revenue_amount := CASE WHEN p_ppn_enabled AND p_subtotal > 0 THEN p_subtotal ELSE p_total_amount END;
  v_total_hpp := p_hpp_amount + p_hpp_bonus_amount;
  -- Get account IDs
  -- Kas account (use payment account if specified, otherwise default 1110)
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_pendapatan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '4100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5100' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hpp_bonus_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5210' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_persediaan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;
  SELECT id INTO v_hutang_bd_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2140' AND is_active = TRUE LIMIT 1;
  
  -- Fallback for 2140
  IF v_hutang_bd_account_id IS NULL THEN
    SELECT id INTO v_hutang_bd_account_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%Hutang Barang%' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ppn_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2130' AND is_active = TRUE LIMIT 1;
  -- Generate entry number
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  -- Create journal entry header
  INSERT INTO journal_entries (
    id,
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_branch_id,
    v_entry_number,
    p_transaction_date,
    'Penjualan ' ||
    CASE
      WHEN v_credit_amount > 0 AND v_cash_amount = 0 THEN 'Kredit'
      WHEN v_credit_amount > 0 AND v_cash_amount > 0 THEN 'Sebagian'
      ELSE 'Tunai'
    END || ' - ' || p_transaction_id || ' - ' || p_customer_name,
    'transaction',
    p_transaction_id,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Insert journal lines
  -- 1. Dr. Kas (if cash payment)
  IF v_cash_amount > 0 AND v_kas_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_kas_account_id,
      (SELECT name FROM accounts WHERE id = v_kas_account_id),
      v_cash_amount, 0, 'Penerimaan kas penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 2. Dr. Piutang (if credit)
  IF v_credit_amount > 0 AND v_piutang_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_piutang_account_id,
      (SELECT name FROM accounts WHERE id = v_piutang_account_id),
      v_credit_amount, 0, 'Piutang usaha', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 3. Cr. Pendapatan
  IF v_pendapatan_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_pendapatan_account_id,
      (SELECT name FROM accounts WHERE id = v_pendapatan_account_id),
      0, v_revenue_amount, 'Pendapatan penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 4. Cr. PPN Keluaran (if PPN enabled)
  IF p_ppn_enabled AND p_ppn_amount > 0 AND v_ppn_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_ppn_account_id,
      (SELECT name FROM accounts WHERE id = v_ppn_account_id),
      0, p_ppn_amount, 'PPN Keluaran', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 5. Dr. HPP (regular items)
  IF p_hpp_amount > 0 AND v_hpp_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_hpp_account_id,
      (SELECT name FROM accounts WHERE id = v_hpp_account_id),
      p_hpp_amount, 0, 'Harga Pokok Penjualan', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 6. Dr. HPP Bonus
  IF p_hpp_bonus_amount > 0 AND v_hpp_bonus_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (
      journal_entry_id, account_id, account_name,
      debit_amount, credit_amount, description, line_number
    ) VALUES (
      v_journal_id, v_hpp_bonus_account_id,
      (SELECT name FROM accounts WHERE id = v_hpp_bonus_account_id),
      p_hpp_bonus_amount, 0, 'HPP Bonus/Gratis', v_line_number
    );
    v_line_number := v_line_number + 1;
  END IF;
  -- 7. Cr. Persediaan or Hutang Barang Dagang
  IF v_total_hpp > 0 THEN
    IF p_is_office_sale THEN
      -- Office Sale: Cr. Persediaan (stok langsung berkurang)
      IF v_persediaan_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, account_name,
          debit_amount, credit_amount, description, line_number
        ) VALUES (
          v_journal_id, v_persediaan_account_id,
          (SELECT name FROM accounts WHERE id = v_persediaan_account_id),
          0, v_total_hpp, 'Pengurangan persediaan', v_line_number
        );
      END IF;
    ELSE
      -- Non-Office Sale: Cr. Hutang Barang Dagang (kewajiban kirim)
      IF v_hutang_bd_account_id IS NOT NULL THEN
        INSERT INTO journal_entry_lines (
          journal_entry_id, account_id, account_name,
          debit_amount, credit_amount, description, line_number
        ) VALUES (
          v_journal_id, v_hutang_bd_account_id,
          (SELECT name FROM accounts WHERE id = v_hutang_bd_account_id),
          0, v_total_hpp, 'Hutang barang dagang', v_line_number
        );
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, v_entry_number, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::TEXT, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_sales_journal_rpc(p_branch_id uuid, p_transaction_id text, p_transaction_date date, p_total_amount numeric, p_paid_amount numeric, p_customer_name text, p_hpp_amount numeric, p_hpp_bonus_amount numeric, p_ppn_enabled boolean, p_ppn_amount numeric, p_subtotal numeric, p_is_office_sale boolean, p_payment_account_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_sales_journal_rpc(p_branch_id uuid, p_transaction_id text, p_transaction_date date, p_total_amount numeric, p_paid_amount numeric, p_customer_name text, p_hpp_amount numeric, p_hpp_bonus_amount numeric, p_ppn_enabled boolean, p_ppn_amount numeric, p_subtotal numeric, p_is_office_sale boolean, p_payment_account_id uuid) IS 'Create sales journal entry atomically. Handles cash/credit split, HPP, PPN, and office sale logic.';


--
-- Name: create_tax_payment_atomic(uuid, text, numeric, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_tax_payment_atomic(p_branch_id uuid, p_period text, p_ppn_masukan_used numeric, p_ppn_keluaran_paid numeric, p_payment_account_id text, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, net_payment numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_reference_id TEXT;
  v_ppn_keluaran_account_id TEXT;
  v_ppn_masukan_account_id TEXT;
  v_net_payment NUMERIC;
  v_description TEXT;
  v_payment_date DATE := CURRENT_DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_ppn_keluaran_paid <= 0 AND p_ppn_masukan_used <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Jumlah PPN harus lebih dari 0'::TEXT;
    RETURN;
  END IF;
  IF p_payment_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun pembayaran harus dipilih'::TEXT;
    RETURN;
  END IF;
  -- ==================== LOOKUP ACCOUNTS ====================
  -- Find PPN Keluaran account (2130)
  SELECT id INTO v_ppn_keluaran_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%ppn%keluaran%' OR
    code = '2130'
  )
  AND is_header = FALSE
  AND branch_id = p_branch_id
  LIMIT 1;
  IF v_ppn_keluaran_account_id IS NULL THEN
    -- Try without branch filter (global accounts)
    SELECT id INTO v_ppn_keluaran_account_id
    FROM accounts
    WHERE (
      LOWER(name) LIKE '%ppn%keluaran%' OR
      code = '2130'
    )
    AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_ppn_keluaran_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun PPN Keluaran (2130) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Find PPN Masukan account (1230)
  SELECT id INTO v_ppn_masukan_account_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%ppn%masukan%' OR
    code = '1230'
  )
  AND is_header = FALSE
  AND branch_id = p_branch_id
  LIMIT 1;
  IF v_ppn_masukan_account_id IS NULL THEN
    -- Try without branch filter (global accounts)
    SELECT id INTO v_ppn_masukan_account_id
    FROM accounts
    WHERE (
      LOWER(name) LIKE '%ppn%masukan%' OR
      code = '1230'
    )
    AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_ppn_masukan_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Akun PPN Masukan (1230) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CALCULATE NET PAYMENT ====================
  -- Net payment = PPN Keluaran - PPN Masukan
  -- Jika positif, kita bayar ke negara
  -- Jika negatif, kita punya lebih bayar (kredit)
  v_net_payment := COALESCE(p_ppn_keluaran_paid, 0) - COALESCE(p_ppn_masukan_used, 0);
  -- ==================== BUILD DESCRIPTION & REFERENCE ====================
  v_description := 'Pembayaran PPN';
  IF p_period IS NOT NULL THEN
    v_description := v_description || ' periode ' || p_period;
  END IF;
  -- Create reference_id in format TAX-YYYYMM-xxx for period parsing
  -- Extract YYYYMM from period (handles both "2024-01" and "Januari 2024" formats)
  DECLARE
    v_year_month TEXT;
  BEGIN
    -- Try to match YYYY-MM format
    IF p_period ~ '^\d{4}-\d{2}$' THEN
      v_year_month := REPLACE(p_period, '-', '');
    ELSE
      -- Default to current month
      v_year_month := TO_CHAR(v_payment_date, 'YYYYMM');
    END IF;
    v_reference_id := 'TAX-' || v_year_month || '-' ||
                      LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  END;
  -- ==================== CREATE JOURNAL ENTRY ====================
  v_entry_number := 'JE-TAX-' || TO_CHAR(v_payment_date, 'YYYYMMDD') || '-' ||
                    LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    status,
    branch_id,
    created_by,
    created_at
  ) VALUES (
    v_entry_number,
    v_payment_date,
    CASE WHEN p_notes IS NOT NULL AND p_notes != ''
      THEN v_description || ' - ' || p_notes
      ELSE v_description
    END,
    'tax_payment',
    v_reference_id,
    TRUE,
    'posted',
    p_branch_id,
    'System',
    NOW()
  )
  RETURNING id INTO v_journal_id;
  -- ==================== JOURNAL LINE ITEMS ====================
  -- Jurnal Pembayaran PPN:
  -- Untuk mengOffset PPN Keluaran (liability) dan PPN Masukan (asset)
  --
  -- Dr PPN Keluaran (2130) - menghapus kewajiban
  -- Cr PPN Masukan (1230) - menghapus hak kredit
  -- Cr Kas - selisihnya (net payment)
  -- 1. Debit PPN Keluaran (mengurangi liability)
  IF p_ppn_keluaran_paid > 0 THEN
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_ppn_keluaran_account_id, p_ppn_keluaran_paid, 0,
      'Offset PPN Keluaran periode ' || COALESCE(p_period, ''));
  END IF;
  -- 2. Credit PPN Masukan (mengurangi asset/hak kredit)
  IF p_ppn_masukan_used > 0 THEN
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, v_ppn_masukan_account_id, 0, p_ppn_masukan_used,
      'Offset PPN Masukan periode ' || COALESCE(p_period, ''));
  END IF;
  -- 3. Kas - selisih pembayaran
  IF v_net_payment > 0 THEN
    -- Kita bayar ke negara (Credit Kas)
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, p_payment_account_id, 0, v_net_payment,
      'Pembayaran PPN ke negara periode ' || COALESCE(p_period, ''));
  ELSIF v_net_payment < 0 THEN
    -- Lebih bayar - record as Debit to Kas (refund or carry forward)
    INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_journal_id, p_payment_account_id, ABS(v_net_payment), 0,
      'Lebih bayar PPN periode ' || COALESCE(p_period, ''));
  END IF;
  -- ==================== UPDATE ACCOUNT BALANCES ====================
  -- Update PPN Keluaran balance (liability decreases = subtract from balance)
  IF p_ppn_keluaran_paid > 0 THEN
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - p_ppn_keluaran_paid,
        updated_at = NOW()
    WHERE id = v_ppn_keluaran_account_id;
  END IF;
  -- Update PPN Masukan balance (asset decreases = subtract from balance)
  IF p_ppn_masukan_used > 0 THEN
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - p_ppn_masukan_used,
        updated_at = NOW()
    WHERE id = v_ppn_masukan_account_id;
  END IF;
  -- Update Kas/Bank balance
  IF v_net_payment > 0 THEN
    -- Payment to government: decrease cash
    UPDATE accounts
    SET balance = COALESCE(balance, 0) - v_net_payment,
        updated_at = NOW()
    WHERE id = p_payment_account_id;
  ELSIF v_net_payment < 0 THEN
    -- Overpayment refund: increase cash
    UPDATE accounts
    SET balance = COALESCE(balance, 0) + ABS(v_net_payment),
        updated_at = NOW()
    WHERE id = p_payment_account_id;
  END IF;
  -- ==================== LOG ====================
  RAISE NOTICE '[Tax Payment] Journal % created. PPN Keluaran: %, PPN Masukan: %, Net: %',
    v_entry_number, p_ppn_keluaran_paid, p_ppn_masukan_used, v_net_payment;
  RETURN QUERY SELECT TRUE, v_journal_id, v_net_payment, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$_$;


--
-- Name: create_tax_payment_atomic(uuid, text, numeric, numeric, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_tax_payment_atomic(p_branch_id uuid, p_period text, p_ppn_masukan_used numeric DEFAULT 0, p_ppn_keluaran_paid numeric DEFAULT 0, p_payment_account_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, net_payment numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_net_payment NUMERIC;
  v_kas_account_id UUID;
  v_ppn_masukan_id UUID;
  v_ppn_keluaran_id UUID;
  v_entry_number TEXT;
  v_line_number INTEGER := 1;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  v_net_payment := p_ppn_keluaran_paid - p_ppn_masukan_used;

  IF v_net_payment <= 0 AND p_ppn_keluaran_paid = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, 'Tidak ada pajak untuk disetor'::TEXT;
    RETURN;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_ppn_masukan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1230' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_ppn_keluaran_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '2130' AND is_active = TRUE LIMIT 1;

  v_payment_id := gen_random_uuid();

  -- ==================== INSERT TAX PAYMENT RECORD ====================

  INSERT INTO tax_payments (
    id, branch_id, period, ppn_masukan_used, ppn_keluaran_paid,
    net_payment, payment_account_id, notes, created_by, created_at
  ) VALUES (
    v_payment_id, p_branch_id, p_period, p_ppn_masukan_used, p_ppn_keluaran_paid,
    v_net_payment, p_payment_account_id, p_notes, auth.uid(), NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE((SELECT COUNT(*) + 1 FROM journal_entries WHERE branch_id = p_branch_id AND DATE(created_at) = CURRENT_DATE), 1))::TEXT, 4, '0')
  INTO v_entry_number;

  INSERT INTO journal_entries (id, branch_id, entry_number, entry_date, description, reference_type, reference_id, status, is_voided, created_at, updated_at)
  VALUES (gen_random_uuid(), p_branch_id, v_entry_number, CURRENT_DATE, 'Setor Pajak Periode ' || p_period, 'tax_payment', v_payment_id::TEXT, 'posted', FALSE, NOW(), NOW())
  RETURNING id INTO v_journal_id;

  -- Dr. PPN Keluaran (mengurangi kewajiban)
  IF p_ppn_keluaran_paid > 0 AND v_ppn_keluaran_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_ppn_keluaran_id, (SELECT name FROM accounts WHERE id = v_ppn_keluaran_id), p_ppn_keluaran_paid, 0, 'Setor PPN Keluaran', v_line_number);
    v_line_number := v_line_number + 1;
  END IF;

  -- Cr. PPN Masukan (menggunakan kredit pajak)
  IF p_ppn_masukan_used > 0 AND v_ppn_masukan_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_ppn_masukan_id, (SELECT name FROM accounts WHERE id = v_ppn_masukan_id), 0, p_ppn_masukan_used, 'Kompensasi PPN Masukan', v_line_number);
    v_line_number := v_line_number + 1;
  END IF;

  -- Cr. Kas (pembayaran netto)
  IF v_net_payment > 0 AND v_kas_account_id IS NOT NULL THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, account_name, debit_amount, credit_amount, description, line_number)
    VALUES (v_journal_id, v_kas_account_id, (SELECT name FROM accounts WHERE id = v_kas_account_id), 0, v_net_payment, 'Pembayaran pajak', v_line_number);
  END IF;

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_net_payment, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_transaction_atomic(jsonb, jsonb, uuid, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_transaction_atomic(p_transaction jsonb, p_items jsonb, p_branch_id uuid, p_cashier_id uuid DEFAULT NULL::uuid, p_cashier_name text DEFAULT NULL::text, p_quotation_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, transaction_id text, total_hpp numeric, total_hpp_bonus numeric, journal_id uuid, items_count integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_transaction_id TEXT;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_total NUMERIC;
  v_paid_amount NUMERIC;
  v_payment_method TEXT;
  v_payment_account_id TEXT;
  v_is_office_sale BOOLEAN;
  v_date TIMESTAMPTZ;
  v_notes TEXT;
  v_sales_id UUID;
  v_sales_name TEXT;
  v_retasi_id UUID;
  v_retasi_number TEXT;

  v_item JSONB;
  v_product_id UUID;
  v_product_name TEXT;
  v_quantity NUMERIC;
  v_price NUMERIC;
  v_discount NUMERIC;
  v_is_bonus BOOLEAN;
  v_cost_price NUMERIC;
  v_unit TEXT;
  v_width NUMERIC;
  v_height NUMERIC;

  v_total_hpp NUMERIC := 0;
  v_total_hpp_bonus NUMERIC := 0;
  v_fifo_result RECORD;
  v_item_hpp NUMERIC;
  v_items_inserted INTEGER := 0;

  v_journal_id UUID;
  v_kas_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_piutang_account_id TEXT;
  v_pendapatan_account_id TEXT;
  v_hpp_account_id TEXT;
  v_hpp_bonus_account_id TEXT;
  v_persediaan_account_id TEXT;
  v_bahan_baku_account_id TEXT;
  v_item_type TEXT;
  v_material_id UUID;

  v_journal_lines JSONB := '[]'::JSONB;
  v_items_array JSONB := '[]'::JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_transaction IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0,
      'Transaction data is required'::TEXT;
    RETURN;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0,
      'Items are required'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE TRANSACTION DATA ====================

  v_transaction_id := COALESCE(
    p_transaction->>'id',
    'TRX-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 100000)::TEXT, 5, '0')
  );
  v_customer_id := (p_transaction->>'customer_id')::UUID;
  v_customer_name := p_transaction->>'customer_name';
  v_total := COALESCE((p_transaction->>'total')::NUMERIC, 0);
  v_paid_amount := COALESCE((p_transaction->>'paid_amount')::NUMERIC, 0);
  -- Normalize payment_method to valid values: cash, bank_transfer, check, digital_wallet
  v_payment_method := CASE LOWER(COALESCE(p_transaction->>'payment_method', 'cash'))
    WHEN 'tunai' THEN 'cash'
    WHEN 'cash' THEN 'cash'
    WHEN 'transfer' THEN 'bank_transfer'
    WHEN 'bank_transfer' THEN 'bank_transfer'
    WHEN 'bank' THEN 'bank_transfer'
    WHEN 'cek' THEN 'check'
    WHEN 'check' THEN 'check'
    WHEN 'giro' THEN 'check'
    WHEN 'digital' THEN 'digital_wallet'
    WHEN 'digital_wallet' THEN 'digital_wallet'
    WHEN 'e-wallet' THEN 'digital_wallet'
    ELSE 'cash'
  END;
  v_is_office_sale := COALESCE((p_transaction->>'is_office_sale')::BOOLEAN, FALSE);
  v_date := COALESCE((p_transaction->>'date')::TIMESTAMPTZ, NOW());
  v_notes := p_transaction->>'notes';
  v_sales_id := (p_transaction->>'sales_id')::UUID;
  v_sales_name := p_transaction->>'sales_name';
  v_payment_account_id := (p_transaction->>'payment_account_id')::TEXT;
  v_retasi_id := (p_transaction->>'retasi_id')::UUID;
  v_retasi_number := p_transaction->>'retasi_number';

  -- ==================== VALIDASI AKUN PEMBAYARAN ====================

  -- Jika ada pembayaran, akun pembayaran WAJIB dipilih
  IF v_paid_amount > 0 AND (v_payment_account_id IS NULL OR v_payment_account_id = '') THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0,
      'Akun pembayaran wajib dipilih jika ada pembayaran'::TEXT;
    RETURN;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  SELECT id INTO v_kas_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_piutang_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1210' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_pendapatan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '4100' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_hpp_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5100' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_hpp_bonus_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '5210' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_persediaan_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1310' AND is_active = TRUE LIMIT 1;

  SELECT id INTO v_bahan_baku_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1320' AND is_active = TRUE LIMIT 1;

  -- ==================== PROCESS ITEMS & CALCULATE HPP ====================

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Reset for each item
    v_product_id := NULL;
    v_material_id := NULL;
    
    v_product_name := v_item->>'product_name';
    v_quantity := COALESCE((v_item->>'quantity')::NUMERIC, 0);
    v_price := COALESCE((v_item->>'price')::NUMERIC, 0);
    v_discount := COALESCE((v_item->>'discount')::NUMERIC, 0);
    v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
    v_cost_price := COALESCE((v_item->>'cost_price')::NUMERIC, 0);
    v_unit := v_item->>'unit';
    v_width := (v_item->>'width')::NUMERIC;
    v_height := (v_item->>'height')::NUMERIC;
    v_item_type := v_item->>'product_type';

    -- Determine if this is a material or product based on ID prefix
    IF (v_item->>'product_id') LIKE 'material-%' THEN
      -- This is a material item
      v_material_id := (v_item->>'material_id')::UUID;
    ELSE
      -- This is a regular product
      v_product_id := (v_item->>'product_id')::UUID;
    END IF;

    -- Process based on type
    IF v_material_id IS NOT NULL AND v_quantity > 0 THEN
      -- MATERIAL: Consume material stock immediately (no delivery needed)
      SELECT * INTO v_fifo_result FROM consume_material_fifo_v2(
        v_material_id,
        v_quantity,
        v_transaction_id,
        'sale',
        p_branch_id
      );

      IF NOT v_fifo_result.success THEN
        RAISE EXCEPTION 'Gagal potong stok material: %', v_fifo_result.error_message;
      END IF;

      -- For materials, cost comes from material FIFO
      v_item_hpp := COALESCE(v_fifo_result.total_cost, v_cost_price * v_quantity);

      -- Accumulate HPP
      IF v_is_bonus THEN
        v_total_hpp_bonus := v_total_hpp_bonus + v_item_hpp;
      ELSE
        v_total_hpp := v_total_hpp + v_item_hpp;
      END IF;

      -- Build item for storage
      v_items_array := v_items_array || jsonb_build_object(
        'productId', COALESCE(v_product_id, v_material_id),
        'productName', v_product_name,
        'quantity', v_quantity,
        'price', v_price,
        'discount', v_discount,
        'isBonus', v_is_bonus,
        'costPrice', v_cost_price,
        'hppAmount', v_item_hpp,
        'productType', CASE WHEN v_material_id IS NOT NULL THEN 'material' ELSE 'product' END,
        'unit', v_unit,
        'width', v_width,
        'height', v_height
      );

      v_items_inserted := v_items_inserted + 1;

    ELSIF v_product_id IS NOT NULL AND v_quantity > 0 THEN
      -- PRODUCT: Calculate HPP using FIFO
      IF v_is_office_sale THEN
        -- Office Sale: Consume inventory immediately
        SELECT * INTO v_fifo_result FROM consume_stock_fifo_v2(
          v_product_id,
          v_quantity,
          v_transaction_id,
          'sale',
          p_branch_id
        );

        IF NOT v_fifo_result.success THEN
          RAISE EXCEPTION 'Gagal potong stok: %', v_fifo_result.error_message;
        END IF;

        v_item_hpp := v_fifo_result.total_hpp;
      ELSE
        -- Non-Office Sale: Calculate only (consume at delivery)
        SELECT f.total_hpp INTO v_item_hpp FROM calculate_fifo_cost(
          v_product_id,
          p_branch_id,
          v_quantity
        ) f;
        v_item_hpp := COALESCE(v_item_hpp, v_cost_price * v_quantity);
      END IF;

      -- Accumulate HPP
      IF v_is_bonus THEN
        v_total_hpp_bonus := v_total_hpp_bonus + v_item_hpp;
      ELSE
        v_total_hpp := v_total_hpp + v_item_hpp;
      END IF;

      -- Build item for storage
      v_items_array := v_items_array || jsonb_build_object(
        'productId', COALESCE(v_product_id, v_material_id),
        'productName', v_product_name,
        'quantity', v_quantity,
        'price', v_price,
        'discount', v_discount,
        'isBonus', v_is_bonus,
        'costPrice', v_cost_price,
        'hppAmount', v_item_hpp,
        'productType', CASE WHEN v_material_id IS NOT NULL THEN 'material' ELSE 'product' END,
        'unit', v_unit,
        'width', v_width,
        'height', v_height
      );

      v_items_inserted := v_items_inserted + 1;
    END IF;
  END LOOP;

  -- ==================== INSERT TRANSACTION ====================

  INSERT INTO transactions (
    id,
    branch_id,
    customer_id,
    customer_name,
    cashier_id,
    cashier_name,
    sales_id,
    sales_name,
    order_date,
    items,
    total,
    paid_amount,
    payment_status,
    payment_account_id,
    status,
    delivery_status,
    is_office_sale,
    notes,
    retasi_id,
    retasi_number,
    created_at,
    updated_at
  ) VALUES (
    v_transaction_id,
    p_branch_id,
    v_customer_id,
    v_customer_name,
    p_cashier_id,
    p_cashier_name,
    v_sales_id,
    v_sales_name,
    v_date,
    v_items_array,
    v_total,
    v_paid_amount,
    CASE WHEN v_paid_amount >= v_total THEN 'Lunas' ELSE 'Belum Lunas' END,
    v_payment_account_id,
    'Pesanan Masuk',
    CASE WHEN v_is_office_sale THEN 'Completed' ELSE 'Pending' END,
    v_is_office_sale,
    v_notes,
    v_retasi_id,
    v_retasi_number,
    NOW(),
    NOW()
  );

  -- ==================== INSERT PAYMENT RECORD ====================

  IF v_paid_amount > 0 THEN
    INSERT INTO transaction_payments (
      transaction_id,
      branch_id,
      amount,
      payment_method,
      payment_date,
      account_name,
      description,
      notes,
      paid_by_user_name,
      created_by,
      created_at
    ) VALUES (
      v_transaction_id,
      p_branch_id,
      v_paid_amount,
      v_payment_method,
      v_date,
      COALESCE(v_payment_method, 'Tunai'),
      'Pembayaran transaksi ' || v_transaction_id,
      'Initial Payment for ' || v_transaction_id,
      COALESCE(p_cashier_name, 'System'),
      p_cashier_id,
      NOW()
    );
  END IF;

  -- ==================== UPDATE QUOTATION IF EXISTS ====================

  IF p_quotation_id IS NOT NULL THEN
    UPDATE quotations
    SET transaction_id = v_transaction_id, status = 'Disetujui', updated_at = NOW()
    WHERE id = p_quotation_id;
  END IF;

  -- ==================== CREATE SALES JOURNAL ====================

  IF v_total > 0 THEN
    -- Build journal lines
    v_journal_lines := '[]'::JSONB;

    -- Debit: Kas atau Piutang
    IF v_paid_amount >= v_total THEN
      -- Lunas: Debit Kas (akun yang dipilih user)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_payment_account_id,
        'debit_amount', v_total,
        'credit_amount', 0,
        'description', 'Penerimaan kas dari penjualan'
      );
    ELSIF v_paid_amount > 0 THEN
      -- Bayar sebagian: Debit Kas (akun yang dipilih user) + Piutang
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_payment_account_id,
        'debit_amount', v_paid_amount,
        'credit_amount', 0,
        'description', 'Penerimaan kas dari penjualan'
      );
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '1210',
        'debit_amount', v_total - v_paid_amount,
        'credit_amount', 0,
        'description', 'Piutang usaha'
      );
    ELSE
      -- Belum bayar: Debit Piutang
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '1210',
        'debit_amount', v_total,
        'credit_amount', 0,
        'description', 'Piutang usaha'
      );
    END IF;

    -- Credit: Pendapatan
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '4100',
      'debit_amount', 0,
      'credit_amount', v_total,
      'description', 'Pendapatan penjualan'
    );

    -- Debit: HPP (regular items)
    IF v_total_hpp > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '5100',
        'debit_amount', v_total_hpp,
        'credit_amount', 0,
        'description', 'Harga Pokok Penjualan'
      );
    END IF;

    -- Debit: HPP Bonus (bonus items)
    IF v_total_hpp_bonus > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '5210',
        'debit_amount', v_total_hpp_bonus,
        'credit_amount', 0,
        'description', 'HPP Bonus/Gratis'
      );
    END IF;

    -- Credit: Persediaan (office sale) or Modal Barang Dagang Tertahan (non-office sale)
    IF (v_total_hpp + v_total_hpp_bonus) > 0 THEN
      IF v_is_office_sale THEN
        -- Office Sale: Credit langsung ke Persediaan (stok langsung berkurang)
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', '1310',
          'debit_amount', 0,
          'credit_amount', v_total_hpp + v_total_hpp_bonus,
          'description', 'Pengurangan persediaan'
        );
      ELSE
        -- Non-Office Sale: Credit ke Modal Barang Dagang Tertahan (kewajiban kirim)
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_code', '2140',
          'debit_amount', 0,
          'credit_amount', v_total_hpp + v_total_hpp_bonus,
          'description', 'Modal barang dagang tertahan (belum dikirim)'
        );
      END IF;
    END IF;

    -- Create journal using existing RPC
    -- Note: Cast v_date::DATE because create_journal_atomic expects DATE, not TIMESTAMPTZ
    SELECT * INTO v_fifo_result FROM create_journal_atomic(
      p_branch_id,
      v_date::DATE,
      'Penjualan ke ' || COALESCE(v_customer_name, 'Umum') || ' - ' || v_transaction_id,
      'transaction',
      v_transaction_id,
      v_journal_lines,
      TRUE
    );

    IF v_fifo_result.success THEN
      v_journal_id := v_fifo_result.journal_id;
    END IF;
  END IF;

  -- ==================== GENERATE SALES COMMISSION ====================

  IF v_sales_id IS NOT NULL AND v_total > 0 THEN
    BEGIN
      INSERT INTO commission_entries (
        employee_id,
        transaction_id,
        delivery_id,
        product_id,
        quantity,
        amount,
        commission_type,
        status,
        branch_id,
        entry_date,
        created_at
      )
      SELECT
        v_sales_id,
        v_transaction_id,
        NULL,
        (item->>'productId')::UUID,
        (item->>'quantity')::NUMERIC,
        COALESCE(
          (SELECT cr.amount FROM commission_rules cr
           WHERE cr.product_id = (item->>'productId')::UUID
           AND cr.role = 'sales'
           AND cr.is_active = TRUE LIMIT 1),
          0
        ) * (item->>'quantity')::NUMERIC,
        'sales',
        'pending',
        p_branch_id,
        v_date,
        NOW()
      FROM jsonb_array_elements(v_items_array) AS item
      WHERE (item->>'isBonus')::BOOLEAN IS NOT TRUE
        AND (item->>'quantity')::NUMERIC > 0;
    EXCEPTION WHEN OTHERS THEN
      -- Commission generation failed, but don't fail the transaction
      NULL;
    END;
  END IF;

  -- ==================== MARK CUSTOMER AS VISITED ====================

  IF v_customer_id IS NOT NULL THEN
    BEGIN
      UPDATE customers
      SET
        last_transaction_date = NOW(),
        last_visited_at = NOW(),
        last_visited_by = p_cashier_id,
        updated_at = NOW()
      WHERE id = v_customer_id;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT
    TRUE,
    v_transaction_id,
    v_total_hpp,
    v_total_hpp_bonus,
    v_journal_id,
    v_items_inserted,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, 0::NUMERIC, 0::NUMERIC, NULL::UUID, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_transaction_atomic(p_transaction jsonb, p_items jsonb, p_branch_id uuid, p_cashier_id uuid, p_cashier_name text, p_quotation_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_transaction_atomic(p_transaction jsonb, p_items jsonb, p_branch_id uuid, p_cashier_id uuid, p_cashier_name text, p_quotation_id text) IS 'Create transaction atomic dengan FIFO HPP calculation, journal, dan commission. WAJIB branch_id.';


--
-- Name: create_transfer_journal_rpc(uuid, text, date, numeric, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_transfer_journal_rpc(p_branch_id uuid, p_transfer_id text, p_transfer_date date, p_amount numeric, p_from_account_id text, p_to_account_id text, p_description text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_from_account RECORD;
  v_to_account RECORD;
BEGIN
  -- VALIDASI
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Amount must be greater than 0'::TEXT;
    RETURN;
  END IF;

  IF p_from_account_id IS NULL OR p_to_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'From and To accounts are required'::TEXT;
    RETURN;
  END IF;

  IF p_from_account_id = p_to_account_id THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Cannot transfer to same account'::TEXT;
    RETURN;
  END IF;

  -- GET ACCOUNT INFO
  SELECT id, code, name INTO v_from_account FROM accounts WHERE id = p_from_account_id;
  SELECT id, code, name INTO v_to_account FROM accounts WHERE id = p_to_account_id;

  IF v_from_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun asal tidak ditemukan: ' || p_from_account_id::TEXT;
    RETURN;
  END IF;

  IF v_to_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun tujuan tidak ditemukan: ' || p_to_account_id::TEXT;
    RETURN;
  END IF;

  -- GENERATE ENTRY NUMBER (GLOBAL SEQUENCE)
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;

  -- CREATE JOURNAL ENTRY
  INSERT INTO journal_entries (
    id, branch_id, entry_number, entry_date, description,
    reference_type, reference_id, status, is_voided, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_branch_id, v_entry_number, p_transfer_date,
    COALESCE(p_description, 'Transfer dari ' || v_from_account.name || ' ke ' || v_to_account.name),
    'transfer', p_transfer_id, 'posted', FALSE, NOW(), NOW()
  ) RETURNING id INTO v_journal_id;

  -- Dr. Akun Tujuan (kas bertambah)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_to_account_id, v_to_account.code, v_to_account.name,
    p_amount, 0, 'Transfer masuk dari ' || v_from_account.name, 1
  );

  -- Cr. Akun Asal (kas berkurang)
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_code, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, p_from_account_id, v_from_account.code, v_from_account.name,
    0, p_amount, 'Transfer keluar ke ' || v_to_account.name, 2
  );

  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: create_zakat_cash_entry(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_zakat_cash_entry() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_account_name TEXT;
    v_cash_history_id TEXT;
BEGIN
    -- Only create cash entry if status is 'paid' and payment account is specified
    IF NEW.status = 'paid' AND NEW.payment_account_id IS NOT NULL AND NEW.cash_history_id IS NULL THEN
        -- Get account name
        SELECT name INTO v_account_name FROM accounts WHERE id = NEW.payment_account_id;
        -- Generate cash history ID
        v_cash_history_id := 'CH-ZAKAT-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT;
        -- Insert into cash_history
        INSERT INTO cash_history (
            id,
            account_id,
            account_name,
            amount,
            type,
            description,
            reference_type,
            reference_id,
            reference_name,
            created_at
        ) VALUES (
            v_cash_history_id,
            NEW.payment_account_id,
            v_account_name,
            NEW.amount,
            CASE
                WHEN NEW.category = 'zakat' THEN 'zakat'
                ELSE 'sedekah'
            END,
            NEW.title || COALESCE(' - ' || NEW.description, ''),
            CASE
                WHEN NEW.category = 'zakat' THEN 'zakat'
                ELSE 'charity'
            END,
            NEW.id,
            NEW.title,
            NEW.payment_date
        );
        -- Update the zakat record with cash_history_id
        NEW.cash_history_id := v_cash_history_id;
        -- Update account balance
        UPDATE accounts
        SET balance = balance - NEW.amount
        WHERE id = NEW.payment_account_id;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: create_zakat_payment_atomic(jsonb, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_zakat_payment_atomic(p_zakat jsonb, p_branch_id uuid, p_created_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, zakat_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_zakat_id UUID;
  v_journal_id UUID;
  v_amount NUMERIC;
  v_zakat_type TEXT;
  v_payment_date DATE;
  v_recipient TEXT;
  v_notes TEXT;
  v_payment_account_id UUID;
  v_kas_account_id UUID;
  v_beban_zakat_id UUID;
  v_entry_number TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- ==================== PARSE DATA ====================
  v_zakat_id := COALESCE((p_zakat->>'id')::UUID, gen_random_uuid());
  v_amount := COALESCE((p_zakat->>'amount')::NUMERIC, 0);
  v_zakat_type := COALESCE(p_zakat->>'zakat_type', 'maal'); -- maal, fitrah, profesi
  v_payment_date := COALESCE((p_zakat->>'payment_date')::DATE, CURRENT_DATE);
  v_recipient := COALESCE(p_zakat->>'recipient', 'Lembaga Amil Zakat');
  v_notes := p_zakat->>'notes';
  v_payment_account_id := (p_zakat->>'payment_account_id')::UUID;
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  -- Kas account
  IF v_payment_account_id IS NOT NULL THEN
    v_kas_account_id := v_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Beban Zakat (6xxx - Beban Operasional, atau buat khusus 6500)
  SELECT id INTO v_beban_zakat_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6500' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Zakat"
  IF v_beban_zakat_id IS NULL THEN
    SELECT id INTO v_beban_zakat_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%zakat%' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Lain-lain (8100)
  IF v_beban_zakat_id IS NULL THEN
    SELECT id INTO v_beban_zakat_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '8100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_zakat_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun Kas atau Beban Zakat tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== INSERT ZAKAT RECORD ====================
  INSERT INTO zakat_payments (
    id,
    branch_id,
    amount,
    zakat_type,
    payment_date,
    recipient,
    notes,
    status,
    created_by,
    created_at,
    updated_at
  ) VALUES (
    v_zakat_id,
    p_branch_id,
    v_amount,
    v_zakat_type,
    v_payment_date,
    v_recipient,
    v_notes,
    'paid',
    p_created_by,
    NOW(),
    NOW()
  );
  -- ==================== CREATE JOURNAL ENTRY ====================
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  INSERT INTO journal_entries (
    id,
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_branch_id,
    v_entry_number,
    v_payment_date,
    'Pembayaran Zakat ' || INITCAP(v_zakat_type) || ' - ' || v_recipient,
    'zakat',
    v_zakat_id::TEXT,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Beban Zakat
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_zakat_id,
    (SELECT name FROM accounts WHERE id = v_beban_zakat_id),
    v_amount, 0, 'Beban Zakat ' || INITCAP(v_zakat_type), 1
  );
  -- Cr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    0, v_amount, 'Pengeluaran kas untuk zakat', 2
  );
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_zakat_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION create_zakat_payment_atomic(p_zakat jsonb, p_branch_id uuid, p_created_by uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.create_zakat_payment_atomic(p_zakat jsonb, p_branch_id uuid, p_created_by uuid) IS 'Create zakat payment with auto journal. Dr. Beban Zakat, Cr. Kas.';


--
-- Name: deactivate_employee(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deactivate_employee(employee_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    UPDATE profiles 
    SET status = 'Tidak Aktif', 
        updated_at = NOW()
    WHERE id = employee_id;
END;
$$;


--
-- Name: debug_rls_check(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.debug_rls_check(p_target_branch_id uuid) RETURNS TABLE(user_id uuid, user_role text, user_branch_id uuid, user_allowed_branches uuid[], target_branch_id uuid, is_owner_admin boolean, matches_primary boolean, matches_allowed boolean, final_result boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_role text;
    v_user_branch_id uuid;
    v_allowed_branches uuid[];
    v_is_owner_admin boolean;
    v_matches_primary boolean;
    v_matches_allowed boolean;
BEGIN
    -- Get user details
    SELECT role, branch_id, allowed_branches 
    INTO v_role, v_user_branch_id, v_allowed_branches
    FROM public.profiles
    WHERE id = auth.uid();

    -- Check Logic
    v_is_owner_admin := lower(v_role) IN ('owner', 'admin', 'superadmin', 'administrator');
    v_matches_primary := (v_user_branch_id = p_target_branch_id);
    
    IF v_allowed_branches IS NOT NULL THEN
        v_matches_allowed := (p_target_branch_id = ANY(v_allowed_branches));
    ELSE
        v_matches_allowed := false;
    END IF;

    RETURN QUERY SELECT 
        auth.uid(),
        v_role,
        v_user_branch_id,
        v_allowed_branches,
        p_target_branch_id,
        v_is_owner_admin,
        v_matches_primary,
        v_matches_allowed,
        (v_is_owner_admin OR v_matches_primary OR v_matches_allowed);
END;
$$;


--
-- Name: deduct_materials_for_transaction(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.deduct_materials_for_transaction(p_transaction_id text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  item_record jsonb;
  material_record jsonb;
  material_id_uuid uuid;
  quantity_to_deduct numeric;
BEGIN
  FOR item_record IN (SELECT jsonb_array_elements(items) FROM public.transactions WHERE id = p_transaction_id)
  LOOP
    IF item_record -> 'product' ->> 'materials' IS NOT NULL THEN
      FOR material_record IN (SELECT jsonb_array_elements(item_record -> 'product' -> 'materials'))
      LOOP
        material_id_uuid := (material_record ->> 'materialId')::uuid;
        quantity_to_deduct := (material_record ->> 'quantity')::numeric * (item_record ->> 'quantity')::numeric;
        UPDATE public.materials
        SET stock = stock - quantity_to_deduct
        WHERE id = material_id_uuid;
      END LOOP;
    END IF;
  END LOOP;
END;
$$;


--
-- Name: delete_account(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_account(p_account_id text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_has_transactions BOOLEAN;
  v_has_children BOOLEAN;
BEGIN
  -- Cek Transactions
  SELECT EXISTS (
    SELECT 1 FROM journal_entry_lines WHERE account_id = p_account_id
  ) INTO v_has_transactions;

  IF v_has_transactions THEN
    RETURN QUERY SELECT FALSE, 'Cannot delete account with existing transactions. Deactivate it instead.';
    RETURN;
  END IF;

  -- Cek Children
  SELECT EXISTS (
    SELECT 1 FROM accounts WHERE parent_id = p_account_id
  ) INTO v_has_children;

  IF v_has_children THEN
    RETURN QUERY SELECT FALSE, 'Cannot delete account with sub-accounts';
    RETURN;
  END IF;

  DELETE FROM accounts WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM;
END;
$$;


--
-- Name: delete_accounts_payable_atomic(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_accounts_payable_atomic(p_payable_id text, p_branch_id uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE v_journals_voided INTEGER := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM accounts_payable_payments WHERE accounts_payable_id = p_payable_id) THEN RETURN QUERY SELECT FALSE, 0, 'Ada pembayaran'::TEXT; RETURN; END IF;
  UPDATE journal_entries SET is_voided = TRUE, voided_at = NOW(), voided_reason = 'AP Deleted', status = 'voided' WHERE reference_id = p_payable_id AND reference_type = 'payable' AND branch_id = p_branch_id AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  DELETE FROM accounts_payable WHERE id = p_payable_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: delete_asset_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_asset_atomic(p_asset_id uuid, p_branch_id uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Check asset exists
  IF NOT EXISTS (
    SELECT 1 FROM assets WHERE id = p_asset_id AND branch_id = p_branch_id
  ) THEN
    RETURN QUERY SELECT FALSE, 0, 'Asset not found'::TEXT;
    RETURN;
  END IF;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Asset deleted',
    updated_at = NOW()
  WHERE reference_id = p_asset_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== DELETE ASSET ====================
  DELETE FROM assets WHERE id = p_asset_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION delete_asset_atomic(p_asset_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_asset_atomic(p_asset_id uuid, p_branch_id uuid) IS 'Delete asset dan void journal terkait. WAJIB branch_id.';


--
-- Name: delete_expense_atomic(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_expense_atomic(p_expense_id text, p_branch_id uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Check expense exists
  IF NOT EXISTS (
    SELECT 1 FROM expenses WHERE id = p_expense_id AND branch_id = p_branch_id
  ) THEN
    RETURN QUERY SELECT FALSE, 0, 'Expense not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNALS ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Expense deleted',
    status = 'voided',
    updated_at = NOW()
  WHERE reference_id = p_expense_id
    AND reference_type = 'expense'
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE EXPENSE ====================

  DELETE FROM expenses WHERE id = p_expense_id AND branch_id = p_branch_id;

  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION delete_expense_atomic(p_expense_id text, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_expense_atomic(p_expense_id text, p_branch_id uuid) IS 'Delete expense dan void journal terkait. WAJIB branch_id.';


--
-- Name: delete_po_atomic(text, uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_po_atomic(p_po_id text, p_branch_id uuid, p_skip_validation boolean DEFAULT false) RETURNS TABLE(success boolean, batches_deleted integer, stock_rolled_back integer, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_po RECORD;
  v_batch RECORD;
  v_batches_deleted INTEGER := 0;
  v_stock_rolled_back INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_current_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

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

  -- Get PO info
  SELECT id, status INTO v_po
  FROM purchase_orders
  WHERE id = p_po_id AND branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== CHECK IF BATCHES USED ====================
  IF NOT p_skip_validation THEN
    -- Check if any batch has been used (remaining < initial)
    IF EXISTS (
      SELECT 1 FROM inventory_batches
      WHERE purchase_order_id = p_po_id
        AND remaining_quantity < initial_quantity
    ) THEN
      RETURN QUERY SELECT FALSE, 0, 0, 0,
        'Tidak dapat menghapus PO karena batch inventory sudah terpakai (FIFO)'::TEXT;
      RETURN;
    END IF;

    -- Check if any payable has been paid
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

  -- ==================== VOID JOURNALS ====================

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

  -- ==================== ROLLBACK STOCK FROM BATCHES ====================

  FOR v_batch IN
    SELECT id, material_id, product_id, remaining_quantity
    FROM inventory_batches
    WHERE purchase_order_id = p_po_id
  LOOP
    -- Rollback material stock
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

    -- products.current_stock is DEPRECATED - deleting batch auto-updates via VIEW
    IF v_batch.product_id IS NOT NULL THEN
      v_stock_rolled_back := v_stock_rolled_back + 1;
    END IF;

    v_batches_deleted := v_batches_deleted + 1;
  END LOOP;

  -- ==================== DELETE RELATED RECORDS ====================

  -- Delete inventory batches
  DELETE FROM inventory_batches WHERE purchase_order_id = p_po_id;

  -- Delete material movements
  DELETE FROM material_stock_movements
  WHERE reference_id = p_po_id
    AND reference_type = 'purchase_order';

  -- Delete accounts payable
  DELETE FROM accounts_payable WHERE purchase_order_id = p_po_id;

  -- Delete PO items
  DELETE FROM purchase_order_items WHERE purchase_order_id = p_po_id;

  -- Delete PO
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
$$;


--
-- Name: FUNCTION delete_po_atomic(p_po_id text, p_branch_id uuid, p_skip_validation boolean); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.delete_po_atomic(p_po_id text, p_branch_id uuid, p_skip_validation boolean) IS 'Atomic PO delete: validate + rollback stock + void journals + delete records. WAJIB branch_id.';


--
-- Name: delete_transaction_cascade(text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_transaction_cascade(p_transaction_id text, p_deleted_by uuid DEFAULT NULL::uuid, p_reason text DEFAULT 'Manual deletion'::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Soft delete payments
  UPDATE transaction_payments 
  SET status = 'deleted', cancelled_at = NOW(), cancelled_by = p_deleted_by,
      cancelled_reason = 'Transaction deleted: ' || p_reason
  WHERE transaction_id = p_transaction_id AND status = 'active';
  
  -- Delete main transaction (items are stored as JSONB, no separate table)
  DELETE FROM transactions WHERE id = p_transaction_id;
  
  RETURN TRUE;
END;
$$;


--
-- Name: delete_zakat_record_atomic(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_zakat_record_atomic(p_branch_id uuid, p_zakat_id text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Void Journals
  UPDATE journal_entries
  SET is_voided = TRUE, status = 'voided', voided_reason = 'Zakat record deleted'
  WHERE reference_id = p_zakat_id AND reference_type = 'zakat' AND is_voided = FALSE;
  -- Delete Record
  DELETE FROM zakat_records WHERE id = p_zakat_id AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: demo_balance_sheet(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_balance_sheet() RETURNS TABLE(section text, code character varying, account_name text, amount numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  -- ASET
  SELECT 
    'ASET' as section,
    a.code,
    a.name as account_name,
    a.balance as amount
  FROM public.accounts a
  WHERE a.type = 'ASET' 
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
  
  UNION ALL
  
  -- KEWAJIBAN
  SELECT 
    'KEWAJIBAN' as section,
    a.code,
    a.name as account_name, 
    a.balance as amount
  FROM public.accounts a
  WHERE a.type = 'KEWAJIBAN'
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
    
  UNION ALL
  
  -- MODAL
  SELECT 
    'MODAL' as section,
    a.code,
    a.name as account_name,
    a.balance as amount  
  FROM public.accounts a
  WHERE a.type = 'MODAL'
    AND a.is_header = false
    AND a.is_active = true
    AND a.code IS NOT NULL
    
  ORDER BY section, code;
END;
$$;


--
-- Name: demo_show_chart_of_accounts(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_show_chart_of_accounts() RETURNS TABLE(level_indent text, code character varying, account_name text, account_type text, normal_bal character varying, current_balance numeric, is_header_account boolean)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    REPEAT('  ', a.level - 1) || 
    CASE 
      WHEN a.is_header THEN '???? '
      ELSE '???? '
    END as level_indent,
    a.code,
    a.name as account_name,
    a.type as account_type,
    a.normal_balance as normal_bal,
    a.balance as current_balance,
    a.is_header as is_header_account
  FROM public.accounts a
  WHERE a.is_active = true
    AND (a.code IS NOT NULL OR a.id LIKE 'acc-%')
  ORDER BY a.sort_order, a.code;
END;
$$;


--
-- Name: demo_trial_balance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.demo_trial_balance() RETURNS TABLE(code character varying, account_name text, debit_balance numeric, credit_balance numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.code,
    a.name as account_name,
    CASE 
      WHEN a.normal_balance = 'DEBIT' AND a.balance >= 0 THEN a.balance
      WHEN a.normal_balance = 'DEBIT' AND a.balance < 0 THEN 0
      WHEN a.normal_balance = 'CREDIT' AND a.balance < 0 THEN ABS(a.balance)
      ELSE 0
    END as debit_balance,
    CASE 
      WHEN a.normal_balance = 'CREDIT' AND a.balance >= 0 THEN a.balance  
      WHEN a.normal_balance = 'CREDIT' AND a.balance < 0 THEN 0
      WHEN a.normal_balance = 'DEBIT' AND a.balance < 0 THEN ABS(a.balance)
      ELSE 0
    END as credit_balance
  FROM public.accounts a
  WHERE a.is_active = true 
    AND a.is_header = false
    AND a.code IS NOT NULL
    AND a.balance != 0
  ORDER BY a.code;
END;
$$;


--
-- Name: disable_rls(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.disable_rls(table_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Check if user has permission (only owner role)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owner can manage RLS settings';
  END IF;
  -- Disable RLS on the specified table
  EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', table_name);
  
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to disable RLS on table %: %', table_name, SQLERRM;
END;
$$;


--
-- Name: driver_has_unreturned_retasi(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.driver_has_unreturned_retasi(driver text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: enable_audit_for_table(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enable_audit_for_table(target_table text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  trigger_name text;
BEGIN
  trigger_name := 'audit_trigger_' || target_table;
  EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', trigger_name, target_table);
  EXECUTE format(
    'CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_trigger_func()',
    trigger_name, target_table
  );
  RAISE NOTICE 'Audit trigger enabled for table: %', target_table;
END;
$$;


--
-- Name: enable_rls(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enable_rls(table_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Check if user has permission (only owner role)
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() 
    AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'Only owner can manage RLS settings';
  END IF;
  -- Enable RLS on the specified table
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
  
  RETURN true;
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'Failed to enable RLS on table %: %', table_name, SQLERRM;
END;
$$;


--
-- Name: execute_closing_entry_atomic(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.execute_closing_entry_atomic(p_branch_id uuid, p_year integer) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_total_revenue NUMERIC := 0;
  v_total_expense NUMERIC := 0;
  v_net_income NUMERIC := 0;
  v_laba_ditahan_id TEXT;
  v_ikhtisar_id TEXT;
BEGIN
  -- Validasi
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;
  -- Cek apakah sudah ada closing entry untuk tahun ini
  IF EXISTS (
    SELECT 1 FROM journal_entries 
    WHERE branch_id = p_branch_id 
      AND reference_type = 'closing_entry' 
      AND EXTRACT(YEAR FROM entry_date) = p_year
      AND voided = FALSE
  ) THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, format('Tutup buku tahun %s sudah ada', p_year)::TEXT;
    RETURN;
  END IF;
  -- Get account IDs
  SELECT id INTO v_laba_ditahan_id FROM accounts WHERE code = '3200' AND branch_id = p_branch_id LIMIT 1;
  SELECT id INTO v_ikhtisar_id FROM accounts WHERE code = '3900' AND branch_id = p_branch_id LIMIT 1;
  IF v_laba_ditahan_id IS NULL THEN
    -- Create Laba Ditahan account if not exists
    INSERT INTO accounts (id, code, name, type, category, branch_id)
    VALUES ('acc-3200-' || p_branch_id, '3200', 'Laba Ditahan', 'Equity', 'Laba Ditahan', p_branch_id)
    RETURNING id INTO v_laba_ditahan_id;
  END IF;
  -- Calculate totals from journal_entry_lines for the year
  SELECT 
    COALESCE(SUM(CASE WHEN a.type = 'Revenue' THEN jel.credit - jel.debit ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN a.type = 'Expense' THEN jel.debit - jel.credit ELSE 0 END), 0)
  INTO v_total_revenue, v_total_expense
  FROM journal_entry_lines jel
  JOIN journal_entries je ON je.id = jel.journal_entry_id
  JOIN accounts a ON a.id = jel.account_id
  WHERE je.branch_id = p_branch_id
    AND EXTRACT(YEAR FROM je.entry_date) = p_year
    AND je.status = 'Posted'
    AND je.voided = FALSE
    AND a.type IN ('Revenue', 'Expense');
  v_net_income := v_total_revenue - v_total_expense;
  -- Generate entry number
  v_entry_number := 'CLS-' || p_year || '-' || LPAD(EXTRACT(EPOCH FROM NOW())::BIGINT % 10000::TEXT, 4, '0');
  -- Create closing journal entry
  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, branch_id, created_at
  ) VALUES (
    v_entry_number,
    make_date(p_year, 12, 31),
    format('Jurnal Penutup Tahun %s - Laba Bersih: %s', p_year, v_net_income),
    'closing_entry',
    'CLOSING-' || p_year,
    'Posted',
    p_branch_id,
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Create journal lines
  IF v_net_income >= 0 THEN
    -- Laba: Dr. Ikhtisar L/R, Cr. Laba Ditahan
    IF v_ikhtisar_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
      VALUES (v_journal_id, v_ikhtisar_id, v_net_income, 0);
    END IF;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
    VALUES (v_journal_id, v_laba_ditahan_id, 0, v_net_income);
  ELSE
    -- Rugi: Dr. Laba Ditahan, Cr. Ikhtisar L/R
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
    VALUES (v_journal_id, v_laba_ditahan_id, ABS(v_net_income), 0);
    IF v_ikhtisar_id IS NOT NULL THEN
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit) 
      VALUES (v_journal_id, v_ikhtisar_id, 0, ABS(v_net_income));
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: generate_delivery_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_delivery_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  next_number INTEGER;
BEGIN
  -- Get the next delivery number for this transaction
  SELECT COALESCE(MAX(delivery_number), 0) + 1 
  INTO next_number
  FROM deliveries 
  WHERE transaction_id = NEW.transaction_id;
  
  -- Set the delivery number
  NEW.delivery_number = next_number;
  
  RETURN NEW;
END;
$$;


--
-- Name: generate_journal_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_journal_number() RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
    current_year TEXT;
    next_number INTEGER;
    new_entry_number TEXT;
BEGIN
    current_year := EXTRACT(YEAR FROM CURRENT_DATE)::TEXT;
    -- Get next sequence number for this year
    SELECT COALESCE(MAX(
        CAST(SUBSTRING(entry_number FROM 'JE-' || current_year || '-(\d+)') AS INTEGER)
    ), 0) + 1
    INTO next_number
    FROM public.journal_entries
    WHERE entry_number LIKE 'JE-' || current_year || '-%';
    -- Format: JE-2024-000001
    new_entry_number := 'JE-' || current_year || '-' || LPAD(next_number::TEXT, 6, '0');
    RETURN new_entry_number;
END;
$$;


--
-- Name: generate_journal_number(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_journal_number(entry_date date) RETURNS text
    LANGUAGE plpgsql
    AS $$
DECLARE
  date_str TEXT;
  sequence_num INTEGER;
  journal_number TEXT;
BEGIN
  -- Format: MJE-YYYYMMDD-XXX (Manual Journal Entry)
  date_str := to_char(entry_date, 'YYYYMMDD');
  
  -- Get next sequence for this date
  SELECT COALESCE(MAX(
    CAST(
      SUBSTRING(journal_number FROM 'MJE-\d{8}-(\d+)') AS INTEGER
    )
  ), 0) + 1
  INTO sequence_num
  FROM public.manual_journal_entries
  WHERE journal_number LIKE 'MJE-' || date_str || '-%';
  
  -- Generate journal number
  journal_number := 'MJE-' || date_str || '-' || LPAD(sequence_num::TEXT, 3, '0');
  
  RETURN journal_number;
END;
$$;


--
-- Name: generate_retasi_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_retasi_number() RETURNS text
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: generate_supplier_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_supplier_code() RETURNS character varying
    LANGUAGE plpgsql
    AS $_$
DECLARE
  new_code VARCHAR(20);
  counter INTEGER;
BEGIN
  -- Get the current max number from existing codes
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)), 0) + 1
  INTO counter
  FROM suppliers
  WHERE code ~ '^SUP[0-9]+$';
  
  -- Generate new code
  new_code := 'SUP' || LPAD(counter::TEXT, 4, '0');
  
  RETURN new_code;
END;
$_$;


--
-- Name: generate_unique_quotation_number(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.generate_unique_quotation_number(p_branch_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_date_str text;
    v_sequence int;
    v_quotation_number text;
    v_exists boolean;
    v_start_of_day timestamptz;
    v_count int;
    v_attempts int := 0;
    v_max_attempts int := 50;
BEGIN
    -- Get current date formatted as YYYYMMDD
    v_date_str := to_char(now(), 'YYYYMMDD');
    v_start_of_day := date_trunc('day', now());
    
    -- Count existing quotations for this branch today to calculate starting sequence
    -- We count ALL quotations for this branch regardless of RLS because we are SECURITY DEFINER
    SELECT count(*) INTO v_count
    FROM public.quotations
    WHERE branch_id = p_branch_id
    AND created_at >= v_start_of_day;
    
    v_sequence := v_count + 1;
    
    LOOP
        -- Format: QT-YYYYMMDD-XXXX
        v_quotation_number := 'QT-' || v_date_str || '-' || lpad(v_sequence::text, 4, '0');
        
        -- Check for global uniqueness (across all branches)
        -- This checks the 'id' column which is the PK and stores the quotation number
        SELECT EXISTS (
            SELECT 1 FROM public.quotations WHERE id = v_quotation_number
        ) INTO v_exists;
        
        -- If unique, return it
        IF NOT v_exists THEN
            RETURN v_quotation_number;
        END IF;
        
        -- If collision, increment sequence and retry
        v_sequence := v_sequence + 1;
        v_attempts := v_attempts + 1;
        
        -- Fallback to avoid infinite loops
        IF v_attempts > v_max_attempts THEN
             -- Append timestamp suffix for guaranteed uniqueness
             v_quotation_number := 'QT-' || v_date_str || '-' || lpad(v_sequence::text, 4, '0') || '-' || (extract(epoch from now())::bigint % 10000)::text;
             RETURN v_quotation_number;
        END IF;
    END LOOP;
END;
$$;


--
-- Name: get_account_balance(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_account_balance(p_account_id text) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_balance NUMERIC;
    v_account_type TEXT;
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT type INTO v_account_type FROM accounts WHERE id = p_account_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COALESCE(SUM(jel.debit_amount), 0),
        COALESCE(SUM(jel.credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.is_voided = FALSE;

    IF v_account_type IN ('Aset', 'Beban') THEN
        v_balance := v_total_debit - v_total_credit;
    ELSE
        v_balance := v_total_credit - v_total_debit;
    END IF;

    RETURN v_balance;
END;
$$;


--
-- Name: get_account_balance_analysis(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_account_balance_analysis(p_account_id text) RETURNS TABLE(account_id text, account_name text, account_type text, current_balance numeric, calculated_balance numeric, difference numeric, transaction_breakdown jsonb, needs_reconciliation boolean)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_account RECORD;
  v_pos_sales NUMERIC := 0;
  v_receivables NUMERIC := 0;
  v_cash_income NUMERIC := 0;
  v_cash_expense NUMERIC := 0;
  v_expenses NUMERIC := 0;
  v_advances NUMERIC := 0;
  v_calculated NUMERIC;
BEGIN
  -- Get account info
  SELECT id, name, COALESCE(account_type, type) as account_type, 
         current_balance, initial_balance
  INTO v_account
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN;
  END IF;
  -- Calculate POS sales (check if payment_account column exists in transactions)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'payment_account'
  ) THEN
    SELECT COALESCE(SUM(total), 0) INTO v_pos_sales
    FROM transactions 
    WHERE payment_account = p_account_id 
    AND payment_status = 'Lunas';
  END IF;
  -- Calculate receivables payments (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'transaction_payments') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_receivables
    FROM transaction_payments 
    WHERE account_id = p_account_id 
    AND status = 'active';
  END IF;
  -- Calculate cash history
  SELECT 
    COALESCE(SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END), 0)
  INTO v_cash_income, v_cash_expense
  FROM cash_history 
  WHERE account_id = p_account_id;
  -- Calculate expenses (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expenses') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_expenses
    FROM expenses 
    WHERE account_id = p_account_id 
    AND status = 'approved';
  END IF;
  -- Calculate advances (if table exists)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_advances') THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_advances
    FROM employee_advances 
    WHERE account_id = p_account_id 
    AND status = 'approved';
  END IF;
  -- Calculate total
  v_calculated := COALESCE(v_account.initial_balance, 0) + v_pos_sales + v_receivables + v_cash_income - v_cash_expense - v_expenses - v_advances;
  RETURN QUERY SELECT 
    p_account_id,
    v_account.name,
    v_account.account_type,
    v_account.current_balance,
    v_calculated,
    (v_account.current_balance - v_calculated),
    json_build_object(
      'initial_balance', COALESCE(v_account.initial_balance, 0),
      'pos_sales', v_pos_sales,
      'receivables_payments', v_receivables,
      'cash_income', v_cash_income,
      'cash_expense', v_cash_expense,
      'expenses', v_expenses,
      'advances', v_advances
    )::JSONB,
    (ABS(v_account.current_balance - v_calculated) > 1000);
END;
$$;


--
-- Name: get_account_balance_at_date(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_account_balance_at_date(p_account_id text, p_as_of_date date) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_balance NUMERIC;
    v_account_type TEXT;
    v_total_debit NUMERIC;
    v_total_credit NUMERIC;
BEGIN
    SELECT type INTO v_account_type FROM accounts WHERE id = p_account_id;
    IF NOT FOUND THEN RETURN NULL; END IF;

    SELECT
        COALESCE(SUM(jel.debit_amount), 0),
        COALESCE(SUM(jel.credit_amount), 0)
    INTO v_total_debit, v_total_credit
    FROM journal_entry_lines jel
    INNER JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE jel.account_id = p_account_id
      AND je.status = 'posted'
      AND je.is_voided = FALSE
      AND je.entry_date <= p_as_of_date;

    IF v_account_type IN ('Aset', 'Beban') THEN
        v_balance := v_total_debit - v_total_credit;
    ELSE
        v_balance := v_total_credit - v_total_debit;
    END IF;

    RETURN v_balance;
END;
$$;


--
-- Name: get_account_balance_with_children(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_account_balance_with_children(account_id text) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_balance NUMERIC := 0;
BEGIN
  -- Get sum of all child account balances
  WITH RECURSIVE account_tree AS (
    SELECT id, balance FROM public.accounts WHERE id = account_id
    UNION ALL
    SELECT a.id, a.balance 
    FROM public.accounts a
    JOIN account_tree at ON a.parent_id = at.id
  )
  SELECT COALESCE(SUM(balance), 0) INTO total_balance
  FROM account_tree
  WHERE id != account_id OR NOT EXISTS(
    SELECT 1 FROM public.accounts WHERE parent_id = account_id
  );
  
  RETURN total_balance;
END;
$$;


--
-- Name: get_account_opening_balance(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_account_opening_balance(p_account_id text, p_branch_id uuid) RETURNS TABLE(opening_balance numeric, journal_id uuid, journal_date date, last_updated timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_account RECORD;
  v_journal_balance NUMERIC;
  v_journal_id UUID;
  v_journal_date DATE;
  v_journal_updated TIMESTAMPTZ;
BEGIN
  -- Get account info
  SELECT id, type, initial_balance, updated_at INTO v_account
  FROM accounts
  WHERE id = p_account_id AND branch_id = p_branch_id;

  IF v_account.id IS NULL THEN
    RETURN QUERY SELECT 0::NUMERIC, NULL::UUID, NULL::DATE, NULL::TIMESTAMPTZ;
    RETURN;
  END IF;

  -- Try to get opening balance from journal first (Single Source of Truth)
  SELECT
    CASE
      WHEN v_account.type IN ('Aset', 'Beban') THEN jel.debit_amount
      ELSE jel.credit_amount
    END,
    je.id,
    je.entry_date,
    je.updated_at
  INTO v_journal_balance, v_journal_id, v_journal_date, v_journal_updated
  FROM journal_entries je
  INNER JOIN journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.reference_id = p_account_id
    AND je.reference_type = 'opening_balance'
    AND je.branch_id = p_branch_id
    AND je.is_voided = FALSE
    AND jel.account_id = p_account_id
  ORDER BY je.created_at DESC
  LIMIT 1;

  -- If journal found, return journal data
  IF v_journal_id IS NOT NULL THEN
    RETURN QUERY SELECT v_journal_balance, v_journal_id, v_journal_date, v_journal_updated;
    RETURN;
  END IF;

  -- Fallback: return initial_balance from accounts column (for legacy data)
  IF COALESCE(v_account.initial_balance, 0) != 0 THEN
    RETURN QUERY SELECT v_account.initial_balance, NULL::UUID, NULL::DATE, v_account.updated_at;
    RETURN;
  END IF;

  -- No opening balance found
  RETURN QUERY SELECT 0::NUMERIC, NULL::UUID, NULL::DATE, NULL::TIMESTAMPTZ;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: employee_salaries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_salaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid NOT NULL,
    base_salary numeric(15,2) DEFAULT 0 NOT NULL,
    commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    payroll_type character varying(20) DEFAULT 'monthly'::character varying NOT NULL,
    commission_type character varying(20) DEFAULT 'none'::character varying NOT NULL,
    effective_from date DEFAULT CURRENT_DATE NOT NULL,
    effective_until date,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    CONSTRAINT valid_base_salary CHECK ((base_salary >= (0)::numeric)),
    CONSTRAINT valid_commission_rate CHECK (((commission_rate >= (0)::numeric) AND (commission_rate <= (100)::numeric))),
    CONSTRAINT valid_commission_type CHECK (((commission_type)::text = ANY (ARRAY[('percentage'::character varying)::text, ('fixed_amount'::character varying)::text, ('none'::character varying)::text]))),
    CONSTRAINT valid_effective_period CHECK (((effective_until IS NULL) OR (effective_until >= effective_from))),
    CONSTRAINT valid_payroll_type CHECK (((payroll_type)::text = ANY (ARRAY[('monthly'::character varying)::text, ('commission_only'::character varying)::text, ('mixed'::character varying)::text])))
);


--
-- Name: get_active_salary_config(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_active_salary_config(emp_id uuid, check_date date) RETURNS public.employee_salaries
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  result public.employee_salaries;
BEGIN
  -- First try exact match (effective_from <= check_date)
  SELECT * INTO result
  FROM public.employee_salaries
  WHERE employee_id = emp_id
    AND is_active = true
    AND effective_from <= check_date
    AND (effective_until IS NULL OR effective_until >= check_date)
  ORDER BY effective_from DESC
  LIMIT 1;
  -- If not found, just get any active config for this employee
  IF result IS NULL THEN
    SELECT * INTO result
    FROM public.employee_salaries
    WHERE employee_id = emp_id
      AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;
  END IF;
  RETURN result;
END;
$$;


--
-- Name: get_all_accounts_balance_analysis(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_all_accounts_balance_analysis() RETURNS TABLE(account_id text, account_name text, account_type text, current_balance numeric, calculated_balance numeric, difference numeric, needs_reconciliation boolean, last_updated timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    analysis.account_id,
    analysis.account_name,
    analysis.account_type,
    analysis.current_balance,
    analysis.calculated_balance,
    analysis.difference,
    analysis.needs_reconciliation,
    COALESCE(acc.updated_at, acc.created_at, NOW()) as last_updated
  FROM accounts acc,
  LATERAL get_account_balance_analysis(acc.id) analysis
  ORDER BY ABS(analysis.difference) DESC;
END;
$$;


--
-- Name: get_cash_balance_summary(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cash_balance_summary(p_branch_id uuid, p_date date DEFAULT CURRENT_DATE) RETURNS TABLE(account_id uuid, account_name text, account_code text, opening_balance numeric, today_income numeric, today_expense numeric, today_net numeric, current_balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  WITH 
  -- 1. Identify Cash/Bank Accounts
  cash_accounts AS (
    SELECT id, name, code, initial_balance
    FROM accounts
    WHERE branch_id = p_branch_id
      AND is_payment_account = true
      AND is_header = false
      AND is_active = true
  ),
  -- 2. Calculate Opening Balance (All transactions BEFORE today)
  opening_stats AS (
    SELECT 
      jel.account_id,
      SUM(jel.debit_amount - jel.credit_amount) as balance_movement
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.branch_id = p_branch_id
      AND je.entry_date < p_date -- STRICTLY BEFORE today
      AND je.is_voided = false
      AND je.status = 'posted'
      AND jel.account_id IN (SELECT id FROM cash_accounts)
    GROUP BY jel.account_id
  ),
  -- 3. Calculate Today's Movement
  today_stats AS (
    SELECT 
      jel.account_id,
      SUM(jel.debit_amount) as debit_total,
      SUM(jel.credit_amount) as credit_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.branch_id = p_branch_id
      AND je.entry_date = p_date -- EXACTLY today
      AND je.is_voided = false
      AND je.status = 'posted'
      AND jel.account_id IN (SELECT id FROM cash_accounts)
    GROUP BY jel.account_id
  )
  SELECT 
    ca.id as account_id,
    ca.name as account_name,
    ca.code as account_code,
    -- Opening Balance = Initial Balance (from setup) + Historical Movement
    (COALESCE(ca.initial_balance, 0) + COALESCE(os.balance_movement, 0)) as opening_balance,
    
    COALESCE(ts.debit_total, 0) as today_income,
    COALESCE(ts.credit_total, 0) as today_expense,
    (COALESCE(ts.debit_total, 0) - COALESCE(ts.credit_total, 0)) as today_net,
    
    -- Current Balance = Opening + Today's Net
    (COALESCE(ca.initial_balance, 0) + COALESCE(os.balance_movement, 0) + 
     COALESCE(ts.debit_total, 0) - COALESCE(ts.credit_total, 0)) as current_balance
  FROM cash_accounts ca
  LEFT JOIN opening_stats os ON os.account_id = ca.id
  LEFT JOIN today_stats ts ON ts.account_id = ca.id;
END;
$$;


--
-- Name: get_commission_summary(uuid, date, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_commission_summary(p_branch_id uuid, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date) RETURNS TABLE(employee_id uuid, employee_name text, role text, total_pending numeric, total_paid numeric, pending_count bigint, paid_count bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.user_id,
    MAX(ce.user_name),
    MAX(ce.role),
    COALESCE(SUM(CASE WHEN ce.status = 'pending' THEN ce.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN ce.status = 'paid' THEN ce.amount ELSE 0 END), 0),
    COUNT(CASE WHEN ce.status = 'pending' THEN 1 END),
    COUNT(CASE WHEN ce.status = 'paid' THEN 1 END)
  FROM commission_entries ce
  WHERE ce.branch_id = p_branch_id
    AND (p_date_from IS NULL OR ce.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR ce.entry_date <= p_date_to)
  GROUP BY ce.user_id
  ORDER BY MAX(ce.user_name);
END;
$$;


--
-- Name: FUNCTION get_commission_summary(p_branch_id uuid, p_date_from date, p_date_to date); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_commission_summary(p_branch_id uuid, p_date_from date, p_date_to date) IS 'Get commission summary per employee for a branch.';


--
-- Name: get_current_nishab(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_nishab() RETURNS TABLE(gold_price numeric, silver_price numeric, gold_nishab numeric, silver_nishab numeric, zakat_rate numeric, gold_nishab_value numeric, silver_nishab_value numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    n.gold_price,
    n.silver_price,
    n.gold_nishab,
    n.silver_nishab,
    n.zakat_rate,
    (n.gold_price * n.gold_nishab) as gold_nishab_value,
    (n.silver_price * n.silver_nishab) as silver_nishab_value
  FROM nishab_reference n
  WHERE n.effective_date <= CURRENT_DATE
  ORDER BY n.effective_date DESC
  LIMIT 1;
  
  -- If no data, return defaults
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      1100000::NUMERIC, -- gold_price per gram
      15000::NUMERIC,   -- silver_price per gram
      85::NUMERIC,      -- gold_nishab grams
      595::NUMERIC,     -- silver_nishab grams
      0.025::NUMERIC,   -- zakat_rate 2.5%
      93500000::NUMERIC, -- gold_nishab_value
      8925000::NUMERIC;  -- silver_nishab_value
  END IF;
END;
$$;


--
-- Name: FUNCTION get_current_nishab(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_current_nishab() IS 'Get current nishab values for zakat calculation';


--
-- Name: get_current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_current_user_role() RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN (
    SELECT role 
    FROM public.profiles 
    WHERE id = auth.uid()
  );
END;
$$;


--
-- Name: get_delivery_summary(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_delivery_summary(transaction_id_param text) RETURNS TABLE(product_id uuid, product_name text, is_bonus boolean, ordered_quantity integer, delivered_quantity integer, remaining_quantity integer, unit text, width numeric, height numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.product_id,
    p.product_name,
    p.is_bonus,
    p.ordered_quantity::INTEGER,
    COALESCE(di_summary.delivered_quantity, 0)::INTEGER,
    (p.ordered_quantity - COALESCE(di_summary.delivered_quantity, 0))::INTEGER,
    p.unit,
    p.width,
    p.height
  FROM (
    SELECT 
      COALESCE((item->>'productId')::uuid, (item->'product'->>'id')::uuid) as product_id,
      COALESCE(item->>'productName', item->'product'->>'name') as product_name,
      COALESCE((item->>'isBonus')::boolean, (item->>'is_bonus')::boolean, false) as is_bonus,
      (item->>'quantity')::integer as ordered_quantity,
      item->>'unit' as unit,
      (item->>'width')::numeric as width,
      (item->>'height')::numeric as height
    FROM transactions t
    CROSS JOIN LATERAL jsonb_array_elements(t.items) AS item
    WHERE t.id = transaction_id_param
    AND NOT COALESCE((item->>'_isSalesMeta')::boolean, (item->>'_isMigrationMeta')::boolean, false)
  ) p
  LEFT JOIN (
    SELECT 
      di.product_id,
      di.is_bonus,
      SUM(di.quantity_delivered) as delivered_quantity
    FROM deliveries d
    JOIN delivery_items di ON di.delivery_id = d.id
    WHERE d.transaction_id = transaction_id_param
    GROUP BY di.product_id, di.is_bonus
  ) di_summary ON di_summary.product_id = p.product_id 
               AND (di_summary.is_bonus = p.is_bonus OR (di_summary.is_bonus IS NULL AND p.is_bonus = false));
END;
$$;


--
-- Name: get_delivery_with_employees(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_delivery_with_employees(delivery_id_param uuid) RETURNS TABLE(id uuid, transaction_id text, delivery_number integer, delivery_date timestamp with time zone, photo_url text, photo_drive_id text, notes text, driver_name text, helper_name text, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    d.id,
    d.transaction_id,
    d.delivery_number,
    d.delivery_date,
    d.photo_url,
    d.photo_drive_id,
    d.notes,
    driver.name as driver_name,
    helper.name as helper_name,
    d.created_at,
    d.updated_at
  FROM deliveries d
  LEFT JOIN employees driver ON d.driver_id = driver.id
  LEFT JOIN employees helper ON d.helper_id = helper.id
  WHERE d.id = delivery_id_param;
END;
$$;


--
-- Name: get_expense_account_for_category(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_expense_account_for_category(category_name text) RETURNS TABLE(account_id text, account_code text, account_name text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  -- Map category to account
  RETURN QUERY
  SELECT a.id::TEXT, a.code::TEXT, a.name::TEXT
  FROM accounts a
  WHERE a.type = 'Expense'
    AND (
      (category_name ILIKE '%gaji%' AND a.code = '6100') OR
      (category_name ILIKE '%listrik%' AND a.code = '6200') OR
      (category_name ILIKE '%sewa%' AND a.code = '6300') OR
      (category_name ILIKE '%transport%' AND a.code = '6400') OR
      (category_name ILIKE '%perlengkapan%' AND a.code = '6500') OR
      (category_name ILIKE '%pemeliharaan%' AND a.code = '6600') OR
      (category_name ILIKE '%bahan%' AND a.code = '5100') OR
      (a.code = '6900') -- Default: Beban Lain-lain
    )
  ORDER BY 
    CASE 
      WHEN category_name ILIKE '%gaji%' AND a.code = '6100' THEN 1
      WHEN category_name ILIKE '%listrik%' AND a.code = '6200' THEN 1
      WHEN category_name ILIKE '%sewa%' AND a.code = '6300' THEN 1
      WHEN category_name ILIKE '%transport%' AND a.code = '6400' THEN 1
      WHEN category_name ILIKE '%perlengkapan%' AND a.code = '6500' THEN 1
      WHEN category_name ILIKE '%pemeliharaan%' AND a.code = '6600' THEN 1
      WHEN category_name ILIKE '%bahan%' AND a.code = '5100' THEN 1
      ELSE 2
    END
  LIMIT 1;
  
  -- If no match, return default
  IF NOT FOUND THEN
    RETURN QUERY
    SELECT a.id::TEXT, a.code::TEXT, a.name::TEXT
    FROM accounts a
    WHERE a.code = '6900'
    LIMIT 1;
  END IF;
END;
$$;


--
-- Name: get_material_fifo_cost(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_material_fifo_cost(p_material_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_oldest_cost numeric;
BEGIN
    -- Get cost from oldest batch with remaining stock (FIFO)
    SELECT unit_cost INTO v_oldest_cost
    FROM public.inventory_batches
    WHERE material_id = p_material_id
      AND (branch_id = p_branch_id OR branch_id IS NULL)
      AND remaining_quantity > 0
    ORDER BY batch_date ASC
    LIMIT 1;
    -- Fallback to material's cost_price if no batches
    IF v_oldest_cost IS NULL THEN
        SELECT cost_price INTO v_oldest_cost
        FROM public.materials
        WHERE id = p_material_id;
    END IF;
    RETURN COALESCE(v_oldest_cost, 0);
END;
$$;


--
-- Name: get_material_stock(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_material_stock(p_material_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch ID is REQUIRED';
  END IF;

  RETURN COALESCE(
    (SELECT SUM(remaining_quantity)
      FROM inventory_batches
      WHERE material_id = p_material_id
        AND (branch_id = p_branch_id OR branch_id IS NULL)
        AND remaining_quantity > 0),
    0
  );
END;
$$;


--
-- Name: FUNCTION get_material_stock(p_material_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_material_stock(p_material_id uuid, p_branch_id uuid) IS 'Get current stock material di branch tertentu.';


--
-- Name: get_next_journal_number(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_journal_number(p_prefix text DEFAULT 'JU'::text) RETURNS text
    LANGUAGE plpgsql
    AS $_$
DECLARE
  v_date_part TEXT;
  v_last_number INTEGER;
  v_new_number TEXT;
BEGIN
  v_date_part := TO_CHAR(NOW(), 'YYMMDD');
  -- Get the last journal number with this prefix and date
  SELECT COALESCE(
    MAX(
      CASE
        WHEN entry_number ~ ('^' || p_prefix || '-' || v_date_part || '-[0-9]+$')
        THEN SUBSTRING(entry_number FROM '[0-9]+$')::INTEGER
        ELSE 0
      END
    ),
    0
  ) INTO v_last_number
  FROM journal_entries
  WHERE entry_number LIKE p_prefix || '-' || v_date_part || '-%';
  v_new_number := p_prefix || '-' || v_date_part || '-' || LPAD((v_last_number + 1)::TEXT, 3, '0');
  RETURN v_new_number;
END;
$_$;


--
-- Name: get_next_retasi_counter(text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_next_retasi_counter(driver text, target_date date DEFAULT CURRENT_DATE) RETURNS integer
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: get_outstanding_advances(uuid, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_outstanding_advances(emp_id uuid, up_to_date date DEFAULT CURRENT_DATE) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  total_advances DECIMAL(15,2) := 0;
  total_repayments DECIMAL(15,2) := 0;
  outstanding DECIMAL(15,2) := 0;
BEGIN
  -- Calculate total advances up to the specified date
  SELECT COALESCE(SUM(amount), 0) INTO total_advances
  FROM public.employee_advances
  WHERE employee_id = emp_id
    AND date <= up_to_date;
  -- Calculate total repayments up to the specified date
  SELECT COALESCE(SUM(ar.amount), 0) INTO total_repayments
  FROM public.advance_repayments ar
  JOIN public.employee_advances ea ON ea.id = ar.advance_id
  WHERE ea.employee_id = emp_id
    AND ar.date <= up_to_date;
  -- Calculate outstanding amount
  outstanding := total_advances - total_repayments;
  -- Return 0 if negative (overpaid)
  RETURN GREATEST(outstanding, 0);
END;
$$;


--
-- Name: get_payment_history_rpc(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_payment_history_rpc(p_branch_id uuid, p_limit integer DEFAULT 100) RETURNS TABLE(id uuid, payment_date timestamp with time zone, amount numeric, transaction_id text, customer_name text, payment_method text, notes text, account_name text, user_name text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_date,
        ph.amount,
        ph.transaction_id,
        t.customer_name,
        ph.payment_method,
        ph.notes,
        COALESCE(a.name, 'Kas Besar') as account_name,
        COALESCE(pr.full_name, ph.recorded_by_name, 'System') as user_name,
        ph.created_at
    FROM payment_history ph
    LEFT JOIN transactions t ON ph.transaction_id = t.id
    LEFT JOIN accounts a ON ph.account_id = a.id
    LEFT JOIN profiles pr ON ph.recorded_by = pr.id
    WHERE ph.branch_id = p_branch_id
    ORDER BY ph.payment_date DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_payment_history_rpc(uuid, integer, date, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_payment_history_rpc(p_branch_id uuid, p_limit integer DEFAULT 100, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_account_id text DEFAULT NULL::text) RETURNS TABLE(id uuid, payment_date timestamp with time zone, amount numeric, transaction_id text, customer_name text, payment_method text, notes text, account_name text, user_name text, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_date,
        ph.amount,
        ph.transaction_id,
        t.customer_name,
        ph.payment_method,
        ph.notes,
        COALESCE(a.name, 'Kas Besar') as account_name,
        COALESCE(pr.full_name, ph.recorded_by_name, 'System') as user_name,
        ph.created_at
    FROM payment_history ph
    LEFT JOIN transactions t ON ph.transaction_id = t.id
    LEFT JOIN accounts a ON ph.account_id = a.id
    LEFT JOIN profiles pr ON ph.recorded_by = pr.id
    WHERE ph.branch_id = p_branch_id
      AND (p_date_from IS NULL OR DATE(ph.payment_date) >= p_date_from)
      AND (p_date_to IS NULL OR DATE(ph.payment_date) <= p_date_to)
      AND (p_account_id IS NULL OR p_account_id = 'all' OR ph.account_id = p_account_id)
    ORDER BY ph.payment_date DESC
    LIMIT p_limit;
END;
$$;


--
-- Name: get_pending_commissions(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pending_commissions(p_employee_id uuid, p_branch_id uuid) RETURNS TABLE(commission_id uuid, amount numeric, commission_type text, product_name text, transaction_id text, delivery_id uuid, entry_date date, created_at timestamp without time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY
  SELECT
    ce.id,
    ce.amount,
    ce.commission_type,
    p.name,
    ce.transaction_id,
    ce.delivery_id,
    ce.entry_date,
    ce.created_at
  FROM commission_entries ce
  LEFT JOIN products p ON p.id = ce.product_id
  WHERE ce.user_id = p_employee_id
    AND ce.branch_id = p_branch_id
    AND ce.status = 'pending'
  ORDER BY ce.created_at;
END;
$$;


--
-- Name: FUNCTION get_pending_commissions(p_employee_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_pending_commissions(p_employee_id uuid, p_branch_id uuid) IS 'Get list of pending commissions for an employee.';


--
-- Name: get_product_fifo_cost(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_fifo_cost(p_product_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_oldest_cost numeric;
BEGIN
    -- Get cost from oldest batch with remaining stock (FIFO)
    SELECT unit_cost INTO v_oldest_cost
    FROM public.inventory_batches
    WHERE product_id = p_product_id
      AND (branch_id = p_branch_id OR branch_id IS NULL)
      AND remaining_quantity > 0
    ORDER BY batch_date ASC
    LIMIT 1;
    -- Fallback to product's cost_price if no batches
    IF v_oldest_cost IS NULL THEN
        SELECT cost_price INTO v_oldest_cost
        FROM public.products
        WHERE id = p_product_id;
    END IF;
    RETURN COALESCE(v_oldest_cost, 0);
END;
$$;


--
-- Name: get_product_stock(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_stock(p_product_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  IF p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Branch ID is REQUIRED';
  END IF;

  RETURN COALESCE(
    (SELECT SUM(remaining_quantity)
     FROM inventory_batches
     WHERE product_id = p_product_id
       AND branch_id = p_branch_id
       AND remaining_quantity > 0),
    0
  );
END;
$$;


--
-- Name: FUNCTION get_product_stock(p_product_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_product_stock(p_product_id uuid, p_branch_id uuid) IS 'Get current stock produk di branch tertentu.';


--
-- Name: get_product_weighted_avg_cost(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_product_weighted_avg_cost(p_product_id uuid, p_branch_id uuid) RETURNS numeric
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_avg_cost numeric;
BEGIN
    SELECT CASE WHEN SUM(remaining_quantity) > 0 THEN SUM(remaining_quantity * unit_cost) / SUM(remaining_quantity) ELSE NULL END INTO v_avg_cost
    FROM public.inventory_batches
    WHERE product_id = p_product_id
      AND (branch_id = p_branch_id OR branch_id IS NULL)
      AND remaining_quantity > 0;
    IF v_avg_cost IS NULL THEN
        SELECT cost_price INTO v_avg_cost FROM public.products WHERE id = p_product_id;
    END IF;
    RETURN COALESCE(v_avg_cost, 0);
END;
$$;


--
-- Name: get_record_history(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_record_history(p_table_name text, p_record_id text) RETURNS TABLE(audit_time timestamp with time zone, operation text, user_email text, changed_fields jsonb, old_data jsonb, new_data jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT al.created_at, al.operation, al.user_email, al.changed_fields, al.old_data, al.new_data
  FROM audit_logs al
  WHERE al.table_name = p_table_name AND al.record_id = p_record_id
  ORDER BY al.created_at DESC;
END;
$$;


--
-- Name: get_rls_policies(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_rls_policies(table_name text DEFAULT NULL::text) RETURNS TABLE(schema_name text, table_name text, policy_name text, cmd text, roles text, qual text)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT 
    schemaname::text as schema_name,
    tablename::text as table_name,
    policyname::text as policy_name,
    cmd::text,
    array_to_string(roles, ', ')::text as roles,
    qual::text
  FROM pg_policies 
  WHERE schemaname = 'public'
    AND (table_name IS NULL OR tablename = table_name)
  ORDER BY tablename, policyname;
$$;


--
-- Name: get_rls_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_rls_status() RETURNS TABLE(schema_name text, table_name text, rls_enabled boolean)
    LANGUAGE sql SECURITY DEFINER
    AS $$
  SELECT 
    schemaname::text as schema_name,
    tablename::text as table_name,
    rowsecurity as rls_enabled
  FROM pg_tables 
  WHERE schemaname = 'public'
  ORDER BY tablename;
$$;


--
-- Name: get_transactions_ready_for_delivery(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_transactions_ready_for_delivery() RETURNS TABLE(id text, customer_name text, order_date timestamp with time zone, items jsonb, total numeric, status text)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.customer_name,
    t.order_date,
    t.items,
    t.total,
    t.status
  FROM transactions t
  WHERE t.status IN ('Siap Antar', 'Diantar Sebagian')
    AND (t.is_office_sale IS NULL OR t.is_office_sale = false)
  ORDER BY t.order_date ASC;
END;
$$;


--
-- Name: get_undelivered_goods_liability(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_undelivered_goods_liability(p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(transaction_id text, customer_name text, transaction_total numeric, delivered_total numeric, undelivered_total numeric, status text, order_date timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  WITH delivered_qty AS (
    SELECT 
      d.transaction_id as txn_id,
      di.product_id,
      SUM(di.quantity_delivered) as qty_delivered
    FROM deliveries d
    JOIN delivery_items di ON di.delivery_id = d.id
    WHERE (p_branch_id IS NULL OR d.branch_id = p_branch_id)
    GROUP BY d.transaction_id, di.product_id
  ),
  transaction_items AS (
    SELECT 
      t.id as txn_id,
      t.customer_name as cust_name,
      t.total as txn_total,
      t.status as txn_status,
      t.order_date as txn_date,
      (item->>'quantity')::numeric as qty_ordered,
      item->'product'->>'id' as prod_id,
      (item->>'price')::numeric as unit_price,
      item->>'isBonus' as is_bonus
    FROM transactions t
    CROSS JOIN LATERAL jsonb_array_elements(t.items) as item
    WHERE t.is_office_sale = false
    AND t.status NOT IN ('cancelled', 'Selesai', 'complete')
    AND (p_branch_id IS NULL OR t.branch_id = p_branch_id)
  ),
  undelivered AS (
    SELECT 
      ti.txn_id,
      ti.cust_name,
      ti.txn_total,
      ti.txn_status,
      ti.txn_date,
      ti.prod_id,
      COALESCE(ti.qty_ordered, 0) as qty_ordered,
      COALESCE(dq.qty_delivered, 0) as qty_delivered,
      COALESCE(ti.unit_price, 0) as unit_price,
      ti.is_bonus
    FROM transaction_items ti
    LEFT JOIN delivered_qty dq ON dq.txn_id = ti.txn_id AND dq.product_id::text = ti.prod_id
    WHERE ti.is_bonus != 'true' OR ti.is_bonus IS NULL
  )
  SELECT 
    u.txn_id::TEXT as transaction_id,
    u.cust_name::TEXT as customer_name,
    u.txn_total as transaction_total,
    SUM(u.qty_delivered * u.unit_price) as delivered_total,
    SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) as undelivered_total,
    u.txn_status::TEXT as status,
    u.txn_date as order_date
  FROM undelivered u
  WHERE u.qty_ordered > u.qty_delivered
  GROUP BY u.txn_id, u.cust_name, u.txn_total, u.txn_status, u.txn_date
  HAVING SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) > 0
  ORDER BY SUM((u.qty_ordered - u.qty_delivered) * u.unit_price) DESC;
END;
$$;


--
-- Name: get_user_branch_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_branch_id() RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_branch_id UUID;
BEGIN
  -- Get branch_id from profiles table based on auth.uid()
  SELECT branch_id INTO v_branch_id
  FROM profiles
  WHERE id = auth.uid();
  
  RETURN v_branch_id;
END;
$$;


--
-- Name: FUNCTION get_user_branch_id(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_branch_id() IS 'Get branch_id for currently authenticated user';


--
-- Name: get_user_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role(p_user_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  RETURN v_role;
END;
$$;


--
-- Name: FUNCTION get_user_role(p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.get_user_role(p_user_id uuid) IS 'Get user role name from employee ID.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, status)
  VALUES (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    new.email,
    new.raw_user_meta_data ->> 'role',
    new.raw_user_meta_data ->> 'status'
  );
  RETURN new;
END;
$$;


--
-- Name: has_perm(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_perm(perm_name text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    jwt_role TEXT;
    perms JSONB;
BEGIN
    -- Get role from JWT claims
    BEGIN
        jwt_role := current_setting('request.jwt.claims', true)::json->>'role';
    EXCEPTION WHEN OTHERS THEN
        jwt_role := NULL;
    END;
    -- No JWT role = deny
    IF jwt_role IS NULL OR jwt_role = '' THEN
        RETURN false;
    END IF;
    -- Owner always has all permissions
    IF jwt_role = 'owner' THEN
        RETURN true;
    END IF;
    -- Get permissions from role_permissions table
    SELECT permissions INTO perms
    FROM role_permissions
    WHERE role_id = jwt_role;
    -- If no permissions found for role, allow basic access (authenticated)
    IF perms IS NULL THEN
        RETURN true;  -- Allow authenticated users with unknown roles
    END IF;
    -- Check 'all' permission first
    IF (perms->>'all')::boolean = true THEN
        RETURN true;
    END IF;
    -- Check specific permission
    RETURN COALESCE((perms->>perm_name)::boolean, false);
END;
$$;


--
-- Name: has_permission(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_permission(permission_name text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
    permissions JSONB;
BEGIN
    user_role := auth.role();
    -- If no role or anon, check if there's a valid user_id (authenticated)
    IF user_role IS NULL OR user_role = 'anon' THEN
        -- Check if user is authenticated via auth.uid()
        IF auth.uid() IS NOT NULL THEN
            -- Get role from profiles table
            SELECT role INTO user_role FROM profiles WHERE id = auth.uid();
        END IF;
        -- Still no role? deny access
        IF user_role IS NULL OR user_role = 'anon' THEN
            RETURN false;
        END IF;
    END IF;
    -- Get permissions from role_permissions table
    SELECT rp.permissions INTO permissions
    FROM role_permissions rp
    WHERE rp.role_id = user_role;
    -- If role not found in role_permissions, fallback to roles table
    IF permissions IS NULL THEN
        SELECT r.permissions INTO permissions
        FROM roles r
        WHERE r.name = user_role AND r.is_active = true;
    END IF;
    -- No permissions found, but owner/admin should have access
    IF permissions IS NULL THEN
        IF user_role IN ('owner', 'admin', 'super_admin', 'head_office_admin') THEN
            RETURN true;
        END IF;
        RETURN false;
    END IF;
    -- Check 'all' permission (owner-level access)
    IF (permissions->>'all')::boolean = true THEN
        RETURN true;
    END IF;
    -- Check specific permission
    RETURN COALESCE((permissions->>permission_name)::boolean, false);
END;
$$;


--
-- Name: import_standard_coa(uuid, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.import_standard_coa(p_branch_id uuid, p_items jsonb) RETURNS TABLE(success boolean, imported_count integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_item JSONB;
  v_count INTEGER := 0;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is required';
    RETURN;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- Insert or ignore if code exists (or update?)
    -- Logic similar to useAccounts: upsert based on some key, but here we don't have predictable IDs.
    -- We'll check by code.
    
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE branch_id = p_branch_id AND code = (v_item->>'code')) THEN
       INSERT INTO accounts (
         branch_id,
         name,
         code,
         type,
         level,
         is_header,
         sort_order,
         is_active,
         balance,
         initial_balance,
         created_at,
         updated_at
       ) VALUES (
         p_branch_id,
         v_item->>'name',
         v_item->>'code',
         v_item->>'type',
         (v_item->>'level')::INTEGER,
         (v_item->>'isHeader')::BOOLEAN,
         (v_item->>'sortOrder')::INTEGER,
         TRUE,
         0,
         0,
         NOW(),
         NOW()
       );
       v_count := v_count + 1;
    END IF;
  END LOOP;
  
  -- Second pass for parents? 
  -- Simplified: Assumes hierarchy is handled by codes or manual update later if needed.
  -- Or implemented if 'parentCode' provided.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
     IF (v_item->>'parentCode') IS NOT NULL THEN
        UPDATE accounts child
        SET parent_id = parent.id
        FROM accounts parent
        WHERE child.branch_id = p_branch_id AND child.code = (v_item->>'code')
          AND parent.branch_id = p_branch_id AND parent.code = (v_item->>'parentCode');
     END IF;
  END LOOP;

  RETURN QUERY SELECT TRUE, v_count, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM;
END;
$$;


--
-- Name: insert_delivery(text, integer, text, text, text, timestamp with time zone, text, text, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_delivery(p_transaction_id text, p_delivery_number integer, p_customer_name text, p_customer_address text DEFAULT ''::text, p_customer_phone text DEFAULT ''::text, p_delivery_date timestamp with time zone DEFAULT now(), p_photo_url text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, transaction_id text, delivery_number integer, customer_name text, customer_address text, customer_phone text, delivery_date timestamp with time zone, photo_url text, notes text, driver_id uuid, helper_id uuid, branch_id uuid, created_at timestamp with time zone, updated_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO deliveries (
    transaction_id,
    delivery_number,
    customer_name,
    customer_address,
    customer_phone,
    delivery_date,
    photo_url,
    notes,
    driver_id,
    helper_id,
    branch_id
  )
  VALUES (
    p_transaction_id,
    p_delivery_number,
    p_customer_name,
    p_customer_address,
    p_customer_phone,
    p_delivery_date,
    p_photo_url,
    p_notes,
    p_driver_id,
    p_helper_id,
    p_branch_id
  )
  RETURNING deliveries.id INTO new_id;
  -- Return full row
  RETURN QUERY
  SELECT
    d.id,
    d.transaction_id,
    d.delivery_number,
    d.customer_name,
    d.customer_address,
    d.customer_phone,
    d.delivery_date,
    d.photo_url,
    d.notes,
    d.driver_id,
    d.helper_id,
    d.branch_id,
    d.created_at,
    d.updated_at
  FROM deliveries d
  WHERE d.id = new_id;
END;
$$;


--
-- Name: insert_journal_entry(text, date, text, text, text, text, numeric, numeric, uuid, uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.insert_journal_entry(p_entry_number text, p_entry_date date, p_description text, p_reference_type text, p_reference_id text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text, p_total_debit numeric DEFAULT 0, p_total_credit numeric DEFAULT 0, p_branch_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid, p_approved_by uuid DEFAULT NULL::uuid, p_approved_at timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE(id uuid, entry_number text, entry_date date, description text, reference_type text, reference_id text, status text, total_debit numeric, total_credit numeric, branch_id uuid, created_by uuid, approved_by uuid, approved_at timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  new_id UUID;
BEGIN
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    total_debit,
    total_credit,
    branch_id,
    created_by,
    approved_by,
    approved_at
  )
  VALUES (
    p_entry_number,
    p_entry_date,
    p_description,
    p_reference_type,
    p_reference_id,
    p_status,
    p_total_debit,
    p_total_credit,
    p_branch_id,
    p_created_by,
    p_approved_by,
    p_approved_at
  )
  RETURNING journal_entries.id INTO new_id;
  RETURN QUERY
  SELECT
    j.id,
    j.entry_number,
    j.entry_date,
    j.description,
    j.reference_type,
    j.reference_id,
    j.status,
    j.total_debit,
    j.total_credit,
    j.branch_id,
    j.created_by,
    j.approved_by,
    j.approved_at,
    j.created_at
  FROM journal_entries j
  WHERE j.id = new_id;
END;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role IN ('admin', 'owner');
END;
$$;


--
-- Name: is_authenticated(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_authenticated() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    -- Check if there's a valid user_id
    IF auth.uid() IS NOT NULL THEN
        RETURN true;
    END IF;
    -- Or if role is not anon
    user_role := auth.role();
    RETURN user_role IS NOT NULL AND user_role != 'anon';
END;
$$;


--
-- Name: is_owner(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_owner() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role = 'owner';
END;
$$;


--
-- Name: is_super_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_super_admin() RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    AS $$
DECLARE
    user_role TEXT;
BEGIN
    SELECT role INTO user_role
    FROM public.profiles
    WHERE id = auth.uid()
    LIMIT 1;
    RETURN user_role IN ('super_admin', 'head_office_admin', 'owner', 'admin');
END;
$$;


--
-- Name: log_performance(text, integer, text, integer, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_performance(p_operation_name text, p_duration_ms integer, p_table_name text DEFAULT NULL::text, p_record_count integer DEFAULT NULL::integer, p_query_type text DEFAULT NULL::text, p_metadata jsonb DEFAULT NULL::jsonb) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  log_id UUID;
BEGIN
  INSERT INTO public.performance_logs (
    operation_name,
    duration_ms,
    user_id,
    table_name,
    record_count,
    query_type,
    metadata
  ) VALUES (
    p_operation_name,
    p_duration_ms,
    auth.uid(),
    p_table_name,
    p_record_count,
    p_query_type,
    p_metadata
  ) RETURNING id INTO log_id;
  
  RETURN log_id;
END;
$$;


--
-- Name: mark_retasi_returned(uuid, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_retasi_returned(retasi_id uuid, returned_count integer DEFAULT 0, error_count integer DEFAULT 0, notes text DEFAULT NULL::text) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: mark_retasi_returned_atomic(uuid, uuid, text, jsonb, numeric, numeric, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_retasi_returned_atomic(p_branch_id uuid, p_retasi_id uuid, p_return_notes text, p_item_returns jsonb, p_manual_kembali numeric DEFAULT NULL::numeric, p_manual_laku numeric DEFAULT NULL::numeric, p_manual_tidak_laku numeric DEFAULT NULL::numeric, p_manual_error numeric DEFAULT NULL::numeric) RETURNS TABLE(success boolean, barang_laku numeric, barang_tidak_laku numeric, returned_items_count numeric, error_items_count numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: FUNCTION mark_retasi_returned_atomic(p_branch_id uuid, p_retasi_id uuid, p_return_notes text, p_item_returns jsonb, p_manual_kembali numeric, p_manual_laku numeric, p_manual_tidak_laku numeric, p_manual_error numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.mark_retasi_returned_atomic(p_branch_id uuid, p_retasi_id uuid, p_return_notes text, p_item_returns jsonb, p_manual_kembali numeric, p_manual_laku numeric, p_manual_tidak_laku numeric, p_manual_error numeric) IS 'Memproses pengembalian retasi secara atomik.';


--
-- Name: migrate_material_stock_to_batches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.migrate_material_stock_to_batches() RETURNS TABLE(material_id uuid, material_name text, migrated_quantity numeric, batch_id uuid)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_material RECORD;
  v_new_batch_id UUID;
BEGIN
  FOR v_material IN
    SELECT m.id, m.name, m.stock, m.branch_id, m.price_per_unit
    FROM materials m
    WHERE m.stock > 0
      AND NOT EXISTS (
        SELECT 1 FROM inventory_batches ib
        WHERE ib.material_id = m.id AND ib.remaining_quantity > 0
      )
  LOOP
    INSERT INTO inventory_batches (
      material_id,
      branch_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes
    ) VALUES (
      v_material.id,
      v_material.branch_id,
      v_material.stock,
      v_material.stock,
      COALESCE(v_material.price_per_unit, 0),
      NOW(),
      'Migrated from materials.stock (initial)'
    )
    RETURNING id INTO v_new_batch_id;
    RETURN QUERY SELECT v_material.id, v_material.name, v_material.stock, v_new_batch_id;
  END LOOP;
END;
$$;


--
-- Name: notify_debt_payment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_debt_payment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only notify for debt payment type
    IF NEW.type = 'pembayaran_utang' THEN
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-DEBT-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Debt Payment Recorded',
            'Payment of Rp ' || TO_CHAR(NEW.amount, 'FM999,999,999,999') || ' for ' || COALESCE(NEW.description, 'debt payment'),
            'debt_payment',
            'accounts_payable',
            NEW.reference_id,
            '/accounts-payable',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: notify_payroll_processed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_payroll_processed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Only notify for payroll payment type
    IF NEW.type = 'pembayaran_gaji' THEN
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-PAYROLL-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Payroll Payment Processed',
            'Salary payment of Rp ' || TO_CHAR(NEW.amount, 'FM999,999,999,999') || ' for ' || COALESCE(NEW.reference_name, 'employee'),
            'payroll_processed',
            'payroll',
            NEW.reference_id,
            '/payroll',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: notify_production_completed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_production_completed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_product_name TEXT;
BEGIN
    -- Only notify when status changes to completed
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        -- Get product name
        SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id;
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-PROD-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Production Completed',
            'Production of ' || COALESCE(v_product_name, 'Unknown Product') || ' completed. Quantity: ' || NEW.quantity_produced,
            'production_completed',
            'production',
            NEW.id,
            '/production',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: notify_purchase_order_created(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_purchase_order_created() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
    VALUES (
        'NOTIF-PO-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'New Purchase Order Created',
        'PO #' || COALESCE(NEW.po_number, NEW.id::TEXT) || ' for supplier ' || COALESCE(NEW.supplier_name, 'Unknown') || ' - ' ||
        'Total: Rp ' || TO_CHAR(COALESCE(NEW.total_cost, 0), 'FM999,999,999,999'),
        'purchase_order_created',
        'purchase_order',
        NEW.id,
        '/purchase-orders/' || NEW.id,
        'normal'
    );
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    -- Don't fail the insert if notification fails
    RETURN NEW;
END;
$$;


--
-- Name: pay_commission_atomic(uuid, uuid, numeric, date, text, uuid[], text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method text DEFAULT 'cash'::text, p_commission_ids uuid[] DEFAULT NULL::uuid[], p_notes text DEFAULT NULL::text, p_paid_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, commissions_paid integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_employee_name TEXT;
  v_kas_account_id UUID;
  v_beban_komisi_id UUID;
  v_entry_number TEXT;
  v_commissions_paid INTEGER := 0;
  v_total_pending NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get employee name from profiles table (localhost uses profiles, not employees)
  SELECT full_name INTO v_employee_name FROM profiles WHERE id = p_employee_id;
  IF v_employee_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Check total pending commissions
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
  FROM commission_entries
  WHERE user_id = p_employee_id
    AND branch_id = p_branch_id
    AND status = 'pending';
  IF v_total_pending < p_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0,
      format('Jumlah pembayaran (%s) melebihi total komisi pending (%s)', p_amount, v_total_pending)::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  SELECT id INTO v_kas_account_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  -- Beban Komisi (biasanya 6200 atau sesuai chart of accounts)
  SELECT id INTO v_beban_komisi_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6200' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Komisi"
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%komisi%' AND type = 'expense' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Gaji (6100)
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_komisi_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Akun Kas atau Beban Komisi tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  v_payment_id := gen_random_uuid();
  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    -- Pay specific commission entries
    UPDATE commission_entries
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    WHERE id = ANY(p_commission_ids)
      AND user_id = p_employee_id
      AND branch_id = p_branch_id
      AND status = 'pending';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  ELSE
    -- Pay oldest pending commissions up to amount
    WITH to_pay AS (
      SELECT id, amount,
        SUM(amount) OVER (ORDER BY created_at) as running_total
      FROM commission_entries
      WHERE user_id = p_employee_id
        AND branch_id = p_branch_id
        AND status = 'pending'
      ORDER BY created_at
    )
    UPDATE commission_entries ce
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    FROM to_pay tp
    WHERE ce.id = tp.id
      AND tp.running_total <= p_amount;
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  -- ==================== INSERT PAYMENT RECORD ====================
  INSERT INTO commission_payments (
    id,
    employee_id,
    employee_name,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    paid_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_employee_id,
    v_employee_name,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    p_paid_by,
    NOW()
  );
  -- ==================== CREATE JOURNAL ENTRY ====================
  SELECT 'JE-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(
    (COALESCE(
      (SELECT COUNT(*) + 1 FROM journal_entries
       WHERE branch_id = p_branch_id
       AND DATE(created_at) = CURRENT_DATE),
      1
    ))::TEXT, 4, '0')
  INTO v_entry_number;
  INSERT INTO journal_entries (
    id,
    branch_id,
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    status,
    is_voided,
    created_at,
    updated_at
  ) VALUES (
    gen_random_uuid(),
    p_branch_id,
    v_entry_number,
    p_payment_date,
    'Pembayaran Komisi - ' || v_employee_name,
    'commission_payment',
    v_payment_id::TEXT,
    'posted',
    FALSE,
    NOW(),
    NOW()
  ) RETURNING id INTO v_journal_id;
  -- Dr. Beban Komisi
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_beban_komisi_id,
    (SELECT name FROM accounts WHERE id = v_beban_komisi_id),
    p_amount, 0, 'Beban komisi ' || v_employee_name, 1
  );
  -- Cr. Kas
  INSERT INTO journal_entry_lines (
    journal_entry_id, account_id, account_name,
    debit_amount, credit_amount, description, line_number
  ) VALUES (
    v_journal_id, v_kas_account_id,
    (SELECT name FROM accounts WHERE id = v_kas_account_id),
    0, p_amount, 'Pengeluaran kas untuk komisi', 2
  );
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date, p_payment_method text, p_commission_ids uuid[], p_notes text, p_paid_by uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date, p_payment_method text, p_commission_ids uuid[], p_notes text, p_paid_by uuid) IS 'Pay employee commission with auto journal. Dr. Beban Komisi, Cr. Kas.';


--
-- Name: pay_commission_atomic(uuid, uuid, numeric, date, uuid, text, uuid[], text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_commission_atomic(p_employee_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_commission_ids uuid[] DEFAULT NULL::uuid[], p_notes text DEFAULT NULL::text, p_paid_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, commissions_paid integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_journal_id UUID;
  v_employee_name TEXT;
  v_kas_account_id UUID;
  v_beban_komisi_id UUID;
  v_commissions_paid INTEGER := 0;
  v_total_pending NUMERIC;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_employee_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Employee ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Get employee name from profiles table (localhost uses profiles, not employees)
  SELECT full_name INTO v_employee_name FROM profiles WHERE id = p_employee_id;
  IF v_employee_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Karyawan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Check total pending commissions
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pending
  FROM commission_entries
  WHERE user_id = p_employee_id
    AND branch_id = p_branch_id
    AND status = 'pending';
  IF v_total_pending < p_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0,
      format('Jumlah pembayaran (%s) melebihi total komisi pending (%s)', p_amount, v_total_pending)::TEXT;
    RETURN;
  END IF;
  -- ==================== GET ACCOUNT IDS ====================
  -- Use provided payment account ID, or fallback to default 1110
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Beban Komisi (biasanya 6200 atau sesuai chart of accounts)
  SELECT id INTO v_beban_komisi_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '6200' AND is_active = TRUE LIMIT 1;
  -- Fallback: cari akun dengan nama mengandung "Komisi"
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%komisi%' AND type = 'expense' AND is_active = TRUE LIMIT 1;
  END IF;
  -- Fallback: gunakan Beban Gaji (6100)
  IF v_beban_komisi_id IS NULL THEN
    SELECT id INTO v_beban_komisi_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '6100' AND is_active = TRUE LIMIT 1;
  END IF;
  IF v_kas_account_id IS NULL OR v_beban_komisi_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, 'Akun Kas atau Beban Komisi tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  v_payment_id := gen_random_uuid();
  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    -- Pay specific commission entries
    UPDATE commission_entries
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    WHERE id = ANY(p_commission_ids)
      AND user_id = p_employee_id
      AND branch_id = p_branch_id
      AND status = 'pending';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  ELSE
    -- Pay oldest pending commissions up to amount
    WITH to_pay AS (
      SELECT id, amount,
        SUM(amount) OVER (ORDER BY created_at) as running_total
      FROM commission_entries
      WHERE user_id = p_employee_id
        AND branch_id = p_branch_id
        AND status = 'pending'
      ORDER BY created_at
    )
    UPDATE commission_entries ce
    SET
      status = 'paid',
      paid_at = NOW(),
      payment_id = v_payment_id,
      updated_at = NOW()
    FROM to_pay tp
    WHERE ce.id = tp.id
      AND tp.running_total <= p_amount;
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  -- ==================== INSERT PAYMENT RECORD ====================
  INSERT INTO commission_payments (
    id,
    employee_id,
    employee_name,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    paid_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_employee_id,
    v_employee_name,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    p_paid_by,
    NOW()
  );
  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_beban_komisi_id,
      'debit_amount', p_amount,
      'credit_amount', 0,
      'description', 'Bevan komisi ' || v_employee_name
    ),
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', 0,
      'credit_amount', p_amount,
      'description', 'Pengeluaran kas untuk komisi'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Pembayaran Komisi - ' || v_employee_name,
    'commission_payment',
    v_payment_id::TEXT,
    v_journal_lines,
    p_payment_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: pay_receivable(text, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_receivable(p_transaction_id text, p_amount numeric) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  current_paid_amount numeric;
  new_paid_amount numeric;
  total_amount numeric;
BEGIN
  SELECT paid_amount, total INTO current_paid_amount, total_amount
  FROM public.transactions
  WHERE id = p_transaction_id;
  new_paid_amount := current_paid_amount + p_amount;
  UPDATE public.transactions
  SET
    paid_amount = new_paid_amount,
    payment_status = CASE
      WHEN new_paid_amount >= total_amount THEN 'Lunas'
      ELSE 'Belum Lunas'
    END
  WHERE id = p_transaction_id;
END;
$$;


--
-- Name: pay_receivable_complete_rpc(uuid, uuid, numeric, text, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_receivable_complete_rpc(p_branch_id uuid, p_receivable_id uuid, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_payment_account_id text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_created_by uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID := gen_random_uuid();
  v_journal_id UUID := gen_random_uuid();
  v_journal_number TEXT;
  v_receivable RECORD;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Branch ID wajib diisi'::TEXT;
    RETURN;
  END IF;

  SELECT r.*, c.name as customer_name INTO v_receivable
  FROM receivables r LEFT JOIN customers c ON r.customer_id = c.id
  WHERE r.id = p_receivable_id AND r.branch_id = p_branch_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Piutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts WHERE code = '1110' AND branch_id = p_branch_id;
  END IF;

  SELECT id INTO v_piutang_account_id FROM accounts WHERE code = '1210' AND branch_id = p_branch_id;

  IF v_kas_account_id IS NULL OR v_piutang_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Akun kas atau piutang tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  v_journal_number := 'JE-PAY-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM()*10000)::TEXT, 4, '0');

  INSERT INTO journal_entries (id, entry_number, entry_date, description, reference_type, reference_id, status, total_debit, total_credit, branch_id, created_by, created_at, is_voided)
  VALUES (v_journal_id, v_journal_number, CURRENT_DATE, format('Pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 'payment', v_payment_id::TEXT, 'posted', p_amount, p_amount, p_branch_id, p_created_by, NOW(), FALSE);

  INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, description, debit_amount, credit_amount)
  SELECT v_journal_id, 1, a.id, a.code, a.name, format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer')), p_amount, 0
  FROM accounts a WHERE a.id = v_kas_account_id;

  INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, account_code, account_name, description, debit_amount, credit_amount)
  SELECT v_journal_id, 2, a.id, a.code, a.name, format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')), 0, p_amount
  FROM accounts a WHERE a.id = v_piutang_account_id;

  INSERT INTO receivable_payments (id, receivable_id, amount, payment_method, payment_date, notes, journal_id, created_by, created_at)
  VALUES (v_payment_id, p_receivable_id, p_amount, p_payment_method, CURRENT_DATE, p_notes, v_journal_id, p_created_by, NOW());

  UPDATE receivables SET paid_amount = paid_amount + p_amount, status = CASE WHEN paid_amount + p_amount >= total_amount THEN 'paid' ELSE 'partial' END WHERE id = p_receivable_id;

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: pay_receivable_complete_rpc(text, numeric, text, text, uuid, uuid, text, date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_receivable_complete_rpc(p_transaction_id text, p_amount numeric, p_payment_account_id text, p_notes text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_recorded_by_name text DEFAULT NULL::text, p_payment_date date DEFAULT CURRENT_DATE) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_transaction RECORD;
    v_payment_id UUID;
    v_journal_result RECORD;
    v_new_paid_amount NUMERIC;
    v_new_status TEXT;
    v_payment_date DATE;
BEGIN
    -- Set payment date
    v_payment_date := COALESCE(p_payment_date, CURRENT_DATE);

    -- Get transaction info
    SELECT 
        t.id,
        t.total,
        t.paid_amount,
        t.payment_status,
        t.branch_id,
        t.customer_name
    INTO v_transaction
    FROM transactions t
    WHERE t.id = p_transaction_id;

    IF v_transaction.id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Transaction not found'::TEXT;
        RETURN;
    END IF;

    -- Use transaction's branch_id if not provided
    IF p_branch_id IS NULL THEN
        p_branch_id := v_transaction.branch_id;
    END IF;

    -- Validate amount
    IF p_amount <= 0 THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Amount must be positive'::TEXT;
        RETURN;
    END IF;

    v_new_paid_amount := COALESCE(v_transaction.paid_amount, 0) + p_amount;
    
    IF v_new_paid_amount > v_transaction.total THEN
        RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 'Payment exceeds remaining balance'::TEXT;
        RETURN;
    END IF;

    -- Determine new payment status
    IF v_new_paid_amount >= v_transaction.total THEN
        v_new_status := 'Lunas';
    ELSIF v_new_paid_amount > 0 THEN
        v_new_status := 'Partial';
    ELSE
        v_new_status := 'Belum Lunas';
    END IF;

    -- 1. Update transaction
    UPDATE transactions
    SET 
        paid_amount = v_new_paid_amount,
        payment_status = v_new_status,
        updated_at = NOW()
    WHERE id = p_transaction_id;

    -- 2. Insert payment history
    INSERT INTO payment_history (
        transaction_id,
        branch_id,
        amount,
        remaining_amount,
        payment_method,
        account_id,
        payment_date,
        notes,
        recorded_by,
        recorded_by_name,
        created_at
    ) VALUES (
        p_transaction_id,
        p_branch_id,
        p_amount,
        (v_transaction.total - v_new_paid_amount),
        'Tunai',
        p_payment_account_id,
        v_payment_date,
        p_notes,
        p_user_id,
        p_recorded_by_name,
        NOW() -- CreatedAt remains NOW even for backdated payments
    ) RETURNING id INTO v_payment_id;

    -- 3. Create journal entry via RPC
    -- Note: Ensure create_receivable_payment_journal_rpc accepts date parameter
    -- Usually it is signature: (p_branch_id, p_transaction_id, p_date, p_amount, p_customer_name, p_account_id)
    SELECT * INTO v_journal_result
    FROM create_receivable_payment_journal_rpc(
        p_branch_id,
        p_transaction_id,
        v_payment_date,
        p_amount,
        v_transaction.customer_name,
        p_payment_account_id
    );

    IF NOT v_journal_result.success THEN
        RAISE EXCEPTION 'Failed to create journal: %', v_journal_result.error_message;
    END IF;

    RETURN QUERY SELECT 
        TRUE, 
        v_payment_id, 
        v_journal_result.journal_id,
        NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: pay_receivable_with_history(text, numeric, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_receivable_with_history(p_transaction_id text, p_amount numeric, p_account_id text DEFAULT NULL::text, p_account_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_recorded_by text DEFAULT NULL::text, p_recorded_by_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $_$
DECLARE
  v_transaction RECORD;
  v_remaining_amount NUMERIC;
BEGIN
  -- Get current transaction
  SELECT * INTO v_transaction FROM public.transactions WHERE id = p_transaction_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaction not found';
  END IF;
  
  -- Calculate remaining amount after this payment
  v_remaining_amount := v_transaction.total - (v_transaction.paid_amount + p_amount);
  
  IF v_remaining_amount < 0 THEN
    RAISE EXCEPTION 'Payment amount exceeds remaining balance';
  END IF;
  
  -- Update transaction
  UPDATE public.transactions 
  SET 
    paid_amount = paid_amount + p_amount,
    payment_status = CASE 
      WHEN paid_amount + p_amount >= total THEN 'Lunas'
      ELSE 'Belum Lunas'
    END
  WHERE id = p_transaction_id;
  
  -- Record payment history
  INSERT INTO public.payment_history (
    transaction_id,
    amount,
    payment_date,
    remaining_amount,
    account_id,
    account_name,
    notes,
    recorded_by,
    recorded_by_name
  ) VALUES (
    p_transaction_id,
    p_amount,
    NOW(),
    v_remaining_amount,
    p_account_id,
    p_account_name,
    p_notes,
    CASE WHEN p_recorded_by IS NOT NULL AND p_recorded_by ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' 
         THEN p_recorded_by::uuid 
         ELSE NULL 
    END,
    p_recorded_by_name
  );
END;
$_$;


--
-- Name: pay_supplier_atomic(text, uuid, numeric, text, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_supplier_atomic(p_payable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_payable RECORD;
  v_remaining NUMERIC;
  v_new_paid_amount NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;      -- accounts.id is TEXT
  v_hutang_account_id TEXT;   -- accounts.id is TEXT
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_payable_id IS NULL OR p_payable_id = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get payable info (struktur sesuai tabel accounts_payable yang ada)
  SELECT
    ap.id,
    ap.supplier_name,
    ap.amount,              -- Total amount hutang
    COALESCE(ap.paid_amount, 0) as paid_amount,
    ap.status
  INTO v_payable
  FROM accounts_payable ap
  WHERE ap.id = p_payable_id AND ap.branch_id = p_branch_id;

  IF v_payable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_payable.status = 'Paid' OR v_payable.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Hutang sudah lunas'::TEXT;
    RETURN;
  END IF;

  -- Calculate new amounts
  v_new_paid_amount := v_payable.paid_amount + p_amount;
  v_remaining := GREATEST(0, v_payable.amount - v_new_paid_amount);

  -- ==================== UPDATE PAYABLE (langsung, tanpa payment record terpisah) ====================

  UPDATE accounts_payable
  SET
    paid_amount = v_new_paid_amount,
    status = CASE WHEN v_remaining <= 0 THEN 'Paid' ELSE 'Partial' END,
    paid_at = CASE WHEN v_remaining <= 0 THEN NOW() ELSE paid_at END,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_payable_id;

  -- Generate a payment ID for tracking
  v_payment_id := gen_random_uuid();

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Get account IDs
  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_hutang_account_id
  FROM accounts
  WHERE code = '2110' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_hutang_account_id IS NOT NULL THEN
    DECLARE
       v_journal_lines JSONB;
       v_journal_res RECORD;
    BEGIN
       -- Dr. Hutang Usaha
       -- Cr. Kas/Bank
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_hutang_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Bayar ke %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         ),
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pembayaran hutang: %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Bayar hutang ke: %s', COALESCE(v_payable.supplier_name, 'Supplier')),
         'payable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
         v_journal_id := v_journal_res.journal_id;
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal pembayaran hutang: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: pay_supplier_atomic(text, uuid, numeric, uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pay_supplier_atomic(p_payable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_payable RECORD;
  v_remaining NUMERIC;
  v_new_paid_amount NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;
  v_hutang_account_id TEXT;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_payable_id IS NULL OR p_payable_id = '' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get payable info
  SELECT
    ap.id,
    ap.supplier_name,
    ap.amount,
    COALESCE(ap.paid_amount, 0) as paid_amount,
    ap.status
  INTO v_payable
  FROM accounts_payable ap
  WHERE ap.id = p_payable_id AND ap.branch_id = p_branch_id;

  IF v_payable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Payable not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_payable.status = 'Paid' OR v_payable.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Hutang sudah lunas'::TEXT;
    RETURN;
  END IF;

  -- Calculate new amounts
  v_new_paid_amount := v_payable.paid_amount + p_amount;
  v_remaining := GREATEST(0, v_payable.amount - v_new_paid_amount);

  -- ==================== UPDATE PAYABLE ====================

  UPDATE accounts_payable
  SET
    paid_amount = v_new_paid_amount,
    status = CASE WHEN v_remaining <= 0 THEN 'Paid' ELSE 'Partial' END,
    paid_at = CASE WHEN v_remaining <= 0 THEN NOW() ELSE paid_at END,
    notes = COALESCE(p_notes, notes)
  WHERE id = p_payable_id;

  v_payment_id := gen_random_uuid();

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id::TEXT;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_hutang_account_id
  FROM accounts
  WHERE code = '2110' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_hutang_account_id IS NOT NULL THEN
    DECLARE
       v_journal_lines JSONB;
       v_journal_res RECORD;
    BEGIN
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_hutang_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Bayar ke %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         ),
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pembayaran hutang: %s', COALESCE(v_payable.supplier_name, 'Supplier'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Bayar hutang ke: %s', COALESCE(v_payable.supplier_name, 'Supplier')),
         'payable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
         v_journal_id := v_journal_res.journal_id;
       ELSE
         RAISE EXCEPTION 'Gagal membuat jurnal pembayaran hutang: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: populate_commission_product_info(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.populate_commission_product_info() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Try to get product name from products table
  SELECT p.name 
  INTO NEW.product_name
  FROM products p 
  WHERE p.id = NEW.product_id;
  
  -- If product name not found, use product_id as fallback
  IF NEW.product_name IS NULL THEN
    NEW.product_name = COALESCE(NEW.product_name, NEW.product_id::text);
  END IF;
  
  NEW.updated_at = NOW();

  RETURN NEW;
END;
$$;


--
-- Name: post_journal_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_journal_atomic(p_journal_id uuid, p_branch_id uuid) RETURNS TABLE(success boolean, message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal RECORD;
BEGIN
  SELECT id, status, total_debit, total_credit INTO v_journal
  FROM journal_entries
  WHERE id = p_journal_id AND branch_id = p_branch_id;

  IF v_journal.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal entry not found'::TEXT;
    RETURN;
  END IF;

  IF v_journal.status = 'posted' THEN
    RETURN QUERY SELECT TRUE, 'Journal already posted'::TEXT;
    RETURN;
  END IF;

  IF v_journal.total_debit != v_journal.total_credit THEN
    RETURN QUERY SELECT FALSE, 'Journal is not balanced'::TEXT;
    RETURN;
  END IF;

  UPDATE journal_entries
  SET status = 'posted',
      updated_at = NOW()
  WHERE id = p_journal_id;

  RETURN QUERY SELECT TRUE, 'Journal posted successfully'::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: prevent_posted_journal_lines_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_posted_journal_lines_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_journal_status TEXT;
  v_is_voided BOOLEAN;
BEGIN
  -- Get parent journal status
  SELECT status, is_voided
  INTO v_journal_status, v_is_voided
  FROM journal_entries
  WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
  -- Allow changes if journal is draft
  IF v_journal_status = 'draft' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Allow deletes if journal is being voided
  IF v_is_voided = TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Prevent changes on posted journal lines
  IF v_journal_status = 'posted' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Cannot delete lines from posted journal. Void the journal instead.';
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.debit_amount IS DISTINCT FROM NEW.debit_amount
         OR OLD.credit_amount IS DISTINCT FROM NEW.credit_amount
         OR OLD.account_id IS DISTINCT FROM NEW.account_id THEN
        RAISE EXCEPTION 'Cannot update lines in posted journal. Void the journal instead.';
      END IF;
    ELSIF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Cannot add lines to posted journal. Void and create new instead.';
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: FUNCTION prevent_posted_journal_lines_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_posted_journal_lines_update() IS 'Prevents modification of posted journal lines';


--
-- Name: prevent_posted_journal_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_posted_journal_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Allow if changing from draft to posted
  IF OLD.status = 'draft' AND NEW.status = 'posted' THEN
    RETURN NEW;
  END IF;
  -- Allow if voiding (is_voided changing to true)
  IF OLD.is_voided IS DISTINCT FROM NEW.is_voided THEN
    RETURN NEW;
  END IF;
  -- Allow if changing status to voided
  IF NEW.status = 'voided' AND OLD.status != 'voided' THEN
    RETURN NEW;
  END IF;
  -- Prevent other updates on posted journals
  IF OLD.status = 'posted' THEN
    -- Check if any significant field changed
    IF OLD.total_debit IS DISTINCT FROM NEW.total_debit
       OR OLD.total_credit IS DISTINCT FROM NEW.total_credit
       OR OLD.entry_date IS DISTINCT FROM NEW.entry_date
       OR OLD.description IS DISTINCT FROM NEW.description THEN
      RAISE EXCEPTION 'Cannot update posted journal entry. Use void and create new instead. Journal: %', OLD.entry_number;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: FUNCTION prevent_posted_journal_update(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.prevent_posted_journal_update() IS 'Prevents modification of posted journals - only void allowed';


--
-- Name: preview_closing_entry(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.preview_closing_entry(p_branch_id uuid, p_year integer) RETURNS TABLE(total_pendapatan numeric, total_beban numeric, laba_rugi_bersih numeric, pendapatan_accounts jsonb, beban_accounts jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_closing_date DATE := (p_year || '-12-31')::DATE;
  v_total_pendapatan NUMERIC := 0;
  v_total_beban NUMERIC := 0;
  v_pendapatan_json JSONB := '[]'::JSONB;
  v_beban_json JSONB := '[]'::JSONB;
  v_acc RECORD;
BEGIN
  -- Pendapatan
  FOR v_acc IN 
    SELECT a.id, a.code, a.name, ABS(SUM(l.debit_amount - l.credit_amount)) as balance
    FROM accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries j ON j.id = l.journal_entry_id
    WHERE a.branch_id = p_branch_id 
      AND a.type = 'Pendapatan'
      AND j.status = 'posted' AND j.is_voided = FALSE
      AND j.entry_date BETWEEN (p_year || '-01-01')::DATE AND v_closing_date
    GROUP BY a.id, a.code, a.name
    HAVING SUM(l.debit_amount - l.credit_amount) != 0
  LOOP
    v_total_pendapatan := v_total_pendapatan + v_acc.balance;
    v_pendapatan_json := v_pendapatan_json || jsonb_build_object(
      'id', v_acc.id,
      'code', v_acc.code,
      'name', v_acc.name,
      'balance', v_acc.balance
    );
  END LOOP;
  -- Beban
  FOR v_acc IN 
    SELECT a.id, a.code, a.name, ABS(SUM(l.debit_amount - l.credit_amount)) as balance
    FROM accounts a
    JOIN journal_entry_lines l ON l.account_id = a.id
    JOIN journal_entries j ON j.id = l.journal_entry_id
    WHERE a.branch_id = p_branch_id 
      AND a.type = 'Beban'
      AND j.status = 'posted' AND j.is_voided = FALSE
      AND j.entry_date BETWEEN (p_year || '-01-01')::DATE AND v_closing_date
    GROUP BY a.id, a.code, a.name
    HAVING SUM(l.debit_amount - l.credit_amount) != 0
  LOOP
    v_total_beban := v_total_beban + v_acc.balance;
    v_beban_json := v_beban_json || jsonb_build_object(
      'id', v_acc.id,
      'code', v_acc.code,
      'name', v_acc.name,
      'balance', v_acc.balance
    );
  END LOOP;
  RETURN QUERY SELECT 
    v_total_pendapatan, 
    v_total_beban, 
    v_total_pendapatan - v_total_beban,
    v_pendapatan_json,
    v_beban_json;
END;
$$;


--
-- Name: process_advance_repayment_from_salary(uuid, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_advance_repayment_from_salary(payroll_record_id uuid, advance_deduction_amount numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  payroll_record RECORD;
  remaining_deduction DECIMAL(15,2);
  advance_record RECORD;
  repayment_amount DECIMAL(15,2);
BEGIN
  -- Get payroll record details
  SELECT pr.*, p.full_name as employee_name
  INTO payroll_record
  FROM public.payroll_records pr
  JOIN public.profiles p ON p.id = pr.employee_id
  WHERE pr.id = payroll_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;
  remaining_deduction := advance_deduction_amount;
  -- Process advances in chronological order (FIFO)
  FOR advance_record IN
    SELECT ea.*, (ea.amount - COALESCE(SUM(ar.amount), 0)) as remaining_amount
    FROM public.employee_advances ea
    LEFT JOIN public.advance_repayments ar ON ar.advance_id = ea.id
    WHERE ea.employee_id = payroll_record.employee_id
      AND ea.date <= payroll_record.period_end
    GROUP BY ea.id, ea.amount, ea.date, ea.employee_id, ea.employee_name, ea.notes, ea.created_at, ea.account_id, ea.account_name
    HAVING (ea.amount - COALESCE(SUM(ar.amount), 0)) > 0
    ORDER BY ea.date ASC
  LOOP
    -- Calculate repayment amount for this advance
    repayment_amount := LEAST(remaining_deduction, advance_record.remaining_amount);
    -- Create repayment record
    INSERT INTO public.advance_repayments (
      id,
      advance_id,
      amount,
      date,
      recorded_by,
      notes
    ) VALUES (
      'rep-' || extract(epoch from now())::bigint || '-' || substring(advance_record.id from 5),
      advance_record.id,
      repayment_amount,
      payroll_record.payment_date,
      payroll_record.created_by,
      'Pemotongan gaji ' || TO_CHAR(DATE(payroll_record.period_year || '-' || payroll_record.period_month || '-01'), 'Month YYYY')
    );
    -- Update remaining deduction
    remaining_deduction := remaining_deduction - repayment_amount;
    -- Update remaining amount using RPC
    PERFORM public.update_remaining_amount(advance_record.id);
    -- Exit if all deduction is processed
    IF remaining_deduction <= 0 THEN
      EXIT;
    END IF;
  END LOOP;
  -- Update account balances for the repayments
  -- Decrease panjar karyawan account (1220)
  PERFORM public.update_account_balance('acc-1220', -advance_deduction_amount);
END;
$$;


--
-- Name: process_delivery_atomic(text, jsonb, uuid, uuid, uuid, timestamp with time zone, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_delivery_atomic(p_transaction_id text, p_items jsonb, p_branch_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_delivery_id UUID;
  v_transaction RECORD;
  v_item JSONB;
  v_consume_result RECORD;
  v_total_hpp_real NUMERIC := 0; 
  v_journal_id UUID;
  v_acc_tertahan TEXT;
  v_acc_persediaan TEXT;
  v_delivery_number INTEGER;
  v_product_id UUID;
  v_qty NUMERIC;
  v_product_name TEXT;
  v_is_bonus BOOLEAN;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
  v_entry_number TEXT;
  v_counter_int INTEGER;
  v_item_type TEXT;
  v_material_id UUID;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction ID is required'::TEXT;
    RETURN;
  END IF;

  SELECT * INTO v_transaction FROM transactions WHERE id = p_transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== CREATE DELIVERY HEADER ====================
  SELECT COALESCE(MAX(d.delivery_number), 0) + 1 INTO v_delivery_number 
  FROM deliveries d 
  WHERE d.transaction_id = p_transaction_id;

  INSERT INTO deliveries (
    transaction_id, delivery_number, branch_id, status, 
    customer_name, customer_address, customer_phone,
    driver_id, helper_id, helper_id_2, helper_id_3, delivery_date, notes, photo_url,
    created_at, updated_at
  )
  VALUES (
    p_transaction_id, v_delivery_number, p_branch_id, 'delivered',
    v_transaction.customer_name, NULL, NULL,
    p_driver_id, p_helper_id, p_helper_id_2, p_helper_id_3, p_delivery_date, 
    COALESCE(p_notes, format('Pengiriman ke-%s', v_delivery_number)), p_photo_url,
    NOW(), NOW()
  )
  RETURNING id INTO v_delivery_id;

  -- ==================== CONSUME STOCK & ITEMS ====================
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        v_product_id := NULL;
        v_material_id := NULL;
        v_qty := (v_item->>'quantity')::NUMERIC;
        v_product_name := v_item->>'product_name';
        v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
        v_item_type := v_item->>'item_type';

        IF (v_item->>'product_id') LIKE 'material-%' THEN
          v_material_id := (v_item->>'material_id')::UUID;
        ELSE
          v_product_id := (v_item->>'product_id')::UUID;
        END IF;

        IF v_qty > 0 THEN
           INSERT INTO delivery_items (
             delivery_id, product_id, product_name, quantity_delivered, unit, is_bonus, notes, width, height, created_at
           ) VALUES (
             v_delivery_id, v_product_id, v_product_name, v_qty, 
             COALESCE(v_item->>'unit', 'pcs'), v_is_bonus, v_item->>'notes', 
             (v_item->>'width')::NUMERIC, (v_item->>'height')::NUMERIC, NOW()
           );
           
           IF NOT v_transaction.is_office_sale THEN
                IF v_material_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_material_fifo_v2(
                    v_material_id, v_qty, COALESCE(v_transaction.ref, 'TR-UNKNOWN'), 'delivery', p_branch_id
                  );
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok material: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_cost, 0);
                ELSIF v_product_id IS NOT NULL THEN
                  SELECT * INTO v_consume_result FROM consume_stock_fifo_v2(
                    v_product_id, v_qty, COALESCE(v_transaction.ref, 'TR-UNKNOWN'), 'delivery', p_branch_id
                  );
                  IF NOT v_consume_result.success THEN RAISE EXCEPTION 'Gagal potong stok produk: %', v_consume_result.error_message; END IF;
                  v_total_hpp_real := v_total_hpp_real + COALESCE(v_consume_result.total_hpp, 0);
                END IF;
           END IF;
        END IF;
    END LOOP;

  UPDATE deliveries SET hpp_total = v_total_hpp_real WHERE id = v_delivery_id;

  -- ==================== UPDATE TRANSACTION STATUS ====================
  SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) INTO v_total_ordered
  FROM jsonb_array_elements(v_transaction.items) item
  WHERE NOT COALESCE((item->>'_isSalesMeta')::BOOLEAN, FALSE);

  SELECT COALESCE(SUM(di.quantity_delivered), 0) INTO v_total_delivered
  FROM delivery_items di
  JOIN deliveries d ON d.id = di.delivery_id
  WHERE d.transaction_id = p_transaction_id;

  IF v_total_delivered >= v_total_ordered THEN
    v_new_status := 'Selesai';
  ELSE
    v_new_status := 'Diantar Sebagian';
  END IF;

  UPDATE transactions
  SET status = v_new_status, delivery_status = 'delivered', delivered_at = NOW(), updated_at = NOW()
  WHERE id = p_transaction_id;

  -- ==================== JOURNAL ENTRY ====================
  IF NOT v_transaction.is_office_sale AND v_total_hpp_real > 0 THEN
      SELECT id INTO v_acc_tertahan FROM accounts WHERE code = '2140' AND branch_id = p_branch_id LIMIT 1;
      IF v_acc_tertahan IS NULL THEN
        SELECT id INTO v_acc_tertahan FROM accounts WHERE name ILIKE '%Hutang Barang%' AND branch_id = p_branch_id LIMIT 1;
      END IF;
      SELECT id INTO v_acc_persediaan FROM accounts WHERE code = '1310' AND branch_id = p_branch_id LIMIT 1;

      IF v_acc_tertahan IS NOT NULL AND v_acc_persediaan IS NOT NULL THEN
         SELECT COUNT(*) INTO v_counter_int FROM journal_entries WHERE branch_id = p_branch_id AND DATE(entry_date) = DATE(p_delivery_date);
         LOOP
            v_counter_int := v_counter_int + 1;
            v_entry_number := 'JE-DEL-' || TO_CHAR(p_delivery_date, 'YYYYMMDD') || '-' || LPAD(v_counter_int::TEXT, 4, '0');
            BEGIN
                INSERT INTO journal_entries (
                  entry_number, entry_date, description, reference_type, reference_id, branch_id, status, total_debit, total_credit
                ) VALUES (
                  v_entry_number, p_delivery_date, format('Pengiriman %s [Order %s]', COALESCE(v_transaction.ref, ''), p_transaction_id), 'transaction', v_delivery_id::TEXT, p_branch_id, 'posted', v_total_hpp_real, v_total_hpp_real
                ) RETURNING id INTO v_journal_id;
                EXIT;
            EXCEPTION WHEN unique_violation THEN END;
         END LOOP;
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
         VALUES (v_journal_id, 1, v_acc_tertahan, 'Realisasi Pengiriman', v_total_hpp_real, 0);
         INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
         VALUES (v_journal_id, 2, v_acc_persediaan, 'Barang Keluar Gudang', 0, v_total_hpp_real);
      END IF;
  END IF;

  -- ==================== GENERATE COMMISSIONS ====================
  IF p_driver_id IS NOT NULL OR p_helper_id IS NOT NULL OR p_helper_id_2 IS NOT NULL OR p_helper_id_3 IS NOT NULL THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
      v_product_id := (v_item->>'product_id')::UUID;
      v_qty := (v_item->>'quantity')::NUMERIC;
      v_product_name := v_item->>'product_name';
      v_is_bonus := COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE);
      IF v_qty > 0 AND NOT v_is_bonus THEN
        IF p_driver_id IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_driver_id, (SELECT full_name FROM profiles WHERE id = p_driver_id), 'driver', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'driver' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id, (SELECT full_name FROM profiles WHERE id = p_helper_id), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id_2 IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id_2, (SELECT full_name FROM profiles WHERE id = p_helper_id_2), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
        IF p_helper_id_3 IS NOT NULL THEN
          INSERT INTO commission_entries (user_id, user_name, role, product_id, product_name, quantity, rate_per_qty, amount, transaction_id, delivery_id, ref, status, branch_id, created_at)
          SELECT p_helper_id_3, (SELECT full_name FROM profiles WHERE id = p_helper_id_3), 'helper', v_product_id, v_product_name, v_qty, cr.rate_per_qty, v_qty * cr.rate_per_qty, p_transaction_id, v_delivery_id, 'DEL-' || v_delivery_id, 'pending', p_branch_id, NOW()
          FROM commission_rules cr WHERE cr.product_id = v_product_id AND cr.role = 'helper' AND cr.rate_per_qty > 0;
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT TRUE, v_delivery_id, v_delivery_number, v_total_hpp_real, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: process_delivery_atomic_no_stock(text, jsonb, uuid, uuid, uuid, timestamp with time zone, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_delivery_atomic_no_stock(p_transaction_id text, p_items jsonb, p_branch_id uuid, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, delivery_id uuid, delivery_number integer, total_hpp numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_delivery_id UUID;
  v_delivery_number INTEGER;
  v_transaction RECORD;
  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_product_name TEXT;
  v_is_bonus BOOLEAN;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  SELECT id, customer_name, customer_address, customer_phone, items INTO v_transaction FROM transactions WHERE id = p_transaction_id AND branch_id = p_branch_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, 'Transaction not found'::TEXT;
    RETURN;
  END IF;

  SELECT COALESCE(MAX(d.delivery_number), 0) + 1 INTO v_delivery_number FROM deliveries d WHERE d.transaction_id = p_transaction_id;

  INSERT INTO deliveries (
    transaction_id, delivery_number, branch_id, customer_name, driver_id, helper_id, helper_id_2, helper_id_3, delivery_date, status, notes, photo_url, created_at, updated_at
  ) VALUES (
    p_transaction_id, v_delivery_number, p_branch_id, v_transaction.customer_name, p_driver_id, p_helper_id, p_helper_id_2, p_helper_id_3, p_delivery_date, 'delivered', COALESCE(p_notes, format('Pengiriman ke-%s (Migrasi)', v_delivery_number)), p_photo_url, NOW(), NOW()
  ) RETURNING id INTO v_delivery_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO delivery_items (delivery_id, product_id, product_name, quantity_delivered, unit, is_bonus, notes, width, height, created_at)
    VALUES (v_delivery_id, (v_item->>'product_id')::UUID, v_item->>'product_name', (v_item->>'quantity')::NUMERIC, v_item->>'unit', COALESCE((v_item->>'is_bonus')::BOOLEAN, FALSE), v_item->>'notes', (v_item->>'width')::NUMERIC, (v_item->>'height')::NUMERIC, NOW());
  END LOOP;

  SELECT COALESCE(SUM((item->>'quantity')::NUMERIC), 0) INTO v_total_ordered FROM jsonb_array_elements(v_transaction.items) item;
  SELECT COALESCE(SUM(di.quantity_delivered), 0) INTO v_total_delivered FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id WHERE d.transaction_id = p_transaction_id;

  IF v_total_delivered >= v_total_ordered THEN v_new_status := 'Selesai'; ELSE v_new_status := 'Diantar Sebagian'; END IF;
  UPDATE transactions SET status = v_new_status WHERE id = p_transaction_id;

  RETURN QUERY SELECT TRUE, v_delivery_id, v_delivery_number, 0::NUMERIC, NULL::UUID, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: process_laku_kantor_atomic(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_laku_kantor_atomic(p_transaction_id text, p_branch_id uuid) RETURNS TABLE(success boolean, total_hpp numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: FUNCTION process_laku_kantor_atomic(p_transaction_id text, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.process_laku_kantor_atomic(p_transaction_id text, p_branch_id uuid) IS 'Atomic laku kantor: immediate stock consume + HPP journal. WAJIB branch_id.';


--
-- Name: process_migration_delivery_journal(uuid, numeric, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_migration_delivery_journal(p_delivery_id uuid, p_delivery_value numeric, p_branch_id uuid, p_customer_name text, p_transaction_id text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
  v_entry_number TEXT;
  v_modal_tertahan_id TEXT;
  v_pendapatan_id TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_delivery_value <= 0 THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, 'No journal needed for zero value'::TEXT;
    RETURN;
  END IF;
  -- ==================== LOOKUP ACCOUNTS ====================
  -- Find Modal Barang Dagang Tertahan (2140)
  SELECT id INTO v_modal_tertahan_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%modal%barang%tertahan%' OR
    LOWER(name) LIKE '%modal%dagang%tertahan%' OR
    code = '2140'
  )
  AND is_header = FALSE
  LIMIT 1;
  IF v_modal_tertahan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Modal Barang Dagang Tertahan (2140) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- Find Pendapatan Penjualan (4100)
  SELECT id INTO v_pendapatan_id
  FROM accounts
  WHERE (
    LOWER(name) LIKE '%pendapatan%penjualan%' OR
    LOWER(name) LIKE '%penjualan%' OR
    code = '4100'
  )
  AND is_header = FALSE
  AND type = 'revenue'
  LIMIT 1;
  IF v_pendapatan_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Pendapatan Penjualan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CREATE JOURNAL ENTRY ====================
  v_entry_number := 'JE-MIG-DEL-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' ||
                    LPAD((EXTRACT(EPOCH FROM NOW())::BIGINT % 10000)::TEXT, 4, '0');
  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    is_posted,
    branch_id,
    created_by,
    created_at
  ) VALUES (
    v_entry_number,
    CURRENT_DATE,
    format('[MIGRASI] Pengiriman Barang - %s', p_customer_name),
    'migration_delivery',
    p_delivery_id::TEXT,
    TRUE,
    p_branch_id,
    'System',
    NOW()
  )
  RETURNING id INTO v_journal_id;
  -- ==================== JOURNAL LINE ITEMS ====================
  -- Jurnal pengiriman migrasi:
  -- Dr Modal Barang Dagang Tertahan (2140)
  --    Cr Pendapatan Penjualan (4100)
  --
  -- Ini mengubah "utang sistem" ??? "penjualan sah"
  -- Debit: Modal Barang Dagang Tertahan
  INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_id, v_modal_tertahan_id, p_delivery_value, 0,
    format('Pengiriman migrasi - %s', p_customer_name));
  -- Credit: Pendapatan Penjualan
  INSERT INTO journal_entry_items (journal_entry_id, account_id, debit, credit, description)
  VALUES (v_journal_id, v_pendapatan_id, 0, p_delivery_value,
    format('Pendapatan penjualan migrasi - %s', p_customer_name));
  -- ==================== LOG ====================
  RAISE NOTICE '[Migration Delivery] Journal created for delivery % (Value: %)',
    p_delivery_id, p_delivery_value;
  RETURN QUERY SELECT TRUE, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION process_migration_delivery_journal(p_delivery_id uuid, p_delivery_value numeric, p_branch_id uuid, p_customer_name text, p_transaction_id text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.process_migration_delivery_journal(p_delivery_id uuid, p_delivery_value numeric, p_branch_id uuid, p_customer_name text, p_transaction_id text) IS 'Jurnal pengiriman untuk transaksi migrasi:
   - Dr Modal Barang Dagang Tertahan (2140)
   - Cr Pendapatan Penjualan (4100)
   Ini mengubah "utang sistem" menjadi "penjualan sah"';


--
-- Name: process_payroll_complete(uuid, uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_payroll_complete(p_payroll_id uuid, p_branch_id uuid, p_payment_account_id text, p_payment_date date DEFAULT CURRENT_DATE, p_expense_account_id text DEFAULT NULL::text) RETURNS TABLE(success boolean, journal_id uuid, advances_updated integer, commissions_paid integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payroll RECORD;
  v_journal_id UUID;
  v_journal_success BOOLEAN;
  v_journal_error TEXT;
  v_journal_lines JSONB := '[]'::JSONB;
  v_employee_name TEXT;
  v_gross_salary NUMERIC;
  v_net_salary NUMERIC;
  v_advance_deduction NUMERIC;
  v_salary_deduction NUMERIC;
  v_total_deductions NUMERIC;
  v_advances_updated INTEGER := 0;
  v_commissions_paid INTEGER := 0;
  v_remaining_deduction NUMERIC;
  v_advance RECORD;
  v_amount_to_deduct NUMERIC;
  v_beban_gaji_account TEXT;
  v_panjar_account TEXT;
  v_period_start DATE;
  v_period_end DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_payroll_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_payment_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payment account ID is required'::TEXT;
    RETURN;
  END IF;
  
  -- ==================== GET PAYROLL DATA ====================
  SELECT
    pr.*,
    p.full_name as employee_name
  INTO v_payroll
  FROM payroll_records pr
  LEFT JOIN profiles p ON p.id = pr.employee_id
  WHERE pr.id = p_payroll_id AND pr.branch_id = p_branch_id;
  
  IF v_payroll.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll record not found in this branch'::TEXT;
    RETURN;
  END IF;
  IF v_payroll.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Payroll sudah dibayar'::TEXT;
    RETURN;
  END IF;
  
  -- ==================== PREPARE DATA ====================
  v_employee_name := COALESCE(v_payroll.employee_name, 'Karyawan');
  v_advance_deduction := COALESCE(v_payroll.advance_deduction, 0);
  v_salary_deduction := COALESCE(v_payroll.salary_deduction, 0);
  v_total_deductions := COALESCE(v_payroll.total_deductions, v_advance_deduction + v_salary_deduction);
  v_net_salary := v_payroll.net_salary;
  v_gross_salary := COALESCE(v_payroll.base_salary, 0) +
                    COALESCE(v_payroll.total_commission, 0) +
                    COALESCE(v_payroll.total_bonus, 0);
  v_period_start := v_payroll.period_start;
  v_period_end := v_payroll.period_end;
  
  -- ==================== GET ACCOUNT IDS ====================
  -- Beban Gaji (Keyword Search)
  IF p_expense_account_id IS NOT NULL THEN
    v_beban_gaji_account := p_expense_account_id;
  ELSE
    SELECT id INTO v_beban_gaji_account
    FROM accounts
    WHERE branch_id = p_branch_id 
      AND (name ILIKE '%Beban%' AND name ILIKE '%Gaji%')
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  -- Panjar Karyawan / Kasbon (Keyword Search)
  -- PRIORITAS: "Piutang Karyawan" (1120/1220), lalu "Panjar", lalu "Kasbon"
  SELECT id INTO v_panjar_account
  FROM accounts
  WHERE branch_id = p_branch_id 
    AND (
      (name ILIKE '%Piutang%' AND name ILIKE '%Karyawan%') 
      OR name ILIKE '%Panjar%' 
      OR name ILIKE '%Kasbon%'
    )
    AND is_active = TRUE
  ORDER BY 
    CASE WHEN name ILIKE '%Piutang Karyawan%' THEN 1 ELSE 2 END, -- Prioritaskan 'Piutang Karyawan'
    code ASC
  LIMIT 1;

  IF v_beban_gaji_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Akun Beban Gaji tidak ditemukan (Keyword: Beban Gaji). Mohon periksa nama akun di COA Anda.'::TEXT;
    RETURN;
  END IF;
  
  -- ==================== BUILD JOURNAL LINES ====================
  -- Debit: Beban Gaji (gross salary)
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_beban_gaji_account,
    'debit_amount', v_gross_salary,
    'credit_amount', 0,
    'description', format('Beban gaji %s periode %s-%s',
      v_employee_name,
      EXTRACT(YEAR FROM v_period_start),
      EXTRACT(MONTH FROM v_period_start))
  );
  
  -- Credit: Kas (net salary) - Only if net salary > 0
  IF v_net_salary > 0 THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_id', p_payment_account_id,
      'debit_amount', 0,
      'credit_amount', v_net_salary,
      'description', format('Pembayaran gaji %s', v_employee_name)
    );
  END IF;
  
  -- Credit: Panjar Karyawan (if any deductions)
  IF v_advance_deduction > 0 AND v_panjar_account IS NOT NULL THEN
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_id', v_panjar_account,
      'debit_amount', 0,
      'credit_amount', v_advance_deduction,
      'description', format('Potongan panjar %s', v_employee_name)
    );
  END IF;

  -- Credit: Other deductions (salary deduction)
  IF v_salary_deduction > 0 THEN
    -- Find an adjustment/income account for deductions
    DECLARE
      v_adjustment_account TEXT;
    BEGIN
      SELECT id INTO v_adjustment_account FROM accounts 
      WHERE branch_id = p_branch_id 
        AND (name ILIKE '%Pendapatan%Lain%' OR name ILIKE '%Penyesuaian%' OR name ILIKE '%Potongan%')
        AND is_active = TRUE LIMIT 1;
        
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', COALESCE(v_adjustment_account, p_payment_account_id), -- Fallback to payment account if no adjustment account
        'debit_amount', 0,
        'credit_amount', v_salary_deduction,
        'description', format('Potongan gaji lainnya %s', v_employee_name)
      );
    END;
  END IF;
  
  -- ==================== CREATE JOURNAL ====================
  SELECT c.success, c.journal_id, c.error_message 
  INTO v_journal_success, v_journal_id, v_journal_error
  FROM create_journal_atomic(
    p_branch_id := p_branch_id,
    p_description := format('Pembayaran Gaji %s - %s/%s',
      v_employee_name,
      EXTRACT(MONTH FROM v_period_start),
      EXTRACT(YEAR FROM v_period_start)),
    p_reference_type := 'payroll',
    p_reference_id := p_payroll_id::TEXT,
    p_lines := v_journal_lines,
    p_entry_date := p_payment_date,
    p_auto_post := TRUE,
    p_created_by := NULL::uuid
  ) c;

  -- Validation: Ensure journal was created successfully
  IF NOT v_journal_success OR v_journal_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0,
      'Gagal Jurnal: ' || COALESCE(v_journal_error, 'Unknown Error')::TEXT;
    RETURN;
  END IF;

  -- ==================== UPDATE PAYROLL STATUS ====================
  UPDATE payroll_records
  SET
    status = 'paid',
    paid_date = p_payment_date,
    payment_account_id = p_payment_account_id,
    paid_by = auth.uid()::TEXT, -- Capture who paid
    updated_at = NOW()
  WHERE id = p_payroll_id;
  
  -- ==================== UPDATE EMPLOYEE ADVANCES ====================
  -- NEW: Correctly record repayment in advance_repayments table for audit trail and consistency
  IF v_advance_deduction > 0 AND v_payroll.employee_id IS NOT NULL THEN
    v_remaining_deduction := v_advance_deduction;
    
    FOR v_advance IN
      SELECT id, remaining_amount, amount
      FROM employee_advances
      WHERE employee_id = v_payroll.employee_id
        AND remaining_amount > 0
        AND branch_id = p_branch_id
      ORDER BY date ASC  -- FIFO: oldest first
    LOOP
      EXIT WHEN v_remaining_deduction <= 0;
      
      v_amount_to_deduct := LEAST(v_remaining_deduction, v_advance.remaining_amount);
      
      -- 1. Insert into advance_repayments (This is what get_outstanding_advances uses!)
      INSERT INTO advance_repayments (
        id,
        advance_id,
        amount,
        date,
        recorded_by
      ) VALUES (
        'PAY-' || p_payroll_id || '-' || v_advance.id,
        v_advance.id,
        v_amount_to_deduct,
        p_payment_date,
        auth.uid()::TEXT
      );

      -- 2. Update advance balance and status
      UPDATE employee_advances
      SET 
        remaining_amount = remaining_amount - v_amount_to_deduct,
        status = CASE WHEN remaining_amount - v_amount_to_deduct <= 0 THEN 'paid' ELSE 'active' END,
        notes = CASE 
          WHEN remaining_amount - v_amount_to_deduct <= 0 THEN notes || ' (Lunas via Payroll)'
          ELSE notes
        END
      WHERE id = v_advance.id;
      
      v_remaining_deduction := v_remaining_deduction - v_amount_to_deduct;
      v_advances_updated := v_advances_updated + 1;
    END LOOP;
  END IF;
  
  -- ==================== UPDATE COMMISSION ENTRIES ====================
  IF v_payroll.employee_id IS NOT NULL THEN
    UPDATE commission_entries
    SET status = 'paid'
    WHERE user_id = v_payroll.employee_id::TEXT
      AND branch_id = p_branch_id
      AND status = 'pending'
      AND created_at >= v_period_start
      AND created_at <= v_period_end + INTERVAL '1 day';
    GET DIAGNOSTICS v_commissions_paid = ROW_COUNT;
  END IF;
  
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journal_id, v_advances_updated, v_commissions_paid, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: process_production_atomic(uuid, numeric, boolean, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_production_atomic(p_product_id uuid, p_quantity numeric, p_consume_bom boolean DEFAULT true, p_note text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, production_id uuid, production_ref text, total_material_cost numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: process_spoilage_atomic(uuid, numeric, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.process_spoilage_atomic(p_material_id uuid, p_quantity numeric, p_note text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, record_id uuid, record_ref text, spoilage_cost numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: receive_payment_atomic(text, uuid, numeric, text, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receive_payment_atomic(p_receivable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id text DEFAULT NULL::text, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_receivable RECORD;
  v_remaining NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;      -- accounts.id is TEXT
  v_piutang_account_id TEXT;  -- accounts.id is TEXT
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_receivable_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Receivable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get transaction info (acting as receivable)
  SELECT
    t.id,
    t.customer_id,
    t.total,
    COALESCE(t.paid_amount, 0) as paid_amount,
    COALESCE(t.total - COALESCE(t.paid_amount, 0), 0) as remaining_amount,
    t.payment_status as status,
    c.name as customer_name
  INTO v_receivable
  FROM transactions t
  LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.id = p_receivable_id::TEXT AND t.branch_id = p_branch_id; -- Cast UUID param to TEXT for transactions.id

  IF v_receivable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_receivable.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction already fully paid'::TEXT;
    RETURN;
  END IF;

  -- Calculate new remaining
  v_remaining := GREATEST(0, v_receivable.remaining_amount - p_amount);

  -- ==================== CREATE PAYMENT RECORD ====================
  -- Using transaction_payments table
  
  INSERT INTO transaction_payments (
    transaction_id,
    branch_id,
    amount,
    payment_method,
    payment_date,
    notes,
    created_at
  ) VALUES (
    p_receivable_id::TEXT,
    p_branch_id,
    p_amount,
    p_payment_method,
    p_payment_date,
    COALESCE(p_notes, format('Payment from %s', COALESCE(v_receivable.customer_name, 'Customer'))),
    NOW()
  )
  RETURNING id INTO v_payment_id;

  -- ==================== UPDATE TRANSACTION ====================

  UPDATE transactions
  SET
    paid_amount = COALESCE(paid_amount, 0) + p_amount,
    payment_status = CASE WHEN v_remaining <= 0 THEN 'Lunas' ELSE 'Partial' END,
    updated_at = NOW()
  WHERE id = p_receivable_id::TEXT;

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Get account IDs
  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id
  FROM accounts
  WHERE code = '1210' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_piutang_account_id IS NOT NULL THEN
    DECLARE
      v_journal_lines JSONB;
      v_journal_res RECORD;
    BEGIN
       -- Dr. Kas/Bank
       -- Cr. Piutang Usaha
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer'))
         ),
         jsonb_build_object(
           'account_id', v_piutang_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Terima pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')),
         'receivable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
          v_journal_id := v_journal_res.journal_id;
       ELSE
          RAISE EXCEPTION 'Gagal membuat jurnal penerimaan: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: receive_payment_atomic(text, uuid, numeric, uuid, text, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receive_payment_atomic(p_receivable_id text, p_branch_id uuid, p_amount numeric, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_payment_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, remaining_amount numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment_id UUID;
  v_receivable RECORD;
  v_remaining NUMERIC;
  v_journal_id UUID;
  v_entry_number TEXT;
  v_kas_account_id TEXT;
  v_piutang_account_id TEXT;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_receivable_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Receivable ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get transaction info (acting as receivable)
  SELECT
    t.id,
    t.customer_id,
    t.total,
    COALESCE(t.paid_amount, 0) as paid_amount,
    COALESCE(t.total - COALESCE(t.paid_amount, 0), 0) as remaining_amount,
    t.payment_status as status,
    c.name as customer_name
  INTO v_receivable
  FROM transactions t
  LEFT JOIN customers c ON c.id = t.customer_id
  WHERE t.id = p_receivable_id::TEXT AND t.branch_id = p_branch_id;

  IF v_receivable.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_receivable.status = 'paid' OR v_receivable.status = 'Lunas' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID,
      'Transaction already fully paid'::TEXT;
    RETURN;
  END IF;

  -- Calculate new remaining
  v_remaining := GREATEST(0, v_receivable.remaining_amount - p_amount);

  -- ==================== CREATE PAYMENT RECORD ====================

  INSERT INTO transaction_payments (
    transaction_id,
    branch_id,
    amount,
    payment_method,
    payment_date,
    notes,
    created_at
  ) VALUES (
    p_receivable_id::TEXT,
    p_branch_id,
    p_amount,
    p_payment_method,
    p_payment_date,
    COALESCE(p_notes, format('Payment from %s', COALESCE(v_receivable.customer_name, 'Customer'))),
    NOW()
  )
  RETURNING id INTO v_payment_id;

  -- ==================== UPDATE TRANSACTION ====================

  UPDATE transactions
  SET
    paid_amount = COALESCE(paid_amount, 0) + p_amount,
    payment_status = CASE WHEN v_remaining <= 0 THEN 'Lunas' ELSE 'Partial' END,
    updated_at = NOW()
  WHERE id = p_receivable_id::TEXT;

  -- ==================== CREATE JOURNAL ENTRY ====================

  -- Use provided payment account ID, or fallback based on payment method
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id::TEXT;
  ELSIF p_payment_method = 'transfer' THEN
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1120' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  ELSE
    SELECT id INTO v_kas_account_id
    FROM accounts
    WHERE code = '1110' AND branch_id = p_branch_id AND is_active = TRUE
    LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_account_id
  FROM accounts
  WHERE code = '1210' AND branch_id = p_branch_id AND is_active = TRUE
  LIMIT 1;

  IF v_kas_account_id IS NOT NULL AND v_piutang_account_id IS NOT NULL THEN
    DECLARE
      v_journal_lines JSONB;
      v_journal_res RECORD;
    BEGIN
       v_journal_lines := jsonb_build_array(
         jsonb_build_object(
           'account_id', v_kas_account_id,
           'debit_amount', p_amount,
           'credit_amount', 0,
           'description', format('Terima dari %s', COALESCE(v_receivable.customer_name, 'Customer'))
         ),
         jsonb_build_object(
           'account_id', v_piutang_account_id,
           'debit_amount', 0,
           'credit_amount', p_amount,
           'description', format('Pelunasan piutang: %s', COALESCE(v_receivable.customer_name, 'Customer'))
         )
       );

       SELECT * INTO v_journal_res FROM create_journal_atomic(
         p_branch_id,
         p_payment_date,
         format('Terima pembayaran piutang: %s', COALESCE(v_receivable.customer_name, 'Customer')),
         'receivable_payment',
         v_payment_id::TEXT,
         v_journal_lines,
         TRUE
       );

       IF v_journal_res.success THEN
          v_journal_id := v_journal_res.journal_id;
       ELSE
          RAISE EXCEPTION 'Gagal membuat jurnal penerimaan: %', v_journal_res.error_message;
       END IF;
    END;
  END IF;

  RETURN QUERY SELECT
    TRUE,
    v_payment_id,
    v_remaining,
    v_journal_id,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: receive_po_atomic(text, uuid, date, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receive_po_atomic(p_po_id text, p_branch_id uuid, p_received_date date DEFAULT CURRENT_DATE, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_material RECORD;
  v_materials_received INTEGER := 0;
  v_products_received INTEGER := 0;
  v_batches_created INTEGER := 0;
  v_previous_stock NUMERIC;
  v_new_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

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

  -- Get PO info
  SELECT
    po.id,
    po.status,
    po.supplier_id,
    po.supplier_name,
    po.material_id,
    po.material_name,
    po.quantity,
    po.unit_price,
    po.branch_id
  INTO v_po
  FROM purchase_orders po
  WHERE po.id = p_po_id AND po.branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_po.status = 'Diterima' THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      'Purchase Order sudah diterima sebelumnya'::TEXT;
    RETURN;
  END IF;

  IF v_po.status NOT IN ('Approved', 'Pending', 'Dikirim') THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      format('Status PO harus Approved, Pending, atau Dikirim, status saat ini: %s', v_po.status)::TEXT;
    RETURN;
  END IF;

  -- ==================== PROCESS MULTI-ITEM PO ====================

  FOR v_item IN
    SELECT
      poi.id,
      poi.material_id,
      poi.product_id,
      poi.item_type,
      poi.quantity,
      poi.unit_price,
      poi.unit,
      poi.material_name,
      poi.product_name,
      m.name as material_name_from_rel,
      m.stock as material_current_stock,
      p.name as product_name_from_rel
    FROM purchase_order_items poi
    LEFT JOIN materials m ON m.id = poi.material_id
    LEFT JOIN products p ON p.id = poi.product_id
    WHERE poi.purchase_order_id = p_po_id
  LOOP
    IF v_item.material_id IS NOT NULL THEN
      -- ==================== PROCESS MATERIAL ====================
      v_previous_stock := COALESCE(v_item.material_current_stock, 0);
      v_new_stock := v_previous_stock + v_item.quantity;

      -- Update material stock
      UPDATE materials
      SET stock = v_new_stock,
          updated_at = NOW()
      WHERE id = v_item.material_id;

      -- Create material movement record
      INSERT INTO material_stock_movements (
        material_id,
        material_name,
        type,
        reason,
        quantity,
        previous_stock,
        new_stock,
        reference_id,
        reference_type,
        notes,
        user_id,
        user_name,
        branch_id,
        created_at
      ) VALUES (
        v_item.material_id,
        COALESCE(v_item.material_name_from_rel, v_item.material_name, 'Unknown'),
        'IN',
        'PURCHASE',
        v_item.quantity,
        v_previous_stock,
        v_new_stock,
        p_po_id,
        'purchase_order',
        format('PO %s - Stock received', p_po_id),
        p_user_id,
        p_user_name,
        p_branch_id,
        NOW()
      );

      -- Create inventory batch for FIFO tracking
      INSERT INTO inventory_batches (
        material_id,
        branch_id,
        purchase_order_id,
        supplier_id,
        initial_quantity,
        remaining_quantity,
        unit_cost,
        batch_date,
        notes,
        created_at
      ) VALUES (
        v_item.material_id,
        p_branch_id,
        p_po_id,
        v_po.supplier_id,
        v_item.quantity,
        v_item.quantity,
        COALESCE(v_item.unit_price, 0),
        p_received_date,
        format('PO %s - %s', p_po_id, COALESCE(v_item.material_name_from_rel, v_item.material_name, 'Unknown')),
        NOW()
      );

      v_materials_received := v_materials_received + 1;
      v_batches_created := v_batches_created + 1;

    ELSIF v_item.product_id IS NOT NULL THEN
      -- ==================== PROCESS PRODUCT ====================
      -- products.current_stock is DEPRECATED - stock derived from inventory_batches
      -- Only create inventory_batches, stock will be calculated via v_product_current_stock VIEW

      -- Create inventory batch for FIFO tracking - this IS the stock
      INSERT INTO inventory_batches (
        product_id,
        branch_id,
        purchase_order_id,
        supplier_id,
        initial_quantity,
        remaining_quantity,
        unit_cost,
        batch_date,
        notes,
        created_at
      ) VALUES (
        v_item.product_id,
        p_branch_id,
        p_po_id,
        v_po.supplier_id,
        v_item.quantity,
        v_item.quantity,
        COALESCE(v_item.unit_price, 0),
        p_received_date,
        format('PO %s - %s', p_po_id, COALESCE(v_item.product_name_from_rel, v_item.product_name, 'Unknown')),
        NOW()
      );

      v_products_received := v_products_received + 1;
      v_batches_created := v_batches_created + 1;
    END IF;
  END LOOP;

  -- ==================== PROCESS LEGACY SINGLE-ITEM PO ====================
  -- For backward compatibility with old PO format (material_id on PO table)

  IF v_materials_received = 0 AND v_products_received = 0 AND v_po.material_id IS NOT NULL THEN
    -- Get current material stock
    SELECT stock INTO v_previous_stock
    FROM materials
    WHERE id = v_po.material_id;

    v_previous_stock := COALESCE(v_previous_stock, 0);
    v_new_stock := v_previous_stock + v_po.quantity;

    -- Update material stock
    UPDATE materials
    SET stock = v_new_stock,
        updated_at = NOW()
    WHERE id = v_po.material_id;

    -- Create material movement record
    INSERT INTO material_stock_movements (
      material_id,
      material_name,
      type,
      reason,
      quantity,
      previous_stock,
      new_stock,
      reference_id,
      reference_type,
      notes,
      user_id,
      user_name,
      branch_id,
      created_at
    ) VALUES (
      v_po.material_id,
      v_po.material_name,
      'IN',
      'PURCHASE',
      v_po.quantity,
      v_previous_stock,
      v_new_stock,
      p_po_id,
      'purchase_order',
      format('PO %s - Stock received (legacy)', p_po_id),
      p_user_id,
      p_user_name,
      p_branch_id,
      NOW()
    );

    -- Create inventory batch
    INSERT INTO inventory_batches (
      material_id,
      branch_id,
      purchase_order_id,
      supplier_id,
      initial_quantity,
      remaining_quantity,
      unit_cost,
      batch_date,
      notes,
      created_at
    ) VALUES (
      v_po.material_id,
      p_branch_id,
      p_po_id,
      v_po.supplier_id,
      v_po.quantity,
      v_po.quantity,
      COALESCE(v_po.unit_price, 0),
      p_received_date,
      format('PO %s - %s (legacy)', p_po_id, v_po.material_name),
      NOW()
    );

    v_materials_received := 1;
    v_batches_created := 1;
  END IF;

  -- ==================== UPDATE PO STATUS ====================

  UPDATE purchase_orders
  SET
    status = 'Diterima',
    received_date = p_received_date
  WHERE id = p_po_id;

  RETURN QUERY SELECT
    TRUE,
    v_materials_received,
    v_products_received,
    v_batches_created,
    NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION receive_po_atomic(p_po_id text, p_branch_id uuid, p_received_date date, p_user_id uuid, p_user_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.receive_po_atomic(p_po_id text, p_branch_id uuid, p_received_date date, p_user_id uuid, p_user_name text) IS 'Atomic PO receive: add inventory batches + update stock + create movements. WAJIB branch_id.';


--
-- Name: receive_po_partial(text, uuid, jsonb, date, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.receive_po_partial(p_po_id text, p_branch_id uuid, p_items jsonb, p_received_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_po RECORD;
  v_item_input JSONB;
  v_poi RECORD;
  v_materials_received INTEGER := 0;
  v_products_received INTEGER := 0;
  v_batches_created INTEGER := 0;
  v_previous_stock NUMERIC;
  v_new_stock NUMERIC;
  v_qty_to_receive NUMERIC;
  v_item_id TEXT;
  v_material_id UUID;
  v_product_id UUID;
  v_all_received BOOLEAN := TRUE;
  v_user_id UUID;
  v_user_name TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Branch ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_po_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Purchase Order ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Tidak ada item yang akan diterima'::TEXT;
    RETURN;
  END IF;

  SELECT po.id, po.status, po.supplier_id, po.supplier_name, po.branch_id
  INTO v_po
  FROM purchase_orders po
  WHERE po.id = p_po_id AND po.branch_id = p_branch_id;

  IF v_po.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0, 'Purchase Order not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_po.status NOT IN ('Approved', 'Pending', 'Dikirim') THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0,
      format('Status PO harus Approved, Pending, atau Dikirim. Status saat ini: %s', v_po.status)::TEXT;
    RETURN;
  END IF;

  FOR v_item_input IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_id := v_item_input->>'item_id';
    v_material_id := (v_item_input->>'material_id')::UUID;
    v_product_id := (v_item_input->>'product_id')::UUID;
    v_qty_to_receive := COALESCE((v_item_input->>'quantity')::NUMERIC, 0);
    v_user_id := (v_item_input->>'user_id')::UUID;
    v_user_name := v_item_input->>'user_name';

    IF v_qty_to_receive <= 0 THEN CONTINUE; END IF;

    SELECT * INTO v_poi
    FROM purchase_order_items
    WHERE id = v_item_id AND purchase_order_id = p_po_id;

    IF v_poi.id IS NULL THEN CONTINUE; END IF;

    IF v_qty_to_receive > (v_poi.quantity - COALESCE(v_poi.quantity_received, 0)) THEN
      v_qty_to_receive := v_poi.quantity - COALESCE(v_poi.quantity_received, 0);
    END IF;

    IF v_qty_to_receive <= 0 THEN CONTINUE; END IF;

    UPDATE purchase_order_items
    SET quantity_received = COALESCE(quantity_received, 0) + v_qty_to_receive, updated_at = NOW()
    WHERE id = v_item_id;

    IF v_material_id IS NOT NULL THEN
      SELECT stock INTO v_previous_stock FROM materials WHERE id = v_material_id;
      v_previous_stock := COALESCE(v_previous_stock, 0);
      v_new_stock := v_previous_stock + v_qty_to_receive;

      UPDATE materials SET stock = v_new_stock, updated_at = NOW() WHERE id = v_material_id;

      INSERT INTO material_stock_movements (
        material_id, material_name, type, reason, quantity,
        previous_stock, new_stock, reference_id, reference_type,
        notes, user_id, user_name, branch_id, created_at
      ) VALUES (
        v_material_id, COALESCE(v_poi.material_name, 'Unknown'),
        'IN', 'PURCHASE', v_qty_to_receive,
        v_previous_stock, v_new_stock, p_po_id, 'purchase_order',
        format('PO %s - Receive (%s)', p_po_id, COALESCE(p_notes, '')),
        v_user_id, v_user_name, p_branch_id, NOW()
      );

      INSERT INTO inventory_batches (
        material_id, branch_id, purchase_order_id, supplier_id,
        initial_quantity, remaining_quantity, unit_cost, batch_date, notes, created_at
      ) VALUES (
        v_material_id, p_branch_id, p_po_id, v_po.supplier_id,
        v_qty_to_receive, v_qty_to_receive, COALESCE(v_poi.unit_price, 0),
        p_received_date, format('PO %s - %s', p_po_id, COALESCE(v_poi.material_name, 'Unknown')), NOW()
      );

      v_materials_received := v_materials_received + 1;
      v_batches_created := v_batches_created + 1;

    ELSIF v_product_id IS NOT NULL THEN
      INSERT INTO inventory_batches (
        product_id, branch_id, purchase_order_id, supplier_id,
        initial_quantity, remaining_quantity, unit_cost, batch_date, notes, created_at
      ) VALUES (
        v_product_id, p_branch_id, p_po_id, v_po.supplier_id,
        v_qty_to_receive, v_qty_to_receive, COALESCE(v_poi.unit_price, 0),
        p_received_date, format('PO %s - %s', p_po_id, COALESCE(v_poi.product_name, 'Unknown')), NOW()
      );

      v_products_received := v_products_received + 1;
      v_batches_created := v_batches_created + 1;
    END IF;
  END LOOP;

  SELECT bool_and(COALESCE(quantity_received, 0) >= quantity) INTO v_all_received
  FROM purchase_order_items WHERE purchase_order_id = p_po_id;

  IF v_all_received THEN
    UPDATE purchase_orders SET status = 'Diterima', received_date = p_received_date WHERE id = p_po_id;
  ELSE
    IF v_po.status = 'Approved' OR v_po.status = 'Pending' THEN
      UPDATE purchase_orders SET status = 'Dikirim', received_date = NULL WHERE id = p_po_id;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, v_materials_received, v_products_received, v_batches_created, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: reconcile_account_balance(text, numeric, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconcile_account_balance(p_account_id text, p_new_balance numeric, p_reason text, p_user_id uuid, p_user_name text) RETURNS TABLE(success boolean, message text, old_balance numeric, new_balance numeric, adjustment_amount numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_balance NUMERIC;
  v_adjustment NUMERIC;
  v_account_name TEXT;
BEGIN
  -- Check if user is owner
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = p_user_id AND role = 'owner'
  ) THEN
    RETURN QUERY SELECT 
      false as success,
      'Access denied. Only owners can reconcile account balances.' as message,
      0::NUMERIC as old_balance,
      0::NUMERIC as new_balance,
      0::NUMERIC as adjustment_amount;
    RETURN;
  END IF;
  -- Get current account info
  SELECT current_balance, name INTO v_old_balance, v_account_name
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false as success,
      'Account not found.' as message,
      0::NUMERIC as old_balance,
      0::NUMERIC as new_balance,
      0::NUMERIC as adjustment_amount;
    RETURN;
  END IF;
  -- Calculate adjustment
  v_adjustment := p_new_balance - v_old_balance;
  -- Update account balance
  UPDATE accounts 
  SET 
    current_balance = p_new_balance,
    updated_at = NOW()
  WHERE id = p_account_id;
  -- Log the reconciliation in cash_history table
  INSERT INTO cash_history (
    account_id,
    transaction_type,
    amount,
    description,
    reference_number,
    created_by,
    created_by_name,
    source_type
  ) VALUES (
    p_account_id,
    CASE WHEN v_adjustment >= 0 THEN 'income'::TEXT ELSE 'expense'::TEXT END,
    ABS(v_adjustment),
    COALESCE(p_reason, 'Balance reconciliation by owner'),
    'RECON-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
    p_user_id,
    p_user_name,
    'reconciliation'
  );
  RETURN QUERY SELECT 
    true as success,
    'Account balance successfully reconciled from ' || v_old_balance::TEXT || ' to ' || p_new_balance::TEXT as message,
    v_old_balance as old_balance,
    p_new_balance as new_balance,
    v_adjustment as adjustment_amount;
END;
$$;


--
-- Name: record_depreciation_atomic(uuid, numeric, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_depreciation_atomic(p_asset_id uuid, p_amount numeric, p_period text, p_branch_id uuid) RETURNS TABLE(success boolean, journal_id uuid, new_current_value numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_asset RECORD;
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_beban_penyusutan_account UUID;
  v_akumulasi_account UUID;
  v_new_current_value NUMERIC;
  v_depreciation_date DATE;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Depreciation amount must be greater than 0'::TEXT;
    RETURN;
  END IF;
  -- Get asset
  SELECT * INTO v_asset
  FROM assets
  WHERE id = p_asset_id AND branch_id = p_branch_id;
  IF v_asset.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Asset not found'::TEXT;
    RETURN;
  END IF;
  -- ==================== FIND ACCOUNTS ====================
  -- Beban Penyusutan (6240)
  SELECT id INTO v_beban_penyusutan_account
  FROM accounts
  WHERE branch_id = p_branch_id
    AND code IN ('6240', '6250')
    AND is_active = TRUE
  LIMIT 1;
  -- Akumulasi Penyusutan - try to find by category
  SELECT id INTO v_akumulasi_account
  FROM accounts
  WHERE branch_id = p_branch_id
    AND (
      code IN ('1421', '1431', '1451', '1461', '1491')  -- Akumulasi accounts
      OR LOWER(name) LIKE '%akumulasi%'
    )
    AND is_active = TRUE
  ORDER BY code
  LIMIT 1;
  IF v_beban_penyusutan_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Akun Beban Penyusutan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_akumulasi_account IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC,
      'Akun Akumulasi Penyusutan tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== CALCULATE NEW VALUE ====================
  v_new_current_value := GREATEST(
    v_asset.salvage_value,
    COALESCE(v_asset.current_value, v_asset.purchase_price) - p_amount
  );
  -- Parse period to date
  BEGIN
    v_depreciation_date := (p_period || '-01')::DATE;
  EXCEPTION WHEN OTHERS THEN
    v_depreciation_date := CURRENT_DATE;
  END;
  -- ==================== CREATE JOURNAL ====================
  -- Debit: Beban Penyusutan
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_beban_penyusutan_account,
    'debit_amount', p_amount,
    'credit_amount', 0,
    'description', format('Penyusutan %s periode %s', v_asset.name, p_period)
  );
  -- Credit: Akumulasi Penyusutan
  v_journal_lines := v_journal_lines || jsonb_build_object(
    'account_id', v_akumulasi_account,
    'debit_amount', 0,
    'credit_amount', p_amount,
    'description', format('Akumulasi penyusutan %s', v_asset.name)
  );
  SELECT cja.journal_id INTO v_journal_id FROM create_journal_atomic(
    p_branch_id,
    v_depreciation_date,
    format('Penyusutan - %s - %s', v_asset.name, p_period),
    'depreciation',
    p_asset_id::TEXT,
    v_journal_lines,
    TRUE
  );
  -- ==================== UPDATE ASSET CURRENT VALUE ====================
  UPDATE assets
  SET current_value = v_new_current_value, updated_at = NOW()
  WHERE id = p_asset_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journal_id, v_new_current_value, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION record_depreciation_atomic(p_asset_id uuid, p_amount numeric, p_period text, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.record_depreciation_atomic(p_asset_id uuid, p_amount numeric, p_period text, p_branch_id uuid) IS 'Record depreciation dengan journal (Dr. Beban Penyusutan, Cr. Akumulasi). WAJIB branch_id.';


--
-- Name: record_payment_history(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_payment_history() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  -- Only trigger if paid_amount increased
  IF NEW.paid_amount > OLD.paid_amount THEN
    INSERT INTO public.payment_history (
      transaction_id,
      amount,
      payment_date,
      remaining_amount,
      recorded_by_name
    ) VALUES (
      NEW.id,
      NEW.paid_amount - OLD.paid_amount,
      NOW(),
      NEW.total - NEW.paid_amount,
      'System Auto-Record'
    );
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: record_receivable_payment(text, numeric, text, text, text, text, text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.record_receivable_payment(p_transaction_id text, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_account_id text DEFAULT NULL::text, p_account_name text DEFAULT 'Kas'::text, p_description text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_reference_number text DEFAULT NULL::text, p_paid_by_user_id uuid DEFAULT NULL::uuid, p_paid_by_user_name text DEFAULT 'System'::text, p_paid_by_user_role text DEFAULT 'staff'::text) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  payment_id UUID;
  transaction_total NUMERIC;
  current_paid NUMERIC;
  new_payment_description TEXT;
BEGIN
  -- Validate transaction exists
  SELECT total INTO transaction_total FROM transactions WHERE id = p_transaction_id;
  IF transaction_total IS NULL THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;
  
  -- Calculate current paid amount
  SELECT COALESCE(SUM(amount), 0) INTO current_paid
  FROM transaction_payments 
  WHERE transaction_id = p_transaction_id AND status = 'active';
  
  -- Validate payment amount
  IF (current_paid + p_amount) > transaction_total THEN
    RAISE EXCEPTION 'Payment amount exceeds remaining balance';
  END IF;
  
  -- Generate description
  new_payment_description := COALESCE(p_description, 'Pembayaran piutang - ' || 
    CASE 
      WHEN (current_paid + p_amount) >= transaction_total THEN 'Pelunasan'
      ELSE 'Pembayaran ke-' || ((SELECT COUNT(*) FROM transaction_payments WHERE transaction_id = p_transaction_id AND status = 'active') + 1)
    END
  );
  
  -- Insert payment record
  INSERT INTO transaction_payments (
    transaction_id, amount, payment_method, account_id, account_name,
    description, notes, reference_number,
    paid_by_user_id, paid_by_user_name, paid_by_user_role, created_by
  ) VALUES (
    p_transaction_id, p_amount, p_payment_method, p_account_id, p_account_name,
    new_payment_description, p_notes, p_reference_number,
    p_paid_by_user_id, p_paid_by_user_name, p_paid_by_user_role, p_paid_by_user_id
  )
  RETURNING id INTO payment_id;
  
  -- Update transaction
  UPDATE transactions 
  SET 
    paid_amount = current_paid + p_amount,
    payment_status = CASE 
      WHEN current_paid + p_amount >= total THEN 'Lunas'::text
      ELSE 'Belum Lunas'::text
    END
  WHERE id = p_transaction_id;
  
  RETURN payment_id;
END;
$$;


--
-- Name: refresh_daily_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_daily_stats() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW public.daily_stats;
END;
$$;


--
-- Name: repay_employee_advance_atomic(uuid, uuid, numeric, date, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.repay_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_amount numeric, p_payment_date date DEFAULT CURRENT_DATE, p_payment_account_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, payment_id uuid, journal_id uuid, remaining_amount numeric, is_fully_paid boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_advance RECORD;
  v_payment_id UUID;
  v_journal_id UUID;
  v_kas_account_id TEXT;
  v_piutang_karyawan_id TEXT;
  v_new_remaining NUMERIC;
  v_journal_res RECORD;
  v_journal_lines JSONB;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get advance record
  SELECT * INTO v_advance
  FROM employee_advances
  WHERE id = p_advance_id AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_advance.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  IF v_advance.status = 'paid' THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, 'Kasbon sudah lunas'::TEXT;
    RETURN;
  END IF;

  IF p_amount > v_advance.remaining_amount THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE,
      format('Jumlah pembayaran (%s) melebihi sisa kasbon (%s)', p_amount, v_advance.remaining_amount)::TEXT;
    RETURN;
  END IF;

  -- ==================== GET ACCOUNT IDS ====================

  -- Use provided payment account ID, or fallback to default 1110
  IF p_payment_account_id IS NOT NULL THEN
    v_kas_account_id := p_payment_account_id::TEXT;
  ELSE
    SELECT id INTO v_kas_account_id FROM accounts
    WHERE branch_id = p_branch_id AND code = '1110' AND is_active = TRUE LIMIT 1;
  END IF;

  SELECT id INTO v_piutang_karyawan_id FROM accounts
  WHERE branch_id = p_branch_id AND code = '1220' AND is_active = TRUE LIMIT 1;

  IF v_piutang_karyawan_id IS NULL THEN
    SELECT id INTO v_piutang_karyawan_id FROM accounts
    WHERE branch_id = p_branch_id AND name ILIKE '%piutang karyawan%' AND is_active = TRUE LIMIT 1;
  END IF;

  -- ==================== CALCULATE NEW REMAINING ====================

  v_new_remaining := v_advance.remaining_amount - p_amount;
  v_payment_id := gen_random_uuid();

  -- ==================== UPDATE ADVANCE RECORD ====================

  UPDATE employee_advances
  SET
    remaining_amount = v_new_remaining,
    status = CASE WHEN v_new_remaining <= 0 THEN 'paid' ELSE 'active' END,
    updated_at = NOW()
  WHERE id = p_advance_id;

  -- ==================== INSERT PAYMENT RECORD ====================

  INSERT INTO employee_advance_payments (
    id,
    advance_id,
    branch_id,
    amount,
    payment_date,
    payment_method,
    notes,
    created_by,
    created_at
  ) VALUES (
    v_payment_id,
    p_advance_id,
    p_branch_id,
    p_amount,
    p_payment_date,
    p_payment_method,
    p_notes,
    auth.uid(),
    NOW()
  );

  -- ==================== CREATE JOURNAL ENTRY ====================

  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_kas_account_id,
      'debit_amount', p_amount,
      'credit_amount', 0,
      'description', 'Penerimaan pembayaran kasbon'
    ),
    jsonb_build_object(
      'account_id', v_piutang_karyawan_id,
      'debit_amount', 0,
      'credit_amount', p_amount,
      'description', 'Pelunasan piutang karyawan'
    )
  );

  SELECT * INTO v_journal_res FROM public.create_journal_atomic(
    p_branch_id,
    'Pembayaran Kasbon - ' || v_advance.employee_name,
    'advance_payment',
    v_payment_id::TEXT,
    v_journal_lines,
    p_payment_date,
    TRUE -- auto_post
  );

  IF NOT v_journal_res.success THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, v_journal_res.error_message;
    RETURN;
  END IF;

  v_journal_id := v_journal_res.journal_id;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_payment_id, v_journal_id, v_new_remaining, (v_new_remaining <= 0), NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, NULL::UUID, 0::NUMERIC, FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: restore_inventory_fifo(uuid, uuid, numeric, numeric, text, text, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_inventory_fifo(p_product_id uuid, p_branch_id uuid, p_quantity numeric, p_unit_cost numeric DEFAULT 0, p_reference_id text DEFAULT NULL::text, p_reason text DEFAULT 'restock'::text, p_notes text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, batch_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_batch_id UUID;
  v_product_name TEXT;
  v_final_notes TEXT;
BEGIN
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  SELECT name INTO v_product_name FROM products WHERE id = p_product_id;
  IF v_product_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Product not found'::TEXT;
    RETURN;
  END IF;

  -- Create New Batch
  INSERT INTO inventory_batches (
    product_id,
    branch_id,
    initial_quantity,
    remaining_quantity,
    unit_cost,
    batch_date,
    notes
  ) VALUES (
    p_product_id,
    p_branch_id,
    p_quantity,
    p_quantity,
    p_unit_cost,
    NOW(),
    COALESCE(p_notes, format('Restock: %s', p_reference_id))
  )
  RETURNING id INTO v_new_batch_id;

  -- Create Log Notes
  v_final_notes := format('FIFO Restore. Batch: %s', v_new_batch_id);
  IF p_notes IS NOT NULL AND p_notes <> '' THEN
      v_final_notes := p_notes || ' | ' || v_final_notes;
  END IF;

  INSERT INTO product_stock_movements (
    product_id,
    branch_id,
    type,
    reason,
    quantity,
    reference_id,
    reference_type,
    notes,
    user_id,
    user_name,
    created_at
  ) VALUES (
    p_product_id,
    p_branch_id,
    'IN',
    p_reason,
    p_quantity,
    p_reference_id,
    'stock_in',
    v_final_notes,
    p_user_id,
    p_user_name,
    NOW()
  );

  RETURN QUERY SELECT TRUE, v_new_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: restore_material_fifo(uuid, uuid, numeric, numeric, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_material_fifo(p_material_id uuid, p_branch_id uuid, p_quantity numeric, p_unit_cost numeric DEFAULT 0, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT 'restore'::text) RETURNS TABLE(success boolean, batch_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_new_batch_id UUID;
  v_material_name TEXT;
  v_current_stock NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_material_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Material ID is required'::TEXT;
    RETURN;
  END IF;

  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;

  -- Get material name
  SELECT name INTO v_material_name
  FROM materials WHERE id = p_material_id;

  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Material not found'::TEXT;
    RETURN;
  END IF;

  -- Get current stock
  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_current_stock
  FROM inventory_batches
  WHERE material_id = p_material_id AND remaining_quantity > 0;

  -- ==================== CREATE BATCH ====================

  INSERT INTO inventory_batches (
    material_id,
    branch_id,
    initial_quantity,
    remaining_quantity,
    unit_cost,
    batch_date,
    notes
  ) VALUES (
    p_material_id,
    p_branch_id,
    p_quantity,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    NOW(),
    format('Restored: %s - %s', p_reference_type, COALESCE(p_reference_id, 'manual'))
  )
  RETURNING id INTO v_new_batch_id;

  -- ==================== LOGGING ====================

  INSERT INTO material_stock_movements (
    material_id,
    material_name,
    type,
    reason,
    quantity,
    previous_stock,
    new_stock,
    reference_id,
    reference_type,
    notes,
    branch_id,
    created_at
  ) VALUES (
    p_material_id,
    v_material_name,
    'IN',
    CASE
       WHEN p_reference_type = 'void_production' THEN 'PRODUCTION_DELETE_RESTORE'
       ELSE 'ADJUSTMENT'
    END, -- Might need check constraint update if we use other reasons
    p_quantity,
    v_current_stock,
    v_current_stock + p_quantity,
    p_reference_id,
    p_reference_type,
    format('FIFO restore: new batch %s', v_new_batch_id),
    p_branch_id,
    NOW()
  );

  -- Update legacy stock column in materials table
  UPDATE materials 
  SET stock = stock + p_quantity,
      updated_at = NOW()
  WHERE id = p_material_id;

  RETURN QUERY SELECT TRUE, v_new_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: restore_material_fifo_v2(uuid, numeric, numeric, text, text, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_material_fifo_v2(p_material_id uuid, p_quantity numeric, p_unit_cost numeric, p_reference_id text, p_reference_type text, p_branch_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, batch_id uuid, total_restored numeric, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_material_name TEXT;
  v_new_batch_id UUID;
  v_current_stock NUMERIC;
BEGIN
  IF p_material_id IS NULL OR p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Invalid parameters'::TEXT;
    RETURN;
  END IF;
  -- Get material info
  SELECT name INTO v_material_name
  FROM materials WHERE id = p_material_id;
  IF v_material_name IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 0::NUMERIC, 'Material not found'::TEXT;
    RETURN;
  END IF;
  -- Get current stock from batches
  SELECT COALESCE(SUM(remaining_quantity), 0) INTO v_current_stock
  FROM inventory_batches
  WHERE material_id = p_material_id
    AND remaining_quantity > 0;
  -- Create new batch for restored stock
  INSERT INTO inventory_batches (
    material_id,
    branch_id,
    initial_quantity,
    remaining_quantity,
    unit_cost,
    batch_date,
    notes
  ) VALUES (
    p_material_id,
    p_branch_id,
    p_quantity,
    p_quantity,
    COALESCE(p_unit_cost, 0),
    NOW(),
    format('Restored from %s: %s', p_reference_type, p_reference_id)
  )
  RETURNING id INTO v_new_batch_id;
  -- Log to material_stock_movements
  INSERT INTO material_stock_movements (
    material_id,
    material_name,
    type,
    reason,
    quantity,
    previous_stock,
    new_stock,
    reference_id,
    reference_type,
    user_id,
    user_name,
    notes,
    branch_id
  ) VALUES (
    p_material_id,
    v_material_name,
    'IN',
    'ADJUSTMENT',
    p_quantity,
    v_current_stock,
    v_current_stock + p_quantity,
    p_reference_id,
    p_reference_type,
    p_user_id,
    COALESCE(p_user_name, 'System'),
    format('FIFO v2 restore: new batch %s', v_new_batch_id),
    p_branch_id
  );
  -- NOTE: We do NOT update materials.stock anymore
  -- Stock is derived from v_material_current_stock view
  RETURN QUERY SELECT TRUE, v_new_batch_id, p_quantity, NULL::TEXT;
END;
$$;


--
-- Name: restore_stock_fifo_v2(uuid, numeric, text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.restore_stock_fifo_v2(p_product_id uuid, p_quantity numeric, p_reference_id text, p_reference_type text, p_branch_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, total_restored numeric, batches_restored jsonb, error_message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_batch RECORD;
  v_remaining NUMERIC := p_quantity;
  v_restored JSONB := '[]'::JSONB;
  v_restore_qty NUMERIC;
  v_space_in_batch NUMERIC;
  v_consumption RECORD;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Product ID is required'::TEXT;
    RETURN;
  END IF;
  IF p_quantity <= 0 THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, '[]'::JSONB, 'Quantity must be positive'::TEXT;
    RETURN;
  END IF;
  -- Strategy 1: Try to restore to original batches if we have consumption log
  SELECT * INTO v_consumption
  FROM inventory_batch_consumptions
  WHERE reference_id = p_reference_id
    AND reference_type = p_reference_type
  ORDER BY consumed_at DESC
  LIMIT 1;
  IF v_consumption IS NOT NULL AND v_consumption.batches_detail IS NOT NULL THEN
    FOR v_batch IN
      SELECT
        (elem->>'batch_id')::UUID as batch_id,
        (elem->>'quantity')::NUMERIC as quantity
      FROM jsonb_array_elements(v_consumption.batches_detail) as elem
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_restore_qty := LEAST(v_batch.quantity, v_remaining);
      UPDATE inventory_batches
      SET remaining_quantity = remaining_quantity + v_restore_qty, updated_at = NOW()
      WHERE id = v_batch.batch_id;
      v_restored := v_restored || jsonb_build_object('batch_id', v_batch.batch_id, 'quantity', v_restore_qty, 'method', 'original_batch');
      v_remaining := v_remaining - v_restore_qty;
    END LOOP;
    UPDATE inventory_batch_consumptions
    SET batches_detail = batches_detail || jsonb_build_object('restored_at', NOW())
    WHERE id = v_consumption.id;
  ELSE
    FOR v_batch IN
      SELECT id, initial_quantity, remaining_quantity
      FROM inventory_batches
      WHERE product_id = p_product_id
        AND (p_branch_id IS NULL OR branch_id = p_branch_id)
        AND remaining_quantity < initial_quantity
      ORDER BY batch_date ASC, created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_space_in_batch := v_batch.initial_quantity - v_batch.remaining_quantity;
      v_restore_qty := LEAST(v_space_in_batch, v_remaining);
      IF v_restore_qty > 0 THEN
        UPDATE inventory_batches
        SET remaining_quantity = remaining_quantity + v_restore_qty, updated_at = NOW()
        WHERE id = v_batch.id;
        v_restored := v_restored || jsonb_build_object('batch_id', v_batch.id, 'quantity', v_restore_qty, 'method', 'available_space');
        v_remaining := v_remaining - v_restore_qty;
      END IF;
    END LOOP;
    IF v_remaining > 0 THEN
      INSERT INTO inventory_batches (product_id, branch_id, batch_date, initial_quantity, remaining_quantity, unit_cost, notes, created_at, updated_at)
      SELECT p_product_id, p_branch_id, NOW(), v_remaining, v_remaining,
        COALESCE((SELECT unit_cost FROM inventory_batches WHERE product_id = p_product_id ORDER BY batch_date DESC LIMIT 1),
                 (SELECT cost_price FROM products WHERE id = p_product_id), 0),
        format('Stock restored from cancelled %s: %s', p_reference_type, p_reference_id), NOW(), NOW()
      RETURNING id INTO v_batch;
      v_restored := v_restored || jsonb_build_object('batch_id', v_batch.id, 'quantity', v_remaining, 'method', 'new_batch');
      v_remaining := 0;
    END IF;
  END IF;
  UPDATE products
  SET current_stock = current_stock + (p_quantity - v_remaining), updated_at = NOW()
  WHERE id = p_product_id;
  RETURN QUERY SELECT TRUE, p_quantity - v_remaining, v_restored, NULL::TEXT;
END;
$$;


--
-- Name: search_customers(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_customers(search_term text DEFAULT ''::text, limit_count integer DEFAULT 50) RETURNS TABLE(id uuid, name text, phone text, address text, order_count integer, last_order_date timestamp with time zone, total_spent numeric)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.name,
    c.phone,
    c.address,
    c."orderCount",
    MAX(t.order_date) as last_order_date,
    COALESCE(SUM(t.total), 0) as total_spent
  FROM public.customers c
  LEFT JOIN public.transactions t ON c.id = t.customer_id
  WHERE 
    (search_term = '' OR 
     c.name ILIKE '%' || search_term || '%' OR
     c.phone ILIKE '%' || search_term || '%')
  GROUP BY c.id, c.name, c.phone, c.address, c."orderCount"
  ORDER BY c.name
  LIMIT limit_count;
END;
$$;


--
-- Name: search_products_with_stock(text, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_products_with_stock(search_term text DEFAULT ''::text, category_filter text DEFAULT NULL::text, limit_count integer DEFAULT 50) RETURNS TABLE(id uuid, name text, category text, base_price numeric, unit text, current_stock numeric, min_order integer, is_low_stock boolean)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.name,
    p.category,
    p.base_price,
    p.unit,
    COALESCE((p.specifications->>'stock')::NUMERIC, 0) as current_stock,
    p.min_order,
    COALESCE((p.specifications->>'stock')::NUMERIC, 0) <= p.min_order as is_low_stock
  FROM public.products p
  WHERE 
    (search_term = '' OR p.name ILIKE '%' || search_term || '%')
    AND (category_filter IS NULL OR p.category = category_filter)
  ORDER BY p.name
  LIMIT limit_count;
END;
$$;


--
-- Name: search_transactions(text, integer, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_transactions(search_term text DEFAULT ''::text, limit_count integer DEFAULT 50, offset_count integer DEFAULT 0, status_filter text DEFAULT NULL::text) RETURNS TABLE(id text, customer_name text, customer_display_name text, cashier_name text, total numeric, paid_amount numeric, payment_status text, status text, order_date timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
  RETURN QUERY
  SELECT 
    t.id,
    t.customer_name,
    c.name as customer_display_name,
    p.full_name as cashier_name,
    t.total,
    t.paid_amount,
    t.payment_status,
    t.status,
    t.order_date,
    t.created_at
  FROM public.transactions t
  LEFT JOIN public.customers c ON t.customer_id = c.id
  LEFT JOIN public.profiles p ON t.cashier_id = p.id
  WHERE 
    (search_term = '' OR 
     t.customer_name ILIKE '%' || search_term || '%' OR
     t.id ILIKE '%' || search_term || '%' OR
     c.name ILIKE '%' || search_term || '%')
    AND (status_filter IS NULL OR t.status = status_filter)
  ORDER BY t.order_date DESC
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;


--
-- Name: set_account_initial_balance(text, numeric, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_account_initial_balance(p_account_id text, p_initial_balance numeric, p_reason text, p_user_id uuid, p_user_name text) RETURNS TABLE(success boolean, message text, old_initial_balance numeric, new_initial_balance numeric)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_initial NUMERIC;
  v_account_name TEXT;
BEGIN
  -- Check if user is owner
  IF NOT EXISTS (
    SELECT 1 FROM profiles 
    WHERE id = p_user_id AND role = 'owner'
  ) THEN
    RETURN QUERY SELECT 
      false as success,
      'Access denied. Only owners can set initial balances.' as message,
      0::NUMERIC as old_initial_balance,
      0::NUMERIC as new_initial_balance;
    RETURN;
  END IF;
  -- Get current initial balance
  SELECT initial_balance, name INTO v_old_initial, v_account_name
  FROM accounts 
  WHERE id = p_account_id;
  
  IF NOT FOUND THEN
    RETURN QUERY SELECT 
      false as success,
      'Account not found.' as message,
      0::NUMERIC as old_initial_balance,
      0::NUMERIC as new_initial_balance;
    RETURN;
  END IF;
  -- Update initial balance
  UPDATE accounts 
  SET 
    initial_balance = p_initial_balance,
    updated_at = NOW()
  WHERE id = p_account_id;
  -- Log the change in cash_history
  INSERT INTO cash_history (
    account_id,
    transaction_type,
    amount,
    description,
    reference_number,
    created_by,
    created_by_name,
    source_type
  ) VALUES (
    p_account_id,
    'income',
    p_initial_balance,
    'Initial balance set: ' || COALESCE(p_reason, 'Initial balance setup'),
    'INIT-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS'),
    p_user_id,
    p_user_name,
    'initial_balance'
  );
  RETURN QUERY SELECT 
    true as success,
    'Initial balance set for ' || v_account_name || ' from ' || COALESCE(v_old_initial::TEXT, 'null') || ' to ' || p_initial_balance::TEXT as message,
    v_old_initial as old_initial_balance,
    p_initial_balance as new_initial_balance;
END;
$$;


--
-- Name: set_retasi_ke(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_retasi_ke() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: set_retasi_ke_and_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_retasi_ke_and_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: set_supplier_code(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_supplier_code() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.code IS NULL OR NEW.code = '' THEN
    NEW.code := generate_supplier_code();
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


--
-- Name: sync_account_balances(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_account_balances() RETURNS TABLE(account_id text, account_code character varying, account_name text, old_balance numeric, new_balance numeric, difference numeric)
    LANGUAGE plpgsql
    AS $$
BEGIN
    RETURN QUERY
    WITH updated AS (
        UPDATE accounts a
        SET balance = vab.calculated_balance,
            updated_at = NOW()
        FROM v_account_balances vab
        WHERE a.id = vab.account_id
          AND ABS(a.balance - vab.calculated_balance) > 0.01
        RETURNING
            a.id, a.code, a.name,
            vab.stored_balance as old_bal,
            vab.calculated_balance as new_bal
    )
    SELECT u.id, u.code, u.name, u.old_bal, u.new_bal, u.new_bal - u.old_bal as diff
    FROM updated u;
END;
$$;


--
-- Name: sync_attendance_checkin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_attendance_checkin() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- If check_in_time is provided, use it for check_in
    IF NEW.check_in_time IS NOT NULL AND NEW.check_in IS NULL THEN
        NEW.check_in := NEW.check_in_time;
    -- If check_in is provided, use it for check_in_time
    ELSIF NEW.check_in IS NOT NULL AND NEW.check_in_time IS NULL THEN
        NEW.check_in_time := NEW.check_in;
    END IF;
    
    -- Same for check_out
    IF NEW.check_out_time IS NOT NULL AND NEW.check_out IS NULL THEN
        NEW.check_out := NEW.check_out_time;
    ELSIF NEW.check_out IS NOT NULL AND NEW.check_out_time IS NULL THEN
        NEW.check_out_time := NEW.check_out;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: sync_attendance_ids(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_attendance_ids() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Sync user_id and employee_id
    IF NEW.user_id IS NOT NULL AND NEW.employee_id IS NULL THEN
        NEW.employee_id := NEW.user_id;
    ELSIF NEW.employee_id IS NOT NULL AND NEW.user_id IS NULL THEN
        NEW.user_id := NEW.employee_id;
    END IF;
    
    -- Set date if not provided
    IF NEW.date IS NULL THEN
        NEW.date := CURRENT_DATE;
    END IF;
    
    RETURN NEW;
END;
$$;


--
-- Name: sync_attendance_user_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_attendance_user_id() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- If date is not provided, set to today
    IF NEW.date IS NULL THEN
        NEW.date := CURRENT_DATE;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: sync_material_initial_stock_atomic(uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_material_initial_stock_atomic(p_material_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric DEFAULT 0) RETURNS TABLE(success boolean, batch_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_batch_id UUID;
  v_old_initial NUMERIC;
  v_qty_diff NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  -- Cari batch "Stok Awal" yang ada
  SELECT id, initial_quantity INTO v_batch_id, v_old_initial
  FROM inventory_batches
  WHERE material_id = p_material_id AND branch_id = p_branch_id AND notes = 'Stok Awal'
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    v_qty_diff := p_new_initial_stock - v_old_initial;
    
    UPDATE inventory_batches
    SET initial_quantity = p_new_initial_stock,
        remaining_quantity = GREATEST(0, remaining_quantity + v_qty_diff),
        unit_cost = p_unit_cost,
        updated_at = NOW()
    WHERE id = v_batch_id;
  ELSE
    INSERT INTO inventory_batches (
      material_id, 
      branch_id, 
      initial_quantity, 
      remaining_quantity, 
      unit_cost, 
      notes, 
      batch_date
    ) VALUES (
      p_material_id, 
      p_branch_id, 
      p_new_initial_stock, 
      p_new_initial_stock, 
      p_unit_cost, 
      'Stok Awal', 
      NOW()
    ) RETURNING id INTO v_batch_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION sync_material_initial_stock_atomic(p_material_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_material_initial_stock_atomic(p_material_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric) IS 'Sinkronisasi stok awal material (batch khusus Stok Awal).';


--
-- Name: sync_payroll_commissions_to_entries(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_payroll_commissions_to_entries() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  synced_count INTEGER := 0;
  payroll_record RECORD;
BEGIN
  -- Loop through payroll records with commissions that haven't been synced
  FOR payroll_record IN
    SELECT
      pr.*,
      p.full_name as employee_name,
      p.role as employee_role
    FROM payroll_records pr
    JOIN profiles p ON p.id = pr.employee_id
    WHERE pr.commission_amount > 0
      AND pr.status = 'paid'
      AND NOT EXISTS (
        SELECT 1 FROM commission_entries ce
        WHERE ce.source_id = pr.id AND ce.source_type = 'payroll'
      )
  LOOP
    -- Insert commission entry for the payroll commission
    INSERT INTO commission_entries (
      id,
      user_id,
      user_name,
      role,
      amount,
      quantity,
      product_name,
      delivery_id,
      source_type,
      source_id,
      created_at
    ) VALUES (
      'comm-payroll-' || payroll_record.id,
      payroll_record.employee_id,
      payroll_record.employee_name,
      payroll_record.employee_role,
      payroll_record.commission_amount,
      1, -- Quantity 1 for payroll commission
      'Komisi Gaji ' || TO_CHAR(DATE(payroll_record.period_year || '-' || payroll_record.period_month || '-01'), 'Month YYYY'),
      NULL, -- No delivery_id for payroll commissions
      'payroll',
      payroll_record.id,
      payroll_record.created_at
    );
    synced_count := synced_count + 1;
  END LOOP;
  RETURN synced_count;
END;
$$;


--
-- Name: sync_product_initial_stock_atomic(uuid, uuid, numeric, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_product_initial_stock_atomic(p_product_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric DEFAULT 0) RETURNS TABLE(success boolean, batch_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_batch_id UUID;
  v_old_initial NUMERIC;
  v_qty_diff NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;

  -- Cari batch "Stok Awal" yang ada
  SELECT id, initial_quantity INTO v_batch_id, v_old_initial
  FROM inventory_batches
  WHERE product_id = p_product_id AND branch_id = p_branch_id AND notes = 'Stok Awal'
  LIMIT 1;

  IF v_batch_id IS NOT NULL THEN
    v_qty_diff := p_new_initial_stock - v_old_initial;
    
    UPDATE inventory_batches
    SET initial_quantity = p_new_initial_stock,
        remaining_quantity = GREATEST(0, remaining_quantity + v_qty_diff),
        unit_cost = p_unit_cost,
        updated_at = NOW()
    WHERE id = v_batch_id;
  ELSE
    INSERT INTO inventory_batches (
      product_id, 
      branch_id, 
      initial_quantity, 
      remaining_quantity, 
      unit_cost, 
      notes, 
      batch_date
    ) VALUES (
      p_product_id, 
      p_branch_id, 
      p_new_initial_stock, 
      p_new_initial_stock, 
      p_unit_cost, 
      'Stok Awal', 
      NOW()
    ) RETURNING id INTO v_batch_id;
  END IF;

  RETURN QUERY SELECT TRUE, v_batch_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION sync_product_initial_stock_atomic(p_product_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.sync_product_initial_stock_atomic(p_product_id uuid, p_branch_id uuid, p_new_initial_stock numeric, p_unit_cost numeric) IS 'Sinkronisasi stok awal produk (batch khusus Stok Awal).';


--
-- Name: test_balance_reconciliation_functions(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.test_balance_reconciliation_functions() RETURNS TABLE(test_name text, status text, message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_account_id TEXT;
  v_test_user_id UUID;
BEGIN
  -- Get first account for testing
  SELECT id INTO v_account_id FROM accounts LIMIT 1;
  
  -- Get first owner user for testing
  SELECT id INTO v_test_user_id FROM profiles WHERE role = 'owner' LIMIT 1;
  
  -- Test 1: Check if get_all_accounts_balance_analysis works
  BEGIN
    PERFORM * FROM get_all_accounts_balance_analysis() LIMIT 1;
    RETURN QUERY SELECT 
      'get_all_accounts_balance_analysis' as test_name,
      'SUCCESS' as status,
      'Function exists and executes successfully' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'get_all_accounts_balance_analysis' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
  -- Test 2: Check if get_account_balance_analysis works
  IF v_account_id IS NOT NULL THEN
    BEGIN
      PERFORM * FROM get_account_balance_analysis(v_account_id) LIMIT 1;
      RETURN QUERY SELECT 
        'get_account_balance_analysis' as test_name,
        'SUCCESS' as status,
        'Function exists and executes successfully' as message;
    EXCEPTION WHEN others THEN
      RETURN QUERY SELECT 
        'get_account_balance_analysis' as test_name,
        'FAILED' as status,
        SQLERRM as message;
    END;
  END IF;
  
  -- Test 3: Check if balance_adjustments table exists
  BEGIN
    PERFORM 1 FROM balance_adjustments LIMIT 1;
    RETURN QUERY SELECT 
      'balance_adjustments_table' as test_name,
      'SUCCESS' as status,
      'Table exists and accessible' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'balance_adjustments_table' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
  -- Test 4: Check if cash_history table exists
  BEGIN
    PERFORM 1 FROM cash_history LIMIT 1;
    RETURN QUERY SELECT 
      'cash_history_table' as test_name,
      'SUCCESS' as status,
      'Table exists and accessible' as message;
  EXCEPTION WHEN others THEN
    RETURN QUERY SELECT 
      'cash_history_table' as test_name,
      'FAILED' as status,
      SQLERRM as message;
  END;
  
END;
$$;


--
-- Name: tf_update_balance_on_journal_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tf_update_balance_on_journal_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    r_line RECORD;
    v_delta NUMERIC;
BEGIN
    IF OLD.is_voided = NEW.is_voided THEN
        RETURN NULL;
    END IF;

    -- If BECOMING VOIDED (False -> True): Remove impact
    IF NEW.is_voided = TRUE THEN
        FOR r_line IN SELECT * FROM journal_entry_lines WHERE journal_entry_id = NEW.id LOOP
            v_delta := calculate_balance_delta(r_line.account_id, r_line.debit_amount, r_line.credit_amount);
            UPDATE accounts SET balance = COALESCE(balance, 0) - v_delta WHERE id = r_line.account_id;
        END LOOP;
    END IF;

    -- If BECOMING ACTIVE (True -> False): Add impact
    IF NEW.is_voided = FALSE THEN
        FOR r_line IN SELECT * FROM journal_entry_lines WHERE journal_entry_id = NEW.id LOOP
            v_delta := calculate_balance_delta(r_line.account_id, r_line.debit_amount, r_line.credit_amount);
            UPDATE accounts SET balance = COALESCE(balance, 0) + v_delta WHERE id = r_line.account_id;
        END LOOP;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: tf_update_balance_on_line_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tf_update_balance_on_line_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    v_is_voided BOOLEAN;
    v_delta NUMERIC;
BEGIN
    -- Check parent journal status first
    IF TG_OP = 'DELETE' THEN
        SELECT is_voided INTO v_is_voided FROM journal_entries WHERE id = OLD.journal_entry_id;
    ELSE
        SELECT is_voided INTO v_is_voided FROM journal_entries WHERE id = NEW.journal_entry_id;
    END IF;

    -- If journal is voided, lines don't affect active balance.
    IF v_is_voided THEN
        RETURN NULL;
    END IF;

    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        -- Reverse OLD impact
        v_delta := calculate_balance_delta(OLD.account_id, OLD.debit_amount, OLD.credit_amount);
        UPDATE accounts SET balance = COALESCE(balance, 0) - v_delta WHERE id = OLD.account_id;
    END IF;

    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- Apply NEW impact
        v_delta := calculate_balance_delta(NEW.account_id, NEW.debit_amount, NEW.credit_amount);
        UPDATE accounts SET balance = COALESCE(balance, 0) + v_delta WHERE id = NEW.account_id;
    END IF;

    RETURN NULL;
END;
$$;


--
-- Name: trigger_migration_delivery_journal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_migration_delivery_journal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_transaction RECORD;
  v_is_migration BOOLEAN := FALSE;
  v_delivery_value NUMERIC := 0;
  v_item RECORD;
  v_result RECORD;
BEGIN
  -- Check if this delivery is for a migration transaction
  SELECT
    t.id,
    t.customer_name,
    t.notes,
    t.branch_id,
    t.items
  INTO v_transaction
  FROM transactions t
  WHERE t.id = NEW.transaction_id;
  -- Check if it's a migration transaction (notes contains [MIGRASI])
  IF v_transaction.notes IS NOT NULL AND v_transaction.notes LIKE '%[MIGRASI]%' THEN
    v_is_migration := TRUE;
  END IF;
  -- If migration, calculate delivery value and create journal
  IF v_is_migration THEN
    -- Calculate value of delivered items
    SELECT COALESCE(SUM(
      di.quantity_delivered * COALESCE(
        (SELECT (item->>'price')::NUMERIC
         FROM jsonb_array_elements(v_transaction.items) item
         WHERE item->>'product_id' = di.product_id::TEXT
         LIMIT 1
        ), 0)
    ), 0)
    INTO v_delivery_value
    FROM delivery_items di
    WHERE di.delivery_id = NEW.id;
    -- Create migration delivery journal
    IF v_delivery_value > 0 THEN
      SELECT * INTO v_result
      FROM process_migration_delivery_journal(
        NEW.id,
        v_delivery_value,
        v_transaction.branch_id,
        v_transaction.customer_name,
        v_transaction.id::TEXT
      );
      IF NOT v_result.success THEN
        RAISE WARNING 'Failed to create migration delivery journal: %', v_result.error_message;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trigger_process_advance_repayment(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_process_advance_repayment() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Only process when payroll status changes to 'paid' and there are deductions
  IF NEW.status = 'paid' AND OLD.status != 'paid' AND NEW.deduction_amount > 0 THEN
    -- Process advance repayments
    PERFORM public.process_advance_repayment_from_salary(NEW.id, NEW.deduction_amount);
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: trigger_sync_payroll_commission(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_sync_payroll_commission() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- When payroll status changes to 'paid' and has commission amount
  IF NEW.status = 'paid' AND OLD.status != 'paid' AND NEW.commission_amount > 0 THEN
    -- Check if commission entry doesn't already exist
    IF NOT EXISTS (
      SELECT 1 FROM commission_entries ce
      WHERE ce.source_id = NEW.id AND ce.source_type = 'payroll'
    ) THEN
      -- Get employee info
      DECLARE
        emp_name TEXT;
        emp_role TEXT;
      BEGIN
        SELECT p.full_name, p.role INTO emp_name, emp_role
        FROM profiles p WHERE p.id = NEW.employee_id;
        -- Insert commission entry
        INSERT INTO commission_entries (
          id,
          user_id,
          user_name,
          role,
          amount,
          quantity,
          product_name,
          delivery_id,
          source_type,
          source_id,
          created_at
        ) VALUES (
          'comm-payroll-' || NEW.id,
          NEW.employee_id,
          emp_name,
          emp_role,
          NEW.commission_amount,
          1,
          'Komisi Gaji ' || TO_CHAR(DATE(NEW.period_year || '-' || NEW.period_month || '-01'), 'Month YYYY'),
          NULL,
          'payroll',
          NEW.id,
          NOW()
        );
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: update_account(text, text, text, text, text, numeric, boolean, text, integer, boolean, boolean, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_account(p_account_id text, p_branch_id text, p_name text, p_code text, p_type text, p_initial_balance numeric, p_is_payment_account boolean, p_parent_id text, p_level integer, p_is_header boolean, p_is_active boolean, p_sort_order integer, p_employee_id text) RETURNS TABLE(success boolean, account_id text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_code_exists BOOLEAN;
  v_current_code TEXT;
BEGIN
  -- Validasi Branch (untuk security check, pastikan akun milik branch yg benar)
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id AND (branch_id = p_branch_id::UUID OR branch_id IS NULL)) THEN
     RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account not found or access denied';
     RETURN;
  END IF;

  -- Get current code
  SELECT code INTO v_current_code FROM accounts WHERE id = p_account_id;

  -- Validasi Kode Unik (jika berubah)
  IF p_code IS NOT NULL AND p_code != '' AND (v_current_code IS NULL OR p_code != v_current_code) THEN
    SELECT EXISTS (
      SELECT 1 FROM accounts 
      WHERE code = p_code AND branch_id = p_branch_id::UUID AND id != p_account_id AND is_active = TRUE
    ) INTO v_code_exists;
    
    IF v_code_exists THEN
      RETURN QUERY SELECT FALSE, NULL::TEXT, 'Account code already exists in this branch';
      RETURN;
    END IF;
  END IF;

  UPDATE accounts
  SET
    name = COALESCE(p_name, name),
    code = NULLIF(p_code, ''),
    type = COALESCE(p_type, type),
    initial_balance = COALESCE(p_initial_balance, initial_balance),
    is_payment_account = COALESCE(p_is_payment_account, is_payment_account),
    parent_id = p_parent_id, -- No cast
    level = COALESCE(p_level, level),
    is_header = COALESCE(p_is_header, is_header),
    is_active = COALESCE(p_is_active, is_active),
    sort_order = COALESCE(p_sort_order, sort_order),
    employee_id = CASE WHEN p_employee_id = '' THEN NULL ELSE p_employee_id::UUID END,
    updated_at = NOW()
  WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, p_account_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM;
END;
$$;


--
-- Name: update_account_balance_from_journal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_account_balance_from_journal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    line_record RECORD;
    account_record RECORD;
    balance_change NUMERIC;
    is_debit_normal BOOLEAN;
BEGIN
    -- Hanya proses jika status berubah ke 'posted'
    IF NEW.status = 'posted' AND (OLD.status IS NULL OR OLD.status != 'posted') THEN
        FOR line_record IN
            SELECT * FROM public.journal_entry_lines
            WHERE journal_entry_id = NEW.id
        LOOP
            SELECT * INTO account_record
            FROM public.accounts
            WHERE id = line_record.account_id;
            -- Determine if account has debit normal balance based on type
            is_debit_normal := account_record.type IN ('Aset', 'Beban');
            IF is_debit_normal THEN
                balance_change := line_record.debit_amount - line_record.credit_amount;
            ELSE
                balance_change := line_record.credit_amount - line_record.debit_amount;
            END IF;
            UPDATE public.accounts
            SET balance = COALESCE(balance, 0) + balance_change,
                updated_at = NOW()
            WHERE id = line_record.account_id;
        END LOOP;
    END IF;
    -- Handle voiding: reverse all balance changes
    IF NEW.is_voided = TRUE AND (OLD.is_voided IS NULL OR OLD.is_voided = FALSE) THEN
        FOR line_record IN
            SELECT * FROM public.journal_entry_lines
            WHERE journal_entry_id = NEW.id
        LOOP
            SELECT * INTO account_record
            FROM public.accounts
            WHERE id = line_record.account_id;
            is_debit_normal := account_record.type IN ('Aset', 'Beban');
            IF is_debit_normal THEN
                balance_change := line_record.credit_amount - line_record.debit_amount;
            ELSE
                balance_change := line_record.debit_amount - line_record.credit_amount;
            END IF;
            UPDATE public.accounts
            SET balance = COALESCE(balance, 0) + balance_change,
                updated_at = NOW()
            WHERE id = line_record.account_id;
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: update_account_initial_balance_atomic(text, numeric, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_account_initial_balance_atomic(p_account_id text, p_new_initial_balance numeric, p_branch_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT 'System'::text) RETURNS TABLE(success boolean, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_account RECORD;
  v_old_journal_id UUID;
  v_new_journal_id UUID;
  v_entry_number TEXT;
  v_current_journal_amount NUMERIC;
  v_equity_account_id TEXT;
  v_description TEXT;
BEGIN
  -- 1. Validate inputs
  IF p_account_id IS NULL OR p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Account ID and Branch ID are required'::TEXT;
    RETURN;
  END IF;

  -- 2. Get account info
  SELECT id, code, name, type INTO v_account
  FROM accounts
  WHERE id = p_account_id AND branch_id = p_branch_id;

  IF v_account.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Account not found'::TEXT;
    RETURN;
  END IF;

  -- 3. Cek jurnal saldo awal existing
  SELECT je.id, je.total_debit INTO v_old_journal_id, v_current_journal_amount
  FROM journal_entries je
  WHERE je.reference_id = p_account_id
    AND je.reference_type = 'opening_balance'
    AND je.branch_id = p_branch_id
    AND je.is_voided = FALSE
  ORDER BY je.created_at DESC
  LIMIT 1;

  v_current_journal_amount := COALESCE(v_current_journal_amount, 0);

  -- No change needed if journal amount equals new balance
  IF v_old_journal_id IS NOT NULL AND v_current_journal_amount = ABS(p_new_initial_balance) THEN
    RETURN QUERY SELECT TRUE, v_old_journal_id, NULL::TEXT;
    RETURN;
  END IF;

  -- 4. VOID existing opening balance journal (audit trail)
  IF v_old_journal_id IS NOT NULL THEN
    UPDATE journal_entries
    SET is_voided = TRUE,
        voided_at = NOW(),
        voided_by = p_user_id,
        updated_at = NOW()
    WHERE id = v_old_journal_id;
  END IF;

  -- 5. Handle saldo awal = 0: just void, don't create new journal
  IF p_new_initial_balance = 0 THEN
    RETURN QUERY SELECT TRUE, NULL::UUID, NULL::TEXT;
    RETURN;
  END IF;


  -- 6. Find equity/modal account for balancing (3xxx)
  -- Priority 1: 'Modal Disetor'
  SELECT id INTO v_equity_account_id
  FROM accounts
  WHERE code LIKE '3%' 
    AND branch_id = p_branch_id 
    AND is_active = TRUE
    AND name ILIKE '%Modal Disetor%'
  LIMIT 1;

  -- Priority 2: Code '3110' (Common standard)
  IF v_equity_account_id IS NULL THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code = '3110'
      AND branch_id = p_branch_id 
      AND is_active = TRUE
    LIMIT 1;
  END IF;

  -- Priority 3: Any Equity account
  IF v_equity_account_id IS NULL THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code LIKE '3%' 
      AND branch_id = p_branch_id 
      AND is_active = TRUE
    ORDER BY code ASC
    LIMIT 1;
  END IF;

  IF v_equity_account_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::UUID, 'Akun Modal (3xxx) tidak ditemukan untuk pasangan jurnal'::TEXT;
    RETURN;
  END IF;

  -- Prevent self-reference for equity accounts
  IF p_account_id = v_equity_account_id THEN
    SELECT id INTO v_equity_account_id
    FROM accounts
    WHERE code LIKE '3%'
      AND branch_id = p_branch_id
      AND is_active = TRUE
      AND id != p_account_id
    ORDER BY code ASC
    LIMIT 1;

    IF v_equity_account_id IS NULL THEN
      RETURN QUERY SELECT FALSE, NULL::UUID, 'Tidak ada akun Modal lain untuk pasangan jurnal saldo awal Modal'::TEXT;
      RETURN;
    END IF;
  END IF;

  v_description := format('Saldo Awal: %s - %s', v_account.code, v_account.name);

  -- 7. Create NEW journal (always new, for audit trail)
  v_entry_number := 'OB-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');

  INSERT INTO journal_entries (
    entry_number,
    entry_date,
    description,
    reference_type,
    reference_id,
    branch_id,
    status,
    total_debit,
    total_credit,
    created_by
  ) VALUES (
    v_entry_number,
    DATE_TRUNC('year', NOW())::DATE,
    v_description,
    'opening_balance',
    p_account_id,
    p_branch_id,
    'draft',
    ABS(p_new_initial_balance),
    ABS(p_new_initial_balance),
    p_user_id
  ) RETURNING id INTO v_new_journal_id;

  -- 8. Create journal lines based on account type
  IF v_account.type IN ('Aset', 'Beban') THEN
    INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
    VALUES
      (v_new_journal_id, 1, p_account_id, v_description, ABS(p_new_initial_balance), 0),
      (v_new_journal_id, 2, v_equity_account_id, v_description, 0, ABS(p_new_initial_balance));
  ELSE
    INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
    VALUES
      (v_new_journal_id, 1, p_account_id, v_description, 0, ABS(p_new_initial_balance)),
      (v_new_journal_id, 2, v_equity_account_id, v_description, ABS(p_new_initial_balance), 0);
  END IF;

  -- 9. Post the journal
  UPDATE journal_entries SET status = 'posted' WHERE id = v_new_journal_id;

  -- 10. UPDATE accounts column (CACHE for Tree/List View)
  UPDATE accounts 
  SET initial_balance = p_new_initial_balance,
      updated_at = NOW()
  WHERE id = p_account_id;

  RETURN QUERY SELECT TRUE, v_new_journal_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: update_asset_atomic(uuid, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_asset_atomic(p_asset_id uuid, p_asset jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, journal_updated boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_asset RECORD;
  v_new_price NUMERIC;
  v_price_changed BOOLEAN;
  v_journal_id UUID;
  v_asset_account_id UUID;
  v_cash_account_id UUID;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Get existing asset
  SELECT * INTO v_old_asset
  FROM assets
  WHERE id = p_asset_id AND branch_id = p_branch_id;
  IF v_old_asset.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Asset not found in this branch'::TEXT;
    RETURN;
  END IF;
  -- ==================== CHECK PRICE CHANGE ====================
  v_new_price := (p_asset->>'purchase_price')::NUMERIC;
  v_price_changed := v_new_price IS NOT NULL AND v_new_price != v_old_asset.purchase_price;
  -- ==================== UPDATE ASSET ====================
  UPDATE assets SET
    name = COALESCE(p_asset->>'name', p_asset->>'asset_name', name),
    code = COALESCE(p_asset->>'code', p_asset->>'asset_code', code),
    asset_code = COALESCE(p_asset->>'code', p_asset->>'asset_code', asset_code),
    category = COALESCE(p_asset->>'category', category),
    purchase_date = COALESCE((p_asset->>'purchase_date')::DATE, purchase_date),
    purchase_price = COALESCE(v_new_price, purchase_price),
    useful_life_years = COALESCE((p_asset->>'useful_life_years')::INTEGER, useful_life_years),
    salvage_value = COALESCE((p_asset->>'salvage_value')::NUMERIC, salvage_value),
    depreciation_method = COALESCE(p_asset->>'depreciation_method', depreciation_method),
    location = COALESCE(p_asset->>'location', location),
    brand = COALESCE(p_asset->>'brand', brand),
    model = COALESCE(p_asset->>'model', model),
    serial_number = COALESCE(p_asset->>'serial_number', serial_number),
    supplier_name = COALESCE(p_asset->>'supplier_name', supplier_name),
    notes = COALESCE(p_asset->>'notes', notes),
    status = COALESCE(p_asset->>'status', status),
    condition = COALESCE(p_asset->>'condition', condition),
    updated_at = NOW()
  WHERE id = p_asset_id;
  -- ==================== UPDATE JOURNAL IF PRICE CHANGED ====================
  IF v_price_changed THEN
    -- Find existing journal
    SELECT id INTO v_journal_id
    FROM journal_entries
    WHERE reference_id = p_asset_id::TEXT
      AND reference_type = 'asset'
      AND branch_id = p_branch_id
      AND is_voided = FALSE
    ORDER BY created_at DESC
    LIMIT 1;
    IF v_journal_id IS NOT NULL THEN
      v_asset_account_id := COALESCE((p_asset->>'account_id')::UUID, v_old_asset.account_id);
      -- Get cash account
      SELECT id INTO v_cash_account_id
      FROM accounts
      WHERE branch_id = p_branch_id
        AND is_payment_account = TRUE
        AND code LIKE '11%'
      ORDER BY code
      LIMIT 1;
      IF v_asset_account_id IS NOT NULL AND v_cash_account_id IS NOT NULL THEN
        -- Delete old lines
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;
        -- Insert new lines
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, debit_amount, credit_amount, description)
        VALUES
          (v_journal_id, 1, v_asset_account_id, v_new_price, 0, format('Pembelian %s (edit)', v_old_asset.name)),
          (v_journal_id, 2, v_cash_account_id, 0, v_new_price, 'Pembayaran aset (edit)');
        -- Update journal totals
        UPDATE journal_entries SET
          total_debit = v_new_price,
          total_credit = v_new_price,
          updated_at = NOW()
        WHERE id = v_journal_id;
        RETURN QUERY SELECT TRUE, TRUE, NULL::TEXT;
      END IF;
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, FALSE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION update_asset_atomic(p_asset_id uuid, p_asset jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_asset_atomic(p_asset_id uuid, p_asset jsonb, p_branch_id uuid) IS 'Update asset dan update journal jika harga berubah. WAJIB branch_id.';


--
-- Name: update_delivery_atomic(uuid, uuid, jsonb, uuid, uuid, timestamp with time zone, text, text, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_items jsonb, p_driver_id uuid DEFAULT NULL::uuid, p_helper_id uuid DEFAULT NULL::uuid, p_delivery_date timestamp with time zone DEFAULT now(), p_notes text DEFAULT NULL::text, p_photo_url text DEFAULT NULL::text, p_helper_id_2 uuid DEFAULT NULL::uuid, p_helper_id_3 uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  UPDATE deliveries SET
    driver_id = p_driver_id,
    helper_id = p_helper_id,
    helper_id_2 = p_helper_id_2,
    helper_id_3 = p_helper_id_3,
    delivery_date = p_delivery_date,
    notes = p_notes,
    photo_url = COALESCE(p_photo_url, photo_url),
    updated_at = NOW()
  WHERE id = p_delivery_id AND branch_id = p_branch_id;
  
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: update_expense_atomic(text, jsonb, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_expense_atomic(p_expense_id text, p_expense jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, journal_updated boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_expense RECORD;
  v_new_amount NUMERIC;
  v_new_cash_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_journal_id UUID;
  v_expense_account_id TEXT;  -- accounts.id is TEXT not UUID
  v_amount_changed BOOLEAN;
  v_account_changed BOOLEAN;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get existing expense
  SELECT * INTO v_old_expense
  FROM expenses
  WHERE id = p_expense_id AND branch_id = p_branch_id;

  IF v_old_expense.id IS NULL THEN
    RETURN QUERY SELECT FALSE, FALSE,
      'Expense not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE DATA ====================

  v_new_amount := COALESCE((p_expense->>'amount')::NUMERIC, v_old_expense.amount);
  v_new_cash_account_id := COALESCE(p_expense->>'account_id', v_old_expense.account_id);  -- TEXT, no cast

  v_amount_changed := v_new_amount != v_old_expense.amount;
  v_account_changed := v_new_cash_account_id IS DISTINCT FROM v_old_expense.account_id;

  -- ==================== UPDATE EXPENSE ====================

  UPDATE expenses SET
    description = COALESCE(p_expense->>'description', description),
    amount = v_new_amount,
    category = COALESCE(p_expense->>'category', category),
    date = COALESCE((p_expense->>'date')::TIMESTAMPTZ, date),
    account_id = v_new_cash_account_id,
    updated_at = NOW()
  WHERE id = p_expense_id;

  -- ==================== UPDATE JOURNAL IF NEEDED ====================

  IF v_amount_changed OR v_account_changed THEN
    -- Find existing journal
    SELECT id INTO v_journal_id
    FROM journal_entries
    WHERE reference_id = p_expense_id
      AND reference_type = 'expense'
      AND branch_id = p_branch_id
      AND is_voided = FALSE
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_journal_id IS NOT NULL THEN
      -- Get expense account from current expense
      v_expense_account_id := v_old_expense.expense_account_id;

      IF v_expense_account_id IS NULL THEN
        -- Fallback: find default expense account
        SELECT id INTO v_expense_account_id
        FROM accounts
        WHERE branch_id = p_branch_id
          AND is_active = TRUE
          AND code LIKE '6%'
        ORDER BY code
        LIMIT 1;
      END IF;

      IF v_expense_account_id IS NOT NULL AND v_new_cash_account_id IS NOT NULL THEN
        -- Delete old lines
        DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;

        -- Insert new lines
        INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, debit_amount, credit_amount, description)
        VALUES
          (v_journal_id, 1, v_expense_account_id, v_new_amount, 0, 'Beban pengeluaran (edit)'),
          (v_journal_id, 2, v_new_cash_account_id, 0, v_new_amount, 'Pengeluaran kas (edit)');

        -- Update journal totals
        UPDATE journal_entries SET
          total_debit = v_new_amount,
          total_credit = v_new_amount,
          updated_at = NOW()
        WHERE id = v_journal_id;

        RETURN QUERY SELECT TRUE, TRUE, NULL::TEXT;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT TRUE, FALSE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION update_expense_atomic(p_expense_id text, p_expense jsonb, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_expense_atomic(p_expense_id text, p_expense jsonb, p_branch_id uuid) IS 'Update expense dan update journal jika amount/account berubah. WAJIB branch_id.';


--
-- Name: update_overdue_installments_atomic(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_overdue_installments_atomic() RETURNS TABLE(updated_count integer, success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_updated_count INTEGER := 0;
BEGIN
  -- Update all pending installments that are past due date
  UPDATE debt_installments
  SET
    status = 'overdue'
  WHERE status = 'pending'
    AND due_date < CURRENT_DATE;
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RETURN QUERY SELECT 
    v_updated_count,
    TRUE,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    0,
    FALSE,
    SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION update_overdue_installments_atomic(); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_overdue_installments_atomic() IS 'Automatically update pending installments to overdue status if past due date. Can be called by authenticated users or scheduled jobs.';


--
-- Name: update_overdue_maintenance(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_overdue_maintenance() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Update status to overdue for scheduled maintenance past due date
    UPDATE asset_maintenance
    SET status = 'overdue'
    WHERE status = 'scheduled'
      AND scheduled_date < CURRENT_DATE;
    -- Create notifications for overdue maintenance (if not already sent)
    INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority, user_id)
    SELECT
        'NOTIF-OVERDUE-' || am.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
        'Maintenance Overdue: ' || a.asset_name,
        'Maintenance "' || am.title || '" for asset "' || a.asset_name || '" is overdue since ' || am.scheduled_date::TEXT,
        'maintenance_overdue',
        'maintenance',
        am.id,
        '/maintenance',
        'high',
        am.created_by
    FROM asset_maintenance am
    JOIN assets a ON am.asset_id = a.id
    WHERE am.status = 'overdue'
      AND am.notification_sent = FALSE;
    -- Mark notifications as sent
    UPDATE asset_maintenance
    SET notification_sent = TRUE
    WHERE status = 'overdue'
      AND notification_sent = FALSE;
END;
$$;


--
-- Name: update_payment_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payment_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Auto-update payment status based on paid amount vs total
  IF NEW.paid_amount >= NEW.total THEN
    NEW.payment_status := 'Lunas';
  ELSIF NEW.paid_amount > 0 THEN
    NEW.payment_status := 'Belum Lunas';
  ELSE
    -- Keep existing payment_status if no payment yet
    -- Could be 'Kredit' or 'Belum Lunas'
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: update_payroll_record_atomic(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payroll_record_atomic(p_payroll_id uuid, p_branch_id uuid, p_base_salary numeric, p_commission numeric, p_bonus numeric, p_advance_deduction numeric, p_salary_deduction numeric, p_notes text) RETURNS TABLE(success boolean, net_salary numeric, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_record RECORD;
  v_new_net_salary NUMERIC;
  v_new_gross_salary NUMERIC;
  v_new_total_deductions NUMERIC;
  v_journal_id UUID;
  v_beban_gaji_account TEXT;
  v_panjar_account TEXT;
  v_payment_account_id TEXT;
  v_journal_lines JSONB := '[]'::JSONB;
BEGIN
  -- 1. Get Old Record
  SELECT * INTO v_old_record FROM payroll_records 
  WHERE id = p_payroll_id AND branch_id = p_branch_id;
  
  IF v_old_record.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID, 'Data gaji tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- 2. Calculate New Amounts
  v_new_gross_salary := COALESCE(p_base_salary, v_old_record.base_salary) + 
                        COALESCE(p_commission, v_old_record.total_commission) + 
                        COALESCE(p_bonus, v_old_record.total_bonus);
  
  v_new_total_deductions := COALESCE(p_advance_deduction, v_old_record.advance_deduction) + 
                           COALESCE(p_salary_deduction, v_old_record.salary_deduction);
  
  v_new_net_salary := v_new_gross_salary - v_new_total_deductions;
  -- 3. Update Record
  UPDATE payroll_records
  SET
    base_salary = COALESCE(p_base_salary, base_salary),
    total_commission = COALESCE(p_commission, total_commission),
    total_bonus = COALESCE(p_bonus, total_bonus),
    advance_deduction = COALESCE(p_advance_deduction, advance_deduction),
    salary_deduction = COALESCE(p_salary_deduction, salary_deduction),
    total_deductions = v_new_total_deductions,
    net_salary = v_new_net_salary,
    notes = COALESCE(p_notes, notes),
    updated_at = NOW()
  WHERE id = p_payroll_id;
  -- 4. Handle Journal Update if Status is 'paid'
  IF v_old_record.status = 'paid' THEN
    -- Find existing journal
    SELECT id INTO v_journal_id FROM journal_entries 
    WHERE reference_id = p_payroll_id::TEXT AND reference_type = 'payroll' AND branch_id = p_branch_id
    ORDER BY created_at DESC LIMIT 1;
    IF v_journal_id IS NOT NULL THEN
      -- Get Accounts
      SELECT id INTO v_beban_gaji_account FROM accounts WHERE branch_id = p_branch_id AND code = '6110' LIMIT 1;
      SELECT id INTO v_panjar_account FROM accounts WHERE branch_id = p_branch_id AND code = '1220' LIMIT 1;
      v_payment_account_id := v_old_record.payment_account_id;
      -- Debit: Beban Gaji (gross)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_beban_gaji_account,
        'debit_amount', v_new_gross_salary,
        'credit_amount', 0,
        'description', 'Beban gaji (updated)'
      );
      -- Credit: Kas (net)
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_payment_account_id,
        'debit_amount', 0,
        'credit_amount', v_new_net_salary,
        'description', 'Pembayaran gaji (updated)'
      );
      -- Credit: Panjar (deductions)
      IF COALESCE(p_advance_deduction, v_old_record.advance_deduction) > 0 AND v_panjar_account IS NOT NULL THEN
        v_journal_lines := v_journal_lines || jsonb_build_object(
          'account_id', v_panjar_account,
          'debit_amount', 0,
          'credit_amount', COALESCE(p_advance_deduction, v_old_record.advance_deduction),
          'description', 'Potongan panjar (updated)'
        );
      END IF;
      -- Delete old lines and insert new ones
      DELETE FROM journal_entry_lines WHERE journal_entry_id = v_journal_id;
      
      INSERT INTO journal_entry_lines (journal_entry_id, line_number, account_id, description, debit_amount, credit_amount)
      SELECT v_journal_id, row_number() OVER (), (line->>'account_id'), line->>'description', (line->>'debit_amount')::NUMERIC, (line->>'credit_amount')::NUMERIC
      FROM jsonb_array_elements(v_journal_lines) AS line;
      -- Update header totals
      UPDATE journal_entries 
      SET total_debit = v_new_gross_salary, 
          total_credit = v_new_gross_salary,
          updated_at = NOW()
      WHERE id = v_journal_id;
    END IF;
  END IF;
  RETURN QUERY SELECT TRUE, v_new_net_salary, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0::NUMERIC, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: update_payroll_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_payroll_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: update_product_materials_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_materials_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_production_records_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_production_records_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$;


--
-- Name: update_profiles_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_profiles_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$;


--
-- Name: update_remaining_amount(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_remaining_amount(p_advance_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_total_repaid NUMERIC := 0;
  v_original_amount NUMERIC := 0;
  v_new_remaining NUMERIC := 0;
BEGIN
  -- Get the original advance amount
  SELECT amount INTO v_original_amount
  FROM public.employee_advances 
  WHERE id = p_advance_id;
  
  IF v_original_amount IS NULL THEN
    RAISE EXCEPTION 'Advance with ID % not found', p_advance_id;
  END IF;
  
  -- Calculate total repaid amount for this advance
  SELECT COALESCE(SUM(amount), 0) INTO v_total_repaid
  FROM public.advance_repayments 
  WHERE advance_id = p_advance_id;
  
  -- Calculate new remaining amount
  v_new_remaining := v_original_amount - v_total_repaid;
  
  -- Ensure remaining amount doesn't go below 0
  IF v_new_remaining < 0 THEN
    v_new_remaining := 0;
  END IF;
  
  -- Update the remaining amount
  UPDATE public.employee_advances 
  SET remaining_amount = v_new_remaining
  WHERE id = p_advance_id;
  
END;
$$;


--
-- Name: update_transaction_atomic(text, jsonb, uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_transaction_atomic(p_transaction_id text, p_transaction jsonb, p_branch_id uuid, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, transaction_id text, journal_id uuid, changes_made text[], error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_old_transaction RECORD;
  v_new_total NUMERIC;
  v_new_paid_amount NUMERIC;
  v_changes TEXT[] := '{}';
  v_journal_id UUID;
  v_journal_lines JSONB := '[]'::JSONB;
  v_customer_name TEXT;
  v_date DATE;
  v_total_hpp NUMERIC := 0;
  v_fifo_result RECORD;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_transaction_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Transaction ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get existing transaction
  SELECT * INTO v_old_transaction
  FROM transactions
  WHERE id = p_transaction_id AND branch_id = p_branch_id;

  IF v_old_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[],
      'Transaction not found in this branch'::TEXT;
    RETURN;
  END IF;

  -- ==================== PARSE NEW DATA ====================

  v_new_total := COALESCE((p_transaction->>'total')::NUMERIC, v_old_transaction.total);
  v_new_paid_amount := COALESCE((p_transaction->>'paid_amount')::NUMERIC, v_old_transaction.paid_amount);
  v_customer_name := COALESCE(p_transaction->>'customer_name', v_old_transaction.customer_name);
  v_date := COALESCE(v_old_transaction.order_date, CURRENT_DATE);

  -- Detect changes
  IF v_new_total != v_old_transaction.total THEN
    v_changes := array_append(v_changes, 'total');
  END IF;
  IF v_new_paid_amount != v_old_transaction.paid_amount THEN
    v_changes := array_append(v_changes, 'paid_amount');
  END IF;

  -- ==================== UPDATE TRANSACTION ====================

  UPDATE transactions SET
    total = v_new_total,
    paid_amount = v_new_paid_amount,
    payment_status = CASE WHEN v_new_paid_amount >= v_new_total THEN 'Lunas' ELSE 'Belum Lunas' END,
    customer_name = v_customer_name,
    notes = COALESCE(p_transaction->>'notes', notes),
    updated_at = NOW()
  WHERE id = p_transaction_id;

  -- ==================== UPDATE JOURNAL IF AMOUNTS CHANGED ====================

  IF 'total' = ANY(v_changes) OR 'paid_amount' = ANY(v_changes) THEN
    -- Void old journal
    UPDATE journal_entries
    SET is_voided = TRUE, voided_at = NOW(), voided_reason = 'Transaction updated'
    WHERE reference_type = 'transaction'
      AND reference_id = p_transaction_id
      AND branch_id = p_branch_id
      AND is_voided = FALSE;

    -- Calculate HPP from items
    SELECT COALESCE(SUM((item->>'hppAmount')::NUMERIC), 0) INTO v_total_hpp
    FROM jsonb_array_elements(v_old_transaction.items) AS item;

    -- Build new journal lines
    v_journal_lines := '[]'::JSONB;

    -- Debit: Kas atau Piutang
    IF v_new_paid_amount >= v_new_total THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_old_transaction.payment_account_id,
        'debit_amount', v_new_total,
        'credit_amount', 0,
        'description', 'Penerimaan kas dari penjualan'
      );
    ELSIF v_new_paid_amount > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_id', v_old_transaction.payment_account_id,
        'debit_amount', v_new_paid_amount,
        'credit_amount', 0,
        'description', 'Penerimaan kas dari penjualan'
      );
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '1210',
        'debit_amount', v_new_total - v_new_paid_amount,
        'credit_amount', 0,
        'description', 'Piutang usaha'
      );
    ELSE
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '1210',
        'debit_amount', v_new_total,
        'credit_amount', 0,
        'description', 'Piutang usaha'
      );
    END IF;

    -- Credit: Pendapatan
    v_journal_lines := v_journal_lines || jsonb_build_object(
      'account_code', '4100',
      'debit_amount', 0,
      'credit_amount', v_new_total,
      'description', 'Pendapatan penjualan'
    );

    -- HPP entries
    IF v_total_hpp > 0 THEN
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '5100',
        'debit_amount', v_total_hpp,
        'credit_amount', 0,
        'description', 'Harga Pokok Penjualan'
      );
      v_journal_lines := v_journal_lines || jsonb_build_object(
        'account_code', '1310',
        'debit_amount', 0,
        'credit_amount', v_total_hpp,
        'description', 'Pengurangan persediaan'
      );
    END IF;

    -- Create new journal
    SELECT * INTO v_fifo_result FROM create_journal_atomic(
      p_branch_id,
      v_date,
      'Penjualan ke ' || COALESCE(v_customer_name, 'Umum') || ' - ' || p_transaction_id || ' (Updated)',
      'transaction',
      p_transaction_id,
      v_journal_lines,
      TRUE
    );

    IF v_fifo_result.success THEN
      v_journal_id := v_fifo_result.journal_id;
    END IF;

    v_changes := array_append(v_changes, 'journal_updated');
  END IF;

  RETURN QUERY SELECT TRUE, p_transaction_id, v_journal_id, v_changes, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, '{}'::TEXT[], SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION update_transaction_atomic(p_transaction_id text, p_transaction jsonb, p_branch_id uuid, p_user_id uuid, p_user_name text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.update_transaction_atomic(p_transaction_id text, p_transaction jsonb, p_branch_id uuid, p_user_id uuid, p_user_name text) IS 'Update transaction dan recreate journal jika amounts berubah. WAJIB branch_id.';


--
-- Name: update_transaction_delivery_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_transaction_delivery_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  transaction_record RECORD;
  total_ordered INTEGER;
  total_delivered INTEGER;
  item_record RECORD;
BEGIN
  -- Get transaction details
  SELECT * INTO transaction_record
  FROM transactions
  WHERE id = (
    SELECT transaction_id
    FROM deliveries
    WHERE id = COALESCE(NEW.delivery_id, OLD.delivery_id)
  );
  -- Skip jika transaksi adalah laku kantor
  IF transaction_record.is_office_sale = true THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  -- Calculate total quantity ordered vs delivered untuk setiap item
  FOR item_record IN
    SELECT
      p.product_id,  -- FIXED: use p.product_id instead of ti.product_id
      ti.quantity as ordered_quantity,
      COALESCE(SUM(di.quantity_delivered), 0) as delivered_quantity
    FROM transactions t
    JOIN LATERAL jsonb_to_recordset(t.items) AS ti(
      product jsonb,
      quantity integer
    ) ON true
    JOIN LATERAL (SELECT (ti.product->>'id')::uuid as product_id) p ON true
    LEFT JOIN deliveries d ON d.transaction_id = t.id
    LEFT JOIN delivery_items di ON di.delivery_id = d.id AND di.product_id = p.product_id
    WHERE t.id = transaction_record.id
    GROUP BY p.product_id, ti.quantity
  LOOP
    -- Jika ada item yang belum selesai diantar
    IF item_record.delivered_quantity < item_record.ordered_quantity THEN
      -- Jika sudah ada pengantaran tapi belum lengkap
      IF item_record.delivered_quantity > 0 THEN
        UPDATE transactions
        SET status = 'Diantar Sebagian'
        WHERE id = transaction_record.id;
        RETURN COALESCE(NEW, OLD);
      ELSE
        -- Belum ada pengantaran sama sekali, tetap status saat ini
        RETURN COALESCE(NEW, OLD);
      END IF;
    END IF;
  END LOOP;
  -- Jika sampai sini, berarti semua item sudah diantar lengkap
  UPDATE transactions
  SET status = 'Selesai'
  WHERE id = transaction_record.id;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_transaction_status_from_delivery(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_transaction_status_from_delivery() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  transaction_id TEXT;
  total_items INTEGER;
  delivered_items INTEGER;
  cancelled_deliveries INTEGER;
BEGIN
  -- Get transaction ID from delivery
  transaction_id := COALESCE(NEW.transaction_id, OLD.transaction_id);
  
  IF transaction_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Count total items in transaction (from transaction items)
  SELECT COALESCE(jsonb_array_length(items), 0)
  INTO total_items
  FROM public.transactions 
  WHERE id = transaction_id;
  
  -- Count delivered items from all deliveries for this transaction
  SELECT 
    COALESCE(SUM(CASE WHEN d.status = 'delivered' THEN di.quantity_delivered ELSE 0 END), 0),
    COUNT(CASE WHEN d.status = 'cancelled' THEN 1 END)
  INTO delivered_items, cancelled_deliveries
  FROM public.deliveries d
  LEFT JOIN public.delivery_items di ON d.id = di.delivery_id  
  WHERE d.transaction_id = transaction_id;
  
  -- Update transaction status based on delivery progress
  IF cancelled_deliveries > 0 AND delivered_items = 0 THEN
    -- All deliveries cancelled, no items delivered
    UPDATE public.transactions 
    SET status = 'Dibatalkan' 
    WHERE id = transaction_id AND status != 'Dibatalkan';
    
  ELSIF delivered_items = 0 THEN
    -- No items delivered yet, but delivery exists
    UPDATE public.transactions 
    SET status = 'Siap Antar' 
    WHERE id = transaction_id AND status NOT IN ('Siap Antar', 'Diantar Sebagian', 'Selesai');
    
  ELSIF delivered_items > 0 AND delivered_items < total_items THEN
    -- Partial delivery completed
    UPDATE public.transactions 
    SET status = 'Diantar Sebagian' 
    WHERE id = transaction_id AND status != 'Diantar Sebagian';
    
  ELSIF delivered_items >= total_items THEN
    -- All items delivered
    UPDATE public.transactions 
    SET status = 'Selesai' 
    WHERE id = transaction_id AND status != 'Selesai';
  END IF;
  
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: upsert_notification_atomic(uuid, text, text, text, text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_notification_atomic(p_user_id uuid, p_type text, p_title text, p_message text, p_priority text DEFAULT 'normal'::text, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text, p_reference_url text DEFAULT NULL::text) RETURNS TABLE(notification_id uuid, success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_notification_id UUID;
  v_existing_id UUID;
  v_today TIMESTAMP;
BEGIN
  -- Get today's start time
  v_today := DATE_TRUNC('day', NOW());
  -- Check if similar unread notification exists today
  SELECT id INTO v_existing_id
  FROM notifications
  WHERE user_id = p_user_id
    AND type = p_type
    AND is_read = FALSE
    AND created_at >= v_today
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    -- Update existing notification
    UPDATE notifications
    SET 
      title = p_title,
      message = p_message,
      priority = p_priority,
      reference_id = p_reference_id,
      updated_at = NOW()
    WHERE id = v_existing_id;
    
    v_notification_id := v_existing_id;
  ELSE
    -- Create new notification
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      priority,
      reference_id,
      reference_type,
      reference_url
    ) VALUES (
      p_user_id,
      p_type,
      p_title,
      p_message,
      p_priority,
      p_reference_id,
      p_reference_type,
      p_reference_url
    )
    RETURNING id INTO v_notification_id;
  END IF;
  RETURN QUERY SELECT 
    v_notification_id,
    TRUE,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    NULL::UUID,
    FALSE,
    SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION upsert_notification_atomic(p_user_id uuid, p_type text, p_title text, p_message text, p_priority text, p_reference_id text, p_reference_type text, p_reference_url text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.upsert_notification_atomic(p_user_id uuid, p_type text, p_title text, p_message text, p_priority text, p_reference_id text, p_reference_type text, p_reference_url text) IS 'Create or update notification for a user. If similar unread notification exists today, update it instead of creating duplicate.';


--
-- Name: upsert_zakat_record_atomic(uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_zakat_record_atomic(p_branch_id uuid, p_zakat_id text, p_data jsonb) RETURNS TABLE(success boolean, zakat_id text, journal_id uuid, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_zakat_id TEXT := p_zakat_id;
  v_journal_id UUID;
  v_beban_acc_id UUID;
  v_payment_acc_id UUID;
  v_amount NUMERIC;
  v_date DATE;
  v_journal_lines JSONB;
  v_category TEXT;
  v_title TEXT;
BEGIN
  -- ==================== VALIDASI & EKSTRAKSI ====================
  
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Branch ID is REQUIRED'::TEXT;
    RETURN;
  END IF;
  v_amount := (p_data->>'amount')::NUMERIC;
  v_date := (p_data->>'payment_date')::DATE;
  v_payment_acc_id := (p_data->>'payment_account_id')::UUID;
  v_category := p_data->>'category';
  v_title := p_data->>'title';
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Amount must be positive'::TEXT;
    RETURN;
  END IF;
  -- Cari atau buat akun Beban Zakat/Sosial (6260-ish)
  -- Jika tidak ada, fallback ke Beban Umum (6200)
  SELECT id INTO v_beban_acc_id
  FROM accounts
  WHERE branch_id = p_branch_id
    AND (name ILIKE '%Beban Zakat%' OR name ILIKE '%Beban Sosial%' OR name ILIKE '%Beban Sumbangan%')
    AND is_header = FALSE
  LIMIT 1;
  IF v_beban_acc_id IS NULL THEN
    -- Fallback ke Beban Umum & Administrasi
    SELECT id INTO v_beban_acc_id
    FROM accounts
    WHERE branch_id = p_branch_id
      AND (code = '6200' OR name ILIKE '%Beban Umum%')
      AND is_header = FALSE
    LIMIT 1;
  END IF;
  IF v_beban_acc_id IS NULL THEN
    RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, 'Akun Beban (6200) tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  -- ==================== UPSERT ZAKAT RECORD ====================
  
  IF v_zakat_id IS NULL THEN
    v_zakat_id := 'ZAKAT-' || TO_CHAR(v_date, 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 1000)::TEXT, 3, '0');
  END IF;
  INSERT INTO zakat_records (
    id,
    type,
    category,
    title,
    description,
    recipient,
    recipient_type,
    amount,
    nishab_amount,
    percentage_rate,
    payment_date,
    payment_account_id,
    payment_method,
    status,
    receipt_number,
    calculation_basis,
    calculation_notes,
    is_anonymous,
    notes,
    attachment_url,
    hijri_year,
    hijri_month,
    created_by,
    branch_id,
    created_at,
    updated_at
  ) VALUES (
    v_zakat_id,
    p_data->>'type',
    v_category,
    v_title,
    p_data->>'description',
    p_data->>'recipient',
    p_data->>'recipient_type',
    v_amount,
    (p_data->>'nishab_amount')::NUMERIC,
    (p_data->>'percentage_rate')::NUMERIC,
    v_date,
    v_payment_acc_id,
    p_data->>'payment_method',
    'paid',
    p_data->>'receipt_number',
    p_data->>'calculation_basis',
    p_data->>'calculation_notes',
    (p_data->>'is_anonymous')::BOOLEAN,
    p_data->>'notes',
    p_data->>'attachment_url',
    (p_data->>'hijri_year')::INTEGER,
    p_data->>'hijri_month',
    auth.uid(),
    p_branch_id,
    NOW(),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    type = EXCLUDED.type,
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    amount = EXCLUDED.amount,
    payment_date = EXCLUDED.payment_date,
    payment_account_id = EXCLUDED.payment_account_id,
    updated_at = NOW();
  -- ==================== CREATE JOURNAL ====================
  
  -- Void existing journal if updating
  UPDATE journal_entries 
  SET is_voided = TRUE, status = 'voided', voided_reason = 'Updated zakat record'
  WHERE reference_id = v_zakat_id AND reference_type = 'zakat' AND is_voided = FALSE;
  -- Dr. Beban Zakat/Umum
  --   Cr. Kas/Bank
  v_journal_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_beban_acc_id,
      'debit_amount', v_amount,
      'credit_amount', 0,
      'description', format('%s: %s', INITCAP(v_category), v_title)
    ),
    jsonb_build_object(
      'account_id', v_payment_acc_id,
      'debit_amount', 0,
      'credit_amount', v_amount,
      'description', format('Pembayaran %s (%s)', v_category, v_zakat_id)
    )
  );
  SELECT journal_id INTO v_journal_id
  FROM create_journal_atomic(
    p_branch_id,
    v_date,
    format('Pembayaran %s - %s', INITCAP(v_category), v_title),
    'zakat',
    v_zakat_id,
    v_journal_lines,
    TRUE -- auto post
  );
  -- Link journal to zakat record
  UPDATE zakat_records SET journal_entry_id = v_journal_id WHERE id = v_zakat_id;
  RETURN QUERY SELECT TRUE, v_zakat_id, v_journal_id, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, NULL::UUID, SQLERRM::TEXT;
END;
$$;


--
-- Name: validate_branch_access(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_branch_access(p_user_id uuid, p_branch_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_user_branch_id UUID;
  v_role TEXT;
BEGIN
  -- Get user's branch and role from profiles table
  SELECT branch_id, role INTO v_user_branch_id, v_role
  FROM profiles
  WHERE id = p_user_id AND status = 'Aktif';
  -- Owner dan Admin bisa akses semua branch
  IF v_role IN ('owner', 'admin') THEN
    RETURN TRUE;
  END IF;
  -- User lain hanya bisa akses branch sendiri
  RETURN v_user_branch_id = p_branch_id;
END;
$$;


--
-- Name: FUNCTION validate_branch_access(p_user_id uuid, p_branch_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.validate_branch_access(p_user_id uuid, p_branch_id uuid) IS 'Validate if user can access specific branch. Owner/Admin can access all.';


--
-- Name: validate_journal_balance(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_journal_balance(journal_id uuid) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  total_debits NUMERIC;
  total_credits NUMERIC;
BEGIN
  -- Calculate total debits and credits
  SELECT 
    COALESCE(SUM(debit_amount), 0),
    COALESCE(SUM(credit_amount), 0)
  INTO total_debits, total_credits
  FROM public.manual_journal_entry_lines
  WHERE journal_id = validate_journal_balance.journal_id;
  
  -- Return true if balanced (difference less than 0.01 for rounding)
  RETURN ABS(total_debits - total_credits) < 0.01;
END;
$$;


--
-- Name: validate_journal_entry(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_journal_entry(p_journal_id uuid) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
    total_dr NUMERIC;
    total_cr NUMERIC;
    line_count INTEGER;
    result JSONB;
BEGIN
    -- Get totals
    SELECT
        COALESCE(SUM(debit_amount), 0),
        COALESCE(SUM(credit_amount), 0),
        COUNT(*)
    INTO total_dr, total_cr, line_count
    FROM public.journal_entry_lines
    WHERE journal_entry_id = p_journal_id;
    -- Build result
    result := jsonb_build_object(
        'is_valid', (total_dr = total_cr AND total_dr > 0 AND line_count >= 2),
        'total_debit', total_dr,
        'total_credit', total_cr,
        'line_count', line_count,
        'is_balanced', (total_dr = total_cr),
        'has_amount', (total_dr > 0),
        'has_minimum_lines', (line_count >= 2),
        'errors', CASE
            WHEN total_dr != total_cr THEN 'Debit dan Credit tidak seimbang'
            WHEN total_dr = 0 THEN 'Jumlah transaksi harus lebih dari 0'
            WHEN line_count < 2 THEN 'Minimal harus ada 2 baris jurnal'
            ELSE NULL
        END
    );
    RETURN result;
END;
$$;


--
-- Name: validate_transaction_status_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_transaction_status_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- Jika transaksi adalah laku kantor, tidak boleh masuk ke delivery flow
  IF NEW.is_office_sale = true AND NEW.status IN ('Siap Antar', 'Diantar Sebagian') THEN
    -- Auto change ke 'Selesai' untuk laku kantor
    NEW.status := 'Selesai';
  END IF;
  
  RETURN NEW;
END;
$$;


--
-- Name: void_closing_entry_atomic(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_closing_entry_atomic(p_branch_id uuid, p_year integer) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal_id UUID;
BEGIN
  -- 1. Ambil data closing
  SELECT journal_entry_id INTO v_journal_id
  FROM closing_periods
  WHERE year = p_year AND branch_id = p_branch_id;
  IF v_journal_id IS NULL THEN
    RETURN QUERY SELECT FALSE, format('Tidak ada tutup buku untuk tahun %s', p_year)::TEXT;
    RETURN;
  END IF;
  -- 2. Cek apakah ada transaksi di tahun berikutnya (Opsional, tapi bagus untuk kontrol)
  -- Untuk saat ini kita biarkan void selama journal belum di-audit/lock manual
  
  -- 3. Void Journal
  UPDATE journal_entries
  SET is_voided = TRUE, status = 'voided', voided_reason = format('Pembatalan tutup buku tahun %s', p_year)
  WHERE id = v_journal_id;
  -- 4. Hapus Closing Period
  DELETE FROM closing_periods WHERE year = p_year AND branch_id = p_branch_id;
  RETURN QUERY SELECT TRUE, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: void_commission_payment(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_commission_payment(p_payment_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text) RETURNS TABLE(success boolean, journals_voided integer, commissions_restored integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payment RECORD;
  v_journals_voided INTEGER := 0;
  v_commissions_restored INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  IF p_payment_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Payment ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get payment record
  SELECT * INTO v_payment
  FROM commission_payments
  WHERE id = p_payment_id AND branch_id = p_branch_id;

  IF v_payment.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 'Commission payment not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== RESTORE COMMISSION ENTRIES ====================
  -- Reset commission status from 'paid' back to 'pending'
  UPDATE commission_entries
  SET
    status = 'pending',
    paid_at = NULL,
    payment_id = NULL,
    updated_at = NOW()
  WHERE payment_id = p_payment_id
    AND branch_id = p_branch_id
    AND status = 'paid';
  GET DIAGNOSTICS v_commissions_restored = ROW_COUNT;

  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    updated_at = NOW()
  WHERE reference_type = 'commission_payment'
    AND reference_id = p_payment_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE PAYMENT RECORD ====================
  DELETE FROM commission_payments WHERE id = p_payment_id;

  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, v_commissions_restored, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: void_delivery_atomic(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_reason text DEFAULT NULL::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, items_restored integer, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_delivery RECORD;
  v_transaction RECORD;
  v_item RECORD;
  v_restore_success BOOLEAN;
  v_items_restored INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_total_ordered NUMERIC;
  v_total_delivered NUMERIC;
  v_new_status TEXT;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;
  IF p_delivery_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Delivery ID is required'::TEXT;
    RETURN;
  END IF;
  -- Get delivery info (deliveries table tidak punya kolom status)
  SELECT
    d.id,
    d.transaction_id,
    d.branch_id,
    d.delivery_number
  INTO v_delivery
  FROM deliveries d
  WHERE d.id = p_delivery_id AND d.branch_id = p_branch_id;
  IF v_delivery.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Delivery not found in this branch'::TEXT;
    RETURN;
  END IF;
  -- Get transaction info (transaction_id is TEXT in deliveries table)
  SELECT * INTO v_transaction
  FROM transactions
  WHERE id::TEXT = v_delivery.transaction_id;
  IF v_transaction.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0,
      'Transaction not found for this delivery'::TEXT;
    RETURN;
  END IF;
  -- ==================== RESTORE INVENTORY ====================
  -- Restore dari delivery_items (yang benar-benar dikirim)
  FOR v_item IN
    SELECT
      di.product_id,
      di.quantity_delivered as quantity,
      di.product_name,
      di.is_bonus,
      COALESCE(p.cost_price, p.base_price, 0) as unit_cost,
      -- Some systems store product_type in specifications or dedicated column
      -- Let's check products table if it exists
      CASE WHEN (SELECT 1 FROM products p2 WHERE p2.id = di.product_id) IS NOT NULL THEN 'product' ELSE 'material' END as calculated_type
    FROM delivery_items di
    LEFT JOIN products p ON p.id = di.product_id -- This might be null for materials
    WHERE di.delivery_id = p_delivery_id
      AND di.quantity_delivered > 0
  LOOP
    IF v_item.calculated_type = 'product' THEN
      SELECT f.success INTO v_restore_success
      FROM restore_stock_fifo_v2(
        v_item.product_id,
        v_item.quantity,
        p_delivery_id::TEXT,
        'delivery',
        p_branch_id
      ) f;
    ELSE
      -- Handle Material restore
      SELECT f.success INTO v_restore_success
      FROM restore_material_fifo_v2(
        v_item.product_id, -- It's material_id here
        v_item.quantity,
        0, -- cost handled by batch
        p_delivery_id::TEXT,
        'delivery_void',
        p_branch_id
      ) f;
    END IF;

    IF v_restore_success THEN
      v_items_restored := v_items_restored + 1;
    END IF;
  END LOOP;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = COALESCE(p_reason, 'Delivery voided')
  WHERE reference_id = p_delivery_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== DELETE COMMISSIONS ====================
  DELETE FROM commission_entries
  WHERE delivery_id = p_delivery_id::TEXT; -- FIX: Cast UUID to TEXT
  -- ==================== UPDATE TRANSACTION STATUS ====================
  -- Hitung ulang status berdasarkan sisa delivery yang masih valid
  -- Get total ordered from transaction items
  SELECT
    COALESCE(SUM(
      CASE WHEN (item->>'_isSalesMeta')::BOOLEAN THEN 0
      ELSE (item->>'quantity')::NUMERIC END
    ), 0)
  INTO v_total_ordered
  FROM jsonb_array_elements(v_transaction.items) item;
  -- Get total delivered from remaining deliveries (exclude current one being voided)
  SELECT
    COALESCE(SUM(di.quantity_delivered), 0)
  INTO v_total_delivered
  FROM delivery_items di
  JOIN deliveries d ON d.id = di.delivery_id
  WHERE d.transaction_id = v_delivery.transaction_id
    AND d.id != p_delivery_id;  -- Exclude current delivery being voided
  -- Determine new status
  IF v_total_delivered >= v_total_ordered AND v_total_delivered > 0 THEN
    v_new_status := 'Selesai';
  ELSIF v_total_delivered > 0 THEN
    v_new_status := 'Diantar Sebagian';
  ELSE
    v_new_status := 'Pesanan Masuk';
  END IF;
  UPDATE transactions
  SET
    status = v_new_status
  WHERE id = v_transaction.id;
  -- Note: Delivery record deletion will be handled by frontend after RPC returns success
  -- This RPC only handles: restore inventory + void journals + update transaction status
  RETURN QUERY SELECT
    TRUE,
    v_items_restored,
    v_journals_voided,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION void_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_delivery_atomic(p_delivery_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid) IS 'Atomic void delivery: restore inventory + void journals. WAJIB branch_id.';


--
-- Name: void_employee_advance_atomic(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_advance RECORD;
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get advance
  SELECT * INTO v_advance
  FROM employee_advances
  WHERE id = p_advance_id::TEXT AND branch_id = p_branch_id
  FOR UPDATE;

  IF v_advance.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Kasbon tidak ditemukan'::TEXT;
    RETURN;
  END IF;

  -- Cannot void if there are payments
  IF v_advance.remaining_amount < v_advance.amount THEN
    RETURN QUERY SELECT FALSE, 0, 'Tidak bisa membatalkan kasbon yang sudah ada pembayaran'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNALS ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'advance'
    AND reference_id = p_advance_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== UPDATE ADVANCE STATUS ====================

  UPDATE employee_advances
  SET
    status = 'cancelled'
    -- updated_at doesn't exist in schema, removing it
  WHERE id = p_advance_id::TEXT;

  -- ==================== SUCCESS ====================

  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION void_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_employee_advance_atomic(p_advance_id uuid, p_branch_id uuid, p_reason text) IS 'Void employee advance and related journals. Only if no payments made.';


--
-- Name: void_journal_by_reference(text, text, uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_journal_by_reference(p_reference_id text, p_reference_type text, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text, p_reason text DEFAULT 'Cancelled'::text) RETURNS TABLE(success boolean, journals_voided integer, message text)
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_count INTEGER := 0;
BEGIN
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_by = p_user_id,
    voided_by_name = COALESCE(p_user_name, 'System'),
    void_reason = p_reason,
    status = 'voided'
  WHERE reference_id = p_reference_id
    AND reference_type = p_reference_type
    AND (is_voided = FALSE OR is_voided IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count > 0 THEN
    RETURN QUERY SELECT TRUE, v_count, format('Voided %s journal(s) for %s: %s', v_count, p_reference_type, p_reference_id)::TEXT;
  ELSE
    RETURN QUERY SELECT FALSE, 0, format('No journals found for %s: %s', p_reference_type, p_reference_id)::TEXT;
  END IF;
END;
$$;


--
-- Name: FUNCTION void_journal_by_reference(p_reference_id text, p_reference_type text, p_user_id uuid, p_user_name text, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_journal_by_reference(p_reference_id text, p_reference_type text, p_user_id uuid, p_user_name text, p_reason text) IS 'Void all journals related to a reference (transaction, delivery, etc)';


--
-- Name: void_journal_entry(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_journal_entry(p_journal_id uuid, p_branch_id uuid, p_reason text DEFAULT NULL::text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_journal RECORD;
BEGIN
  -- ==================== VALIDASI ====================

  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE,
      'Branch ID is REQUIRED - tidak boleh lintas cabang!'::TEXT;
    RETURN;
  END IF;

  IF p_journal_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal ID is required'::TEXT;
    RETURN;
  END IF;

  -- Get journal
  SELECT * INTO v_journal
  FROM journal_entries
  WHERE id = p_journal_id AND branch_id = p_branch_id;

  IF v_journal.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 'Journal not found in this branch'::TEXT;
    RETURN;
  END IF;

  IF v_journal.is_voided = TRUE THEN
    RETURN QUERY SELECT FALSE, 'Journal already voided'::TEXT;
    RETURN;
  END IF;

  -- ==================== VOID JOURNAL ====================

  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = COALESCE(p_reason, 'Voided via RPC'),
    updated_at = NOW()
  WHERE id = p_journal_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE AS success, SQLERRM::TEXT AS error_message;
END;
$$;


--
-- Name: FUNCTION void_journal_entry(p_journal_id uuid, p_branch_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_journal_entry(p_journal_id uuid, p_branch_id uuid, p_reason text) IS 'Void journal entry. WAJIB branch_id untuk isolasi.';


--
-- Name: void_payment_history_rpc(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_payment_history_rpc(p_payment_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Pembayaran dibatalkan'::text) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
    v_payment RECORD;
    v_transaction RECORD;
BEGIN
    -- Validasi branch_id
    IF p_branch_id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Branch ID is required'::TEXT;
        RETURN;
    END IF;

    -- Get payment info
    SELECT 
        ph.id,
        ph.transaction_id,
        ph.amount,
        ph.branch_id,
        ph.payment_date
    INTO v_payment
    FROM payment_history ph
    WHERE ph.id = p_payment_id
      AND ph.branch_id = p_branch_id;

    IF v_payment.id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Payment not found in this branch'::TEXT;
        RETURN;
    END IF;

    -- Get transaction info
    SELECT 
        t.id,
        t.total,
        t.paid_amount,
        t.payment_status
    INTO v_transaction
    FROM transactions t
    WHERE t.id = v_payment.transaction_id;

    IF v_transaction.id IS NULL THEN
        RETURN QUERY SELECT FALSE, 'Transaction not found'::TEXT;
        RETURN;
    END IF;

    -- Update transaction: reduce paid_amount
    UPDATE transactions
    SET 
        paid_amount = GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount),
        payment_status = CASE 
            WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount) >= total THEN 'Lunas'
            WHEN GREATEST(0, COALESCE(paid_amount, 0) - v_payment.amount) > 0 THEN 'Partial'
            ELSE 'Belum Lunas'
        END,
        updated_at = NOW()
    WHERE id = v_payment.transaction_id;

    -- Delete payment history record
    DELETE FROM payment_history
    WHERE id = p_payment_id;

    -- Void related journal entry if exists
    UPDATE journal_entries
    SET 
        is_voided = TRUE,
        voided_at = NOW(),
        void_reason = p_reason
    WHERE reference_type = 'receivable_payment'
      AND reference_id = p_payment_id::TEXT
      AND branch_id = p_branch_id;

    RETURN QUERY SELECT TRUE, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT FALSE, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION void_payment_history_rpc(p_payment_id uuid, p_branch_id uuid, p_reason text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_payment_history_rpc(p_payment_id uuid, p_branch_id uuid, p_reason text) IS 'Void/rollback payment history and restore receivable balance';


--
-- Name: void_payroll_record(uuid, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_payroll_record(p_payroll_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text) RETURNS TABLE(success boolean, journals_voided integer, commissions_restored integer, advances_restored numeric, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_payroll RECORD;
  v_journals_voided INTEGER := 0;
  v_commissions_restored INTEGER := 0;
  v_advances_restored NUMERIC := 0;
  v_advance_record RECORD;
  v_remaining_restore NUMERIC;
  v_restore_amount NUMERIC;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;

  -- Get payroll
  SELECT * INTO v_payroll
  FROM payroll_records
  WHERE id = p_payroll_id AND branch_id = p_branch_id;

  IF v_payroll.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, 'Payroll record not found'::TEXT;
    RETURN;
  END IF;

  -- ==================== ROLLBACK COMMISSIONS ====================
  -- Reset commission status from 'paid' back to 'pending'
  UPDATE commission_entries
  SET
    status = 'pending',
    paid_at = NULL,
    paid_via = NULL,
    updated_at = NOW()
  WHERE (payroll_id = p_payroll_id OR reference_id = p_payroll_id::TEXT)
    AND branch_id = p_branch_id
    AND status = 'paid';
  GET DIAGNOSTICS v_commissions_restored = ROW_COUNT;

  -- ==================== ROLLBACK ADVANCE DEDUCTIONS ====================
  -- NEW: Remove repayment records and restore balance
  IF v_payroll.advance_deduction > 0 THEN
    -- First, identify all repayments made by this payroll
    -- We use the naming convention 'PAY-' || p_payroll_id || '-' || v_advance.id
    -- to safely identify them
    
    FOR v_advance_record IN
      SELECT ar.advance_id, ar.amount, ar.id as repayment_id
      FROM advance_repayments ar
      WHERE ar.id LIKE 'PAY-' || p_payroll_id || '%'
    LOOP
      -- 1. Restore the balance in employee_advances
      UPDATE employee_advances
      SET
        remaining_amount = remaining_amount + v_advance_record.amount,
        status = 'active', -- Reactivate if it was paid
        notes = REPLACE(notes, ' (Lunas via Payroll)', '')
      WHERE id = v_advance_record.advance_id;
      
      v_advances_restored := v_advances_restored + v_advance_record.amount;
    END LOOP;
    
    -- 2. Delete the repayment records
    DELETE FROM advance_repayments WHERE id LIKE 'PAY-' || p_payroll_id || '%';
  END IF;

  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    updated_at = NOW()
  WHERE reference_type = 'payroll'
    AND reference_id = p_payroll_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- ==================== DELETE PAYROLL RECORD ====================
  DELETE FROM payroll_records WHERE id = p_payroll_id;

  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, v_commissions_restored, v_advances_restored, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, 0, 0::NUMERIC, SQLERRM::TEXT;
END;
$$;


--
-- Name: void_production_atomic(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_production_atomic(p_production_id uuid, p_branch_id uuid) RETURNS TABLE(success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
      WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref) 
        AND reference_type = 'production' AND type = 'OUT'
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
      WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref) 
        AND reference_type = 'production' AND type = 'OUT'
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
  WHERE (reference_id = v_record.id::TEXT OR reference_id = v_record.ref) 
    AND reference_type = 'production';

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
$$;


--
-- Name: void_retasi_atomic(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_retasi_atomic(p_retasi_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, batches_removed integer, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
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
$$;


--
-- Name: FUNCTION void_retasi_atomic(p_retasi_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_retasi_atomic(p_retasi_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid) IS 'Void retasi, remove restored batches and void journals.';


--
-- Name: void_transaction_atomic(text, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_transaction_atomic(p_transaction_id text, p_branch_id uuid, p_reason text DEFAULT 'Cancelled'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, items_restored integer, journals_voided integer, commissions_deleted integer, deliveries_deleted integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_transaction RECORD;
  v_items_restored INTEGER := 0;
  v_journals_voided INTEGER := 0;
  v_commissions_deleted INTEGER := 0;
  v_deliveries_deleted INTEGER := 0;
  v_item RECORD;
  v_batch RECORD;
  v_restore_qty NUMERIC;
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

  -- CASE 1: Office Sale (Direct Consumption)
  IF v_transaction.is_office_sale THEN
    -- Parse items from JSONB and restore full quantity
    FOR v_item IN 
      SELECT 
        (elem->>'productId')::TEXT as product_id_str,
        (elem->>'quantity')::NUMERIC as quantity,
        (elem->>'productType')::TEXT as product_type
      FROM jsonb_array_elements(v_transaction.items) as elem
      WHERE (elem->>'productId') IS NOT NULL
    LOOP
      -- Handle Products
      IF v_item.product_type IS NULL OR v_item.product_type = 'product' THEN
        -- Link back to the 'sale' consumption
        PERFORM public.restore_stock_fifo_v2(
          v_item.product_id_str::UUID,
          v_item.quantity,
          p_transaction_id,
          'sale', -- FIXED: Matches consume_stock_fifo_v2 call
          p_branch_id
        );
        v_items_restored := v_items_restored + 1;
      
      -- Handle Materials
      ELSIF v_item.product_type = 'material' THEN
        PERFORM public.restore_material_fifo_v2(
          v_item.product_id_str::UUID,
          v_item.quantity,
          0,
          p_transaction_id,
          'sale', -- FIXED
          p_branch_id
        );
        v_items_restored := v_items_restored + 1;
      END IF;
    END LOOP;

  -- CASE 2: Standard Sale (Delivery based)
  ELSE
    -- Restore stock based on ACTUAL DELIVERED items
    -- Loop through all deliveries for this transaction
    DECLARE
        v_delivery_rec RECORD;
        v_del_item RECORD;
    BEGIN
        FOR v_delivery_rec IN SELECT id, delivery_number FROM deliveries WHERE transaction_id = p_transaction_id LOOP
            FOR v_del_item IN 
              SELECT 
                di.product_id, 
                di.quantity_delivered,
                CASE WHEN EXISTS(SELECT 1 FROM products p WHERE p.id = di.product_id) THEN 'product' ELSE 'material' END as item_type
              FROM delivery_items di 
              WHERE di.delivery_id = v_delivery_rec.id 
            LOOP
                IF v_del_item.quantity_delivered > 0 THEN
                    IF v_del_item.item_type = 'product' THEN
                        PERFORM public.restore_stock_fifo_v2(
                            v_del_item.product_id,
                            v_del_item.quantity_delivered,
                            -- Note: delivery consumption uses transaction ref in some versions, or delivery ref in others.
                            -- We use NULL ref to force Strategy 2 (Add stock back) if unsure, 
                            -- OR use the most probable ref (TransactionRef) to try Strategy 1.
                            COALESCE(v_transaction.ref, 'TR-UNKNOWN'), 
                            'delivery',
                            p_branch_id
                        );
                    ELSE
                        -- Handle Material Restore (Rare but possible)
                        PERFORM public.restore_material_fifo_v2(
                            v_del_item.product_id,
                            v_del_item.quantity_delivered,
                            0, -- Cost handled by batch logic
                            COALESCE(v_transaction.ref, 'TR-UNKNOWN'),
                            'delivery',
                            p_branch_id
                        );
                    END IF;
                    v_items_restored := v_items_restored + 1;
                END IF;
            END LOOP;
        END LOOP;
    END;
  END IF;

  -- ==================== VOID JOURNALS ====================

  -- Void ALL related journals: Transaction, Receivable, Payment, and Adjustments
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Transaction voided (' || p_transaction_id || '): ' || p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE (
      (reference_type IN ('transaction', 'receivable', 'payment', 'adjustment') AND reference_id = p_transaction_id)
      OR 
      (description ILIKE '%' || p_transaction_id || '%')
    )
    AND branch_id = p_branch_id
    AND is_voided = FALSE;

  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;

  -- Void ALL related delivery journals
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = 'Parent Transaction voided (' || p_transaction_id || '): ' || p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE (
      (reference_type = 'delivery' AND reference_id IN (SELECT id::TEXT FROM deliveries WHERE transaction_id = p_transaction_id))
    )
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
  -- Clean up movement logs to keep data clean, although stock is already corrected above
  
  DELETE FROM product_stock_movements
  WHERE (reference_id = p_transaction_id OR reference_id IN (SELECT id::TEXT FROM deliveries WHERE transaction_id = p_transaction_id))
    AND reference_type IN ('transaction', 'delivery', 'fifo_consume', 'sale');

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

$$;


--
-- Name: FUNCTION void_transaction_atomic(p_transaction_id text, p_branch_id uuid, p_reason text, p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_transaction_atomic(p_transaction_id text, p_branch_id uuid, p_reason text, p_user_id uuid) IS 'Void transaction dengan restore inventory LIFO, void journals, delete commissions & deliveries.';


--
-- Name: void_zakat_payment_atomic(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.void_zakat_payment_atomic(p_zakat_id uuid, p_branch_id uuid, p_reason text DEFAULT 'Dibatalkan'::text, p_user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(success boolean, journals_voided integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE
  v_zakat RECORD;
  v_journals_voided INTEGER := 0;
BEGIN
  -- ==================== VALIDASI ====================
  IF p_branch_id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Branch ID is REQUIRED!'::TEXT;
    RETURN;
  END IF;
  -- Get zakat record
  SELECT * INTO v_zakat
  FROM zakat_payments
  WHERE id = p_zakat_id AND branch_id = p_branch_id
  FOR UPDATE;
  IF v_zakat.id IS NULL THEN
    RETURN QUERY SELECT FALSE, 0, 'Pembayaran zakat tidak ditemukan'::TEXT;
    RETURN;
  END IF;
  IF v_zakat.status = 'cancelled' THEN
    RETURN QUERY SELECT FALSE, 0, 'Pembayaran zakat sudah dibatalkan'::TEXT;
    RETURN;
  END IF;
  -- ==================== VOID JOURNALS ====================
  UPDATE journal_entries
  SET
    is_voided = TRUE,
    voided_at = NOW(),
    voided_reason = p_reason,
    status = 'voided',
    updated_at = NOW()
  WHERE reference_type = 'zakat'
    AND reference_id = p_zakat_id::TEXT
    AND branch_id = p_branch_id
    AND is_voided = FALSE;
  GET DIAGNOSTICS v_journals_voided = ROW_COUNT;
  -- ==================== UPDATE STATUS ====================
  UPDATE zakat_payments
  SET
    status = 'cancelled',
    updated_at = NOW()
  WHERE id = p_zakat_id;
  -- ==================== SUCCESS ====================
  RETURN QUERY SELECT TRUE, v_journals_voided, NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, 0, SQLERRM::TEXT;
END;
$$;


--
-- Name: FUNCTION void_zakat_payment_atomic(p_zakat_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.void_zakat_payment_atomic(p_zakat_id uuid, p_branch_id uuid, p_reason text, p_user_id uuid) IS 'Void zakat payment and related journals.';


--
-- Name: accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts (
    id text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    balance numeric NOT NULL,
    is_payment_account boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    initial_balance numeric DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    code character varying(10),
    parent_id text,
    level integer DEFAULT 1,
    is_header boolean DEFAULT false,
    is_active boolean DEFAULT true,
    sort_order integer DEFAULT 0,
    branch_id uuid,
    employee_id uuid,
    normal_balance text DEFAULT 'DEBIT'::text,
    CONSTRAINT accounts_level_check CHECK (((level >= 1) AND (level <= 4)))
);


--
-- Name: COLUMN accounts.balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.balance IS 'Saldo saat ini yang dihitung dari initial_balance + semua transaksi';


--
-- Name: COLUMN accounts.initial_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.initial_balance IS 'Saldo awal yang diinput oleh owner, tidak berubah kecuali diupdate manual';


--
-- Name: COLUMN accounts.code; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.code IS 'Kode akun standar (1000, 1100, 1110, dst)';


--
-- Name: COLUMN accounts.parent_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.parent_id IS 'ID parent account untuk hierarki';


--
-- Name: COLUMN accounts.level; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.level IS 'Level hierarki: 1=Header, 2=Sub-header, 3=Detail, 4=Sub-detail';


--
-- Name: COLUMN accounts.is_header; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.is_header IS 'Apakah ini header account (tidak bisa digunakan untuk transaksi)';


--
-- Name: COLUMN accounts.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.is_active IS 'Status aktif account';


--
-- Name: COLUMN accounts.sort_order; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts.sort_order IS 'Urutan tampilan dalam laporan';


--
-- Name: accounts_balance_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts_balance_backup (
    id text,
    code character varying(10),
    name text,
    balance numeric,
    initial_balance numeric,
    branch_id uuid,
    created_at timestamp with time zone
);


--
-- Name: accounts_payable; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.accounts_payable (
    id text NOT NULL,
    purchase_order_id text,
    supplier_name text NOT NULL,
    amount numeric NOT NULL,
    due_date timestamp with time zone,
    description text NOT NULL,
    status text DEFAULT 'Outstanding'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    paid_at timestamp with time zone,
    paid_amount numeric DEFAULT 0,
    payment_account_id text,
    notes text,
    interest_rate numeric DEFAULT 0,
    interest_type text DEFAULT 'flat'::text,
    creditor_type text DEFAULT 'supplier'::text,
    branch_id uuid,
    tenor_months integer DEFAULT 1,
    CONSTRAINT accounts_payable_creditor_type_check CHECK ((creditor_type = ANY (ARRAY['supplier'::text, 'bank'::text, 'credit_card'::text, 'other'::text]))),
    CONSTRAINT accounts_payable_interest_type_check CHECK ((interest_type = ANY (ARRAY['flat'::text, 'per_month'::text, 'per_year'::text]))),
    CONSTRAINT accounts_payable_status_check CHECK ((status = ANY (ARRAY['Outstanding'::text, 'Paid'::text, 'Partial'::text])))
);


--
-- Name: COLUMN accounts_payable.interest_rate; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts_payable.interest_rate IS 'Interest rate in percentage (e.g., 5 for 5%)';


--
-- Name: COLUMN accounts_payable.interest_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts_payable.interest_type IS 'Type of interest calculation: flat (one-time), per_month (monthly), per_year (annual)';


--
-- Name: COLUMN accounts_payable.creditor_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.accounts_payable.creditor_type IS 'Type of creditor: supplier, bank, credit_card, or other';


--
-- Name: active_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.active_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_token character varying(64) NOT NULL,
    device_info text,
    ip_address character varying(45),
    created_at timestamp with time zone DEFAULT now(),
    last_activity timestamp with time zone DEFAULT now()
);


--
-- Name: advance_repayments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.advance_repayments (
    id text NOT NULL,
    advance_id text,
    amount numeric NOT NULL,
    date timestamp with time zone NOT NULL,
    recorded_by text
);


--
-- Name: asset_maintenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.asset_maintenance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid,
    maintenance_date date,
    maintenance_type text,
    description text,
    cost numeric(15,2) DEFAULT 0,
    performed_by text,
    next_maintenance_date date,
    status text DEFAULT 'completed'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    scheduled_date date,
    title text,
    completed_date date,
    is_recurring boolean DEFAULT false,
    recurrence_interval integer,
    recurrence_unit text,
    priority text DEFAULT 'medium'::text,
    estimated_cost numeric(15,2) DEFAULT 0,
    actual_cost numeric(15,2) DEFAULT 0,
    payment_account_id text,
    payment_account_name text,
    service_provider text,
    technician_name text,
    parts_replaced text,
    labor_hours numeric(10,2),
    work_performed text,
    findings text,
    recommendations text,
    attachments text,
    notify_before_days integer DEFAULT 7,
    notification_sent boolean DEFAULT false,
    created_by uuid,
    completed_by uuid,
    expense_id text,
    photo_url text
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text,
    category text,
    purchase_date date,
    purchase_price numeric(15,2) DEFAULT 0,
    current_value numeric(15,2) DEFAULT 0,
    depreciation_method text DEFAULT 'straight_line'::text,
    useful_life_years integer DEFAULT 5,
    salvage_value numeric(15,2) DEFAULT 0,
    location text,
    status text DEFAULT 'active'::text,
    notes text,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    asset_name text GENERATED ALWAYS AS (name) STORED,
    asset_code text,
    description text,
    supplier_name text,
    brand text,
    model text,
    serial_number text,
    condition text DEFAULT 'good'::text,
    account_id text,
    warranty_expiry date,
    insurance_expiry date,
    photo_url text,
    created_by uuid
);


--
-- Name: attendance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid,
    date date DEFAULT CURRENT_DATE NOT NULL,
    check_in timestamp with time zone,
    check_out timestamp with time zone,
    status text DEFAULT 'present'::text,
    notes text,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    check_in_time timestamp with time zone,
    check_out_time timestamp with time zone
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    operation text NOT NULL,
    record_id text,
    old_data jsonb,
    new_data jsonb,
    user_id uuid,
    user_email text,
    user_role text,
    additional_info jsonb,
    created_at timestamp with time zone DEFAULT now(),
    changed_fields jsonb,
    ip_address text,
    user_agent text
);


--
-- Name: balance_adjustments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.balance_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text NOT NULL,
    adjustment_type text NOT NULL,
    old_balance numeric,
    new_balance numeric,
    adjustment_amount numeric,
    reason text NOT NULL,
    reference_number text,
    adjusted_by uuid,
    adjusted_by_name text,
    created_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_at timestamp with time zone,
    status text DEFAULT 'pending'::text,
    CONSTRAINT balance_adjustments_adjustment_type_check CHECK ((adjustment_type = ANY (ARRAY['reconciliation'::text, 'initial_balance'::text, 'correction'::text]))),
    CONSTRAINT balance_adjustments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: bonus_pricings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.bonus_pricings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    min_quantity integer NOT NULL,
    max_quantity integer,
    bonus_quantity integer DEFAULT 0 NOT NULL,
    bonus_type text NOT NULL,
    bonus_value numeric(15,2) DEFAULT 0 NOT NULL,
    description text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT bonus_pricings_bonus_type_check CHECK ((bonus_type = ANY (ARRAY['quantity'::text, 'percentage'::text, 'fixed_discount'::text])))
);


--
-- Name: TABLE bonus_pricings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.bonus_pricings IS 'Bonus rules based on purchase quantity';


--
-- Name: COLUMN bonus_pricings.min_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bonus_pricings.min_quantity IS 'Minimum quantity for this bonus rule';


--
-- Name: COLUMN bonus_pricings.max_quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bonus_pricings.max_quantity IS 'Maximum quantity for this bonus rule (NULL means no upper limit)';


--
-- Name: COLUMN bonus_pricings.bonus_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bonus_pricings.bonus_type IS 'Type of bonus: quantity (free items), percentage (% discount), fixed_discount (fixed amount discount)';


--
-- Name: COLUMN bonus_pricings.bonus_value; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.bonus_pricings.bonus_value IS 'Value of bonus depending on type: quantity in pieces, percentage (0-100), or fixed discount amount';


--
-- Name: branches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    is_main boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    company_id uuid,
    manager_id uuid,
    manager_name text,
    settings jsonb DEFAULT '{}'::jsonb,
    code text,
    email text,
    city text,
    province text,
    postal_code text,
    country text DEFAULT 'Indonesia'::text
);


--
-- Name: cash_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text NOT NULL,
    transaction_type text NOT NULL,
    amount numeric NOT NULL,
    description text NOT NULL,
    reference_number text,
    created_by uuid,
    created_by_name text,
    source_type text,
    created_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    type text,
    account_name text,
    CONSTRAINT cash_history_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT cash_history_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['income'::text, 'expense'::text])))
);


--
-- Name: closing_periods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.closing_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    year integer NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_by uuid,
    journal_entry_id uuid,
    net_income numeric DEFAULT 0 NOT NULL,
    branch_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: commission_duplicates_backup; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_duplicates_backup (
    id uuid,
    user_id text,
    user_name text,
    role text,
    product_id uuid,
    product_name text,
    quantity integer,
    rate_per_qty numeric(15,2),
    amount numeric(15,2),
    transaction_id text,
    delivery_id text,
    ref text,
    status text,
    created_at timestamp with time zone,
    branch_id uuid
);


--
-- Name: commission_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id text NOT NULL,
    user_name text NOT NULL,
    role text NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    quantity integer DEFAULT 0 NOT NULL,
    rate_per_qty numeric(15,2) DEFAULT 0 NOT NULL,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    transaction_id text,
    delivery_id text,
    ref text NOT NULL,
    status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    CONSTRAINT commission_entries_role_check CHECK ((role = ANY (ARRAY['sales'::text, 'driver'::text, 'helper'::text]))),
    CONSTRAINT commission_entries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'cancelled'::text])))
);


--
-- Name: commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.commission_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    role text NOT NULL,
    rate_per_qty numeric(15,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT commission_rules_role_check CHECK ((role = ANY (ARRAY['sales'::text, 'driver'::text, 'helper'::text, 'operator'::text, 'supervisor'::text])))
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    address text,
    phone text,
    email text,
    tax_id text,
    logo_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    code text,
    is_head_office boolean DEFAULT false,
    is_active boolean DEFAULT true
);


--
-- Name: company_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_settings (
    key text NOT NULL,
    value text
);


--
-- Name: customer_pricings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_pricings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    customer_id uuid,
    customer_classification text,
    price_type text DEFAULT 'fixed'::text,
    price_value numeric(15,2),
    priority integer DEFAULT 0,
    description text,
    is_active boolean DEFAULT true,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: customer_visits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    customer_id uuid NOT NULL,
    visited_by text,
    visited_by_name text,
    visited_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    phone text,
    address text,
    "orderCount" integer DEFAULT 0,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    latitude numeric,
    longitude numeric,
    full_address text,
    store_photo_url text,
    store_photo_drive_id text,
    jumlah_galon_titip integer DEFAULT 0,
    branch_id uuid,
    classification text,
    last_visited_at timestamp with time zone,
    last_visited_by uuid,
    visit_count integer DEFAULT 0,
    ordercount integer DEFAULT 0,
    createdat timestamp with time zone DEFAULT now()
);


--
-- Name: COLUMN customers.jumlah_galon_titip; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.customers.jumlah_galon_titip IS 'Jumlah galon yang dititip di pelanggan';


--
-- Name: transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactions (
    id text NOT NULL,
    customer_id uuid,
    customer_name text,
    cashier_id uuid,
    cashier_name text,
    designer_id uuid,
    operator_id uuid,
    payment_account_id text,
    order_date timestamp with time zone NOT NULL,
    finish_date timestamp with time zone,
    items jsonb,
    total numeric NOT NULL,
    paid_amount numeric NOT NULL,
    payment_status text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    subtotal numeric DEFAULT 0,
    ppn_enabled boolean DEFAULT false,
    ppn_percentage numeric DEFAULT 11,
    ppn_amount numeric DEFAULT 0,
    is_office_sale boolean DEFAULT false,
    due_date timestamp with time zone,
    ppn_mode text,
    sales_id uuid,
    sales_name text,
    retasi_id uuid,
    retasi_number text,
    branch_id uuid,
    notes text,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    correction_of text,
    is_voided boolean DEFAULT false,
    voided_at timestamp with time zone,
    voided_by uuid,
    void_reason text,
    hpp_snapshot jsonb,
    hpp_total numeric DEFAULT 0,
    ref text,
    delivery_status text DEFAULT 'pending'::text,
    delivered_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    voided_reason text,
    assigned_driver_id uuid,
    CONSTRAINT transaction_status_check CHECK ((status = ANY (ARRAY['Pesanan Masuk'::text, 'Siap Antar'::text, 'Diantar Sebagian'::text, 'Selesai'::text, 'Dibatalkan'::text]))),
    CONSTRAINT transactions_ppn_mode_check CHECK ((ppn_mode = ANY (ARRAY['include'::text, 'exclude'::text])))
);


--
-- Name: TABLE transactions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.transactions IS 'Transaction data. Delivery information is now handled separately in deliveries and delivery_items tables as of migration 0034.';


--
-- Name: COLUMN transactions.subtotal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.subtotal IS 'Total sebelum PPN dan setelah diskon';


--
-- Name: COLUMN transactions.ppn_enabled; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.ppn_enabled IS 'Apakah PPN diaktifkan untuk transaksi ini';


--
-- Name: COLUMN transactions.ppn_percentage; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.ppn_percentage IS 'Persentase PPN yang digunakan (default 11%)';


--
-- Name: COLUMN transactions.ppn_amount; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.ppn_amount IS 'Jumlah PPN dalam rupiah';


--
-- Name: COLUMN transactions.is_office_sale; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.is_office_sale IS 'Menandakan apakah produk laku kantor (true) atau perlu diantar (false)';


--
-- Name: COLUMN transactions.due_date; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.due_date IS 'Tanggal jatuh tempo untuk pembayaran kredit';


--
-- Name: COLUMN transactions.ppn_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.ppn_mode IS 'Mode PPN: include (sudah termasuk) atau exclude (belum termasuk)';


--
-- Name: COLUMN transactions.sales_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.sales_id IS 'ID of the sales person responsible for this transaction';


--
-- Name: COLUMN transactions.sales_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.sales_name IS 'Name of the sales person responsible for this transaction';


--
-- Name: COLUMN transactions.retasi_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.retasi_id IS 'Reference to retasi table - links driver transactions to their active retasi';


--
-- Name: COLUMN transactions.retasi_number; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.transactions.retasi_number IS 'Retasi number for display purposes (e.g., RET-20251213-001)';


--
-- Name: daily_stats; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.daily_stats AS
 SELECT CURRENT_DATE AS date,
    count(*) AS total_transactions,
    sum(transactions.total) AS total_revenue,
    count(DISTINCT transactions.customer_id) AS unique_customers,
    avg(transactions.total) AS avg_transaction_value
   FROM public.transactions
  WHERE (date(transactions.order_date) = CURRENT_DATE)
  WITH NO DATA;


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    base_price numeric NOT NULL,
    unit text NOT NULL,
    min_order integer NOT NULL,
    description text,
    specifications jsonb,
    materials jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'Produksi'::text,
    current_stock numeric DEFAULT 0,
    min_stock numeric DEFAULT 0,
    branch_id uuid,
    cost_price numeric(15,2),
    is_shared boolean DEFAULT false,
    initial_stock numeric DEFAULT 0
);


--
-- Name: COLUMN products.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.type IS 'Jenis barang: Stock (produksi menurunkan stock), Beli (produksi menambah stock)';


--
-- Name: COLUMN products.current_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.current_stock IS 'Stock saat ini';


--
-- Name: COLUMN products.min_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.products.min_stock IS 'Stock minimum untuk alert';


--
-- Name: dashboard_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.dashboard_summary AS
 WITH recent_transactions AS (
         SELECT count(*) AS total_transactions,
            sum(transactions.total) AS total_revenue,
            count(
                CASE
                    WHEN (transactions.payment_status = 'Lunas'::text) THEN 1
                    ELSE NULL::integer
                END) AS paid_transactions,
            count(
                CASE
                    WHEN (transactions.payment_status = 'Belum Lunas'::text) THEN 1
                    ELSE NULL::integer
                END) AS unpaid_transactions
           FROM public.transactions
          WHERE (transactions.order_date >= (CURRENT_DATE - '30 days'::interval))
        ), stock_summary AS (
         SELECT count(*) AS total_products,
            count(
                CASE
                    WHEN (((products.specifications ->> 'stock'::text))::numeric <= (products.min_order)::numeric) THEN 1
                    ELSE NULL::integer
                END) AS low_stock_products
           FROM public.products
        ), customer_summary AS (
         SELECT count(*) AS total_customers
           FROM public.customers
        )
 SELECT rt.total_transactions,
    rt.total_revenue,
    rt.paid_transactions,
    rt.unpaid_transactions,
    ss.total_products,
    ss.low_stock_products,
    cs.total_customers
   FROM recent_transactions rt,
    stock_summary ss,
    customer_summary cs;


--
-- Name: debt_installments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.debt_installments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    debt_id text NOT NULL,
    installment_number integer NOT NULL,
    due_date timestamp with time zone NOT NULL,
    principal_amount numeric DEFAULT 0 NOT NULL,
    interest_amount numeric DEFAULT 0 NOT NULL,
    total_amount numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    paid_at timestamp with time zone,
    paid_amount numeric DEFAULT 0,
    payment_account_id text,
    notes text,
    branch_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT debt_installments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'overdue'::text])))
);


--
-- Name: deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deliveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text NOT NULL,
    delivery_number integer NOT NULL,
    delivery_date timestamp with time zone DEFAULT now() NOT NULL,
    photo_url text,
    photo_drive_id text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id uuid,
    driver_id uuid,
    helper_id uuid,
    driver_name text,
    helper_name text,
    customer_name text,
    customer_address text,
    customer_phone text,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    hpp_total numeric DEFAULT 0,
    hpp_snapshot jsonb,
    status text DEFAULT 'delivered'::text,
    latitude numeric,
    longitude numeric,
    helper_id_2 uuid,
    helper_name_2 text,
    helper_id_3 uuid,
    helper_name_3 text,
    CONSTRAINT delivery_number_positive CHECK ((delivery_number > 0))
);


--
-- Name: delivery_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    delivery_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_name text NOT NULL,
    quantity_delivered integer NOT NULL,
    unit text NOT NULL,
    width numeric,
    height numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    is_bonus boolean DEFAULT false,
    CONSTRAINT delivery_items_quantity_delivered_check CHECK ((quantity_delivered > 0))
);


--
-- Name: delivery_photos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    delivery_id uuid,
    photo_url text NOT NULL,
    photo_type text DEFAULT 'delivery'::text,
    description text,
    uploaded_at timestamp with time zone DEFAULT now()
);


--
-- Name: delivery_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delivery_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text,
    driver_id uuid,
    status text DEFAULT 'pending'::text,
    notes text,
    photo_url text,
    reported_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: employee_advances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employee_advances (
    id text NOT NULL,
    employee_id uuid,
    employee_name text,
    amount numeric NOT NULL,
    date timestamp with time zone NOT NULL,
    notes text,
    remaining_amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    account_id text,
    account_name text,
    branch_id uuid,
    purpose text,
    status text DEFAULT 'pending'::text,
    approved_by uuid,
    approved_at timestamp with time zone
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'user'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    password_hash character varying(255),
    branch_id uuid,
    username text,
    phone text,
    address text,
    status text DEFAULT 'Aktif'::text,
    name text GENERATED ALWAYS AS (full_name) STORED,
    allowed_branches uuid[] DEFAULT '{}'::uuid[],
    password_changed_at timestamp with time zone DEFAULT now(),
    current_session_id character varying(36),
    session_started_at timestamp without time zone,
    pin text
);


--
-- Name: COLUMN profiles.allowed_branches; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.allowed_branches IS 'Array of branch UUIDs user can access. Empty means all branches.';


--
-- Name: COLUMN profiles.pin; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.profiles.pin IS 'User PIN for idle session validation (4-6 digits). If NULL, PIN validation is bypassed for this user.';


--
-- Name: employee_salary_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.employee_salary_summary AS
 SELECT es.id,
    es.employee_id,
    p.full_name AS employee_name,
    p.role AS employee_role,
    es.base_salary,
    es.commission_rate,
    es.payroll_type,
    es.commission_type,
    es.effective_from,
    es.effective_until,
    es.is_active,
    es.created_by,
    es.created_at,
    es.updated_at,
    es.notes
   FROM (public.employee_salaries es
     LEFT JOIN public.profiles p ON ((es.employee_id = p.id)));


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id text NOT NULL,
    description text NOT NULL,
    amount numeric NOT NULL,
    account_id text,
    account_name text,
    date timestamp with time zone NOT NULL,
    category text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expense_account_id character varying(50),
    expense_account_name character varying(100),
    branch_id uuid,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    photo_url text,
    status text DEFAULT 'approved'::text
);


--
-- Name: COLUMN expenses.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.expenses.status IS 'Status pengeluaran: pending, approved, rejected';


--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_number text NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    description text NOT NULL,
    reference_type text,
    reference_id text,
    status text DEFAULT 'draft'::text NOT NULL,
    total_debit numeric(15,2) DEFAULT 0 NOT NULL,
    total_credit numeric(15,2) DEFAULT 0 NOT NULL,
    created_by uuid,
    created_by_name text,
    created_at timestamp with time zone DEFAULT now(),
    approved_by uuid,
    approved_by_name text,
    approved_at timestamp with time zone,
    is_voided boolean DEFAULT false,
    voided_by uuid,
    voided_by_name text,
    voided_at timestamp with time zone,
    void_reason text,
    branch_id uuid,
    entry_time time without time zone DEFAULT CURRENT_TIME,
    voided_reason text,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT journal_entries_balanced CHECK ((total_debit = total_credit)),
    CONSTRAINT journal_entries_reference_type_check CHECK (((reference_type IS NULL) OR (reference_type = ANY (ARRAY['transaction'::text, 'expense'::text, 'payroll'::text, 'transfer'::text, 'manual'::text, 'adjustment'::text, 'closing'::text, 'opening'::text, 'opening_balance'::text, 'receivable_payment'::text, 'advance'::text, 'advance_payment'::text, 'payable_payment'::text, 'purchase'::text, 'purchase_order'::text, 'receivable'::text, 'payable'::text, 'production'::text, 'production_error'::text, 'tax_payment'::text, 'zakat'::text, 'asset'::text, 'commission'::text, 'debt_installment'::text])))),
    CONSTRAINT journal_entries_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'posted'::text, 'voided'::text])))
);


--
-- Name: TABLE journal_entries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.journal_entries IS 'Jurnal Umum - Header untuk setiap entri jurnal double-entry';


--
-- Name: journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.journal_entry_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_entry_id uuid NOT NULL,
    line_number integer DEFAULT 1 NOT NULL,
    account_id text NOT NULL,
    account_code text,
    account_name text,
    debit_amount numeric(15,2) DEFAULT 0 NOT NULL,
    credit_amount numeric(15,2) DEFAULT 0 NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT journal_entry_lines_amount_check CHECK ((((debit_amount > (0)::numeric) AND (credit_amount = (0)::numeric)) OR ((debit_amount = (0)::numeric) AND (credit_amount > (0)::numeric))))
);


--
-- Name: TABLE journal_entry_lines; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.journal_entry_lines IS 'Baris Jurnal - Detail debit/credit per akun untuk setiap jurnal';


--
-- Name: general_ledger; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.general_ledger AS
 SELECT jel.account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.type AS account_type,
    je.entry_date,
    je.entry_number,
    je.description AS journal_description,
    jel.description AS line_description,
    jel.debit_amount,
    jel.credit_amount,
    je.reference_type,
    je.reference_id,
    je.branch_id,
    je.status,
    je.is_voided,
    je.created_at
   FROM ((public.journal_entry_lines jel
     JOIN public.journal_entries je ON ((jel.journal_entry_id = je.id)))
     JOIN public.accounts a ON ((jel.account_id = a.id)))
  WHERE ((je.status = 'posted'::text) AND (je.is_voided = false))
  ORDER BY a.code, je.entry_date, je.entry_number;


--
-- Name: VIEW general_ledger; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.general_ledger IS 'Buku Besar - View semua transaksi per akun dari jurnal yang sudah di-posting';


--
-- Name: inventory_batch_consumptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_batch_consumptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    transaction_id text,
    quantity_consumed numeric(15,2) NOT NULL,
    unit_cost numeric(15,2) NOT NULL,
    total_cost numeric(15,2) NOT NULL,
    consumed_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    total_hpp numeric DEFAULT 0,
    batches_detail jsonb,
    reference_id text,
    reference_type text,
    CONSTRAINT qty_consumed_positive CHECK ((quantity_consumed > (0)::numeric))
);


--
-- Name: inventory_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid,
    branch_id uuid,
    batch_date timestamp with time zone DEFAULT now() NOT NULL,
    purchase_order_id text,
    supplier_id uuid,
    initial_quantity numeric(15,2) NOT NULL,
    remaining_quantity numeric(15,2) NOT NULL,
    unit_cost numeric(15,2) NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    material_id uuid,
    production_id uuid,
    CONSTRAINT initial_qty_non_negative CHECK ((initial_quantity >= (0)::numeric))
);


--
-- Name: manual_journal_entries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_journal_entries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entry_number character varying(50) NOT NULL,
    entry_date date DEFAULT CURRENT_DATE NOT NULL,
    description text,
    notes text,
    status character varying(20) DEFAULT 'draft'::character varying,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: manual_journal_entry_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.manual_journal_entry_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    journal_entry_id uuid,
    account_id uuid,
    description text,
    debit numeric(15,2) DEFAULT 0,
    credit numeric(15,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: material_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.material_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_id uuid NOT NULL,
    material_name text NOT NULL,
    type text NOT NULL,
    reason text NOT NULL,
    quantity numeric NOT NULL,
    previous_stock numeric NOT NULL,
    new_stock numeric NOT NULL,
    notes text,
    reference_id text,
    reference_type text,
    user_id uuid,
    user_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    CONSTRAINT material_stock_movements_reason_check CHECK ((reason = ANY (ARRAY['PURCHASE'::text, 'PRODUCTION_CONSUMPTION'::text, 'PRODUCTION_ACQUISITION'::text, 'ADJUSTMENT'::text, 'RETURN'::text, 'PRODUCTION_ERROR'::text, 'PRODUCTION_DELETE_RESTORE'::text]))),
    CONSTRAINT material_stock_movements_type_check CHECK ((type = ANY (ARRAY['IN'::text, 'OUT'::text, 'ADJUSTMENT'::text]))),
    CONSTRAINT positive_quantity CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE material_stock_movements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.material_stock_movements IS 'History of all material stock movements and changes';


--
-- Name: COLUMN material_stock_movements.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.type IS 'Type of movement: IN (stock bertambah), OUT (stock berkurang), ADJUSTMENT (penyesuaian)';


--
-- Name: COLUMN material_stock_movements.reason; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reason IS 'Reason for movement: PURCHASE, PRODUCTION_CONSUMPTION, PRODUCTION_ACQUISITION, ADJUSTMENT, RETURN, PRODUCTION_ERROR, PRODUCTION_DELETE_RESTORE';


--
-- Name: COLUMN material_stock_movements.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.quantity IS 'Quantity moved (always positive)';


--
-- Name: COLUMN material_stock_movements.previous_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.previous_stock IS 'Stock before this movement';


--
-- Name: COLUMN material_stock_movements.new_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.new_stock IS 'Stock after this movement';


--
-- Name: COLUMN material_stock_movements.reference_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reference_id IS 'ID of related record (transaction, purchase order, etc)';


--
-- Name: COLUMN material_stock_movements.reference_type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.material_stock_movements.reference_type IS 'Type of reference (transaction, purchase_order, etc)';


--
-- Name: materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    unit text NOT NULL,
    price_per_unit numeric NOT NULL,
    stock numeric NOT NULL,
    min_stock numeric NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text DEFAULT 'Stock'::text,
    branch_id uuid,
    cost_price numeric(15,2) DEFAULT 0,
    CONSTRAINT materials_type_check CHECK ((type = ANY (ARRAY['Stock'::text, 'Beli'::text])))
);


--
-- Name: COLUMN materials.stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.materials.stock IS 'DEPRECATED: Use v_material_current_stock.current_stock instead. This column is kept for backwards compatibility only.';


--
-- Name: COLUMN materials.type; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.materials.type IS 'Jenis bahan: Stock (produksi menurunkan stock), Beli (produksi menambah stock)';


--
-- Name: nishab_reference; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nishab_reference (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gold_price numeric(15,2),
    silver_price numeric(15,2),
    gold_nishab numeric(15,4) DEFAULT 85,
    silver_nishab numeric(15,4) DEFAULT 595,
    zakat_rate numeric(5,4) DEFAULT 0.025,
    effective_date date DEFAULT CURRENT_DATE,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    notes text
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    message text,
    type text DEFAULT 'info'::text,
    is_read boolean DEFAULT false,
    link text,
    created_at timestamp with time zone DEFAULT now(),
    reference_type text,
    reference_id text,
    reference_url text,
    priority text DEFAULT 'normal'::text,
    read_at timestamp with time zone,
    expires_at timestamp with time zone
);


--
-- Name: payment_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text NOT NULL,
    amount numeric NOT NULL,
    payment_date timestamp with time zone DEFAULT now() NOT NULL,
    remaining_amount numeric NOT NULL,
    payment_method text DEFAULT 'Tunai'::text,
    account_id text,
    account_name text,
    notes text,
    recorded_by uuid,
    recorded_by_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    branch_id uuid,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    CONSTRAINT payment_history_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT payment_history_remaining_amount_check CHECK ((remaining_amount >= (0)::numeric))
);


--
-- Name: payroll_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payroll_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    employee_id uuid,
    period_start date NOT NULL,
    period_end date NOT NULL,
    base_salary numeric(15,2) DEFAULT 0,
    total_commission numeric(15,2) DEFAULT 0,
    total_bonus numeric(15,2) DEFAULT 0,
    total_deductions numeric(15,2) DEFAULT 0,
    advance_deduction numeric(15,2) DEFAULT 0,
    net_salary numeric(15,2) DEFAULT 0,
    status text DEFAULT 'draft'::text,
    paid_date date,
    payment_method text,
    notes text,
    branch_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    salary_deduction numeric(15,2) DEFAULT 0,
    payment_account_id text,
    paid_by text
);


--
-- Name: COLUMN payroll_records.salary_deduction; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payroll_records.salary_deduction IS 'Potongan gaji untuk keterlambatan, absensi, atau potongan lainnya (terpisah dari potong panjar)';


--
-- Name: payroll_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.payroll_summary AS
 SELECT pr.id,
    pr.branch_id,
    pr.employee_id,
    NULL::uuid AS salary_config_id,
    (EXTRACT(year FROM pr.period_start))::integer AS period_year,
    (EXTRACT(month FROM pr.period_start))::integer AS period_month,
    pr.period_start,
    pr.period_end,
    to_char((pr.period_start)::timestamp with time zone, 'FMMonth YYYY'::text) AS period_display,
    pr.base_salary AS base_salary_amount,
    pr.total_commission AS commission_amount,
    pr.total_bonus AS bonus_amount,
    pr.total_deductions AS deduction_amount,
    pr.advance_deduction AS outstanding_advances,
    ((pr.base_salary + pr.total_commission) + pr.total_bonus) AS gross_salary,
    pr.net_salary,
    pr.status,
    pr.paid_date AS payment_date,
    pr.payment_account_id,
    NULL::text AS expense_account_id,
    NULL::uuid AS cash_history_id,
    pr.created_by,
    pr.created_at,
    pr.updated_at,
    pr.paid_by,
    pr.notes,
    p.full_name AS employee_name,
    p.role AS employee_role,
    pay_acc.name AS payment_account_name,
    payer.full_name AS paid_by_name
   FROM (((public.payroll_records pr
     LEFT JOIN public.profiles p ON ((pr.employee_id = p.id)))
     LEFT JOIN public.accounts pay_acc ON ((pr.payment_account_id = pay_acc.id)))
     LEFT JOIN public.profiles payer ON ((pr.paid_by = (payer.id)::text)));


--
-- Name: product_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(10,4) DEFAULT 0 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: product_stock_movements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_stock_movements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    branch_id uuid,
    type character varying(10) NOT NULL,
    reason character varying(50) NOT NULL,
    quantity numeric(15,2) NOT NULL,
    previous_stock numeric(15,2) DEFAULT 0,
    new_stock numeric(15,2) DEFAULT 0,
    reference_id text,
    reference_type text,
    notes text,
    user_id uuid,
    user_name text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT product_stock_movements_quantity_check CHECK ((quantity > (0)::numeric)),
    CONSTRAINT product_stock_movements_type_check CHECK (((type)::text = ANY ((ARRAY['IN'::character varying, 'OUT'::character varying])::text[])))
);


--
-- Name: production_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref character varying(50) NOT NULL,
    material_id uuid NOT NULL,
    quantity numeric(10,2) NOT NULL,
    note text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT production_errors_quantity_check CHECK ((quantity > (0)::numeric))
);


--
-- Name: TABLE production_errors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.production_errors IS 'Records of material errors/defects during production process';


--
-- Name: COLUMN production_errors.ref; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_errors.ref IS 'Unique reference code for the error record (e.g., ERR-250122-001)';


--
-- Name: COLUMN production_errors.material_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_errors.material_id IS 'Reference to the material that had errors';


--
-- Name: COLUMN production_errors.quantity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_errors.quantity IS 'Quantity of material that was defective/error';


--
-- Name: COLUMN production_errors.note; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_errors.note IS 'Description of the error or defect';


--
-- Name: COLUMN production_errors.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.production_errors.created_by IS 'User who recorded the error';


--
-- Name: production_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.production_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ref character varying(50) NOT NULL,
    product_id uuid,
    quantity numeric(10,2) DEFAULT 0 NOT NULL,
    note text,
    consume_bom boolean DEFAULT true NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    branch_id uuid,
    bom_snapshot jsonb,
    user_input_id uuid,
    user_input_name text,
    is_cancelled boolean DEFAULT false,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_by_name text,
    cancel_reason text,
    CONSTRAINT check_production_record_logic CHECK ((((product_id IS NULL) AND (quantity <= (0)::numeric)) OR ((product_id IS NOT NULL) AND (quantity >= (0)::numeric))))
);


--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id text DEFAULT gen_random_uuid() NOT NULL,
    purchase_order_id text,
    material_id uuid,
    product_id uuid,
    item_type text DEFAULT 'material'::text,
    quantity numeric(15,2) DEFAULT 0,
    unit_price numeric(15,2) DEFAULT 0,
    quantity_received numeric(15,2) DEFAULT 0,
    is_taxable boolean DEFAULT false,
    tax_percentage numeric(5,2) DEFAULT 0,
    tax_amount numeric(15,2) DEFAULT 0,
    subtotal numeric(15,2) DEFAULT 0,
    total_with_tax numeric(15,2) DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    material_name text,
    product_name text,
    unit text
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id text NOT NULL,
    material_id uuid,
    material_name text,
    quantity numeric,
    unit text,
    requested_by text,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    total_cost numeric,
    payment_account_id text,
    payment_date timestamp with time zone,
    unit_price numeric(10,2),
    supplier_name text,
    supplier_contact text,
    expected_delivery_date timestamp with time zone,
    supplier_id uuid,
    quoted_price numeric,
    expedition character varying(100),
    received_date timestamp with time zone,
    delivery_note_photo text,
    received_by text,
    received_quantity numeric,
    expedition_receiver text,
    branch_id uuid,
    po_number text,
    order_date date DEFAULT CURRENT_DATE,
    approved_at timestamp with time zone,
    approved_by text,
    include_ppn boolean DEFAULT false,
    ppn_amount numeric(15,2) DEFAULT 0,
    subtotal numeric(15,2) DEFAULT NULL::numeric,
    ppn_mode text DEFAULT 'exclude'::text
);


--
-- Name: COLUMN purchase_orders.subtotal; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.subtotal IS 'Subtotal sebelum PPN (DPP - Dasar Pengenaan Pajak)';


--
-- Name: COLUMN purchase_orders.ppn_mode; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.purchase_orders.ppn_mode IS 'Mode PPN: include = harga sudah termasuk PPN, exclude = PPN ditambahkan di atas subtotal';


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id text NOT NULL,
    customer_id uuid,
    customer_name text,
    prepared_by text,
    items jsonb,
    total numeric,
    status text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    transaction_id text,
    branch_id uuid,
    notes text,
    quotation_number text,
    customer_address text,
    customer_phone text,
    quotation_date timestamp with time zone DEFAULT now(),
    subtotal numeric DEFAULT 0,
    discount_amount numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    terms text,
    created_by uuid,
    created_by_name text,
    converted_to_invoice_id uuid,
    converted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.quotations FORCE ROW LEVEL SECURITY;


--
-- Name: receivables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.receivables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text,
    branch_id uuid,
    customer_id uuid,
    customer_name text,
    amount numeric DEFAULT 0,
    paid_amount numeric DEFAULT 0,
    status text DEFAULT 'pending'::text,
    due_date date,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: retasi; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retasi (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    retasi_number text NOT NULL,
    truck_number text,
    driver_name text,
    helper_name text,
    departure_date date NOT NULL,
    departure_time time without time zone,
    route text,
    total_items integer DEFAULT 0,
    total_weight numeric(10,2),
    notes text,
    retasi_ke integer DEFAULT 1 NOT NULL,
    is_returned boolean DEFAULT false,
    returned_items_count integer DEFAULT 0,
    error_items_count integer DEFAULT 0,
    return_notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    barang_laku integer DEFAULT 0,
    branch_id uuid,
    driver_id uuid,
    helper_id uuid,
    date date DEFAULT CURRENT_DATE,
    status text DEFAULT 'open'::text,
    barang_tidak_laku integer DEFAULT 0,
    helper_id_2 uuid,
    helper_name_2 text,
    helper_id_3 uuid,
    helper_name_3 text
);


--
-- Name: COLUMN retasi.barang_laku; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.retasi.barang_laku IS 'Jumlah barang yang laku terjual dari retasi';


--
-- Name: retasi_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retasi_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    retasi_id uuid,
    product_id uuid,
    product_name text,
    quantity integer DEFAULT 0,
    weight numeric(10,2) DEFAULT 0,
    returned_qty integer DEFAULT 0,
    error_qty integer DEFAULT 0,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    customer_name text,
    amount numeric(15,2) DEFAULT 0,
    collected_amount numeric(15,2) DEFAULT 0,
    status text DEFAULT 'pending'::text,
    sold_qty integer DEFAULT 0,
    unsold_qty integer DEFAULT 0
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id text NOT NULL,
    permissions jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    display_name text NOT NULL,
    description text,
    permissions jsonb DEFAULT '{}'::jsonb,
    is_system_role boolean DEFAULT false,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.roles IS 'Table untuk menyimpan role/jabatan yang bisa dikelola secara dinamis';


--
-- Name: COLUMN roles.name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.name IS 'Nama unik role (lowercase, untuk sistem)';


--
-- Name: COLUMN roles.display_name; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.display_name IS 'Nama tampilan role (untuk UI)';


--
-- Name: COLUMN roles.permissions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.permissions IS 'JSON object berisi permission untuk role ini';


--
-- Name: COLUMN roles.is_system_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.is_system_role IS 'Apakah ini system role yang tidak bisa dihapus';


--
-- Name: COLUMN roles.is_active; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.roles.is_active IS 'Status aktif role';


--
-- Name: sales_visit_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_visit_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    branch_id uuid,
    sales_id uuid,
    customer_id uuid,
    visit_date timestamp with time zone DEFAULT now(),
    latitude numeric,
    longitude numeric,
    notes text,
    photo_url text,
    payment_history_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid
);


--
-- Name: stock_pricings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stock_pricings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    min_stock integer NOT NULL,
    max_stock integer,
    price numeric(15,2) NOT NULL,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE stock_pricings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.stock_pricings IS 'Pricing rules based on product stock levels';


--
-- Name: COLUMN stock_pricings.min_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_pricings.min_stock IS 'Minimum stock level for this pricing rule';


--
-- Name: COLUMN stock_pricings.max_stock; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_pricings.max_stock IS 'Maximum stock level for this pricing rule (NULL means no upper limit)';


--
-- Name: COLUMN stock_pricings.price; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.stock_pricings.price IS 'Price to use when stock is within the range';


--
-- Name: supplier_materials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.supplier_materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    supplier_id uuid NOT NULL,
    material_id uuid NOT NULL,
    supplier_price numeric NOT NULL,
    unit character varying(20) NOT NULL,
    min_order_qty integer DEFAULT 1,
    lead_time_days integer DEFAULT 7,
    last_updated timestamp with time zone DEFAULT now(),
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT supplier_materials_supplier_price_check CHECK ((supplier_price > (0)::numeric))
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code character varying(20) NOT NULL,
    name character varying(100) NOT NULL,
    contact_person character varying(100),
    phone character varying(20),
    email character varying(100),
    address text,
    city character varying(50),
    postal_code character varying(10),
    payment_terms character varying(50) DEFAULT 'Cash'::character varying,
    tax_number character varying(50),
    bank_account character varying(100),
    bank_name character varying(50),
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    branch_id uuid
);


--
-- Name: transaction_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transaction_payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    transaction_id text NOT NULL,
    payment_date timestamp with time zone DEFAULT now() NOT NULL,
    amount numeric NOT NULL,
    payment_method text DEFAULT 'cash'::text,
    account_id text,
    account_name text NOT NULL,
    description text NOT NULL,
    notes text,
    reference_number text,
    paid_by_user_id uuid,
    paid_by_user_name text NOT NULL,
    paid_by_user_role text,
    created_at timestamp with time zone DEFAULT now(),
    created_by uuid,
    status text DEFAULT 'active'::text,
    cancelled_at timestamp with time zone,
    cancelled_by uuid,
    cancelled_reason text,
    branch_id uuid,
    CONSTRAINT transaction_payments_amount_check CHECK ((amount > (0)::numeric)),
    CONSTRAINT transaction_payments_payment_method_check CHECK ((payment_method = ANY (ARRAY['cash'::text, 'bank_transfer'::text, 'check'::text, 'digital_wallet'::text]))),
    CONSTRAINT transaction_payments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'cancelled'::text, 'deleted'::text])))
);


--
-- Name: transactions_with_customer; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.transactions_with_customer AS
 SELECT t.id,
    t.customer_id,
    t.customer_name,
    t.cashier_id,
    t.cashier_name,
    t.designer_id,
    t.operator_id,
    t.payment_account_id,
    t.order_date,
    t.finish_date,
    t.items,
    t.total,
    t.paid_amount,
    t.payment_status,
    t.status,
    t.created_at,
    t.subtotal,
    t.ppn_enabled,
    t.ppn_percentage,
    t.ppn_amount,
    t.is_office_sale,
    t.due_date,
    t.ppn_mode,
    c.name AS customer_display_name,
    c.phone AS customer_phone,
    c.address AS customer_address,
    p.full_name AS cashier_display_name
   FROM ((public.transactions t
     LEFT JOIN public.customers c ON ((t.customer_id = c.id)))
     LEFT JOIN public.profiles p ON ((t.cashier_id = p.id)));


--
-- Name: trial_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.trial_balance AS
 SELECT a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.type AS account_type,
    a.initial_balance,
    COALESCE(sum(jel.debit_amount), (0)::numeric) AS total_debit,
    COALESCE(sum(jel.credit_amount), (0)::numeric) AS total_credit,
    (a.initial_balance +
        CASE
            WHEN (a.type = ANY (ARRAY['Aset'::text, 'Beban'::text])) THEN (COALESCE(sum(jel.debit_amount), (0)::numeric) - COALESCE(sum(jel.credit_amount), (0)::numeric))
            ELSE (COALESCE(sum(jel.credit_amount), (0)::numeric) - COALESCE(sum(jel.debit_amount), (0)::numeric))
        END) AS ending_balance
   FROM ((public.accounts a
     LEFT JOIN public.journal_entry_lines jel ON ((a.id = jel.account_id)))
     LEFT JOIN public.journal_entries je ON (((jel.journal_entry_id = je.id) AND (je.status = 'posted'::text) AND (je.is_voided = false))))
  WHERE ((a.is_active = true) AND (a.is_header = false))
  GROUP BY a.id, a.code, a.name, a.type, a.initial_balance
  ORDER BY a.code;


--
-- Name: VIEW trial_balance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.trial_balance IS 'Neraca Saldo - Ringkasan saldo semua akun';


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    role_id uuid,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid
);


--
-- Name: v_account_balances; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_account_balances AS
 WITH journal_movements AS (
         SELECT jel.account_id,
            COALESCE(sum(jel.debit_amount), (0)::numeric) AS total_debit,
            COALESCE(sum(jel.credit_amount), (0)::numeric) AS total_credit
           FROM (public.journal_entry_lines jel
             JOIN public.journal_entries je ON ((je.id = jel.journal_entry_id)))
          WHERE ((je.status = 'posted'::text) AND (je.is_voided = false))
          GROUP BY jel.account_id
        )
 SELECT a.id AS account_id,
    a.code AS account_code,
    a.name AS account_name,
    a.type AS account_type,
    a.parent_id,
    a.level,
    a.is_header,
    a.branch_id,
    a.initial_balance AS initial_balance_deprecated,
    a.balance AS stored_balance,
    COALESCE(jm.total_debit, (0)::numeric) AS total_debit,
    COALESCE(jm.total_credit, (0)::numeric) AS total_credit,
        CASE
            WHEN (a.type = ANY (ARRAY['Aset'::text, 'Beban'::text])) THEN (COALESCE(jm.total_debit, (0)::numeric) - COALESCE(jm.total_credit, (0)::numeric))
            ELSE (COALESCE(jm.total_credit, (0)::numeric) - COALESCE(jm.total_debit, (0)::numeric))
        END AS calculated_balance,
        CASE
            WHEN (a.type = ANY (ARRAY['Aset'::text, 'Beban'::text])) THEN ((COALESCE(jm.total_debit, (0)::numeric) - COALESCE(jm.total_credit, (0)::numeric)) - a.balance)
            ELSE ((COALESCE(jm.total_credit, (0)::numeric) - COALESCE(jm.total_debit, (0)::numeric)) - a.balance)
        END AS balance_difference
   FROM (public.accounts a
     LEFT JOIN journal_movements jm ON ((jm.account_id = a.id)))
  WHERE (a.is_active = true);


--
-- Name: v_account_balance_mismatches; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_account_balance_mismatches AS
 SELECT v_account_balances.account_id,
    v_account_balances.account_code,
    v_account_balances.account_name,
    v_account_balances.account_type,
    v_account_balances.branch_id,
    v_account_balances.initial_balance_deprecated,
    v_account_balances.stored_balance,
    v_account_balances.calculated_balance,
    v_account_balances.balance_difference
   FROM public.v_account_balances
  WHERE (abs(v_account_balances.balance_difference) > 0.01);


--
-- Name: v_audit_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_audit_summary AS
 SELECT al.created_at AS waktu,
    al.table_name AS tabel,
    al.operation AS operasi,
    al.record_id,
    COALESCE(al.user_email, 'system'::text) AS user_email,
    al.user_role,
        CASE
            WHEN (al.operation = 'INSERT'::text) THEN 'Record baru dibuat'::text
            WHEN (al.operation = 'DELETE'::text) THEN 'Record dihapus'::text
            WHEN (al.operation = 'UPDATE'::text) THEN ( SELECT string_agg(((((jsonb_each.key || ': '::text) || COALESCE((jsonb_each.value ->> 'old'::text), 'null'::text)) || ' → '::text) || COALESCE((jsonb_each.value ->> 'new'::text), 'null'::text)), ', '::text) AS string_agg
               FROM jsonb_each(al.changed_fields) jsonb_each(key, value))
            ELSE 'Unknown'::text
        END AS perubahan
   FROM public.audit_logs al
  ORDER BY al.created_at DESC;


--
-- Name: v_inventory_batches_detail; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_inventory_batches_detail AS
 SELECT ib.id,
    ib.product_id,
    ib.material_id,
    ib.branch_id,
    ib.purchase_order_id,
    ib.production_id,
    ib.initial_quantity,
    ib.remaining_quantity,
    ib.unit_cost,
    ib.batch_date,
    ib.notes,
    ib.created_at,
    p.name AS product_name,
    m.name AS material_name,
        CASE
            WHEN (ib.product_id IS NOT NULL) THEN 'product'::text
            WHEN (ib.material_id IS NOT NULL) THEN 'material'::text
            ELSE 'unknown'::text
        END AS batch_type,
    COALESCE(p.name, m.name, 'Unknown'::text) AS item_name,
    (ib.remaining_quantity * COALESCE(ib.unit_cost, (0)::numeric)) AS total_value,
        CASE
            WHEN (ib.remaining_quantity = (0)::numeric) THEN 'depleted'::text
            WHEN (ib.remaining_quantity < ib.initial_quantity) THEN 'partial'::text
            ELSE 'full'::text
        END AS batch_status
   FROM ((public.inventory_batches ib
     LEFT JOIN public.products p ON ((p.id = ib.product_id)))
     LEFT JOIN public.materials m ON ((m.id = ib.material_id)));


--
-- Name: v_material_current_stock; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_material_current_stock AS
 SELECT m.id AS material_id,
    m.name AS material_name,
    m.unit,
    m.branch_id,
    m.stock AS stored_stock,
    COALESCE(sum(ib.remaining_quantity), (0)::numeric) AS calculated_stock,
    COALESCE(sum(ib.remaining_quantity), (0)::numeric) AS current_stock,
    (COALESCE(sum(ib.remaining_quantity), (0)::numeric) - m.stock) AS difference
   FROM (public.materials m
     LEFT JOIN public.inventory_batches ib ON (((ib.material_id = m.id) AND (ib.remaining_quantity > (0)::numeric))))
  GROUP BY m.id, m.name, m.unit, m.branch_id, m.stock;


--
-- Name: v_product_current_stock; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_product_current_stock AS
 SELECT p.id AS product_id,
    p.name AS product_name,
    p.branch_id,
    p.current_stock AS stored_stock,
    COALESCE(sum(ib.remaining_quantity), (0)::numeric) AS calculated_stock,
    COALESCE(sum(ib.remaining_quantity), (0)::numeric) AS current_stock,
    (COALESCE(sum(ib.remaining_quantity), (0)::numeric) - p.current_stock) AS difference
   FROM (public.products p
     LEFT JOIN public.inventory_batches ib ON (((ib.product_id = p.id) AND ((ib.remaining_quantity > (0)::numeric) OR (ib.remaining_quantity < (0)::numeric)))))
  GROUP BY p.id, p.name, p.branch_id, p.current_stock;


--
-- Name: v_stock_mismatches; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_stock_mismatches AS
 SELECT v_product_current_stock.product_id,
    v_product_current_stock.product_name,
    v_product_current_stock.branch_id,
    v_product_current_stock.stored_stock,
    v_product_current_stock.calculated_stock,
    v_product_current_stock.difference
   FROM public.v_product_current_stock
  WHERE (v_product_current_stock.difference <> (0)::numeric);


--
-- Name: v_trial_balance; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_trial_balance AS
 SELECT v_account_balances.account_code,
    v_account_balances.account_name,
    v_account_balances.account_type,
    v_account_balances.branch_id,
        CASE
            WHEN (v_account_balances.account_type = ANY (ARRAY['Aset'::text, 'Beban'::text])) THEN v_account_balances.calculated_balance
            ELSE (0)::numeric
        END AS debit_balance,
        CASE
            WHEN (v_account_balances.account_type <> ALL (ARRAY['Aset'::text, 'Beban'::text])) THEN v_account_balances.calculated_balance
            ELSE (0)::numeric
        END AS credit_balance
   FROM public.v_account_balances
  WHERE ((v_account_balances.is_header = false) AND (v_account_balances.calculated_balance <> (0)::numeric))
  ORDER BY v_account_balances.account_code;


--
-- Name: zakat_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.zakat_records (
    id text NOT NULL,
    type text NOT NULL,
    category text DEFAULT 'zakat'::text NOT NULL,
    title text NOT NULL,
    description text,
    recipient text,
    recipient_type text,
    amount numeric(15,2) DEFAULT 0 NOT NULL,
    nishab_amount numeric(15,2),
    percentage_rate numeric(5,2) DEFAULT 2.5,
    payment_date date DEFAULT CURRENT_DATE NOT NULL,
    payment_account_id uuid,
    payment_method text,
    status text DEFAULT 'pending'::text,
    cash_history_id uuid,
    receipt_number text,
    calculation_basis text,
    calculation_notes text,
    is_anonymous boolean DEFAULT false,
    notes text,
    attachment_url text,
    hijri_year text,
    hijri_month text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: accounts_payable accounts_payable_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: active_sessions active_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_pkey PRIMARY KEY (id);


--
-- Name: active_sessions active_sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_session_token_key UNIQUE (session_token);


--
-- Name: advance_repayments advance_repayments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_repayments
    ADD CONSTRAINT advance_repayments_pkey PRIMARY KEY (id);


--
-- Name: asset_maintenance asset_maintenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_pkey PRIMARY KEY (id);


--
-- Name: assets assets_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_code_key UNIQUE (code);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: balance_adjustments balance_adjustments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_pkey PRIMARY KEY (id);


--
-- Name: bonus_pricings bonus_pricings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_pricings
    ADD CONSTRAINT bonus_pricings_pkey PRIMARY KEY (id);


--
-- Name: branches branches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_pkey PRIMARY KEY (id);


--
-- Name: cash_history cash_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_history
    ADD CONSTRAINT cash_history_pkey PRIMARY KEY (id);


--
-- Name: closing_periods closing_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closing_periods
    ADD CONSTRAINT closing_periods_pkey PRIMARY KEY (id);


--
-- Name: closing_periods closing_periods_year_branch_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closing_periods
    ADD CONSTRAINT closing_periods_year_branch_id_key UNIQUE (year, branch_id);


--
-- Name: commission_entries commission_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_entries
    ADD CONSTRAINT commission_entries_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_pkey PRIMARY KEY (id);


--
-- Name: commission_rules commission_rules_product_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_rules
    ADD CONSTRAINT commission_rules_product_id_role_key UNIQUE (product_id, role);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: company_settings company_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_settings
    ADD CONSTRAINT company_settings_pkey PRIMARY KEY (key);


--
-- Name: customer_pricings customer_pricings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_pricings
    ADD CONSTRAINT customer_pricings_pkey PRIMARY KEY (id);


--
-- Name: customer_visits customer_visits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_visits
    ADD CONSTRAINT customer_visits_pkey PRIMARY KEY (id);


--
-- Name: customers customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_pkey PRIMARY KEY (id);


--
-- Name: debt_installments debt_installments_debt_id_installment_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_installments
    ADD CONSTRAINT debt_installments_debt_id_installment_number_key UNIQUE (debt_id, installment_number);


--
-- Name: debt_installments debt_installments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_installments
    ADD CONSTRAINT debt_installments_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);


--
-- Name: deliveries deliveries_transaction_delivery_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_transaction_delivery_number_key UNIQUE (transaction_id, delivery_number);


--
-- Name: delivery_items delivery_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_items
    ADD CONSTRAINT delivery_items_pkey PRIMARY KEY (id);


--
-- Name: delivery_photos delivery_photos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_photos
    ADD CONSTRAINT delivery_photos_pkey PRIMARY KEY (id);


--
-- Name: delivery_reports delivery_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_reports
    ADD CONSTRAINT delivery_reports_pkey PRIMARY KEY (id);


--
-- Name: employee_advances employee_advances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_pkey PRIMARY KEY (id);


--
-- Name: employee_salaries employee_salaries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salaries
    ADD CONSTRAINT employee_salaries_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: inventory_batch_consumptions inventory_batch_consumptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch_consumptions
    ADD CONSTRAINT inventory_batch_consumptions_pkey PRIMARY KEY (id);


--
-- Name: inventory_batches inventory_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_pkey PRIMARY KEY (id);


--
-- Name: journal_entries journal_entries_entry_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_entry_number_key UNIQUE (entry_number);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: journal_entry_lines journal_entry_lines_unique_line; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_unique_line UNIQUE (journal_entry_id, line_number);


--
-- Name: manual_journal_entries manual_journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_journal_entries
    ADD CONSTRAINT manual_journal_entries_pkey PRIMARY KEY (id);


--
-- Name: manual_journal_entry_lines manual_journal_entry_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_journal_entry_lines
    ADD CONSTRAINT manual_journal_entry_lines_pkey PRIMARY KEY (id);


--
-- Name: material_stock_movements material_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT material_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: materials materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);


--
-- Name: nishab_reference nishab_reference_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nishab_reference
    ADD CONSTRAINT nishab_reference_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: payment_history payment_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_pkey PRIMARY KEY (id);


--
-- Name: payroll_records payroll_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT payroll_records_pkey PRIMARY KEY (id);


--
-- Name: product_materials product_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_materials
    ADD CONSTRAINT product_materials_pkey PRIMARY KEY (id);


--
-- Name: product_materials product_materials_product_id_material_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_materials
    ADD CONSTRAINT product_materials_product_id_material_id_key UNIQUE (product_id, material_id);


--
-- Name: product_stock_movements product_stock_movements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_pkey PRIMARY KEY (id);


--
-- Name: production_errors production_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_errors
    ADD CONSTRAINT production_errors_pkey PRIMARY KEY (id);


--
-- Name: production_errors production_errors_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_errors
    ADD CONSTRAINT production_errors_ref_key UNIQUE (ref);


--
-- Name: production_records production_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_pkey PRIMARY KEY (id);


--
-- Name: production_records production_records_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_ref_key UNIQUE (ref);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: receivables receivables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receivables
    ADD CONSTRAINT receivables_pkey PRIMARY KEY (id);


--
-- Name: retasi_items retasi_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi_items
    ADD CONSTRAINT retasi_items_pkey PRIMARY KEY (id);


--
-- Name: retasi retasi_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_pkey PRIMARY KEY (id);


--
-- Name: retasi retasi_retasi_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_retasi_number_key UNIQUE (retasi_number);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);


--
-- Name: roles roles_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_name_key UNIQUE (name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sales_visit_reports sales_visit_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_pkey PRIMARY KEY (id);


--
-- Name: stock_pricings stock_pricings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_pricings
    ADD CONSTRAINT stock_pricings_pkey PRIMARY KEY (id);


--
-- Name: supplier_materials supplier_materials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_materials
    ADD CONSTRAINT supplier_materials_pkey PRIMARY KEY (id);


--
-- Name: supplier_materials supplier_materials_supplier_id_material_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_materials
    ADD CONSTRAINT supplier_materials_supplier_id_material_id_key UNIQUE (supplier_id, material_id);


--
-- Name: suppliers suppliers_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_code_key UNIQUE (code);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: transaction_payments transaction_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_pkey PRIMARY KEY (id);


--
-- Name: transactions transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_pkey PRIMARY KEY (id);


--
-- Name: active_sessions unique_user_session; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT unique_user_session UNIQUE (user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_key UNIQUE (user_id, role_id);


--
-- Name: zakat_records zakat_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.zakat_records
    ADD CONSTRAINT zakat_records_pkey PRIMARY KEY (id);


--
-- Name: accounts_code_branch_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX accounts_code_branch_unique ON public.accounts USING btree (code, branch_id);


--
-- Name: idx_accounts_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_code ON public.accounts USING btree (code);


--
-- Name: idx_accounts_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_employee_id ON public.accounts USING btree (employee_id);


--
-- Name: idx_accounts_is_payment_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_is_payment_account ON public.accounts USING btree (is_payment_account);


--
-- Name: idx_accounts_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_level ON public.accounts USING btree (level);


--
-- Name: idx_accounts_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_parent ON public.accounts USING btree (parent_id);


--
-- Name: idx_accounts_payable_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_payable_created_at ON public.accounts_payable USING btree (created_at);


--
-- Name: idx_accounts_payable_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_payable_po_id ON public.accounts_payable USING btree (purchase_order_id);


--
-- Name: idx_accounts_payable_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_payable_status ON public.accounts_payable USING btree (status);


--
-- Name: idx_accounts_sort_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_sort_order ON public.accounts USING btree (sort_order);


--
-- Name: idx_accounts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_accounts_type ON public.accounts USING btree (type);


--
-- Name: idx_active_sessions_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_sessions_token ON public.active_sessions USING btree (session_token);


--
-- Name: idx_active_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_active_sessions_user_id ON public.active_sessions USING btree (user_id);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at);


--
-- Name: idx_audit_logs_operation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_operation ON public.audit_logs USING btree (operation);


--
-- Name: idx_audit_logs_record_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_record_id ON public.audit_logs USING btree (record_id);


--
-- Name: idx_audit_logs_table_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_table_name ON public.audit_logs USING btree (table_name);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_balance_adjustments_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_balance_adjustments_account_id ON public.balance_adjustments USING btree (account_id);


--
-- Name: idx_balance_adjustments_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_balance_adjustments_created_at ON public.balance_adjustments USING btree (created_at);


--
-- Name: idx_balance_adjustments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_balance_adjustments_status ON public.balance_adjustments USING btree (status);


--
-- Name: idx_batch_consumptions_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_batch_consumptions_transaction ON public.inventory_batch_consumptions USING btree (transaction_id);


--
-- Name: idx_bonus_pricings_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bonus_pricings_active ON public.bonus_pricings USING btree (is_active);


--
-- Name: idx_bonus_pricings_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bonus_pricings_product_id ON public.bonus_pricings USING btree (product_id);


--
-- Name: idx_bonus_pricings_qty_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bonus_pricings_qty_range ON public.bonus_pricings USING btree (min_quantity, max_quantity);


--
-- Name: idx_cash_history_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_history_account_id ON public.cash_history USING btree (account_id);


--
-- Name: idx_cash_history_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_history_created_at ON public.cash_history USING btree (created_at);


--
-- Name: idx_cash_history_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_history_type ON public.cash_history USING btree (transaction_type);


--
-- Name: idx_closing_periods_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closing_periods_branch ON public.closing_periods USING btree (branch_id);


--
-- Name: idx_closing_periods_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_closing_periods_year ON public.closing_periods USING btree (year);


--
-- Name: idx_commission_entries_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_entries_date ON public.commission_entries USING btree (created_at);


--
-- Name: idx_commission_entries_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_entries_delivery ON public.commission_entries USING btree (delivery_id);


--
-- Name: idx_commission_entries_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_entries_role ON public.commission_entries USING btree (role);


--
-- Name: idx_commission_entries_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_entries_transaction ON public.commission_entries USING btree (transaction_id);


--
-- Name: idx_commission_entries_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_entries_user ON public.commission_entries USING btree (user_id);


--
-- Name: idx_commission_rules_product_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_commission_rules_product_role ON public.commission_rules USING btree (product_id, role);


--
-- Name: idx_commission_unique_delivery; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_commission_unique_delivery ON public.commission_entries USING btree (user_id, role, product_id, delivery_id) WHERE (delivery_id IS NOT NULL);


--
-- Name: idx_commission_unique_transaction; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_commission_unique_transaction ON public.commission_entries USING btree (user_id, role, product_id, transaction_id) WHERE ((delivery_id IS NULL) AND (transaction_id IS NOT NULL));


--
-- Name: idx_customer_visits_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_visits_branch_id ON public.customer_visits USING btree (branch_id);


--
-- Name: idx_customer_visits_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_visits_customer_id ON public.customer_visits USING btree (customer_id);


--
-- Name: idx_customer_visits_visited_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_visits_visited_at ON public.customer_visits USING btree (visited_at);


--
-- Name: idx_customer_visits_visited_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_visits_visited_by ON public.customer_visits USING btree (visited_by);


--
-- Name: idx_customers_classification; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_classification ON public.customers USING btree (classification);


--
-- Name: idx_customers_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_created_at ON public.customers USING btree ("createdAt");


--
-- Name: idx_customers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customers_name ON public.customers USING btree (name);


--
-- Name: idx_daily_stats_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_daily_stats_date ON public.daily_stats USING btree (date);


--
-- Name: idx_debt_installments_debt_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_installments_debt_id ON public.debt_installments USING btree (debt_id);


--
-- Name: idx_debt_installments_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_installments_due_date ON public.debt_installments USING btree (due_date);


--
-- Name: idx_debt_installments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_debt_installments_status ON public.debt_installments USING btree (status);


--
-- Name: idx_deliveries_delivery_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_delivery_date ON public.deliveries USING btree (delivery_date);


--
-- Name: idx_deliveries_not_cancelled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_not_cancelled ON public.deliveries USING btree (id) WHERE ((is_cancelled = false) OR (is_cancelled IS NULL));


--
-- Name: idx_deliveries_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deliveries_transaction_id ON public.deliveries USING btree (transaction_id);


--
-- Name: idx_delivery_items_delivery_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_items_delivery_id ON public.delivery_items USING btree (delivery_id);


--
-- Name: idx_delivery_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delivery_items_product_id ON public.delivery_items USING btree (product_id);


--
-- Name: idx_employee_salaries_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_salaries_active ON public.employee_salaries USING btree (employee_id, is_active) WHERE (is_active = true);


--
-- Name: idx_employee_salaries_effective_period; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_salaries_effective_period ON public.employee_salaries USING btree (effective_from, effective_until);


--
-- Name: idx_employee_salaries_employee_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_employee_salaries_employee_id ON public.employee_salaries USING btree (employee_id);


--
-- Name: idx_expenses_not_cancelled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_not_cancelled ON public.expenses USING btree (id) WHERE ((is_cancelled = false) OR (is_cancelled IS NULL));


--
-- Name: idx_inventory_batches_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_branch ON public.inventory_batches USING btree (branch_id);


--
-- Name: idx_inventory_batches_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_fifo ON public.inventory_batches USING btree (product_id, branch_id, batch_date) WHERE (remaining_quantity > (0)::numeric);


--
-- Name: idx_inventory_batches_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_material ON public.inventory_batches USING btree (material_id);


--
-- Name: idx_inventory_batches_material_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_material_fifo ON public.inventory_batches USING btree (material_id, branch_id, batch_date) WHERE (remaining_quantity > (0)::numeric);


--
-- Name: idx_inventory_batches_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_material_id ON public.inventory_batches USING btree (material_id) WHERE (material_id IS NOT NULL);


--
-- Name: idx_inventory_batches_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_product ON public.inventory_batches USING btree (product_id);


--
-- Name: idx_inventory_batches_product_fifo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_product_fifo ON public.inventory_batches USING btree (product_id, branch_id, batch_date);


--
-- Name: idx_inventory_batches_production_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_batches_production_id ON public.inventory_batches USING btree (production_id);


--
-- Name: idx_journal_entries_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_branch_date ON public.journal_entries USING btree (branch_id, entry_date);


--
-- Name: idx_journal_entries_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_branch_id ON public.journal_entries USING btree (branch_id);


--
-- Name: idx_journal_entries_entry_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_entry_date ON public.journal_entries USING btree (entry_date);


--
-- Name: idx_journal_entries_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_reference ON public.journal_entries USING btree (reference_type, reference_id);


--
-- Name: idx_journal_entries_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entries_status ON public.journal_entries USING btree (status);


--
-- Name: idx_journal_entry_lines_account_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_lines_account_id ON public.journal_entry_lines USING btree (account_id);


--
-- Name: idx_journal_entry_lines_journal_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_journal_entry_lines_journal_id ON public.journal_entry_lines USING btree (journal_entry_id);


--
-- Name: idx_material_stock_movements_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_created_at ON public.material_stock_movements USING btree (created_at DESC);


--
-- Name: idx_material_stock_movements_material; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_material ON public.material_stock_movements USING btree (material_id);


--
-- Name: idx_material_stock_movements_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_reference ON public.material_stock_movements USING btree (reference_id, reference_type);


--
-- Name: idx_material_stock_movements_type_reason; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_type_reason ON public.material_stock_movements USING btree (type, reason);


--
-- Name: idx_material_stock_movements_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_material_stock_movements_user ON public.material_stock_movements USING btree (user_id);


--
-- Name: idx_materials_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_name ON public.materials USING btree (name);


--
-- Name: idx_materials_stock; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_materials_stock ON public.materials USING btree (stock);


--
-- Name: idx_payment_history_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_branch_id ON public.payment_history USING btree (branch_id);


--
-- Name: idx_payment_history_payment_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_payment_date ON public.payment_history USING btree (payment_date);


--
-- Name: idx_payment_history_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payment_history_transaction_id ON public.payment_history USING btree (transaction_id);


--
-- Name: idx_product_materials_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_materials_material_id ON public.product_materials USING btree (material_id);


--
-- Name: idx_product_materials_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_materials_product_id ON public.product_materials USING btree (product_id);


--
-- Name: idx_product_stock_movements_branch; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_branch ON public.product_stock_movements USING btree (branch_id);


--
-- Name: idx_product_stock_movements_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_created ON public.product_stock_movements USING btree (created_at);


--
-- Name: idx_product_stock_movements_product; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_product ON public.product_stock_movements USING btree (product_id);


--
-- Name: idx_product_stock_movements_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_stock_movements_type ON public.product_stock_movements USING btree (type);


--
-- Name: idx_production_errors_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_errors_created_at ON public.production_errors USING btree (created_at);


--
-- Name: idx_production_errors_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_errors_created_by ON public.production_errors USING btree (created_by);


--
-- Name: idx_production_errors_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_errors_material_id ON public.production_errors USING btree (material_id);


--
-- Name: idx_production_errors_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_errors_ref ON public.production_errors USING btree (ref);


--
-- Name: idx_production_not_cancelled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_not_cancelled ON public.production_records USING btree (id) WHERE ((is_cancelled = false) OR (is_cancelled IS NULL));


--
-- Name: idx_production_records_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_records_created_at ON public.production_records USING btree (created_at);


--
-- Name: idx_production_records_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_records_created_by ON public.production_records USING btree (created_by);


--
-- Name: idx_production_records_error_entries; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_records_error_entries ON public.production_records USING btree (created_at) WHERE (product_id IS NULL);


--
-- Name: idx_production_records_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_records_product_id ON public.production_records USING btree (product_id);


--
-- Name: idx_production_records_product_id_nullable; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_production_records_product_id_nullable ON public.production_records USING btree (product_id) WHERE (product_id IS NOT NULL);


--
-- Name: idx_products_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name ON public.products USING btree (name);


--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);


--
-- Name: idx_profiles_pin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_pin ON public.profiles USING btree (id) WHERE (pin IS NOT NULL);


--
-- Name: idx_profiles_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_role ON public.profiles USING btree (role);


--
-- Name: idx_purchase_orders_expected_delivery_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_expected_delivery_date ON public.purchase_orders USING btree (expected_delivery_date);


--
-- Name: idx_purchase_orders_expedition; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_expedition ON public.purchase_orders USING btree (expedition);


--
-- Name: idx_purchase_orders_supplier_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_purchase_orders_supplier_name ON public.purchase_orders USING btree (supplier_name);


--
-- Name: idx_quotations_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_branch_id ON public.quotations USING btree (branch_id);


--
-- Name: idx_quotations_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_customer_id ON public.quotations USING btree (customer_id);


--
-- Name: idx_quotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_status ON public.quotations USING btree (status);


--
-- Name: idx_retasi_departure_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_departure_date ON public.retasi USING btree (departure_date);


--
-- Name: idx_retasi_driver_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_driver_date ON public.retasi USING btree (driver_name, departure_date);


--
-- Name: idx_retasi_returned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_retasi_returned ON public.retasi USING btree (is_returned);


--
-- Name: idx_roles_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_active ON public.roles USING btree (is_active);


--
-- Name: idx_roles_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roles_name ON public.roles USING btree (name);


--
-- Name: idx_sales_visit_reports_branch_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_visit_reports_branch_id ON public.sales_visit_reports USING btree (branch_id);


--
-- Name: idx_sales_visit_reports_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_visit_reports_created_at ON public.sales_visit_reports USING btree (created_at);


--
-- Name: idx_sales_visit_reports_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_visit_reports_customer_id ON public.sales_visit_reports USING btree (customer_id);


--
-- Name: idx_sales_visit_reports_sales_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_visit_reports_sales_id ON public.sales_visit_reports USING btree (sales_id);


--
-- Name: idx_stock_pricings_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_pricings_active ON public.stock_pricings USING btree (is_active);


--
-- Name: idx_stock_pricings_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_pricings_product_id ON public.stock_pricings USING btree (product_id);


--
-- Name: idx_stock_pricings_stock_range; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_stock_pricings_stock_range ON public.stock_pricings USING btree (min_stock, max_stock);


--
-- Name: idx_supplier_materials_material_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_materials_material_id ON public.supplier_materials USING btree (material_id);


--
-- Name: idx_supplier_materials_supplier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_supplier_materials_supplier_id ON public.supplier_materials USING btree (supplier_id);


--
-- Name: idx_suppliers_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_code ON public.suppliers USING btree (code);


--
-- Name: idx_suppliers_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_is_active ON public.suppliers USING btree (is_active);


--
-- Name: idx_suppliers_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_name ON public.suppliers USING btree (name);


--
-- Name: idx_transaction_payments_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_payments_date ON public.transaction_payments USING btree (payment_date);


--
-- Name: idx_transaction_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_payments_status ON public.transaction_payments USING btree (status);


--
-- Name: idx_transaction_payments_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transaction_payments_transaction_id ON public.transaction_payments USING btree (transaction_id);


--
-- Name: idx_transactions_branch_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_branch_date ON public.transactions USING btree (branch_id, order_date);


--
-- Name: idx_transactions_cashier_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_cashier_id ON public.transactions USING btree (cashier_id);


--
-- Name: idx_transactions_customer_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_customer_id ON public.transactions USING btree (customer_id);


--
-- Name: idx_transactions_delivery_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_delivery_status ON public.transactions USING btree (status, is_office_sale) WHERE (status = ANY (ARRAY['Siap Antar'::text, 'Diantar Sebagian'::text]));


--
-- Name: idx_transactions_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_due_date ON public.transactions USING btree (due_date);


--
-- Name: idx_transactions_is_office_sale; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_is_office_sale ON public.transactions USING btree (is_office_sale);


--
-- Name: idx_transactions_not_cancelled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_not_cancelled ON public.transactions USING btree (id) WHERE ((is_cancelled = false) OR (is_cancelled IS NULL));


--
-- Name: idx_transactions_not_voided; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_not_voided ON public.transactions USING btree (id) WHERE (is_voided IS NOT TRUE);


--
-- Name: idx_transactions_order_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_order_date ON public.transactions USING btree (order_date);


--
-- Name: idx_transactions_payment_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_payment_status ON public.transactions USING btree (payment_status);


--
-- Name: idx_transactions_ppn_enabled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_ppn_enabled ON public.transactions USING btree (ppn_enabled);


--
-- Name: idx_transactions_retasi_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_retasi_id ON public.transactions USING btree (retasi_id);


--
-- Name: idx_transactions_retasi_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_retasi_number ON public.transactions USING btree (retasi_number);


--
-- Name: idx_transactions_sales_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_sales_id ON public.transactions USING btree (sales_id);


--
-- Name: idx_transactions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactions_status ON public.transactions USING btree (status);


--
-- Name: role_permissions_role_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX role_permissions_role_id_idx ON public.role_permissions USING btree (role_id);


--
-- Name: journal_entries trg_balance_journal_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_balance_journal_change AFTER UPDATE OF is_voided ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public.tf_update_balance_on_journal_change();


--
-- Name: journal_entry_lines trg_balance_line_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_balance_line_change AFTER INSERT OR DELETE OR UPDATE ON public.journal_entry_lines FOR EACH ROW EXECUTE FUNCTION public.tf_update_balance_on_line_change();


--
-- Name: accounts accounts_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: accounts accounts_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: accounts accounts_parent_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts
    ADD CONSTRAINT accounts_parent_fk FOREIGN KEY (parent_id) REFERENCES public.accounts(id) ON DELETE RESTRICT;


--
-- Name: accounts_payable accounts_payable_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: accounts_payable accounts_payable_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.accounts_payable
    ADD CONSTRAINT accounts_payable_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: active_sessions active_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.active_sessions
    ADD CONSTRAINT active_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: advance_repayments advance_repayments_advance_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.advance_repayments
    ADD CONSTRAINT advance_repayments_advance_id_fkey FOREIGN KEY (advance_id) REFERENCES public.employee_advances(id) ON DELETE CASCADE;


--
-- Name: asset_maintenance asset_maintenance_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id);


--
-- Name: asset_maintenance asset_maintenance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: asset_maintenance asset_maintenance_completed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES public.profiles(id);


--
-- Name: asset_maintenance asset_maintenance_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: asset_maintenance asset_maintenance_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id);


--
-- Name: asset_maintenance asset_maintenance_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.asset_maintenance
    ADD CONSTRAINT asset_maintenance_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: assets assets_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: assets assets_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: assets assets_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: attendance attendance_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: attendance attendance_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id);


--
-- Name: attendance attendance_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.attendance
    ADD CONSTRAINT attendance_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: balance_adjustments balance_adjustments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: balance_adjustments balance_adjustments_adjusted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_adjusted_by_fkey FOREIGN KEY (adjusted_by) REFERENCES public.profiles(id);


--
-- Name: balance_adjustments balance_adjustments_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.balance_adjustments
    ADD CONSTRAINT balance_adjustments_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: bonus_pricings bonus_pricings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.bonus_pricings
    ADD CONSTRAINT bonus_pricings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: branches branches_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id);


--
-- Name: branches branches_manager_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branches
    ADD CONSTRAINT branches_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES public.profiles(id);


--
-- Name: cash_history cash_history_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_history
    ADD CONSTRAINT cash_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: cash_history cash_history_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_history
    ADD CONSTRAINT cash_history_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: cash_history cash_history_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_history
    ADD CONSTRAINT cash_history_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: closing_periods closing_periods_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closing_periods
    ADD CONSTRAINT closing_periods_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: closing_periods closing_periods_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.closing_periods
    ADD CONSTRAINT closing_periods_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id);


--
-- Name: commission_entries commission_entries_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.commission_entries
    ADD CONSTRAINT commission_entries_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customer_pricings customer_pricings_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_pricings
    ADD CONSTRAINT customer_pricings_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customer_pricings customer_pricings_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_pricings
    ADD CONSTRAINT customer_pricings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: customer_pricings customer_pricings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_pricings
    ADD CONSTRAINT customer_pricings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: customer_visits customer_visits_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_visits
    ADD CONSTRAINT customer_visits_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: customer_visits customer_visits_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_visits
    ADD CONSTRAINT customer_visits_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;


--
-- Name: customers customers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customers
    ADD CONSTRAINT customers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: debt_installments debt_installments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_installments
    ADD CONSTRAINT debt_installments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: debt_installments debt_installments_debt_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_installments
    ADD CONSTRAINT debt_installments_debt_id_fkey FOREIGN KEY (debt_id) REFERENCES public.accounts_payable(id) ON DELETE CASCADE;


--
-- Name: debt_installments debt_installments_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.debt_installments
    ADD CONSTRAINT debt_installments_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: deliveries deliveries_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: deliveries deliveries_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_helper_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_2_fkey FOREIGN KEY (helper_id_2) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_helper_id_3_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_3_fkey FOREIGN KEY (helper_id_3) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.profiles(id);


--
-- Name: deliveries deliveries_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deliveries
    ADD CONSTRAINT deliveries_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: delivery_items delivery_items_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_items
    ADD CONSTRAINT delivery_items_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.deliveries(id) ON DELETE CASCADE;


--
-- Name: delivery_items delivery_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_items
    ADD CONSTRAINT delivery_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: delivery_photos delivery_photos_delivery_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_photos
    ADD CONSTRAINT delivery_photos_delivery_id_fkey FOREIGN KEY (delivery_id) REFERENCES public.deliveries(id);


--
-- Name: delivery_reports delivery_reports_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_reports
    ADD CONSTRAINT delivery_reports_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id);


--
-- Name: delivery_reports delivery_reports_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delivery_reports
    ADD CONSTRAINT delivery_reports_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: employee_advances employee_advances_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: employee_advances employee_advances_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: employee_advances employee_advances_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: employee_advances employee_advances_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_advances
    ADD CONSTRAINT employee_advances_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id);


--
-- Name: employee_salaries employee_salaries_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salaries
    ADD CONSTRAINT employee_salaries_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: employee_salaries employee_salaries_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employee_salaries
    ADD CONSTRAINT employee_salaries_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: expenses expenses_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: expenses fk_expenses_expense_account; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT fk_expenses_expense_account FOREIGN KEY (expense_account_id) REFERENCES public.accounts(id);


--
-- Name: material_stock_movements fk_material_stock_movement_material; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT fk_material_stock_movement_material FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: material_stock_movements fk_material_stock_movement_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT fk_material_stock_movement_user FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: inventory_batch_consumptions inventory_batch_consumptions_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batch_consumptions
    ADD CONSTRAINT inventory_batch_consumptions_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.inventory_batches(id) ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: inventory_batches inventory_batches_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: inventory_batches inventory_batches_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id);


--
-- Name: inventory_batches inventory_batches_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_batches
    ADD CONSTRAINT inventory_batches_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: journal_entry_lines journal_entry_lines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: journal_entry_lines journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.journal_entry_lines
    ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id) ON DELETE CASCADE;


--
-- Name: manual_journal_entry_lines manual_journal_entry_lines_journal_entry_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.manual_journal_entry_lines
    ADD CONSTRAINT manual_journal_entry_lines_journal_entry_id_fkey FOREIGN KEY (journal_entry_id) REFERENCES public.manual_journal_entries(id) ON DELETE CASCADE;


--
-- Name: material_stock_movements material_stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.material_stock_movements
    ADD CONSTRAINT material_stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: materials materials_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: nishab_reference nishab_reference_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nishab_reference
    ADD CONSTRAINT nishab_reference_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: payment_history payment_history_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: payment_history payment_history_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: payment_history payment_history_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: payment_history payment_history_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_history
    ADD CONSTRAINT payment_history_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: payroll_records payroll_records_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT payroll_records_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: payroll_records payroll_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT payroll_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: payroll_records payroll_records_employee_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payroll_records
    ADD CONSTRAINT payroll_records_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES public.profiles(id);


--
-- Name: product_materials product_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_materials
    ADD CONSTRAINT product_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: product_materials product_materials_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_materials
    ADD CONSTRAINT product_materials_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_stock_movements product_stock_movements_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: product_stock_movements product_stock_movements_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_stock_movements
    ADD CONSTRAINT product_stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: production_errors production_errors_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_errors
    ADD CONSTRAINT production_errors_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: production_errors production_errors_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_errors
    ADD CONSTRAINT production_errors_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: production_records production_records_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: production_records production_records_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: production_records production_records_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.production_records
    ADD CONSTRAINT production_records_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: profiles profiles_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: purchase_order_items purchase_order_items_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);


--
-- Name: purchase_order_items purchase_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: purchase_order_items purchase_order_items_purchase_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_purchase_order_id_fkey FOREIGN KEY (purchase_order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: purchase_orders purchase_orders_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: purchase_orders purchase_orders_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id);


--
-- Name: purchase_orders purchase_orders_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id);


--
-- Name: quotations quotations_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: quotations quotations_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: receivables receivables_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.receivables
    ADD CONSTRAINT receivables_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: retasi retasi_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: retasi retasi_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_2_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_2_fkey FOREIGN KEY (helper_id_2) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_3_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_3_fkey FOREIGN KEY (helper_id_3) REFERENCES public.profiles(id);


--
-- Name: retasi retasi_helper_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi
    ADD CONSTRAINT retasi_helper_id_fkey FOREIGN KEY (helper_id) REFERENCES public.profiles(id);


--
-- Name: retasi_items retasi_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi_items
    ADD CONSTRAINT retasi_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: retasi_items retasi_items_retasi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retasi_items
    ADD CONSTRAINT retasi_items_retasi_id_fkey FOREIGN KEY (retasi_id) REFERENCES public.retasi(id) ON DELETE CASCADE;


--
-- Name: sales_visit_reports sales_visit_reports_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: sales_visit_reports sales_visit_reports_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: sales_visit_reports sales_visit_reports_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: sales_visit_reports sales_visit_reports_payment_history_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_payment_history_id_fkey FOREIGN KEY (payment_history_id) REFERENCES public.payment_history(id);


--
-- Name: sales_visit_reports sales_visit_reports_sales_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_visit_reports
    ADD CONSTRAINT sales_visit_reports_sales_id_fkey FOREIGN KEY (sales_id) REFERENCES public.profiles(id);


--
-- Name: stock_pricings stock_pricings_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stock_pricings
    ADD CONSTRAINT stock_pricings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: supplier_materials supplier_materials_material_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_materials
    ADD CONSTRAINT supplier_materials_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.materials(id) ON DELETE CASCADE;


--
-- Name: supplier_materials supplier_materials_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.supplier_materials
    ADD CONSTRAINT supplier_materials_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE CASCADE;


--
-- Name: suppliers suppliers_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: transaction_payments transaction_payments_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.accounts(id);


--
-- Name: transaction_payments transaction_payments_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: transaction_payments transaction_payments_cancelled_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_cancelled_by_fkey FOREIGN KEY (cancelled_by) REFERENCES public.profiles(id);


--
-- Name: transaction_payments transaction_payments_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: transaction_payments transaction_payments_paid_by_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_paid_by_user_id_fkey FOREIGN KEY (paid_by_user_id) REFERENCES public.profiles(id);


--
-- Name: transaction_payments transaction_payments_transaction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transaction_payments
    ADD CONSTRAINT transaction_payments_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES public.transactions(id) ON DELETE CASCADE;


--
-- Name: transactions transactions_assigned_driver_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_assigned_driver_id_fkey FOREIGN KEY (assigned_driver_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_branch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id);


--
-- Name: transactions transactions_cashier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_cashier_id_fkey FOREIGN KEY (cashier_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_customer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id);


--
-- Name: transactions transactions_designer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_designer_id_fkey FOREIGN KEY (designer_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.profiles(id);


--
-- Name: transactions transactions_payment_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_payment_account_id_fkey FOREIGN KEY (payment_account_id) REFERENCES public.accounts(id);


--
-- Name: transactions transactions_retasi_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_retasi_id_fkey FOREIGN KEY (retasi_id) REFERENCES public.retasi(id) ON DELETE SET NULL;


--
-- Name: transactions transactions_sales_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactions
    ADD CONSTRAINT transactions_sales_id_fkey FOREIGN KEY (sales_id) REFERENCES public.profiles(id);


--
-- Name: user_roles user_roles_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.profiles(id);


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: accounts_payable Allow all for accounts_payable; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all for accounts_payable" ON public.accounts_payable USING (true) WITH CHECK (true);


--
-- Name: inventory_batch_consumptions Allow all for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all for authenticated users" ON public.inventory_batch_consumptions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: inventory_batches Allow all for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all for authenticated users" ON public.inventory_batches TO authenticated USING (true) WITH CHECK (true);


--
-- Name: zakat_records Allow all for authenticated users; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all for authenticated users" ON public.zakat_records USING (true) WITH CHECK (true);


--
-- Name: nishab_reference Allow all for nishab_reference; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow all for nishab_reference" ON public.nishab_reference USING (true) WITH CHECK (true);


--
-- Name: inventory_batch_consumptions Allow read for anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read for anon" ON public.inventory_batch_consumptions FOR SELECT TO anon USING (true);


--
-- Name: inventory_batches Allow read for anon; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Allow read for anon" ON public.inventory_batches FOR SELECT TO anon USING (true);


--
-- Name: accounts accounts_delete_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_delete_authenticated ON public.accounts FOR DELETE TO authenticated, owner, admin USING (true);


--
-- Name: accounts accounts_modify_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_modify_authenticated ON public.accounts FOR INSERT TO authenticated, owner, admin WITH CHECK (true);


--
-- Name: accounts_payable accounts_payable_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_payable_allow_all ON public.accounts_payable TO authenticated USING (true) WITH CHECK (true);


--
-- Name: accounts accounts_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_select_all ON public.accounts FOR SELECT TO authenticated, anon, owner, admin, supervisor, cashier, designer, operator, supir, sales, helper USING (true);


--
-- Name: accounts accounts_update_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY accounts_update_authenticated ON public.accounts FOR UPDATE TO authenticated, owner, admin USING (true);


--
-- Name: advance_repayments advance_repayments_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY advance_repayments_allow_all ON public.advance_repayments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: asset_maintenance asset_maintenance_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY asset_maintenance_allow_all ON public.asset_maintenance TO authenticated USING (true) WITH CHECK (true);


--
-- Name: assets assets_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assets_allow_all ON public.assets TO authenticated USING (true) WITH CHECK (true);


--
-- Name: attendance attendance_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY attendance_allow_all ON public.attendance TO authenticated USING (true) WITH CHECK (true);


--
-- Name: audit_logs audit_logs_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_allow_all ON public.audit_logs TO authenticated USING (true) WITH CHECK (true);


--
-- Name: balance_adjustments balance_adjustments_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY balance_adjustments_allow_all ON public.balance_adjustments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: bonus_pricings bonus_pricings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bonus_pricings_delete ON public.bonus_pricings FOR DELETE USING ((auth.role() = ANY (ARRAY['owner'::text, 'admin'::text])));


--
-- Name: bonus_pricings bonus_pricings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bonus_pricings_insert ON public.bonus_pricings FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) OR (CURRENT_USER = ANY (ARRAY['owner'::name, 'admin'::name, 'supervisor'::name, 'cashier'::name, 'authenticated'::name]))));


--
-- Name: bonus_pricings bonus_pricings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bonus_pricings_select ON public.bonus_pricings FOR SELECT USING (true);


--
-- Name: bonus_pricings bonus_pricings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bonus_pricings_update ON public.bonus_pricings FOR UPDATE USING (((auth.uid() IS NOT NULL) OR (CURRENT_USER = ANY (ARRAY['owner'::name, 'admin'::name, 'supervisor'::name, 'cashier'::name, 'authenticated'::name]))));


--
-- Name: branches branches_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY branches_allow_all ON public.branches TO authenticated USING (true) WITH CHECK (true);


--
-- Name: cash_history cash_history_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cash_history_allow_all ON public.cash_history TO authenticated USING (true) WITH CHECK (true);


--
-- Name: commission_entries commission_entries_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_entries_allow_all ON public.commission_entries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: commission_rules commission_rules_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_rules_allow_all ON public.commission_rules TO authenticated USING (true) WITH CHECK (true);


--
-- Name: companies companies_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY companies_allow_all ON public.companies TO authenticated USING (true) WITH CHECK (true);


--
-- Name: company_settings company_settings_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY company_settings_allow_all ON public.company_settings TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customer_pricings customer_pricings_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_pricings_allow_all ON public.customer_pricings TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customer_visits customer_visits_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customer_visits_allow_all ON public.customer_visits TO authenticated USING (true) WITH CHECK (true);


--
-- Name: customers customers_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY customers_allow_all ON public.customers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: debt_installments debt_installments_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_installments_allow_all ON public.debt_installments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: debt_installments debt_installments_anon_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY debt_installments_anon_all ON public.debt_installments TO anon USING (true) WITH CHECK (true);


--
-- Name: deliveries deliveries_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deliveries_allow_all ON public.deliveries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: deliveries deliveries_select_returning; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deliveries_select_returning ON public.deliveries FOR SELECT TO authenticated USING (true);


--
-- Name: delivery_items delivery_items_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_items_allow_all ON public.delivery_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: delivery_photos delivery_photos_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_photos_allow_all ON public.delivery_photos TO authenticated USING (true) WITH CHECK (true);


--
-- Name: delivery_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.delivery_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: delivery_reports delivery_reports_access_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY delivery_reports_access_policy ON public.delivery_reports TO authenticated USING (true) WITH CHECK (true);


--
-- Name: employee_advances employee_advances_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_advances_allow_all ON public.employee_advances TO authenticated USING (true) WITH CHECK (true);


--
-- Name: employee_salaries employee_salaries_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY employee_salaries_allow_all ON public.employee_salaries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: expenses expenses_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY expenses_allow_all ON public.expenses TO authenticated USING (true) WITH CHECK (true);


--
-- Name: inventory_batch_consumptions inventory_batch_consumptions_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_batch_consumptions_allow_all ON public.inventory_batch_consumptions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: inventory_batches inventory_batches_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY inventory_batches_allow_all ON public.inventory_batches TO authenticated USING (true) WITH CHECK (true);


--
-- Name: journal_entries journal_entries_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_delete ON public.journal_entries FOR DELETE USING ((auth.role() = ANY (ARRAY['owner'::text, 'admin'::text])));


--
-- Name: journal_entries journal_entries_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_insert ON public.journal_entries FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: journal_entries journal_entries_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_select ON public.journal_entries FOR SELECT USING (true);


--
-- Name: journal_entries journal_entries_select_returning; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_select_returning ON public.journal_entries FOR SELECT TO authenticated USING (true);


--
-- Name: journal_entries journal_entries_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entries_update ON public.journal_entries FOR UPDATE TO authenticated, anon, owner, admin, supervisor, cashier, designer, operator, supir, sales, helper USING (true);


--
-- Name: journal_entry_lines journal_entry_lines_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_delete ON public.journal_entry_lines FOR DELETE USING ((auth.role() = ANY (ARRAY['owner'::text, 'admin'::text])));


--
-- Name: journal_entry_lines journal_entry_lines_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_insert ON public.journal_entry_lines FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: journal_entry_lines journal_entry_lines_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_select ON public.journal_entry_lines FOR SELECT USING (true);


--
-- Name: journal_entry_lines journal_entry_lines_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY journal_entry_lines_update ON public.journal_entry_lines FOR UPDATE TO authenticated USING (true);


--
-- Name: manual_journal_entries manual_journal_entries_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manual_journal_entries_allow_all ON public.manual_journal_entries TO authenticated USING (true) WITH CHECK (true);


--
-- Name: manual_journal_entry_lines manual_journal_entry_lines_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY manual_journal_entry_lines_allow_all ON public.manual_journal_entry_lines TO authenticated USING (true) WITH CHECK (true);


--
-- Name: material_stock_movements material_stock_movements_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY material_stock_movements_allow_all ON public.material_stock_movements TO authenticated USING (true) WITH CHECK (true);


--
-- Name: nishab_reference nishab_reference_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nishab_reference_allow_all ON public.nishab_reference TO authenticated USING (true) WITH CHECK (true);


--
-- Name: notifications notifications_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_allow_all ON public.notifications TO authenticated USING (true) WITH CHECK (true);


--
-- Name: payment_history payment_history_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_history_allow_all ON public.payment_history TO authenticated USING (true) WITH CHECK (true);


--
-- Name: payroll_records payroll_records_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payroll_records_allow_all ON public.payroll_records TO authenticated USING (true) WITH CHECK (true);


--
-- Name: product_materials product_materials_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY product_materials_allow_all ON public.product_materials TO authenticated USING (true) WITH CHECK (true);


--
-- Name: product_stock_movements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.product_stock_movements ENABLE ROW LEVEL SECURITY;

--
-- Name: production_errors production_errors_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_errors_allow_all ON public.production_errors TO authenticated USING (true) WITH CHECK (true);


--
-- Name: production_records production_records_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY production_records_allow_all ON public.production_records TO authenticated USING (true) WITH CHECK (true);


--
-- Name: products products_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY products_allow_all ON public.products TO authenticated USING (true) WITH CHECK (true);


--
-- Name: profiles profiles_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_allow_all ON public.profiles TO authenticated, anon, owner, admin, supervisor, cashier, designer, operator, supir, sales, helper USING (true) WITH CHECK (true);


--
-- Name: purchase_order_items purchase_order_items_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY purchase_order_items_allow_all ON public.purchase_order_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: purchase_orders purchase_orders_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY purchase_orders_allow_all ON public.purchase_orders TO authenticated USING (true) WITH CHECK (true);


--
-- Name: quotations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.quotations ENABLE ROW LEVEL SECURITY;

--
-- Name: quotations quotations_delete_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_delete_policy ON public.quotations FOR DELETE TO authenticated USING (public.check_quotation_access_v5(branch_id));


--
-- Name: quotations quotations_insert_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_insert_policy ON public.quotations FOR INSERT TO authenticated WITH CHECK (public.check_quotation_access_v5(branch_id));


--
-- Name: quotations quotations_select_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_select_policy ON public.quotations FOR SELECT TO authenticated USING (public.check_quotation_access_v5(branch_id));


--
-- Name: quotations quotations_update_policy; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotations_update_policy ON public.quotations FOR UPDATE TO authenticated USING (public.check_quotation_access_v5(branch_id)) WITH CHECK (public.check_quotation_access_v5(branch_id));


--
-- Name: retasi retasi_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retasi_allow_all ON public.retasi TO authenticated USING (true) WITH CHECK (true);


--
-- Name: retasi_items retasi_items_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY retasi_items_allow_all ON public.retasi_items TO authenticated USING (true) WITH CHECK (true);


--
-- Name: role_permissions role_permissions_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permissions_allow_all ON public.role_permissions TO authenticated, anon, owner, admin, supervisor, cashier, designer, operator, supir, sales, helper USING (true) WITH CHECK (true);


--
-- Name: roles roles_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_allow_all ON public.roles TO authenticated, anon, owner, admin, supervisor, cashier, designer, operator, supir, sales, helper USING (true) WITH CHECK (true);


--
-- Name: sales_visit_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_visit_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_visit_reports sales_visit_reports_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_visit_reports_allow_all ON public.sales_visit_reports TO authenticated, anon USING (true) WITH CHECK (true);


--
-- Name: sales_visit_reports sales_visit_reports_branch_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sales_visit_reports_branch_isolation ON public.sales_visit_reports TO authenticated USING (((branch_id IS NULL) OR (branch_id IN ( SELECT profiles.branch_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))))) WITH CHECK (((branch_id IS NULL) OR (branch_id IN ( SELECT profiles.branch_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: stock_pricings stock_pricings_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_pricings_delete ON public.stock_pricings FOR DELETE USING ((auth.role() = ANY (ARRAY['owner'::text, 'admin'::text])));


--
-- Name: stock_pricings stock_pricings_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_pricings_insert ON public.stock_pricings FOR INSERT WITH CHECK (((auth.uid() IS NOT NULL) OR (CURRENT_USER = ANY (ARRAY['owner'::name, 'admin'::name, 'supervisor'::name, 'cashier'::name, 'authenticated'::name]))));


--
-- Name: stock_pricings stock_pricings_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_pricings_select ON public.stock_pricings FOR SELECT USING (true);


--
-- Name: stock_pricings stock_pricings_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY stock_pricings_update ON public.stock_pricings FOR UPDATE USING (((auth.uid() IS NOT NULL) OR (CURRENT_USER = ANY (ARRAY['owner'::name, 'admin'::name, 'supervisor'::name, 'cashier'::name, 'authenticated'::name]))));


--
-- Name: supplier_materials supplier_materials_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY supplier_materials_allow_all ON public.supplier_materials TO authenticated USING (true) WITH CHECK (true);


--
-- Name: suppliers suppliers_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY suppliers_allow_all ON public.suppliers TO authenticated USING (true) WITH CHECK (true);


--
-- Name: transaction_payments transaction_payments_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transaction_payments_allow_all ON public.transaction_payments TO authenticated USING (true) WITH CHECK (true);


--
-- Name: transactions transactions_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY transactions_allow_all ON public.transactions TO authenticated USING (true) WITH CHECK (true);


--
-- Name: user_roles user_roles_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_allow_all ON public.user_roles TO authenticated USING (true) WITH CHECK (true);


--
-- Name: zakat_records zakat_records_allow_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY zakat_records_allow_all ON public.zakat_records TO authenticated USING (true) WITH CHECK (true);


--
-- PostgreSQL database dump complete
--

\unrestrict sHNMMZvVD5W15EnwTLf5qe21Npxrz49tmWx8k7vsMAxLORsgdNrZMAxide44mav

