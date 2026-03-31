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
import { formatPrice } from '../lib/format';
import { Feather } from '@expo/vector-icons';
import { CrownIcon } from '../components/TabIcons';
import { colors, spacing, typography } from '../theme';

export function MembershipScreen() {
  const { organization } = useFacility();
  const { user } = useAuth();
  const { tiers, tier, membership, isMember, bookableWindowDays, membershipEnabled, creditBalance, isLoading } =
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
  const creditType = organization.credit_type;

  function formatCredits(amount: number | null, period: string | null) {
    if (!amount || !period || !creditType) return null;
    const periodLabel = period === 'daily' ? '/day' : period === 'weekly' ? '/week' : '/month';
    if (creditType === 'hours') {
      const hrs = amount / 60;
      return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hr${hrs !== 1 ? 's' : ''} free ${periodLabel}`;
    }
    return `${formatPrice(amount)} credit ${periodLabel}`;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Status Card */}
      <Card style={styles.statusCard}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusTitle}>Your Status</Text>
          <Badge
            label={isMember ? (tier?.name ?? 'Member') : 'Guest'}
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

      {/* Credit Balance */}
      {creditBalance?.has_credits && (
        <Card style={styles.creditCard}>
          <View style={styles.creditHeader}>
            <Feather
              name={creditType === 'hours' ? 'clock' : 'dollar-sign'}
              size={16}
              color={colors.primary}
            />
            <Text style={styles.creditTitle}>Your Credits</Text>
          </View>
          <Text style={styles.creditAmount}>
            {creditType === 'hours'
              ? `${(creditBalance.credits_remaining / 60).toFixed(1)} hrs`
              : formatPrice(creditBalance.credits_remaining)}
          </Text>
          <Text style={styles.creditSubtext}>
            {creditType === 'hours'
              ? `${(creditBalance.credits_used / 60).toFixed(1)} hrs used of ${(creditBalance.credits_total / 60).toFixed(1)} hrs`
              : `${formatPrice(creditBalance.credits_used)} used of ${formatPrice(creditBalance.credits_total)}`}
            {creditBalance.period_end
              ? ` \u00B7 Resets ${new Date(creditBalance.period_end).toLocaleDateString()}`
              : ''}
          </Text>
        </Card>
      )}

      {/* Tier Cards */}
      <Text style={styles.sectionTitle}>
        {tiers.length > 1 ? 'Membership Plans' : (tier?.name ?? 'Membership')}
      </Text>

      {tiers.map((t) => {
        const isCurrentTier = tier?.id === t.id && isMember;
        const window = t.bookable_window_days ?? (organization.member_booking_window_days ?? guestWindow);
        const credits = formatCredits(t.credit_amount, t.credit_period);

        return (
          <Card
            key={t.id}
            style={[styles.tierCard, isCurrentTier && styles.tierCardActive]}
          >
            <View style={styles.tierHeader}>
              <Text style={styles.tierName}>{t.name}</Text>
              {isCurrentTier && (
                <Badge label="Current" variant="success" />
              )}
            </View>

            {t.benefit_description && (
              <Text style={styles.benefitDescription}>{t.benefit_description}</Text>
            )}

            <View style={styles.benefitsList}>
              <View style={styles.benefitRow}>
                <Feather name="calendar" size={16} color={colors.mutedForeground} />
                <Text style={styles.benefitValue}>
                  Book {window} days ahead (guests: {guestWindow})
                </Text>
              </View>

              {t.discount_value > 0 && (
                <View style={styles.benefitRow}>
                  <CrownIcon size={16} color="#16a34a" />
                  <Text style={styles.benefitValue}>
                    {t.discount_type === 'percent'
                      ? `${t.discount_value}% off bookings`
                      : `${formatPrice(t.discount_value * 100)} off per booking`}
                  </Text>
                </View>
              )}

              {credits && (
                <View style={styles.benefitRow}>
                  <Feather
                    name={creditType === 'hours' ? 'clock' : 'dollar-sign'}
                    size={16}
                    color={colors.mutedForeground}
                  />
                  <Text style={styles.benefitValue}>{credits}</Text>
                </View>
              )}
            </View>

            {/* Pricing */}
            {(t.price_monthly_cents || t.price_yearly_cents) && (
              <View style={styles.tierPricing}>
                {t.price_monthly_cents && (
                  <Text style={styles.tierPrice}>
                    {formatPrice(t.price_monthly_cents)}/mo
                  </Text>
                )}
                {t.price_monthly_cents && t.price_yearly_cents && (
                  <Text style={styles.tierPriceDivider}> or </Text>
                )}
                {t.price_yearly_cents && (
                  <Text style={styles.tierPrice}>
                    {formatPrice(t.price_yearly_cents)}/yr
                  </Text>
                )}
              </View>
            )}
          </Card>
        );
      })}

      {/* Booking Window Info */}
      <Text style={styles.sectionTitle}>Your Booking Window</Text>
      <Card>
        <View style={styles.windowRow}>
          <Text style={styles.windowLabel}>You can book</Text>
          <Text style={styles.windowValue}>{bookableWindowDays} days ahead</Text>
        </View>
      </Card>

      {/* CTA for non-members */}
      {!isMember && tiers.length > 0 && user && (
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
    paddingBottom: 120,
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
  creditCard: {
    marginBottom: spacing.lg,
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  creditHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  creditTitle: {
    ...typography.label,
    color: colors.primary,
    fontWeight: '600',
  },
  creditAmount: {
    ...typography.h2,
    color: colors.foreground,
  },
  creditSubtext: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
    marginTop: spacing['2xl'],
  },
  tierCard: {
    marginBottom: spacing.md,
  },
  tierCardActive: {
    borderColor: '#22c55e',
    borderWidth: 2,
  },
  tierHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  tierName: {
    ...typography.h3,
    color: colors.foreground,
  },
  benefitDescription: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginBottom: spacing.md,
  },
  benefitsList: {
    gap: spacing.sm,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  benefitValue: {
    ...typography.bodySmall,
    color: colors.foreground,
    flex: 1,
  },
  tierPricing: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  tierPrice: {
    ...typography.label,
    color: colors.foreground,
    fontWeight: '700',
  },
  tierPriceDivider: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
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
