# CLAUDE.md

## Environment

- There is no `gh` CLI available in this environment. Do not attempt to use it.
- When creating pull requests or merge links, always provide the user with a direct GitHub URL instead (e.g., `https://github.com/oompvision/PlayBook/pull/new/<branch-name>`).

## Project Overview

PlayBook is a multi-tenant bay/resource booking platform. Facilities (golf simulators, tennis courts, etc.) get their own subdomain (e.g., `aceindoor.ezbooker.app`). Customers browse availability and book time slots. Admins manage schedules, bays, and bookings. A super-admin manages all organizations.

## Tech Stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript 5.9
- **Styling**: Tailwind CSS v4, shadcn/ui components (Radix primitives + CVA)
- **Database**: Supabase (PostgreSQL) with Row Level Security
- **Auth**: Supabase Auth (email/password), session managed via middleware cookies
- **AI Chat**: Google Gemini 2.5 Flash (`@google/genai`) — booking assistant with tool use
- **Icons**: lucide-react
- **Font**: Geist (sans + mono)

## Folder Structure

```
src/
├── app/                        # Next.js App Router pages
│   ├── layout.tsx              # Root layout (Geist font, global styles)
│   ├── page.tsx                # Landing / facility home page
│   ├── auth/
│   │   ├── login/page.tsx      # Email/password login (client component)
│   │   ├── signup/page.tsx     # Registration
│   │   ├── callback/route.ts   # OAuth code exchange
│   │   └── signout/route.ts    # POST → sign out + redirect
│   ├── book/
│   │   └── confirm/page.tsx    # Booking confirmation (processes slot_ids)
│   ├── my-bookings/page.tsx    # Customer's booking history
│   ├── admin/                  # Facility admin dashboard (requires facility context)
│   │   ├── layout.tsx          # Admin sidebar nav, auth gate
│   │   ├── page.tsx            # Dashboard overview
│   │   ├── bays/               # Bay CRUD
│   │   ├── schedule/           # Schedule management + day view
│   │   │   ├── page.tsx        # Publish schedules from templates
│   │   │   └── day/page.tsx    # Daily timeline view (DailySchedule component)
│   │   ├── templates/          # Schedule template CRUD
│   │   ├── bookings/           # View/manage bookings
│   │   ├── customers/          # Customer list
│   │   ├── revenue/            # Revenue reporting
│   │   └── settings/           # Org settings
│   ├── super-admin/
│   │   ├── auth/login/         # Super admin login
│   │   ├── setup/              # First-time claim_super_admin
│   │   └── (dashboard)/        # Route group with sidebar layout
│   │       ├── orgs/           # Organization CRUD
│   │       │   └── [id]/enter/ # "Enter as Admin" flow (sets cookie)
│   │       ├── admins/         # Admin user management
│   │       └── settings/       # Platform settings
│   └── api/
│       ├── chat/route.ts       # AI chat endpoint (Gemini + tool loop)
│       └── admin/enter/[id]/   # Sets playbook-admin-org cookie, redirects to /admin
├── components/
│   ├── ui/                     # shadcn/ui primitives (button, input, card, badge, label)
│   ├── chat/
│   │   ├── chat-widget.tsx     # Main chat UI (messages, input, quick replies)
│   │   ├── chat-message.tsx    # Message bubble + quick reply buttons + typing indicator
│   │   ├── chat-bubble.tsx     # Floating chat button (bottom-right, togglable)
│   │   └── chat-bubble-loader.tsx  # Server component: resolves facility → renders bubble
│   ├── daily-schedule.tsx      # Timeline grid for admin bookings view
│   ├── submit-button.tsx       # Form submit button with loading state
│   └── sign-out-button.tsx     # Sign out form button
└── lib/
    ├── auth.ts                 # getAuthUser, requireAuth, requireAdmin, requireSuperAdmin, ensureCustomerOrg
    ├── facility.ts             # getFacilitySlug() — reads x-facility-slug header or cookie
    ├── utils.ts                # cn(), toTimestamp(), getTodayInTimezone(), formatTimeInZone()
    └── supabase/
        ├── server.ts           # createClient() for server components/routes
        ├── client.ts           # createClient() for client components (browser)
        └── middleware.ts       # updateSession() — refreshes Supabase auth cookies
```

