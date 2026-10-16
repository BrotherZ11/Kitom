# Dialog

Diálogo de confirmación: solo para decisiones que no se pueden deshacer o que afectan a otras personas.

## Lo que aporta quien lo usa
`title` (pregunta con el objeto concreto), `message` (consecuencia), `confirmLabel` (repite el verbo del título), `tone` (`default` | `danger`), `onConfirm`, `onCancel`.

## Reglas
- `surface-raised`, `radius-xl`, `elevation-3`, sobre `scrim`. Botones apilados a ancho completo: confirmar arriba, cancelar debajo.
- El botón de confirmar nunca dice "Sí" ni "Aceptar": dice la acción ("Eliminar registro").
- Para elegir entre opciones o formularios cortos usa una hoja inferior, no un diálogo.
- Foco inicial en "Cancelar" cuando el tono es `danger`.
