import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { BookingScreen } from '../screens/BookingScreen';
import { MyBookingsScreen } from '../screens/MyBookingsScreen';
import { MembershipScreen } from '../screens/MembershipScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { useFacility } from '../lib/facility-context';
import { useAuth } from '../lib/auth-context';
import { colors } from '../theme/colors';
import {
  HomeIcon,
  BookIcon,
  BookingsIcon,
  MembershipIcon,
  AccountInitials,
} from '../components/TabIcons';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

function getInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0].substring(0, 2).toUpperCase();
}

const TAB_ICON_SIZE = 26;

export function MainTabs() {
  const { organization } = useFacility();
  const { profile } = useAuth();
  const membershipEnabled = organization?.membership_tiers_enabled ?? false;
  const initials = getInitials(profile?.full_name);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: Platform.OS === 'ios' ? 92 : 68,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500' as const,
          marginTop: 2,
        },
        headerStyle: {
          backgroundColor: colors.card,
        },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitleStyle: {
          fontWeight: '600' as const,
        },
        tabBarIcon: ({ color }) => {
          const size = TAB_ICON_SIZE;
          switch (route.name) {
            case 'Home':
              return <HomeIcon size={size} color={color} />;
            case 'Book':
              return <BookIcon size={size} color={color} />;
            case 'Bookings':
              return <BookingsIcon size={size} color={color} />;
            case 'Membership':
              return <MembershipIcon size={size} color={color} />;
            case 'Account':
              return <AccountInitials size={size} color={color} initials={initials} />;
            default:
              return null;
          }
        },
      })}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ title: 'Home' }}
      />
      <Tab.Screen
        name="Book"
        component={BookingScreen}
        options={{ title: 'Book', tabBarLabel: 'Book' }}
      />
      <Tab.Screen
        name="Bookings"
        component={MyBookingsScreen}
        options={{ title: 'My Bookings' }}
      />
      {membershipEnabled && (
        <Tab.Screen
          name="Membership"
          component={MembershipScreen}
          options={{ title: 'Membership' }}
        />
      )}
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        options={{ title: 'Account' }}
      />
    </Tab.Navigator>
  );
}
