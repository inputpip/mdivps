-- Enable Delivery Report permissions for supir and helper
UPDATE role_permissions 
SET permissions = jsonb_set(
    jsonb_set(
        jsonb_set(permissions, '{delivery_report_create}', 'true'),
        '{mobile_delivery_report}', 'true'
    ),
    '{delivery_report_view}', 'true'
)
WHERE role_id IN ('supir', 'helper');
