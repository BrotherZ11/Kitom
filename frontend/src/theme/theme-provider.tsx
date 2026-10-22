import AsyncStorage from '@react-native-async-storage/async-storage';
import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider, type Theme } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { colors, fontFamily, type ColorTokens } from '@/theme/tokens';

export type ColorScheme = 'light' | 'dark';

/** Preferencia de tema de este dispositivo (tablero 10.1). No hay columna: es local, no de la cuenta. */
export type ThemePreference = 'system' | 'light' | 'dark';

// Fuera del espacio de `LocalStore` (`kitom:v1:<usuario>:…`): es del dispositivo, no de una cuenta.
const THEME_PREFERENCE_KEY = 'kitom-theme-preference';

function parseThemePreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

type AppTheme = {
  scheme: ColorScheme;
  colors: ColorTokens;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
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
 * Tema de la app (tokens de `docs/design/`): el del sistema o el que se elija en «Tu cuenta»
 * (claro / oscuro / sistema, guardado en el dispositivo). También fija el tema de Expo Router
 * (cabeceras, fondo de las transiciones), la barra de estado y el fondo de la ventana nativa.
 * Hasta leer la preferencia no se pinta nada (el splash sigue visible): así no hay un destello del
 * otro tema al arrancar.
 */
export function AppThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference | null>(null);
  const resolved = preference ?? 'system';
  const scheme: ColorScheme = resolved === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : resolved;
  const palette = colors[scheme];

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(THEME_PREFERENCE_KEY)
      .then((value) => active && setPreferenceState(parseThemePreference(value)))
      // Sin almacenamiento legible, el del sistema.
      .catch(() => active && setPreferenceState('system'));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Evita destellos de otro color al rotar o durante transiciones nativas.
    void SystemUI.setBackgroundColorAsync(palette.bg);
  }, [palette.bg]);

  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    // Recordarla es una comodidad: si no se puede guardar, se usa igual en esta sesión.
    AsyncStorage.setItem(THEME_PREFERENCE_KEY, next).catch(() => undefined);
  };

  if (preference === null) return null;

  return (
    <ThemeContext.Provider value={{ scheme, colors: palette, preference, setPreference }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
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
