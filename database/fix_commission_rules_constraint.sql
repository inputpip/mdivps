-- FIX: Update commission_rules_role_check constraint to allow more roles
-- Execute this on both NBX and MKW databases

ALTER TABLE public.commission_rules 
DROP CONSTRAINT IF EXISTS commission_rules_role_check;

ALTER TABLE public.commission_rules 
ADD CONSTRAINT commission_rules_role_check 
CHECK (role = ANY (ARRAY[
    'sales', 'driver', 'helper', 
    'delivery_2_helpers', 'delivery_3_helpers', 
    'cashier', 'designer', 'operator', 
    'supervisor', 'admin', 'branch_admin', 'owner'
]));

-- Optional: Verify the change
-- SELECT conname, pg_get_constraintdef(oid) 
-- FROM pg_constraint 
-- WHERE conrelid = 'public.commission_rules'::regclass AND conname = 'commission_rules_role_check';
