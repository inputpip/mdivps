-- Count BEFORE delete
SELECT COUNT(*) as bonus_name_commissions_found
FROM commission_entries
WHERE product_name ILIKE '%(Bonus)%';

-- Show sample to be safe
SELECT created_at, user_name, product_name, amount
FROM commission_entries
WHERE product_name ILIKE '%(Bonus)%'
LIMIT 5;

-- DELETE EXECUTION
DELETE FROM commission_entries
WHERE product_name ILIKE '%(Bonus)%';

-- Count AFTER delete (Should be 0)
SELECT COUNT(*) as remaining_bonus_name_commissions
FROM commission_entries
WHERE product_name ILIKE '%(Bonus)%';
