SELECT 
    trigger_schema,
    trigger_name,
    event_object_table,
    action_statement
FROM 
    information_schema.triggers
WHERE 
    event_object_table IN ('deliveries', 'delivery_items', 'commission_entries');
