-- Matahari-only performance view for customer summary reads.
-- Apply only to DB: matahari. Do NOT apply to aquvit_new or mkw_db.

CREATE OR REPLACE VIEW public.v_customer_summaries AS
WITH order_summary AS (
  SELECT
    t.customer_id,
    COUNT(*)::integer AS order_count,
    MAX(t.order_date) AS last_order_date
  FROM public.transactions t
  WHERE COALESCE(t.is_voided, false) = false
    AND COALESCE(t.is_cancelled, false) = false
    AND t.customer_id IS NOT NULL
  GROUP BY t.customer_id
),
receivable_summary AS (
  SELECT
    r.customer_id,
    SUM(COALESCE(r.amount, 0))::numeric AS total_piutang,
    SUM(GREATEST(COALESCE(r.amount, 0) - COALESCE(r.paid_amount, 0), 0))::numeric AS sisa_piutang,
    COUNT(*) FILTER (WHERE GREATEST(COALESCE(r.amount, 0) - COALESCE(r.paid_amount, 0), 0) > 0)::integer AS jumlah_piutang,
    MIN(r.due_date) FILTER (WHERE GREATEST(COALESCE(r.amount, 0) - COALESCE(r.paid_amount, 0), 0) > 0) AS jatuh_tempo_terdekat
  FROM public.receivables r
  WHERE r.status IN ('pending', 'partial')
    AND r.customer_id IS NOT NULL
  GROUP BY r.customer_id
),
last_gallon_movement AS (
  SELECT DISTINCT ON (gm.customer_id)
    gm.customer_id,
    gm.delta AS last_gallon_delta,
    gm.type AS last_gallon_type,
    gm.created_at AS last_gallon_change_at
  FROM public.gallon_movements gm
  WHERE gm.customer_id IS NOT NULL
  ORDER BY gm.customer_id, gm.created_at DESC
)
SELECT
  c.id,
  c.name,
  c.phone,
  c.address,
  c.latitude,
  c.longitude,
  c.full_address,
  c.store_photo_url,
  c.jumlah_galon_titip,
  c.classification,
  c.branch_id,
  COALESCE(c."createdAt", c.createdat, now()) AS created_at,
  COALESCE(os.order_count, 0) AS order_count,
  os.last_order_date,
  COALESCE(rs.total_piutang, 0) AS total_piutang,
  COALESCE(rs.sisa_piutang, 0) AS sisa_piutang,
  COALESCE(rs.jumlah_piutang, 0) AS jumlah_piutang,
  rs.jatuh_tempo_terdekat,
  lgm.last_gallon_delta,
  lgm.last_gallon_type,
  lgm.last_gallon_change_at
FROM public.customers c
LEFT JOIN order_summary os ON os.customer_id = c.id
LEFT JOIN receivable_summary rs ON rs.customer_id = c.id
LEFT JOIN last_gallon_movement lgm ON lgm.customer_id = c.id;

CREATE INDEX IF NOT EXISTS idx_transactions_customer_order_date_matahari
  ON public.transactions(customer_id, order_date DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_branch_created_at_matahari
  ON public.transactions(branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receivables_customer_status_matahari
  ON public.receivables(customer_id, status)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_gallon_movements_customer_created_matahari
  ON public.gallon_movements(customer_id, created_at DESC)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_branch_name_matahari
  ON public.customers(branch_id, name)
  WHERE branch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id_matahari
  ON public.role_permissions(role_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    GRANT SELECT ON public.v_customer_summaries TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON public.v_customer_summaries TO authenticated;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
