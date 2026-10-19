import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  ReduceMotion,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';

import { useAppTheme } from '@/theme/theme-provider';
import { colors as allColors, fontFamily, motion } from '@/theme/tokens';

/** Día anterior en el anillo: registrado, sin registro o hueco (sin datos que mostrar). */
export type RingDay = 'on' | 'off' | 'gap';

type WeekRingProps = {
  /** Los 6 días anteriores, del más antiguo a ayer (sentido horario desde arriba). */
  days: readonly RingDay[];
  /** Punto de hoy: pendiente (contorno sol), hecho (relleno sol) o sin punto. */
  today: 'pending' | 'done' | 'none';
  /** Texto central en mono (p. ej. «5/7»). */
  text?: string;
  /** Línea pequeña bajo el texto central («ESTA SEMANA», tablero 5.3). */
  caption?: string;
  /** Cuerpo del texto central en unidades del anillo (64): 10 por defecto, 9 con `caption`. */
  textSize?: number;
  /** Descripción completa para lectores de pantalla. */
  accessibilityLabel: string;
  size?: number;
  /** Sobre `laguna-900` (bienvenida): segmentos en laguna claro y texto en niebla. */
  inverse?: boolean;
  /** Anima el relleno del punto de hoy al pasar a «hecho» (320 ms, GUIA-DE-MARCA.md › Movimiento). */
  animateToday?: boolean;
};

// Geometría del generador de marca (`docs/design/fuente/prototipo/lib.py`, `SEGS` y `ring`).
const SEGMENTS = [
  'M34.11 10.10A22 22 0 0 1 47.81 16.70',
  'M50.44 19.99A22 22 0 0 1 53.82 34.82',
  'M52.88 38.93A22 22 0 0 1 43.40 50.82',
  'M39.60 52.64A22 22 0 0 1 24.40 52.64',
  'M20.60 50.82A22 22 0 0 1 11.12 38.93',
  'M10.18 34.82A22 22 0 0 1 13.56 19.99',
];
const TODAY = { cx: 22.45, cy: 12.18, pendingR: 3.8, doneR: 4.6 };

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * Anillo semanal (el lenguaje del hábito, GUIA-DE-MARCA.md): seis días y el punto sol de hoy. Un día
 * sin registro se ve, sin culpa (gris); nunca se rellena lo que no se registró.
 */
export function WeekRing({
  days,
  today,
  text,
  caption,
  textSize,
  accessibilityLabel,
  size = 104,
  inverse = false,
  animateToday = false,
}: WeekRingProps) {
  const { colors } = useAppTheme();
  const onColor = inverse ? allColors.dark.primary : colors.primary;
  const offColor = inverse ? allColors.dark.line : colors.line;
  const textColor = inverse ? colors.inkInverse : colors.ink;
  const pendingFill = inverse ? colors.surfaceInverse : colors.surface;

  const progress = useSharedValue(today === 'done' && !animateToday ? 1 : 0);
  useEffect(() => {
    const target = today === 'done' ? 1 : 0;
    // Sin animación se fija el valor (un `withTiming` de 0 ms no siempre se aplica en web).
    if (!animateToday) {
      progress.set(target);
      return;
    }
    progress.set(
      withTiming(target, {
        duration: motion.durationSlow,
        easing: Easing.bezier(...motion.easingStandard),
        reduceMotion: ReduceMotion.System,
      })
    );
  }, [today, animateToday, progress]);

  // El relleno cambia con el estado; se animan el radio y el contorno (en web, Reanimated no aplica
  // colores animados a atributos SVG).
  const todayProps = useAnimatedProps(() => ({
    r: interpolate(progress.value, [0, 1], [TODAY.pendingR, TODAY.doneR]),
    strokeWidth: interpolate(progress.value, [0, 1], [2, 0]),
  }));

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <G fill="none" strokeWidth={5.5} strokeLinecap="round">
          {SEGMENTS.map((d, index) => {
            const day = days[index] ?? 'off';
            return (
              <Path
                key={d}
                d={d}
                stroke={day === 'on' ? onColor : offColor}
                strokeDasharray={day === 'gap' ? '1.5 2.5' : undefined}
              />
            );
          })}
        </G>
        {today === 'none' ? null : (
          <AnimatedCircle
            cx={TODAY.cx}
            cy={TODAY.cy}
            stroke={colors.accent}
            fill={today === 'done' ? colors.accent : pendingFill}
            animatedProps={todayProps}
          />
        )}
        {text ? (
          <SvgText
            x={32}
            y={caption ? 34 : 35.5}
            textAnchor="middle"
            fontSize={textSize ?? (caption ? 9 : 10)}
            fontFamily={fontFamily.mono500}
            fill={textColor}>
            {text}
          </SvgText>
        ) : null}
        {caption ? (
          <SvgText
            x={32}
            y={41}
            textAnchor="middle"
            fontSize={3.6}
            fontFamily={fontFamily.mono500}
            fill={colors.inkMuted}>
            {caption}
          </SvgText>
        ) : null}
      </Svg>
    </View>
  );
}