## Multi-Tenancy / Facility Resolution

- **Subdomain routing**: `slug.ezbooker.app` → middleware extracts slug via `x-facility-slug` header
- **Dev fallback**: `?facility=slug` query param → persisted as `playbook-facility` cookie (8h)
- **Super admin "Enter as Admin"**: `/api/admin/enter/[id]` sets `playbook-admin-org` cookie
- **Resolution order** in `getFacilitySlug()`: header → `playbook-facility` cookie → `playbook-admin-org` cookie
- **Platform hosts**: `ezbooker.app`, `playbook.com`, `localhost`, `127.0.0.1`
- **Reserved subdomains**: `www`, `admin`, `api`

## Authentication

- **Method**: Supabase Auth with email/password (`signInWithPassword`, `signUp`)
- **Session**: Managed via `@supabase/ssr` cookie-based sessions; middleware calls `supabase.auth.getUser()` to refresh
- **Profile creation**: Trigger `handle_new_user()` auto-creates a `profiles` row on signup
- **Roles**: `super_admin`, `admin`, `customer` (stored in `profiles.role`)
- **Auth helpers** (`src/lib/auth.ts`):
  - `getAuthUser()` — returns user + profile (via `get_my_profile` RPC to bypass RLS)
  - `requireAuth()` — redirects to `/auth/login` if unauthenticated
  - `requireAdmin(orgId?)` — requires admin or super_admin role
  - `requireSuperAdmin()` — requires super_admin role
  - `ensureCustomerOrg(orgId)` — links customer to org on first visit

## Database Schema

### Tables

| Table | Purpose | Key Columns |
|-------|---------|------------|
| `organizations` | Tenant/facility | slug (unique), timezone, name, address, phone |
| `profiles` | User profiles (linked to auth.users) | org_id, email, role, full_name |
| `bays` | Bookable resources per org | org_id, name, resource_type, hourly_rate_cents, sort_order, is_active |
| `schedule_templates` | Reusable schedule patterns | org_id, name |
| `template_slots` | Time slots within a template | template_id, start_time (time), end_time (time), price_cents |
| `bay_schedules` | Published schedule for a bay+date | bay_id, org_id, date (unique per bay+date) |
| `bay_schedule_slots` | Individual bookable slots | bay_schedule_id, org_id, start_time (timestamptz), end_time, price_cents, status (available/booked/blocked) |
| `bookings` | Customer bookings | org_id, customer_id, bay_id, date, start_time, end_time, total_price_cents, status (confirmed/cancelled), confirmation_code (unique, PB-XXXXXX) |
| `booking_slots` | Junction: booking ↔ bay_schedule_slot | booking_id, bay_schedule_slot_id (unique — each slot can only belong to one booking) |

### Key RPC Functions

| Function | Purpose |
|----------|---------|
| `create_booking(p_org_id, p_customer_id, p_bay_id, p_date, p_slot_ids, p_notes)` | Atomic booking with row locking (SELECT FOR UPDATE). Groups non-consecutive slots into separate bookings. Returns JSON with confirmation_code, pricing, times. |
| `cancel_booking(p_booking_id)` | Cancels booking, reverts slots to 'available' |
| `get_my_profile()` | Returns current user's profile (SECURITY DEFINER, bypasses RLS) |
| `claim_super_admin()` | First user can claim super_admin role |
| `is_super_admin()` / `is_org_admin(org_id)` | RLS helper functions (SECURITY DEFINER) |

### RLS Pattern

