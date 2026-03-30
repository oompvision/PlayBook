-- ============================================================================
-- SOC II Compliance: Data Retention Policy
-- Defines retention periods and provides a cleanup function.
-- ============================================================================

-- DATA RETENTION POLICY:
-- | Data Type          | Retention Period | Action     |
-- |--------------------|-----------------|------------|
-- | audit_logs         | 1 year          | Hard delete |
-- | login_attempts     | 24 hours        | Hard delete |
-- | bookings           | Indefinite      | Preserve   |
-- | booking_payments   | 7 years         | Preserve   |
-- | profiles           | Until deletion  | Anonymize  |

-- Cleanup function callable by application cron or pg_cron
CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_audit_deleted bigint;
  v_login_deleted bigint;
BEGIN
  -- Delete audit logs older than 1 year
  DELETE FROM public.audit_logs
  WHERE created_at < now() - interval '1 year';
  GET DIAGNOSTICS v_audit_deleted = ROW_COUNT;

  -- Delete login attempts older than 24 hours
  DELETE FROM public.login_attempts
  WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS v_login_deleted = ROW_COUNT;

  -- Log the cleanup event (won't be cleaned up for another year)
  BEGIN
    INSERT INTO public.audit_logs (
      action, resource_type, resource_id, metadata
    ) VALUES (
      'delete'::public.audit_action,
      'data_retention',
      'system',
      jsonb_build_object(
        'audit_logs_deleted', v_audit_deleted,
        'login_attempts_deleted', v_login_deleted,
        'cleanup_timestamp', now()
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN json_build_object(
    'success', true,
    'audit_logs_deleted', v_audit_deleted,
    'login_attempts_deleted', v_login_deleted
  );
END;
$$;

-- To schedule via pg_cron (run daily at 3 AM UTC):
-- SELECT cron.schedule('data-retention-cleanup', '0 3 * * *',
--   $$SELECT public.cleanup_expired_data()$$
-- );
