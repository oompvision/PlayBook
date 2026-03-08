import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth-context';
import { useFacility } from './facility-context';
import type { MembershipTier, UserMembership } from '../types';

interface MembershipState {
  /** The org's membership tier (null if tiers not enabled or not configured) */
  tier: MembershipTier | null;
  /** The current user's membership (null if not a member) */
  membership: UserMembership | null;
  /** Whether the user has an active membership */
  isMember: boolean;
  /** Effective bookable window in days for this user */
  bookableWindowDays: number;
  /** Whether the org has membership tiers enabled */
  membershipEnabled: boolean;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useMembership(): MembershipState {
  const { user } = useAuth();
  const { organization } = useFacility();

  const [tier, setTier] = useState<MembershipTier | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [bookableWindowDays, setBookableWindowDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);

  const orgId = organization?.id ?? null;
  const membershipEnabled = organization?.membership_tiers_enabled ?? false;

  const fetchMembership = useCallback(async () => {
    if (!orgId) {
      setTier(null);
      setMembership(null);
      setBookableWindowDays(organization?.bookable_window_days ?? 30);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    console.log('[useMembership] fetching for org:', orgId, 'user:', user?.id, 'membershipEnabled:', membershipEnabled);
    console.log('[useMembership] org fields:', {
      bookable_window_days: organization?.bookable_window_days,
      membership_tiers_enabled: organization?.membership_tiers_enabled,
      guest_booking_window_days: organization?.guest_booking_window_days,
      member_booking_window_days: organization?.member_booking_window_days,
    });

    // Always fetch the effective bookable window (works for both member and guest)
    const { data: windowData, error: windowError } = await supabase.rpc('get_effective_bookable_window', {
      p_org_id: orgId,
      p_user_id: user?.id ?? null,
    });

    console.log('[useMembership] RPC result:', { windowData, windowError: windowError?.message, type: typeof windowData });

    if (typeof windowData === 'number') {
      setBookableWindowDays(windowData);
    } else {
      setBookableWindowDays(organization?.bookable_window_days ?? 30);
    }

    // If membership tiers are not enabled, skip tier/membership fetch
    if (!membershipEnabled) {
      setTier(null);
      setMembership(null);
      setIsLoading(false);
      return;
    }

    // Fetch the org's membership tier
    const { data: tierData } = await supabase
      .from('membership_tiers')
      .select('*')
      .eq('org_id', orgId)
      .single();

    setTier((tierData as MembershipTier) ?? null);

    // Fetch the user's membership if logged in
    if (user) {
      const { data: membershipData } = await supabase
        .from('user_memberships')
        .select('*, membership_tiers(*)')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .single();

      setMembership((membershipData as UserMembership) ?? null);
    } else {
      setMembership(null);
    }

    setIsLoading(false);
  }, [orgId, user?.id, membershipEnabled]);

  useEffect(() => {
    fetchMembership();
  }, [fetchMembership]);

  // Determine if user is actively a member
  const isMember = (() => {
    if (!membership) return false;
    const now = new Date();
    if (membership.status === 'active') {
      return !membership.current_period_end || new Date(membership.current_period_end) > now;
    }
    if (membership.status === 'admin_granted') {
      return !membership.expires_at || new Date(membership.expires_at) > now;
    }
    if (membership.status === 'cancelled') {
      return !!membership.current_period_end && new Date(membership.current_period_end) > now;
    }
    return false;
  })();

  return {
    tier,
    membership,
    isMember,
    bookableWindowDays,
    membershipEnabled,
    isLoading,
    refresh: fetchMembership,
  };
}
