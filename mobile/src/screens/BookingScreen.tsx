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
import { useMembership } from '../lib/use-membership';
import { supabase } from '../lib/supabase';
import { fetchDynamicAvailability, pickBayForGroupBooking } from '../lib/availability';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Input } from '../components/Input';
import { formatPrice, formatTimeInZone, getTodayInTimezone, formatDate } from '../lib/format';
import { colors, spacing, typography, borderRadius } from '../theme';
import type { MainTabParamList } from '../navigation/types';
import type { Bay, BayScheduleSlot, FacilityGroup, AvailableTimeSlot } from '../types';

type Props = NativeStackScreenProps<MainTabParamList, 'Book'>;

interface SlotWithSchedule extends BayScheduleSlot {
  bay_schedule_id: string;
}

// A "bookable option" is either a facility group or a standalone bay
type BookableOption =
  | { type: 'group'; group: FacilityGroup }
  | { type: 'bay'; bay: Bay };

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
  const { bookableWindowDays } = useMembership();
  const initialDate = (route.params as any)?.date;
  const initialBayId = (route.params as any)?.bayId;

  const [selectedDate, setSelectedDate] = useState<string>(
    initialDate || (organization ? getTodayInTimezone(organization.timezone) : '')
  );

  // Slot-based state
  const [selectedBay, setSelectedBay] = useState<Bay | null>(
    initialBayId ? bays.find((b) => b.id === initialBayId) || null : null
  );

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

  const [loading, setLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

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

  // Auto-select first option for dynamic if only one exists
  useEffect(() => {
    if (isDynamic && bookableOptions.length > 0 && !selectedOption) {
      setSelectedOption(bookableOptions[0]);
    }
  }, [isDynamic, bookableOptions, selectedOption]);

  // Update selected duration when available durations change
  useEffect(() => {
    if (availableDurations.length > 0 && !availableDurations.includes(selectedDuration)) {
      setSelectedDuration(availableDurations[0]);
    }
  }, [availableDurations]);

  // Generate date options based on effective bookable window (membership-aware)
  const dateOptions = React.useMemo(() => {
    if (!organization) return [];
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

  // Fetch on changes
  useEffect(() => {
    if (isDynamic) {
      fetchDynamicSlots();
    } else {
      fetchSlotBasedSlots();
    }
  }, [isDynamic, fetchDynamicSlots, fetchSlotBasedSlots]);

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

  // ─── Booking handlers ─────────────────────────────────

  const handleSlotBasedBook = async () => {
    if (!user || !organization || !selectedBay || selectedSlots.length === 0) return;

    setBooking(true);
    const { data, error } = await supabase.rpc('create_booking', {
      p_org_id: organization.id,
      p_customer_id: user.id,
      p_bay_id: selectedBay.id,
      p_date: selectedDate,
      p_slot_ids: selectedSlots.map((s) => s.id),
      p_notes: notes || null,
      p_location_id: selectedLocation?.id || null,
    });
    setBooking(false);

    if (error) {
      Alert.alert('Booking Failed', error.message);
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    showBookingSuccess(result?.confirmation_code);
  };

  const handleDynamicBook = async () => {
    if (!user || !organization || !selectedOption || !selectedDynamicSlot) return;

    setBooking(true);

    let targetBayId: string | null = null;

    if (selectedOption.type === 'group') {
      // Consolidation: pick the best bay from the group
      targetBayId = await pickBayForGroupBooking({
        bayIds: selectedOption.group.bays.map((b) => b.id),
        date: selectedDate,
        startTime: selectedDynamicSlot.start_time,
        endTime: selectedDynamicSlot.end_time,
        timezone: organization.timezone,
      });

      if (!targetBayId) {
        setBooking(false);
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
    });
    setBooking(false);

    if (error) {
      Alert.alert('Booking Failed', error.message);
      return;
    }

    const result = typeof data === 'object' && data !== null ? data : {};
    showBookingSuccess((result as any)?.confirmation_code);
  };

  const showBookingSuccess = (confirmationCode?: string) => {
    const code = confirmationCode || 'Confirmed';
    Alert.alert('Booking Confirmed!', `Your confirmation code is ${code}`, [
      {
        text: 'View My Bookings',
        onPress: () => {
          resetSelection();
          (navigation as any).navigate('Bookings');
        },
      },
      {
        text: 'OK',
        onPress: () => {
          resetSelection();
          if (isDynamic) fetchDynamicSlots();
          else fetchSlotBasedSlots();
        },
      },
    ]);
  };

  const resetSelection = () => {
    setSelectedSlotIds(new Set());
    setSelectedDynamicSlot(null);
    setShowConfirm(false);
    setNotes('');
  };

  const handleBook = isDynamic ? handleDynamicBook : handleSlotBasedBook;
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

        {/* Facility / Bay Picker */}
        {isDynamic ? (
          <>
            <Text style={styles.sectionTitle}>Select Facility</Text>
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

            {/* Duration Picker */}
            {availableDurations.length > 1 && (
              <>
                <Text style={styles.sectionTitle}>Duration</Text>
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
              </>
            )}
          </>
        ) : (
          <>
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
          </>
        )}

        {/* Time Slots */}
        {isDynamic ? (
          selectedOption ? (
            <>
              <Text style={styles.sectionTitle}>
                Available Times — {formatDate(selectedDate)}
              </Text>
              {loading ? (
                <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
              ) : dynamicSlots.length === 0 ? (
                <Card>
                  <Text style={styles.emptyText}>No available times for this date.</Text>
                </Card>
              ) : (
                <View style={styles.slotsGrid}>
                  {dynamicSlots.map((slot) => {
                    const isSelected = selectedDynamicSlot?.start_time === slot.start_time;
                    return (
                      <TouchableOpacity
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
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          ) : (
            <Card style={{ marginTop: spacing.lg }}>
              <Text style={styles.emptyText}>Select a facility to view available times.</Text>
            </Card>
          )
        ) : selectedBay ? (
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
        {showConfirm && hasSelection && (
          <View style={styles.confirmPanel}>
            <Text style={styles.sectionTitle}>Booking Summary</Text>
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
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  durationChipText: {
    ...typography.label,
    color: colors.foreground,
  },
  durationChipTextSelected: {
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
