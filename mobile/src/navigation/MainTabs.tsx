import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { BookingScreen } from '../screens/BookingScreen';
import { MyBookingsScreen } from '../screens/MyBookingsScreen';
import { MembershipScreen } from '../screens/MembershipScreen';
import { AccountScreen } from '../screens/AccountScreen';
import { useFacility } from '../lib/facility-context';
import { colors } from '../theme/colors';
import { FloatingTabBar } from '../components/FloatingTabBar';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const { organization } = useFacility();
  const membershipEnabled = organization?.membership_tiers_enabled ?? false;

  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingTabBar {...props} />}
      screenOptions={{
        animation: 'none',
        headerStyle: {
          backgroundColor: colors.card,
        },
        headerTintColor: colors.foreground,
        headerShadowVisible: false,
        headerTitleStyle: {
          fontWeight: '600' as const,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ headerShown: false }}
      />
      <Tab.Screen
        name="Bookings"
        component={MyBookingsScreen}
        options={{ title: 'Bookings' }}
      />
      <Tab.Screen
        name="Book"
        component={BookingScreen}
        options={{ title: 'Book', tabBarLabel: 'Book' }}
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
