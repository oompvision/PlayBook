import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Organization, Bay } from '../types';

const FACILITY_STORAGE_KEY = 'ezbooker_selected_facility';

interface FacilityState {
  organization: Organization | null;
  bays: Bay[];
  isLoading: boolean;
  /** All locations for the org */
  locations: Organization[];
  selectFacility: (org: Organization) => Promise<void>;
  refreshBays: () => Promise<void>;
}

const FacilityContext = createContext<FacilityState | undefined>(undefined);

export function FacilityProvider({ children }: { children: React.ReactNode }) {
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [bays, setBays] = useState<Bay[]>([]);
  const [locations, setLocations] = useState<Organization[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load saved facility on mount
  useEffect(() => {
    loadSavedFacility();
    loadLocations();
  }, []);

  const loadLocations = async () => {
    const { data } = await supabase
      .from('organizations')
      .select('*')
      .order('name');
    if (data) {
      setLocations(data);
      // If no saved facility, auto-select first
      if (data.length > 0) {
        const saved = await AsyncStorage.getItem(FACILITY_STORAGE_KEY);
        if (!saved) {
          await selectFacility(data[0]);
        }
      }
    }
    setIsLoading(false);
  };

  const loadSavedFacility = async () => {
    try {
      const saved = await AsyncStorage.getItem(FACILITY_STORAGE_KEY);
      if (saved) {
        const org = JSON.parse(saved) as Organization;
        setOrganization(org);
        await fetchBays(org.id);
      }
    } catch {
      // No saved facility — will be set when locations load
    }
  };

  const fetchBays = async (orgId: string) => {
    const { data } = await supabase
      .from('bays')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order');
    if (data) {
      setBays(data);
    }
  };

  const selectFacility = async (org: Organization) => {
    setOrganization(org);
    await AsyncStorage.setItem(FACILITY_STORAGE_KEY, JSON.stringify(org));
    await fetchBays(org.id);
  };

  const refreshBays = async () => {
    if (organization) {
      await fetchBays(organization.id);
    }
  };

  return (
    <FacilityContext.Provider
      value={{ organization, bays, isLoading, locations, selectFacility, refreshBays }}
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
