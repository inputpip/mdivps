-- STEP 1: FIX v_realisasi_penjualan TO PREVENT UUID CAST CRASHES
CREATE OR REPLACE VIEW public.v_realisasi_penjualan AS 
SELECT 
    d.delivery_date AS realization_date,
    t.id AS transaction_id,
    d.id::text AS delivery_id,
    'delivery' AS source_type,
    t.customer_name,
    di.product_id,
    di.product_name,
    di.quantity_delivered AS quantity,
    di.unit,
    di.is_bonus,
    COALESCE(
       (
          SELECT (elem->>'price')::numeric 
          FROM jsonb_array_elements(t.items) elem 
          WHERE 
          (
             (elem->'product'->>'id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND (elem->'product'->>'id')::uuid = di.product_id)
             OR 
             (elem->>'productId' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND (elem->>'productId')::uuid = di.product_id)
          )
          LIMIT 1
       ), 0
    ) AS price,
    d.driver_id,
    d.driver_name,
    d.helper_id,
    d.helper_name,
    d.helper_id_2,
    d.helper_name_2,
    d.helper_id_3,
    d.helper_name_3,
    t.sales_id,
    t.sales_name,
    t.cashier_id,
    t.cashier_name,
    NULL::uuid AS retasi_id,
    NULL::text AS retasi_number,
    t.payment_account_id,
    t.payment_status,
    d.branch_id
FROM deliveries d
JOIN transactions t ON d.transaction_id = t.id
JOIN delivery_items di ON d.id = di.delivery_id
WHERE d.status != 'cancelled' AND t.is_cancelled = false AND t.is_voided = false

UNION ALL

SELECT 
    t.order_date AS realization_date,
    t.id AS transaction_id,
    NULL AS delivery_id,
    CASE WHEN t.is_office_sale = true THEN 'office_sale' ELSE 'pos_kasir' END AS source_type,
    t.customer_name,
    CASE 
      WHEN COALESCE(elem->'product'->>'id', elem->>'productId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
      THEN COALESCE(elem->'product'->>'id', elem->>'productId')::uuid 
      ELSE NULL 
    END AS product_id,
    COALESCE((elem->'product'->>'name')::text, (elem->>'productName')::text) AS product_name,
    (elem->>'quantity')::integer AS quantity,
    (elem->'product'->>'unit')::text AS unit,
    COALESCE((elem->>'isBonus')::boolean, (elem->>'is_bonus')::boolean, false) AS is_bonus,
    COALESCE((elem->>'price')::numeric, 0) AS price,
    NULL::uuid AS driver_id,
    NULL::text AS driver_name,
    NULL::uuid AS helper_id,
    NULL::text AS helper_name,
    NULL::uuid AS helper_id_2,
    NULL::text AS helper_name_2,
    NULL::uuid AS helper_id_3,
    NULL::text AS helper_name_3,
    t.sales_id,
    t.sales_name,
    t.cashier_id,
    t.cashier_name,
    t.retasi_id,
    t.retasi_number,
    t.payment_account_id,
    t.payment_status,
    t.branch_id
FROM transactions t
CROSS JOIN LATERAL jsonb_array_elements(t.items) elem
WHERE t.is_cancelled = false AND t.is_voided = false
AND NOT EXISTS (
    SELECT 1 FROM deliveries d WHERE d.transaction_id = t.id AND d.status != 'cancelled'
)
AND t.retasi_id IS NULL
AND (elem->>'productId' IS NOT NULL OR elem->'product'->>'id' IS NOT NULL)

UNION ALL

SELECT 
    t.order_date AS realization_date,
    t.id AS transaction_id,
    NULL AS delivery_id,
    'retasi' AS source_type,
    t.customer_name,
    CASE 
      WHEN COALESCE(elem->'product'->>'id', elem->>'productId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' 
      THEN COALESCE(elem->'product'->>'id', elem->>'productId')::uuid 
      ELSE NULL 
    END AS product_id,
    COALESCE((elem->'product'->>'name')::text, (elem->>'productName')::text) AS product_name,
    (elem->>'quantity')::integer AS quantity,
    (elem->'product'->>'unit')::text AS unit,
    COALESCE((elem->>'isBonus')::boolean, (elem->>'is_bonus')::boolean, false) AS is_bonus,
    COALESCE((elem->>'price')::numeric, 0) AS price,
    r.driver_id,
    r.driver_name,
    r.helper_id,
    r.helper_name,
    r.helper_id_2,
    r.helper_name_2,
    r.helper_id_3,
    r.helper_name_3,
    t.sales_id,
    t.sales_name,
    t.cashier_id,
    t.cashier_name,
    t.retasi_id,
    t.retasi_number,
    t.payment_account_id,
    t.payment_status,
    t.branch_id
FROM transactions t
JOIN retasi r ON t.retasi_id = r.id
CROSS JOIN LATERAL jsonb_array_elements(t.items) elem
WHERE t.is_cancelled = false AND t.is_voided = false
AND t.retasi_id IS NOT NULL
AND (elem->>'productId' IS NOT NULL OR elem->'product'->>'id' IS NOT NULL);
