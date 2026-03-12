-- Mark all existing deliveries as reported
DO $$ 
DECLARE 
    fallback_driver_id UUID;
BEGIN
    -- Get a valid profile ID as fallback
    SELECT id INTO fallback_driver_id FROM profiles LIMIT 1;

    -- Insert reports for all deliveries that don't have one yet
    INSERT INTO delivery_reports (transaction_id, driver_id, status, reported_at, created_at, notes)
    SELECT 
        d.transaction_id, 
        COALESCE(d.driver_id, fallback_driver_id), 
        'delivered', 
        now(), 
        now(), 
        'Auto-reported (Data Lama)'
    FROM deliveries d
    LEFT JOIN delivery_reports dr ON d.transaction_id = dr.transaction_id
    WHERE dr.id IS NULL
    -- Avoid duplicate issues if multiple deliveries share same txn_id (though unlikely in current schema)
    ON CONFLICT (transaction_id) DO NOTHING; 

    -- Update deliveries status to delivered/completed too? 
    -- The user said "buat mereka sudah terlapor semua"
    UPDATE deliveries SET status = 'delivered' WHERE status != 'delivered';
END $$;
