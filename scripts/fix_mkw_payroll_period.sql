-- FIX PAYROLL PERIOD PT PERDANA INTIM PUSAKA
-- From Feb 2026 to Jan 2026
-- Prepared by Antigravity AI

BEGIN;

-- 1. Identify Target Records
-- Branch: PT PERDANA INTIM PUSAKA (00000000-0000-0000-0000-000000000001)
-- Period: 2026-02-01 until 2026-02-28

-- 2. Update payroll_records
UPDATE public.payroll_records
SET 
    period_start = '2026-01-01',
    period_end = '2026-01-31',
    notes = CASE 
        WHEN notes IS NULL OR notes = '' THEN 'Koreksi periode dari Feb ke Jan' 
        ELSE notes || ' (Koreksi periode dari Feb ke Jan)' 
    END,
    updated_at = NOW()
WHERE 
    branch_id = '00000000-0000-0000-0000-000000000001' 
    AND period_start = '2026-02-01'
    AND status = 'paid';

-- 3. Update journal_entries descriptions
-- Synchronizing journal description with corrected period
UPDATE public.journal_entries
SET 
    description = REPLACE(description, '2/2026', '1/2026'),
    updated_at = NOW()
WHERE 
    branch_id = '00000000-0000-0000-0000-000000000001'
    AND reference_type = 'payroll'
    AND description LIKE '%2/2026%'
    AND entry_date >= '2026-02-01';

COMMIT;
