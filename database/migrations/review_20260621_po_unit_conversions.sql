-- PO unit conversion master + stock-safe receiving

CREATE TABLE IF NOT EXISTS public.item_unit_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_type text NOT NULL CHECK (item_type IN ('material', 'product')),
  item_id uuid NOT NULL,
  unit_name text NOT NULL,
  conversion_qty numeric(15,4) NOT NULL CHECK (conversion_qty > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_type, item_id, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_item_unit_conversions_item
  ON public.item_unit_conversions (item_type, item_id);

ALTER TABLE public.purchase_order_items
  ADD COLUMN IF NOT EXISTS base_unit text,
  ADD COLUMN IF NOT EXISTS conversion_qty numeric(15,4) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_quantity numeric(15,4);

UPDATE public.purchase_order_items
SET
  base_unit = COALESCE(base_unit, unit),
  conversion_qty = COALESCE(conversion_qty, 1),
  base_quantity = COALESCE(base_quantity, quantity * COALESCE(conversion_qty, 1));

ALTER TABLE public.purchase_order_items
  ALTER COLUMN base_unit SET NOT NULL,
  ALTER COLUMN base_quantity SET NOT NULL;

CREATE OR REPLACE FUNCTION public.create_purchase_order_atomic(p_po_header jsonb, p_po_items jsonb, p_branch_id uuid) RETURNS TABLE(success boolean, po_id text, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
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
      base_unit,
      conversion_qty,
      base_quantity,
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
      COALESCE(v_item->>'base_unit', v_item->>'unit'),
      COALESCE((v_item->>'conversion_qty')::NUMERIC, 1),
      COALESCE((v_item->>'base_quantity')::NUMERIC, (v_item->>'quantity')::NUMERIC * COALESCE((v_item->>'conversion_qty')::NUMERIC, 1)),
      COALESCE((v_item->>'subtotal')::NUMERIC, (v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC),
      v_item->>'notes'
    );
  END LOOP;

  RETURN QUERY SELECT TRUE, v_po_id, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT FALSE, NULL::TEXT, SQLERRM::TEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.receive_po_atomic(p_po_id text, p_branch_id uuid, p_received_date date DEFAULT CURRENT_DATE, p_user_id uuid DEFAULT NULL::uuid, p_user_name text DEFAULT NULL::text) RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_po RECORD;
  v_item RECORD;
  v_materials_received INTEGER := 0;
  v_products_received INTEGER := 0;
  v_batches_created INTEGER := 0;
  v_previous_stock NUMERIC;
  v_new_stock NUMERIC;
  v_effective_quantity NUMERIC;
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
      poi.base_quantity,
      poi.base_unit,
      poi.conversion_qty,
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
    v_effective_quantity := COALESCE(v_item.base_quantity, v_item.quantity);

    IF v_item.material_id IS NOT NULL THEN
      -- ==================== PROCESS MATERIAL ====================
      v_previous_stock := COALESCE(v_item.material_current_stock, 0);
      v_new_stock := v_previous_stock + v_effective_quantity;

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
        v_effective_quantity,
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
        v_effective_quantity,
        v_effective_quantity,
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
        v_effective_quantity,
        v_effective_quantity,
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
$function$;

CREATE OR REPLACE FUNCTION public.receive_po_partial(p_po_id text, p_branch_id uuid, p_items jsonb, p_received_date date DEFAULT CURRENT_DATE, p_notes text DEFAULT NULL::text) RETURNS TABLE(success boolean, materials_received integer, products_received integer, batches_created integer, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
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
  v_effective_quantity NUMERIC;
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

    v_effective_quantity := v_qty_to_receive * COALESCE(v_poi.conversion_qty, 1);

    UPDATE purchase_order_items
    SET quantity_received = COALESCE(quantity_received, 0) + v_qty_to_receive, updated_at = NOW()
    WHERE id = v_item_id;

    IF v_material_id IS NOT NULL THEN
      SELECT stock INTO v_previous_stock FROM materials WHERE id = v_material_id;
      v_previous_stock := COALESCE(v_previous_stock, 0);
      v_new_stock := v_previous_stock + v_effective_quantity;

      UPDATE materials SET stock = v_new_stock, updated_at = NOW() WHERE id = v_material_id;

      INSERT INTO material_stock_movements (
        material_id, material_name, type, reason, quantity,
        previous_stock, new_stock, reference_id, reference_type,
        notes, user_id, user_name, branch_id, created_at
      ) VALUES (
        v_material_id, COALESCE(v_poi.material_name, 'Unknown'),
        'IN', 'PURCHASE', v_effective_quantity,
        v_previous_stock, v_new_stock, p_po_id, 'purchase_order',
        format('PO %s - Receive (%s)', p_po_id, COALESCE(p_notes, '')),
        v_user_id, v_user_name, p_branch_id, NOW()
      );

      INSERT INTO inventory_batches (
        material_id, branch_id, purchase_order_id, supplier_id,
        initial_quantity, remaining_quantity, unit_cost, batch_date, notes, created_at
      ) VALUES (
        v_material_id, p_branch_id, p_po_id, v_po.supplier_id,
        v_effective_quantity, v_effective_quantity, COALESCE(v_poi.unit_price, 0),
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
        v_effective_quantity, v_effective_quantity, COALESCE(v_poi.unit_price, 0),
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
$function$;
