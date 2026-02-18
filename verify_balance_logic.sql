-- Compare journal sums to the report logic strictly
WITH journal_sums AS (
    SELECT 
        jel.account_id,
        SUM(jel.debit_amount) as total_debit,
        SUM(jel.credit_amount) as total_credit
    FROM journal_entry_lines jel
    JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE je.branch_id = '00000000-0000-0000-0000-000000000001'
    AND je.status = 'posted'
    AND je.is_voided = false
    GROUP BY jel.account_id
),
account_balances AS (
    SELECT 
        js.account_id,
        a.name,
        a.code,
        a.type,
        js.total_debit,
        js.total_credit,
        CASE 
            WHEN a.type IN ('Aset', 'Beban') THEN js.total_debit - js.total_credit
            ELSE js.total_credit - js.total_debit
        END as net_balance
    FROM journal_sums js
    JOIN accounts a ON js.account_id = a.id
)
SELECT 
    -- Total Assets (Normal Debit)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Aset') as total_assets,

    -- Total Liabilities (Normal Credit)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Kewajiban') as total_liabilities,

    -- Total Equity (Modal) (Normal Credit)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Modal') as total_equity,

    -- Total Revenue (Normal Credit)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Pendapatan') as total_revenue,

    -- Total Expense (Normal Debit)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Beban') as total_expense,

    -- Calculation Check:
    -- Assets = Liabilities + Equity + (Revenue - Expense)
    -- So Diff = Assets - (Liabilities + Equity + Revenue - Expense)
    (SELECT SUM(net_balance) FROM account_balances WHERE type = 'Aset') - (
        (SELECT COALESCE(SUM(net_balance),0) FROM account_balances WHERE type = 'Kewajiban') +
        (SELECT COALESCE(SUM(net_balance),0) FROM account_balances WHERE type = 'Modal') +
        (SELECT COALESCE(SUM(net_balance),0) FROM account_balances WHERE type = 'Pendapatan') -
        (SELECT COALESCE(SUM(net_balance),0) FROM account_balances WHERE type = 'Beban')
    ) as calculated_imbalance
;
