import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, type Theme } from 'expo-router';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { colors, fontFamily, type ColorTokens } from '@/theme/tokens';

export type ColorScheme = 'light' | 'dark';

type AppTheme = {
  scheme: ColorScheme;
  colors: ColorTokens;
};

const ThemeContext = createContext<AppTheme | null>(null);

/** El peso va en la familia (`fontFamily`): `fontWeight` normal para que Android no sintetice otro. */
const navigationFonts: Theme['fonts'] = {
  regular: { fontFamily: fontFamily.sans400, fontWeight: 'normal' },
  medium: { fontFamily: fontFamily.sans500, fontWeight: 'normal' },
  bold: { fontFamily: fontFamily.sans600, fontWeight: 'normal' },
  heavy: { fontFamily: fontFamily.sans600, fontWeight: 'normal' },
};

function navigationTheme(scheme: ColorScheme, palette: ColorTokens): Theme {
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      primary: palette.primary,
      background: palette.bg,
      // Las cabeceras van sobre el fondo de pantalla, como en el diseño.
      card: palette.bg,
      text: palette.ink,
      border: palette.line,
      notification: palette.accent,
    },
    fonts: navigationFonts,
  };
}

/**
 * Tema de la app (tokens de `docs/design/`): claro u oscuro según el sistema. También fija el tema
 * de Expo Router (cabeceras, fondo de las transiciones) y el color de fondo de la ventana nativa.
 * La preferencia manual claro / oscuro / sistema llegará con «Tu cuenta y ajustes».
 */
export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const scheme: ColorScheme = systemScheme === 'dark' ? 'dark' : 'light';
  const palette = colors[scheme];

  useEffect(() => {
    // Evita destellos de otro color al rotar o durante transiciones nativas.
    void SystemUI.setBackgroundColorAsync(palette.bg);
  }, [palette.bg]);

  return (
    <ThemeContext.Provider value={{ scheme, colors: palette }}>
      <NavigationThemeProvider value={navigationTheme(scheme, palette)}>{children}</NavigationThemeProvider>
    </ThemeContext.Provider>
  );
}

/**
 * Cabeceras de los `Stack`: sobre el fondo de pantalla, sin sombra, título centrado en 15/600
 * (`.top` del prototipo) y botón «atrás» solo con icono.
 */
export function useStackScreenOptions() {
  const { colors } = useAppTheme();
  return {
    headerShadowVisible: false,
    headerTitleAlign: 'center',
    headerTintColor: colors.ink,
    headerTitleStyle: { fontFamily: fontFamily.sans600, fontSize: 15 },
    headerBackButtonDisplayMode: 'minimal',
    contentStyle: { backgroundColor: colors.bg },
  } as const;
}

/** Tema activo: esquema y colores (tokens). Solo dentro de `AppThemeProvider` (layout raíz). */
export function useAppTheme(): AppTheme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error('useAppTheme debe usarse dentro de AppThemeProvider');
  return theme;
}
