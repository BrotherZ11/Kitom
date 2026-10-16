# StatCard

Tarjeta de estadística: una métrica, su valor actual y la tendencia frente a la semana anterior.

## Lo que aporta quien lo usa
`label`, `value` (número), `scale?` ("/5") o `unit?` ("kg"), `trend` (`up` | `down` | `flat`), `trendLabel` ("3 días", "estable").

## Reglas
- Valor en `data-lg` (mono tabular) para comparar de un vistazo. Etiqueta en `caption` `ink-muted`.
- La tendencia lleva flecha + texto. `down` en apetito o energía usa `vet-fg`; no uses rojo de error: bajar no es un error.
- Usa números con el formato del idioma (Intl.NumberFormat): "12,4" en español, "12.4" en inglés.
- En una fila caben 3 en un móvil de 360 px; si no, pasa a 2 columnas.
