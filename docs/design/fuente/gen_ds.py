import json, os
from brand import *

DS = os.path.join(HERE, 'ds', 'project')
os.makedirs(DS + '/components', exist_ok=True)

ICONS = {
 'eye': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
 'refresh-cw': '<path d="M20 11a8 8 0 0 0-14.7-4.3L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.3L20 16M20 20v-4h-4"/>',
 'stethoscope': '<path d="M6 3.5v5a4.5 4.5 0 0 0 9 0v-5M10.5 13v2.5a4.5 4.5 0 0 0 9 0V13"/><circle cx="19.5" cy="11" r="2"/>',
 'triangle-alert': '<path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
 'home': '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
 'chart': '<path d="M4 19h16M6.5 15l4-4.5 3 3L18 8"/>',
 'plus': '<path d="M12 5v14M5 12h14"/>',
 'calendar': '<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
 'user': '<circle cx="12" cy="9" r="3.6"/><path d="M5 20c1.2-3.6 4-5.2 7-5.2s5.8 1.6 7 5.2"/>',
 'camera': '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.3L9.3 5h5.4l1.5 2h2.3A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z"/><circle cx="12" cy="13" r="3.4"/>',
 'check': '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
 'x': '<path d="M6 6l12 12M18 6 6 18"/>',
 'chevron-down': '<path d="m6 9 6 6 6-6"/>',
 'chevron-left': '<path d="m15 6-6 6 6 6"/>',
 'wifi-off': '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2-1.6M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01"/>',
 'notebook': '<rect x="5" y="3.5" width="14" height="17" rx="2"/><path d="M9 3.5v17M12 8h4M12 11.5h4"/>',
 'info': '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
 'bell': '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5zM10 20.5h4"/>',
}

def ic(name, size=20, cls=''):
    return (f'<svg class="k-ic {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')

def symbol_inline(size=28, ink='var(--ink)', dot='var(--accent)'):
    paths = ''.join(f'<path d="{d}"/>' for d in SYM_PATHS)
    x0, y0 = SYM_BOX[0], SYM_BOX[1]
    return (f'<svg width="{size*SYM_W/SYM_H:.0f}" height="{size}" viewBox="{x0} {y0} {SYM_W} {SYM_H}" aria-hidden="true">'
            f'<g fill="none" stroke="{ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">{paths}</g>'
            f'<circle cx="{SYM_DOT[0]}" cy="{SYM_DOT[1]}" r="{SYM_DOT[2]}" fill="{dot}"/></svg>')

RING = ["M34.11 10.10A22 22 0 0 1 47.81 16.70", "M50.44 19.99A22 22 0 0 1 53.82 34.82", "M52.88 38.93A22 22 0 0 1 43.40 50.82",
        "M39.60 52.64A22 22 0 0 1 24.40 52.64", "M20.60 50.82A22 22 0 0 1 11.12 38.93", "M10.18 34.82A22 22 0 0 1 13.56 19.99"]
def week_ring(done, size=96, label=''):
    segs = ''.join(f'<path class="{"on" if i < done else "off"}" d="{d}"/>' for i, d in enumerate(RING))
    return (f'<svg class="k-ring" width="{size}" height="{size}" viewBox="0 0 64 64" role="img" aria-label="{label}">'
            f'<g fill="none" stroke-width="5.5" stroke-linecap="round">{segs}</g>'
            f'<circle class="today" cx="22.45" cy="12.18" r="4.6"/></svg>')

