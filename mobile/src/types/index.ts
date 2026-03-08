/**
 * Shared types matching the EZ Booker database schema.
 */

export interface Organization {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  min_booking_lead_minutes: number;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'customer' | 'admin' | 'super_admin';
  org_id: string | null;
}

export interface Bay {
  id: string;
  org_id: string;
  name: string;
  resource_type: string | null;
  hourly_rate_cents: number | null;
  sort_order: number;
  is_active: boolean;
}

export interface BaySchedule {
  id: string;
  bay_id: string;
  org_id: string;
  date: string;
}

export interface BayScheduleSlot {
  id: string;
  bay_schedule_id: string;
  org_id: string;
  start_time: string; // timestamptz
  end_time: string;
  price_cents: number;
  status: 'available' | 'booked' | 'blocked';
}

export interface Booking {
  id: string;
  org_id: string;
  customer_id: string;
  bay_id: string;
  date: string;
  start_time: string;
  end_time: string;
  total_price_cents: number;
  status: 'confirmed' | 'cancelled';
  confirmation_code: string;
  notes: string | null;
  created_at: string;
  // Joined fields
  bays?: Bay;
  organizations?: Organization;
}

export interface FacilityLocation {
  org: Organization;
  bays: Bay[];
}

export interface SlotGroup {
  bay: Bay;
  slots: BayScheduleSlot[];
  totalCents: number;
}
