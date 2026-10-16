// Tokens de diseño de Kitom (dirección Ritmo). Generado desde la fuente de marca:
// no editar a mano; cambia brand.py y regenera. Ver docs de marca en docs/design/.
// Uso previsto: frontend/src/theme/tokens.ts + ThemeProvider (React Context) que elige light/dark
// según useColorScheme(). Requiere @expo-google-fonts/hanken-grotesk e ibm-plex-mono (pendiente de instalar).

export const palette = {
  laguna50: '#EEF6F4',
  laguna100: '#DCEBE6',
  laguna200: '#B9D7CF',
  laguna300: '#8DBDB2',
  laguna400: '#5A9C92',
  laguna500: '#2F807A',
  laguna600: '#1F6F6B',
  laguna700: '#185956',
  laguna800: '#124643',
  laguna900: '#0E3B39',
  sol100: '#FDF1D6',
  sol300: '#F7CF7A',
  sol500: '#F2B441',
  sol700: '#8A5A00',
  arena100: '#F7EDE6',
  arena300: '#EFD9CB',
  arena500: '#D9B49C',
  arena700: '#7D543C',
  niebla0: '#FFFFFF',
  niebla50: '#F7F9F8',
  niebla100: '#F2F5F3',
  niebla200: '#E6ECE9',
  niebla300: '#DAE4E0',
  niebla400: '#B5C3BF',
  niebla500: '#7E918D',
  niebla600: '#566A67',
  niebla700: '#3B4E4B',
  niebla800: '#1F3331',
  niebla900: '#0F2A29',
  noche500: '#5E7773',
  noche600: '#284340',
  noche700: '#1D3331',
  noche800: '#152624',
  noche900: '#0C1918',
} as const;

const lightColors = {
  bg: '#F2F5F3',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  surfaceSunken: '#E6ECE9',
  surfaceBrand: '#DCEBE6',
  surfaceWarm: '#F7EDE6',
  surfaceInverse: '#0E3B39',
  ink: '#0F2A29',
  inkMuted: '#566A67',
  inkSubtle: '#7E918D',
  inkInverse: '#F2F5F3',
  line: '#DAE4E0',
  lineControl: '#7E918D',
  primary: '#1F6F6B',
  primaryPressed: '#185956',
  onPrimary: '#FFFFFF',
  accent: '#F2B441',
  onAccent: '#0F2A29',
  accentInk: '#8A5A00',
  warmInk: '#7D543C',
  focusRing: '#1F6F6B',
  scrim: 'rgba(6, 20, 19, 0.48)',
  observeBg: '#E3EEF5',
  observeFg: '#2D5F80',
  routineBg: '#FCEFCF',
  routineFg: '#7A4D00',
  vetBg: '#FBE2D5',
  vetFg: '#9A3412',
  urgent: '#B42318',
  onUrgent: '#FFFFFF',
  successBg: '#DDF0E6',
  successFg: '#1D6B47',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerInk: '#B42318',
  dangerBg: '#FBE4E1',
  chartEnergy: '#1F6F6B',
  chartAppetite: '#B5651D',
  chartMood: '#4D6FA8',
  chartActivity: '#6B7A1F',
  chartSleep: '#7B5EA7',
  chartGrid: '#DAE4E0',
} as const;

const darkColors = {
  bg: '#0C1918',
  surface: '#152624',
  surfaceRaised: '#1D3331',
  surfaceSunken: '#0A1413',
  surfaceBrand: '#17332F',
  surfaceWarm: '#2A211C',
  surfaceInverse: '#123F3C',
  ink: '#E6EFEC',
  inkMuted: '#9DB2AE',
  inkSubtle: '#7F9894',
  inkInverse: '#F2F5F3',
  line: '#24403C',
  lineControl: '#5E7773',
  primary: '#6CC0B4',
  primaryPressed: '#8DD0C6',
  onPrimary: '#06201E',
  accent: '#F2B441',
  onAccent: '#0F2A29',
  accentInk: '#F2C46B',
  warmInk: '#E2B89D',
  focusRing: '#6CC0B4',
  scrim: 'rgba(0, 0, 0, 0.6)',
  observeBg: '#152A36',
  observeFg: '#9CC8E4',
  routineBg: '#33270F',
  routineFg: '#F2C46B',
  vetBg: '#3A1F14',
  vetFg: '#F5A783',
  urgent: '#B42318',
  onUrgent: '#FFFFFF',
  successBg: '#123325',
  successFg: '#8FD3B0',
  danger: '#B42318',
  onDanger: '#FFFFFF',
  dangerInk: '#F28B80',
  dangerBg: '#3A1512',
  chartEnergy: '#6CC0B4',
  chartAppetite: '#E8A55C',
  chartMood: '#8FAEE0',
  chartActivity: '#B9C46A',
  chartSleep: '#C2A8E8',
  chartGrid: '#24403C',
} as const;

