-- =====================================================
-- 16 NOTIFICATION
-- Generated: 2026-01-09T00:29:07.864Z
-- Total functions: 2
-- =====================================================

-- Functions in this file:
--   notify_production_completed
--   upsert_notification_atomic

-- =====================================================
-- Function: notify_production_completed
-- =====================================================
CREATE OR REPLACE FUNCTION public.notify_production_completed() RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
DECLARE
    v_product_name TEXT;
BEGIN
    -- Only notify when status changes to completed
    IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
        -- Get product name
        SELECT name INTO v_product_name FROM products WHERE id = NEW.product_id;
        INSERT INTO notifications (id, title, message, type, reference_type, reference_id, reference_url, priority)
        VALUES (
            'NOTIF-PROD-' || NEW.id || '-' || EXTRACT(EPOCH FROM NOW())::TEXT,
            'Production Completed',
            'Production of ' || COALESCE(v_product_name, 'Unknown Product') || ' completed. Quantity: ' || NEW.quantity_produced,
            'production_completed',
            'production',
            NEW.id,
            '/production',
            'normal'
        );
    END IF;
    RETURN NEW;
END;
$function$;


-- =====================================================
-- Function: upsert_notification_atomic
-- =====================================================
CREATE OR REPLACE FUNCTION public.upsert_notification_atomic(p_user_id uuid, p_type text, p_title text, p_message text, p_priority text DEFAULT 'normal'::text, p_reference_id text DEFAULT NULL::text, p_reference_type text DEFAULT NULL::text, p_reference_url text DEFAULT NULL::text) RETURNS TABLE(notification_id uuid, success boolean, error_message text)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $function$
DECLARE
  v_notification_id UUID;
  v_existing_id UUID;
  v_today TIMESTAMP;
BEGIN
  -- Get today's start time
  v_today := DATE_TRUNC('day', NOW());
  -- Check if similar unread notification exists today
  SELECT id INTO v_existing_id
  FROM notifications
  WHERE user_id = p_user_id
    AND type = p_type
    AND is_read = FALSE
    AND created_at >= v_today
  LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    -- Update existing notification
    UPDATE notifications
    SET 
      title = p_title,
      message = p_message,
      priority = p_priority,
      reference_id = p_reference_id,
      updated_at = NOW()
    WHERE id = v_existing_id;
    
    v_notification_id := v_existing_id;
  ELSE
    -- Create new notification
    INSERT INTO notifications (
      user_id,
      type,
      title,
      message,
      priority,
      reference_id,
      reference_type,
      reference_url
    ) VALUES (
      p_user_id,
      p_type,
      p_title,
      p_message,
      p_priority,
      p_reference_id,
      p_reference_type,
      p_reference_url
    )
    RETURNING id INTO v_notification_id;
  END IF;
  RETURN QUERY SELECT 
    v_notification_id,
    TRUE,
    NULL::TEXT;
EXCEPTION WHEN OTHERS THEN
  RETURN QUERY SELECT 
    NULL::UUID,
    FALSE,
    SQLERRM::TEXT;
END;
$function$;


