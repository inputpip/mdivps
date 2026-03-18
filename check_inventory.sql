-- Query 1: Nilai Stok Fisik
SELECT 'STOK_FISIK' as label, SUM(remaining_quantity * unit_cost) as value, SUM(remaining_quantity) as qty
FROM inventory_batches
WHERE product_id IS NOT NULL AND remaining_quantity > 0
AND branch_id = '00000000-0000-0000-0000-000000000001';

-- Query 2: Saldo Akun 1310
SELECT 'AKUN_1310' as label, code, name, balance, initial_balance, balance + initial_balance as total
FROM accounts
WHERE code = '1310' AND branch_id = '00000000-0000-0000-0000-000000000001';

-- Query 3: Saldo Akun 2140
SELECT 'AKUN_2140' as label, code, name, balance, initial_balance, balance + initial_balance as total
FROM accounts
WHERE code = '2140' AND branch_id = '00000000-0000-0000-0000-000000000001';

-- Query 4: Saldo Akun 1320 (Bahan Baku)
SELECT 'AKUN_1320' as label, code, name, balance, initial_balance, balance + initial_balance as total
FROM accounts
WHERE code = '1320' AND branch_id = '00000000-0000-0000-0000-000000000001';

-- Query 5: Produksi tanpa batch
SELECT count(*) as produksi_tanpa_batch
FROM production_records pr
LEFT JOIN inventory_batches ib ON ib.production_id = pr.id
WHERE pr.branch_id = '00000000-0000-0000-0000-000000000001'
AND ib.id IS NULL AND pr.quantity > 0;