export type ColorTokens = { [K in keyof typeof lightColors]: string };

export const colors: { light: ColorTokens; dark: ColorTokens } = { light: lightColors, dark: darkColors };

export const fontFamily = {
  sans400: 'HankenGrotesk_400Regular',
  sans500: 'HankenGrotesk_500Medium',
  sans600: 'HankenGrotesk_600SemiBold',
  mono500: 'IBMPlexMono_500Medium',
} as const;

/** Escala tipográfica. Respeta el tamaño de texto del sistema (allowFontScaling) con maxFontSizeMultiplier 1.6 en controles. */
export const typography = {
  display: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 34, lineHeight: 40, letterSpacing: -0.68 },
  title1: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 28, lineHeight: 34, letterSpacing: -0.42 },
  title2: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 22, lineHeight: 28, letterSpacing: -0.22 },
  title3: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 18, lineHeight: 24, letterSpacing: -0.09 },
  bodyLg: { fontFamily: 'HankenGrotesk_400Regular', fontSize: 17, lineHeight: 24, letterSpacing: 0 },
  body: { fontFamily: 'HankenGrotesk_400Regular', fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  bodyStrong: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 15, lineHeight: 22, letterSpacing: 0 },
  label: { fontFamily: 'HankenGrotesk_500Medium', fontSize: 13, lineHeight: 18, letterSpacing: 0 },
  caption: { fontFamily: 'HankenGrotesk_400Regular', fontSize: 12, lineHeight: 16, letterSpacing: 0 },
  button: { fontFamily: 'HankenGrotesk_600SemiBold', fontSize: 16, lineHeight: 20, letterSpacing: 0 },
  dataXl: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 40, lineHeight: 44, letterSpacing: -0.8 },
  dataLg: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 28, lineHeight: 32, letterSpacing: -0.28 },
  data: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 15, lineHeight: 20, letterSpacing: 0 },
  overline: { fontFamily: 'IBMPlexMono_500Medium', fontSize: 11, lineHeight: 14, letterSpacing: 0.66, textTransform: 'uppercase' as const },
} as const;

export const spacing = {
  '0': 0,
  '1': 4,
  '2': 8,
  '3': 12,
  '4': 16,
  '5': 20,
  '6': 24,
  '8': 32,
  '10': 40,
  '12': 48,
  '16': 64,
} as const;

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 18,
  xl: 24,
  full: 999,
} as const;

export const borderWidth = {
  hairline: 1,
  control: 1.5,
  focus: 2,
} as const;

export const iconSize = {
  xs: 16,
  sm: 20,
  md: 24,
  lg: 32,
} as const;

export const size = {
  touchMin: 44,
  buttonLg: 52,
  buttonMd: 44,
  buttonSm: 36,
  input: 52,
  chip: 28,
  tabbar: 56,
  header: 56,
  listRow: 56,
  sliderTrack: 6,
  sliderThumb: 28,
  avatarSm: 32,
  avatarMd: 40,
  avatarLg: 64,
  avatarXl: 96,
} as const;

export const opacity = {
  disabled: 0.4,
  pressedOverlay: 0.08,
} as const;

/** Sombras: iOS usa shadow*, Android usa elevation. En tema oscuro usar surface más clara en vez de sombra. */
export const elevation = {
  '1': { shadowColor: '#0E3B39', shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  '2': { shadowColor: '#0E3B39', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  '3': { shadowColor: '#0E3B39', shadowOpacity: 0.24, shadowRadius: 28, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
} as const;

export const motion = {
  durationFast: 120,
  durationBase: 200,
  durationSlow: 320,
  easingStandard: [0.2, 0, 0, 1],
  easingExit: [0.4, 0, 1, 1],
} as const;

/** Márgenes: gutter lateral de 20 y áreas seguras de react-native-safe-area-context (insets.top/bottom). */
export const layout = { screenGutter: 20, cardPadding: 16, sectionGap: 24, maxContentWidth: 560, bottomCtaGap: 12 } as const;

/** Niveles de urgencia (PRD 8.4). Claves de colors; siempre icono (Lucide) + texto, nunca solo color. */
export const urgency = {
  observe: { dbValue: 'observe', background: 'observeBg', foreground: 'observeFg', icon: 'eye', labelKey: 'urgency.observe' },
  routineChange: { dbValue: 'routine_change', background: 'routineBg', foreground: 'routineFg', icon: 'refresh-cw', labelKey: 'urgency.routine_change' },
  consultSoon: { dbValue: 'consult_soon', background: 'vetBg', foreground: 'vetFg', icon: 'stethoscope', labelKey: 'urgency.consult_soon' },
  urgent: { dbValue: 'urgent', background: 'urgent', foreground: 'onUrgent', icon: 'triangle-alert', labelKey: 'urgency.urgent' },
} as const;
