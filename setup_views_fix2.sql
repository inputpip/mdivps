-- STEP 1: CREATE v_realisasi_penjualan
DROP VIEW IF EXISTS public.v_kalkulasi_komisi;
DROP VIEW IF EXISTS public.v_realisasi_penjualan;

CREATE OR REPLACE VIEW public.v_realisasi_penjualan AS 
SELECT 
    d.delivery_date AS realization_date,
    t.id AS transaction_id,
    d.id::text AS delivery_id,
    'delivery' AS source_type,
    t.customer_name,
    di.product_id::text AS product_id,
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
             (elem->'product'->>'id' = di.product_id::text)
             OR 
             (elem->>'productId' = di.product_id::text)
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
    t.operator_id,
    t.designer_id,
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
    COALESCE(elem->'product'->>'id', elem->>'productId') AS product_id,
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
    t.operator_id,
    t.designer_id,
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
    COALESCE(elem->'product'->>'id', elem->>'productId') AS product_id,
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
    t.operator_id,
    t.designer_id,
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

-- STEP 2: CREATE v_kalkulasi_komisi
CREATE OR REPLACE VIEW public.v_kalkulasi_komisi AS 
WITH sales_base AS (
    SELECT * FROM v_realisasi_penjualan 
    WHERE is_bonus = false
      AND UPPER(product_name) NOT LIKE '%(BONUS)%'
      AND UPPER(product_name) NOT LIKE '%BONUS%'
)

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.driver_id AS user_id,
    sb.driver_name AS user_name,
    'driver' AS role,
    CASE 
        WHEN sb.helper_id IS NOT NULL AND sb.helper_id_2 IS NOT NULL AND sb.helper_id_3 IS NOT NULL 
          THEN FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_3_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 4)
        WHEN sb.helper_id IS NOT NULL AND sb.helper_id_2 IS NOT NULL AND sb.helper_id_3 IS NULL 
          THEN FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_2_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 3)
        WHEN sb.helper_id IS NULL 
          THEN (COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'driver' AND product_id::text = sb.product_id LIMIT 1), 0) + 
                COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'helper' AND product_id::text = sb.product_id LIMIT 1), 0))
        ELSE COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'driver' AND product_id::text = sb.product_id LIMIT 1), 0)
    END AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.driver_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.helper_id AS user_id,
    sb.helper_name AS user_name,
    'helper' AS role,
    CASE 
        WHEN sb.helper_id_2 IS NOT NULL AND sb.helper_id_3 IS NOT NULL 
          THEN FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_3_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 4)
        WHEN sb.helper_id_2 IS NOT NULL AND sb.helper_id_3 IS NULL 
          THEN FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_2_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 3)
        ELSE COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'helper' AND product_id::text = sb.product_id LIMIT 1), 0)
    END AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.helper_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.helper_id_2 AS user_id,
    sb.helper_name_2 AS user_name,
    'helper' AS role,
    CASE 
        WHEN sb.helper_id_3 IS NOT NULL 
          THEN FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_3_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 4)
        ELSE FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_2_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 3)
    END AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.helper_id_2 IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.helper_id_3 AS user_id,
    sb.helper_name_3 AS user_name,
    'helper' AS role,
    FLOOR(COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'delivery_3_helpers' AND product_id::text = sb.product_id LIMIT 1), 0) / 4) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.helper_id_3 IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.sales_id AS user_id,
    sb.sales_name AS user_name,
    'sales' AS role,
    COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'sales' AND product_id::text = sb.product_id LIMIT 1), 0) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.sales_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.cashier_id AS user_id,
    sb.cashier_name AS user_name,
    'cashier' AS role,
    COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'cashier' AND product_id::text = sb.product_id LIMIT 1), 0) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.cashier_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.operator_id AS user_id,
    NULL AS user_name,
    'operator' AS role,
    COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'operator' AND product_id::text = sb.product_id LIMIT 1), 0) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.operator_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    sb.designer_id AS user_id,
    NULL AS user_name,
    'designer' AS role,
    COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'designer' AND product_id::text = sb.product_id LIMIT 1), 0) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
WHERE sb.designer_id IS NOT NULL

UNION ALL

SELECT 
    sb.realization_date,
    sb.transaction_id,
    sb.delivery_id,
    sb.product_id,
    sb.product_name,
    sb.quantity,
    p.id AS user_id,
    p.full_name AS user_name,
    'supervisor' AS role,
    COALESCE((SELECT rate_per_qty FROM commission_rules WHERE role = 'supervisor' AND product_id::text = sb.product_id LIMIT 1), 0) AS rate_per_qty,
    sb.branch_id
FROM sales_base sb
JOIN profiles p ON p.branch_id = sb.branch_id AND p.role = 'supervisor';

-- GRANT PERMISSIONS
GRANT SELECT ON public.v_realisasi_penjualan TO authenticated;
GRANT SELECT ON public.v_realisasi_penjualan TO anon;
GRANT SELECT ON public.v_kalkulasi_komisi TO authenticated;
GRANT SELECT ON public.v_kalkulasi_komisi TO anon;

-- Add realtime tracking
ALTER PUBLICATION supabase_realtime ADD TABLE commission_rules;
