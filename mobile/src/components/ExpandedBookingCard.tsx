import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { formatPrice, formatTimeInZone, formatDateLong } from '../lib/format';
import { Badge } from './Badge';
import { Button } from './Button';
import { colors, spacing, borderRadius, typography } from '../theme';
import type { Booking, ModifiedFromInfo } from '../types';

// Enable LayoutAnimation on Android
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface SlotDetail {
  start_time: string;
  end_time: string;
  price_cents: number;
}

interface PaymentInfo {
  status: string;
  amount_cents: number;
  refunded_amount_cents: number;
  cancellation_policy_text: string | null;
  stripe_payment_intent_id: string | null;
}

interface Props {
  booking: Booking;
  timezone: string;
  cancellationWindowHours: number | null;
  hasPaymentMode: boolean;
  canModify: boolean;
  onModify: () => void;
  onCancelled: () => void;
  onCollapse: () => void;
}

function isInsideCancellationWindow(
  bookingStartTime: string,
  windowHours: number
): boolean {
  const bookingStart = new Date(bookingStartTime).getTime();
  const cutoff = bookingStart - windowHours * 60 * 60 * 1000;
  return Date.now() >= cutoff;
}

function formatCreatedAt(timestamp: string, timezone: string): string {
  const date = new Date(timestamp);
  const datePart = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: timezone,
  }).format(date);
  const timePart = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: timezone,
  }).format(date);
  return `Booked on ${datePart}, ${timePart}`;
}

