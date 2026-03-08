import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFacility } from '../lib/facility-context';
import { Card } from '../components/Card';
import { colors, spacing, typography } from '../theme';
import type { Location } from '../types';

/**
 * Shown when the org has multiple locations and the user
 * hasn't selected one yet. Lists locations within their org.
 */
export function FacilityPickerScreen() {
  const { organization, locations, selectLocation, isLoading } = useFacility();

  if (isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const renderItem = ({ item }: { item: Location }) => (
    <TouchableOpacity onPress={() => selectLocation(item)} activeOpacity={0.7}>
      <Card style={styles.facilityCard}>
        <Text style={styles.facilityName}>{item.name}</Text>
        {item.address && <Text style={styles.facilityAddress}>{item.address}</Text>}
      </Card>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Choose Your Location</Text>
        <Text style={styles.subtitle}>
          {organization?.name
            ? `${organization.name} has multiple locations. Select one to continue.`
            : 'Select a location to browse availability and book.'}
        </Text>
      </View>
      <FlatList
        data={locations}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    padding: spacing['2xl'],
    paddingTop: spacing['4xl'],
  },
  title: {
    ...typography.h1,
    color: colors.foreground,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.mutedForeground,
  },
  list: {
    padding: spacing.lg,
  },
  facilityCard: {
    marginBottom: spacing.md,
  },
  facilityName: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.xs,
  },
  facilityAddress: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
  },
});
