-- ============================================================================
-- SOC II Compliance: Login Attempt Tracking & Lockout
-- Tracks failed login attempts and provides lockout after threshold.
-- ============================================================================

CREATE TABLE public.login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  ip_address inet,
  success boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for efficient lockout queries
CREATE INDEX idx_login_attempts_email_created
  ON public.login_attempts (email, created_at DESC);

-- Enable RLS — only service role can write, super admins can read
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "login_attempts_super_admin_read"
  ON public.login_attempts FOR SELECT
  USING (public.is_super_admin());

-- ── Record a login attempt ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_login_attempt(
  p_email text,
  p_ip inet,
  p_success boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.login_attempts (email, ip_address, success)
  VALUES (lower(trim(p_email)), p_ip, p_success);

  -- If successful login, clear failed attempts for this email
  IF p_success THEN
    DELETE FROM public.login_attempts
    WHERE email = lower(trim(p_email))
      AND success = false;
  END IF;
END;
$$;

-- ── Check if login is allowed (lockout check) ─────────────────────────────

CREATE OR REPLACE FUNCTION public.check_login_allowed(
  p_email text,
  p_ip inet DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_failed_count integer;
  v_lockout_threshold integer := 5;
  v_lockout_window interval := interval '15 minutes';
  v_oldest_attempt timestamptz;
  v_locked_until timestamptz;
BEGIN
  -- Count failed attempts in the lockout window
  SELECT count(*), min(created_at)
  INTO v_failed_count, v_oldest_attempt
  FROM public.login_attempts
  WHERE email = lower(trim(p_email))
    AND success = false
    AND created_at > now() - v_lockout_window;

  IF v_failed_count >= v_lockout_threshold THEN
    v_locked_until := v_oldest_attempt + v_lockout_window;
    RETURN json_build_object(
      'allowed', false,
      'locked_until', v_locked_until,
      'attempts_remaining', 0,
      'message', 'Too many failed login attempts. Please try again later.'
    );
  END IF;

  RETURN json_build_object(
    'allowed', true,
    'locked_until', null,
    'attempts_remaining', v_lockout_threshold - v_failed_count,
    'message', null
  );
END;
$$;

-- ── Cleanup: delete entries older than 24 hours ───────────────────────────
-- Run via pg_cron or Supabase scheduled function:
-- SELECT cron.schedule('cleanup-login-attempts', '0 * * * *',
--   $$DELETE FROM public.login_attempts WHERE created_at < now() - interval '24 hours'$$
-- );
