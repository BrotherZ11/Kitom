# TabBar

Navegación: barra de pestañas de 5 destinos fijos y cabecera de pantalla. Implementación con Expo Router (Tabs y Stack).

## Destinos
Hoy · Historial · Registrar · Agenda · Perfil (mascota activa; la rueda abre cuenta y ajustes).
Registrar es una acción central, no un destino: botón `primary` que abre el registro de hoy a pantalla completa, con el punto `accent` mientras hoy está pendiente y «Hecho» cuando ya está registrado. La orientación con foto y síntomas no es pestaña: «Consultar» en la cabecera de Hoy, tarjetas de señal, Alertas y perfil de la mascota (ver `PANTALLAS.md` §1).

## Reglas
- Pestaña activa: icono y texto `primary` más el punto `accent` debajo. Inactivas: `ink-muted`. Siempre icono + texto.
- Barra `surface`, alto `size-tabbar` más el inset inferior, `elevation-2`.
- Cabecera `size-header` sobre `bg`, título `title-3` centrado, botones de icono de `size-touch-min`. En pantallas raíz, título grande `title-1` alineado a la izquierda.
- Textos de pestaña de una palabra; si un idioma no cabe, se reduce a `caption` antes de truncar.
