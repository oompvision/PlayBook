import { Platform, ViewStyle } from 'react-native';

type ShadowStyle = Pick<
  ViewStyle,
  'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius' | 'elevation'
>;

/** Level 1 — Section cards (Select Date, Facility, Time Slots) */
const surface1: ShadowStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.03,
  shadowRadius: 2,
  elevation: 1,
};

/** Level 2 — Priority / floating cards (Booking Details) */
const surface2: ShadowStyle = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 12,
  elevation: 4,
};

export const shadows = { surface1, surface2 } as const;
