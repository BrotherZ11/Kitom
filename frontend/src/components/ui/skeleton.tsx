import { useEffect } from 'react';
import { type DimensionValue, StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { radius as radii } from '@/theme/tokens';

type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  radius?: number;
};

/**
 * Bloque de carga: pulso suave sin degradados; con «reducir movimiento», estático. Decorativo: quien
 * lo usa anuncia la carga (`LoadingState`).
 */
export function Skeleton({ width = '100%', height, radius = radii.sm }: SkeletonProps) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) return;
    pulse.set(withRepeat(withTiming(0.55, { duration: 700, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[styles.block, { width, height, borderRadius: radius, backgroundColor: theme.surfaceSunken }, animatedStyle]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    overflow: 'hidden',
  },
});
