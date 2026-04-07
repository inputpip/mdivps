SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name IN ('transactions', 'deliveries', 'delivery_items', 'retasi', 'commission_rules', 'profiles', 'products') 
ORDER BY table_name, ordinal_position;