BUNDLE_CSS = """/* Kitom · estilos de referencia de los componentes (web). La implementación real es React Native;
   estos estilos documentan medidas y estados con los mismos tokens. */
@import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap');
.k-root{font-family:var(--font-sans);color:var(--ink);background:var(--bg);padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-4);font-size:15px;line-height:22px;-webkit-font-smoothing:antialiased}
.k-row{display:flex;flex-wrap:wrap;gap:var(--space-3);align-items:center}
.k-col{display:flex;flex-direction:column;gap:var(--space-2)}
.k-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:var(--space-3)}
.k-cap{font-size:12px;line-height:16px;color:var(--ink-muted)}
.k-mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.k-ic{flex:none}
/* Botón */
.k-btn{font:600 16px/20px var(--font-sans);display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);height:var(--size-button-md);padding:0 var(--space-5);border-radius:var(--radius-md);border:0;cursor:pointer;white-space:nowrap}
.k-btn--lg{height:var(--size-button-lg);padding:0 var(--space-6)}
.k-btn--sm{height:var(--size-button-sm);padding:0 var(--space-4);font-size:15px;border-radius:var(--radius-sm)}
.k-btn--block{width:100%}
.k-btn--primary{background:var(--primary);color:var(--on-primary)}
.k-btn--primary.is-pressed{background:var(--primary-pressed)}
.k-btn--secondary{background:var(--surface);color:var(--primary);box-shadow:inset 0 0 0 var(--border-control) var(--primary)}
.k-btn--ghost{background:transparent;color:var(--primary)}
.k-btn--danger{background:var(--danger);color:var(--on-danger)}
.k-btn--danger-ghost{background:transparent;color:var(--danger-ink)}
.k-btn.is-disabled{opacity:var(--opacity-disabled)}
.k-btn.is-focused,.k-focus{outline:var(--border-focus) solid var(--focus-ring);outline-offset:2px}
.k-spinner{width:18px;height:18px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent}
/* Campo */
.k-field{display:flex;flex-direction:column;gap:6px;min-width:220px;flex:1}
.k-label{font:500 13px/18px var(--font-sans);color:var(--ink)}
.k-input{height:var(--size-input);border-radius:var(--radius-md);background:var(--surface);box-shadow:inset 0 0 0 var(--border-control) var(--line-control);padding:0 var(--space-4);display:flex;align-items:center;gap:var(--space-2);font-size:16px;color:var(--ink)}
.k-input .ph{color:var(--ink-subtle)}
.k-input.is-focused{box-shadow:inset 0 0 0 var(--border-focus) var(--primary)}
.k-input.is-error{box-shadow:inset 0 0 0 var(--border-focus) var(--danger-ink)}
.k-input .end{margin-left:auto;color:var(--ink-muted)}
.k-help{font-size:12px;line-height:16px;color:var(--ink-muted)}
.k-help.err{color:var(--danger-ink);display:flex;gap:4px;align-items:center}
/* Selector */
.k-seg{display:flex;background:var(--surface-sunken);border-radius:var(--radius-md);padding:3px;gap:3px}
.k-seg span{flex:1;text-align:center;font:500 13px/18px var(--font-sans);padding:9px 8px;border-radius:11px;color:var(--ink-muted)}
.k-seg span.on{background:var(--surface);color:var(--ink);box-shadow:var(--elevation-1)}
.k-chipsel{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 var(--space-3);border-radius:var(--radius-full);box-shadow:inset 0 0 0 var(--border-hairline) var(--line-control);font:500 14px/18px var(--font-sans);color:var(--ink);background:var(--surface)}
.k-chipsel.on{background:var(--surface-brand);box-shadow:inset 0 0 0 var(--border-control) var(--primary);color:var(--ink)}
/* Tarjeta */
.k-card{background:var(--surface);border-radius:var(--radius-lg);padding:var(--space-4);box-shadow:var(--elevation-1)}
.k-card--flat{box-shadow:inset 0 0 0 var(--border-hairline) var(--line)}
.k-pet{display:flex;gap:var(--space-4);align-items:center}
.k-avatar{border-radius:var(--radius-full);flex:none;background:radial-gradient(60% 60% at 40% 38%,#D9C3AE,#56786F)}
.k-pet h4{margin:0;font:600 18px/24px var(--font-sans)}
.k-pet .meta{font-size:13px;line-height:18px;color:var(--ink-muted)}
/* Estadística */
.k-stat .v{font:500 28px/32px var(--font-mono);letter-spacing:-.28px}
.k-stat .v small{font-size:14px;color:var(--ink-muted)}
.k-trend{font:500 12px/16px var(--font-mono);display:inline-flex;gap:4px;align-items:center}
.k-trend.up{color:var(--success-fg)}.k-trend.down{color:var(--vet-fg)}.k-trend.flat{color:var(--ink-muted)}
/* Slider */
.k-slider{display:flex;flex-direction:column;gap:var(--space-2)}
.k-slider .top{display:flex;justify-content:space-between;align-items:baseline}
.k-slider .val{font:600 15px/22px var(--font-sans);color:var(--primary)}
.k-track{position:relative;height:var(--size-slider-thumb)}
.k-track i{position:absolute;left:0;right:0;top:11px;height:var(--size-slider-track);border-radius:3px;background:var(--surface-sunken)}
.k-track b{position:absolute;left:0;top:11px;height:var(--size-slider-track);border-radius:3px;background:var(--primary)}
.k-track em{position:absolute;top:0;width:var(--size-slider-thumb);height:var(--size-slider-thumb);border-radius:50%;background:var(--surface);box-shadow:inset 0 0 0 2px var(--primary),var(--elevation-1)}
.k-ticks{display:flex;justify-content:space-between;font-size:12px;line-height:16px;color:var(--ink-muted)}
/* Urgencia */
.k-tag{display:inline-flex;align-items:center;gap:6px;height:var(--size-chip);padding:0 10px 0 8px;border-radius:var(--radius-xs);font:600 13px/18px var(--font-sans)}
.k-tag--observe{background:var(--observe-bg);color:var(--observe-fg)}
.k-tag--routine_change{background:var(--routine-bg);color:var(--routine-fg)}
.k-tag--consult_soon{background:var(--vet-bg);color:var(--vet-fg)}
.k-tag--urgent{background:var(--urgent);color:var(--on-urgent)}
.k-urgent-panel{background:var(--urgent);color:var(--on-urgent);border-radius:var(--radius-lg);padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)}
.k-urgent-panel h4{margin:0;font:600 22px/28px var(--font-sans)}
.k-urgent-panel .k-btn{background:#FFFFFF;color:#8E1B12}
/* Gráfico */
.k-chart svg{display:block;width:100%;height:auto}
.k-legend{display:flex;gap:var(--space-4);font-size:12px;color:var(--ink-muted)}
.k-legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
/* Racha */
.k-ring .on{stroke:var(--primary)}.k-ring .off{stroke:var(--line)}.k-ring .today{fill:var(--accent)}
.k-ring.pending .today{fill:none;stroke:var(--accent);stroke-width:2.4}
.k-streak{background:var(--surface-inverse);color:var(--ink-inverse);border-radius:var(--radius-lg);padding:var(--space-4);display:flex;gap:var(--space-4);align-items:center}
.k-streak .n{font:500 40px/44px var(--font-mono);letter-spacing:-.8px;color:var(--accent)}
/* Insignias */
.k-badge{display:flex;flex-direction:column;align-items:center;gap:6px;width:88px;text-align:center;font-size:12px;line-height:16px}
.k-badge .disc{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--surface-warm);box-shadow:inset 0 0 0 2px var(--accent)}
.k-badge.locked .disc{background:var(--surface-sunken);box-shadow:none;border:1.5px dashed var(--line-control);color:var(--ink-subtle)}
.k-badge.locked{color:var(--ink-muted)}
/* Navegación */
.k-tabbar{display:flex;justify-content:space-around;background:var(--surface);height:var(--size-tabbar);align-items:center;border-radius:var(--radius-lg);box-shadow:var(--elevation-2)}
.k-tab{display:flex;flex-direction:column;align-items:center;gap:2px;font:500 11px/14px var(--font-sans);color:var(--ink-muted);min-width:56px}
.k-tab.on{color:var(--primary)}
.k-tab .dot{width:4px;height:4px;border-radius:2px;background:var(--accent)}
.k-header{display:flex;align-items:center;gap:var(--space-3);height:var(--size-header);background:var(--bg)}
.k-header h3{margin:0;font:600 18px/24px var(--font-sans);flex:1;text-align:center}
.k-iconbtn{width:var(--size-touch-min);height:var(--size-touch-min);border-radius:var(--radius-full);display:flex;align-items:center;justify-content:center;color:var(--ink)}
/* Alertas */
.k-alert{display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-radius:var(--radius-md);align-items:flex-start;font-size:14px;line-height:20px}
.k-alert b{display:block;font-weight:600}
.k-alert--info{background:var(--observe-bg);color:var(--observe-fg)}
.k-alert--success{background:var(--success-bg);color:var(--success-fg)}
.k-alert--warning{background:var(--routine-bg);color:var(--routine-fg)}
.k-alert--error{background:var(--danger-bg);color:var(--danger-ink)}
/* Diálogo */
.k-scrim{background:var(--scrim);padding:var(--space-6);border-radius:var(--radius-lg);display:flex;justify-content:center}
.k-dialog{background:var(--surface-raised);border-radius:var(--radius-xl);padding:var(--space-6);max-width:320px;box-shadow:var(--elevation-3);display:flex;flex-direction:column;gap:var(--space-3)}
.k-dialog h4{margin:0;font:600 22px/28px var(--font-sans)}
/* Estados */
.k-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:var(--space-3);padding:var(--space-8) var(--space-5)}
.k-empty h4{margin:0;font:600 18px/24px var(--font-sans)}
.k-empty p{margin:0;color:var(--ink-muted);max-width:30ch}
.k-empty .art{width:72px;height:72px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--surface-brand);color:var(--primary)}
.k-empty.err .art{background:var(--danger-bg);color:var(--danger-ink)}
.k-voice{background:var(--surface-warm);border-radius:var(--radius-lg);padding:var(--space-3) var(--space-4)}
.k-voice small{display:block;font:600 12px/16px var(--font-sans);color:var(--warm-ink)}
"""

