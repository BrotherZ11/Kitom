# WellnessSlider

Slider de bienestar: escala de 5 pasos (1–5) para energía, apetito, ánimo, actividad, sueño, vocalizaciones e interacción social (PRD 8.3).

## Lo que aporta quien lo usa
`label`, `value` (1–5 o `null`), `onChange`, `stepLabels` (5 textos traducidos: el paso actual se muestra a la derecha del título), `anchors` (izquierda, centro, derecha).

## Reglas
- Empieza sin valor (`null`): el pulgar en el centro con borde `line-control` y el texto "Sin indicar". Así se distingue "normal" de "no lo he mirado".
- El texto del paso actual es lo que da sentido, no el número: "Con ganas de jugar", no "4".
- Paso discreto con háptica suave en cada cambio. Accesible como `adjustable` (sube/baja con gestos del lector de pantalla) anunciando el texto del paso.
- Pista `size-slider-track`, pulgar `size-slider-thumb`, área táctil de toda la fila.
- Para el registro en menos de 45 s: los sliders van en una sola columna, sin pasos intermedios ni confirmaciones.
