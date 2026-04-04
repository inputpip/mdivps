CREATE OR REPLACE VIEW public.v_arus_kas_lengkap AS
SELECT 
    jel.id AS line_id,
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
    je.created_at
FROM journal_entry_lines jel
JOIN journal_entries je ON jel.journal_entry_id = je.id
JOIN accounts acc ON jel.account_id = acc.id
WHERE je.is_voided = false;

GRANT SELECT ON public.v_arus_kas_lengkap TO anon, authenticated;