def card(name, group, height, body, subtitle=''):
    sub = f' subtitle="{subtitle}"' if subtitle else ''
    return f'<!-- @dsCard group="{group}" height={height}{sub} -->\n<div class="k-root">\n{body}\n</div>\n'

U = {k: (lab, icn) for k, lab, icn, _, _ in URGENCY}

COMP = {}

COMP['Button'] = ("Acciones", 230, f"""
<div class="k-row"><button class="k-btn k-btn--primary k-btn--lg">Registrar el día</button><button class="k-btn k-btn--secondary">Ver historial</button><button class="k-btn k-btn--ghost">Ahora no</button></div>
<div class="k-row"><button class="k-btn k-btn--danger">{ic('x',18)}Eliminar registro</button><button class="k-btn k-btn--danger-ghost">Eliminar mascota</button></div>
<div class="k-row"><button class="k-btn k-btn--primary is-pressed">Pulsado</button><button class="k-btn k-btn--primary is-focused">Con foco</button><button class="k-btn k-btn--primary is-disabled">Deshabilitado</button><button class="k-btn k-btn--primary" aria-busy="true"><span class="k-spinner"></span>Guardando</button></div>
""", """Botón: la única forma de lanzar una acción. Variantes `primary`, `secondary`, `ghost`, `danger` y `danger-ghost`; tamaños `lg` (52), `md` (44) y `sm` (36, con hitSlop hasta 44).

## Cuándo usarlo
- Un solo `primary` por pantalla: la acción que cierra el paso (por ejemplo "Registrar el día"). Va abajo, a ancho completo (`lg`, `block`), a `layout.bottomCtaGap` del área segura.
- `secondary` para la alternativa razonable; `ghost` para salir o posponer.
- `danger` solo en la confirmación de una acción destructiva (dentro de un diálogo). En listas y ajustes usa `danger-ghost`.

## Lo que aporta quien lo usa
`label` (verbo + objeto, 1–3 palabras, sin punto), `onPress`, `variant`, `size`, `icon` opcional (Lucide, 18 px, a la izquierda), `loading`, `disabled`, `accessibilityLabel` si el texto no basta.

## Estados
Reposo · pulsado (`primary-pressed`, o capa `opacity-pressed-overlay` en las demás) · foco (anillo `focus-ring` 2 px, separado 2 px) · deshabilitado (`opacity-disabled`) · cargando (spinner a la izquierda, el ancho no cambia, `accessibilityState.busy`).

## No
- No uses dos `primary` en la misma vista.
- No pongas texto en mayúsculas ni signos de exclamación.
- No uses `danger` para "Cancelar".""")

