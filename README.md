# PlayBook

Multi-tenant sports facility booking platform. Book simulator bays, tennis courts, batting cages, and more.

## Tech Stack

- **Frontend**: Next.js 16 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Supabase (PostgreSQL, Auth, RLS)
- **Hosting**: Vercel

## Getting Started

1. Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials
2. Install dependencies: `npm install`
3. Run the dev server: `npm run dev`
4. Open [http://localhost:3000](http://localhost:3000)

## Project Structure

```
src/
  app/
    page.tsx                    # Facility landing page
    book/                       # Customer booking flow
    my-bookings/                # Customer booking history
    auth/                       # Login / signup
    admin/                      # Facility admin dashboard
    super-admin/                # Platform super admin
  lib/
    supabase/                   # Supabase client utilities
    facility.ts                 # Facility slug helper
  middleware.ts                 # Subdomain routing + auth
supabase/
  migrations/                   # Database schema (SQL)
  seed.sql                      # Demo data
```

## Database Migrations

Run the SQL files in `supabase/migrations/` in order against your Supabase project (via the SQL editor or `supabase db push`), then optionally run `supabase/seed.sql` for demo data.
