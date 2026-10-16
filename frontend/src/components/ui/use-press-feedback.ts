import { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

const PRESSED_SCALE = 0.97;
const timing = {
  duration: motion.durationFast,
  easing: Easing.bezier(...motion.easingStandard),
  // Con «reducir movimiento» del sistema, el cambio es instantáneo.
  reduceMotion: ReduceMotion.System,
};

/**
 * Respuesta al pulsar: el control se encoge un poco (120 ms). Devuelve el estilo animado y los
 * manejadores para un `Pressable` animado; el cambio de color del estado pulsado lo pone cada control.
 */
export function usePressFeedback() {
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return {
    animatedStyle,
    onPressIn: () => {
      scale.set(withTiming(PRESSED_SCALE, timing));
    },
    onPressOut: () => {
      scale.set(withTiming(1, timing));
    },
  };
}
