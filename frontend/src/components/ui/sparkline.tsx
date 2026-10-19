import { View } from 'react-native';
import Svg, { Line, Path } from 'react-native-svg';

import { linePath, pointY, type ChartBox } from '@/components/ui/chart-geometry';
import { useTheme, type ThemeColor } from '@/hooks/use-theme';

type SparklineProps = {
  values: readonly (number | null)[];
  color: ThemeColor;
  /** Patrón de trazo de la serie (no depende solo del color). */
  dash?: string;
  width?: number;
  height?: number;
};

/** Minigráfica decorativa (los valores ya se dicen en texto al lado), con la línea «como siempre». */
export function Sparkline({ values, color, dash, width = 112, height = 30 }: SparklineProps) {
  const theme = useTheme();
  const box: ChartBox = { width, height, padX: 2, padY: 3, min: 1, max: 5 };
  const usual = pointY(3, box);

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={usual} y2={usual} stroke={theme.line} strokeWidth={1} strokeDasharray="2 3" />
        <Path
          d={linePath(values, box)}
          fill="none"
          stroke={theme[color]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={dash}
        />
      </Svg>
    </View>
  );
}
