# PetCard

Tarjeta de mascota: foto, nombre, datos básicos, estado de la semana (anillo) y, si existe, la señal activa más alta. Es la puerta al perfil de la mascota.

## Lo que aporta quien lo usa
`pet` (`name`, `species`, `ageLabel`, `breed?`, `photoUrl?`), `weekDone` (0–7), `todayLogged`, `signal?` (nivel de urgencia), `onPress`.

## Reglas
- Sin foto: avatar `surface-brand` con la inicial en `title-2` `primary`. Nunca una silueta genérica de perro o gato.
- La foto va en círculo (`size-avatar-lg`), recortada al centro, con URL firmada de corta duración.
- Muestra como mucho una señal (la de mayor urgencia). Si es `urgent`, no uses la tarjeta: muestra el panel urgente arriba de la pantalla.
- Toda la tarjeta es pulsable; `accessibilityLabel`: "Kika, perra, 4 años. 5 de 7 días registrados. Señal: observar."
