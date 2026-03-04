# Dynamic Scheduling — Implementation Plan

## Decisions Summary

| # | Decision | Answer |
|---|----------|--------|
| 1 | Missing day-of-week rules | = closed that day |
| 2 | `bookable_window_days` scope | Org-level (on `organizations` table) |
| 3 | `booking_slots` for dynamic | No junction rows — dynamic bookings self-describing |
| 4 | `booking_source` column | Skip — org is one mode or the other |
| 5 | Availability engine location | TypeScript app-side (3 queries + compute) |
| 6 | Buffers around block-outs | No — admin controls exact times |
| 7 | Consolidation algorithm | Greedy: most-booked facility first |
| 8 | Grouped facility rules | Must match (validated) |
| 9 | Customer widget | New `DynamicAvailabilityWidget` component |
| 10 | Duration selection UX | Chip/pill buttons |
| 11 | Admin nav for dynamic | Conditionally swap schedule section + toast directing to settings |
| 12 | Mode switching | Allow; warn slot-based schedules ignored. Old data stays intact on switch-back |
| 13 | Chat tools | Branch inside existing tools based on `scheduling_type` |
| 14 | All tables in Phase 1 migration | Yes (include facility_groups + block_outs tables upfront) |
| 15 | Pricing tiers | Single rate per bay for now; time-of-day tiers in Phase 4 |
| 16 | Dynamic booking creation | New Postgres RPC `create_dynamic_booking` with row locking |
| 17 | Facility group display to customer | Just the assigned facility name |

---

## Phase 1: Database Migration + Org Mode Toggle + Dynamic Rules CRUD

### Step 1.1 — SQL Migration

Create `supabase/migrations/00030_dynamic_scheduling.sql` with:

**A. `scheduling_type` enum + org columns:**
```sql
-- Add scheduling_type to organizations
ALTER TABLE organizations
  ADD COLUMN scheduling_type text NOT NULL DEFAULT 'slot_based'
    CHECK (scheduling_type IN ('slot_based', 'dynamic')),
  ADD COLUMN bookable_window_days integer NOT NULL DEFAULT 30;
```

**B. `dynamic_schedule_rules` table:**
```sql
CREATE TABLE dynamic_schedule_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day_of_week integer NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  open_time time NOT NULL,
  close_time time NOT NULL,
  available_durations integer[] NOT NULL, -- e.g. {30,60,90,120}
  buffer_minutes integer NOT NULL DEFAULT 0,
  start_time_granularity integer NOT NULL DEFAULT 30
    CHECK (start_time_granularity IN (15, 30, 60)),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (bay_id, day_of_week),
  CHECK (close_time > open_time)
);
```

**C. `facility_groups` table:**
```sql
CREATE TABLE facility_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

**D. `facility_group_members` table:**
```sql
CREATE TABLE facility_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES facility_groups(id) ON DELETE CASCADE,
  bay_id uuid NOT NULL REFERENCES bays(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bay_id) -- a bay can only belong to one group
);
```

**E. `schedule_block_outs` table:**
```sql
CREATE TABLE schedule_block_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time)
);
```

**F. RLS policies** for all new tables:
- Public read for `dynamic_schedule_rules`, `facility_groups`, `facility_group_members` (customers need to query availability)
- Public read for `schedule_block_outs` (availability engine needs them)
- Admin write via `is_org_admin(org_id)` for all new tables
- Super admin full access via `is_super_admin()`

**G. Indexes:**
- `dynamic_schedule_rules(bay_id, day_of_week)`
- `schedule_block_outs(bay_id, date)`
- `facility_group_members(group_id)`
- `facility_group_members(bay_id)`

### Step 1.2 — Admin Settings: Scheduling Mode Toggle

**File: `src/app/admin/settings/page.tsx`** (modify existing)

- Add a "Scheduling Mode" section to admin settings page
- Radio group or select: "Slot-Based Scheduling" / "Dynamic Scheduling"
- Description text explaining each mode
- Warning dialog on switch: "Switching modes won't delete existing schedules or bookings. Slot-based schedules will be ignored while in dynamic mode (and vice versa). Existing bookings remain valid."
- Server action to update `organizations.scheduling_type`

### Step 1.3 — Admin: Dynamic Schedule Rules CRUD

**File: `src/app/admin/schedule/rules/page.tsx`** (new)

Admin UI to configure dynamic rules per bay, per day of week:

- Bay selector (tabs or dropdown)
- 7-day grid/table showing rules for each day of week
- Per-day fields: open_time, close_time, available_durations (multi-select chips), buffer_minutes, start_time_granularity (select: 15/30/60)
- "Copy to all days" button for quick setup (most bays have same hours every day)
- "Copy from another bay" for quick multi-bay setup
- Add/remove days (missing = closed)
- Server actions: create/update/delete rules

### Step 1.4 — Admin Nav Conditional Rendering

**File: `src/app/admin/layout.tsx`** (modify)

- Fetch org `scheduling_type` in admin layout
- Pass to sidebar nav
- For dynamic orgs: show "Schedule Rules" link → `/admin/schedule/rules`, hide "Templates" link
- For slot-based orgs: show existing "Schedule" and "Templates" links, hide "Schedule Rules"

### Step 1.5 — Toast Notices on Schedule/Templates Pages

- On `/admin/schedule` page: if org is dynamic, show toast: "Your facility uses Dynamic Scheduling. Manage schedule rules in Settings → Schedule Rules." (with link)
- On `/admin/templates` page: if org is dynamic, show toast: same message
- On `/admin/schedule/rules` page: if org is slot-based, show toast: "Your facility uses Slot-Based Scheduling. Manage templates and publish schedules from the Schedule page."

---

## Phase 2: Availability Engine + Customer Booking Flow (Single Facility)

### Step 2.1 — Availability Calculation Engine

**File: `src/lib/availability-engine.ts`** (new)

TypeScript module with core functions:

```typescript
type AvailableSlot = {
  start_time: string;  // ISO timestamp
  end_time: string;    // ISO timestamp
  price_cents: number;
  bay_id: string;
  bay_name: string;
};

