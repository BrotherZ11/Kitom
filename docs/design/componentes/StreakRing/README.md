# StreakRing

Anillo semanal y racha: el símbolo de Ritmo hecho componente. Seis arcos para los días anteriores y el punto sol para hoy (relleno si ya hay registro, contorno si falta).

## Lo que aporta quien lo usa
`days` (7 booleanos, el último es hoy), `size` (56 o 96), `streak?` (número de días seguidos para la tarjeta de racha), `petName`.

## Reglas
- La racha celebra el vínculo, no castiga: si se rompe, el texto es "Empezáis otra racha hoy", nunca "Has perdido tu racha".
- La tarjeta de racha usa `surface-inverse` con el número en `data-xl` color `accent`. Solo una por pantalla.
- Ligera animación al completar el día: el punto pasa de contorno a relleno en `duration-slow`; sin confeti. Respeta "reducir movimiento".
- `accessibilityLabel`: "5 de 7 días registrados esta semana. Hoy pendiente."