COMP['TextField'] = ("Formularios", 260, f"""
<div class="k-row" style="align-items:flex-start">
<label class="k-field"><span class="k-label">Nombre</span><span class="k-input">Kika</span><span class="k-help">Como la llamas en casa.</span></label>
<label class="k-field"><span class="k-label">Peso</span><span class="k-input is-focused">12,4<span class="end k-mono">kg</span></span><span class="k-help">Opcional</span></label>
</div>
<div class="k-row" style="align-items:flex-start">
<label class="k-field"><span class="k-label">Nota del día</span><span class="k-input"><span class="ph">¿Algo que te haya llamado la atención?</span></span></label>
<label class="k-field"><span class="k-label">Fecha de nacimiento</span><span class="k-input is-error">31/02/2024</span><span class="k-help err">{ic('info',14)}Esa fecha no existe. Revisa el día.</span></label>
</div>
""", """Campo de texto con etiqueta visible siempre encima (nunca solo placeholder), ayuda opcional debajo y error en `danger-ink` con icono.

## Lo que aporta quien lo usa
`label`, `value`, `onChangeText`, `helper` opcional, `error` (texto, no booleano), `unit` opcional al final en mono (kg, años), `keyboardType`, `autoComplete`, `optional` (añade "Opcional" como ayuda en vez de un asterisco).

## Medidas
Alto `size-input` (52), radio `radius-md`, relleno `space-4`, borde `border-control` en `line-control`. Foco: borde 2 px `primary`. Error: borde 2 px `danger-ink`. Texto 16 px para evitar el zoom de iOS.

## Reglas
- El error dice qué pasa y cómo arreglarlo ("Esa fecha no existe. Revisa el día."), sin culpar.
- Valida al salir del campo, no mientras se escribe.
- Etiquetas con `accessibilityLabel` = label + ayuda; el error se anuncia con `accessibilityLiveRegion`.
- Deja espacio para textos un 30 % más largos (alemán, francés).""")

COMP['Select'] = ("Formularios", 230, f"""
<div class="k-col"><span class="k-label">Especie</span><div class="k-seg"><span class="on">Perro</span><span>Gato</span><span>Otro</span></div></div>
<div class="k-col"><span class="k-label">Etiquetas rápidas</span><div class="k-row"><span class="k-chipsel on">{ic('check',16)}Día de visita</span><span class="k-chipsel">Cambio de casa</span><span class="k-chipsel">Nueva mascota en casa</span><span class="k-chipsel">{ic('plus',16)}Añadir</span></div></div>
<label class="k-field" style="max-width:320px"><span class="k-label">Raza</span><span class="k-input">Mestizo<span class="end">{ic('chevron-down',20)}</span></span></label>
""", """Selectores: control segmentado (2–4 opciones excluyentes y cortas), chips (selección múltiple, como las etiquetas rápidas del registro) y campo desplegable que abre una hoja inferior con búsqueda (listas largas como razas).

## Lo que aporta quien lo usa
`options` (`{ value, label }` con label ya traducido), `value` o `values`, `onChange`, `label`. El desplegable recibe además `searchable` y `emptyText`.

## Reglas
- Segmentado si hay ≤4 opciones y caben sin cortar en el idioma más largo; si no, chips o desplegable.
- Chips seleccionados: `surface-brand` + borde `primary` + icono check. No dependas solo del color.
- La hoja inferior usa `surface-raised`, `radius-xl` arriba, `elevation-3` y el área segura inferior.
- Cada opción mide al menos `size-touch-min` de alto.""")

