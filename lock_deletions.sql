DO $$
DECLARE
    r RECORD;
BEGIN
    -- 1. Secure MATERIALS (Bahan)
    -- Mencari FK yang mengarah ke materials dengan tipe CASCADE (c) atau SET NULL (n)
    FOR r IN 
        SELECT 
            c.conname, 
            c.conrelid::regclass::text AS table_name, 
            a.attname AS column_name
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
        WHERE c.confrelid = 'materials'::regclass 
        AND (c.confdeltype = 'c' OR c.confdeltype = 'n') -- Cascade or Set Null
    LOOP
        RAISE NOTICE 'Securing constraint % on table % for column %', r.conname, r.table_name, r.column_name;
        
        -- Drop old constraint
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.conname);
        
        -- Re-add with RESTRICT
        -- Ini akan mencegah penghapusan material jika data ini masih ada
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES materials(id) ON DELETE RESTRICT', r.table_name, r.conname, r.column_name);
    END LOOP;

    -- 2. Secure PRODUCTS (Produk)
    -- Mencari FK yang mengarah ke products dengan tipe CASCADE (c) atau SET NULL (n)
    FOR r IN 
        SELECT 
            c.conname, 
            c.conrelid::regclass::text AS table_name, 
            a.attname AS column_name
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
        WHERE c.confrelid = 'products'::regclass 
        AND (c.confdeltype = 'c' OR c.confdeltype = 'n') -- Cascade or Set Null
    LOOP
        RAISE NOTICE 'Securing constraint % on table % for column %', r.conname, r.table_name, r.column_name;
        
        -- Drop old constraint
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', r.table_name, r.conname);
        
        -- Re-add with RESTRICT
        -- Ini akan mencegah penghapusan produk jika transaksi penjualan masih ada
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES products(id) ON DELETE RESTRICT', r.table_name, r.conname, r.column_name);
    END LOOP;
END$$;
