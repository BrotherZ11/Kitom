import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { DistributionCounts } from '@/components/ui/distribution-bar';
import { Text } from '@/components/ui/text';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { fontFamily, spacing } from '@/theme/tokens';

export type WeekColumn = { counts: DistributionCounts; withoutValue: number };

type WeekColumnsProps = {
  weeks: readonly WeekColumn[];
  color: ThemeColor;
  /** Etiqueta bajo cada columna (`''` para no poner ninguna). */
  xLabels: readonly string[];
  /** Descripción para lectores de pantalla (qué se ve, sin interpretar). */
  accessibilityLabel: string;
  height?: number;
};

const DAYS_PER_WEEK = 7;
const LABEL_WIDTH = 56;

/**
 * Semanas como columnas apiladas de 7 días (evolución a 90 días, donde una línea diaria con huecos no
 * se lee): abajo los días por debajo de lo habitual (color de la serie), luego «como siempre» (gris de
 * las gráficas), luego por encima (solo borde, sin relleno: no depende del color) y arriba los días sin
 * dato, vacíos (fondo de la tarjeta con filete). Nada se rellena ni se estima.
 */
export function WeekColumns({ weeks, color, xLabels, accessibilityLabel, height = 140 }: WeekColumnsProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const gap = 4;
  const columnWidth = weeks.length > 0 ? Math.max(4, (width - gap * (weeks.length - 1)) / weeks.length) : 0;
  const unit = height / DAYS_PER_WEEK;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.container}>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={height}>
            {weeks.map((_, index) => (
              <Rect
                key={`bg-${index}`}
                x={index * (columnWidth + gap)}
                y={0}
                width={columnWidth}
                height={height}
                fill={theme.surface}
                stroke={theme.line}
                strokeWidth={1}
                rx={3}
              />
            ))}
            {weeks.map((week, index) => {
              const x = index * (columnWidth + gap);
              const below = week.counts.below * unit;
              const usual = week.counts.usual * unit;
              const above = week.counts.above * unit;
              return [
                below > 0 ? (
                  <Rect key={`b-${index}`} x={x} y={height - below} width={columnWidth} height={below} fill={theme[color]} rx={2} />
                ) : null,
                usual > 0 ? (
                  <Rect
                    key={`u-${index}`}
                    x={x}
                    y={height - below - usual}
                    width={columnWidth}
                    height={usual}
                    fill={theme.chartGrid}
                    rx={2}
                  />
                ) : null,
                above > 0 ? (
                  <Rect
                    key={`a-${index}`}
                    x={x + 1}
                    y={height - below - usual - above + 1}
                    width={Math.max(columnWidth - 2, 1)}
                    height={Math.max(above - 2, 1)}
                    fill={theme.surface}
                    stroke={theme[color]}
                    strokeWidth={2}
                    rx={2}
                  />
                ) : null,
              ];
            })}
          </Svg>
        ) : (
          <View style={{ height }} />
        )}
      </View>
      {/* Etiquetas colocadas bajo su columna; las vacías no ocupan sitio (pueden ser más anchas que la columna). */}
      <View style={styles.labels}>
        {xLabels.map((label, index) =>
          label ? (
            <Text
              key={`${label}-${index}`}
              color="inkMuted"
              numberOfLines={1}
              style={[styles.label, { left: Math.min(index * (columnWidth + gap), Math.max(width - LABEL_WIDTH, 0)) }]}>
              {label}
            </Text>
          ) : null
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['1'],
  },
  labels: {
    height: 14,
  },
  label: {
    position: 'absolute',
    top: 0,
    width: LABEL_WIDTH,
    fontFamily: fontFamily.mono500,
    fontSize: 10,
    lineHeight: 14,
  },
});
