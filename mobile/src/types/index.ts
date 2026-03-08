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
  scheduling_type: 'slot_based' | 'dynamic';
  bookable_window_days: number | null;
  membership_tiers_enabled: boolean;
  guest_booking_window_days: number | null;
  member_booking_window_days: number | null;
}

export interface FacilityGroup {
  id: string;
  name: string;
  description: string | null;
  bays: Bay[];
}

export interface DynamicScheduleRule {
  id: string;
  bay_id: string;
  org_id: string;
  day_of_week: number;
  open_time: string;    // HH:MM:SS
  close_time: string;
  available_durations: number[];
  buffer_minutes: number;
  start_time_granularity: number;
  rate_tiers: Array<{ start_time: string; end_time: string; hourly_rate_cents: number }> | null;
}

export interface AvailableTimeSlot {
  bay_id: string;
  bay_name: string;
  start_time: string;  // ISO timestamp
  end_time: string;
  price_cents: number;
  duration_minutes: number;
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

export interface Location {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  is_active: boolean;
  is_default: boolean;
  created_at: string;
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

export interface FacilityEvent {
  id: string;
  name: string;
  description: string | null;
  start_time: string;
  end_time: string;
  capacity: number;
  price_cents: number;
  members_only: boolean;
  event_bays: Array<{
    bay_id: string;
    bays: { name: string } | { name: string }[];
  }>;
  // Computed client-side
  registered_count?: number;
}

export interface EventRegistration {
  id: string;
  event_id: string;
  org_id: string;
  status: 'confirmed' | 'waitlisted' | 'cancelled' | 'pending_payment';
  waitlist_position: number | null;
  payment_status: string | null;
  registered_at: string;
  cancelled_at: string | null;
  promoted_at: string | null;
  events: {
    name: string;
    description: string | null;
    start_time: string;
    end_time: string;
    price_cents: number;
    capacity: number;
    status: string;
    event_bays: Array<{
      bay_id: string;
      bays: { name: string } | { name: string }[];
    }>;
  } | null;
}

export interface MembershipTier {
  id: string;
  org_id: string;
  name: string;
  benefit_description: string | null;
  discount_type: 'flat' | 'percent';
  discount_value: number;
  price_monthly_cents: number | null;
  price_yearly_cents: number | null;
  created_at: string;
  updated_at: string;
}

export interface UserMembership {
  id: string;
  org_id: string;
  user_id: string;
  tier_id: string;
  status: 'active' | 'past_due' | 'cancelled' | 'admin_granted';
  source: 'stripe' | 'admin';
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  current_period_end: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  membership_tiers?: MembershipTier;
}