COMP['PetCard'] = ("Contenido", 250, f"""
<div class="k-card k-pet"><span class="k-avatar" style="width:64px;height:64px"></span><div style="flex:1"><h4>Kika</h4><div class="meta">Perra · 4 años · Mestiza</div><div class="k-row" style="margin-top:8px;gap:8px"><span class="k-tag k-tag--observe">{ic('eye',14)}Observar</span><span class="k-cap k-mono">5/7 esta semana</span></div></div>{week_ring(5,56,'5 de 7 días registrados')}</div>
<div class="k-card k-pet"><span class="k-avatar" style="width:64px;height:64px;background:radial-gradient(60% 60% at 40% 38%,#EFD9CB,#7D543C)"></span><div style="flex:1"><h4>Atom</h4><div class="meta">Perro · 7 años · Podenco</div><div class="k-cap" style="margin-top:8px">Registro de hoy completado</div></div>{week_ring(6,56,'6 de 7 días registrados')}</div>
""", """Tarjeta de mascota: foto, nombre, datos básicos, estado de la semana (anillo) y, si existe, la señal activa más alta. Es la puerta al perfil de la mascota.

## Lo que aporta quien lo usa
`pet` (`name`, `species`, `ageLabel`, `breed?`, `photoUrl?`), `weekDone` (0–7), `todayLogged`, `signal?` (nivel de urgencia), `onPress`.

## Reglas
- Sin foto: avatar `surface-brand` con la inicial en `title-2` `primary`. Nunca una silueta genérica de perro o gato.
- La foto va en círculo (`size-avatar-lg`), recortada al centro, con URL firmada de corta duración.
- Muestra como mucho una señal (la de mayor urgencia). Si es `urgent`, no uses la tarjeta: muestra el panel urgente arriba de la pantalla.
- Toda la tarjeta es pulsable; `accessibilityLabel`: "Kika, perra, 4 años. 5 de 7 días registrados. Señal: observar." """)

COMP['StatCard'] = ("Datos", 190, f"""
<div class="k-grid">
<div class="k-card k-stat"><div class="k-cap">Energía</div><div class="v">4<small>/5</small></div><span class="k-trend flat">→ estable</span></div>
<div class="k-card k-stat"><div class="k-cap">Apetito</div><div class="v">3<small>/5</small></div><span class="k-trend down">↓ 3 días</span></div>
<div class="k-card k-stat"><div class="k-cap">Ánimo</div><div class="v">4<small>/5</small></div><span class="k-trend up">↑ mejor</span></div>
<div class="k-card k-stat"><div class="k-cap">Peso</div><div class="v">12,4<small> kg</small></div><span class="k-trend flat">hace 12 días</span></div>
</div>
""", """Tarjeta de estadística: una métrica, su valor actual y la tendencia frente a la semana anterior.

## Lo que aporta quien lo usa
`label`, `value` (número), `scale?` ("/5") o `unit?` ("kg"), `trend` (`up` | `down` | `flat`), `trendLabel` ("3 días", "estable").

## Reglas
- Valor en `data-lg` (mono tabular) para comparar de un vistazo. Etiqueta en `caption` `ink-muted`.
- La tendencia lleva flecha + texto. `down` en apetito o energía usa `vet-fg`; no uses rojo de error: bajar no es un error.
- Usa números con el formato del idioma (Intl.NumberFormat): "12,4" en español, "12.4" en inglés.
- En una fila caben 3 en un móvil de 360 px; si no, pasa a 2 columnas.""")

