import { useEffect, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { useAuth } from './auth-context';
import { useFacility } from './facility-context';
import type { MembershipTier, UserMembership } from '../types';

interface CreditBalance {
  has_credits: boolean;
  credits_total: number;
  credits_used: number;
  credits_remaining: number;
  credit_type: 'hours' | 'value' | null;
  credit_period: string | null;
  period_end: string | null;
}

interface MembershipState {
  /** All tiers for this org (sorted by sort_order) */
  tiers: MembershipTier[];
  /** The user's current tier (null if not a member) */
  tier: MembershipTier | null;
  /** The current user's membership (null if not a member) */
  membership: UserMembership | null;
  /** Whether the user has an active membership */
  isMember: boolean;
  /** Effective bookable window in days for this user */
  bookableWindowDays: number;
  /** Whether the org has membership tiers enabled */
  membershipEnabled: boolean;
  /** Credit balance for current period */
  creditBalance: CreditBalance | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function useMembership(): MembershipState {
  const { user } = useAuth();
  const { organization } = useFacility();

  const [tiers, setTiers] = useState<MembershipTier[]>([]);
  const [tier, setTier] = useState<MembershipTier | null>(null);
  const [membership, setMembership] = useState<UserMembership | null>(null);
  const [bookableWindowDays, setBookableWindowDays] = useState(30);
  const [creditBalance, setCreditBalance] = useState<CreditBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const orgId = organization?.id ?? null;
  const membershipEnabled = organization?.membership_tiers_enabled ?? false;

  const fetchMembership = useCallback(async () => {
    if (!orgId) {
      setTiers([]);
      setTier(null);
      setMembership(null);
      setCreditBalance(null);
      setBookableWindowDays(organization?.bookable_window_days ?? 30);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Always fetch the effective bookable window
    const { data: windowData } = await supabase.rpc('get_effective_bookable_window', {
      p_org_id: orgId,
      p_user_id: user?.id ?? null,
    });

    if (typeof windowData === 'number') {
      setBookableWindowDays(windowData);
    } else {
      setBookableWindowDays(organization?.bookable_window_days ?? 30);
    }

    // If membership tiers are not enabled, skip
    if (!membershipEnabled) {
      setTiers([]);
      setTier(null);
      setMembership(null);
      setCreditBalance(null);
      setIsLoading(false);
      return;
    }

    // Fetch all tiers for this org
    const { data: tierData } = await supabase
      .from('membership_tiers')
      .select('*')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: true });

    const allTiers = (tierData as MembershipTier[]) ?? [];
    setTiers(allTiers);

    // Fetch the user's membership if logged in
    if (user) {
      const { data: membershipData } = await supabase
        .from('user_memberships')
        .select('*, membership_tiers(*)')
        .eq('org_id', orgId)
        .eq('user_id', user.id)
        .single();

      const userMembership = (membershipData as UserMembership) ?? null;
      setMembership(userMembership);

      // Set the user's specific tier
      if (userMembership?.tier_id) {
        const userTier = allTiers.find((t) => t.id === userMembership.tier_id) ?? null;
        setTier(userTier);
      } else {
        setTier(allTiers[0] ?? null);
      }

      // Fetch credit balance
      if (userMembership) {
        const { data: creditData } = await supabase.rpc('get_or_create_credit_balance', {
          p_org_id: orgId,
          p_user_id: user.id,
        });
        setCreditBalance(creditData?.has_credits ? creditData : null);
      } else {
        setCreditBalance(null);
      }
    } else {
      setMembership(null);
      setTier(allTiers[0] ?? null);
      setCreditBalance(null);
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
    tiers,
    tier,
    membership,
    isMember,
    bookableWindowDays,
    membershipEnabled,
    creditBalance,
    isLoading,
    refresh: fetchMembership,
  };
}
