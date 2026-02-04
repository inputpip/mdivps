SELECT 
    TO_CHAR(order_date, 'YYYY-MM') as month,
    COUNT(*) as total_transactions,
    COUNT(sales_name) as with_sales_name,
    COUNT(CASE WHEN sales_name = 'Jumriah' THEN 1 END) as jumriah_transactions
FROM transactions
WHERE order_date >= '2025-12-01'
GROUP BY 1
ORDER BY 1 DESC;

SELECT 
    id, 
    order_date, 
    COALESCE(sales_name, 'NULL') as sales_name
FROM transactions
WHERE sales_name IS NOT NULL
ORDER BY order_date DESC
LIMIT 10;
