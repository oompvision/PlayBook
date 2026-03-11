import React, { useCallback, useRef } from 'react';
import {
  Animated,
  Pressable,
  PressableProps,
  StyleProp,
  ViewStyle,
} from 'react-native';

interface PressableScaleProps extends PressableProps {
  scaleDown?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * A Pressable wrapper that scales down on press for premium touch feedback.
 * Default scale: 0.98 (subtle).
 */
export function PressableScale({
  scaleDown = 0.98,
  style,
  children,
  ...props
}: PressableScaleProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const onPressIn = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: scaleDown,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim, scaleDown]);

  const onPressOut = useCallback(() => {
    Animated.timing(scaleAnim, {
      toValue: 1,
      duration: 100,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      {...props}
    >
      <Animated.View style={[style, { transform: [{ scale: scaleAnim }] }]}>
        {children}
      </Animated.View>
    </Pressable>
  );
}
