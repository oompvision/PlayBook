-- ============================================================================
-- SOC II Compliance: Audit Log Database Triggers
-- Automatically logs INSERT/UPDATE/DELETE on critical tables.
-- Uses SECURITY DEFINER to write to audit_logs via service-level access.
-- ============================================================================

-- Generic trigger function that logs changes to audit_logs
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action public.audit_action;
  v_old jsonb := NULL;
  v_new jsonb := NULL;
  v_resource_id text;
  v_org_id uuid := NULL;
  v_user_id uuid := NULL;
BEGIN
  -- Determine the action
  IF TG_OP = 'INSERT' THEN
    v_action := 'create';
    v_new := to_jsonb(NEW);
    v_resource_id := NEW.id::text;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    v_resource_id := NEW.id::text;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'delete';
    v_old := to_jsonb(OLD);
    v_resource_id := OLD.id::text;
  END IF;

  -- Try to get current user (may be null for service-role operations)
  v_user_id := auth.uid();

  -- Try to extract org_id from the row
  IF TG_OP = 'DELETE' THEN
    v_org_id := (v_old ->> 'org_id')::uuid;
  ELSE
    v_org_id := (v_new ->> 'org_id')::uuid;
  END IF;

  -- Strip sensitive fields from logged values
  IF v_old IS NOT NULL THEN
    v_old := v_old - ARRAY['guest_email', 'guest_phone', 'ip_address'];
  END IF;
  IF v_new IS NOT NULL THEN
    v_new := v_new - ARRAY['guest_email', 'guest_phone', 'ip_address'];
  END IF;

  -- Insert the audit record
  INSERT INTO public.audit_logs (
    org_id,
    user_id,
    action,
    resource_type,
    resource_id,
    old_value,
    new_value,
    metadata
  ) VALUES (
    v_org_id,
    v_user_id,
    v_action,
    TG_TABLE_NAME,
    v_resource_id,
    v_old,
    v_new,
    jsonb_build_object('trigger', true, 'operation', TG_OP)
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- ── Attach triggers to critical tables ─────────────────────────

-- Bookings: track creation, updates (status changes), and deletion
CREATE TRIGGER audit_bookings
  AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Profiles: track changes to user PII
CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Booking payments: track payment records
CREATE TRIGGER audit_booking_payments
  AFTER INSERT OR UPDATE OR DELETE ON public.booking_payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Organizations: track org settings changes
CREATE TRIGGER audit_organizations
  AFTER INSERT OR UPDATE OR DELETE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Bays: track resource configuration changes
CREATE TRIGGER audit_bays
  AFTER INSERT OR UPDATE OR DELETE ON public.bays
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- Org payment settings: track payment configuration changes
CREATE TRIGGER audit_org_payment_settings
  AFTER INSERT OR UPDATE OR DELETE ON public.org_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();
