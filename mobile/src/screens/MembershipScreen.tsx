import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFacility } from '../lib/facility-context';
import { useMembership } from '../lib/use-membership';
import { useAuth } from '../lib/auth-context';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { formatPrice } from '../lib/format';
import { colors, spacing, typography, borderRadius } from '../theme';

export function MembershipScreen() {
  const { organization } = useFacility();
  const { user } = useAuth();
  const { tier, membership, isMember, bookableWindowDays, membershipEnabled, isLoading } =
    useMembership();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!organization) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyText}>No facility loaded.</Text>
      </View>
    );
  }

  if (!membershipEnabled) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Memberships</Text>
          <Text style={styles.emptyText}>
            {organization.name} does not currently offer membership plans.
          </Text>
        </View>
      </ScrollView>
    );
  }

  const guestWindow = organization.guest_booking_window_days ?? organization.bookable_window_days ?? 30;
  const memberWindow = organization.member_booking_window_days ?? guestWindow;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status Card */}
      <Card style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusTitle}>Your Status</Text>
          <Badge
            label={isMember ? 'Member' : 'Guest'}
            variant={isMember ? 'success' : 'muted'}
          />
        </View>

        {isMember && membership ? (
          <View style={styles.statusDetails}>
            <Text style={styles.statusTierName}>{tier?.name ?? 'Member'}</Text>
            {membership.source === 'admin' || membership.status === 'admin_granted' ? (
              <Text style={styles.statusSubtext}>Granted by admin</Text>
            ) : membership.status === 'cancelled' && membership.current_period_end ? (
              <Text style={styles.statusSubtext}>
                Active until {new Date(membership.current_period_end).toLocaleDateString()}
              </Text>
            ) : membership.current_period_end ? (
              <Text style={styles.statusSubtext}>
                Renews {new Date(membership.current_period_end).toLocaleDateString()}
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={styles.statusSubtext}>
            Become a member to unlock exclusive benefits
          </Text>
        )}
      </Card>

      {/* Tier Info */}
      {tier && (
        <>
          <Text style={styles.sectionTitle}>{tier.name}</Text>
          <Card>
            {tier.benefit_description && (
              <Text style={styles.benefitDescription}>{tier.benefit_description}</Text>
            )}

            {/* Benefits List */}
            <View style={styles.benefitsList}>
              {/* Booking Window */}
              <View style={styles.benefitRow}>
                <Text style={styles.benefitIcon}>&#x1F4C5;</Text>
                <View style={styles.benefitContent}>
                  <Text style={styles.benefitLabel}>Book further ahead</Text>
                  <Text style={styles.benefitValue}>
                    {memberWindow} days vs {guestWindow} days for guests
                  </Text>
                </View>
              </View>

              {/* Discount */}
              {tier.discount_value > 0 && (
                <View style={styles.benefitRow}>
                  <Text style={styles.benefitIcon}>&#x1F3F7;</Text>
                  <View style={styles.benefitContent}>
                    <Text style={styles.benefitLabel}>Booking discount</Text>
                    <Text style={styles.benefitValue}>
                      {tier.discount_type === 'percent'
                        ? `${tier.discount_value}% off all bookings`
                        : `${formatPrice(tier.discount_value * 100)} off per booking`}
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </Card>
        </>
      )}

      {/* Booking Window Info */}
      <Text style={styles.sectionTitle}>Your Booking Window</Text>
      <Card>
        <View style={styles.windowRow}>
          <Text style={styles.windowLabel}>You can book</Text>
          <Text style={styles.windowValue}>{bookableWindowDays} days ahead</Text>
        </View>
        {!isMember && memberWindow > guestWindow && (
          <View style={styles.windowHint}>
            <Text style={styles.windowHintText}>
              Members can book up to {memberWindow} days ahead
            </Text>
          </View>
        )}
      </Card>

      {/* Pricing */}
      {tier && !isMember && (tier.price_monthly_cents || tier.price_yearly_cents) && (
        <>
          <Text style={styles.sectionTitle}>Pricing</Text>
          <View style={styles.pricingRow}>
            {tier.price_monthly_cents && (
              <Card style={styles.pricingCard}>
                <Text style={styles.pricingAmount}>
                  {formatPrice(tier.price_monthly_cents)}
                </Text>
                <Text style={styles.pricingInterval}>per month</Text>
              </Card>
            )}
            {tier.price_yearly_cents && (
              <Card style={styles.pricingCard}>
                <Text style={styles.pricingAmount}>
                  {formatPrice(tier.price_yearly_cents)}
                </Text>
                <Text style={styles.pricingInterval}>per year</Text>
                {tier.price_monthly_cents && (
                  <Text style={styles.pricingSavings}>
                    Save {formatPrice(tier.price_monthly_cents * 12 - tier.price_yearly_cents)}/yr
                  </Text>
                )}
              </Card>
            )}
          </View>
        </>
      )}

      {/* CTA for non-members */}
      {!isMember && tier && user && (
        <Card style={styles.ctaCard}>
          <Text style={styles.ctaText}>
            Membership purchases are available on the web at{' '}
            {organization.slug}.ezbooker.app
          </Text>
          <Text style={styles.ctaSubtext}>In-app subscriptions coming soon</Text>
        </Card>
      )}

      {!user && (
        <Card style={styles.ctaCard}>
          <Text style={styles.ctaText}>
            Sign in to view your membership status and benefits.
          </Text>
        </Card>
      )}
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
    padding: spacing['3xl'],
  },
  emptyTitle: {
    ...typography.h2,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  emptyText: {
    ...typography.body,
    color: colors.mutedForeground,
    textAlign: 'center',
  },
  statusCard: {
    marginBottom: spacing.lg,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  statusTitle: {
    ...typography.label,
    color: colors.mutedForeground,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  statusDetails: {
    marginTop: spacing.xs,
  },
  statusTierName: {
    ...typography.h2,
    color: colors.foreground,
  },
  statusSubtext: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
    marginTop: spacing['2xl'],
  },
  benefitDescription: {
    ...typography.body,
    color: colors.foreground,
    marginBottom: spacing.lg,
  },
  benefitsList: {
    gap: spacing.lg,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  benefitIcon: {
    fontSize: 20,
    marginTop: 2,
  },
  benefitContent: {
    flex: 1,
  },
  benefitLabel: {
    ...typography.label,
    color: colors.foreground,
  },
  benefitValue: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  windowRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  windowLabel: {
    ...typography.body,
    color: colors.foreground,
  },
  windowValue: {
    ...typography.h3,
    color: colors.foreground,
  },
  windowHint: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  windowHintText: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
  pricingRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  pricingCard: {
    flex: 1,
    alignItems: 'center',
  },
  pricingAmount: {
    ...typography.h2,
    color: colors.foreground,
  },
  pricingInterval: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  pricingSavings: {
    ...typography.caption,
    color: '#166534',
    marginTop: spacing.sm,
    fontWeight: '600',
  },
  ctaCard: {
    marginTop: spacing['2xl'],
    alignItems: 'center',
  },
  ctaText: {
    ...typography.body,
    color: colors.foreground,
    textAlign: 'center',
  },
  ctaSubtext: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
