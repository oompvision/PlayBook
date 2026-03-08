import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { borderRadius, spacing } from '../theme/spacing';
import { typography } from '../theme/typography';

interface BadgeProps {
  label: string;
  variant?: 'default' | 'success' | 'destructive' | 'warning' | 'muted';
}

const variantColors = {
  default: { bg: colors.primary, text: colors.primaryForeground },
  success: { bg: '#dcfce7', text: '#166534' },
  destructive: { bg: '#fee2e2', text: '#991b1b' },
  warning: { bg: '#fef3c7', text: '#92400e' },
  muted: { bg: colors.muted, text: colors.mutedForeground },
};

export function Badge({ label, variant = 'default' }: BadgeProps) {
  const c = variantColors[variant];

  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    ...typography.caption,
    fontWeight: '600',
  },
});
