"""Fuente única de la identidad Kitom (Ritmo). Genera logos, tokens y archivos del sistema."""
import json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
from contrast import cr

HERE = os.path.dirname(os.path.abspath(__file__))
SCR = os.path.dirname(HERE)

# ---------------------------------------------------------------- símbolo
# "Oreja y cola": la K de Kitom dibujada con las dos señales con las que un animal
# dice cómo está. Trazo 7/64, terminaciones redondas. El punto sol es "hoy".
SYM_STROKE = 7
# v1.0 (final): oreja más redonda y con la pata interior más corta (abre el hueco entre oreja y cola),
# cola con la curva final más cerrada y punto sol algo más pequeño y pegado a la oreja.
SYM_PATHS = [
    "M16 9V55",
    "M16 37.5L35.8 14Q40.6 8.6 42.4 15.2L43.2 26.5",
    "M26.5 26Q38.5 39 43.2 48.8Q46.3 55.3 52.3 52.2Q56.4 49.8 54.2 45",
]
SYM_DOT = (52.5, 13, 4.4)

# Corte óptico para tamaños pequeños (32 px o menos: favicon, notificaciones, avatares diminutos):
# trazo más grueso, oreja más corta, cola más abierta y punto sol mayor.
SYM_SMALL_STROKE = 9
SYM_SMALL_PATHS = [
    "M16 10V54",
    "M16 37L35.5 14.5Q40.5 9 42.2 16L42.6 24",
    "M27 27Q38 39 42.8 48.5Q46 54.8 51.8 52Q55.6 49.8 54 46",
]
SYM_SMALL_DOT = (53, 12.5, 5.8)

def _bbox(paths, stroke, dot):
    """Caja visual: muestrea líneas y cuadráticas e incluye media anchura de trazo y el punto."""
    import re
    xs, ys = [], []
    for d in paths:
        t = re.findall(r'[MLVQ]|-?\d+\.?\d*', d)
        i = 0; cur = (0, 0)
        while i < len(t):
            c = t[i]; i += 1
            if c in 'ML':
                cur = (float(t[i]), float(t[i+1])); i += 2; xs.append(cur[0]); ys.append(cur[1])
            elif c == 'V':
                cur = (cur[0], float(t[i])); i += 1; xs.append(cur[0]); ys.append(cur[1])
            elif c == 'Q':
                c1 = (float(t[i]), float(t[i+1])); e = (float(t[i+2]), float(t[i+3])); i += 4
                for k in range(41):
                    u = k / 40
                    xs.append((1-u)**2*cur[0] + 2*(1-u)*u*c1[0] + u*u*e[0])
                    ys.append((1-u)**2*cur[1] + 2*(1-u)*u*c1[1] + u*u*e[1])
                cur = e
    h = stroke / 2; cx, cy, r = dot
    return (round(min(min(xs)-h, cx-r), 1), round(min(min(ys)-h, cy-r), 1),
            round(max(max(xs)+h, cx+r), 1), round(max(max(ys)+h, cy+r), 1))

# caja visual del símbolo (incluye media anchura de trazo)
SYM_BOX = _bbox(SYM_PATHS, SYM_STROKE, SYM_DOT)  # x0,y0,x1,y1
SYM_W = SYM_BOX[2] - SYM_BOX[0]
SYM_H = SYM_BOX[3] - SYM_BOX[1]
SYM_SMALL_BOX = _bbox(SYM_SMALL_PATHS, SYM_SMALL_STROKE, SYM_SMALL_DOT)

def sym_group(ink, dot, tx=0, ty=0, s=1.0):
    x0, y0 = SYM_BOX[0], SYM_BOX[1]
    paths = "".join(f'<path d="{d}"/>' for d in SYM_PATHS)
    cx, cy, r = SYM_DOT
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f}) translate({-x0} {-y0})">'
            f'<g fill="none" stroke="{ink}" stroke-width="{SYM_STROKE}" stroke-linecap="round" stroke-linejoin="round">{paths}</g>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{dot}"/></g>')

