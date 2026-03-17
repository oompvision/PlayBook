import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { colors } from '../theme/colors';

const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home',
  Book: 'calendar',
  Bookings: 'list',
  Membership: 'star',
  Account: 'person',
};

const ICON_MAP_OUTLINE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Home: 'home-outline',
  Book: 'calendar-outline',
  Bookings: 'list-outline',
  Membership: 'star-outline',
  Account: 'person-outline',
};

export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const tabCount = state.routes.length;
  const activeIndex = state.index;

  // Find the index of the "Book" tab (it may shift if Membership is toggled)
  const bookTabIndex = state.routes.findIndex((r) => r.name === 'Book');

  // Animated pill indicator
  const translateX = useSharedValue(0);

  useEffect(() => {
    // Skip indicator animation for the Book tab (it has its own raised button)
    if (activeIndex === bookTabIndex) return;

    // Calculate position — we need to account for the Book tab taking space
    // The indicator slides across non-book tabs
    translateX.value = withSpring(activeIndex * (1 / tabCount) * 100, {
      damping: 15,
      stiffness: 120,
    });
  }, [activeIndex, tabCount, bookTabIndex]);

  const indicatorStyle = useAnimatedStyle(() => ({
    left: `${translateX.value}%` as any,
  }));

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <BlurView intensity={40} tint="light" style={styles.container}>
        {/* Active pill indicator */}
        {activeIndex !== bookTabIndex && (
          <Animated.View
            style={[
              styles.indicator,
              {
                width: `${(1 / tabCount) * 100}%` as any,
              },
              indicatorStyle,
            ]}
          >
            <View style={styles.indicatorInner} />
          </Animated.View>
        )}

        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.tabBarLabel !== undefined
            ? String(options.tabBarLabel)
            : options.title !== undefined
            ? options.title
            : route.name;

          const isActive = activeIndex === index;
          const isBookTab = route.name === 'Book';

          const onPress = () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isActive && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          // Raised "Book" button
          if (isBookTab) {
            return (
              <TouchableOpacity
                key={route.key}
                style={styles.tab}
                onPress={onPress}
                activeOpacity={0.8}
              >
                <View style={[styles.primaryButton, isActive && styles.primaryButtonActive]}>
                  <Ionicons name="add" size={24} color="white" />
                </View>
              </TouchableOpacity>
            );
          }

          const iconName = isActive
            ? (ICON_MAP[route.name] || 'ellipse')
            : (ICON_MAP_OUTLINE[route.name] || 'ellipse-outline');

          return (
            <TouchableOpacity
              key={route.key}
              style={styles.tab}
              onPress={onPress}
              activeOpacity={0.8}
            >
              <Ionicons
                name={iconName}
                size={20}
                color={isActive ? colors.primary : '#6B7280'}
              />
              <Text style={[styles.label, isActive && styles.activeLabel]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    alignItems: 'center',
  },
  container: {
    flexDirection: 'row',
    width: '90%',
    borderRadius: 30,
    paddingVertical: 12,
    paddingHorizontal: 10,
    overflow: 'hidden',
    // Fallback background for Android (BlurView may not work as well)
    ...Platform.select({
      android: {
        backgroundColor: 'rgba(255,255,255,0.92)',
      },
    }),
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 10,
    color: '#6B7280',
    marginTop: 4,
  },
  activeLabel: {
    color: colors.primary,
    fontWeight: '600',
  },
  indicator: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  indicatorInner: {
    height: 40,
    width: '80%',
    backgroundColor: 'rgba(22,163,74,0.15)',
    borderRadius: 20,
  },
  primaryButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -30,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  primaryButtonActive: {
    backgroundColor: '#15803D', // slightly darker when active
  },
});
