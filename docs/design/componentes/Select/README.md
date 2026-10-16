# Select

Selectores: control segmentado (2–4 opciones excluyentes y cortas), chips (selección múltiple, como las etiquetas rápidas del registro) y campo desplegable que abre una hoja inferior con búsqueda (listas largas como razas).

## Lo que aporta quien lo usa
`options` (`{ value, label }` con label ya traducido), `value` o `values`, `onChange`, `label`. El desplegable recibe además `searchable` y `emptyText`.

## Reglas
- Segmentado si hay ≤4 opciones y caben sin cortar en el idioma más largo; si no, chips o desplegable.
- Chips seleccionados: `surface-brand` + borde `primary` + icono check. No dependas solo del color.
- La hoja inferior usa `surface-raised`, `radius-xl` arriba, `elevation-3` y el área segura inferior.
- Cada opción mide al menos `size-touch-min` de alto.
