/**
 * EZ Booker color palette — matches the web app's design tokens.
 */
export const colors = {
  // Core
  primary: '#16A34A',
  primaryForeground: '#ffffff',
  background: '#F6F7F8',
  foreground: '#0a0a0a',

  // Surfaces
  card: '#ffffff',
  cardForeground: '#0a0a0a',
  muted: '#f5f5f5',
  mutedForeground: '#737373',

  // Accents
  accent: '#f5f5f5',
  accentForeground: '#1a1a1a',
  secondary: '#f5f5f5',
  secondaryForeground: '#1a1a1a',

  // Semantic
  destructive: '#ef4444',
  destructiveForeground: '#ffffff',
  success: '#22c55e',
  successForeground: '#ffffff',
  warning: '#f59e0b',

  // Borders & inputs
  border: '#e5e5e5',
  input: '#e5e5e5',
  ring: '#a3a3a3',

  // Misc
  white: '#ffffff',
  black: '#000000',
  transparent: 'transparent',

  // Elevation & selection
  surface0: '#F6F7F8',
  selectionBg: '#F0FDF4',

  // Status colors (for booking slots)
  available: '#22c55e',
  booked: '#ef4444',
  blocked: '#9ca3af',
  selected: '#16A34A',
} as const;

export type ColorName = keyof typeof colors;
