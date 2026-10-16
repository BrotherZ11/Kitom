# EmptyState

Estados vacíos y de error de pantalla completa: explican qué falta y ofrecen la siguiente acción.

## Lo que aporta quien lo usa
`kind` (`empty` | `error` | `offline`), `title`, `message`, `action?`, `petName?`.

## Reglas
- Vacío: el símbolo de Kitom en `surface-brand`, nunca una ilustración de un animal triste. Error: icono Lucide en `danger-bg`.
- Una sola acción, la más útil. En error, "Reintentar" como `secondary`.
- Usa el nombre de la mascota siempre que se conozca.
- El texto no culpa a la persona ni promete lo que no depende de nosotros.
