DROP VIEW IF EXISTS public.v_arus_kas_lengkap;
CREATE OR REPLACE VIEW public.v_arus_kas_lengkap AS
 SELECT jel.id AS line_id,
    jel.journal_entry_id,
    je.entry_number,
    je.reference_type,
    je.reference_id,
    je.description AS journal_description,
    jel.account_id,
    acc.name AS account_name,
    jel.debit_amount,
    jel.credit_amount,
    jel.description AS line_description,
    je.branch_id,
    je.created_at,
    SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) OVER (PARTITION BY jel.account_id ORDER BY je.created_at ASC, jel.id ASC) AS after_balance,
    (SUM(COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) OVER (PARTITION BY jel.account_id ORDER BY je.created_at ASC, jel.id ASC)) - (COALESCE(jel.debit_amount, 0) - COALESCE(jel.credit_amount, 0)) AS previous_balance
   FROM journal_entry_lines jel
     JOIN journal_entries je ON jel.journal_entry_id = je.id
     JOIN accounts acc ON jel.account_id = acc.id
  WHERE je.is_voided = false;