def sym_small_group(ink, dot, tx=0, ty=0, s=1.0):
    x0, y0 = SYM_SMALL_BOX[0], SYM_SMALL_BOX[1]
    paths = "".join(f'<path d="{d}"/>' for d in SYM_SMALL_PATHS)
    cx, cy, r = SYM_SMALL_DOT
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f}) translate({-x0} {-y0})">'
            f'<g fill="none" stroke="{ink}" stroke-width="{SYM_SMALL_STROKE}" stroke-linecap="round" stroke-linejoin="round">{paths}</g>'
            f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{dot}"/></g>')

WM = json.load(open(os.path.join(HERE, "wm.json")))
WM_S = 0.066  # altura de la k (697 u) = 46 = longitud del asta del símbolo

def wordmark(ink, tx, baseline):
    return f'<path transform="translate({tx:.2f} {baseline:.2f}) scale({WM_S})" fill="{ink}" d="{WM["d"]}"/>'

def svg(vb_w, vb_h, body, title="Kitom"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w:g} {vb_h:g}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{body}</svg>\n')

def logo_symbol(ink="#0F2A29", dot="#F2B441", pad=0):
    return svg(SYM_W + 2*pad, SYM_H + 2*pad, sym_group(ink, dot, pad, pad))

def logo_horizontal(ink="#0F2A29", dot="#F2B441", word=None):
    word = word or ink
    gap = 13
    wx = SYM_W + gap - 65 * WM_S
    w = wx + WM["width"] * WM_S + 1
    return svg(round(w, 1), SYM_H, sym_group(ink, dot) + wordmark(word, wx, 52 - SYM_BOX[1] + 0.5))

def logo_stacked(ink="#0F2A29", dot="#F2B441"):
    ww = WM["width"] * WM_S
    w = ww + 4
    sx = (w - SYM_W) / 2
    h = SYM_H + 16 + 46 + 4
    return svg(round(w, 1), round(h, 1), sym_group(ink, dot, sx, 0) + wordmark(ink, 2 - 65*WM_S + 2, SYM_H + 16 + 46))

def logo_symbol_small(ink="#0F2A29", dot="#F2B441"):
    b = SYM_SMALL_BOX
    return svg(round(b[2]-b[0], 1), round(b[3]-b[1], 1), sym_small_group(ink, dot))

def icon_small(bg="#0E3B39", ink="#F2F5F3", dot="#F2B441", size=64, frac=0.66, rounded=True, transparent=False):
    b = SYM_SMALL_BOX; w, h = b[2]-b[0], b[3]-b[1]
    s = size * frac / h
    tx = (size - w * s) / 2 + size * 0.01
    ty = (size - h * s) / 2
    rect = "" if transparent else (f'<rect width="{size}" height="{size}" rx="{size*0.2237:.1f}" fill="{bg}"/>' if rounded else f'<rect width="{size}" height="{size}" fill="{bg}"/>')
    return svg(size, size, rect + sym_small_group(ink, dot, tx, ty, s), "Kitom")

def app_icon(bg="#0E3B39", ink="#F2F5F3", dot="#F2B441", size=1024, frac=0.56, rounded=False, transparent=False):
    s = size * frac / SYM_H
    tx = (size - SYM_W * s) / 2 + size * 0.01
    ty = (size - SYM_H * s) / 2
    rect = "" if transparent else (f'<rect width="{size}" height="{size}" rx="{size*0.2237:.0f}" fill="{bg}"/>' if rounded else f'<rect width="{size}" height="{size}" fill="{bg}"/>')
    return svg(size, size, rect + sym_group(ink, dot, tx, ty, s), "Kitom")

