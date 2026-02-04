SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'accounts' AND column_name = 'branch_id';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'deliveries' AND column_name = 'branch_id';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'commission_entries' AND column_name = 'product_id';
