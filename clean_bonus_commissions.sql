-- Helper query to count potential bonus commission entries BEFORE deleting
-- We cast to text to avoid UUID/Text mismatch errors
SELECT COUNT(*) as bonus_commissions_to_delete
FROM commission_entries ce
JOIN delivery_items di 
  ON ce.delivery_id::text = di.delivery_id::text 
  AND ce.product_id::text = di.product_id::text
WHERE di.is_bonus = true;

-- Show some samples before deleting
SELECT ce.created_at, ce.user_name, ce.product_name, ce.amount, 'Bonus Item Commission' as remark
FROM commission_entries ce
JOIN delivery_items di 
  ON ce.delivery_id::text = di.delivery_id::text 
  AND ce.product_id::text = di.product_id::text
WHERE di.is_bonus = true
LIMIT 5;

-- DELETE EXECUTION
DELETE FROM commission_entries ce
USING delivery_items di
WHERE ce.delivery_id::text = di.delivery_id::text 
  AND ce.product_id::text = di.product_id::text
  AND di.is_bonus = true;

-- Verify deletion (Should be 0)
SELECT COUNT(*) as remaining_bonus_commissions
FROM commission_entries ce
JOIN delivery_items di 
  ON ce.delivery_id::text = di.delivery_id::text 
  AND ce.product_id::text = di.product_id::text
WHERE di.is_bonus = true;
