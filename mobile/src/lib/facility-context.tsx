import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Organization, Bay, Location, Profile, FacilityGroup } from '../types';

const LOCATION_STORAGE_KEY = 'ezbooker_selected_location';

interface FacilityState {
  organization: Organization | null;
  /** Currently selected location within the org */
  selectedLocation: Location | null;
  /** All active locations for the org */
  locations: Location[];
  /** Bays for the selected location */
  bays: Bay[];
  /** Facility groups for the selected location (dynamic scheduling only) */
  facilityGroups: FacilityGroup[];
  /** Bays not in any group (dynamic scheduling only) */
  standaloneBays: Bay[];
  /** Available durations from dynamic schedule rules */
  availableDurations: number[];
  isLoading: boolean;
  /** Whether the org has multiple locations */
  hasMultipleLocations: boolean;
  /** Whether the org uses dynamic scheduling */
  isDynamic: boolean;
  selectLocation: (location: Location) => Promise<void>;
  refreshBays: () => Promise<void>;
}

const FacilityContext = createContext<FacilityState | undefined>(undefined);

interface FacilityProviderProps {
  profile: Profile | null;
  children: React.ReactNode;
}

export function FacilityProvider({ profile, children }: FacilityProviderProps) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [bays, setBays] = useState<Bay[]>([]);
  const [facilityGroups, setFacilityGroups] = useState<FacilityGroup[]>([]);
  const [standaloneBays, setStandaloneBays] = useState<Bay[]>([]);
  const [availableDurations, setAvailableDurations] = useState<number[]>([60]);
  const [isLoading, setIsLoading] = useState(true);

  const orgId = profile?.org_id ?? null;

  // Load org and locations when profile changes
  useEffect(() => {
    if (!orgId) {
      setOrganization(null);
      setSelectedLocation(null);
      setLocations([]);
      setBays([]);
      setFacilityGroups([]);
      setStandaloneBays([]);
      setIsLoading(false);
      return;
    }

    loadOrgAndLocations(orgId);
  }, [orgId]);

  const loadOrgAndLocations = async (oid: string) => {
    setIsLoading(true);

    // Fetch the user's organization (including scheduling_type)
    const { data: orgData } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', oid)
      .single();

    if (!orgData) {
      setIsLoading(false);
      return;
    }

    setOrganization(orgData as Organization);

    // Fetch active locations for this org
    const { data: locData } = await supabase
      .from('locations')
      .select('*')
      .eq('org_id', oid)
      .eq('is_active', true)
      .order('is_default', { ascending: false })
      .order('name');

    const locs = (locData || []) as Location[];
    setLocations(locs);

    // Try to restore saved location
    let selected: Location | null = null;
    try {
      const savedId = await AsyncStorage.getItem(LOCATION_STORAGE_KEY);
      if (savedId) {
        selected = locs.find((l) => l.id === savedId) || null;
      }
    } catch {
      // ignore
    }

    // Fall back to default location, then first location
    if (!selected) {
      selected = locs.find((l) => l.is_default) || locs[0] || null;
    }

    if (selected) {
      setSelectedLocation(selected);
      await fetchBaysAndGroups(oid, selected.id, orgData.scheduling_type ?? 'slot_based');
    }

    setIsLoading(false);
  };

  const fetchBaysAndGroups = async (
    oid: string,
    locationId: string,
    schedulingType: string
  ) => {
    // Fetch active bays
    const { data: bayData } = await supabase
      .from('bays')
      .select('*')
      .eq('org_id', oid)
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('sort_order');

    const allBays = (bayData as Bay[]) || [];
    setBays(allBays);

    if (schedulingType !== 'dynamic' || allBays.length === 0) {
      setFacilityGroups([]);
      setStandaloneBays([]);
      setAvailableDurations([60]);
      return;
    }

    // Fetch facility groups and members for dynamic scheduling
    const [groupsResult, membersResult, rulesResult] = await Promise.all([
      supabase
        .from('facility_groups')
        .select('id, name, description')
        .eq('org_id', oid)
        .eq('location_id', locationId),
      supabase
        .from('facility_group_members')
        .select('group_id, bay_id')
        .in('bay_id', allBays.map((b) => b.id)),
      supabase
        .from('dynamic_schedule_rules')
        .select('available_durations')
        .eq('org_id', oid)
        .eq('location_id', locationId)
        .limit(1),
    ]);

    const groups = groupsResult.data || [];
    const members = membersResult.data || [];

    // Build bay → group mapping
    const bayGroupMap = new Map<string, string>();
    for (const m of members) {
      bayGroupMap.set(m.bay_id, m.group_id);
    }

    // Build facility groups with their bays
    const builtGroups: FacilityGroup[] = groups
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        bays: allBays.filter((b) => bayGroupMap.get(b.id) === g.id),
      }))
      .filter((g) => g.bays.length > 0);

    setFacilityGroups(builtGroups);

    // Standalone bays = not in any group
    setStandaloneBays(allBays.filter((b) => !bayGroupMap.has(b.id)));

    // Get available durations from first rule
    if (rulesResult.data?.[0]?.available_durations) {
      setAvailableDurations(rulesResult.data[0].available_durations);
    } else {
      setAvailableDurations([60]);
    }
  };

  const selectLocation = async (location: Location) => {
    setSelectedLocation(location);
    await AsyncStorage.setItem(LOCATION_STORAGE_KEY, location.id);
    if (orgId && organization) {
      await fetchBaysAndGroups(
        orgId,
        location.id,
        organization.scheduling_type ?? 'slot_based'
      );
    }
  };

  const refreshBays = useCallback(async () => {
    if (orgId && selectedLocation && organization) {
      await fetchBaysAndGroups(
        orgId,
        selectedLocation.id,
        organization.scheduling_type ?? 'slot_based'
      );
    }
  }, [orgId, selectedLocation, organization]);

  const hasMultipleLocations = locations.length > 1;
  const isDynamic = organization?.scheduling_type === 'dynamic';

  return (
    <FacilityContext.Provider
      value={{
        organization,
        selectedLocation,
        locations,
        bays,
        facilityGroups,
        standaloneBays,
        availableDurations,
        isLoading,
        hasMultipleLocations,
        isDynamic,
        selectLocation,
        refreshBays,
      }}
    >
      {children}
    </FacilityContext.Provider>
  );
}

export function useFacility() {
  const context = useContext(FacilityContext);
  if (!context) {
    throw new Error('useFacility must be used within a FacilityProvider');
  }
  return context;
}
