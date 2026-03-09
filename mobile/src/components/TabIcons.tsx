import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path, Rect, Line, Circle } from 'react-native-svg';

interface IconProps {
  size: number;
  color: string;
}

/** Home — house icon */
export function HomeIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M8 22L24 8L40 22V40C40 41.1 39.1 42 38 42H10C8.9 42 8 41.1 8 40V22Z"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M18 42V26H30V42"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Book — open book icon */
export function BookIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M4 38V10C4 10 8 6 16 6C20 6 23 7.5 24 8.5C25 7.5 28 6 32 6C40 6 44 10 44 10V38C44 38 40 35 32 35C28 35 25 36.5 24 37.5C23 36.5 20 35 16 35C8 35 4 38 4 38Z"
        stroke={color}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line
        x1="24"
        y1="9"
        x2="24"
        y2="37.5"
        stroke={color}
        strokeWidth={3}
      />
    </Svg>
  );
}

/** My Bookings — notepad with pen icon */
export function BookingsIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* Notepad body */}
      <Rect
        x="8"
        y="6"
        width="26"
        height="36"
        rx="3"
        stroke={color}
        strokeWidth={3}
        fill="none"
      />
      {/* Lines on notepad */}
      <Line x1="14" y1="16" x2="28" y2="16" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Line x1="14" y1="23" x2="28" y2="23" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <Line x1="14" y1="30" x2="22" y2="30" stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      {/* Pen */}
      <Path
        d="M36 14L40.5 9.5C41.3 8.7 42.7 8.7 43.5 9.5C44.3 10.3 44.3 11.7 43.5 12.5L39 17L36 14Z"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1="36" y1="14" x2="39" y2="17" stroke={color} strokeWidth={2.5} />
      <Path
        d="M36 14L30 33L39 17"
        stroke={color}
        strokeWidth={2.5}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Membership — star icon */
export function MembershipIcon({ size, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <Path
        d="M24 4L29.5 17.5L44 19L33 29L36 44L24 37L12 44L15 29L4 19L18.5 17.5L24 4Z"
        stroke={color}
        strokeWidth={3}
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Account — circle with user initials */
export function AccountInitials({
  size,
  color,
  initials,
}: IconProps & { initials: string }) {
  return (
    <View
      style={[
        styles.initialsCircle,
        {
          width: size + 2,
          height: size + 2,
          borderRadius: (size + 2) / 2,
          borderColor: color,
        },
      ]}
    >
      <Text
        style={[
          styles.initialsText,
          { color, fontSize: size * 0.42 },
        ]}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  initialsCircle: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
