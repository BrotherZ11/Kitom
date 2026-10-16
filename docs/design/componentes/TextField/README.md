# TextField

Campo de texto con etiqueta visible siempre encima (nunca solo placeholder), ayuda opcional debajo y error en `danger-ink` con icono.

## Lo que aporta quien lo usa
`label`, `value`, `onChangeText`, `helper` opcional, `error` (texto, no booleano), `unit` opcional al final en mono (kg, años), `keyboardType`, `autoComplete`, `optional` (añade "Opcional" como ayuda en vez de un asterisco).

## Medidas
Alto `size-input` (52), radio `radius-md`, relleno `space-4`, borde `border-control` en `line-control`. Foco: borde 2 px `primary`. Error: borde 2 px `danger-ink`. Texto 16 px para evitar el zoom de iOS.

## Reglas
- El error dice qué pasa y cómo arreglarlo ("Esa fecha no existe. Revisa el día."), sin culpar.
- Valida al salir del campo, no mientras se escribe.
- Etiquetas con `accessibilityLabel` = label + ayuda; el error se anuncia con `accessibilityLiveRegion`.
- Deja espacio para textos un 30 % más largos (alemán, francés).
