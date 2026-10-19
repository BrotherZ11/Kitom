import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { linePath, pointY, type ChartBox } from '@/components/ui/chart-geometry';
import { Text } from '@/components/ui/text';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';
import { fontFamily, spacing } from '@/theme/tokens';

export type TrendSeries = {
  id: string;
  color: ThemeColor;
  /** Patrón de trazo propio de la serie: la gráfica no depende solo del color. */
  dash?: string;
  values: readonly (number | null)[];
};

type TrendChartProps = {
  series: readonly TrendSeries[];
  /** Etiqueta de cada punto del eje x (p. ej. inicial del día). */
  xLabels: readonly string[];
  /** Etiquetas de la escala: arriba, en medio (lo habitual) y abajo. */
  yLabels: readonly [string, string, string];
  /** Descripción para lectores de pantalla (qué se ve, sin interpretar). */
  accessibilityLabel: string;
  height?: number;
};

const Y_LABELS_WIDTH = 44;

/**
 * Gráfica de tendencias (docs/design/componentes/TrendChart): escala 1–5 con «como siempre» en medio,
 * una línea por serie con trazo distinto y huecos donde no hay registro (sin interpolar).
 */
export function TrendChart({ series, xLabels, yLabels, accessibilityLabel, height = 180 }: TrendChartProps) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const box: ChartBox = { width, height, padX: 8, padY: 20, min: 1, max: 5 };

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel} style={styles.container}>
      <View style={styles.row}>
        <View style={[styles.yLabels, { height }]}>
          {yLabels.map((label) => (
            <Text key={label} variant="caption" color="inkMuted" style={styles.yLabel}>
              {label}
            </Text>
          ))}
        </View>
        <View style={styles.plot} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
          {width > 0 ? (
            <Svg width={width} height={height}>
              {[5, 4, 3, 2, 1].map((value) => (
                <Line
                  key={value}
                  x1={0}
                  x2={width}
                  y1={pointY(value, box)}
                  y2={pointY(value, box)}
                  stroke={theme.chartGrid}
                  strokeWidth={1}
                  strokeDasharray={value === 3 ? '4 4' : undefined}
                />
              ))}
              {series.map((item) => (
                <Path
                  key={item.id}
                  d={linePath(item.values, box)}
                  fill="none"
                  stroke={theme[item.color]}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={item.dash}
                />
              ))}
            </Svg>
          ) : null}
        </View>
      </View>
      <View style={styles.xLabels}>
        {xLabels.map((label, index) => (
          <Text key={`${label}-${index}`} color="inkMuted" style={styles.xLabel}>
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing['1'],
  },
  row: {
    flexDirection: 'row',
    gap: 6,
  },
  yLabels: {
    width: Y_LABELS_WIDTH,
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  yLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
  plot: {
    flex: 1,
  },
  xLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: Y_LABELS_WIDTH + 6 + 4,
    paddingRight: 4,
  },
  xLabel: {
    fontFamily: fontFamily.mono500,
    fontSize: 11,
    lineHeight: 14,
  },
});
