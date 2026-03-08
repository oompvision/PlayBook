import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Organization, Bay, Location, Profile } from '../types';

const LOCATION_STORAGE_KEY = 'ezbooker_selected_location';

interface FacilityState {
  organization: Organization | null;
  /** Currently selected location within the org */
  selectedLocation: Location | null;
  /** All active locations for the org */
  locations: Location[];
  /** Bays for the selected location */
  bays: Bay[];
  isLoading: boolean;
  /** Whether the org has multiple locations */
  hasMultipleLocations: boolean;
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
  const [isLoading, setIsLoading] = useState(true);

  const orgId = profile?.org_id ?? null;

  // Load org and locations when profile changes
  useEffect(() => {
    if (!orgId) {
      setOrganization(null);
      setSelectedLocation(null);
      setLocations([]);
      setBays([]);
      setIsLoading(false);
      return;
    }

    loadOrgAndLocations(orgId);
  }, [orgId]);

  const loadOrgAndLocations = async (oid: string) => {
    setIsLoading(true);

    // Fetch the user's organization
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
      await fetchBays(oid, selected.id);
    }

    setIsLoading(false);
  };

  const fetchBays = async (oid: string, locationId: string) => {
    const { data } = await supabase
      .from('bays')
      .select('*')
      .eq('org_id', oid)
      .eq('location_id', locationId)
      .eq('is_active', true)
      .order('sort_order');
    setBays((data as Bay[]) || []);
  };

  const selectLocation = async (location: Location) => {
    setSelectedLocation(location);
    await AsyncStorage.setItem(LOCATION_STORAGE_KEY, location.id);
    if (orgId) {
      await fetchBays(orgId, location.id);
    }
  };

  const refreshBays = useCallback(async () => {
    if (orgId && selectedLocation) {
      await fetchBays(orgId, selectedLocation.id);
    }
  }, [orgId, selectedLocation]);

  const hasMultipleLocations = locations.length > 1;

  return (
    <FacilityContext.Provider
      value={{
        organization,
        selectedLocation,
        locations,
        bays,
        isLoading,
        hasMultipleLocations,
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