# ---------------------------------------------------------------- color
# primitivas (un solo valor)
PRIM = [
    ("laguna-50", "#EEF6F4"), ("laguna-100", "#DCEBE6"), ("laguna-200", "#B9D7CF"), ("laguna-300", "#8DBDB2"),
    ("laguna-400", "#5A9C92"), ("laguna-500", "#2F807A"), ("laguna-600", "#1F6F6B"), ("laguna-700", "#185956"),
    ("laguna-800", "#124643"), ("laguna-900", "#0E3B39"),
    ("sol-100", "#FDF1D6"), ("sol-300", "#F7CF7A"), ("sol-500", "#F2B441"), ("sol-700", "#8A5A00"),
    ("arena-100", "#F7EDE6"), ("arena-300", "#EFD9CB"), ("arena-500", "#D9B49C"), ("arena-700", "#7D543C"),
    ("niebla-0", "#FFFFFF"), ("niebla-50", "#F7F9F8"), ("niebla-100", "#F2F5F3"), ("niebla-200", "#E6ECE9"),
    ("niebla-300", "#DAE4E0"), ("niebla-400", "#B5C3BF"), ("niebla-500", "#7E918D"), ("niebla-600", "#566A67"),
    ("niebla-700", "#3B4E4B"), ("niebla-800", "#1F3331"), ("niebla-900", "#0F2A29"),
    ("noche-500", "#5E7773"), ("noche-600", "#284340"), ("noche-700", "#1D3331"), ("noche-800", "#152624"), ("noche-900", "#0C1918"),
]
PRIM_USAGE = {
    "laguna": "Escala de marca (verde laguna). Úsala a través de los tokens semánticos, no directamente en pantallas.",
    "sol": "Acento cálido: hoy, rachas y celebraciones. Nunca como texto sobre fondos claros (usa accent-ink).",
    "arena": "Calidez secundaria: mensajes en voz de la mascota y celebraciones.",
    "niebla": "Neutros con tinte verde para el tema claro.",
    "noche": "Neutros del tema oscuro.",
}

