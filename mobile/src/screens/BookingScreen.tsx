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
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { supabase } from '../lib/supabase';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Input } from '../components/Input';
import { formatPrice, formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { colors, spacing, typography, borderRadius } from '../theme';
import type { MainTabParamList } from '../navigation/types';
import type { Bay, BayScheduleSlot } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Book'>;

interface SlotWithSchedule extends BayScheduleSlot {
  bay_schedule_id: string;
}

export function BookingScreen({ route, navigation }: Props) {
  const { organization, bays } = useFacility();
  const { user, profile } = useAuth();
  const initialDate = (route.params as any)?.date;
  const initialBayId = (route.params as any)?.bayId;

  const [selectedDate, setSelectedDate] = useState<string>(
    initialDate || (organization ? getTodayInTimezone(organization.timezone) : '')
  );
  const [selectedBay, setSelectedBay] = useState<Bay | null>(
    initialBayId ? bays.find((b) => b.id === initialBayId) || null : null
  );
  const [slots, setSlots] = useState<SlotWithSchedule[]>([]);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  // Generate date options (today + next 6 days)
  const dateOptions = React.useMemo(() => {
    if (!organization) return [];
    const dates: string[] = [];
    const now = new Date();
    for (let i = 0; i < 7; i++) {
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
  }, [organization]);

  useEffect(() => {
    if (!selectedDate && dateOptions.length > 0) {
      setSelectedDate(dateOptions[0]);
    }
  }, [dateOptions, selectedDate]);

  const fetchSlots = useCallback(async () => {
    if (!organization || !selectedBay || !selectedDate) return;

    setLoading(true);
    setSelectedSlotIds(new Set());

    const { data } = await supabase
      .from('bay_schedule_slots')
      .select('*, bay_schedules!inner(bay_id, date)')
      .eq('org_id', organization.id)
      .eq('bay_schedules.bay_id', selectedBay.id)
      .eq('bay_schedules.date', selectedDate)
      .eq('status', 'available')
      .order('start_time');

    setSlots((data as unknown as SlotWithSchedule[]) || []);
    setLoading(false);
  }, [organization, selectedBay, selectedDate]);

  useEffect(() => {
    fetchSlots();
  }, [fetchSlots]);

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
  const totalCents = selectedSlots.reduce((sum, s) => sum + s.price_cents, 0);

  const handleBook = async () => {
    if (!user || !organization || !selectedBay || selectedSlots.length === 0) return;

    setBooking(true);
    const { data, error } = await supabase.rpc('create_booking', {
      p_org_id: organization.id,
      p_customer_id: user.id,
      p_bay_id: selectedBay.id,
      p_date: selectedDate,
      p_slot_ids: selectedSlots.map((s) => s.id),
      p_notes: notes || null,
    });
    setBooking(false);

    if (error) {
      Alert.alert('Booking Failed', error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    const code = result?.confirmation_code || 'Confirmed';

    Alert.alert('Booking Confirmed!', `Your confirmation code is ${code}`, [
      {
        text: 'View My Bookings',
        onPress: () => {
          setSelectedSlotIds(new Set());
          setShowConfirm(false);
          (navigation as any).navigate('Bookings');
        },
      },
      {
        text: 'OK',
        onPress: () => {
          setSelectedSlotIds(new Set());
          setShowConfirm(false);
          fetchSlots();
        },
      },
    ]);
  };

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
        {/* Date Picker */}
        <Text style={styles.sectionTitle}>Select Date</Text>
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

        {/* Bay Picker */}
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

        {/* Slots */}
        {selectedBay ? (
          <>
            <Text style={styles.sectionTitle}>
              Available Slots — {formatDate(selectedDate)}
            </Text>
            {loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
            ) : slots.length === 0 ? (
              <Card>
                <Text style={styles.emptyText}>No available slots for this date and bay.</Text>
              </Card>
            ) : (
              <View style={styles.slotsGrid}>
                {slots.map((slot) => {
                  const isSelected = selectedSlotIds.has(slot.id);
                  return (
                    <TouchableOpacity
                      key={slot.id}
                      onPress={() => toggleSlot(slot.id)}
                      style={[styles.slotChip, isSelected && styles.slotChipSelected]}
                    >
                      <Text style={[styles.slotTime, isSelected && styles.slotTimeSelected]}>
                        {formatTimeInZone(slot.start_time, organization.timezone)}
                      </Text>
                      <Text style={[styles.slotPrice, isSelected && styles.slotPriceSelected]}>
                        {formatPrice(slot.price_cents)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        ) : (
          <Card style={{ marginTop: spacing.lg }}>
            <Text style={styles.emptyText}>Select a bay to view available time slots.</Text>
          </Card>
        )}

        {/* Booking confirmation panel */}
        {showConfirm && selectedSlots.length > 0 && (
          <View style={styles.confirmPanel}>
            <Text style={styles.sectionTitle}>Booking Summary</Text>
            <Card>
              <Text style={styles.summaryBay}>{selectedBay?.name}</Text>
              <Text style={styles.summaryDate}>{formatDate(selectedDate)}</Text>
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
              <View style={styles.summaryTotal}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalPrice}>{formatPrice(totalCents)}</Text>
              </View>
            </Card>

            <Input
              label="Notes (optional)"
              placeholder="Any special requests?"
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={2}
            />

            <Button
              title="Confirm Booking"
              onPress={handleBook}
              loading={booking}
              size="lg"
            />
          </View>
        )}
      </ScrollView>

      {/* Bottom CTA bar */}
      {selectedSlots.length > 0 && !showConfirm && (
        <View style={styles.ctaBar}>
          <View>
            <Text style={styles.ctaSlotCount}>
              {selectedSlots.length} slot{selectedSlots.length > 1 ? 's' : ''} selected
            </Text>
            <Text style={styles.ctaTotal}>{formatPrice(totalCents)}</Text>
          </View>
          {user ? (
            <Button title="Continue to Book" onPress={() => setShowConfirm(true)} />
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
    marginTop: spacing.lg,
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
    backgroundColor: colors.primary,
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
    color: colors.primaryForeground,
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
    backgroundColor: colors.primary,
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
    color: colors.primaryForeground,
  },
  slotsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  slotChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    minWidth: 100,
    alignItems: 'center',
  },
  slotChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  slotTime: {
    ...typography.label,
    color: colors.foreground,
  },
  slotTimeSelected: {
    color: colors.primaryForeground,
  },
  slotPrice: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  slotPriceSelected: {
    color: colors.primaryForeground,
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
});
