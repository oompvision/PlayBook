import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import { Badge } from '../components/Badge';
import { formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { colors, spacing, typography } from '../theme';
import type { MainTabParamList } from '../navigation/types';
import type { Booking, Bay } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const { organization, selectedLocation, bays, facilityGroups, standaloneBays, isDynamic } = useFacility();
  const { user, profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [upcomingBookings, setUpcomingBookings] = useState<Booking[]>([]);
  const [earliestDates, setEarliestDates] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!organization || !selectedLocation) return;

    const today = getTodayInTimezone(organization.timezone);
    const now = new Date().toISOString();

    const promises: Promise<void>[] = [];

    // Fetch upcoming bookings (up to 3, confirmed, today or later, not yet ended)
    if (user) {
      promises.push(
        (async () => {
          const { data } = await supabase
            .from('bookings')
            .select('*, bays(*)')
            .eq('org_id', organization.id)
            .eq('customer_id', user.id)
            .eq('status', 'confirmed')
            .gte('date', today)
            .gte('end_time', now)
            .order('date', { ascending: true })
            .order('start_time', { ascending: true })
            .limit(3);

          if (data) {
            setUpcomingBookings(data as unknown as Booking[]);
          }
        })()
      );
    }

    // Fetch earliest available date per bay (slot-based)
    if (!isDynamic) {
      promises.push(
        (async () => {
          const { data } = await supabase
            .from('bay_schedule_slots')
            .select('bay_schedules!inner(bay_id, date)')
            .eq('org_id', organization.id)
            .eq('location_id', selectedLocation.id)
            .eq('status', 'available')
            .gte('end_time', now)
            .order('start_time', { ascending: true });

          if (data) {
            const dateMap: Record<string, string> = {};
            for (const slot of data as any[]) {
              const bayId = slot.bay_schedules.bay_id;
              const date = slot.bay_schedules.date;
              if (!dateMap[bayId] || date < dateMap[bayId]) {
                dateMap[bayId] = date;
              }
            }
            setEarliestDates(dateMap);
          }
        })()
      );
    }

    await Promise.all(promises);
    setLoading(false);
  }, [organization, selectedLocation, user, isDynamic]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  // For dynamic scheduling, determine today or tomorrow
  const getDynamicDate = (): string => {
    if (!organization) return '';
    const today = getTodayInTimezone(organization.timezone);
    const nowInTz = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      hour12: false,
      timeZone: organization.timezone,
    }).format(new Date());
    const hour = parseInt(nowInTz, 10);
    if (hour >= 22) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: organization.timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(tomorrow);
    }
    return today;
  };

  if (!organization) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const [heroBooking, ...restBookings] = upcomingBookings;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>
          {profile?.full_name ? `Hi, ${profile.full_name.split(' ')[0]}` : 'Welcome'}
        </Text>
        <Text style={styles.facilityName}>
          {selectedLocation && selectedLocation.name !== organization.name
            ? `${organization.name} — ${selectedLocation.name}`
            : organization.name}
        </Text>
      </View>

      {/* Hero: Next Up */}
      {heroBooking && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Next Up</Text>
          <TouchableOpacity
            style={styles.heroCard}
            activeOpacity={0.9}
            onPress={() =>
              (navigation as any).navigate('Bookings', {
                expandBookingId: heroBooking.id,
              })
            }
          >
            <Text style={styles.heroTitle}>
              {heroBooking.bays?.name ?? 'Booking'}
            </Text>
            <Text style={styles.heroTime}>
              {formatDate(heroBooking.date)} &middot;{' '}
              {formatTimeInZone(heroBooking.start_time, organization.timezone)} –{' '}
              {formatTimeInZone(heroBooking.end_time, organization.timezone)}
            </Text>
            <View style={styles.heroFooter}>
              <Text style={styles.heroCode}>{heroBooking.confirmation_code}</Text>
              <Text style={styles.heroView}>View →</Text>
            </View>
          </TouchableOpacity>

          {/* Remaining upcoming bookings */}
          {restBookings.map((booking) => (
            <TouchableOpacity
              key={booking.id}
              style={styles.upcomingCard}
              activeOpacity={0.85}
              onPress={() =>
                (navigation as any).navigate('Bookings', {
                  expandBookingId: booking.id,
                })
              }
            >
              <View style={styles.upcomingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.upcomingBay}>
                    {booking.bays?.name ?? 'Booking'}
                  </Text>
                  <Text style={styles.upcomingDetails}>
                    {formatDate(booking.date)} &middot;{' '}
                    {formatTimeInZone(booking.start_time, organization.timezone)} –{' '}
                    {formatTimeInZone(booking.end_time, organization.timezone)}
                  </Text>
                  <Text style={styles.upcomingCode}>{booking.confirmation_code}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.mutedForeground} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickCard}
          activeOpacity={0.85}
          onPress={() => (navigation as any).navigate('Book')}
        >
          <Ionicons name="calendar" size={22} color="#166534" style={{ marginBottom: 6 }} />
          <Text style={styles.quickText}>Book Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickCard}
          activeOpacity={0.85}
          onPress={() => (navigation as any).navigate('Bookings')}
        >
          <Ionicons name="list" size={22} color="#166534" style={{ marginBottom: 6 }} />
          <Text style={styles.quickText}>Bookings</Text>
        </TouchableOpacity>
      </View>

      {/* Available to Book */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Book</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : isDynamic ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {facilityGroups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={styles.bookingCard}
                activeOpacity={0.85}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: getDynamicDate(),
                    facilityGroupId: group.id,
                  })
                }
              >
                <Text style={styles.bookingTitle}>{group.name}</Text>
                <Text style={styles.bookingSub}>{group.bays.length} available</Text>
              </TouchableOpacity>
            ))}
            {standaloneBays.map((bay) => (
              <TouchableOpacity
                key={bay.id}
                style={styles.bookingCard}
                activeOpacity={0.85}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: getDynamicDate(),
                    bayId: bay.id,
                  })
                }
              >
                <Text style={styles.bookingTitle}>{bay.name}</Text>
                {bay.resource_type && (
                  <Text style={styles.bookingSub}>{bay.resource_type}</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : bays.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {bays.map((bay) => (
              <TouchableOpacity
                key={bay.id}
                style={styles.bookingCard}
                activeOpacity={0.85}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: earliestDates[bay.id] || getTodayInTimezone(organization.timezone),
                    bayId: bay.id,
                  })
                }
              >
                <Text style={styles.bookingTitle}>{bay.name}</Text>
                {bay.resource_type && (
                  <Text style={styles.bookingSub}>{bay.resource_type}</Text>
                )}
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No facilities available at this time.</Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAF9',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: 10,
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    color: '#111',
  },
  facilityName: {
    fontSize: 14,
    color: '#6B7280',
    marginTop: 4,
  },
  section: {
    marginTop: 25,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 12,
    color: '#111',
  },
  /* Hero card */
  heroCard: {
    backgroundColor: colors.primary,
    borderRadius: 20,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'white',
  },
  heroTime: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 6,
  },
  heroFooter: {
    marginTop: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  heroCode: {
    color: 'white',
    fontWeight: '600',
  },
  heroView: {
    color: 'white',
    opacity: 0.8,
  },
  /* Upcoming booking cards (non-hero) */
  upcomingCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    marginTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  upcomingBay: {
    ...typography.label,
    color: colors.foreground,
  },
  upcomingDetails: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  upcomingCode: {
    ...typography.bodySmall,
    color: colors.primary,
    marginTop: 2,
    fontWeight: '600',
  },
  /* Quick Actions */
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
    gap: 12,
  },
  quickCard: {
    flex: 1,
    backgroundColor: '#E7F5EC',
    padding: 18,
    borderRadius: 16,
    alignItems: 'flex-start',
  },
  quickText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#166534',
  },
  /* Horizontal booking cards */
  bookingCard: {
    width: 160,
    backgroundColor: 'white',
    padding: 16,
    borderRadius: 16,
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bookingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  bookingSub: {
    fontSize: 13,
    color: '#6B7280',
    marginTop: 6,
  },
  emptyCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
});
