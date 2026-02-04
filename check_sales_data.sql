SELECT id, customer_name, sales_id, sales_name, created_at 
FROM transactions 
WHERE sales_name IS NOT NULL 
ORDER BY created_at DESC 
LIMIT 10;

SELECT DISTINCT sales_name 
FROM transactions;

SELECT id, name FROM profiles WHERE role = 'sales';
