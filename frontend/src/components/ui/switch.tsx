import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '@/hooks/use-theme';
import { borderWidth, motion, opacity, radius, size } from '@/theme/tokens';

type SwitchProps = {
  value: boolean;
  onValueChange: (value: boolean) => void;
  /** Obligatorio: lo que activa el interruptor (normalmente la etiqueta visible a su lado). */
  accessibilityLabel: string;
  disabled?: boolean;
};

const WIDTH = 52;
const HEIGHT = 32;

/** Interruptor de marca (52×32): apagado con borde de control, encendido en `primary`. */
export function Switch({ value, onValueChange, accessibilityLabel, disabled = false }: SwitchProps) {
  const theme = useTheme();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.set(
      withTiming(value ? 1 : 0, {
        duration: motion.durationFast,
        easing: Easing.bezier(...motion.easingStandard),
        reduceMotion: ReduceMotion.System,
      })
    );
  }, [value, progress]);

  const off = theme.surfaceSunken;
  const on = theme.primary;
  const thumbOff = theme.lineControl;
  const thumbOn = theme.onPrimary;

  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [off, on]),
    borderColor: interpolateColor(progress.value, [0, 1], [thumbOff, on]),
  }));
  const thumbStyle = useAnimatedStyle(() => {
    const diameter = interpolate(progress.value, [0, 1], [20, 24]);
    return {
      width: diameter,
      height: diameter,
      backgroundColor: interpolateColor(progress.value, [0, 1], [thumbOff, thumbOn]),
      transform: [{ translateX: interpolate(progress.value, [0, 1], [6, 26]) - borderWidth.control }],
    };
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={(size.touchMin - HEIGHT) / 2}
      onPress={() => onValueChange(!value)}
      style={disabled && styles.disabled}>
      <Animated.View style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: WIDTH,
    height: HEIGHT,
    borderRadius: radius.full,
    borderWidth: borderWidth.control,
    justifyContent: 'center',
  },
  thumb: {
    borderRadius: radius.full,
  },
  disabled: {
    opacity: opacity.disabled,
  },
});
