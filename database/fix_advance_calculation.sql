-- FIX: get_outstanding_advances to exclude cancelled advances
CREATE OR REPLACE FUNCTION public.get_outstanding_advances(emp_id uuid, up_to_date date DEFAULT CURRENT_DATE) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  total_advances DECIMAL(15,2) := 0;
  total_repayments DECIMAL(15,2) := 0;
  outstanding DECIMAL(15,2) := 0;
BEGIN
  -- Calculate total advances up to the specified date, excluding cancelled/voided
  SELECT COALESCE(SUM(amount), 0) INTO total_advances
  FROM public.employee_advances
  WHERE employee_id = emp_id
    AND status NOT IN ('cancelled', 'voided')
    AND date <= up_to_date;
    
  -- Calculate total repayments up to the specified date
  SELECT COALESCE(SUM(ar.amount), 0) INTO total_repayments
  FROM public.advance_repayments ar
  JOIN public.employee_advances ea ON ea.id = ar.advance_id
  WHERE ea.employee_id = emp_id
    AND ea.status NOT IN ('cancelled', 'voided')
    AND ar.date <= up_to_date;
    
  -- Calculate outstanding amount
  outstanding := total_advances - total_repayments;
  -- Return 0 if negative (overpaid)
  RETURN GREATEST(outstanding, 0);
END;
$function$;

-- FIX: update_remaining_amount to handle status update
CREATE OR REPLACE FUNCTION public.update_remaining_amount(p_advance_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_total_repaid NUMERIC := 0;
  v_original_amount NUMERIC := 0;
  v_new_remaining NUMERIC := 0;
  v_current_status TEXT;
BEGIN
  -- Get the original advance amount and status
  SELECT amount, status INTO v_original_amount, v_current_status
  FROM public.employee_advances 
  WHERE id = p_advance_id;
  
  IF v_original_amount IS NULL THEN
    RAISE EXCEPTION 'Advance with ID % not found', p_advance_id;
  END IF;
  
  -- Do not update if already cancelled
  IF v_current_status = 'cancelled' THEN
    RETURN;
  END IF;
  
  -- Calculate total repaid amount for this advance
  SELECT COALESCE(SUM(amount), 0) INTO v_total_repaid
  FROM public.advance_repayments 
  WHERE advance_id = p_advance_id;
  
  -- Calculate new remaining amount
  v_new_remaining := v_original_amount - v_total_repaid;
  
  -- Ensure remaining amount doesn't go below 0
  IF v_new_remaining < 0 THEN
    v_new_remaining := 0;
  END IF;
  
  -- Update the remaining amount and status
  UPDATE public.employee_advances 
  SET 
    remaining_amount = v_new_remaining,
    status = CASE 
      WHEN v_new_remaining <= 0 THEN 'paid'::text 
      ELSE 'active'::text 
    END
  WHERE id = p_advance_id;
  
END;
$function$;

-- FIX: process_advance_repayment_from_salary to be safer and include end loop
CREATE OR REPLACE FUNCTION public.process_advance_repayment_from_salary(payroll_record_id uuid, advance_deduction_amount numeric) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  payroll_record RECORD;
  remaining_deduction DECIMAL(15,2);
  advance_record RECORD;
  repayment_amount DECIMAL(15,2);
BEGIN
  -- Get payroll record details
  SELECT pr.*, p.full_name as employee_name
  INTO payroll_record
  FROM public.payroll_records pr
  JOIN public.profiles p ON p.id = pr.employee_id
  WHERE pr.id = payroll_record_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payroll record not found';
  END IF;
  
  remaining_deduction := advance_deduction_amount;
  
  -- Process advances in chronological order (FIFO)
  -- Filter by status to avoid cancelled ones
  FOR advance_record IN
    SELECT ea.id, (ea.amount - COALESCE(SUM(ar.amount), 0)) as remaining_amount
    FROM public.employee_advances ea
    LEFT JOIN public.advance_repayments ar ON ar.advance_id = ea.id
    WHERE ea.employee_id = payroll_record.employee_id
      AND ea.status NOT IN ('cancelled', 'voided')
      AND ea.date <= payroll_record.period_end
    GROUP BY ea.id, ea.amount, ea.date
    HAVING (ea.amount - COALESCE(SUM(ar.amount), 0)) > 0
    ORDER BY ea.date ASC
  LOOP
    -- Calculate repayment amount for this advance
    repayment_amount := LEAST(remaining_deduction, advance_record.remaining_amount);
    
    -- Create repayment record
    INSERT INTO public.advance_repayments (
      id,
      advance_id,
      amount,
      date,
      recorded_by,
      notes
    ) VALUES (
      'rep-' || extract(epoch from now())::bigint || '-' || substring(advance_record.id from 5),
      advance_record.id,
      repayment_amount,
      payroll_record.payment_date,
      payroll_record.created_by,
      'Pemotongan gaji ' || TO_CHAR(DATE(payroll_record.period_year || '-' || payroll_record.period_month || '-01'), 'Month YYYY')
    );
    
    -- Update remaining deduction
    remaining_deduction := remaining_deduction - repayment_amount;
    
    -- Update remaining amount using fixed RPC
    PERFORM public.update_remaining_amount(advance_record.id);
    
    -- Exit if all deduction is processed
    IF remaining_deduction <= 0 THEN
      EXIT;
    END IF;
  END LOOP;
  
END;
$function$;
