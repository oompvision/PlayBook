# Events Feature — Implementation Plan

## Codebase Audit: Conflicts & Resolutions

### 1. Membership tiers mismatch
**PRD says** Tier 1 / Tier 2 enrollment windows.
**Reality**: `membership_tiers` has `UNIQUE(org_id)` — one tier per org.
**Resolution**: Use **member vs guest** model only. Events get `member_enrollment_days_before` and `guest_enrollment_days_before`. The existing `is_active_member()` function already distinguishes members from guests. No membership schema changes.

### 2. "Facilities" vs "bays"
**PRD says** `event_facilities` with `facility_id`.
**Reality**: The table is `bays` with `id`.
**Resolution**: Name the junction table `event_bays` with `bay_id` FK. The admin UI already labels bays as "Facilities" — no user-facing confusion.

### 3. Notification CHECK constraints
**Reality**: Three tables (`notifications`, `org_email_settings`, `notification_preferences`) have hardcoded CHECK constraints on `type`/`notification_type`.
**Resolution**: ALTER the CHECK constraints in the Phase 4 migration to add: `event_registration_confirmed`, `event_waitlist_joined`, `event_promoted_from_waitlist`, `event_cancelled_by_admin`, `event_details_changed`. Also update `src/lib/notifications/types.ts`.

### 4. No email gap — already solved
**Reality**: Email sending via Resend already exists in `src/lib/notifications/index.ts`. The `createNotification` function sends emails when enabled for that org+type. We just need to call it with event notification types.

### 5. bay_schedule_slots status constraint
**Reality**: CHECK allows only `'available', 'booked', 'blocked'`.
**Resolution**: ALTER to add `'event_hold'`. Add nullable `event_id UUID REFERENCES events(id) ON DELETE SET NULL` column so slots can be traced back to the blocking event.

### 6. Dynamic scheduling orgs
**Reality**: Dynamic orgs don't have pre-generated slots. They use `schedule_block_outs`.
**Resolution**: When an event is published on a dynamic org, create entries in `schedule_block_outs` with a new nullable `event_id` column. The availability engine already respects block-outs — zero changes needed to `src/lib/availability-engine.ts`.

### 7. registered_count denormalization
**PRD says** store `registered_count` on `events`.
**Resolution**: Don't store it — compute via `COUNT(*) FROM event_registrations WHERE status IN ('confirmed', 'pending_payment')`. Avoids sync bugs. Use subquery/lateral join for list views.

### 8. Waitlist promotion window
**User decision**: Configurable per-org (not per-event). Add `waitlist_promotion_hours INTEGER DEFAULT 24` to `org_payment_settings` or a new org-level events settings table. Admins set this globally from the Events settings area.

---

## Phase 1 — Core Schema + Admin Events CRUD

**Goal**: Admins can create, edit, list, and delete events from a new Events tab. Events are draft-only (no publishing or registration yet).

### Migration: `00038_events_core.sql`

**New tables:**
- `events` — core event record (org_id, location_id, name, description, start_time timestamptz, end_time timestamptz, capacity, price_cents, members_only, member_enrollment_days_before, guest_enrollment_days_before, status [draft|published|cancelled|completed], waitlist_promotion_hours default 24, parent_event_id nullable for recurring, template_id nullable, created_by)
- `event_bays` — junction table (event_id, bay_id) with UNIQUE(event_id, bay_id)
- `event_registrations` — registration records (event_id, user_id, status [confirmed|waitlisted|cancelled|pending_payment], waitlist_position, payment_status [pending|paid|refunded|waived], payment_intent_id, registered_at, cancelled_at, promoted_at, promotion_expires_at)

**RLS policies:**
- Events: public SELECT for published events (scoped to org_id), admin full CRUD via `is_org_admin(org_id)`, super_admin ALL
- event_bays: same pattern (public read published, admin write)
- event_registrations: users SELECT own rows, admin SELECT/UPDATE/DELETE for org, INSERT for authenticated users (registration)

**Indexes:** org_id+date, org_id+status, event_id on junction tables

**RPC function:** `get_event_with_details(p_event_id)` — returns event + bays + registration count in one call

