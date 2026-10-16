# TrendChart

Gráfico de tendencias: líneas por métrica (día/semana/mes) con el punto sol en el valor de hoy y una banda `routine-bg` sobre el tramo que generó una señal.

## Lo que aporta quien lo usa
`series` (`{ metric, values: (number|null)[] }`), `range` (`week` | `month`), `labels` (fechas ya formateadas por idioma), `highlight?` (`{ from, to, note }`), `onPointPress?`.

## Reglas
- Colores fijos por métrica: `chart-energy`, `chart-appetite`, `chart-mood`. Máximo tres series a la vez; el resto se elige con chips.
- Línea 2,5 px, uniones redondas, sin relleno ni degradados. Rejilla `chart-grid` solo en 1, 3 y 5.
- Los días sin registro cortan la línea (hueco), no se interpolan.
- Leyenda siempre visible con texto; nunca dependas del color. El gráfico tiene `accessibilityLabel` con el resumen en una frase y una tabla equivalente accesible.
- Implementación sugerida: react-native-svg (pendiente de aprobar la dependencia).
