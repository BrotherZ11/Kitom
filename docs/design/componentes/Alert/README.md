# Alert

Alertas en línea y avisos breves (toast) del sistema: éxito, información, aviso y error. No son niveles de urgencia veterinaria: esos usan UrgencyTag.

## Lo que aporta quien lo usa
`tone` (`success` | `info` | `warning` | `error`), `title`, `message?`, `action?` (`{ label, onPress }`), `onDismiss?`.

## Reglas
- Título que dice qué ha pasado; mensaje que dice qué hacer. Sin "¡Ups!" ni disculpas genéricas.
- Toast solo para éxito (desaparece en 4 s, con `accessibilityLiveRegion="polite"`). Errores y avisos se quedan hasta resolverse.
- El conflicto de edición concurrente (`daily_log_conflict`) usa `warning` con la acción "Ver cambios".
