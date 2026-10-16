# UrgencyTag

Etiqueta de urgencia: los cuatro niveles del PRD 8.4, siempre con icono + texto, nunca solo color. Mapean 1:1 con el enum `urgency_level` de la base de datos.

| Nivel (`urgency_level`) | Texto | Icono (Lucide) | Tokens |
|---|---|---|---|
| `observe` | Observar | `eye` | `observe-bg` / `observe-fg` |
| `routine_change` | Cambio de rutina recomendado | `refresh-cw` | `routine-bg` / `routine-fg` |
| `consult_soon` | Consultar veterinario pronto | `stethoscope` | `vet-bg` / `vet-fg` |
| `urgent` | Urgente, acudir ahora | `triangle-alert` | `urgent` / `on-urgent` |

## Reglas
- `urgent` nunca va solo como etiqueta: abre el panel urgente a ancho completo, arriba del resultado, con la acción "Llamar a mi clínica" (o "Buscar urgencias" si no hay clínica guardada) y `accessibilityRole="alert"`.
- El texto es siempre el del nivel, sin suavizarlo ni abreviarlo.
- Los colores de urgencia no se usan para nada más (ni en gráficos ni en la marca).
- La escala crece en luminosidad y saturación: se distingue también en escala de grises.
