import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useAppTheme } from '@/theme/theme-provider';

type LogotypeProps = {
  /** Ancho en píxeles (mínimo 72, GUIA-DE-MARCA.md › Logo). */
  width?: number;
  /** Versión inversa (sobre `laguna-900` o fondos oscuros); por defecto, la del tema. */
  inverse?: boolean;
  accessibilityLabel?: string;
};

const VIEW_W = 173.3;
const VIEW_H = 50.3;
// Trazados copiados de `assets/brand/logos/kitom-logotipo.svg` (y `-inverso`): no se redibujan.
const TEXT_PATH =
  'M64 0V-493H175V0ZM453.0 9Q416.0 9 383.5 -5.5Q351.0 -20 332.0 -52.5Q313.0 -85 313.0 -138V-613L425.0 -675V-169Q425.0 -127 437.5 -104.5Q450.0 -82 483.0 -82Q493.0 -82 506.5 -84.5Q520.0 -87 535.0 -91V-5Q515.0 2 494.5 5.5Q474.0 9 453.0 9ZM219.0 -407V-493H535.0V-407ZM826.0 9Q756.0 9 700.0 -24.0Q644.0 -57 612.5 -115.0Q581.0 -173 581.0 -247Q581.0 -321 612.5 -379.0Q644.0 -437 699.5 -469.5Q755.0 -502 826.0 -502Q898.0 -502 952.5 -469.5Q1007.0 -437 1039.0 -379.0Q1071.0 -321 1071.0 -247Q1071.0 -173 1039.5 -115.0Q1008.0 -57 952.5 -24.0Q897.0 9 826.0 9ZM827.0 -89Q868.0 -89 898.0 -108.0Q928.0 -127 944.0 -163.0Q960.0 -199 960.0 -247Q960.0 -296 944.0 -331.5Q928.0 -367 898.0 -386.0Q868.0 -405 827.0 -405Q784.0 -405 754.0 -385.5Q724.0 -366 708.0 -331.0Q692.0 -296 692.0 -247Q692.0 -199 708.0 -163.0Q724.0 -127 754.0 -108.0Q784.0 -89 827.0 -89ZM1148.0 0V-493H1259.0V-365L1235.0 -351Q1244.0 -394 1260.5 -423.0Q1277.0 -452 1299.0 -469.5Q1321.0 -487 1346.5 -494.5Q1372.0 -502 1398.0 -502Q1438.0 -502 1473.0 -486.5Q1508.0 -471 1532.5 -436.5Q1557.0 -402 1566.0 -343L1501.0 -325Q1516.0 -389 1543.0 -427.5Q1570.0 -466 1606.5 -484.0Q1643.0 -502 1686.0 -502Q1749.0 -502 1787.5 -474.5Q1826.0 -447 1844.0 -402.5Q1862.0 -358 1862.0 -307V0H1751.0V-280Q1751.0 -321 1741.5 -349.0Q1732.0 -377 1712.0 -391.5Q1692.0 -406 1661.0 -406Q1628.0 -406 1606.0 -389.5Q1584.0 -373 1572.5 -339.0Q1561.0 -305 1561.0 -255V0H1450.0V-285Q1450.0 -346 1427.0 -376.0Q1404.0 -406 1362.0 -406Q1329.0 -406 1306.0 -389.0Q1283.0 -372 1271.0 -338.5Q1259.0 -305 1259.0 -255V0Z';

/**
 * Logotipo de Kitom (el símbolo hace de K y el punto sol es el punto de la i). Versión principal:
 * splash, bienvenida y materiales. Para espacios cuadrados o de menos de 72 px, `KitomSymbol`.
 */
export function Logotype({ width = 156, inverse, accessibilityLabel = 'Kitom' }: LogotypeProps) {
  const { scheme, colors } = useAppTheme();
  const useInverse = inverse ?? scheme === 'dark';
  // Tinta (#0F2A29) o niebla-100 (#F2F5F3) en inverso, como los archivos de logo; punto `accent`.
  const ink = useInverse ? colors.inkInverse : colors.ink;

  return (
    <View accessible accessibilityRole="image" accessibilityLabel={accessibilityLabel}>
      <Svg width={width} height={(width * VIEW_H) / VIEW_W} viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}>
        <G transform="scale(0.95) translate(-12.5 -5.5)">
          <G fill="none" stroke={ink} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 9V55" />
            <Path d="M16 37.5L35.8 14Q40.6 8.6 42.4 15.2L43.2 26.5" />
            <Path d="M26.5 26Q38.5 39 43.2 48.8Q46.3 55.3 52.3 52.2Q56.4 49.8 54.2 45" />
          </G>
        </G>
        <Path transform="translate(45.48 49.23) scale(0.066)" fill={ink} d={TEXT_PATH} />
        <Circle cx={53.36} cy={6.98} r={4} fill={colors.accent} />
      </Svg>
    </View>
  );
}
