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
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import { CrownIcon } from './TabIcons';
import type { EventRegistration } from '../types';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface PaymentInfo {
  status: string;
  amount_cents: number;
  refunded_amount_cents: number;
  cancellation_policy_text: string | null;
  stripe_payment_intent_id: string | null;
}

interface Props {
  registration: EventRegistration;
  timezone: string;
  cancellationWindowHours: number | null;
  hasPaymentMode: boolean;
  paymentMode?: string;
  onCancelled: () => void;
  onCollapse: () => void;
}

function isInsideCancellationWindow(
  eventStartTime: string,
  windowHours: number
): boolean {
  const eventStart = new Date(eventStartTime).getTime();
  const cutoff = eventStart - windowHours * 60 * 60 * 1000;
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
  return `Registered on ${datePart}, ${timePart}`;
}

function getBayNames(reg: EventRegistration): string {
  if (!reg.events?.event_bays) return '';
  return reg.events.event_bays
    .map((eb) => {
      const b = eb.bays;
      if (Array.isArray(b)) return b.map((x) => x.name).join(', ');
      return b?.name ?? '';
    })
    .filter(Boolean)
    .join(', ');
}

function getStatusBadge(reg: EventRegistration): { label: string; variant: 'success' | 'destructive' | 'default' | 'muted' } {
  switch (reg.status) {
    case 'confirmed':
      return { label: 'Confirmed', variant: 'success' };
    case 'waitlisted':
      return { label: `Waitlisted${reg.waitlist_position != null ? ` #${reg.waitlist_position}` : ''}`, variant: 'default' };
    case 'pending_payment':
      return { label: 'Payment Pending', variant: 'default' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'destructive' };
    default:
      return { label: reg.status, variant: 'muted' };
  }
}

export function ExpandedEventCard({
  registration: reg,
  timezone,
  cancellationWindowHours,
  hasPaymentMode,
  paymentMode,
  onCancelled,
  onCollapse,
}: Props) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const evt = reg.events;
  if (!evt) return null;

  const bayNames = getBayNames(reg);
  const statusBadge = getStatusBadge(reg);
  const isUpcoming = reg.status !== 'cancelled' && new Date(evt.end_time) >= new Date();
  const insideWindow =
    hasPaymentMode &&
    cancellationWindowHours !== null &&
    isInsideCancellationWindow(evt.start_time, cancellationWindowHours);

  const priceCents = evt.price_cents;
  const discount = reg.discount_cents || 0;
  const total = priceCents - discount;

  useEffect(() => {
    supabase
      .from('booking_payments')
      .select(
        'status, amount_cents, refunded_amount_cents, cancellation_policy_text, stripe_payment_intent_id'
      )
      .eq('event_registration_id', reg.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0) {
          setPaymentInfo(data[0] as PaymentInfo);
        }
        setLoadingPayment(false);
      });
  }, [reg.id]);

  const hasPaidEvent =
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
      if (hasPaidEvent && !insideWindow) {
        fetch(
          `${process.env.EXPO_PUBLIC_WEB_URL || ''}/api/stripe/auto-refund`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_registration_id: reg.id }),
          }
        ).catch(() => {});
      }

      const { error } = await supabase.rpc('cancel_event_registration', {
        p_registration_id: reg.id,
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

  const getCancellationDeadline = (): string | null => {
    if (!hasPaymentMode || cancellationWindowHours === null) return null;
    const eventStart = new Date(evt.start_time).getTime();
    const deadline = new Date(eventStart - cancellationWindowHours * 60 * 60 * 1000);
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

  const showPaidBadge =
    paymentMode === 'charge_upfront' && reg.status === 'confirmed';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          {/* Event name + pill */}
          <View style={styles.nameRow}>
            <Text style={styles.eventName} numberOfLines={2}>{evt.name}</Text>
            <View style={styles.eventPill}>
              <Text style={styles.eventPillText}>Event</Text>
            </View>
          </View>

          <View style={styles.detailRow}>
            <Feather name="calendar" size={16} color={colors.mutedForeground} />
            <Text style={styles.dateTitle}>
              {new Date(evt.start_time).toLocaleDateString('en-US', {
                timeZone: timezone,
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Feather name="clock" size={16} color={colors.mutedForeground} />
            <Text style={styles.timeSubtitle}>
              {formatTimeInZone(evt.start_time, timezone)} – {formatTimeInZone(evt.end_time, timezone)}
            </Text>
          </View>
          {bayNames ? (
            <View style={styles.detailRow}>
              <Feather name="map-pin" size={16} color={colors.mutedForeground} />
              <Text style={styles.locationSubtitle}>{bayNames}</Text>
            </View>
          ) : null}
          <Text style={styles.createdAt}>
            {formatCreatedAt(reg.registered_at, timezone)}
          </Text>
          <View style={styles.codeBadgeRow}>
            <Badge label={statusBadge.label} variant={statusBadge.variant} />
            {showPaidBadge && <Badge label="Paid" variant="success" />}
            {!showPaidBadge && !loadingPayment && paymentInfo && (
              <Badge
                label={
                  paymentInfo.status === 'charged'
                    ? 'Paid'
                    : paymentInfo.status === 'card_saved'
                    ? 'Card Saved'
                    : paymentInfo.status
                }
                variant={paymentInfo.status === 'charged' ? 'success' : 'default'}
              />
            )}
          </View>
        </View>
        <TouchableOpacity onPress={onCollapse} style={styles.closeButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="x" size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      {/* Pricing */}
      <View style={styles.pricingSection}>
        <Text style={styles.pricingHeader}>PRICING</Text>
        <View style={styles.pricingBox}>
          {priceCents > 0 ? (
            <>
              {discount > 0 ? (
                <>
                  <View style={styles.slotRow}>
                    <Text style={styles.subtotalLabel}>Event price</Text>
                    <Text style={styles.subtotalValue}>{formatPrice(priceCents)}</Text>
                  </View>
                  <View style={styles.slotRow}>
                    <View style={styles.discountLabelRow}>
                      <CrownIcon size={13} color="#16a34a" />
                      <Text style={styles.discountLabel}>
                        {reg.discount_description || 'Member discount'}
                      </Text>
                    </View>
                    <Text style={styles.discountValue}>-{formatPrice(discount)}</Text>
                  </View>
                  <View style={[styles.slotRow, styles.totalRow]}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>{formatPrice(total)}</Text>
                  </View>
                </>
              ) : (
                <View style={styles.slotRow}>
                  <Text style={styles.totalLabel}>Total</Text>
                  <Text style={styles.totalValue}>{formatPrice(priceCents)}</Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.slotRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={[styles.totalValue, { color: '#16a34a' }]}>Free</Text>
            </View>
          )}
        </View>
      </View>

      {/* About */}
      {evt.description ? (
        <View style={styles.aboutSection}>
          <Text style={styles.aboutHeader}>ABOUT</Text>
          <Text style={styles.aboutText}>{evt.description}</Text>
        </View>
      ) : null}

      {/* Manage section */}
      {isUpcoming && reg.status !== 'cancelled' && (
        <View style={styles.manageSection}>
          <TouchableOpacity
            style={styles.manageHeader}
            onPress={() => {
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
              setManageOpen(!manageOpen);
            }}
          >
            <View style={styles.manageHeaderLeft}>
              <Feather name="sliders" size={14} color={colors.mutedForeground} />
              <Text style={styles.manageHeaderText}>Manage</Text>
            </View>
            <Feather
              name="chevron-down"
              size={16}
              color={colors.mutedForeground}
              style={manageOpen ? { transform: [{ rotate: '180deg' }] } : undefined}
            />
          </TouchableOpacity>

          {manageOpen && (
            <View style={styles.manageContent}>
              {/* Cancellation window notice */}
              {hasPaymentMode && cancellationWindowHours !== null && !showCancelConfirm && (
                insideWindow ? (
                  <View style={styles.windowBannerAmber}>
                    <Text style={styles.windowTitleAmber}>
                      This event is within the {cancellationWindowHours}-hour cancellation window.
                    </Text>
                    <Text style={styles.windowDescAmber}>
                      Cancellations will not receive a refund.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.manageDeadlineText}>
                    Free cancellation until {getCancellationDeadline()}
                  </Text>
                )
              )}

              {showCancelConfirm ? (
                <View style={styles.cancelConfirmSection}>
                  <Text style={styles.cancelConfirmTitle}>Cancel Registration</Text>

                  {loadingPayment ? (
                    <View style={styles.loadingRow}>
                      <ActivityIndicator size="small" color={colors.primary} />
                      <Text style={styles.loadingText}>Checking payment status...</Text>
                    </View>
                  ) : (
                    <>
                      {insideWindow && hasPaidEvent && (
                        <View style={styles.refundBannerAmber}>
                          <Text style={styles.refundTitleAmber}>No refund will be issued</Text>
                          <Text style={styles.refundDescAmber}>
                            This event is within the {cancellationWindowHours}-hour cancellation
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

                      {!insideWindow && hasPaidEvent && (
                        <View style={styles.refundBannerGreen}>
                          <Text style={styles.refundTitleGreen}>Full refund will be issued</Text>
                          <Text style={styles.refundDescGreen}>
                            A full refund of {formatPrice(paymentInfo?.amount_cents || total)} will be
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

                      {!hasPaidEvent && (
                        <Text style={styles.simpleConfirmText}>
                          Are you sure you want to cancel your registration? This action cannot be undone.
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
                        <Text style={styles.confirmCancelText}>Cancel Registration</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.actionButtons}>
                  <TouchableOpacity
                    style={styles.cancelBookingButton}
                    onPress={handleCancelPress}
                  >
                    <Text style={styles.cancelBookingText}>✕  Cancel Registration</Text>
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: 4,
  },
  eventName: {
    ...typography.h3,
    color: colors.foreground,
    fontSize: 18,
    fontWeight: '700',
    flexShrink: 1,
  },
  eventPill: {
    backgroundColor: colors.foreground,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  eventPillText: {
    color: colors.background,
    fontSize: 11,
    fontWeight: '600',
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
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 2,
  },
  createdAt: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 6,
  },
  codeBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: 4,
  },
  closeButton: {
    padding: spacing.xs,
  },
  // Pricing
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
  subtotalLabel: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  subtotalValue: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  discountLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  discountLabel: {
    ...typography.bodySmall,
    color: '#16a34a',
    fontWeight: '500',
  },
  discountValue: {
    ...typography.bodySmall,
    color: '#16a34a',
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
  // About
  aboutSection: {
    marginBottom: spacing.md,
  },
  aboutHeader: {
    ...typography.caption,
    color: colors.mutedForeground,
    fontWeight: '600',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  aboutText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  // Manage section (reuse booking styles)
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
  manageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  manageHeaderText: {
    ...typography.body,
    color: colors.mutedForeground,
    fontWeight: '600',
  },
  manageContent: {
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  manageDeadlineText: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginBottom: spacing.xs,
  },
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
  actionButtons: {
    gap: spacing.sm,
    marginTop: spacing.sm,
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
});
