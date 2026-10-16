import { View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { useAppTheme } from '@/theme/theme-provider';

type KitomSymbolProps = {
  /** Alto en píxeles (mínimo 16, GUIA-DE-MARCA.md › Logo). */
  size?: number;
  /** Etiqueta para lectores de pantalla; sin ella el símbolo es decorativo. */
  accessibilityLabel?: string;
};

/**
 * Símbolo de Kitom (la K con oreja y cola y el punto sol). Trazado copiado de
 * `assets/brand/logos/kitom-simbolo.svg` (versión color; en tema oscuro, la `-inverso`): no se
 * redibuja. Para menos de 32 px la guía pide el corte pequeño (`kitom-simbolo-pequeno`).
 */
export function KitomSymbol({ size = 36, accessibilityLabel }: KitomSymbolProps) {
  const { scheme, colors } = useAppTheme();
  // Los de los archivos de logo: tinta (#0F2A29) o, en inverso, niebla-100 (#F2F5F3); punto `accent`.
  const stroke = scheme === 'dark' ? colors.inkInverse : colors.ink;

  return (
    // La accesibilidad va en el `View`: el SVG no admite esas props en web.
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? 'image' : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={!accessibilityLabel}
      importantForAccessibility={accessibilityLabel ? 'yes' : 'no-hide-descendants'}>
      <Svg width={(size * 46) / 53} height={size} viewBox="0 0 46 53">
        <G transform="translate(-12.5 -5.5)">
          <G fill="none" stroke={stroke} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round">
            <Path d="M16 9V55" />
            <Path d="M16 37.5L35.8 14Q40.6 8.6 42.4 15.2L43.2 26.5" />
            <Path d="M26.5 26Q38.5 39 43.2 48.8Q46.3 55.3 52.3 52.2Q56.4 49.8 54.2 45" />
          </G>
          <Circle cx={52.5} cy={13} r={4.4} fill={colors.accent} />
        </G>
      </Svg>
    </View>
  );
}
