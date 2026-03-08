import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useAuth } from '../lib/auth-context';
import { useFacility } from '../lib/facility-context';
import { useMembership } from '../lib/use-membership';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Input } from '../components/Input';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography } from '../theme';
import type { Location } from '../types';

export function AccountScreen() {
  const { user, profile, signOut, refreshProfile } = useAuth();
  const { organization, selectedLocation, locations, hasMultipleLocations, selectLocation } = useFacility();
  const { isMember, tier, membershipEnabled, bookableWindowDays } = useMembership();
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.full_name || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', user.id);
    setSaving(false);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      await refreshProfile();
      setEditing(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: signOut },
    ]);
  };

  const handleSelectLocation = (loc: Location) => {
    selectLocation(loc);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Profile Section */}
      <Text style={styles.sectionTitle}>Profile</Text>
      <Card>
        {editing ? (
          <>
            <Input
              label="Full Name"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
            />
            <View style={styles.editActions}>
              <Button
                title="Cancel"
                variant="secondary"
                size="sm"
                onPress={() => {
                  setFullName(profile?.full_name || '');
                  setEditing(false);
                }}
              />
              <Button title="Save" size="sm" onPress={handleSave} loading={saving} />
            </View>
          </>
        ) : (
          <>
            <View style={styles.profileRow}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{profile?.full_name || '—'}</Text>
            </View>
            <View style={styles.profileRow}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{profile?.email || user?.email || '—'}</Text>
            </View>
            <Button
              title="Edit Profile"
              variant="secondary"
              size="sm"
              onPress={() => setEditing(true)}
              style={styles.editButton}
            />
          </>
        )}
      </Card>

      {/* Membership Summary */}
      {membershipEnabled && (
        <>
          <Text style={styles.sectionTitle}>Membership</Text>
          <Card>
            <View style={styles.membershipRow}>
              <View>
                <Text style={styles.membershipStatus}>
                  {isMember ? (tier?.name ?? 'Member') : 'Guest'}
                </Text>
                <Text style={styles.membershipDetail}>
                  Book up to {bookableWindowDays} days ahead
                </Text>
              </View>
              <Badge
                label={isMember ? 'Active' : 'Guest'}
                variant={isMember ? 'success' : 'muted'}
              />
            </View>
          </Card>
        </>
      )}

      {/* Location Selector — only shown if org has multiple locations */}
      {hasMultipleLocations && (
        <>
          <Text style={styles.sectionTitle}>Location</Text>
          {locations.map((loc) => {
            const isSelected = selectedLocation?.id === loc.id;
            return (
              <TouchableOpacity
                key={loc.id}
                onPress={() => handleSelectLocation(loc)}
                activeOpacity={0.7}
              >
                <Card style={[styles.locationCard, isSelected && styles.locationCardSelected]}>
                  <View style={styles.locationRow}>
                    <View>
                      <Text style={styles.locationName}>{loc.name}</Text>
                      {loc.address && (
                        <Text style={styles.locationAddress}>{loc.address}</Text>
                      )}
                    </View>
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })}
        </>
      )}

      {/* Current Facility Info */}
      {organization && (
        <>
          <Text style={styles.sectionTitle}>Facility Info</Text>
          <Card>
            <View style={styles.profileRow}>
              <Text style={styles.label}>Name</Text>
              <Text style={styles.value}>{organization.name}</Text>
            </View>
            {selectedLocation && selectedLocation.name !== organization.name && (
              <View style={styles.profileRow}>
                <Text style={styles.label}>Location</Text>
                <Text style={styles.value}>{selectedLocation.name}</Text>
              </View>
            )}
            {(selectedLocation?.address || organization.address) && (
              <View style={styles.profileRow}>
                <Text style={styles.label}>Address</Text>
                <Text style={styles.value}>
                  {selectedLocation?.address || organization.address}
                </Text>
              </View>
            )}
            {organization.phone && (
              <View style={styles.profileRow}>
                <Text style={styles.label}>Phone</Text>
                <Text style={styles.value}>{organization.phone}</Text>
              </View>
            )}
          </Card>
        </>
      )}

      {/* Sign Out */}
      <Button
        title="Sign Out"
        variant="destructive"
        onPress={handleSignOut}
        style={styles.signOutButton}
      />
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
  sectionTitle: {
    ...typography.h3,
    color: colors.foreground,
    marginBottom: spacing.md,
    marginTop: spacing['2xl'],
  },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  label: {
    ...typography.label,
    color: colors.mutedForeground,
  },
  value: {
    ...typography.body,
    color: colors.foreground,
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.lg,
  },
  editButton: {
    marginTop: spacing.md,
    alignSelf: 'flex-start',
  },
  editActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  locationCard: {
    marginBottom: spacing.sm,
  },
  locationCardSelected: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  locationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  locationName: {
    ...typography.label,
    color: colors.foreground,
  },
  locationAddress: {
    ...typography.caption,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  checkmark: {
    ...typography.h2,
    color: colors.primary,
  },
  membershipRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  membershipStatus: {
    ...typography.label,
    color: colors.foreground,
  },
  membershipDetail: {
    ...typography.bodySmall,
    color: colors.mutedForeground,
    marginTop: 2,
  },
  signOutButton: {
    marginTop: spacing['3xl'],
  },
});
