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
import Svg, { Path } from 'react-native-svg';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { BookIcon, BookingsIcon } from '../components/TabIcons';
import { formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { colors, spacing, typography } from '../theme';
import type { MainTabParamList } from '../navigation/types';
import type { Booking, Bay } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Home'>;

function ChevronRight({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 18l6-6-6-6"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function HomeScreen({ navigation }: Props) {
  const { organization, selectedLocation, bays, facilityGroups, standaloneBays, isDynamic } = useFacility();
  const { user, profile } = useAuth();
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
    // Check current hour in facility timezone — if past 10 PM, use tomorrow
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
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
        {(selectedLocation?.address || organization.address) && (
          <Text style={styles.address}>{selectedLocation?.address || organization.address}</Text>
        )}
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => (navigation as any).navigate('Book')}
        >
          <BookIcon size={30} color={colors.primary} />
          <Text style={styles.quickActionLabel}>Book Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => (navigation as any).navigate('Bookings')}
        >
          <BookingsIcon size={30} color={colors.primary} />
          <Text style={styles.quickActionLabel}>My Bookings</Text>
        </TouchableOpacity>
      </View>

      {/* Upcoming for you */}
      {upcomingBookings.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Upcoming for you</Text>
          {upcomingBookings.map((booking) => (
            <TouchableOpacity
              key={booking.id}
              onPress={() =>
                (navigation as any).navigate('Bookings', {
                  expandBookingId: booking.id,
                })
              }
            >
              <Card style={styles.upcomingCard}>
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
                  <ChevronRight size={20} color={colors.mutedForeground} />
                </View>
              </Card>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Available to Book */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available to Book</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : isDynamic ? (
          <>
            {facilityGroups.map((group) => (
              <TouchableOpacity
                key={group.id}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: getDynamicDate(),
                    facilityGroupId: group.id,
                  })
                }
              >
                <Card style={styles.facilityCard}>
                  <View style={styles.facilityRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.facilityName2}>{group.name}</Text>
                      <View style={styles.facilityMeta}>
                        <Badge label={`${group.bays.length} available`} variant="muted" />
                      </View>
                    </View>
                    <ChevronRight size={20} color={colors.mutedForeground} />
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
            {standaloneBays.map((bay) => (
              <TouchableOpacity
                key={bay.id}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: getDynamicDate(),
                    bayId: bay.id,
                  })
                }
              >
                <Card style={styles.facilityCard}>
                  <View style={styles.facilityRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.facilityName2}>{bay.name}</Text>
                      {bay.resource_type && (
                        <View style={styles.facilityMeta}>
                          <Badge label={bay.resource_type} variant="muted" />
                        </View>
                      )}
                    </View>
                    <ChevronRight size={20} color={colors.mutedForeground} />
                  </View>
                </Card>
              </TouchableOpacity>
            ))}
          </>
        ) : (
          bays.length > 0 ? (
            bays.map((bay) => (
              <TouchableOpacity
                key={bay.id}
                onPress={() =>
                  (navigation as any).navigate('Book', {
                    date: earliestDates[bay.id] || getTodayInTimezone(organization.timezone),
                    bayId: bay.id,
                  })
                }
              >
                <Card style={styles.facilityCard}>
                  <View style={styles.facilityRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.facilityName2}>{bay.name}</Text>
                      {bay.resource_type && (
                        <View style={styles.facilityMeta}>
                          <Badge label={bay.resource_type} variant="muted" />
                        </View>
                      )}
                    </View>
                    <ChevronRight size={20} color={colors.mutedForeground} />
                  </View>
                </Card>
              </TouchableOpacity>
            ))
          ) : (
            <Card>
              <Text style={styles.emptyText}>No facilities available at this time.</Text>
            </Card>
          )
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['5xl'],
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    marginBottom: spacing['2xl'],
    paddingTop: spacing.sm,
  },
  greeting: {
    ...typography.h2,
    color: colors.foreground,
  },
  facilityName: {
    ...typography.h3,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  address: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  quickActions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing['2xl'],
  },
  quickAction: {
    flex: 1,
    backgroundColor: colors.selectionBg,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
  },
  quickActionLabel: {
    marginTop: spacing.sm,
    ...typography.button,
    color: colors.primary,
  },
  section: {
    marginBottom: spacing['2xl'],
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  // Upcoming booking cards
  upcomingCard: {
    marginBottom: spacing.sm,
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
  // Facility / Available to Book cards
  facilityCard: {
    marginBottom: spacing.sm,
  },
  facilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  facilityName2: {
    ...typography.label,
    color: colors.foreground,
  },
  facilityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
});
