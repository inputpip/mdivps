SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'transactions' AND column_name = 'id';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'deliveries' AND column_name = 'transaction_id';

SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'accounts' AND column_name = 'id';
