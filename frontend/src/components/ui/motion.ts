import { Easing, FadeIn, FadeInDown, ReduceMotion, SlideInDown } from 'react-native-reanimated';

import { motion } from '@/theme/tokens';

/**
 * Entradas de superposiciones (GUIA-DE-MARCA.md › Movimiento; PANTALLAS.md §4): velo y subida en
 * `duration-base` con la curva estándar. Con «reducir movimiento» del sistema, instantáneas.
 */
const standard = Easing.bezier(...motion.easingStandard);

export const scrimEntering = FadeIn.duration(motion.durationBase).easing(standard).reduceMotion(ReduceMotion.System);

export const sheetEntering = SlideInDown.duration(motion.durationBase)
  .easing(standard)
  .reduceMotion(ReduceMotion.System);

export const popEntering = FadeInDown.duration(motion.durationBase)
  .easing(standard)
  .reduceMotion(ReduceMotion.System);