### Files to create:
- `supabase/migrations/00038_events_core.sql`
- `src/app/admin/events/page.tsx` — events list (server component, follows bays/page.tsx pattern)
- `src/app/admin/events/create/page.tsx` — event creation form
- `src/app/admin/events/[id]/edit/page.tsx` — event edit form
- `src/components/admin/event-form.tsx` — shared form component (client component for multi-select bays, date/time pickers)

### Files to modify:
- `src/components/admin/admin-sidebar.tsx` — add "Events" to `commonNavItems` (Calendar icon, `/admin/events`)

### What to test:
- Admin can create an event with all fields
- Events list shows draft/published/cancelled with correct badges
- Edit populates all fields correctly
- Multi-bay selection works
- Location-aware filtering (if multi-location org)

---

## Phase 2 — Publishing, Availability Blocking, Registration + Payment

**Goal**: Admins can publish events (blocking bay availability). Customers can view and register for events, with payment integration.

### Migration: `00039_events_availability.sql`

**Schema changes:**
- ALTER `bay_schedule_slots` CHECK constraint: add `'event_hold'` status
- ADD `event_id UUID REFERENCES events(id) ON DELETE SET NULL` to `bay_schedule_slots`
- ADD `event_id UUID REFERENCES events(id) ON DELETE SET NULL` to `schedule_block_outs` (for dynamic orgs)

**RPC functions:**
- `publish_event(p_event_id)` — atomically: validates event, finds conflicting slots/bookings, changes status to 'published', marks affected `bay_schedule_slots` as `event_hold`, creates `schedule_block_outs` for dynamic orgs. Returns conflict summary (slot count, booking count).
- `register_for_event(p_event_id, p_user_id)` — atomically: checks capacity, enrollment window, membership, registers user or adds to waitlist. Uses SELECT FOR UPDATE on event row for concurrency safety.
- `cancel_event_registration(p_registration_id)` — cancels registration, auto-promotes next waitlisted user if applicable.
- `check_event_conflicts(p_event_id)` — preview function: returns count of affected slots and bookings without making changes. Called before publish to show admin the warning.

### Files to create:
- `src/app/admin/events/[id]/page.tsx` — event detail view (attendee list, status management)
- `src/app/admin/events/[id]/attendees/page.tsx` — full attendee management (add, remove, CSV export)
- `src/components/events/event-card.tsx` — public-facing event card (name, time, spots, price, CTA)
- `src/components/events/event-detail-modal.tsx` — registration modal (event info, register/waitlist button, payment)
- `src/components/events/events-feed.tsx` — "Upcoming Events" section for facility home page

### Files to modify:
- `src/app/page.tsx` (or facility home) — add Events feed section below availability widget
- `src/components/availability-widget.tsx` — show event badges inline in calendar view for slot-based orgs
- `src/app/my-bookings/page.tsx` — add "My Events" tab/section showing event registrations

### Payment integration:
- Follow existing `booking_payments` pattern
- If org `payment_mode` is `charge_upfront`: create Stripe PaymentIntent on the org's connected account during registration
- If `payment_mode` is `none` or price is $0: skip payment, register directly
- If `payment_mode` is `hold`: create SetupIntent to save card
- Reuse `src/lib/stripe.ts` singleton and existing Stripe Connect patterns

### What to test:
- Publish blocks correct bay_schedule_slots (slot-based orgs)
- Publish creates block-outs (dynamic orgs)
- Conflict check shows correct counts before publish
- Registration respects capacity limits (concurrent registrations)
- Enrollment window enforcement (member vs guest timing)
- Members-only events hidden from guests
- Payment flow works for paid events
- My Events shows registrations with correct status

---

## Phase 3 — Waitlist, Recurring Events, Templates, Attendee Management

**Goal**: Waitlist auto-promotion, weekly recurring events, event templates, and full attendee CRUD.

### Migration: `00040_events_advanced.sql`

**New tables:**
- `event_templates` — (org_id, name, config JSONB) — stores all event fields except date/time