COMP['WellnessSlider'] = ("Formularios", 230, """
<div class="k-card k-slider"><div class="top"><span class="k-label">Energía</span><span class="val">Con ganas de jugar</span></div><div class="k-track"><i></i><b style="width:75%"></b><em style="left:calc(75% - 14px)"></em></div><div class="k-ticks"><span>Muy baja</span><span>Normal</span><span>Muy alta</span></div></div>
<div class="k-card k-slider"><div class="top"><span class="k-label">Apetito</span><span class="val" style="color:var(--ink-muted)">Sin indicar</span></div><div class="k-track"><i></i><em style="left:calc(50% - 14px);box-shadow:inset 0 0 0 2px var(--line-control)"></em></div><div class="k-ticks"><span>No ha comido</span><span>Normal</span><span>Más de lo normal</span></div></div>
""", """Slider de bienestar: escala de 5 pasos (1–5) para energía, apetito, ánimo, actividad, sueño, vocalizaciones e interacción social (PRD 8.3).

## Lo que aporta quien lo usa
`label`, `value` (1–5 o `null`), `onChange`, `stepLabels` (5 textos traducidos: el paso actual se muestra a la derecha del título), `anchors` (izquierda, centro, derecha).

## Reglas
- Empieza sin valor (`null`): el pulgar en el centro con borde `line-control` y el texto "Sin indicar". Así se distingue "normal" de "no lo he mirado".
- El texto del paso actual es lo que da sentido, no el número: "Con ganas de jugar", no "4".
- Paso discreto con háptica suave en cada cambio. Accesible como `adjustable` (sube/baja con gestos del lector de pantalla) anunciando el texto del paso.
- Pista `size-slider-track`, pulgar `size-slider-thumb`, área táctil de toda la fila.
- Para el registro en menos de 45 s: los sliders van en una sola columna, sin pasos intermedios ni confirmaciones.""")

COMP['UrgencyTag'] = ("Datos", 300, f"""
<div class="k-row">{''.join(f'<span class="k-tag k-tag--{k}">{ic(i,14)}{l}</span>' for k,(l,i) in U.items())}</div>
<div class="k-urgent-panel" role="alert"><div class="k-row" style="gap:8px">{ic('triangle-alert',24)}<span class="k-label" style="color:inherit">Urgente, acudir ahora</span></div><h4>Lleva a Atom al veterinario ahora.</h4><div style="font-size:15px;line-height:22px">Las señales que has marcado pueden ser graves. Esta orientación no sustituye a un veterinario.</div><button class="k-btn k-btn--lg k-btn--block">Llamar a mi clínica</button></div>
""", """Etiqueta de urgencia: los cuatro niveles del PRD 8.4, siempre con icono + texto, nunca solo color. Mapean 1:1 con el enum `urgency_level` de la base de datos.

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
- La escala crece en luminosidad y saturación: se distingue también en escala de grises.""")

def chart_svg():
    xs = [10 + i * 46 for i in range(7)]
    e = [3.8, 4, 4.1, 3.9, 4, 4.1, 4]; a = [4, 4.1, 3.9, 3.3, 2.9, 2.8, 2.9]; m = [3.5, 3.6, 3.4, 3.7, 3.9, 4, 4.1]
    y = lambda v: 128 - (v - 1) * 28
    pl = lambda vals: ' '.join(f'{x},{y(v):.1f}' for x, v in zip(xs, vals))
    days = ['J', 'V', 'S', 'D', 'L', 'M', 'X']
    grid = ''.join(f'<line x1="0" x2="300" y1="{y(v)}" y2="{y(v)}" stroke="var(--chart-grid)" stroke-width="1"/>' for v in (1, 3, 5))
    lbl = ''.join(f'<text x="{x}" y="150" text-anchor="middle" font-size="11" fill="var(--ink-muted)" font-family="var(--font-mono)">{d}</text>' for x, d in zip(xs, days))
    band = f'<rect x="{xs[3]-12}" y="8" width="{xs[6]-xs[3]+24}" height="124" rx="8" fill="var(--routine-bg)" opacity="0.6"/>'
    return (f'<svg viewBox="0 0 300 156" role="img" aria-label="Últimos 7 días: energía estable, apetito baja desde el domingo, ánimo sube">'
            f'{band}{grid}'
            f'<polyline points="{pl(m)}" fill="none" stroke="var(--chart-mood)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<polyline points="{pl(e)}" fill="none" stroke="var(--chart-energy)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<polyline points="{pl(a)}" fill="none" stroke="var(--chart-appetite)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0"/>'
            f'<circle cx="{xs[-1]}" cy="{y(a[-1])}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>{lbl}</svg>')

COMP['TrendChart'] = ("Datos", 300, f"""
<div class="k-card k-chart"><div class="k-row" style="justify-content:space-between"><span class="k-label">Últimos 7 días</span><span class="k-cap k-mono">15 OCT</span></div>{chart_svg()}<div class="k-legend"><span><i style="background:var(--chart-energy)"></i>Energía</span><span><i style="background:var(--chart-appetite)"></i>Apetito</span><span><i style="background:var(--chart-mood)"></i>Ánimo</span></div><div class="k-cap">Zona marcada: el apetito ha bajado 3 días seguidos.</div></div>
""", """Gráfico de tendencias: líneas por métrica (día/semana/mes) con el punto sol en el valor de hoy y una banda `routine-bg` sobre el tramo que generó una señal.

## Lo que aporta quien lo usa
`series` (`{ metric, values: (number|null)[] }`), `range` (`week` | `month`), `labels` (fechas ya formateadas por idioma), `highlight?` (`{ from, to, note }`), `onPointPress?`.

## Reglas
- Colores fijos por métrica: `chart-energy`, `chart-appetite`, `chart-mood`. Máximo tres series a la vez; el resto se elige con chips.
- Línea 2,5 px, uniones redondas, sin relleno ni degradados. Rejilla `chart-grid` solo en 1, 3 y 5.
- Los días sin registro cortan la línea (hueco), no se interpolan.
- Leyenda siempre visible con texto; nunca dependas del color. El gráfico tiene `accessibilityLabel` con el resumen en una frase y una tabla equivalente accesible.
- Implementación sugerida: react-native-svg (pendiente de aprobar la dependencia).""")

