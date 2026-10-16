/**
 * Transitorio: espaciado anterior a los tokens de marca (`src/theme/tokens.ts`), usado por las
 * pantallas aún no adaptadas al diseño v2. Código nuevo usa `spacing`, `radius` y `layout` de los
 * tokens; colores y tipografía ya salen solo de los tokens (`useTheme`, `Text`).
 */

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;
