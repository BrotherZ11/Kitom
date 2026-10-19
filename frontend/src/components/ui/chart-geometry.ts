/**
 * Geometría de gráficas (tendencias, minigráficas y calendario). Módulo puro, sin imports: se prueba
 * con `npm test`. Los días sin dato son huecos: nunca se interpola entre ellos (PLAN_DESARROLLO.md
 * › Fase 5).
 */

export type ChartBox = {
  width: number;
  height: number;
  /** Margen interior horizontal (los extremos de la línea no tocan el borde). */
  padX: number;
  /** Margen interior vertical. */
  padY: number;
  /** Valores mínimo y máximo de la escala (1 y 5 en el registro diario). */
  min: number;
  max: number;
};

/** Coordenada x del punto `index` de `count` puntos repartidos en el ancho útil. */
export function pointX(index: number, count: number, box: ChartBox): number {
  if (count <= 1) return box.width / 2;
  return box.padX + (index * (box.width - box.padX * 2)) / (count - 1);
}

/** Coordenada y de un valor (los valores altos arriba). */
export function pointY(value: number, box: ChartBox): number {
  const usable = box.height - box.padY * 2;
  const ratio = (value - box.min) / (box.max - box.min);
  return box.padY + usable * (1 - ratio);
}

/**
 * Trazo SVG de una serie. `null` corta la línea (hueco); un punto aislado se dibuja como un trazo
 * mínimo para que se vea con `strokeLinecap="round"`. Devuelve `''` si no hay ningún valor.
 */
export function linePath(values: readonly (number | null)[], box: ChartBox): string {
  const parts: string[] = [];
  let segment: string[] = [];
  const flush = () => {
    if (segment.length === 1) segment.push(segment[0].replace(/^M/, 'L'));
    if (segment.length > 0) parts.push(segment.join(' '));
    segment = [];
  };
  values.forEach((value, index) => {
    if (value === null) {
      flush();
      return;
    }
    const x = pointX(index, values.length, box).toFixed(1);
    const y = pointY(value, box).toFixed(1);
    segment.push(`${segment.length === 0 ? 'M' : 'L'}${x} ${y}`);
  });
  flush();
  return parts.join(' ');
}

/** Celda del calendario mensual: fecha `YYYY-MM-DD`, número de día y si pertenece al mes mostrado. */
export type CalendarCell = { date: string; day: number; inMonth: boolean };

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Fecha `YYYY-MM-DD` de un día del calendario (sin pasar por zonas horarias). */
export function isoDate(year: number, monthIndex: number, day: number): string {
  const date = new Date(Date.UTC(year, monthIndex, day));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * Rejilla de un mes empezando en lunes, con los días del mes anterior y siguiente para completar
 * semanas (6 filas = 42 celdas, como el tablero 6.2).
 */
export function monthGrid(year: number, monthIndex: number): CalendarCell[] {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  // getUTCDay: 0 = domingo. Desplazamiento hasta el lunes anterior.
  const offset = (first.getUTCDay() + 6) % 7;
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(Date.UTC(year, monthIndex, 1 - offset + index));
    cells.push({
      date: isoDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === monthIndex,
    });
  }
  return cells;
}

/** Suma `days` días a una fecha `YYYY-MM-DD` (negativo para restar). */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return isoDate(year, month - 1, day + days);
}

/** Las `count` fechas que terminan en `end` (incluida), de la más antigua a la más reciente. */
export function lastDays(end: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addDays(end, index - (count - 1)));
}