**RPC functions:**
- `promote_from_waitlist(p_event_id)` — called by cancel_event_registration and by a scheduled job. Promotes next waitlisted user, sets promotion_expires_at = now() + waitlist_promotion_hours.
- `expire_waitlist_promotions()` — cron job function: finds pending_payment registrations past promotion_expires_at, cancels them, promotes next in line.
- `create_recurring_event_instances(p_event_id, p_day_of_week, p_end_date, p_occurrences)` — generates future event instances linked to parent via parent_event_id. Each instance is independent.
- `update_future_event_instances(p_parent_event_id, p_from_date, p_changes JSONB)` — "edit this and all future" — updates fields on all future instances.

### Files to create:
- `src/app/admin/events/templates/page.tsx` — template list + CRUD
- `src/components/admin/recurring-event-form.tsx` — recurrence UI (day-of-week selector, end condition)

### Files to modify:
- `src/components/admin/event-form.tsx` — add recurring toggle, template save checkbox, template selector
- `src/app/admin/events/[id]/page.tsx` — add attendee management (add/remove/CSV export)
- `src/app/admin/events/[id]/attendees/page.tsx` — manual add (bypass enrollment/capacity with warning), remove (triggers cancellation flow)

### Waitlist mechanics:
- On registration cancel → `promote_from_waitlist` runs automatically
- Promoted user gets `pending_payment` status with `promotion_expires_at`
- Notification sent: "You've been promoted! Complete payment by [time]"
- Cron function `expire_waitlist_promotions()` runs every 15 min via Supabase pg_cron (or edge function)
- Expired promotions → cancel + promote next

### What to test:
- Waitlist ordering is FIFO
- Auto-promotion on cancellation
- Promotion expiry after configurable hours
- Recurring creates correct instances on correct dates
- "Edit this and all future" updates correct instances
- Templates save all fields except date/time
- Creating from template pre-fills form
- CSV export includes all required fields

---

## Phase 4 — Events Feed, Calendar Integration, Notifications, Chat

**Goal**: Polish customer experience — events feed widget, calendar badges, full notification system, AI chat integration.

### Migration: `00041_events_notifications.sql`

**Schema changes:**
- ALTER CHECK constraints on `notifications`, `org_email_settings`, `notification_preferences` to add event types
- Backfill `org_email_settings` for new types on all existing orgs
- Update `seed_org_email_settings()` trigger

### Notification types to add:
- `event_registration_confirmed`
- `event_waitlist_joined`
- `event_promoted_from_waitlist`
- `event_cancelled_by_admin`
- `event_details_changed`

### Files to modify:
- `src/lib/notifications/types.ts` — add new types + labels
- `src/components/daily-schedule.tsx` — render event blocks as green banners spanning bays
- `src/app/api/chat/route.ts` — add Gemini tools: `get_upcoming_events`, `register_for_event`, `cancel_event_registration`
- Phase 2-3 registration/cancellation flows — wire in `createNotification()` calls

### Files to create:
- `src/components/events/event-calendar-block.tsx` — green banner for admin calendar view

### Chat integration:
- `get_upcoming_events` tool: lists published events for the facility with spots/enrollment info
- `register_for_event` tool: registers authenticated user by event name/date
- `cancel_event_registration` tool: cancels by event name or confirmation

### What to test:
- Events feed renders on home page with correct visibility rules
- Calendar shows green event banners at correct positions
- Notifications sent for each trigger (registration, waitlist, promotion, cancellation)
- Email delivery when org has email enabled for event types
- Chat can list events, register, and cancel
- Members-only events hidden from guest chat users

---

## File Count Estimate

| Phase | New files | Modified files | Migrations |
|-------|----------|---------------|------------|
| 1     | 5        | 1             | 1          |
| 2     | 5        | 3             | 1          |
| 3     | 2        | 3             | 1          |
| 4     | 1        | 4             | 1          |
| **Total** | **13** | **11** | **4** |

---

## Open decisions resolved:
- **Waitlist timer**: Configurable per-org via `waitlist_promotion_hours` on the event (defaulting to 24). Admins set this globally from Events settings.
- **Membership tiers**: Member vs Guest only (single tier model).
- **Time storage**: `start_time` and `end_time` as TIMESTAMPTZ (no separate date + timetz).