COMP['StreakRing'] = ("Hábito", 210, f"""
<div class="k-row">{week_ring(6,96,'6 de 7 días; hoy registrado')}{week_ring(5,96,'5 de 7 días; hoy pendiente').replace('class="k-ring"','class="k-ring pending"')}{week_ring(2,96,'2 de 7 días')}</div>
<div class="k-streak">{week_ring(6,56,'semana').replace('class="on"','class="on" style="stroke:var(--laguna-300)"')}<div><div class="n">12</div><div style="font-size:14px">días seguidos cuidando de Kika</div></div></div>
""", """Anillo semanal y racha: el símbolo de Ritmo hecho componente. Seis arcos para los días anteriores y el punto sol para hoy (relleno si ya hay registro, contorno si falta).

## Lo que aporta quien lo usa
`days` (7 booleanos, el último es hoy), `size` (56 o 96), `streak?` (número de días seguidos para la tarjeta de racha), `petName`.

## Reglas
- La racha celebra el vínculo, no castiga: si se rompe, el texto es "Empezáis otra racha hoy", nunca "Has perdido tu racha".
- La tarjeta de racha usa `surface-inverse` con el número en `data-xl` color `accent`. Solo una por pantalla.
- Ligera animación al completar el día: el punto pasa de contorno a relleno en `duration-slow`; sin confeti. Respeta "reducir movimiento".
- `accessibilityLabel`: "5 de 7 días registrados esta semana. Hoy pendiente." """)

COMP['Badge'] = ("Hábito", 170, f"""
<div class="k-row" style="align-items:flex-start">
<div class="k-badge"><span class="disc">{week_ring(7,40,'')}</span>Primera semana completa</div>
<div class="k-badge"><span class="disc" style="color:var(--primary)">{ic('camera',28)}</span>Primer registro con foto</div>
<div class="k-badge"><span class="disc" style="color:var(--primary)">{ic('notebook',28)}</span>30 días de diario</div>
<div class="k-badge locked"><span class="disc">{ic('calendar',28)}</span>100 días juntos</div>
</div>
""", """Insignias: hitos de constancia (PRD 8.6). Disco `surface-warm` con anillo `accent`; bloqueadas en `surface-sunken` con borde discontinuo.

## Lo que aporta quien lo usa
`title` (nombre del hito, traducido), `icon` (Lucide o el anillo semanal), `earnedAt?` (sin fecha = bloqueada), `petName`.

## Reglas
- Nombres sobrios, en referencia a lo que hicisteis juntos ("30 días de diario"), sin superlativos ni juegos de palabras infantiles.
- Nunca premies registrar señales de alerta ni el uso de la orientación con IA: las insignias son de hábito y vínculo.
- Al conseguirla: hoja inferior breve con la insignia y una frase en voz de la mascota si está activada.""")

COMP['TabBar'] = ("Navegación", 220, f"""
<div class="k-header"><span class="k-iconbtn">{ic('chevron-left',24)}</span><h3>Historial de Kika</h3><span class="k-iconbtn">{ic('calendar',22)}</span></div>
<div class="k-tabbar">
<span class="k-tab on">{ic('home',24)}Hoy<span class="dot"></span></span><span class="k-tab">{ic('chart',24)}Tendencias</span><span class="k-tab">{ic('camera',24)}Consultar</span><span class="k-tab">{ic('calendar',24)}Agenda</span><span class="k-tab">{ic('user',24)}Perfil</span>
</div>
""", """Navegación: barra de pestañas de 5 destinos fijos y cabecera de pantalla. Implementación con Expo Router (Tabs y Stack).

## Destinos
Hoy · Tendencias · Consultar (orientación con foto y síntomas) · Agenda · Perfil (mascotas, cuenta y ajustes). El registro diario se abre desde Hoy, no es una pestaña.

## Reglas
- Pestaña activa: icono y texto `primary` más el punto `accent` debajo. Inactivas: `ink-muted`. Siempre icono + texto.
- Barra `surface`, alto `size-tabbar` más el inset inferior, `elevation-2`.
- Cabecera `size-header` sobre `bg`, título `title-3` centrado, botones de icono de `size-touch-min`. En pantallas raíz, título grande `title-1` alineado a la izquierda.
- Textos de pestaña de una palabra; si un idioma no cabe, se reduce a `caption` antes de truncar.""")

