/** `#RRGGBB` + opacidad → `rgba(…)` (para derivar transparencias de un token sin inventar colores). */
export function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