# semánticos: (nombre, claro, oscuro, uso)
SEM = [
    ("bg", "#F2F5F3", "#0C1918", "Fondo de pantalla."),
    ("surface", "#FFFFFF", "#152624", "Tarjetas, campos, barras de navegación."),
    ("surface-raised", "#FFFFFF", "#1D3331", "Diálogos, menús y hojas inferiores (con elevation-3)."),
    ("surface-sunken", "#E6ECE9", "#0A1413", "Pistas de controles segmentados, skeletons y fondos hundidos."),
    ("surface-brand", "#DCEBE6", "#17332F", "Paneles suaves de marca y elementos seleccionados."),
    ("surface-warm", "#F7EDE6", "#2A211C", "Mensajes en voz de la mascota y celebraciones."),
    ("surface-inverse", "#0E3B39", "#123F3C", "Tarjeta de racha y banners destacados."),
    ("ink", "#0F2A29", "#E6EFEC", "Texto principal sobre bg, surface, surface-brand y surface-warm."),
    ("ink-muted", "#566A67", "#9DB2AE", "Texto secundario sobre bg y surface."),
    ("ink-subtle", "#7E918D", "#7F9894", "Placeholders, iconos inactivos y texto deshabilitado. Cumple 3:1, no 4,5:1: nunca para texto que haya que leer."),
    ("ink-inverse", "#F2F5F3", "#F2F5F3", "Texto sobre surface-inverse."),
    ("line", "#DAE4E0", "#24403C", "Divisores y filetes decorativos de tarjetas."),
    ("line-control", "#7E918D", "#5E7773", "Borde de campos, casillas y controles (3:1 sobre surface)."),
    ("primary", "#1F6F6B", "#6CC0B4", "Acción principal, estado activo, enlaces y la serie principal de los gráficos."),
    ("primary-pressed", "#185956", "#8DD0C6", "Acción principal pulsada."),
    ("on-primary", "#FFFFFF", "#06201E", "Texto e iconos sobre primary."),
    ("accent", "#F2B441", "#F2B441", "Punto de hoy, rachas e insignias. Relleno, nunca texto sobre claro."),
    ("on-accent", "#0F2A29", "#0F2A29", "Texto e iconos sobre accent."),
    ("accent-ink", "#8A5A00", "#F2C46B", "Texto en tono sol (por ejemplo, el número de una racha) sobre bg o surface."),
    ("warm-ink", "#7D543C", "#E2B89D", "Etiqueta de la voz de la mascota sobre surface-warm."),
    ("focus-ring", "#1F6F6B", "#6CC0B4", "Anillo de foco: 2 px sólido con 2 px de separación."),
    ("scrim", "rgba(6, 20, 19, 0.48)", "rgba(0, 0, 0, 0.6)", "Velo detrás de diálogos y hojas."),
    # urgencia (PRD 8.4): siempre icono + texto
    ("observe-bg", "#E3EEF5", "#152A36", "Fondo del nivel Observar."),
    ("observe-fg", "#2D5F80", "#9CC8E4", "Texto e icono del nivel Observar sobre observe-bg."),
    ("routine-bg", "#FCEFCF", "#33270F", "Fondo del nivel Cambio de rutina recomendado."),
    ("routine-fg", "#7A4D00", "#F2C46B", "Texto e icono de Cambio de rutina sobre routine-bg."),
    ("vet-bg", "#FBE2D5", "#3A1F14", "Fondo del nivel Consultar veterinario pronto."),
    ("vet-fg", "#9A3412", "#F5A783", "Texto e icono de Consultar veterinario pronto sobre vet-bg."),
    ("urgent", "#B42318", "#B42318", "Relleno sólido del nivel Urgente, acudir ahora. Siempre a pantalla o tarjeta completa, nunca solo una etiqueta."),
    ("on-urgent", "#FFFFFF", "#FFFFFF", "Texto e icono sobre urgent."),
    # sistema
    ("success-bg", "#DDF0E6", "#123325", "Fondo de confirmaciones (guardado, sincronizado)."),
    ("success-fg", "#1D6B47", "#8FD3B0", "Texto e icono de confirmación sobre success-bg."),
    ("danger", "#B42318", "#B42318", "Relleno de acciones destructivas y errores bloqueantes."),
    ("on-danger", "#FFFFFF", "#FFFFFF", "Texto sobre danger."),
    ("danger-ink", "#B42318", "#F28B80", "Texto de error de campo y botones destructivos sin relleno, sobre surface y bg."),
    ("danger-bg", "#FBE4E1", "#3A1512", "Fondo de alertas de error."),
    # gráficos
    ("chart-energy", "#1F6F6B", "#6CC0B4", "Serie Energía."),
    ("chart-appetite", "#B5651D", "#E8A55C", "Serie Apetito."),
    ("chart-mood", "#4D6FA8", "#8FAEE0", "Serie Ánimo."),
    ("chart-activity", "#6B7A1F", "#B9C46A", "Serie Actividad."),
    ("chart-sleep", "#7B5EA7", "#C2A8E8", "Serie Sueño."),
    ("chart-grid", "#DAE4E0", "#24403C", "Rejilla y ejes de gráficos."),
]

# comprobación de contraste (texto 4,5:1; marcas 3:1)
CHECK = [
    ("ink", "bg", 4.5), ("ink", "surface", 4.5), ("ink", "surface-brand", 4.5), ("ink", "surface-warm", 4.5),
    ("ink-muted", "bg", 4.5), ("ink-muted", "surface", 4.5), ("ink-subtle", "surface", 3), ("ink-inverse", "surface-inverse", 4.5),
    ("line-control", "surface", 3), ("primary", "bg", 4.5), ("primary", "surface", 4.5), ("on-primary", "primary", 4.5),
    ("on-accent", "accent", 4.5), ("accent-ink", "surface", 4.5), ("accent-ink", "bg", 4.5), ("warm-ink", "surface-warm", 4.5),
    ("focus-ring", "bg", 3), ("focus-ring", "surface", 3),
    ("observe-fg", "observe-bg", 4.5), ("routine-fg", "routine-bg", 4.5), ("vet-fg", "vet-bg", 4.5), ("on-urgent", "urgent", 4.5),
    ("success-fg", "success-bg", 4.5), ("on-danger", "danger", 4.5), ("danger-ink", "surface", 4.5), ("danger-ink", "bg", 4.5),
    ("chart-energy", "surface", 3), ("chart-appetite", "surface", 3), ("chart-mood", "surface", 3), ("chart-activity", "surface", 3), ("chart-sleep", "surface", 3),
]

