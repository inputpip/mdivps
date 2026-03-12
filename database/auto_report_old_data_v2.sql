-- Mark all existing deliveries as reported
DO $$ 
DECLARE 
    fallback_driver_id UUID;
    db_name TEXT;
BEGIN
    SELECT current_database() INTO db_name;
    RAISE NOTICE 'Processing database: %', db_name;

    -- Get a valid profile ID as fallback if driver_id is null
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
    WHERE NOT EXISTS (
        SELECT 1 FROM delivery_reports dr WHERE dr.transaction_id = d.transaction_id
    );

    -- Update deliveries status to delivered
    UPDATE deliveries SET status = 'delivered' WHERE status != 'delivered';
    
    RAISE NOTICE 'Finished auto-reporting for %', db_name;
END $$;
