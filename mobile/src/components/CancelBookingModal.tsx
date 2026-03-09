import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { formatPrice, formatTimeInZone, formatDateLong } from '../lib/format';
import { colors, spacing, borderRadius, typography } from '../theme';
import type { Booking } from '../types';

interface PaymentInfo {
  status: string;
  amount_cents: number;
  refunded_amount_cents: number;
  cancellation_policy_text: string | null;
  stripe_payment_intent_id: string | null;
}

interface Props {
  visible: boolean;
  booking: Booking | null;
  timezone: string;
  cancellationWindowHours: number | null;
  hasPaymentMode: boolean;
  onClose: () => void;
  onCancelled: () => void;
}

function isInsideCancellationWindow(
  bookingStartTime: string,
  windowHours: number
): boolean {
  const bookingStart = new Date(bookingStartTime).getTime();
  const cutoff = bookingStart - windowHours * 60 * 60 * 1000;
  return Date.now() >= cutoff;
}

export function CancelBookingModal({
  visible,
  booking,
  timezone,
  cancellationWindowHours,
  hasPaymentMode,
  onClose,
  onCancelled,
}: Props) {
  const [paymentInfo, setPaymentInfo] = useState<PaymentInfo | null>(null);
  const [loadingPayment, setLoadingPayment] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  useEffect(() => {
    if (!visible || !booking) {
      setPaymentInfo(null);
      setShowPolicy(false);
      return;
    }

    // Fetch payment info for this booking
    setLoadingPayment(true);
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
  }, [visible, booking]);

  if (!booking) return null;

  const hasPaidBooking =
    paymentInfo &&
    (paymentInfo.status === 'charged' || paymentInfo.status === 'card_saved');

  const insideWindow =
    hasPaymentMode &&
    cancellationWindowHours !== null &&
    isInsideCancellationWindow(booking.start_time, cancellationWindowHours);

  const policyText = paymentInfo?.cancellation_policy_text;

  const handleCancel = async () => {
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
        // Fall back to alert for errors
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

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <ScrollView bounces={false}>
            {/* Header */}
            <Text style={styles.title}>Cancel Booking</Text>
            <Text style={styles.subtitle}>
              {booking.confirmation_code} — {booking.bays?.name ?? 'Facility'}
            </Text>
            <Text style={styles.subtitle}>
              {formatDateLong(booking.date)},{' '}
              {formatTimeInZone(booking.start_time, timezone)} –{' '}
              {formatTimeInZone(booking.end_time, timezone)}
            </Text>

            {/* Price */}
            <Text style={styles.price}>{formatPrice(booking.total_price_cents)}</Text>

            {/* Loading payment info */}
            {loadingPayment && (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.loadingText}>Checking payment status...</Text>
              </View>
            )}

            {/* Refund info */}
            {!loadingPayment && hasPaidBooking && !insideWindow && (
              <View style={styles.refundBannerGreen}>
                <Text style={styles.refundTitleGreen}>Full refund will be issued</Text>
                <Text style={styles.refundDescGreen}>
                  You're cancelling more than {cancellationWindowHours} hours before
                  the booking start time. A full refund of $
                  {((paymentInfo?.amount_cents || 0) / 100).toFixed(2)} will be
                  processed automatically.
                </Text>
                {policyText && (
                  <TouchableOpacity onPress={() => setShowPolicy(!showPolicy)}>
                    <Text style={styles.policyLink}>View Cancellation Policy</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {!loadingPayment && hasPaidBooking && insideWindow && (
              <View style={styles.refundBannerAmber}>
                <Text style={styles.refundTitleAmber}>No refund will be issued</Text>
                <Text style={styles.refundDescAmber}>
                  This booking is within the {cancellationWindowHours}-hour
                  cancellation window. If you believe you should receive a refund,
                  please contact the facility after cancelling.
                </Text>
                {policyText && (
                  <TouchableOpacity onPress={() => setShowPolicy(!showPolicy)}>
                    <Text style={styles.policyLinkAmber}>View Cancellation Policy</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* No payment mode — simple confirmation */}
            {!loadingPayment && !hasPaidBooking && (
              <View style={styles.simpleMessage}>
                <Text style={styles.simpleMessageText}>
                  Are you sure you want to cancel this booking? This action cannot be
                  undone.
                </Text>
              </View>
            )}

            {/* Policy text */}
            {showPolicy && policyText && (
              <View style={styles.policyBox}>
                <Text style={styles.policyTitle}>Cancellation Policy</Text>
                <Text style={styles.policyText}>{policyText}</Text>
              </View>
            )}
          </ScrollView>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.goBackButton}
              onPress={onClose}
              disabled={cancelling}
            >
              <Text style={styles.goBackText}>Go Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelButton, cancelling && styles.disabledButton]}
              onPress={handleCancel}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.cancelButtonText}>Cancel Booking</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['3xl'],
    maxHeight: '80%',
  },
  title: {
    ...typography.h2,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  price: {
    ...typography.h3,
    color: colors.foreground,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  refundBannerGreen: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
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
  refundBannerAmber: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
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
    marginBottom: spacing.lg,
  },
  policyTitle: {
    ...typography.bodySmall,
    color: colors.foreground,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  policyText: {
    ...typography.caption,
    color: colors.mutedForeground,
    lineHeight: 18,
  },
  simpleMessage: {
    marginBottom: spacing.lg,
  },
  simpleMessageText: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
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
  cancelButton: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: '#dc2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    ...typography.body,
    color: '#fff',
    fontWeight: '600',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