def sem(name, theme):
    for n, l, d, _ in SEM:
        if n == name:
            return l if theme == "light" else d
    raise KeyError(name)

def check_contrast():
    bad = []
    for theme in ("light", "dark"):
        for fg, bg, need in CHECK:
            v = cr(sem(fg, theme), sem(bg, theme))
            if v < need:
                bad.append((theme, fg, bg, round(v, 2), need))
    return bad

# ---------------------------------------------------------------- tipografía
FAM_SANS = '"Hanken Grotesk", system-ui, -apple-system, "Segoe UI", sans-serif'
FAM_MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace'
RN_FONT = {("sans", 400): "HankenGrotesk_400Regular", ("sans", 500): "HankenGrotesk_500Medium",
           ("sans", 600): "HankenGrotesk_600SemiBold", ("mono", 500): "IBMPlexMono_500Medium"}
# (grupo, nombre, familia, tamaño, interlineado, peso, tracking px, uso, muestra)
TYPE = [
    ("Display", "display", "sans", 34, 40, 600, -0.68, "Cifra o frase protagonista de una pantalla (bienvenida, resultado). Una por pantalla.", "Atom ha tenido un buen día"),
    ("Display", "title-1", "sans", 28, 34, 600, -0.42, "Título de pantalla.", "Historial de Kika"),
    ("Display", "title-2", "sans", 22, 28, 600, -0.22, "Título de sección y de diálogo.", "Esta semana"),
    ("Display", "title-3", "sans", 18, 24, 600, -0.09, "Título de tarjeta.", "Vacuna anual"),
    ("Text", "body-lg", "sans", 17, 24, 400, 0, "Texto destacado y resultados de orientación.", "Atom ha comido menos estos tres días."),
    ("Text", "body", "sans", 15, 22, 400, 0, "Texto por defecto.", "Añade una nota si algo te ha llamado la atención."),
    ("Text", "body-strong", "sans", 15, 22, 600, 0, "Énfasis dentro de body y filas de lista.", "Desparasitación interna"),
    ("Text", "label", "sans", 13, 18, 500, 0, "Etiquetas de campo, chips y pestañas.", "Energía"),
    ("Text", "caption", "sans", 12, 16, 400, 0, "Notas, marcas de tiempo y avisos legales breves.", "Orientación informativa, no sustituye al veterinario."),
    ("Text", "button", "sans", 16, 20, 600, 0, "Texto de botones.", "Registrar el día"),
    ("Data", "data-xl", "mono", 40, 44, 500, -0.8, "Número protagonista (racha, peso).", "12"),
    ("Data", "data-lg", "mono", 28, 32, 500, -0.28, "Valores de tarjetas de estadística.", "4/5"),
    ("Data", "data", "mono", 15, 20, 500, 0, "Cifras, fechas y unidades en línea.", "12,4 kg · 3 días"),
    ("Data", "overline", "mono", 11, 14, 500, 0.66, "Antetítulos en mayúsculas (fecha del día, secciones).", "JUE 15 OCT"),
]

# ---------------------------------------------------------------- escalas
SPACING = [("space-0", 0, "Sin espacio."), ("space-1", 4, "Icono ↔ texto."), ("space-2", 8, "Entre chips y elementos de una fila."),
           ("space-3", 12, "Entre tarjetas de una lista."), ("space-4", 16, "Relleno de tarjeta y de campo."),
           ("space-5", 20, "Margen lateral de pantalla (gutter)."), ("space-6", 24, "Entre bloques de una pantalla."),
           ("space-8", 32, "Entre secciones."), ("space-10", 40, "Aire superior de pantallas de bienvenida."),
           ("space-12", 48, "Separación de estados vacíos."), ("space-16", 64, "Máximo; ilustraciones y onboarding.")]
RADIUS = [("radius-xs", 6, "Chips de urgencia, etiquetas e insignias pequeñas."), ("radius-sm", 10, "Botones pequeños, miniaturas."),
          ("radius-md", 14, "Botones y campos de texto."), ("radius-lg", 18, "Tarjetas."),
          ("radius-xl", 24, "Hojas inferiores, diálogos y foto de la tarjeta de mascota."), ("radius-full", 999, "Avatares, interruptores y el pulgar del slider.")]
