DROP VIEW IF EXISTS public.v_coa_saldosaatini;
CREATE VIEW public.v_coa_saldosaatini AS
WITH RECURSIVE account_tree AS (
  SELECT 
    id,
    parent_id,
    id AS base_account_id,
    balance,
    initial_balance
  FROM accounts
  WHERE is_header = false
  
  UNION ALL
  
  SELECT 
    a.id,
    a.parent_id,
    at.base_account_id,
    at.balance,
    at.initial_balance
  FROM accounts a
  JOIN account_tree at ON at.parent_id = a.id
)
SELECT 
  a.id,
  a.code,
  a.name,
  a.type,
  a.is_header,
  a.parent_id,
  a.level,
  a.branch_id,
  a.is_payment_account,
  a.is_active,
  a.sort_order,
  a.employee_id,
  p.name AS employee_name,
  p.full_name AS employee_full_name,
  a.created_at,
  COALESCE(SUM(at.balance), 0) AS total_balance,
  COALESCE(SUM(at.initial_balance), 0) AS total_initial_balance
FROM accounts a
LEFT JOIN account_tree at ON a.id = at.id
LEFT JOIN profiles p ON a.employee_id = p.id
GROUP BY a.id, a.code, a.name, a.type, a.is_header, a.parent_id, a.level, a.branch_id, a.is_payment_account, a.is_active, a.sort_order, a.employee_id, p.name, p.full_name, a.created_at
ORDER BY a.code;

GRANT SELECT ON public.v_coa_saldosaatini TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
