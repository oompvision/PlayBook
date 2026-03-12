import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
  Modal,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { useMembership } from '../lib/use-membership';
import { supabase } from '../lib/supabase';
import { fetchDynamicAvailability, pickBayForGroupBooking } from '../lib/availability';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { formatPrice, formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { usePayment } from '../lib/use-payment';
import { colors, spacing, typography, borderRadius, shadows } from '../theme';
import { PressableScale } from '../components/PressableScale';
import type { MainTabParamList, ModifyBookingParams } from '../navigation/types';
import type { Bay, BayScheduleSlot, FacilityGroup, AvailableTimeSlot, FacilityEvent } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Book'>;

interface SlotWithSchedule extends BayScheduleSlot {
  bay_schedule_id: string;
}

// A "bookable option" is either a facility group or a standalone bay
type BookableOption =
  | { type: 'group'; group: FacilityGroup }
  | { type: 'bay'; bay: Bay };

type TimePeriod = 'morning' | 'midday' | 'evening';

function getTimePeriod(timestamp: string, timezone: string): TimePeriod {
  const hour = new Date(timestamp).toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const h = parseInt(hour, 10);
  if (h < 12) return 'morning';
  if (h < 17) return 'midday';
  return 'evening';
}

const timePeriodLabels: Record<TimePeriod, { label: string }> = {
  morning: { label: 'Morning' },
  midday: { label: 'Midday' },
  evening: { label: 'Evening' },
};

function groupSlotsByTimePeriod<T extends { start_time: string }>(
  items: T[],
  timezone: string
): { period: TimePeriod; items: T[] }[] {
  const buckets: Record<TimePeriod, T[]> = { morning: [], midday: [], evening: [] };
  for (const item of items) {
    buckets[getTimePeriod(item.start_time, timezone)].push(item);
  }
  const order: TimePeriod[] = ['morning', 'midday', 'evening'];
  return order
    .filter((p) => buckets[p].length > 0)
    .map((p) => ({ period: p, items: buckets[p] }));
}

export function BookingScreen({ route, navigation }: Props) {
  const {
    organization,
    selectedLocation,
    bays,
    facilityGroups,
    standaloneBays,
    isDynamic,
    availableDurations,
  } = useFacility();
  const { user, profile } = useAuth();
  const { bookableWindowDays, isMember, tier, membershipEnabled } = useMembership();
  const { collectPayment, recordPayment, isProcessing: paymentProcessing } = usePayment();

  // Modify mode
  const modifyBooking: ModifyBookingParams | undefined = (route.params as any)?.modifyBooking;
  const isModifyMode = !!modifyBooking;

  // Set dynamic header title based on mode and selected location
  useEffect(() => {
    if (isModifyMode) {
      navigation.setOptions({ title: 'Modify Booking' });
    } else if (selectedLocation) {
      navigation.setOptions({ title: `Book for ${selectedLocation.name}` });
    }
  }, [navigation, selectedLocation, isModifyMode]);

  const initialDate = modifyBooking?.date || (route.params as any)?.date;
  const initialBayId = modifyBooking?.bayId || (route.params as any)?.bayId;

  const [selectedDate, setSelectedDate] = useState<string>(
    initialDate || (organization ? getTodayInTimezone(organization.timezone) : '')
  );

  // Slot-based state
  const [selectedBay, setSelectedBay] = useState<Bay | null>(
    initialBayId ? bays.find((b) => b.id === initialBayId) || null : null
  );

  // Sync date and bay when nav params change (tab is persistent, not remounted)
  useEffect(() => {
    if (isModifyMode) return;
    const paramDate = (route.params as any)?.date;
    const paramBayId = (route.params as any)?.bayId;
    if (paramDate) setSelectedDate(paramDate);
    if (paramBayId && !isDynamic) {
      const bay = bays.find((b) => b.id === paramBayId) || null;
      if (bay) setSelectedBay(bay);
    }
  }, [route.params]);

  // Dynamic scheduling state
  const [selectedOption, setSelectedOption] = useState<BookableOption | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(
    availableDurations[0] || 60
  );
  const [dynamicSlots, setDynamicSlots] = useState<AvailableTimeSlot[]>([]);
  const [selectedDynamicSlot, setSelectedDynamicSlot] = useState<AvailableTimeSlot | null>(null);

  // Slot-based state
  const [slots, setSlots] = useState<SlotWithSchedule[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());

  // Event state
  const [dateEvents, setDateEvents] = useState<(FacilityEvent & { registered_count: number; bay_names: string[] })[]>([]);
  const [userEventRegMap, setUserEventRegMap] = useState<Record<string, string>>({});
  const [selectedEvent, setSelectedEvent] = useState<(FacilityEvent & { registered_count: number; bay_names: string[] }) | null>(null);
  const [eventConfirmStep, setEventConfirmStep] = useState(false);
  const [registeringEvent, setRegisteringEvent] = useState(false);

  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [notes, setNotes] = useState(modifyBooking?.notes ?? '');
  const [showConfirm, setShowConfirm] = useState(false);

  // Bottom sheet wizard steps: summary → processing → success
  type BookingStep = 'summary' | 'processing' | 'success';
  const [bookingStep, setBookingStep] = useState<BookingStep>('summary');
  const [successCode, setSuccessCode] = useState<string | null>(null);
  const [successOldCode, setSuccessOldCode] = useState<string | null>(null);
  const [successBookingId, setSuccessBookingId] = useState<string | null>(null);

  // Payment info for modify mode
  const [modifyPaymentMode, setModifyPaymentMode] = useState<string>('none');
  const [modifyCardBrand, setModifyCardBrand] = useState<string | null>(null);
  const [modifyCardLast4, setModifyCardLast4] = useState<string | null>(null);

  // Cancellation policy state (for all booking flows)
  const [cancellationWindowHours, setCancellationWindowHours] = useState<number | null>(null);
  const [cancellationPolicyText, setCancellationPolicyText] = useState<string | null>(null);
  const [orgPaymentMode, setOrgPaymentMode] = useState<string>('none');
  const [showPolicyModal, setShowPolicyModal] = useState(false);

  // Fetch payment mode and old booking's card details when entering modify mode
  useEffect(() => {
    if (!isModifyMode || !modifyBooking || !organization) return;
    let cancelled = false;

    (async () => {
      // 1. Get payment mode for this org
      const { data: settings } = await supabase
        .from('org_payment_settings')
        .select('payment_mode, stripe_onboarding_complete')
        .eq('org_id', organization.id)
        .single();

      if (cancelled) return;

      if (!settings || settings.payment_mode === 'none' || !settings.stripe_onboarding_complete) {
        setModifyPaymentMode('none');
        return;
      }
      setModifyPaymentMode(settings.payment_mode);

      // 2. Try to get card brand/last4 via mobile API
      const apiUrl = process.env.EXPO_PUBLIC_API_URL;
      if (!apiUrl) return;

      const { data: oldPayment } = await supabase
        .from('booking_payments')
        .select('stripe_payment_method_id')
        .eq('booking_id', modifyBooking.id)
        .single();

      if (cancelled || !oldPayment?.stripe_payment_method_id) return;

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || cancelled) return;

        const res = await fetch(
          `${apiUrl}/api/stripe/card-details?pm=${oldPayment.stripe_payment_method_id}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } }
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) {
            setModifyCardBrand(data.brand || null);
            setModifyCardLast4(data.last4 || null);
          }
        }
      } catch {
        // Non-critical — summary will show without card details
      }
    })();

    return () => { cancelled = true; };
  }, [isModifyMode, modifyBooking?.id, organization?.id]);

  // Fetch cancellation policy and window hours for all booking flows
  useEffect(() => {
    if (!organization) return;
    let cancelled = false;

    (async () => {
      const { data: settings } = await supabase
        .from('org_payment_settings')
        .select('payment_mode, stripe_onboarding_complete, cancellation_window_hours, cancellation_policy_text')
        .eq('org_id', organization.id)
        .single();

      if (cancelled) return;

      if (!settings || settings.payment_mode === 'none' || !settings.stripe_onboarding_complete) {
        setOrgPaymentMode('none');
        setCancellationWindowHours(null);
        setCancellationPolicyText(null);
        return;
      }

      setOrgPaymentMode(settings.payment_mode);
      setCancellationWindowHours(settings.cancellation_window_hours ?? 24);
      setCancellationPolicyText(settings.cancellation_policy_text || null);
    })();

    return () => { cancelled = true; };
  }, [organization?.id]);

  // Build bookable options for dynamic scheduling
  const bookableOptions: BookableOption[] = React.useMemo(() => {
    if (!isDynamic) return [];
    const opts: BookableOption[] = [];
    for (const g of facilityGroups) {
      opts.push({ type: 'group', group: g });
    }
    for (const b of standaloneBays) {
      opts.push({ type: 'bay', bay: b });
    }
    return opts;
  }, [isDynamic, facilityGroups, standaloneBays]);

  // Auto-select facility group/bay from nav params, or first option
  useEffect(() => {
    if (!isDynamic || bookableOptions.length === 0) return;
    const paramGroupId = (route.params as any)?.facilityGroupId;
    const paramBayId = modifyBooking?.bayId || (route.params as any)?.bayId;
    if (paramGroupId) {
      const match = bookableOptions.find(
        (o) => o.type === 'group' && o.group.id === paramGroupId
      );
      if (match) {
        setSelectedOption(match);
        return;
      }
    }
    if (paramBayId) {
      const match = bookableOptions.find(
        (o) => o.type === 'bay' && o.bay.id === paramBayId
      );
      if (match) {
        setSelectedOption(match);
        return;
      }
    }
    if (!selectedOption) {
      setSelectedOption(bookableOptions[0]);
    }
  }, [isDynamic, bookableOptions, route.params]);

  // Update selected duration when available durations change
  useEffect(() => {
    if (availableDurations.length > 0 && !availableDurations.includes(selectedDuration)) {
      setSelectedDuration(availableDurations[0]);
    }
  }, [availableDurations]);

  // Generate date options based on effective bookable window (membership-aware)
  console.log('[BookingScreen] bookableWindowDays:', bookableWindowDays);
  const dateOptions = React.useMemo(() => {
    if (!organization) return [];
    console.log('[BookingScreen] computing dateOptions with window:', bookableWindowDays);
    const dates: string[] = [];
    const now = new Date();
    for (let i = 0; i < bookableWindowDays; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(
        new Intl.DateTimeFormat('en-CA', {
          timeZone: organization.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(d)
      );
    }
    return dates;
  }, [organization, bookableWindowDays]);

  useEffect(() => {
    if (!selectedDate && dateOptions.length > 0) {
      setSelectedDate(dateOptions[0]);
    }
  }, [dateOptions, selectedDate]);

  // ─── Slot-based availability fetch ─────────────────────
  const fetchSlotBasedSlots = useCallback(async () => {
    if (!organization || !selectedLocation || !selectedBay || !selectedDate) return;

    setLoading(true);
    setSelectedSlotIds(new Set());

    const { data } = await supabase
      .from('bay_schedule_slots')
      .select('*, bay_schedules!inner(bay_id, date)')
      .eq('org_id', organization.id)
      .eq('location_id', selectedLocation.id)
      .eq('bay_schedules.bay_id', selectedBay.id)
      .eq('bay_schedules.date', selectedDate)
      .eq('status', 'available')
      .order('start_time');

    setSlots((data as unknown as SlotWithSchedule[]) || []);
    setLoading(false);
  }, [organization, selectedLocation, selectedBay, selectedDate]);

  // ─── Dynamic availability fetch ────────────────────────
  const fetchDynamicSlots = useCallback(async () => {
    if (!organization || !selectedOption || !selectedDate) return;

    setLoading(true);
    setSelectedDynamicSlot(null);

    const bayIds =
      selectedOption.type === 'group'
        ? selectedOption.group.bays.map((b) => b.id)
        : [selectedOption.bay.id];

    const result = await fetchDynamicAvailability({
      orgId: organization.id,
      bayIds,
      date: selectedDate,
      duration: selectedDuration,
      timezone: organization.timezone,
      minBookingLeadMinutes: organization.min_booking_lead_minutes ?? 0,
    });

    setDynamicSlots(result);
    setLoading(false);
  }, [organization, selectedOption, selectedDate, selectedDuration]);

  // ─── Fetch date-specific events ──────────────────────
  const fetchDateEvents = useCallback(async () => {
    if (!organization || !selectedDate) {
      setDateEvents([]);
      return;
    }

    // Build day boundaries in facility timezone
    const dayStart = new Date(`${selectedDate}T00:00:00`);
    const dayEnd = new Date(`${selectedDate}T23:59:59`);
    // Convert to ISO using timezone offset for accurate filtering
    const startISO = new Intl.DateTimeFormat('en-CA', {
      timeZone: organization.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(dayStart);
    const dayStartUTC = new Date(`${startISO}T00:00:00`);
    const dayEndUTC = new Date(dayStartUTC.getTime() + 24 * 60 * 60 * 1000);

    const { data: events } = await supabase
      .from('events')
      .select(`
        id, name, description, start_time, end_time, capacity, price_cents,
        members_only, event_bays(bay_id, bays:bay_id(name))
      `)
      .eq('org_id', organization.id)
      .eq('status', 'published')
      .gte('start_time', dayStartUTC.toISOString())
      .lt('start_time', dayEndUTC.toISOString())
      .order('start_time');

    if (!events || events.length === 0) {
      setDateEvents([]);
      setUserEventRegMap({});
      return;
    }

    // Fetch registration counts
    const enriched = await Promise.all(
      events.map(async (evt: any) => {
        const { data: count } = await supabase.rpc('get_event_registration_count', {
          p_event_id: evt.id,
        });
        const bayNames = (evt.event_bays as any[])
          ?.map((eb: any) => eb.bays?.name ?? eb.bays?.[0]?.name)
          .filter(Boolean) || [];
        return {
          ...evt,
          registered_count: count ?? 0,
          bay_names: bayNames,
        };
      })
    );

    setDateEvents(enriched);

    // Fetch user's registrations for these events
    if (user) {
      const eventIds = events.map((e: any) => e.id);
      const { data: userRegs } = await supabase
        .from('event_registrations')
        .select('event_id, status')
        .eq('user_id', user.id)
        .in('event_id', eventIds)
        .in('status', ['confirmed', 'waitlisted', 'pending_payment']);

      const regMap: Record<string, string> = {};
      if (userRegs) {
        for (const r of userRegs) {
          regMap[r.event_id] = r.status;
        }
      }
      setUserEventRegMap(regMap);
    } else {
      setUserEventRegMap({});
    }
  }, [organization, selectedDate, user]);

  // Fetch on changes
  useEffect(() => {
    if (isDynamic) {
      fetchDynamicSlots();
    } else {
      fetchSlotBasedSlots();
    }
    fetchDateEvents();
  }, [isDynamic, fetchDynamicSlots, fetchSlotBasedSlots, fetchDateEvents]);

  // ─── Slot-based toggle ─────────────────────────────────
  const toggleSlot = (slotId: string) => {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  };

  const selectedSlots = slots.filter((s) => selectedSlotIds.has(s.id));
  const totalCents = isDynamic
    ? selectedDynamicSlot?.price_cents ?? 0
    : selectedSlots.reduce((sum, s) => sum + s.price_cents, 0);

  // ─── Membership discount helpers ──────────────────────
  const hasMemberDiscount = isMember && tier && tier.discount_value > 0;
  const hasEventDiscount = isMember && tier && tier.event_discount_value > 0;

  function calcBookingDiscount(priceCents: number): { discountCents: number; finalCents: number; label: string } {
    if (!hasMemberDiscount || !tier) return { discountCents: 0, finalCents: priceCents, label: '' };
    let discountCents: number;
    let label: string;
    if (tier.discount_type === 'percent') {
      discountCents = Math.round(priceCents * tier.discount_value / 100);
      label = `${tier.discount_value}% member discount`;
    } else {
      discountCents = Math.min(tier.discount_value * 100, priceCents);
      label = `${formatPrice(tier.discount_value * 100)} member discount`;
    }
    return { discountCents, finalCents: priceCents - discountCents, label };
  }

  function calcEventDiscount(priceCents: number): { discountCents: number; finalCents: number; label: string } {
    if (!hasEventDiscount || !tier) return { discountCents: 0, finalCents: priceCents, label: '' };
    let discountCents: number;
    let label: string;
    if (tier.event_discount_type === 'percent') {
      discountCents = Math.round(priceCents * tier.event_discount_value / 100);
      label = `${tier.event_discount_value}% member discount`;
    } else {
      discountCents = Math.min(tier.event_discount_value * 100, priceCents);
      label = `${formatPrice(tier.event_discount_value * 100)} member discount`;
    }
    return { discountCents, finalCents: priceCents - discountCents, label };
  }

  const bookingDiscount = calcBookingDiscount(totalCents);

  // ─── Booking handlers ─────────────────────────────────

  const handleSlotBasedBook = async () => {
    if (!user || !organization || !selectedBay || selectedSlots.length === 0) return;

    setBooking(true);
    setBookingStep('processing');

    // Calculate membership discount
    const discount = calcBookingDiscount(totalCents);

    // Collect payment first (skips if org has no Stripe or $0 total)
    const paymentResult = await collectPayment({
      orgId: organization.id,
      type: 'slot_booking',
      slotIds: selectedSlots.map((s) => s.id),
      locationId: selectedLocation?.id,
      discountCents: discount.discountCents,
    });

    if (paymentResult.cancelled) {
      setBooking(false);
      setBookingStep('summary');
      return;
    }

    if (!paymentResult.success) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Payment Failed', paymentResult.error || 'Unable to process payment.');
      return;
    }

    // Create the booking
    const { data, error } = await supabase.rpc('create_booking', {
      p_org_id: organization.id,
      p_customer_id: user.id,
      p_bay_id: selectedBay.id,
      p_date: selectedDate,
      p_slot_ids: selectedSlots.map((s) => s.id),
      p_notes: notes || null,
      p_location_id: selectedLocation?.id || null,
      p_discount_cents: discount.discountCents || 0,
      p_discount_description: discount.label || null,
    });

    if (error) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Booking Failed', error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    // Record the payment if one was collected
    if (paymentResult.intentId && result?.booking_id) {
      await recordPayment({
        orgId: organization.id,
        bookingId: result.booking_id,
        intentId: paymentResult.intentId,
        intentType: paymentResult.intentType!,
        stripeCustomerId: paymentResult.stripeCustomerId!,
        amountCents: paymentResult.amountCents!,
        cancellationPolicyText: paymentResult.cancellationPolicyText,
      });
    }

    setBooking(false);
    showBookingSuccess(result?.confirmation_code, undefined, result?.booking_id);
  };

  const handleDynamicBook = async () => {
    if (!user || !organization || !selectedOption || !selectedDynamicSlot) return;

    setBooking(true);
    setBookingStep('processing');

    // Calculate membership discount
    const discount = calcBookingDiscount(selectedDynamicSlot.price_cents);

    // Collect payment first (skips if org has no Stripe or $0 total)
    const paymentResult = await collectPayment({
      orgId: organization.id,
      type: 'dynamic_booking',
      priceCents: selectedDynamicSlot.price_cents,
      locationId: selectedLocation?.id,
      discountCents: discount.discountCents,
    });

    if (paymentResult.cancelled) {
      setBooking(false);
      setBookingStep('summary');
      return;
    }

    if (!paymentResult.success) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Payment Failed', paymentResult.error || 'Unable to process payment.');
      return;
    }

    let targetBayId: string | null = null;

    if (selectedOption.type === 'group') {
      targetBayId = await pickBayForGroupBooking({
        bayIds: selectedOption.group.bays.map((b) => b.id),
        date: selectedDate,
        startTime: selectedDynamicSlot.start_time,
        endTime: selectedDynamicSlot.end_time,
        timezone: organization.timezone,
      });

      if (!targetBayId) {
        setBooking(false);
        setBookingStep('summary');
        Alert.alert('Booking Failed', 'No facility available for this time slot. Please try another time.');
        return;
      }
    } else {
      targetBayId = selectedOption.bay.id;
    }

    const { data, error } = await supabase.rpc('create_dynamic_booking', {
      p_org_id: organization.id,
      p_customer_id: user.id,
      p_bay_id: targetBayId,
      p_date: selectedDate,
      p_start_time: selectedDynamicSlot.start_time,
      p_end_time: selectedDynamicSlot.end_time,
      p_price_cents: selectedDynamicSlot.price_cents,
      p_notes: notes || null,
      p_location_id: selectedLocation?.id || null,
      p_discount_cents: discount.discountCents || 0,
      p_discount_description: discount.label || null,
    });

    if (error) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Booking Failed', error.message);
      return;
    }

    const result = typeof data === 'object' && data !== null ? data : {};

    // Record the payment if one was collected
    if (paymentResult.intentId && (result as any)?.booking_id) {
      await recordPayment({
        orgId: organization.id,
        bookingId: (result as any).booking_id,
        intentId: paymentResult.intentId,
        intentType: paymentResult.intentType!,
        stripeCustomerId: paymentResult.stripeCustomerId!,
        amountCents: paymentResult.amountCents!,
        cancellationPolicyText: paymentResult.cancellationPolicyText,
      });
    }

    setBooking(false);
    showBookingSuccess((result as any)?.confirmation_code, undefined, (result as any)?.booking_id);
  };

  const showBookingSuccess = (confirmationCode?: string, oldCode?: string, bookingId?: string) => {
    setSuccessCode(confirmationCode || 'Confirmed');
    setSuccessOldCode(oldCode || null);
    setSuccessBookingId(bookingId || null);
    setBookingStep('success');
  };

  const resetSelection = () => {
    setSelectedSlotIds(new Set());
    setSelectedDynamicSlot(null);
    setShowConfirm(false);
    setBookingStep('summary');
    setSuccessCode(null);
    setSuccessOldCode(null);
    setSuccessBookingId(null);
    setNotes('');
  };

  // ─── Modify booking handlers ─────────────────────────
  const API_URL = process.env.EXPO_PUBLIC_API_URL || '';

  const handleModifyPayment = async (oldBookingId: string, newBookingId: string, newAmountCents: number) => {
    if (!API_URL) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const res = await fetch(`${API_URL}/api/stripe/modify-booking-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          old_booking_id: oldBookingId,
          new_booking_id: newBookingId,
          new_amount_cents: newAmountCents,
        }),
      });
      const data = await res.json();
      if (data.status === 'requires_action') {
        console.warn('[ModifyBooking] 3DS required — admin will handle manually');
      }
    } catch (err) {
      console.error('[ModifyBooking] Payment adjustment error:', err);
    }
  };

  const handleSlotBasedModify = async () => {
    if (!user || !organization || !selectedBay || selectedSlots.length === 0 || !modifyBooking) return;
    setBooking(true);
    setBookingStep('processing');

    const { data, error } = await supabase.rpc('modify_booking', {
      p_booking_id: modifyBooking.id,
      p_new_bay_id: selectedBay.id,
      p_new_date: selectedDate,
      p_new_slot_ids: selectedSlots.map((s) => s.id),
      p_notes: notes || null,
    });

    if (error) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Modification Failed', error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;

    // Handle payment difference (use discounted total)
    if (result?.booking_id) {
      const newTotal = calcBookingDiscount(selectedSlots.reduce((sum, s) => sum + s.price_cents, 0)).finalCents;
      await handleModifyPayment(modifyBooking.id, result.booking_id, newTotal);
    }

    setBooking(false);
    showBookingSuccess(result?.confirmation_code, modifyBooking.confirmationCode, result?.booking_id);
  };

  const handleDynamicModify = async () => {
    if (!user || !organization || !selectedOption || !selectedDynamicSlot || !modifyBooking) return;
    setBooking(true);
    setBookingStep('processing');

    let targetBayId: string | null = null;
    if (selectedOption.type === 'group') {
      targetBayId = await pickBayForGroupBooking({
        bayIds: selectedOption.group.bays.map((b) => b.id),
        date: selectedDate,
        startTime: selectedDynamicSlot.start_time,
        endTime: selectedDynamicSlot.end_time,
        timezone: organization.timezone,
      });
      if (!targetBayId) {
        setBooking(false);
        setBookingStep('summary');
        Alert.alert('Modification Failed', 'No facility available for this time slot.');
        return;
      }
    } else {
      targetBayId = selectedOption.bay.id;
    }

    // Atomic modify: cancels old + creates new in one transaction
    const { data: newData, error: modifyError } = await supabase.rpc('modify_dynamic_booking', {
      p_booking_id: modifyBooking.id,
      p_new_bay_id: targetBayId,
      p_new_date: selectedDate,
      p_start_time: selectedDynamicSlot.start_time,
      p_end_time: selectedDynamicSlot.end_time,
      p_price_cents: selectedDynamicSlot.price_cents,
      p_notes: notes || null,
    });

    if (modifyError) {
      setBooking(false);
      setBookingStep('summary');
      Alert.alert('Modification Failed', modifyError.message);
      return;
    }

    const result = Array.isArray(newData) ? newData[0] : newData;

    // Handle payment difference (use discounted total)
    if (result?.booking_id) {
      const discountedTotal = calcBookingDiscount(selectedDynamicSlot.price_cents).finalCents;
      await handleModifyPayment(modifyBooking.id, result.booking_id, discountedTotal);
    }

    setBooking(false);
    showBookingSuccess(result?.confirmation_code, modifyBooking.confirmationCode, result?.booking_id);
  };

  const handleBook = isModifyMode
    ? (isDynamic ? handleDynamicModify : handleSlotBasedModify)
    : (isDynamic ? handleDynamicBook : handleSlotBasedBook);
  const hasSelection = isDynamic ? !!selectedDynamicSlot : selectedSlots.length > 0;

  // ─── Option display name ──────────────────────────────
  const getOptionLabel = (opt: BookableOption): string => {
    if (opt.type === 'group') return opt.group.name;
    return opt.bay.name;
  };

  const getOptionSubLabel = (opt: BookableOption): string | null => {
    if (opt.type === 'group') return `${opt.group.bays.length} available`;
    return opt.bay.resource_type;
  };

  const isOptionSelected = (opt: BookableOption): boolean => {
    if (!selectedOption) return false;
    if (opt.type === 'group' && selectedOption.type === 'group') {
      return opt.group.id === selectedOption.group.id;
    }
    if (opt.type === 'bay' && selectedOption.type === 'bay') {
      return opt.bay.id === selectedOption.bay.id;
    }
    return false;
  };

  // Summary label for confirmation
  const summaryLabel = isDynamic
    ? selectedOption
      ? getOptionLabel(selectedOption)
      : ''
    : selectedBay?.name ?? '';

  // Check if selected slot(s) are within the cancellation window
  const isWithinCancellationWindow = (() => {
    if (orgPaymentMode === 'none' || cancellationWindowHours === null) return false;
    let earliestStart: string | null = null;
    if (isDynamic && selectedDynamicSlot) {
      earliestStart = selectedDynamicSlot.start_time;
    } else if (selectedSlots.length > 0) {
      earliestStart = selectedSlots[0].start_time;
    }
    if (!earliestStart) return false;
    const startMs = new Date(earliestStart).getTime();
    const cutoff = startMs - cancellationWindowHours * 60 * 60 * 1000;
    return Date.now() >= cutoff;
  })();

  if (!organization) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Modify mode banner */}
        {isModifyMode && modifyBooking && (
          <View style={styles.modifyBanner}>
            <View style={styles.modifyBannerHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modifyBannerText}>
                  Modifying {modifyBooking.confirmationCode} — {modifyBooking.bayName},{' '}
                  {formatDate(modifyBooking.date)},{' '}
                  {formatTimeInZone(modifyBooking.startTime, organization.timezone)} –{' '}
                  {formatTimeInZone(modifyBooking.endTime, organization.timezone)}
                </Text>
                <Text style={styles.modifyBannerHint}>Select new date, bay, and time slots below</Text>
              </View>
              <TouchableOpacity
                onPress={() => {
                  navigation.setParams({ modifyBooking: undefined } as any);
                  (navigation as any).navigate('Bookings');
                }}
                style={styles.modifyCancelButton}
              >
                <Text style={styles.modifyCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Date Picker */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. Select Date</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.dateRow}
          >
            {dateOptions.map((date) => {
              const isSelected = date === selectedDate;
              return (
                <TouchableOpacity
                  key={date}
                  onPress={() => setSelectedDate(date)}
                  style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                >
                  <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextSelected]}>
                    {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
                  </Text>
                  <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextSelected]}>
                    {new Date(date + 'T12:00:00').getDate()}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Facility / Bay Picker */}
        {isDynamic ? (
          <>
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>2. Select Facility</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bayRow}
            >
              {bookableOptions.map((opt) => {
                const selected = isOptionSelected(opt);
                const key = opt.type === 'group' ? `g-${opt.group.id}` : `b-${opt.bay.id}`;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setSelectedOption(opt)}
                    style={[styles.bayChip, selected && styles.bayChipSelected]}
                  >
                    <Text style={[styles.bayChipText, selected && styles.bayChipTextSelected]}>
                      {getOptionLabel(opt)}
                    </Text>
                    {getOptionSubLabel(opt) && (
                      <Text style={[styles.bayChipType, selected && styles.bayChipTextSelected]}>
                        {getOptionSubLabel(opt)}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          {/* Duration Picker */}
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              3. Play for {selectedDuration >= 60
                ? selectedDuration % 60 === 0
                  ? `${selectedDuration / 60}h`
                  : `${Math.floor(selectedDuration / 60)}h ${selectedDuration % 60}m`
                : `${selectedDuration}m`}
            </Text>
            {availableDurations.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.bayRow}
              >
                {availableDurations.map((dur) => {
                  const isSelected = dur === selectedDuration;
                  const label =
                    dur >= 60
                      ? dur % 60 === 0
                        ? `${dur / 60}h`
                        : `${Math.floor(dur / 60)}h ${dur % 60}m`
                      : `${dur}m`;
                  return (
                    <TouchableOpacity
                      key={dur}
                      onPress={() => setSelectedDuration(dur)}
                      style={[styles.durationChip, isSelected && styles.durationChipSelected]}
                    >
                      <Text
                        style={[
                          styles.durationChipText,
                          isSelected && styles.durationChipTextSelected,
                        ]}
                      >
                        {label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
          </>
        ) : (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Select Bay</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.bayRow}
            >
              {bays.map((bay) => {
                const isSelected = selectedBay?.id === bay.id;
                return (
                  <TouchableOpacity
                    key={bay.id}
                    onPress={() => setSelectedBay(bay)}
                    style={[styles.bayChip, isSelected && styles.bayChipSelected]}
                  >
                    <Text style={[styles.bayChipText, isSelected && styles.bayChipTextSelected]}>
                      {bay.name}
                    </Text>
                    {bay.resource_type && (
                      <Text style={[styles.bayChipType, isSelected && styles.bayChipTextSelected]}>
                        {bay.resource_type}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* Date-specific events — filtered to selected facility/group */}
        {(() => {
          // Determine which bay IDs are relevant for the current selection
          let selectedBayIds: Set<string> | null = null;
          if (isDynamic && selectedOption) {
            if (selectedOption.type === 'group') {
              selectedBayIds = new Set(selectedOption.group.bays.map((b) => b.id));
            } else {
              selectedBayIds = new Set([selectedOption.bay.id]);
            }
          } else if (!isDynamic && selectedBay) {
            selectedBayIds = new Set([selectedBay.id]);
          }

          // Filter events: only show if at least one event bay matches the selection
          const filteredEvents = selectedBayIds
            ? dateEvents.filter((evt) =>
                (evt.event_bays as any[])?.some((eb: any) => selectedBayIds!.has(eb.bay_id))
              )
            : dateEvents;

          return filteredEvents.length > 0 ? (
          <View style={{ marginTop: spacing.lg }}>
            {filteredEvents.map((evt) => {
              const spotsLeft = (evt.capacity || 0) - (evt.registered_count || 0);
              const priceLabel = evt.price_cents === 0 ? 'Free' : formatPrice(evt.price_cents);
              const userRegStatus = userEventRegMap[evt.id] || null;
              return (
                <TouchableOpacity
                  key={evt.id}
                  onPress={() => {
                    if (userRegStatus) {
                      const statusLabel =
                        userRegStatus === 'confirmed'
                          ? 'registered'
                          : userRegStatus === 'waitlisted'
                            ? 'on the waitlist'
                            : 'pending payment';
                      Alert.alert(
                        'Already Registered',
                        `You're already ${statusLabel} for this event. Check "My Bookings" to view or manage your registration.`,
                      );
                    } else {
                      setSelectedEvent(evt);
                    }
                  }}
                  style={eventStyles.card}
                  activeOpacity={0.7}
                >
                  <View style={eventStyles.cardLeft}>
                    <View style={eventStyles.iconCircle}>
                      <Text style={eventStyles.iconText}>📅</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={eventStyles.nameRow}>
                        <Text style={eventStyles.eventName} numberOfLines={1}>
                          {evt.name}
                        </Text>
                        <Badge label="Event" variant="success" />
                        {userRegStatus && (
                          <Badge
                            label={
                              userRegStatus === 'confirmed'
                                ? 'Registered'
                                : userRegStatus === 'waitlisted'
                                  ? 'Waitlisted'
                                  : 'Pending'
                            }
                            variant={userRegStatus === 'confirmed' ? 'default' : 'warning'}
                          />
                        )}
                      </View>
                      <Text style={eventStyles.eventTime}>
                        {formatTimeInZone(evt.start_time, organization!.timezone)} –{' '}
                        {formatTimeInZone(evt.end_time, organization!.timezone)}
                      </Text>
                      {evt.bay_names.length > 0 && (
                        <View style={eventStyles.bayRow}>
                          {evt.bay_names.map((name: string) => (
                            <View key={name} style={eventStyles.bayPill}>
                              <Text style={eventStyles.bayPillText}>{name}</Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={eventStyles.cardRight}>
                    <Text style={eventStyles.price}>{priceLabel}</Text>
                    <Text style={eventStyles.spots}>
                      {spotsLeft > 0 ? `${spotsLeft} spot${spotsLeft !== 1 ? 's' : ''} left` : 'Full'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
          ) : null;
        })()}

        {/* Time Slots */}
        {isDynamic ? (
          selectedOption ? (
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>
                4. Select a time
              </Text>
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
              ) : dynamicSlots.length === 0 ? (
                <Text style={styles.emptyText}>No available times for this date.</Text>
              ) : (
                <View>
                  {groupSlotsByTimePeriod(dynamicSlots, organization.timezone).map(({ period, items: periodSlots }) => (
                    <View key={period} style={periodStyles.section}>
                      <View style={periodStyles.header}>
                        <View style={periodStyles.dot} />
                        <Text style={periodStyles.label}>{timePeriodLabels[period].label}</Text>
                        <View style={periodStyles.divider} />
                      </View>
                      <View style={styles.slotsGrid}>
                        {periodSlots.map((slot) => {
                          const isSelected = selectedDynamicSlot?.start_time === slot.start_time;
                          return (
                            <PressableScale
                              key={slot.start_time}
                              onPress={() =>
                                setSelectedDynamicSlot(isSelected ? null : slot)
                              }
                              style={[styles.slotChip, isSelected && styles.slotChipSelected]}
                            >
                              <Text style={[styles.slotTime, isSelected && styles.slotTimeSelected]}>
                                {formatTimeInZone(slot.start_time, organization.timezone)}
                              </Text>
                              <Text style={[styles.slotPrice, isSelected && styles.slotPriceSelected]}>
                                {formatPrice(slot.price_cents)}
                              </Text>
                            </PressableScale>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={styles.emptyText}>Select a facility to view available times.</Text>
            </Card>
          )
        ) : selectedBay ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>
              Available Slots — {formatDate(selectedDate)}
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : slots.length === 0 ? (
              <Text style={styles.emptyText}>No available slots for this date and bay.</Text>
            ) : (
              <View>
                {groupSlotsByTimePeriod(slots, organization!.timezone).map(({ period, items: periodSlots }) => (
                  <View key={period} style={periodStyles.section}>
                    <View style={periodStyles.header}>
                      <Text style={periodStyles.emoji}>{timePeriodLabels[period].emoji}</Text>
                      <Text style={periodStyles.label}>{timePeriodLabels[period].label}</Text>
                      <View style={periodStyles.divider} />
                    </View>
                    <View style={styles.slotsGrid}>
                      {periodSlots.map((slot) => {
                        const isSelected = selectedSlotIds.has(slot.id);
                        return (
                          <PressableScale
                            key={slot.id}
                            onPress={() => toggleSlot(slot.id)}
                            style={[styles.slotChip, isSelected && styles.slotChipSelected]}
                          >
                            <Text style={[styles.slotTime, isSelected && styles.slotTimeSelected]}>
                              {formatTimeInZone(slot.start_time, organization!.timezone)}
                            </Text>
                            <Text style={[styles.slotPrice, isSelected && styles.slotPriceSelected]}>
                              {formatPrice(slot.price_cents)}
                            </Text>
                          </PressableScale>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <Card style={{ marginTop: spacing.md }}>
            <Text style={styles.emptyText}>Select a bay to view available time slots.</Text>
          </Card>
        )}

      </ScrollView>

      {/* Booking confirmation bottom sheet */}
      <Modal
        visible={showConfirm && hasSelection}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          if (bookingStep === 'success') {
            resetSelection();
            if (isDynamic) fetchDynamicSlots();
            else fetchSlotBasedSlots();
          } else if (!booking && !paymentProcessing) {
            setShowConfirm(false);
            setBookingStep('summary');
          }
        }}
      >
        <View style={sheetStyles.container}>
          {/* Header with close button */}
          <View style={sheetStyles.header}>
            <Text style={sheetStyles.headerTitle}>
              {bookingStep === 'success'
                ? (isModifyMode ? 'Booking Modified!' : 'Booking Confirmed!')
                : (isModifyMode ? 'Modify Booking' : 'Confirm Booking')}
            </Text>
            {bookingStep !== 'processing' && (
              <TouchableOpacity
                onPress={() => {
                  if (bookingStep === 'success') {
                    resetSelection();
                    if (isDynamic) fetchDynamicSlots();
                    else fetchSlotBasedSlots();
                  } else {
                    setShowConfirm(false);
                    setBookingStep('summary');
                  }
                }}
              >
                <Text style={sheetStyles.headerClose}>✕</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Step dots */}
          <View style={sheetStyles.dotsRow}>
            {(['summary', 'processing', 'success'] as BookingStep[]).map((step, i) => (
              <View
                key={step}
                style={[
                  sheetStyles.dot,
                  (step === bookingStep ||
                    (step === 'summary' && bookingStep !== 'summary') ||
                    (step === 'processing' && bookingStep === 'success'))
                    ? sheetStyles.dotActive
                    : sheetStyles.dotInactive,
                ]}
              />
            ))}
          </View>

          {/* Step: Summary */}
          {bookingStep === 'summary' && (
            <>
              <ScrollView contentContainerStyle={sheetStyles.content}>
                <Card>
                  <Text style={styles.summaryBay}>{summaryLabel}</Text>
                  <Text style={styles.summaryDate}>{formatDate(selectedDate)}</Text>
                  {isDynamic && selectedDynamicSlot ? (
                    <View style={styles.summarySlots}>
                      <View style={styles.summarySlotRow}>
                        <Text style={styles.summarySlotTime}>
                          {formatTimeInZone(selectedDynamicSlot.start_time, organization.timezone)} –{' '}
                          {formatTimeInZone(selectedDynamicSlot.end_time, organization.timezone)}
                        </Text>
                        <Text style={styles.summarySlotPrice}>
                          {formatPrice(selectedDynamicSlot.price_cents)}
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.summarySlots}>
                      {selectedSlots.map((slot) => (
                        <View key={slot.id} style={styles.summarySlotRow}>
                          <Text style={styles.summarySlotTime}>
                            {formatTimeInZone(slot.start_time, organization.timezone)} –{' '}
                            {formatTimeInZone(slot.end_time, organization.timezone)}
                          </Text>
                          <Text style={styles.summarySlotPrice}>
                            {formatPrice(slot.price_cents)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {bookingDiscount.discountCents > 0 && (
                    <>
                      <View style={styles.summaryTotal}>
                        <Text style={styles.totalLabel}>Subtotal</Text>
                        <Text style={styles.subtotalPrice}>{formatPrice(totalCents)}</Text>
                      </View>
                      <View style={styles.discountRow}>
                        <Text style={styles.discountLabel}>★ {bookingDiscount.label}</Text>
                        <Text style={styles.discountAmount}>-{formatPrice(bookingDiscount.discountCents)}</Text>
                      </View>
                    </>
                  )}
                  <View style={styles.summaryTotal}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalPrice}>{formatPrice(bookingDiscount.finalCents)}</Text>
                  </View>
                  {isModifyMode && modifyBooking && (() => {
                    const diff = bookingDiscount.finalCents - modifyBooking.totalPriceCents;
                    const absDiff = Math.abs(diff);
                    const cardLabel = modifyCardBrand && modifyCardLast4
                      ? `${modifyCardBrand.charAt(0).toUpperCase() + modifyCardBrand.slice(1)} •••• ${modifyCardLast4}`
                      : 'your card on file';
                    const hasPayment = modifyPaymentMode !== 'none';

                    if (diff > 0 && hasPayment) {
                      return (
                        <View style={[styles.priceDiff, { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.sm }]}>
                          <Text style={[styles.priceDiffLabel, { color: '#b45309', flex: 1 }]}>
                            {modifyPaymentMode === 'charge_upfront'
                              ? `${cardLabel} will be charged`
                              : 'Price increase — no charge now'}
                          </Text>
                          <Text style={[styles.priceDiffAmount, { color: '#b45309' }]}>
                            +{formatPrice(absDiff)}
                          </Text>
                        </View>
                      );
                    } else if (diff < 0 && hasPayment) {
                      return (
                        <View style={[styles.priceDiff, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0', borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.sm }]}>
                          <Text style={[styles.priceDiffLabel, { color: '#15803d', flex: 1 }]}>
                            {modifyPaymentMode === 'charge_upfront'
                              ? `Refund to ${cardLabel}`
                              : 'Price decrease — no refund needed'}
                          </Text>
                          <Text style={[styles.priceDiffAmount, { color: '#15803d' }]}>
                            -{formatPrice(absDiff)}
                          </Text>
                        </View>
                      );
                    } else if (diff === 0 && hasPayment) {
                      return (
                        <View style={[styles.priceDiff, { backgroundColor: colors.muted, borderRadius: borderRadius.md, padding: spacing.sm, marginTop: spacing.sm }]}>
                          <Text style={[styles.priceDiffLabel, { color: colors.mutedForeground }]}>
                            No price change — no additional charge or refund
                          </Text>
                        </View>
                      );
                    } else if (diff !== 0) {
                      return (
                        <View style={styles.priceDiff}>
                          <Text style={styles.priceDiffLabel}>
                            {diff > 0 ? 'Price increase' : 'Price decrease'}
                          </Text>
                          <Text style={[
                            styles.priceDiffAmount,
                            { color: diff > 0 ? colors.destructive : '#16a34a' },
                          ]}>
                            {diff > 0 ? '+' : '-'}{formatPrice(absDiff)}
                          </Text>
                        </View>
                      );
                    }
                    return null;
                  })()}
                </Card>

                {/* Within cancellation window warning */}
                {isWithinCancellationWindow && (
                  <View style={styles.windowWarningBanner}>
                    <Text style={styles.windowWarningText}>
                      ⚠ Booking is less than {cancellationWindowHours}h away and cannot be refunded or modified.
                    </Text>
                  </View>
                )}

                {/* Terms + cancellation policy agreement */}
                {orgPaymentMode !== 'none' && (
                  <Text style={styles.policyAgreementText}>
                    By booking you agree to the terms and{' '}
                    {cancellationPolicyText ? (
                      <Text
                        style={styles.policyAgreementLink}
                        onPress={() => setShowPolicyModal(true)}
                      >
                        cancellation policy
                      </Text>
                    ) : (
                      'cancellation policy'
                    )}
                  </Text>
                )}
              </ScrollView>

              <View style={sheetStyles.footer}>
                <Button
                  title={isModifyMode ? 'Confirm Modification' : 'Confirm Booking'}
                  onPress={handleBook}
                  loading={booking || paymentProcessing}
                  size="lg"
                />
              </View>

              {/* Cancellation policy modal */}
              {cancellationPolicyText && (
                <Modal
                  visible={showPolicyModal}
                  transparent
                  animationType="fade"
                  onRequestClose={() => setShowPolicyModal(false)}
                >
                  <View style={styles.policyModalOverlay}>
                    <View style={styles.policyModalContent}>
                      <Text style={styles.policyModalTitle}>Cancellation Policy</Text>
                      <View style={styles.policyModalBox}>
                        <Text style={styles.policyModalText}>{cancellationPolicyText}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.policyModalClose}
                        onPress={() => setShowPolicyModal(false)}
                      >
                        <Text style={styles.policyModalCloseText}>Close</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </Modal>
              )}
            </>
          )}

          {/* Step: Processing */}
          {bookingStep === 'processing' && (
            <View style={sheetStyles.processingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={sheetStyles.processingText}>
                {isModifyMode ? 'Modifying your booking...' : 'Processing your booking...'}
              </Text>
            </View>
          )}

          {/* Step: Success */}
          {bookingStep === 'success' && (
            <>
              <View style={sheetStyles.successContainer}>
                <View style={sheetStyles.successIcon}>
                  <Text style={sheetStyles.successIconText}>✓</Text>
                </View>
                <Text style={sheetStyles.successTitle}>
                  {isModifyMode ? 'Booking Modified!' : 'You\'re booked!'}
                </Text>
                <Text style={sheetStyles.successCode}>{successCode}</Text>
                {successOldCode && (
                  <Text style={sheetStyles.successOldCode}>
                    Previous: {successOldCode}
                  </Text>
                )}
                <Text style={sheetStyles.successHint}>
                  Save your confirmation code for reference.
                </Text>
              </View>
              <View style={sheetStyles.footer}>
                <Button
                  title="View Booking"
                  onPress={() => {
                    const bookingId = successBookingId;
                    resetSelection();
                    if (isModifyMode) {
                      navigation.setParams({ modifyBooking: undefined } as any);
                    }
                    (navigation as any).navigate('Bookings', {
                      expandBookingId: bookingId || undefined,
                    });
                  }}
                  size="lg"
                />
                <TouchableOpacity
                  style={sheetStyles.secondaryButton}
                  onPress={() => {
                    resetSelection();
                    if (isModifyMode) {
                      navigation.setParams({ modifyBooking: undefined } as any);
                    }
                    if (isDynamic) fetchDynamicSlots();
                    else fetchSlotBasedSlots();
                  }}
                >
                  <Text style={sheetStyles.secondaryButtonText}>Book Another</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </Modal>

      {/* Event Detail Modal */}
      <Modal
        visible={!!selectedEvent}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => { setSelectedEvent(null); setEventConfirmStep(false); }}
      >
        {selectedEvent && (
          <View style={eventStyles.modalContainer}>
            <View style={eventStyles.modalHeader}>
              <Text style={eventStyles.modalTitle}>
                {eventConfirmStep ? 'Confirm Registration' : selectedEvent.name}
              </Text>
              <TouchableOpacity onPress={() => { setSelectedEvent(null); setEventConfirmStep(false); }}>
                <Text style={eventStyles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            {!eventConfirmStep ? (
              /* ── Step 1: Event Details (paid events pay directly from here) ── */
              <>
                <ScrollView contentContainerStyle={eventStyles.modalContent}>
                  <Badge label="Event" variant="success" />

                  {selectedEvent.description && (
                    <Text style={eventStyles.modalDescription}>{selectedEvent.description}</Text>
                  )}

                  <View style={eventStyles.detailRow}>
                    <Text style={eventStyles.detailLabel}>Date</Text>
                    <Text style={eventStyles.detailValue}>{formatDate(selectedDate)}</Text>
                  </View>
                  <View style={eventStyles.detailRow}>
                    <Text style={eventStyles.detailLabel}>Time</Text>
                    <Text style={eventStyles.detailValue}>
                      {formatTimeInZone(selectedEvent.start_time, organization!.timezone)} –{' '}
                      {formatTimeInZone(selectedEvent.end_time, organization!.timezone)}
                    </Text>
                  </View>
                  {selectedEvent.bay_names.length > 0 && (
                    <View style={eventStyles.detailRow}>
                      <Text style={eventStyles.detailLabel}>Location</Text>
                      <Text style={eventStyles.detailValue}>{selectedEvent.bay_names.join(', ')}</Text>
                    </View>
                  )}
                  <View style={eventStyles.detailRow}>
                    <Text style={eventStyles.detailLabel}>Price</Text>
                    {(() => {
                      const evtDisc = calcEventDiscount(selectedEvent.price_cents);
                      if (selectedEvent.price_cents === 0) return <Text style={eventStyles.detailValue}>Free</Text>;
                      if (evtDisc.discountCents > 0) {
                        return (
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[eventStyles.detailValue, { textDecorationLine: 'line-through', color: colors.mutedForeground, fontSize: 13 }]}>
                              {formatPrice(selectedEvent.price_cents)}
                            </Text>
                            <Text style={[eventStyles.detailValue, { color: '#0d9488' }]}>
                              {formatPrice(evtDisc.finalCents)}
                            </Text>
                          </View>
                        );
                      }
                      return <Text style={eventStyles.detailValue}>{formatPrice(selectedEvent.price_cents)}</Text>;
                    })()}
                  </View>
                  <View style={eventStyles.detailRow}>
                    <Text style={eventStyles.detailLabel}>Spots</Text>
                    <Text style={eventStyles.detailValue}>
                      {(selectedEvent.capacity - selectedEvent.registered_count) > 0
                        ? `${selectedEvent.capacity - selectedEvent.registered_count} of ${selectedEvent.capacity} remaining`
                        : 'Full'}
                    </Text>
                  </View>
                  {selectedEvent.members_only && (
                    <View style={eventStyles.membersOnlyBanner}>
                      <Text style={eventStyles.membersOnlyText}>Members only</Text>
                    </View>
                  )}

                  {/* Member discount breakdown for paid events */}
                  {(() => {
                    const evtDisc = calcEventDiscount(selectedEvent.price_cents);
                    const requiresPayment = orgPaymentMode !== 'none' && selectedEvent.price_cents > 0;
                    if (!requiresPayment || evtDisc.discountCents <= 0) return null;
                    return (
                      <Card style={{ marginTop: spacing.md }}>
                        <View style={styles.summaryTotal}>
                          <Text style={styles.totalLabel}>Subtotal</Text>
                          <Text style={styles.subtotalPrice}>{formatPrice(selectedEvent.price_cents)}</Text>
                        </View>
                        <View style={styles.discountRow}>
                          <Text style={styles.discountLabel}>★ {evtDisc.label}</Text>
                          <Text style={styles.discountAmount}>-{formatPrice(evtDisc.discountCents)}</Text>
                        </View>
                        <View style={styles.summaryTotal}>
                          <Text style={styles.totalLabel}>Total</Text>
                          <Text style={styles.totalPrice}>{formatPrice(evtDisc.finalCents)}</Text>
                        </View>
                      </Card>
                    );
                  })()}
                </ScrollView>

                <View style={eventStyles.modalFooter}>
                  {!user ? (
                    <Button
                      title="Sign in to Register"
                      onPress={() => {
                        setSelectedEvent(null);
                        setEventConfirmStep(false);
                        (navigation as any).navigate('Auth');
                      }}
                      size="lg"
                    />
                  ) : (selectedEvent.capacity - selectedEvent.registered_count) <= 0 ? (
                    <Button title="Event Full" disabled onPress={() => {}} size="lg" />
                  ) : orgPaymentMode !== 'none' && selectedEvent.price_cents > 0 ? (
                    <Button
                      title={`Continue to Payment`}
                      onPress={async () => {
                        if (!user || !organization) return;
                        setRegisteringEvent(true);

                        // Check for existing registration
                        const { data: existingReg } = await supabase
                          .from('event_registrations')
                          .select('id, status')
                          .eq('event_id', selectedEvent.id)
                          .eq('user_id', user.id)
                          .in('status', ['confirmed', 'waitlisted', 'pending_payment'])
                          .maybeSingle();

                        if (existingReg) {
                          setRegisteringEvent(false);
                          const statusLabel =
                            existingReg.status === 'confirmed'
                              ? 'registered'
                              : existingReg.status === 'waitlisted'
                                ? 'on the waitlist'
                                : 'pending payment';
                          Alert.alert(
                            'Already Registered',
                            `You're already ${statusLabel} for this event. Check "My Bookings" to view or manage your registration.`,
                          );
                          setSelectedEvent(null);
                          setEventConfirmStep(false);
                          return;
                        }

                        // Calculate event discount
                        const evtDiscount = calcEventDiscount(selectedEvent.price_cents);

                        // Collect payment via Stripe payment sheet
                        let paymentResult: { success: boolean; cancelled?: boolean; error?: string; intentId?: string; intentType?: 'payment' | 'setup'; stripeCustomerId?: string; amountCents?: number; cancellationPolicyText?: string } | null = null;

                        if (evtDiscount.finalCents > 0) {
                          paymentResult = await collectPayment({
                            orgId: organization.id,
                            type: 'event',
                            eventId: selectedEvent.id,
                            priceCents: selectedEvent.price_cents,
                            discountCents: evtDiscount.discountCents,
                          });

                          if (paymentResult.cancelled) {
                            setRegisteringEvent(false);
                            return;
                          }

                          if (!paymentResult.success) {
                            setRegisteringEvent(false);
                            Alert.alert('Payment Failed', paymentResult.error || 'Unable to process payment.');
                            return;
                          }
                        }

                        // Register for the event
                        const { data, error } = await supabase.rpc('register_for_event', {
                          p_event_id: selectedEvent.id,
                          p_user_id: user.id,
                        });

                        if (error) {
                          setRegisteringEvent(false);
                          Alert.alert('Registration Failed', error.message);
                          return;
                        }

                        const result = typeof data === 'object' && data !== null ? data : {};
                        const regStatus = (result as any)?.status || 'confirmed';
                        const registrationId = (result as any)?.registration_id;

                        // Record the payment if one was collected
                        if (paymentResult?.intentId && registrationId) {
                          await recordPayment({
                            orgId: organization.id,
                            eventRegistrationId: registrationId,
                            intentId: paymentResult.intentId,
                            intentType: paymentResult.intentType!,
                            stripeCustomerId: paymentResult.stripeCustomerId!,
                            amountCents: paymentResult.amountCents!,
                            cancellationPolicyText: paymentResult.cancellationPolicyText,
                          });
                        }

                        setRegisteringEvent(false);
                        Alert.alert(
                          regStatus === 'waitlisted' ? 'Added to Waitlist' : 'Registered!',
                          regStatus === 'waitlisted'
                            ? "You've been added to the waitlist. We'll notify you if a spot opens up."
                            : `You're registered for ${selectedEvent.name}.`,
                        );
                        setSelectedEvent(null);
                        setEventConfirmStep(false);
                        fetchDateEvents();
                      }}
                      loading={registeringEvent || paymentProcessing}
                      size="lg"
                    />
                  ) : (
                    <Button
                      title="Confirm Registration"
                      onPress={() => setEventConfirmStep(true)}
                      size="lg"
                    />
                  )}
                </View>
              </>
            ) : (
              /* ── Step 2: Free event confirmation only (paid events go directly from step 1) ── */
              <>
                <ScrollView contentContainerStyle={eventStyles.modalContent}>
                  <Card>
                    <Text style={styles.summaryBay}>{selectedEvent.name}</Text>
                    <Text style={styles.summaryDate}>{formatDate(selectedDate)}</Text>
                    <View style={styles.summarySlots}>
                      <View style={styles.summarySlotRow}>
                        <Text style={styles.summarySlotTime}>
                          {formatTimeInZone(selectedEvent.start_time, organization!.timezone)} –{' '}
                          {formatTimeInZone(selectedEvent.end_time, organization!.timezone)}
                        </Text>
                        <Text style={styles.summarySlotPrice}>Free</Text>
                      </View>
                    </View>
                    {selectedEvent.bay_names.length > 0 && (
                      <Text style={{ color: colors.mutedForeground, fontSize: 14, marginTop: spacing.xs }}>
                        {selectedEvent.bay_names.join(', ')}
                      </Text>
                    )}
                    <View style={styles.summaryTotal}>
                      <Text style={styles.totalLabel}>Total</Text>
                      <Text style={styles.totalPrice}>Free</Text>
                    </View>
                  </Card>
                </ScrollView>

                <View style={eventStyles.modalFooter}>
                  <TouchableOpacity
                    onPress={() => setEventConfirmStep(false)}
                    style={{ alignItems: 'center', marginBottom: spacing.sm }}
                  >
                    <Text style={{ color: colors.primary, fontSize: 16 }}>Back</Text>
                  </TouchableOpacity>
                  <Button
                    title="Confirm Registration"
                    onPress={async () => {
                      if (!user || !organization) return;
                      setRegisteringEvent(true);

                      // Check for existing registration
                      const { data: existingReg } = await supabase
                        .from('event_registrations')
                        .select('id, status')
                        .eq('event_id', selectedEvent.id)
                        .eq('user_id', user.id)
                        .in('status', ['confirmed', 'waitlisted', 'pending_payment'])
                        .maybeSingle();

                      if (existingReg) {
                        setRegisteringEvent(false);
                        const statusLabel =
                          existingReg.status === 'confirmed'
                            ? 'registered'
                            : existingReg.status === 'waitlisted'
                              ? 'on the waitlist'
                              : 'pending payment';
                        Alert.alert(
                          'Already Registered',
                          `You're already ${statusLabel} for this event. Check "My Bookings" to view or manage your registration.`,
                        );
                        setSelectedEvent(null);
                        setEventConfirmStep(false);
                        return;
                      }

                      // Register for the event (free — no payment needed)
                      const { data, error } = await supabase.rpc('register_for_event', {
                        p_event_id: selectedEvent.id,
                        p_user_id: user.id,
                      });

                      if (error) {
                        setRegisteringEvent(false);
                        Alert.alert('Registration Failed', error.message);
                        return;
                      }

                      const result = typeof data === 'object' && data !== null ? data : {};
                      const regStatus = (result as any)?.status || 'confirmed';

                      setRegisteringEvent(false);
                      Alert.alert(
                        regStatus === 'waitlisted' ? 'Added to Waitlist' : 'Registered!',
                        regStatus === 'waitlisted'
                          ? "You've been added to the waitlist. We'll notify you if a spot opens up."
                          : `You're registered for ${selectedEvent.name}.`,
                      );
                      setSelectedEvent(null);
                      setEventConfirmStep(false);
                      fetchDateEvents();
                    }}
                    loading={registeringEvent}
                    size="lg"
                  />
                </View>
              </>
            )}
          </View>
        )}
      </Modal>

      {/* Bottom CTA bar */}
      {hasSelection && !showConfirm && (
        <View style={styles.ctaBar}>
          <View>
            {isDynamic ? (
              <Text style={styles.ctaSlotCount}>
                {selectedDuration >= 60
                  ? `${selectedDuration / 60}h session`
                  : `${selectedDuration}m session`}
              </Text>
            ) : (
              <Text style={styles.ctaSlotCount}>
                {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected
              </Text>
            )}
            <Text style={styles.ctaTotal}>{formatPrice(bookingDiscount.finalCents)}</Text>
          </View>
          {user ? (
            <Button
              title={isModifyMode ? 'Continue to Modify' : 'Continue to Book'}
              onPress={() => { setBookingStep('summary'); setShowConfirm(true); }}
            />
          ) : (
            <Button
              title="Sign in to Book"
              onPress={() => (navigation as any).navigate('Auth')}
            />
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: 120,
  },
  modifyBanner: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  modifyBannerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  modifyBannerText: {
    ...typography.bodySmall,
    color: '#1d4ed8',
    fontWeight: '600',
  },
  modifyBannerHint: {
    ...typography.caption,
    color: '#3b82f6',
    marginTop: 4,
  },
  modifyCancelButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: '#93c5fd',
  },
  modifyCancelText: {
    ...typography.caption,
    color: '#1d4ed8',
    fontWeight: '600',
  },
  priceDiff: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  priceDiffLabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  priceDiffAmount: {
    ...typography.label,
    fontWeight: '600',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionCard: {
    backgroundColor: colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.md,
    ...shadows.surface1,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  dateRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  dateChip: {
    width: 56,
    height: 68,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  dateChipSelected: {
    backgroundColor: '#f0fdf4',
    borderColor: colors.primary,
  },
  dateChipDay: {
    ...typography.caption,
    color: colors.mutedForeground,
  },
  dateChipDate: {
    ...typography.h3,
    color: colors.foreground,
  },
  dateChipTextSelected: {
    color: colors.primary,
  },
  bayRow: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  bayChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  bayChipSelected: {
    backgroundColor: '#f0fdf4',
    borderColor: colors.primary,
  },
  bayChipText: {
    ...typography.label,
    color: colors.foreground,
  },
  bayChipType: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  bayChipTextSelected: {
    color: colors.primary,
  },
  durationChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 56,
    alignItems: 'center',
  },
  durationChipSelected: {
    backgroundColor: '#f0fdf4',
    borderColor: colors.primary,
  },
  durationChipText: {
    ...typography.label,
    color: colors.foreground,
  },
  durationChipTextSelected: {
    color: colors.primary,
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  slotChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    minWidth: 100,
    alignItems: 'center',
    ...shadows.surface1,
  },
  slotChipSelected: {
    backgroundColor: colors.selectionBg,
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  slotTime: {
    ...typography.label,
    color: colors.foreground,
  },
  slotTimeSelected: {
    color: colors.primary,
  },
  slotPrice: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  slotPriceSelected: {
    color: colors.primary,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  confirmPanel: {
    marginTop: spacing.lg,
  },
  summaryBay: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: 2,
  },
  summaryDate: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginBottom: spacing.md,
  },
  summarySlots: {
    gap: spacing.sm,
  },
  summarySlotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summarySlotTime: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  summarySlotPrice: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  summaryTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  totalLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  totalPrice: {
    ...typography.h3,
    color: colors.foreground,
  },
  subtotalPrice: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  discountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  discountLabel: {
    ...typography.bodySmall,
    color: '#0d9488',
  },
  discountAmount: {
    ...typography.bodySmall,
    color: '#0d9488',
    fontWeight: '600',
  },
  ctaBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.lg,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  ctaSlotCount: {
    ...typography.label,
    color: colors.foreground,
  },
  ctaTotal: {
    ...typography.h3,
    color: colors.foreground,
  },
  windowWarningBanner: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  windowWarningText: {
    ...typography.caption,
    color: '#b45309',
    lineHeight: 18,
  },
  policyAgreementText: {
    ...typography.caption,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  policyAgreementLink: {
    color: colors.mutedForeground,
    textDecorationLine: 'underline',
  },
  policyModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  policyModalContent: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 400,
  },
  policyModalTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  policyModalBox: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  policyModalText: {
    ...typography.bodySmall,
    color: '#1d4ed8',
    lineHeight: 20,
  },
  policyModalClose: {
    alignSelf: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary,
  },
  policyModalCloseText: {
    ...typography.bodySmall,
    color: colors.primaryForeground,
    fontWeight: '600',
  },
});

const periodStyles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  label: {
    ...typography.caption,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    color: colors.mutedForeground,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
});

const eventStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#bbf7d0', // green-200
    backgroundColor: '#f0fdf4', // green-50
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#dcfce7', // green-100
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 16,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexWrap: 'wrap',
  },
  eventName: {
    ...typography.label,
    color: colors.foreground,
    flexShrink: 1,
  },
  eventTime: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  bayRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  bayPill: {
    backgroundColor: '#dcfce7',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bayPillText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#15803d', // green-700
  },
  cardRight: {
    alignItems: 'flex-end',
    marginLeft: spacing.sm,
  },
  price: {
    ...typography.label,
    color: colors.foreground,
  },
  spots: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: colors.background,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: {
    ...typography.h2,
    color: colors.foreground,
    flex: 1,
    marginRight: spacing.md,
  },
  modalClose: {
    fontSize: 20,
    color: colors.mutedForeground,
    padding: spacing.sm,
  },
  modalContent: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  modalDescription: {
    ...typography.body,
    color: colors.foreground,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  detailLabel: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  detailValue: {
    ...typography.body,
    color: colors.foreground,
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.md,
  },
  membersOnlyBanner: {
    backgroundColor: '#fef3c7', // amber-100
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  membersOnlyText: {
    ...typography.label,
    color: '#92400e', // amber-800
  },
  modalFooter: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
});

const sheetStyles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    ...typography.h2,
    color: colors.foreground,
    flex: 1,
    marginRight: spacing.md,
  },
  headerClose: {
    fontSize: 20,
    color: colors.mutedForeground,
    padding: spacing.sm,
  },
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: colors.primary,
  },
  dotInactive: {
    backgroundColor: colors.border,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  footer: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? spacing['3xl'] : spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.md,
  },
  processingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  processingText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
  },
  successIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f0fdf4',
    borderWidth: 2,
    borderColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  successIconText: {
    fontSize: 28,
    color: '#22c55e',
    fontWeight: '700',
  },
  successTitle: {
    ...typography.h2,
    color: colors.foreground,
    textAlign: 'center',
  },
  successCode: {
    ...typography.h1,
    color: colors.foreground,
    fontFamily: 'monospace',
    letterSpacing: 2,
    textAlign: 'center',
  },
  successOldCode: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  successHint: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  secondaryButton: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  secondaryButtonText: {
    ...typography.label,
    color: colors.mutedForeground,
  },
});