BORDER = [("border-hairline", 1, "Filete de tarjetas y divisores (line)."), ("border-control", 1.5, "Borde de campos y botón secundario (line-control / primary)."),
          ("border-focus", 2, "Anillo de foco (focus-ring), separado 2 px.")]
ICON = [("icon-xs", 16, "Dentro de chips y texto caption."), ("icon-sm", 20, "Filas de lista y botones."),
        ("icon-md", 24, "Tamaño por defecto, barra de pestañas."), ("icon-lg", 32, "Estados vacíos y cabeceras de resultado.")]
SIZE = [("size-touch-min", 44, "Área táctil mínima de cualquier control (usa hitSlop si el visual es menor)."),
        ("size-button-lg", 52, "Botón principal de pantalla."), ("size-button-md", 44, "Botón estándar."), ("size-button-sm", 36, "Botón compacto (con hitSlop)."),
        ("size-input", 52, "Alto de campo de texto y selector."), ("size-chip", 28, "Chips y etiquetas de urgencia."),
        ("size-tabbar", 56, "Barra de pestañas, más el área segura inferior."), ("size-header", 56, "Cabecera de navegación."),
        ("size-list-row", 56, "Alto mínimo de fila."), ("size-slider-track", 6, "Pista del slider de bienestar."), ("size-slider-thumb", 28, "Pulgar del slider."),
        ("size-avatar-sm", 32, "Avatar en listas."), ("size-avatar-md", 40, "Selector de mascota en cabecera."),
        ("size-avatar-lg", 64, "Tarjeta de mascota."), ("size-avatar-xl", 96, "Perfil de mascota.")]
OPACITY = [("opacity-disabled", "0.4", "Controles deshabilitados."), ("opacity-pressed-overlay", "0.08", "Capa de pulsación sobre superficies.")]
SHADOW = [
    ("elevation-1", "0 1px 2px rgba(14, 59, 57, 0.06), 0 6px 16px -10px rgba(14, 59, 57, 0.25)", "0 0 0 1px rgba(255, 255, 255, 0.04)", "Tarjetas sobre bg."),
    ("elevation-2", "0 2px 6px rgba(14, 59, 57, 0.08), 0 12px 24px -12px rgba(14, 59, 57, 0.3)", "0 0 0 1px rgba(255, 255, 255, 0.06), 0 12px 24px -12px rgba(0, 0, 0, 0.6)", "Barra de pestañas y botón flotante."),
    ("elevation-3", "0 8px 32px -8px rgba(14, 59, 57, 0.35)", "0 8px 32px -8px rgba(0, 0, 0, 0.7)", "Diálogos y hojas inferiores."),
]
RN_SHADOW = {"elevation-1": dict(shadowColor="#0E3B39", shadowOpacity=0.12, shadowRadius=12, shadowOffset=dict(width=0, height=4), elevation=2),
             "elevation-2": dict(shadowColor="#0E3B39", shadowOpacity=0.16, shadowRadius=18, shadowOffset=dict(width=0, height=6), elevation=6),
             "elevation-3": dict(shadowColor="#0E3B39", shadowOpacity=0.24, shadowRadius=28, shadowOffset=dict(width=0, height=10), elevation=12)}
MOTION = {"duration-fast": 120, "duration-base": 200, "duration-slow": 320, "easing-standard": [0.2, 0, 0, 1], "easing-exit": [0.4, 0, 1, 1]}

URGENCY = [
    ("observe", "Observar", "eye", "observe-bg", "observe-fg"),
    ("routine_change", "Cambio de rutina recomendado", "refresh-cw", "routine-bg", "routine-fg"),
    ("consult_soon", "Consultar veterinario pronto", "stethoscope", "vet-bg", "vet-fg"),
    ("urgent", "Urgente, acudir ahora", "triangle-alert", "urgent", "on-urgent"),
]

if __name__ == "__main__":
    bad = check_contrast()
    for b in bad:
        print("FALLA", b)
    print("ok" if not bad else f"{len(bad)} fallos")
