import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SectionList,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { formatPrice, formatTimeInZone, formatDateLong } from '../lib/format';
import { colors, spacing, typography } from '../theme';
import type { Booking, EventRegistration } from '../types';

type FeedItem =
  | { kind: 'booking'; sortDate: string; booking: Booking }
  | { kind: 'event'; sortDate: string; registration: EventRegistration };

export function MyBookingsScreen() {
  const { organization } = useFacility();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [eventRegistrations, setEventRegistrations] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user || !organization) return;

    const [bookingsResult, eventsResult] = await Promise.all([
      supabase
        .from('bookings')
        .select('*, bays(*), organizations(*)')
        .eq('customer_id', user.id)
        .eq('org_id', organization.id)
        .order('date', { ascending: false })
        .order('start_time', { ascending: false }),
      supabase
        .from('event_registrations')
        .select(`
          id,
          event_id,
          org_id,
          status,
          waitlist_position,
          payment_status,
          registered_at,
          cancelled_at,
          promoted_at,
          events:event_id (
            name,
            description,
            start_time,
            end_time,
            price_cents,
            capacity,
            status,
            event_bays (bay_id, bays:bay_id (name))
          )
        `)
        .eq('org_id', organization.id)
        .eq('user_id', user.id)
        .order('registered_at', { ascending: false }),
    ]);

    if (bookingsResult.data) setBookings(bookingsResult.data as Booking[]);
    if (eventsResult.data) setEventRegistrations(eventsResult.data as unknown as EventRegistration[]);
    setLoading(false);
  }, [user, organization]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const handleCancelBooking = (booking: Booking) => {
    Alert.alert(
      'Cancel Booking',
      `Cancel booking ${booking.confirmation_code}?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('cancel_booking', {
              p_booking_id: booking.id,
            });
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Cancelled', `Booking ${booking.confirmation_code} has been cancelled.`);
              fetchData();
            }
          },
        },
      ]
    );
  };

  const handleCancelRegistration = (reg: EventRegistration) => {
    const eventName = reg.events?.name ?? 'this event';
    Alert.alert(
      'Cancel Registration',
      `Cancel your registration for ${eventName}?`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.rpc('cancel_event_registration', {
              p_registration_id: reg.id,
            });
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              Alert.alert('Cancelled', `Your registration for ${eventName} has been cancelled.`);
              fetchData();
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const tz = organization?.timezone || 'America/New_York';

  // Build unified feed items
  const upcomingBookingItems: FeedItem[] = bookings
    .filter((b) => b.status === 'confirmed' && b.date >= todayStr)
    .map((b) => ({ kind: 'booking' as const, sortDate: b.start_time, booking: b }));

  const pastBookingItems: FeedItem[] = bookings
    .filter((b) => b.status !== 'confirmed' || b.date < todayStr)
    .map((b) => ({ kind: 'booking' as const, sortDate: b.start_time, booking: b }));

  const upcomingEventItems: FeedItem[] = eventRegistrations
    .filter((r) => r.status !== 'cancelled' && r.events && new Date(r.events.end_time) >= now)
    .map((r) => ({ kind: 'event' as const, sortDate: r.events!.start_time, registration: r }));

  const pastEventItems: FeedItem[] = eventRegistrations
    .filter((r) => r.status === 'cancelled' || (r.events && new Date(r.events.end_time) < now))
    .filter((r) => r.events !== null)
    .map((r) => ({ kind: 'event' as const, sortDate: r.events!.start_time, registration: r }));

  // Upcoming: closest to now first (ascending)
  const upcoming = [...upcomingBookingItems, ...upcomingEventItems]
    .sort((a, b) => new Date(a.sortDate).getTime() - new Date(b.sortDate).getTime());

  // Past: most recent first (descending)
  const past = [...pastBookingItems, ...pastEventItems]
    .sort((a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime());

  const sections = [
    ...(upcoming.length > 0 ? [{ title: 'Upcoming', data: upcoming }] : []),
    ...(past.length > 0 ? [{ title: 'Past & Cancelled', data: past }] : []),
  ];

  const getBayNames = (reg: EventRegistration): string => {
    if (!reg.events?.event_bays) return '';
    return reg.events.event_bays
      .map((eb) => {
        if (Array.isArray(eb.bays)) return eb.bays[0]?.name;
        return eb.bays?.name;
      })
      .filter(Boolean)
      .join(', ');
  };

  const getEventStatusBadge = (reg: EventRegistration): { label: string; variant: 'success' | 'warning' | 'destructive' | 'default' | 'muted' } => {
    switch (reg.status) {
      case 'confirmed':
        return { label: 'Confirmed', variant: 'success' };
      case 'waitlisted':
        return { label: `Waitlisted${reg.waitlist_position ? ` #${reg.waitlist_position}` : ''}`, variant: 'default' };
      case 'pending_payment':
        return { label: 'Payment Pending', variant: 'warning' };
      case 'cancelled':
        return { label: 'Cancelled', variant: 'destructive' };
      default:
        return { label: reg.status, variant: 'muted' };
    }
  };

  const renderItem = ({ item, section }: { item: FeedItem; section: { title: string } }) => {
    const isUpcoming = section.title === 'Upcoming';

    if (item.kind === 'booking') {
      const booking = item.booking;
      return (
        <Card style={[styles.bookingCard, !isUpcoming && styles.pastCard]}>
          <View style={styles.bookingHeader}>
            <Text style={styles.confirmationCode}>{booking.confirmation_code}</Text>
            <Badge
              label={booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
              variant={booking.status === 'confirmed' ? 'success' : 'destructive'}
            />
          </View>

          <Text style={styles.bookingDate}>{formatDateLong(booking.date)}</Text>
          <Text style={styles.bookingTime}>
            {formatTimeInZone(booking.start_time, tz)} – {formatTimeInZone(booking.end_time, tz)}
          </Text>

          {booking.bays && <Text style={styles.bookingBay}>{booking.bays.name}</Text>}

          <View style={styles.bookingFooter}>
            <Text style={styles.bookingPrice}>{formatPrice(booking.total_price_cents)}</Text>
            {isUpcoming && (
              <Button
                title="Cancel"
                variant="destructive"
                size="sm"
                onPress={() => handleCancelBooking(booking)}
              />
            )}
          </View>

          {booking.notes && <Text style={styles.bookingNotes}>Note: {booking.notes}</Text>}
        </Card>
      );
    }

    // Event registration
    const reg = item.registration;
    const evt = reg.events;
    if (!evt) return null;

    const bayNames = getBayNames(reg);
    const statusBadge = getEventStatusBadge(reg);
    const canCancel = isUpcoming && reg.status !== 'cancelled';

    return (
      <Card style={[styles.bookingCard, !isUpcoming && styles.pastCard]}>
        <View style={styles.bookingHeader}>
          <Badge label="Event" variant="default" />
          <Badge label={statusBadge.label} variant={statusBadge.variant} />
        </View>

        <Text style={styles.eventName}>{evt.name}</Text>
        <Text style={styles.bookingDate}>
          {new Date(evt.start_time).toLocaleDateString('en-US', {
            timeZone: tz,
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
          })}
        </Text>
        <Text style={styles.bookingTime}>
          {formatTimeInZone(evt.start_time, tz)} – {formatTimeInZone(evt.end_time, tz)}
        </Text>

        {bayNames ? <Text style={styles.bookingBay}>{bayNames}</Text> : null}

        <View style={styles.bookingFooter}>
          <Text style={styles.bookingPrice}>
            {evt.price_cents > 0 ? formatPrice(evt.price_cents) : 'Free'}
          </Text>
          {canCancel && (
            <Button
              title="Cancel"
              variant="destructive"
              size="sm"
              onPress={() => handleCancelRegistration(reg)}
            />
          )}
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={({ section: { title } }) => (
          <Text style={styles.sectionHeader}>{title}</Text>
        )}
        keyExtractor={(item) =>
          item.kind === 'booking' ? item.booking.id : item.registration.id
        }
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            title="No bookings yet"
            description="Book a time slot or register for an event to get started!"
          />
        }
        stickySectionHeadersEnabled={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  sectionHeader: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
    marginTop: spacing.md,
  },
  bookingCard: {
    marginBottom: spacing.md,
  },
  pastCard: {
    opacity: 0.6,
  },
  bookingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  confirmationCode: {
    ...typography.label,
    color: colors.foreground,
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  eventName: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: 4,
  },
  bookingDate: {
    ...typography.body,
    color: colors.foreground,
  },
  bookingTime: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  bookingBay: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  bookingFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bookingPrice: {
    ...typography.h3,
    color: colors.foreground,
  },
  bookingNotes: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
});
