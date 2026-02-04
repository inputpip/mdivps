-- Check constraints referencing materials
SELECT 
    conname as constraint_name, 
    conrelid::regclass as referencing_table,
    CASE confdeltype 
        WHEN 'a' THEN 'NO ACTION (Secure)'
        WHEN 'r' THEN 'RESTRICT (Secure)'
        WHEN 'c' THEN 'CASCADE (Dangerous)'
        WHEN 'n' THEN 'SET NULL (Warning)'
        WHEN 'd' THEN 'SET DEFAULT (Warning)'
    END as delete_action
FROM pg_constraint 
WHERE confrelid = 'materials'::regclass;

-- Check constraints referencing products
SELECT 
    conname as constraint_name, 
    conrelid::regclass as referencing_table,
    CASE confdeltype 
        WHEN 'a' THEN 'NO ACTION (Secure)'
        WHEN 'r' THEN 'RESTRICT (Secure)'
        WHEN 'c' THEN 'CASCADE (Dangerous)'
        WHEN 'n' THEN 'SET NULL (Warning)'
        WHEN 'd' THEN 'SET DEFAULT (Warning)'
    END as delete_action
FROM pg_constraint 
WHERE confrelid = 'products'::regclass;
