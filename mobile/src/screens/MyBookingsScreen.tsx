import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
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
import type { Booking } from '../types';

export function MyBookingsScreen() {
  const { organization, selectedLocation } = useFacility();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBookings = useCallback(async () => {
    if (!user || !organization) return;

    const { data } = await supabase
      .from('bookings')
      .select('*, bays(*), organizations(*)')
      .eq('customer_id', user.id)
      .eq('org_id', organization.id)
      .order('date', { ascending: false })
      .order('start_time', { ascending: false });

    if (data) {
      setBookings(data as Booking[]);
    }
    setLoading(false);
  }, [user, organization]);

  useEffect(() => {
    fetchBookings();
  }, [fetchBookings]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchBookings();
    setRefreshing(false);
  };

  const handleCancel = (booking: Booking) => {
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
              fetchBookings();
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

  const upcomingBookings = bookings.filter(
    (b) => b.status === 'confirmed' && b.date >= new Date().toISOString().slice(0, 10)
  );
  const pastBookings = bookings.filter(
    (b) => b.status !== 'confirmed' || b.date < new Date().toISOString().slice(0, 10)
  );

  const renderBooking = ({ item }: { item: Booking }) => {
    const tz = organization?.timezone || 'America/New_York';
    const isUpcoming = item.status === 'confirmed' && item.date >= new Date().toISOString().slice(0, 10);

    return (
      <Card style={styles.bookingCard}>
        <View style={styles.bookingHeader}>
          <Text style={styles.confirmationCode}>{item.confirmation_code}</Text>
          <Badge
            label={item.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
            variant={item.status === 'confirmed' ? 'success' : 'destructive'}
          />
        </View>

        <Text style={styles.bookingDate}>{formatDateLong(item.date)}</Text>
        <Text style={styles.bookingTime}>
          {formatTimeInZone(item.start_time, tz)} – {formatTimeInZone(item.end_time, tz)}
        </Text>

        {item.bays && <Text style={styles.bookingBay}>{item.bays.name}</Text>}

        <View style={styles.bookingFooter}>
          <Text style={styles.bookingPrice}>{formatPrice(item.total_price_cents)}</Text>
          {isUpcoming && (
            <Button
              title="Cancel"
              variant="destructive"
              size="sm"
              onPress={() => handleCancel(item)}
            />
          )}
        </View>

        {item.notes && <Text style={styles.bookingNotes}>Note: {item.notes}</Text>}
      </Card>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={[...upcomingBookings, ...pastBookings]}
        renderItem={renderBooking}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <EmptyState
            title="No bookings yet"
            description="Book a time slot to get started!"
          />
        }
        ListHeaderComponent={
          upcomingBookings.length > 0 ? (
            <Text style={styles.sectionHeader}>Upcoming</Text>
          ) : null
        }
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
  },
  bookingCard: {
    marginBottom: spacing.md,
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