export function ExpandedBookingCard({
  booking,
  timezone,
  cancellationWindowHours,
  hasPaymentMode,
  canModify,
  onModify,
  onCancelled,
  onCollapse,
}: Props) {
  const [slots, setSlots] = useState<SlotDetail[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const isUpcoming =
    booking.status === 'confirmed' && booking.date >= new Date().toISOString().slice(0, 10);
  const insideWindow =
    hasPaymentMode &&
    cancellationWindowHours !== null &&
    isInsideCancellationWindow(booking.start_time, cancellationWindowHours);

  useEffect(() => {
    // Fetch slot details for pricing breakdown
    supabase
      .from('booking_slots')
      .select('bay_schedule_slot_id, bay_schedule_slots:bay_schedule_slot_id(start_time, end_time, price_cents)')
      .eq('booking_id', booking.id)
      .then(({ data }) => {
        if (data) {
          const slotDetails: SlotDetail[] = data
            .map((row: any) => {
              const s = row.bay_schedule_slots;
              if (!s) return null;
              return {
                start_time: s.start_time,
                end_time: s.end_time,
                price_cents: s.price_cents,
              };
            })
            .filter(Boolean) as SlotDetail[];
          // Sort by start time
          slotDetails.sort(
            (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime()
          );
          setSlots(slotDetails);
        }
        setLoadingSlots(false);
      });

    // Fetch payment info
    supabase
      .from('booking_payments')
      .select(
        'status, amount_cents, refunded_amount_cents, cancellation_policy_text, stripe_payment_intent_id'
      )
      .eq('booking_id', booking.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPaymentInfo(data[0] as PaymentInfo);
        }
        setLoadingPayment(false);
      });
  }, [booking.id]);

  const hasPaidBooking =
    paymentInfo &&
    (paymentInfo.status === 'charged' || paymentInfo.status === 'card_saved');

  const policyText = paymentInfo?.cancellation_policy_text;

  const handleCancelPress = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowCancelConfirm(true);
  };

  const handleCancelGoBack = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowCancelConfirm(false);
  };

  const handleConfirmCancel = async () => {
    setCancelling(true);
    try {
      // Fire-and-forget auto-refund if paid and outside window
      if (hasPaidBooking && !insideWindow) {
        fetch(
          `${process.env.EXPO_PUBLIC_WEB_URL || ''}/api/stripe/auto-refund`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ booking_id: booking.id }),
          }
        ).catch(() => {});
      }

      const { error } = await supabase.rpc('cancel_booking', {
        p_booking_id: booking.id,
      });

      if (error) {
        setCancelling(false);
        const { Alert } = require('react-native');
        Alert.alert('Error', error.message);
        return;
      }

      setCancelling(false);
      onCancelled();
    } catch {
      setCancelling(false);
    }
  };

  // Compute subtotal from slots
  const subtotal = slots.reduce((sum, s) => sum + s.price_cents, 0);
  const discount = booking.discount_cents || 0;
  const total = booking.total_price_cents - discount;

  // Cancellation window deadline text
  const getCancellationDeadline = (): string | null => {
    if (!hasPaymentMode || cancellationWindowHours === null) return null;
    const bookingStart = new Date(booking.start_time).getTime();
    const deadline = new Date(bookingStart - cancellationWindowHours * 60 * 60 * 1000);
    const datePart = new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: timezone,
    }).format(deadline);
    const timePart = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: timezone,
    }).format(deadline);
    return `${datePart}, ${timePart}`;
  };

  return (
    <View style={styles.container}>
      {/* Header — Date as primary title */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.dateTitle}>📅  {formatDateLong(booking.date)}</Text>
          <Text style={styles.timeSubtitle}>
            🕐  {formatTimeInZone(booking.start_time, timezone)} – {formatTimeInZone(booking.end_time, timezone)}
          </Text>
          <Text style={styles.locationSubtitle}>
            📍  {booking.bays?.name ?? 'Unknown'}
            {booking.organizations?.name ? ` · ${booking.organizations.name}` : ''}
          </Text>
          <Text style={styles.createdAt}>
            {formatCreatedAt(booking.created_at, timezone)}
          </Text>
          <Text style={styles.confirmationCodeSmall}>{booking.confirmation_code}</Text>
        </View>
        <TouchableOpacity onPress={onCollapse} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Status badges */}
      <View style={styles.badgeRow}>
        <Badge
          label={booking.status === 'confirmed' ? 'Confirmed' : 'Cancelled'}
          variant={booking.status === 'confirmed' ? 'success' : 'destructive'}
        />
        {!loadingPayment && paymentInfo && (
          <Badge
            label={
              paymentInfo.status === 'charged'
                ? 'Paid'
                : paymentInfo.status === 'refunded'
                ? 'Refunded'
                : paymentInfo.status === 'partial_refund'
                ? 'Partial Refund'
                : paymentInfo.status === 'card_saved'
                ? 'Card Saved'
                : paymentInfo.status
            }
            variant={
              paymentInfo.status === 'charged'
                ? 'success'
                : paymentInfo.status === 'refunded' || paymentInfo.status === 'partial_refund'
                ? 'muted'
                : 'default'
            }
          />
        )}
      </View>

      {/* Modified from info */}
      {booking.modified_from_info && (
        <View style={styles.modifiedFromBox}>
          <Text style={styles.modifiedFromText}>
            Modified from {formatTimeInZone(booking.modified_from_info.startTime, timezone)} –{' '}
            {formatTimeInZone(booking.modified_from_info.endTime, timezone)},{' '}
            {new Date(booking.modified_from_info.date + 'T12:00:00').toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
            , {booking.modified_from_info.bayName}
          </Text>
        </View>
      )}

      {/* Pricing breakdown */}
      <View style={styles.pricingSection}>
        <Text style={styles.pricingHeader}>PRICING</Text>
        <View style={styles.pricingBox}>
          {loadingSlots ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : slots.length > 0 ? (
            <>
              {slots.map((slot, i) => (
                <View key={i} style={styles.slotRow}>
                  <Text style={styles.slotTime}>
                    {formatTimeInZone(slot.start_time, timezone)} –{' '}
                    {formatTimeInZone(slot.end_time, timezone)}
                  </Text>
                  <Text style={styles.slotPrice}>{formatPrice(slot.price_cents)}</Text>
                </View>
              ))}
              {discount > 0 && (
                <>
                  <View style={[styles.slotRow, styles.subtotalRow]}>
                    <Text style={styles.subtotalLabel}>Subtotal</Text>
                    <Text style={styles.subtotalValue}>{formatPrice(subtotal)}</Text>
                  </View>
                  <View style={styles.slotRow}>
                    <Text style={styles.discountLabel}>
                      ★ {booking.discount_description || 'Member discount'}
                    </Text>
                    <Text style={styles.discountValue}>-{formatPrice(discount)}</Text>
                  </View>
                </>
              )}
              <View style={[styles.slotRow, styles.totalRow]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatPrice(total)}</Text>
              </View>
            </>
          ) : (
            // Fallback: no slot data (e.g. dynamic booking)
            <>
              {discount > 0 && (
                <>
                  <View style={styles.slotRow}>
                    <Text style={styles.subtotalLabel}>Subtotal</Text>
                    <Text style={styles.subtotalValue}>
                      {formatPrice(booking.total_price_cents)}
                    </Text>
                  </View>
                  <View style={styles.slotRow}>
                    <Text style={styles.discountLabel}>
                      ★ {booking.discount_description || 'Member discount'}
                    </Text>
                    <Text style={styles.discountValue}>-{formatPrice(discount)}</Text>
                  </View>
                </>
              )}
              <View style={[styles.slotRow, discount > 0 ? styles.totalRow : undefined]}>
                <Text style={styles.totalLabel}>Total</Text>
                <Text style={styles.totalValue}>{formatPrice(total)}</Text>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Notes */}
      {booking.notes && (
        <View style={styles.notesSection}>
          <Text style={styles.notesLabel}>Notes</Text>
          <Text style={styles.notesText}>{booking.notes}</Text>
        </View>
      )}

      {/* Collapsible Manage section */}
      {isUpcoming && (
        <View style={styles.manageSection}>
          <TouchableOpacity
            style={styles.manageHeader}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setManageOpen(!manageOpen);
            }}
          >
            <Text style={styles.manageHeaderText}>⚙  Manage</Text>
            <Text style={[styles.manageChevron, manageOpen && styles.manageChevronOpen]}>
              ▾
            </Text>
          </TouchableOpacity>

          {manageOpen && (
            <View style={styles.manageContent}>
              {/* Cancellation window notice */}
              {hasPaymentMode && cancellationWindowHours !== null && !showCancelConfirm && (
                insideWindow ? (
                  <View style={styles.windowBannerAmber}>
                    <Text style={styles.windowTitleAmber}>
                      This booking is within the {cancellationWindowHours}-hour cancellation window.
                    </Text>
                    <Text style={styles.windowDescAmber}>
                      Cancellations will not receive a refund. Modifications are not available.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.windowBannerGreen}>
                    <Text style={styles.windowTitleGreen}>
                      Free cancellation until {getCancellationDeadline()}
                    </Text>
                    <Text style={styles.windowDescGreen}>
                      Cancel before the {cancellationWindowHours}-hour window for a full refund.
                    </Text>
                  </View>
                )
              )}

              {/* Cancel confirmation inline */}
              {showCancelConfirm ? (
                <View style={styles.cancelConfirmSection}>
                  <Text style={styles.cancelConfirmTitle}>Cancel Booking</Text>

                  {loadingPayment ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.loadingText}>Checking payment status...</Text>
                    </View>
                  ) : (
                    <>
                      {insideWindow && (
                        <View style={styles.refundBannerAmber}>
                          <Text style={styles.refundTitleAmber}>No refund will be issued</Text>
                          <Text style={styles.refundDescAmber}>
                            This booking is within the {cancellationWindowHours}-hour cancellation
                            window. If you believe you should receive a refund, please contact the
                            facility after cancelling.
                          </Text>
                          {policyText && (
                            <TouchableOpacity onPress={() => setShowPolicy(!showPolicy)}>
                              <Text style={styles.policyLinkAmber}>
                                {showPolicy ? 'Hide' : 'View'} Cancellation Policy
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {!insideWindow && hasPaidBooking && (
                        <View style={styles.refundBannerGreen}>
                          <Text style={styles.refundTitleGreen}>Full refund will be issued</Text>
                          <Text style={styles.refundDescGreen}>
                            A full refund of {formatPrice(paymentInfo?.amount_cents || 0)} will be
                            processed automatically.
                          </Text>
                          {policyText && (
                            <TouchableOpacity onPress={() => setShowPolicy(!showPolicy)}>
                              <Text style={styles.policyLink}>
                                {showPolicy ? 'Hide' : 'View'} Cancellation Policy
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {!insideWindow && !hasPaidBooking && (
                        <Text style={styles.simpleConfirmText}>
                          Are you sure you want to cancel this booking? This action cannot be undone.
                        </Text>
                      )}

                      {showPolicy && policyText && (
                        <View style={styles.policyBox}>
                          <Text style={styles.policyTitle}>Cancellation Policy</Text>
                          <Text style={styles.policyTextContent}>{policyText}</Text>
                        </View>
                      )}
                    </>
                  )}

                  <View style={styles.cancelActions}>
                    <TouchableOpacity
                      style={styles.goBackButton}
                      onPress={handleCancelGoBack}
                      disabled={cancelling}
                    >
                      <Text style={styles.goBackText}>Go Back</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.confirmCancelButton, cancelling && styles.disabledButton]}
                      onPress={handleConfirmCancel}
                      disabled={cancelling || loadingPayment}
                    >
                      {cancelling ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.confirmCancelText}>Cancel Booking</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                /* Action buttons */
                <View style={styles.actionButtons}>
                  {canModify && (
                    <Button
                      title="Modify Booking"
                      variant="secondary"
                      size="md"
                      onPress={onModify}
                      style={styles.actionButton}
                    />
                  )}
                  <TouchableOpacity
                    style={styles.cancelBookingButton}
                    onPress={handleCancelPress}
                  >
                    <Text style={styles.cancelBookingText}>✕  Cancel Booking</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xs,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  dateTitle: {
    ...typography.h3,
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '700',
  },
  timeSubtitle: {
    ...typography.body,
    color: colors.foreground,
    marginTop: 4,
  },
  locationSubtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 4,
  },
  confirmationCodeSmall: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  createdAt: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 6,
  },
  closeButton: {
    padding: spacing.xs,
  },
  closeIcon: {
    fontSize: 18,
    color: colors.mutedForeground,
    fontWeight: '300',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modifiedFromBox: {
    backgroundColor: '#eff6ff',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  modifiedFromText: {
    ...typography.caption,
    color: '#2563eb',
  },
  pricingSection: {
    marginBottom: spacing.md,
  },
  pricingHeader: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  pricingBox: {
    backgroundColor: colors.muted,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  slotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  slotTime: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  slotPrice: {
    ...typography.bodySmall,
    color: colors.foreground,
  },
  subtotalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  subtotalLabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  subtotalValue: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  discountLabel: {
    ...typography.bodySmall,
    color: '#0d9488',
    fontWeight: '500',
  },
  discountValue: {
    ...typography.bodySmall,
    color: '#0d9488',
    fontWeight: '500',
  },
  totalRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  totalLabel: {
    ...typography.body,
    color: colors.foreground,
    fontWeight: '600',
  },
  totalValue: {
    ...typography.body,
    color: colors.foreground,
    fontWeight: '600',
  },
  notesSection: {
    marginBottom: spacing.md,
  },
  notesLabel: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: '600',
    marginBottom: 4,
  },
  notesText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    fontStyle: 'italic',
  },
  // Cancellation window banners (pre-cancel view)
  windowBannerAmber: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  windowTitleAmber: {
    ...typography.bodySmall,
    color: '#b45309',
    fontWeight: '600',
    marginBottom: 4,
  },
  windowDescAmber: {
    ...typography.caption,
    color: '#d97706',
    lineHeight: 18,
  },
  windowBannerGreen: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  windowTitleGreen: {
    ...typography.bodySmall,
    color: '#15803d',
    fontWeight: '600',
    marginBottom: 4,
  },
  windowDescGreen: {
    ...typography.caption,
    color: '#16a34a',
    lineHeight: 18,
  },
  // Action buttons
  actionButtons: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    width: '100%',
  },
  cancelBookingButton: {
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: '#fef2f2',
  },
  cancelBookingText: {
    ...typography.body,
    color: '#dc2626',
    fontWeight: '600',
  },
  // Cancel confirmation section
  cancelConfirmSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
  },
  cancelConfirmTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  simpleConfirmText: {
    ...typography.body,
    color: colors.mutedForeground,
    marginBottom: spacing.md,
  },
  refundBannerAmber: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  refundTitleAmber: {
    ...typography.bodySmall,
    color: '#b45309',
    fontWeight: '600',
    marginBottom: 4,
  },
  refundDescAmber: {
    ...typography.caption,
    color: '#d97706',
    lineHeight: 18,
  },
  refundBannerGreen: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  refundTitleGreen: {
    ...typography.bodySmall,
    color: '#15803d',
    fontWeight: '600',
    marginBottom: 4,
  },
  refundDescGreen: {
    ...typography.caption,
    color: '#16a34a',
    lineHeight: 18,
  },
  policyLink: {
    ...typography.caption,
    color: '#15803d',
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
  },
  policyLinkAmber: {
    ...typography.caption,
    color: '#b45309',
    fontWeight: '600',
    textDecorationLine: 'underline',
    marginTop: spacing.sm,
  },
  policyBox: {
    backgroundColor: colors.muted,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  policyTitle: {
    ...typography.bodySmall,
    color: colors.foreground,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  policyTextContent: {
    ...typography.caption,
    color: colors.mutedForeground,
    lineHeight: 18,
  },
  cancelActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  goBackButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  goBackText: {
    ...typography.body,
    color: colors.foreground,
    fontWeight: '600',
  },
  confirmCancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmCancelText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
  // Collapsible Manage section
  manageSection: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  manageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  manageHeaderText: {
    ...typography.body,
    color: colors.mutedForeground,
    fontWeight: '600',
  },
  manageChevron: {
    fontSize: 16,
    color: colors.mutedForeground,
  },
  manageChevronOpen: {
    transform: [{ rotate: '180deg' }],
  },
  manageContent: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
});
