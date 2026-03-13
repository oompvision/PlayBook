-- ============================================================
-- 53. Drop old overloaded booking functions
--
-- Migrations 00010, 00034, and 00037 each created create_booking
-- with different parameter counts. PostgreSQL treats these as
-- separate overloaded functions (CREATE OR REPLACE only replaces
-- functions with the EXACT same signature). This causes PostgREST
-- to potentially call the wrong version — specifically the old
-- ones that don't store discount_cents.
--
-- Same issue for create_dynamic_booking (00032, 00034, 00037).
--
-- Fix: drop the old signatures so only the latest (00037) remains.
-- ============================================================

-- Drop old create_booking signatures (00010 = 6 params, 00034 = 7 params)
DROP FUNCTION IF EXISTS public.create_booking(uuid, uuid, uuid, date, uuid[], text);
DROP FUNCTION IF EXISTS public.create_booking(uuid, uuid, uuid, date, uuid[], text, uuid);

-- Drop old create_dynamic_booking signatures (00032 = 8 params, 00034 = 9 params)
DROP FUNCTION IF EXISTS public.create_dynamic_booking(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, text);
DROP FUNCTION IF EXISTS public.create_dynamic_booking(uuid, uuid, uuid, date, timestamptz, timestamptz, integer, text, uuid);
