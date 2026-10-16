# Diseño de Kitom (identidad «Ritmo» y prototipo v2)

Material de diseño para implementar la app. **Es diseño, no código**: ninguna pantalla de aquí está
implementada salvo lo que ya exista en `frontend/` (ver `CLAUDE.md` › «Estado conocido»).

- Prototipo navegable (lienzo «Kitom · Prototipo», privado del propietario):
  https://claude.ai/artifact/FzoLo8xceqNPW4x81kV8QS
- Sistema de diseño publicado: https://claude.ai/artifact/LS1y4cit6jZWchSVfcg6c3
- Página de identidad: https://claude.ai/artifact/BigLDcMq9Ze9UibZBmhVTc (fuente: `kitom-identidad.html`)

## Orden de lectura para implementar

1. `PLAN_DESARROLLO.md` — fases, tareas, dependencias, qué está bloqueado y criterios de terminado.
2. `PANTALLAS.md` — inventario de las 90 pantallas y estados: archivo del prototipo, ruta de Expo
   Router, datos (tabla / RPC), estados y puntos abiertos.
3. `GUIA-DE-MARCA.md` — reglas de marca: color, tipografía, iconos, movimiento, voz y microcopy.
4. `componentes/<Nombre>/README.md` — reglas de cada componente (`preview.html` y `bundle.css` son la
   referencia visual web con los mismos tokens).
5. `prototipo/<Pantalla>.dc.html` — marcado, textos y estados de cada pantalla.

## Contenido

| Ruta | Qué es |
|---|---|
| `tokens/tokens.ts` | Tokens para React Native (claro/oscuro, tipografía, espaciado, radios, elevación, movimiento, urgencias con el valor de `urgency_level`). Generado: no editar a mano. |
| `tokens/tokens.json`, `tokens/tokens.design-system.json` | Los mismos tokens en JSON plano y en el formato del sistema de diseño. |
| `componentes/` | Reglas por componente + `bundle.css` de referencia. |
| `prototipo/` | Fuentes del lienzo: 92 tableros `*.dc.html`, `kitom.css` (los estilos de todas las pantallas) y `canvas.json` (orden, títulos y notas de cada sección). Necesitan el visor del lienzo para verse; para leerlos basta un editor. |
| `fuente/` | Generadores en Python 3 sin dependencias: `brand.py` es la fuente única de color y tipografía; `gen_tokens.py` escribe `out/tokens/*` y `ds/` (copiar a `tokens/`); `gen_logos.py`, `gen_page.py`, `gen_ds.py`. `fuente/prototipo/build.py` regenera `prototipo/` entero. |
| `../../frontend/assets/brand/` | Logotipos y símbolo en SVG (color, inverso, mono) e iconos de app (iOS, Android adaptativo, notificación, splash, favicon) en SVG y PNG, enlazados en `app.json`. Los SVG son la referencia. |

**PNG de los iconos de app.** `gen_logos.py` rasteriza con Chrome sin cabeza y `--window-size`, que
recorta el lienzo: `app-icon-ios`, `android-adaptive-background`, `favicon` y `android-notification`
salieron con una franja transparente o vacíos. El 16 oct 2026 se regeneraron desde sus SVG con un
viewport exacto y fondo transparente (comprobados: tamaño, área opaca y colores `#0E3B39`/`#F2F5F3`;
el icono de iOS, sin canal alfa). No volver a generarlos con `gen_logos.py` sin corregir ese paso.

## Convenciones del prototipo

Mascota de ejemplo **Kika** (perra, plan gratuito), usuario **David**, jueves 16 de octubre de 2026.
Nombres, fechas, valores, clínicas y textos de orientación son **contenido ficticio**. Los corchetes
(`[PRECIO AL AÑO]`, `[LÍMITE]`, `[Nombre de la clínica]`) son marcadores pendientes de decidir.

Si el diseño contradice `supabase/migrations/` o `docs/FRONTEND_ARCHITECTURE.md`, ganan ellos
(jerarquía de `CLAUDE.md`); las diferencias conocidas están en `PANTALLAS.md` §6.
