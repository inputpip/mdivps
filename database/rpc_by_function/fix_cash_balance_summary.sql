-- Script to fix get_cash_balance_summary in mkw_db
-- Run this on VPS: psql -d aquvit_new -t -A -c "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='get_cash_balance_summary';" > /tmp/cash_fn.sql
-- Then: psql -d mkw_db -f /tmp/cash_fn.sql

-- Step 1: Drop old version with wrong return type
DROP FUNCTION IF EXISTS public.get_cash_balance_summary(uuid, date);

-- Step 2: Recreate with correct signature (account_id as TEXT to match accounts.id)
CREATE OR REPLACE FUNCTION public.get_cash_balance_summary(
  p_branch_id uuid,
  p_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE(
  account_id text,
  account_name text,
  account_code character varying,
  opening_balance numeric,
  today_income numeric,
  today_expense numeric,
  today_net numeric,
  current_balance numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH
  -- 1. Identify Cash/Bank Accounts (is_payment_account = true)
  cash_accounts AS (
    SELECT a.id, a.name, a.code, COALESCE(a.initial_balance, 0) as initial_balance
    FROM accounts a
    WHERE a.branch_id = p_branch_id
      AND a.is_payment_account = true
      AND a.is_header = false
  ),
  -- 2. Opening balance = all movements BEFORE today
  opening_stats AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit_amount - jel.credit_amount), 0) as balance_movement
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.branch_id = p_branch_id
      AND je.status = 'posted'
      AND je.is_voided = false
      AND DATE(je.entry_date) < p_date
      AND jel.account_id IN (SELECT id FROM cash_accounts)
    GROUP BY jel.account_id
  ),
  -- 3. Today's movements
  today_stats AS (
    SELECT
      jel.account_id,
      COALESCE(SUM(jel.debit_amount), 0) as debit_total,
      COALESCE(SUM(jel.credit_amount), 0) as credit_total
    FROM journal_entry_lines jel
    JOIN journal_entries je ON je.id = jel.journal_entry_id
    WHERE je.branch_id = p_branch_id
      AND je.status = 'posted'
      AND je.is_voided = false
      AND DATE(je.entry_date) = p_date
      AND jel.account_id IN (SELECT id FROM cash_accounts)
    GROUP BY jel.account_id
  )
  SELECT
    ca.id::text as account_id,
    ca.name as account_name,
    ca.code as account_code,
    -- Opening balance = initial_balance + all movements before today
    (ca.initial_balance + COALESCE(os.balance_movement, 0)) as opening_balance,
    -- Today's income = debit movements today (cash in)
    COALESCE(ts.debit_total, 0) as today_income,
    -- Today's expense = credit movements today (cash out)
    COALESCE(ts.credit_total, 0) as today_expense,
    -- Net today
    (COALESCE(ts.debit_total, 0) - COALESCE(ts.credit_total, 0)) as today_net,
    -- Current Balance = Opening + Today's Net
    (ca.initial_balance + COALESCE(os.balance_movement, 0) +
     COALESCE(ts.debit_total, 0) - COALESCE(ts.credit_total, 0)) as current_balance
  FROM cash_accounts ca
  LEFT JOIN opening_stats os ON os.account_id = ca.id
  LEFT JOIN today_stats ts ON ts.account_id = ca.id
  ORDER BY ca.code;
END;
$function$;
