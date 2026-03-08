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
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { formatPrice, formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { colors, spacing, typography } from '../theme';
import type { MainTabParamList } from '../navigation/types';
import type { BayScheduleSlot, Bay } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Home'>;

interface SlotWithBay extends BayScheduleSlot {
  bay_schedules: {
    bay_id: string;
    date: string;
    bays: Bay;
  };
}

export function HomeScreen({ navigation }: Props) {
  const { organization, selectedLocation, bays, facilityGroups, standaloneBays, isDynamic } = useFacility();
  const { profile } = useAuth();
  const [todaySlots, setTodaySlots] = useState<SlotWithBay[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchTodaySlots = useCallback(async () => {
    if (!organization || !selectedLocation) return;

    const today = getTodayInTimezone(organization.timezone);
    let query = supabase
      .from('bay_schedule_slots')
      .select(`
        *,
        bay_schedules!inner (
          bay_id,
          date,
          bays!inner (*)
        )
      `)
      .eq('org_id', organization.id)
      .eq('location_id', selectedLocation.id)
      .eq('status', 'available')
      .eq('bay_schedules.date', today)
      .order('start_time')
      .limit(20);

    const { data } = await query;

    if (data) {
      setTodaySlots(data as unknown as SlotWithBay[]);
    }
    setLoading(false);
  }, [organization, selectedLocation]);

  useEffect(() => {
    fetchTodaySlots();
  }, [fetchTodaySlots]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTodaySlots();
    setRefreshing(false);
  };

  if (!organization) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const today = getTodayInTimezone(organization.timezone);

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
          <Text style={styles.quickActionIcon}>📅</Text>
          <Text style={styles.quickActionLabel}>Book Now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.quickAction}
          onPress={() => (navigation as any).navigate('Bookings')}
        >
          <Text style={styles.quickActionIcon}>📋</Text>
          <Text style={styles.quickActionLabel}>My Bookings</Text>
        </TouchableOpacity>
      </View>

      {/* Today's Availability */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available Today — {formatDate(today)}</Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
        ) : todaySlots.length === 0 ? (
          <Card>
            <Text style={styles.emptyText}>No available slots for today.</Text>
            <TouchableOpacity onPress={() => (navigation as any).navigate('Book')}>
              <Text style={styles.linkText}>Browse other dates →</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          todaySlots.slice(0, 8).map((slot) => (
            <TouchableOpacity
              key={slot.id}
              onPress={() =>
                (navigation as any).navigate('Book', {
                  date: today,
                  bayId: slot.bay_schedules.bay_id,
                })
              }
            >
              <Card style={styles.slotCard}>
                <View style={styles.slotRow}>
                  <View>
                    <Text style={styles.slotBay}>{slot.bay_schedules.bays.name}</Text>
                    <Text style={styles.slotTime}>
                      {formatTimeInZone(slot.start_time, organization.timezone)} –{' '}
                      {formatTimeInZone(slot.end_time, organization.timezone)}
                    </Text>
                  </View>
                  <View style={styles.slotRight}>
                    <Text style={styles.slotPrice}>{formatPrice(slot.price_cents)}</Text>
                    <Badge label="Available" variant="success" />
                  </View>
                </View>
              </Card>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* Facilities Info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          {isDynamic && facilityGroups.length > 0 ? 'Our Facilities' : 'Our Bays'}
        </Text>
        {isDynamic ? (
          <>
            {facilityGroups.map((group) => (
              <Card key={group.id} style={styles.bayCard}>
                <Text style={styles.bayName}>{group.name}</Text>
                <View style={styles.bayMeta}>
                  <Badge label={`${group.bays.length} available`} variant="muted" />
                  {group.bays[0]?.hourly_rate_cents && (
                    <Text style={styles.bayRate}>
                      from {formatPrice(group.bays[0].hourly_rate_cents)}/hr
                    </Text>
                  )}
                </View>
              </Card>
            ))}
            {standaloneBays.map((bay) => (
              <Card key={bay.id} style={styles.bayCard}>
                <Text style={styles.bayName}>{bay.name}</Text>
                <View style={styles.bayMeta}>
                  {bay.resource_type && (
                    <Badge label={bay.resource_type} variant="muted" />
                  )}
                  {bay.hourly_rate_cents && (
                    <Text style={styles.bayRate}>
                      {formatPrice(bay.hourly_rate_cents)}/hr
                    </Text>
                  )}
                </View>
              </Card>
            ))}
          </>
        ) : (
          bays.map((bay) => (
            <Card key={bay.id} style={styles.bayCard}>
              <Text style={styles.bayName}>{bay.name}</Text>
              <View style={styles.bayMeta}>
                {bay.resource_type && (
                  <Badge label={bay.resource_type} variant="muted" />
                )}
                {bay.hourly_rate_cents && (
                  <Text style={styles.bayRate}>
                    {formatPrice(bay.hourly_rate_cents)}/hr
                  </Text>
                )}
              </View>
            </Card>
          ))
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
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: spacing.lg,
    alignItems: 'center',
  },
  quickActionIcon: {
    fontSize: 28,
    marginBottom: spacing.sm,
  },
  quickActionLabel: {
    ...typography.button,
    color: colors.primaryForeground,
  },
  section: {
    marginBottom: spacing['2xl'],
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  slotCard: {
    marginBottom: spacing.sm,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slotBay: {
    ...typography.label,
    color: colors.foreground,
  },
  slotTime: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  slotRight: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  slotPrice: {
    ...typography.label,
    color: colors.foreground,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
    marginBottom: spacing.sm,
  },
  linkText: {
    ...typography.label,
    color: colors.primary,
  },
  bayCard: {
    marginBottom: spacing.sm,
  },
  bayName: {
    ...typography.label,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  bayMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bayRate: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});