// Core function: get available start times for a single bay
function getAvailableTimesForBay(params: {
  bay: { id: string; name: string; hourly_rate_cents: number };
  rules: DynamicScheduleRule;  // rule for this bay + day of week
  date: string;                // YYYY-MM-DD
  duration: number;            // requested duration in minutes
  timezone: string;
  existingBookings: Array<{ start_time: string; end_time: string }>;
  blockOuts: Array<{ start_time: string; end_time: string }>;
}): AvailableSlot[];

// Group function: get pooled availability across a facility group
function getPooledAvailability(params: {
  bays: Array<{ id: string; name: string; hourly_rate_cents: number }>;
  rulesMap: Map<string, DynamicScheduleRule>;  // bay_id → rule
  date: string;
  duration: number;
  timezone: string;
  bookingsMap: Map<string, Booking[]>;  // bay_id → bookings
  blockOutsMap: Map<string, BlockOut[]>;  // bay_id → blockouts
}): AvailableSlot[];  // union of times, deduplicated

// Consolidation: pick which bay to assign from a group
function pickBayForBooking(params: {
  groupBayIds: string[];
  startTime: string;
  endTime: string;
  bookingsMap: Map<string, Booking[]>;
}): string;  // returns bay_id
```

**Algorithm for `getAvailableTimesForBay`:**
1. Parse open_time/close_time into timestamps for the given date + timezone
2. Generate candidate start times: from open_time, step by granularity, up to (close_time - duration)
3. For each candidate:
   a. Compute end = start + duration
   b. Check no overlap with any existing booking (apply buffer_minutes on both sides of bookings)
   c. Check no overlap with any block-out (no buffer applied)
   d. If clear, add to results with price = bay.hourly_rate_cents * (duration / 60)
4. Return sorted list of available slots

**Algorithm for `pickBayForBooking` (consolidation):**
1. For each bay in group, count existing bookings on that date
2. Sort bays by booking count descending (most-booked first)
3. Return first bay that has no overlap conflict with the requested time window (+ buffer)

### Step 2.2 — API Route for Dynamic Availability

**File: `src/app/api/availability/route.ts`** (new)

GET endpoint queried by the customer widget:
- Params: `org_id`, `date`, `duration`, `bay_id` (optional), `group_id` (optional)
- Fetches rules, bookings, block-outs
- Calls availability engine
- Returns JSON array of available time slots
- Respects `bookable_window_days` and `min_booking_lead_minutes`

### Step 2.3 — `create_dynamic_booking` Postgres RPC

**File: `supabase/migrations/00031_create_dynamic_booking.sql`**

```sql
CREATE OR REPLACE FUNCTION create_dynamic_booking(
  p_org_id uuid,
  p_customer_id uuid,
  p_bay_id uuid,
  p_date date,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_price_cents integer,
  p_notes text DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
  v_booking_id uuid;
  v_confirmation_code text;
  v_conflict_count integer;
BEGIN
  -- Lock existing bookings for this bay+date to prevent race conditions
  PERFORM id FROM bookings
    WHERE bay_id = p_bay_id
      AND date = p_date
      AND status = 'confirmed'
    FOR UPDATE;

  -- Check for overlapping bookings
  SELECT count(*) INTO v_conflict_count
    FROM bookings
    WHERE bay_id = p_bay_id
      AND date = p_date
      AND status = 'confirmed'
      AND start_time < p_end_time
      AND end_time > p_start_time;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Time slot is no longer available';
  END IF;

  -- Generate unique confirmation code (same logic as create_booking)
  -- ... confirmation code generation loop ...

  -- Insert booking
  INSERT INTO bookings (id, org_id, customer_id, bay_id, date,
                        start_time, end_time, total_price_cents,
                        status, confirmation_code, notes)
  VALUES (gen_random_uuid(), p_org_id, p_customer_id, p_bay_id, p_date,
          p_start_time, p_end_time, p_price_cents,
          'confirmed', v_confirmation_code, p_notes)
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'booking_id', v_booking_id,
    'confirmation_code', v_confirmation_code,
    'total_price_cents', p_price_cents,
    'start_time', p_start_time,
    'end_time', p_end_time
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Note: Buffer is NOT checked in the RPC — it's an availability display concern, not a hard constraint. The RPC only checks for actual overlap. This keeps the RPC simple and the buffer logic in one place (the engine).

### Step 2.4 — `DynamicAvailabilityWidget` Component

**File: `src/components/dynamic-availability-widget.tsx`** (new)

Customer-facing booking UI for dynamic orgs:

**Layout (Desktop):**
```
┌─────────────────────────────────────────────┐
│  [Facility Group / Bay selector]  (if mixed) │
│  [Date Picker]        [Duration Chips]       │
│─────────────────────────────────────────────│
│  Available Times:                            │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐       │
│  │ 9:00 │ │ 9:30 │ │10:00 │ │10:30 │ ...   │
│  │ $40  │ │ $40  │ │ $40  │ │ $40  │       │
│  └──────┘ └──────┘ └──────┘ └──────┘       │
│                                              │
│  ┌──────────────────────────────────────┐   │
│  │ Fixed CTA bar: "Book 10:00 AM - ... │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**Flow:**
1. If org has mixed facilities (groups + standalone): show facility/group selector first
2. If all facilities are in one group: skip selector, go straight to date/duration
3. Date picker (same calendar style as existing widget)
4. Duration chips: e.g., "30 min", "1 hr", "1.5 hr", "2 hr"
5. Available time grid: time buttons with price
6. Select a time → CTA bar appears at bottom
7. CTA bar → inline booking panel (same auth/confirm flow as existing widget)

**Props:** Similar to `AvailabilityWidgetProps` but with:
- `schedulingType: 'dynamic'`
- `facilityGroups: FacilityGroup[]`
- `standaloneBays: Bay[]`
- `availableDurations` (from first bay's rules, or passed from server)

### Step 2.5 — Home Page Conditional Rendering

**File: `src/app/page.tsx`** (modify)

- Fetch `scheduling_type` from org
- If `'slot_based'`: render existing `<AvailabilityWidget />`
- If `'dynamic'`: fetch facility groups + standalone bays, render `<DynamicAvailabilityWidget />`

---

## Phase 3: Facility Groups + Interchangeability + Pooled Availability

### Step 3.1 — Admin: Facility Groups CRUD

**File: `src/app/admin/bays/groups/page.tsx`** (new)

- List existing groups
- Create group: name, description
- Assign bays to groups (drag or multi-select)
- Validation: all bays in a group must have matching `dynamic_schedule_rules` (show error if mismatch)
- Remove bay from group
- Delete group (ungroups bays, doesn't delete them)

### Step 3.2 — Pooled Availability in Engine

Extend `src/lib/availability-engine.ts`:
- `getPooledAvailability()` runs per-bay calculation for each group member, unions results
- Deduplicate times (same start time available on multiple bays → show once)
- Return includes which bays are available per time (for consolidation at booking time)

### Step 3.3 — Auto-Assignment at Booking Time

Extend the dynamic booking flow:
- When customer books a time from a pooled group, call `pickBayForBooking()` consolidation
- Pass the assigned `bay_id` to `create_dynamic_booking` RPC
- Show assigned bay name on confirmation

### Step 3.4 — Availability API: Group Support

Extend `src/app/api/availability/route.ts`:
- Accept `group_id` parameter
- Fetch group members, run pooled availability
- Return unified time list

---

## Phase 4: Block-Outs + Admin Rate Overrides + Edge Cases

### Step 4.1 — Admin: Block-Out Management

**File: `src/app/admin/schedule/block-outs/page.tsx`** (new)

- Calendar view showing existing block-outs
- Create block-out: select bay(s), date, start_time, end_time, optional reason
- Edit/delete existing block-outs
- Block-outs visible on admin daily schedule view

### Step 4.2 — Admin: Daily Rate Overrides

**New table (migration):**
```sql
CREATE TABLE dynamic_rate_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bay_id uuid NOT NULL REFERENCES bays(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hourly_rate_cents integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (bay_id, date, start_time)
);
```

- Admin UI to set rate overrides for specific date/time ranges
- Availability engine checks overrides before falling back to bay hourly rate
- Price displayed to customer reflects the override

### Step 4.3 — Time-of-Day Rate Tiers (Optional Enhancement)

Add to `dynamic_schedule_rules`:
```sql
ALTER TABLE dynamic_schedule_rules
  ADD COLUMN rate_tiers jsonb;
-- Format: [{"start_time": "09:00", "end_time": "17:00", "hourly_rate_cents": 4000},
--          {"start_time": "17:00", "end_time": "21:00", "hourly_rate_cents": 6000}]
```

- If `rate_tiers` is null, use bay's `hourly_rate_cents`
- If set, booking's start_time determines which tier applies to entire duration
- Admin UI: tiered rate editor within rules config

### Step 4.4 — Edge Case Handling

- Validate duration doesn't exceed remaining operating hours
- Handle timezone edge cases (DST transitions)
- Handle fully-booked groups gracefully (show "No availability" message)
- Min booking lead time check in availability engine

---

## Phase 5: AI Chat Integration + Polish

### Step 5.1 — Chat Tool: `get_available_slots` Branching

**File: `src/app/api/chat/route.ts`** (modify)

Inside `get_available_slots` tool handler:
- Fetch org `scheduling_type`
- If `'slot_based'`: existing query logic (unchanged)
- If `'dynamic'`: call availability engine with date + duration params
- Gemini needs to ask for duration (new required param for dynamic orgs)
- Update system prompt to explain dynamic scheduling context when applicable

### Step 5.2 — Chat Tool: `create_booking` Branching

- If `'slot_based'`: existing logic (slot_ids)
- If `'dynamic'`: call `create_dynamic_booking` RPC with start_time, end_time, bay_id, price
- Handle facility group auto-assignment in chat flow

### Step 5.3 — UX Polish

- Loading states for availability fetching
- Empty states ("No times available for this duration")
- Responsive mobile layout for dynamic widget
- Smooth transitions between facility/date/duration/time selection steps
- Error handling: stale availability (slot taken between view and book)
- Refresh availability on focus/visibility change

---

## Files to Create (New)

| File | Phase | Purpose |
|------|-------|---------|
| `supabase/migrations/00030_dynamic_scheduling.sql` | 1 | All new tables + org columns |
| `src/app/admin/schedule/rules/page.tsx` | 1 | Dynamic rules CRUD |
| `src/lib/availability-engine.ts` | 2 | Core availability calculation |
| `src/app/api/availability/route.ts` | 2 | API endpoint for dynamic availability |
| `supabase/migrations/00031_create_dynamic_booking.sql` | 2 | Dynamic booking RPC |
| `src/components/dynamic-availability-widget.tsx` | 2 | Customer booking widget |
| `src/app/admin/bays/groups/page.tsx` | 3 | Facility groups CRUD |
| `src/app/admin/schedule/block-outs/page.tsx` | 4 | Block-out management |
| `supabase/migrations/00032_dynamic_rate_overrides.sql` | 4 | Rate override table |

## Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `src/app/admin/settings/page.tsx` | 1 | Add scheduling mode toggle |
| `src/app/admin/layout.tsx` | 1 | Conditional nav links |
| `src/app/admin/schedule/page.tsx` | 1 | Toast for dynamic orgs |
| `src/app/admin/templates/page.tsx` | 1 | Toast for dynamic orgs |
| `src/app/page.tsx` | 2 | Conditional widget rendering |
| `src/app/api/chat/route.ts` | 5 | Branch tools by scheduling_type |