- Public read for: organizations, bay_schedules, bay_schedule_slots, active bays
- Self-read/write for: profiles, bookings
- Admin scoped via `is_org_admin(org_id)` for: all tables within their org
- Super admin full access via `is_super_admin()` on all tables

## AI Chat Assistant (`/api/chat`)

### Architecture
- **Model**: Gemini 2.5 Flash via `@google/genai`
- **Pattern**: Server-side tool execution loop (up to 5 rounds)
- **Streaming**: Simulated — full response chunked into 3-word pieces via ReadableStream
- **Auth**: Reads current user session; passes auth context to Gemini system prompt

### Gemini Tools

| Tool | Auth Required | Purpose |
|------|:---:|---------|
| `get_facility_info` | No | Facility details, bays, pricing |
| `get_available_slots` | No | Available time slots by date/bay/type |
| `get_my_bookings` | Yes | Customer's bookings with confirmation codes |
| `create_booking` | Yes | Book slots — accepts `slot_ids` OR `date + bay_name + start_time` fallback |
| `cancel_booking` | Yes | Cancel by confirmation code |
| `suggest_quick_replies` | N/A | Returns clickable button options to the UI (captured server-side, not sent back to Gemini) |

### Quick Replies Protocol
- `suggest_quick_replies` tool is intercepted by the server (not treated as a real tool call)
- Quick reply options appended to response stream as: `\n\n<<QUICK_REPLIES>>\n["opt1","opt2"]`
- Client strips delimiter during streaming, parses JSON, renders buttons on last model message
- Clicking a button sends its text as a new user message

### Booking via Chat — Slot Resolution
- `create_booking` accepts EITHER `slot_ids` (from get_available_slots) OR human-friendly `date + bay_name + start_time`
- Fallback path: looks up bay by name → gets bay_schedule → finds available slot matching formatted start_time
- This handles the case where tool call context (slot_ids) is lost between stateless API requests

## Customer Booking Flow

**IMPORTANT**: All availability browsing and slot selection starts on the **facility home page** (`/`).

- **Desktop**: `AvailabilityWidget` component (`src/components/availability-widget.tsx`) — embedded in the home page, shows bay sidebar + date picker + slot list with inline selection
- **Mobile**: `ChatWidget` — AI booking assistant embedded in the home page
- **Confirmation**: `/book/confirm` — the ONLY route under `/book/`. Receives selected slot IDs via query params, shows summary, and processes the booking.
- **There is NO `/book` or `/book/[date]` route.** Those were removed. Do not create or link to them.
- When a user selects slots on the home page, the `AvailabilityWidget` navigates to `/book/confirm?date=...&bay=...&slots_BAYID=...`
- All "back" links from `/book/confirm` go to `/` (the home page)
- The booking CTA bar ("N slots selected — Continue to Book") uses a `createPortal` fixed overlay at the bottom of the viewport so it's always visible regardless of scroll position

## Conventions

- **Server components by default**, `"use client"` only when needed (forms, interactivity)
- **Server actions** for mutations (forms post to async functions)
- **Supabase clients**: `server.ts` for server components/API routes, `client.ts` for browser
- **Timezone-aware**: All times stored as timestamptz; displayed via facility timezone using `Intl.DateTimeFormat`
- **Price in cents**: All prices stored as integers (cents), formatted as `$XX.XX` for display
- **shadcn/ui pattern**: Components in `src/components/ui/`, composed with `cn()` utility
- **No ORM**: Direct Supabase query builder (`.from().select().eq()`)
- **Confirmation codes**: Format `PB-XXXXXX` (alphanumeric, excludes ambiguous chars 0/I/O)
- **Environment variables**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GEMINI_API_KEY`

## Deployment

- **Database migrations**: The user does not have direct CLI access to run Supabase migrations. When a new SQL migration is added, always provide the full SQL query in the chat so the user can run it manually in the Supabase SQL Editor.