COMP['Alert'] = ("Feedback", 250, f"""
<div class="k-alert k-alert--success">{ic('check',20)}<span><b>Registro guardado</b>Kika ya tiene 5 de 7 días esta semana.</span></div>
<div class="k-alert k-alert--info">{ic('wifi-off',20)}<span><b>Sin conexión</b>Guardamos el registro en el móvil y lo subiremos al volver la conexión.</span></div>
<div class="k-alert k-alert--warning">{ic('refresh-cw',20)}<span><b>Alguien ha editado este registro</b>Revisa los cambios antes de guardar los tuyos.</span></div>
<div class="k-alert k-alert--error">{ic('info',20)}<span><b>No se ha podido guardar</b>Revisa la conexión e inténtalo de nuevo.</span></div>
""", """Alertas en línea y avisos breves (toast) del sistema: éxito, información, aviso y error. No son niveles de urgencia veterinaria: esos usan UrgencyTag.

## Lo que aporta quien lo usa
`tone` (`success` | `info` | `warning` | `error`), `title`, `message?`, `action?` (`{ label, onPress }`), `onDismiss?`.

## Reglas
- Título que dice qué ha pasado; mensaje que dice qué hacer. Sin "¡Ups!" ni disculpas genéricas.
- Toast solo para éxito (desaparece en 4 s, con `accessibilityLiveRegion="polite"`). Errores y avisos se quedan hasta resolverse.
- El conflicto de edición concurrente (`daily_log_conflict`) usa `warning` con la acción "Ver cambios".""")

COMP['Dialog'] = ("Feedback", 300, f"""
<div class="k-scrim"><div class="k-dialog" role="dialog"><h4>¿Eliminar el registro del martes?</h4><div style="color:var(--ink-muted)">Se borrará para todas las personas que cuidan de Kika. No se puede deshacer.</div><div class="k-col" style="margin-top:8px"><button class="k-btn k-btn--danger k-btn--block">Eliminar registro</button><button class="k-btn k-btn--ghost k-btn--block">Cancelar</button></div></div></div>
""", """Diálogo de confirmación: solo para decisiones que no se pueden deshacer o que afectan a otras personas.

## Lo que aporta quien lo usa
`title` (pregunta con el objeto concreto), `message` (consecuencia), `confirmLabel` (repite el verbo del título), `tone` (`default` | `danger`), `onConfirm`, `onCancel`.

## Reglas
- `surface-raised`, `radius-xl`, `elevation-3`, sobre `scrim`. Botones apilados a ancho completo: confirmar arriba, cancelar debajo.
- El botón de confirmar nunca dice "Sí" ni "Aceptar": dice la acción ("Eliminar registro").
- Para elegir entre opciones o formularios cortos usa una hoja inferior, no un diálogo.
- Foco inicial en "Cancelar" cuando el tono es `danger`.""")

COMP['EmptyState'] = ("Feedback", 290, f"""
<div class="k-grid">
<div class="k-card k-card--flat k-empty"><span class="art">{symbol_inline(34,'var(--primary)')}</span><h4>Aún no hay registros</h4><p>Cuéntanos cómo está Atom hoy. Son menos de 45 segundos.</p><button class="k-btn k-btn--primary">Registrar el día</button></div>
<div class="k-card k-card--flat k-empty err"><span class="art">{ic('wifi-off',30)}</span><h4>No hemos podido cargar el historial</h4><p>Revisa la conexión. Tus registros guardados en el móvil siguen ahí.</p><button class="k-btn k-btn--secondary">Reintentar</button></div>
</div>
""", """Estados vacíos y de error de pantalla completa: explican qué falta y ofrecen la siguiente acción.

## Lo que aporta quien lo usa
`kind` (`empty` | `error` | `offline`), `title`, `message`, `action?`, `petName?`.

## Reglas
- Vacío: el símbolo de Kitom en `surface-brand`, nunca una ilustración de un animal triste. Error: icono Lucide en `danger-bg`.
- Una sola acción, la más útil. En error, "Reintentar" como `secondary`.
- Usa el nombre de la mascota siempre que se conozca.
- El texto no culpa a la persona ni promete lo que no depende de nosotros.""")

def write_components():
    for name, (group, height, body, readme) in COMP.items():
        d = os.path.join(DS, 'components', name)
        os.makedirs(d, exist_ok=True)
        open(os.path.join(d, 'preview.html'), 'w').write(card(name, group, height, body))
        open(os.path.join(d, 'README.md'), 'w').write(f"# {name}\n\n{readme.strip()}\n")
    open(os.path.join(DS, 'components', 'bundle.css'), 'w').write(BUNDLE_CSS)

if __name__ == '__main__':
    write_components()
    print(list(COMP))
