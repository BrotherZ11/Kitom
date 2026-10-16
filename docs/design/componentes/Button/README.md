# Button

Botón: la única forma de lanzar una acción. Variantes `primary`, `secondary`, `ghost`, `danger` y `danger-ghost`; tamaños `lg` (52), `md` (44) y `sm` (36, con hitSlop hasta 44).

## Cuándo usarlo
- Un solo `primary` por pantalla: la acción que cierra el paso (por ejemplo "Registrar el día"). Va abajo, a ancho completo (`lg`, `block`), a `layout.bottomCtaGap` del área segura.
- `secondary` para la alternativa razonable; `ghost` para salir o posponer.
- `danger` solo en la confirmación de una acción destructiva (dentro de un diálogo). En listas y ajustes usa `danger-ghost`.

## Lo que aporta quien lo usa
`label` (verbo + objeto, 1–3 palabras, sin punto), `onPress`, `variant`, `size`, `icon` opcional (Lucide, 18 px, a la izquierda), `loading`, `disabled`, `accessibilityLabel` si el texto no basta.

## Estados
Reposo · pulsado (`primary-pressed`, o capa `opacity-pressed-overlay` en las demás) · foco (anillo `focus-ring` 2 px, separado 2 px) · deshabilitado (`opacity-disabled`) · cargando (spinner a la izquierda, el ancho no cambia, `accessibilityState.busy`).

## No
- No uses dos `primary` en la misma vista.
- No pongas texto en mayúsculas ni signos de exclamación.
- No uses `danger` para "Cancelar".
