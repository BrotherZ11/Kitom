# Kitom · generador del prototipo navegable (artboards .dc.html del lienzo «Kitom · Prototipo»).
# Helpers compartidos: iconos Lucide, anillo semanal, barra de pestañas, cabeceras, listas, etiquetas.
# Todas las pantallas usan las clases de kitom.css (mismos tokens que tokens.ts).

def H(name):
    """Hueco de plantilla {{name}} (solo búsqueda con puntos, nunca expresiones)."""
    return '{{' + name + '}}'

FONTS = '<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&amp;family=IBM+Plex+Mono:wght@500&amp;display=swap" rel="stylesheet">'

STATIC_SCRIPT = """class Component extends DCLogic {
  renderVals() {
    return {};
  }
}"""


def page(title, body, style='', script=None, props=None, w=390, h=844, bodybg=None):
    import json
    p = dict(props or {})
    p['$preview'] = {'width': w, 'height': h}
    pj = json.dumps(p, ensure_ascii=False).replace('&', '&amp;').replace("'", '&#39;')
    bg = ';background:' + bodybg if bodybg else ''
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>{title}</title>
<script src="./support.js"></script>
<link rel="stylesheet" href="./kitom.css">
</head>
<body>
<x-dc>
<helmet>
{FONTS}
<style>
body{{margin:0{bg}}}
{style.strip()}
</style>
</helmet>
{body.strip()}
</x-dc>
<script type="text/x-dc" data-dc-script data-props='{pj}'>
{(script or STATIC_SCRIPT).strip()}
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- iconos (Lucide, rejilla 24, trazo 2)
_I = {
    'home': '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"></path>',
    'chart': '<path d="M3 3v18h18"></path><path d="m7 15 4-4 3 3 5-6"></path>',
    'calendar': '<rect x="3" y="4" width="18" height="18" rx="2"></rect><path d="M16 2v4M8 2v4M3 10h18"></path>',
    'user': '<circle cx="12" cy="8" r="4"></circle><path d="M4 21a8 8 0 0 1 16 0"></path>',
    'camera': '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"></path><circle cx="12" cy="13" r="3"></circle>',
    'plus': '<path d="M12 5v14M5 12h14"></path>',
    'check': '<path d="M20 6 9 17l-5-5"></path>',
    'x': '<path d="M18 6 6 18M6 6l12 12"></path>',
    'chev-l': '<path d="m15 18-6-6 6-6"></path>',
    'chev-r': '<path d="m9 18 6-6-6-6"></path>',
    'chev-d': '<path d="m6 9 6 6 6-6"></path>',
    'bell': '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path>',
    'bell-off': '<path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"></path><path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"></path><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"></path><path d="m2 2 20 20"></path>',
    'eye': '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle>',
    'eye-off': '<path d="M10.7 5.1A10.7 10.7 0 0 1 22 12a13 13 0 0 1-1.7 2.7M14.1 14.2a3 3 0 0 1-4.2-4.2M17.5 17.5A10.7 10.7 0 0 1 2 12a13.2 13.2 0 0 1 4.4-5.6M2 2l20 20"></path>',
    'refresh': '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"></path><path d="M16 16h5v5"></path>',
    'steth': '<path d="M11 2v2M5 2v2M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1"></path><path d="M8 15a6 6 0 0 0 12 0v-3"></path><circle cx="20" cy="10" r="2"></circle>',
    'alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"></path><path d="M12 9v4M12 17h.01"></path>',
    'info': '<circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4M12 8h.01"></path>',
    'alert-c': '<circle cx="12" cy="12" r="10"></circle><path d="M12 8v4M12 16h.01"></path>',
    'wifi-off': '<path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.43M2 8.82a15 15 0 0 1 4.17-2.65M10.66 5c4.01-.36 8.14.9 11.34 3.76M2 2l20 20"></path>',
    'phone-dev': '<rect x="6" y="2" width="12" height="20" rx="2"></rect><path d="M11 18h2"></path>',
    'clock': '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    'clip': '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.6l-8.6 8.6a2 2 0 0 1-2.8-2.8l8.5-8.5"></path>',
    'pill': '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"></path><path d="m8.5 8.5 7 7"></path>',
    'syringe': '<path d="m18 2 4 4M17 7l3-3M19 9 8.7 19.3a2.4 2.4 0 0 1-3.4 0l-.6-.6a2.4 2.4 0 0 1 0-3.4L15 5M9 11l4 4M5 19l-3 3M14 4l6 6"></path>',
    'drops': '<path d="M7 16.3c2.2 0 4-1.8 4-4 0-1.2-.6-2.3-1.7-3C8.1 8.6 7.3 7.4 7 6c-.3 1.4-1.1 2.6-2.3 3.3S3 11.1 3 12.3c0 2.2 1.8 4 4 4z"></path><path d="M12.6 6.4A5 5 0 0 0 13 4.5c.3 1.4 1.1 2.6 2.3 3.3s1.7 1.8 1.7 3"></path>',
    'shield-plus': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path><path d="M9 12h6M12 9v6"></path>',
    'shield': '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"></path>',
    'gear': '<path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle>',
    'medal': '<circle cx="12" cy="8" r="6"></circle><path d="M15.5 12.9 17 22l-5-3-5 3 1.5-9.1"></path>',
    'lock': '<rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>',
    'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"></path>',
    'file': '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5Z"></path><path d="M14 2v6h6M9 15h6M9 11h2"></path>',
    'image': '<rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"></path>',
    'trash': '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    'pencil': '<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4"></path>',
    'logout': '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"></path>',
    'globe': '<circle cx="12" cy="12" r="10"></circle><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>',
    'moon': '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>',
    'download': '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"></path>',
    'help': '<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"></path>',
    'mail': '<rect x="2" y="4" width="20" height="16" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>',
    'phone': '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path>',
    'pin': '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"></path><circle cx="12" cy="10" r="3"></circle>',
    'key': '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4M21 2l-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle>',
    'cloud-up': '<path d="M12 13v8M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2M8 17l4-4 4 4"></path>',
    'cloud-ok': '<path d="M17.5 21H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"></path><path d="m9.5 15.5 2 2 3.5-3.5"></path>',
    'undo': '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path>',
    'list': '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"></path>',
    'flag': '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.33 2q2 0 3.07-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.53"></path>',
    'chat': '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path>',
    'ext': '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>',
    'scan': '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"></path>',
    'heart': '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path>',
    'gift': '<rect x="3" y="8" width="18" height="4" rx="1"></rect><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C9 3 12 5 12 8c0-3 3-5 4.5-5a2.5 2.5 0 0 1 0 5"></path>',
    'target': '<circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle>',
    'swap': '<path d="m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16"></path>',
    'more': '<circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle>',
    'sun-dot': '<circle cx="12" cy="12" r="4"></circle>',
    'scissors': '<circle cx="6" cy="6" r="3"></circle><path d="M8.12 8.12 12 12M20 4 8.12 15.88"></path><circle cx="6" cy="18" r="3"></circle><path d="M14.8 14.8 20 20"></path>',
    'tag': '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"></path><circle cx="7.5" cy="7.5" r=".5"></circle>',
    'note': '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"></path><path d="M15 3v6h6"></path>',
    'zz': '<path d="M2 4h6l-6 8h6M14 10h4l-4 6h4"></path>',
    'wave': '<path d="M2 12h3l3-8 4 16 3-8h7"></path>',
}


def icon(name, size=20, sw=2, style='', cls=''):
    st = f' style="{style}"' if style else ''
    c = f' class="{cls}"' if cls else ''
    return (f'<svg{c} width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="{sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"{st}>{_I[name]}</svg>')


# ---------------------------------------------------------------- anillo semanal (6 días + punto de hoy)
SEGS = ['M34.11 10.10A22 22 0 0 1 47.81 16.70', 'M50.44 19.99A22 22 0 0 1 53.82 34.82',
        'M52.88 38.93A22 22 0 0 1 43.40 50.82', 'M39.60 52.64A22 22 0 0 1 24.40 52.64',
        'M20.60 50.82A22 22 0 0 1 11.12 38.93', 'M10.18 34.82A22 22 0 0 1 13.56 19.99']


def ring(days, today='pending', text='', label='', size=104, sw=5.5, sub='', fs=10):
    """days: 6 valores 'on' | 'off' | 'gap' (del más antiguo al de ayer, en sentido horario desde arriba)."""
    segs = ''.join(f'<path class="{d}" d="{p}"></path>' for d, p in zip(days, SEGS))
    if today == 'pending':
        dot = '<circle class="today pending" cx="22.45" cy="12.18" r="3.8"></circle>'
    elif today == 'done':
        dot = '<circle class="today" cx="22.45" cy="12.18" r="4.6"></circle>'
    else:
        dot = ''
    t = ''
    if text:
        y = 34 if sub else 35
        t = f'<text x="32" y="{y}" text-anchor="middle" font-size="{fs}">{text}</text>'
    if sub:
        t += f'<text x="32" y="41" text-anchor="middle" font-size="3.6" style="fill: var(--muted)">{sub}</text>'
    return (f'<svg class="ring" width="{size}" height="{size}" viewBox="0 0 64 64" role="img" aria-label="{label}">'
            f'<g stroke-width="{sw}">{segs}</g>{dot}{t}</svg>')


# ---------------------------------------------------------------- barra de pestañas
# Inicio · Historial · Registrar (acción central, abre el registro a pantalla completa) · Agenda · Perfil
TABS = [('hoy', 'Hoy', 'home', 'Home.dc.html'), ('hist', 'Historial', 'chart', 'Tendencias.dc.html'),
        ('reg', 'Registrar', None, 'Registro.dc.html'), ('agenda', 'Agenda', 'calendar', 'Agenda.dc.html'),
        ('perfil', 'Perfil', 'user', 'PerfilMascota.dc.html')]


def tabbar(active='hoy', done=False, reg_href=None):
    out = ['<nav class="tabbar" aria-label="Principal">']
    for key, label, ic, href in TABS:
        if key == 'reg':
            h = reg_href or ('RegistroHoyEditar.dc.html' if done else 'Registro.dc.html')
            if done:
                out.append(f'<a class="tab act done" href="{h}" aria-label="Registro de hoy hecho. Editar"><span class="fab">{icon("check", 22, 2.4)}</span>Hecho</a>')
            else:
                out.append(f'<a class="tab act" href="{h}" aria-label="Registrar el día de Kika. Pendiente"><span class="fab">{icon("plus", 22, 2.4)}<i></i></span>Registrar</a>')
            continue
        on = key == active
        cls = 'tab on' if on else 'tab'
        cur = ' aria-current="page"' if on else ''
        out.append(f'<a class="{cls}" href="{href}"{cur}><span class="pill">{icon(ic, 22)}</span>{label}</a>')
    out.append('</nav>')
    return '\n    '.join(out)


# ---------------------------------------------------------------- piezas
def top(title, back='Home.dc.html', right='', icon_name='chev-l', label='Volver', sub=''):
    r = right or '<span style="width: 44px"></span>'
    s = f'<span class="cap muted">{sub}</span>' if sub else ''
    mid = (f'<div class="col" style="gap: 0; align-items: center; text-align: center"><span class="strong">{title}</span>{s}</div>'
           if sub else f'<span class="strong">{title}</span>')
    return (f'<div class="top"><a class="ib" href="{back}" aria-label="{label}">{icon(icon_name, 24)}</a>'
            f'{mid}{r}</div>')


def pet_head(date='Jueves 16 oct', name='Kika', href='SelectorMascota.dc.html', right=None):
    r = right if right is not None else (
        f'<a class="btn secondary sm" href="ConsultaIntro.dc.html" aria-label="Consultar con una foto">{icon("camera", 18)}Consultar</a>')
    return (f'<div class="top"><a class="row" href="{href}" style="gap: 12px; text-decoration: none; color: inherit" aria-label="Cambiar de mascota. Ahora: {name}">'
            f'<div class="av s40 warm">{name[0]}</div><div class="col" style="gap: 0"><span class="over">{date}</span>'
            f'<span class="t3 row" style="gap: 4px">{name}{icon("chev-d", 18, 2, "color: var(--muted)")}</span></div></a>{r}</div>')


def li(title, sub='', ic=None, right='', href=None, chev=None, strong=True, extra_cls='', style=''):
    tag = 'a' if href else 'div'
    hr = f' href="{href}"' if href else ''
    st = f' style="{style}"' if style else ''
    ico = f'<span class="ico">{icon(ic)}</span>' if ic else ''
    tcls = 'strong' if strong else ''
    s = f'<span class="cap muted">{sub}</span>' if sub else ''
    ch = chev if chev is not None else bool(href)
    chv = f'<svg class="chev" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{_I["chev-r"]}</svg>' if ch else ''
    return (f'<{tag} class="li{(" " + extra_cls) if extra_cls else ""}"{hr}{st}>{ico}<span class="col grow" style="gap: 0">'
            f'<span class="{tcls}">{title}</span>{s}</span>{right}{chv}</{tag}>')


LEVELS = {
    'observe': ('Observar', 'eye'),
    'routine': ('Cambio de rutina recomendado', 'refresh'),
    'vet': ('Consultar veterinario pronto', 'steth'),
    'urgent': ('Urgente, acudir ahora', 'alert'),
}
LEVEL_SHORT = {'observe': 'Observar', 'routine': 'Cambio de rutina', 'vet': 'Veterinario pronto', 'urgent': 'Urgente'}


def utag(level, short=False):
    label = LEVEL_SHORT[level] if short else LEVELS[level][0]
    return f'<span class="tag {level}">{icon(LEVELS[level][1], 16)}{label}</span>'


def alert(kind, ic, strong, text='', role='status'):
    t = f'<strong>{strong}</strong>{text}' if strong else text
    return f'<div class="alert {kind}" role="{role}">{icon(ic, 20, 2, "flex: none; margin-top: 1px")}<div>{t}</div></div>'


def disclaimer():
    return alert('info', 'info', '', 'Esta orientación es informativa y no sustituye a un veterinario.', 'note')


def btn(text, href='#', kind='primary', ic=None, extra=''):
    i = icon(ic, 20) if ic else ''
    return f'<a class="btn {kind}" href="{href}"{extra}>{i}{text}</a>'


def foot(*items, style=''):
    st = f' style="{style}"' if style else ''
    return f'<div class="foot"{st}>' + ''.join(items) + '</div>'


def cap(text, center=True, extra=''):
    c = 'text-align: center' + ('; ' + extra if extra else '')
    return f'<p class="cap muted" style="{c}">{text}</p>'


def spark(vals, w=120, h=32, color='var(--primary)', dash='', lo=1, hi=5, sw=2):
    pts, d, pen = [], '', False
    n = len(vals)
    step = (w - 4) / (n - 1)
    for i, v in enumerate(vals):
        if v is None:
            pen = False
            continue
        x = 2 + i * step
        y = (h - 3) - (v - lo) / (hi - lo) * (h - 6)
        d += (' L' if pen else ' M') + f'{x:.1f} {y:.1f}'
        pen = True
    da = f'; stroke-dasharray: {dash}' if dash else ''
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true" style="flex: none">'
            f'<line x1="0" x2="{w}" y1="{(h - 3) - (3 - lo) / (hi - lo) * (h - 6):.1f}" y2="{(h - 3) - (3 - lo) / (hi - lo) * (h - 6):.1f}" style="stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 3"></line>'
            f'<path d="{d.strip()}" style="fill: none; stroke: {color}; stroke-width: {sw}; stroke-linecap: round; stroke-linejoin: round{da}"></path></svg>')


def sheet(title, inner, close='Agenda.dc.html', footer='', behind='', tid='sh', maxh=760):
    return f"""<div class="app">
  {behind}
  <div class="scrim">
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="{tid}" style="max-height: {maxh}px; display: flex; flex-direction: column">
      <div class="grab" aria-hidden="true"></div>
      <div class="between" style="padding: 8px 12px 0 20px">
        <h1 id="{tid}" class="t2">{title}</h1>
        <a class="ib" href="{close}" aria-label="Cerrar">{icon('x', 22)}</a>
      </div>
      <div class="col" style="gap: 16px; padding: 12px 20px 16px; overflow: auto">
        {inner}
      </div>
      {('<div style="padding: 8px 20px 34px; display: flex; flex-direction: column; gap: 10px">' + footer + '</div>') if footer else '<div style="height: 26px"></div>'}
    </div>
  </div>
</div>"""


def dialog(title, text, actions, ic=None, ictone='danger', extra='', behind='', tid='dl'):
    i = ''
    if ic:
        bg = {'danger': 'var(--danger-bg); color: var(--danger-ink)', 'brand': 'var(--brand); color: var(--primary)',
              'warn': 'var(--routine-bg); color: var(--routine-fg)', 'sol': 'var(--accent); color: var(--on-accent)'}[ictone]
        i = f'<div class="av s40" style="border-radius: 12px; background: {bg}">{icon(ic, 22)}</div>'
    return f"""<div class="app">
  {behind}
  <div class="scrim center">
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="{tid}" aria-describedby="{tid}-d">
      {i}
      <div class="col" style="gap: 6px">
        <h1 id="{tid}" class="t2">{title}</h1>
        <p id="{tid}-d" class="muted">{text}</p>
      </div>
      {extra}
      <div class="col" style="gap: 10px">{actions}</div>
    </div>
  </div>
</div>"""


def behind_title(t):
    return f'<div style="padding: 58px 20px 0; opacity: .5" aria-hidden="true"><p class="t1">{t}</p></div>'


def toggle_script(state, body):
    """Script con estado inicial `state` (dict JSON) y cuerpo de renderVals."""
    import json
    return ("class Component extends DCLogic {\n  constructor(props) {\n    super(props);\n    this.state = "
            + json.dumps(state, ensure_ascii=False) + ";\n  }\n  renderVals() {\n" + body + "\n  }\n}")


def symbol(h=64, ink='#0F2A29', dot='#F2B441', label='Kitom'):
    w = round(h * 46 / 53, 1)
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 46 53" role="img" aria-label="{label}"><g transform="translate(-12.5 -5.5)">'
            f'<g fill="none" stroke="{ink}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 9V55"></path>'
            f'<path d="M16 37.5L35.8 14Q40.6 8.6 42.4 15.2L43.2 26.5"></path><path d="M26.5 26Q38.5 39 43.2 48.8Q46.3 55.3 52.3 52.2Q56.4 49.8 54.2 45"></path></g>'
            f'<circle cx="52.5" cy="13" r="4.4" fill="{dot}"></circle></g></svg>')


def dots(n, of=3):
    return '<div class="dots" role="img" aria-label="Paso %d de %d">' % (n, of) + ''.join(
        '<i class="on"></i>' if i == n else '<i></i>' for i in range(1, of + 1)) + '</div>'


GOOGLE = ('<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3z"></path>'
          '<path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22z"></path>'
          '<path fill="#FBBC05" d="M6.4 14c-.2-.6-.3-1.3-.3-2s.1-1.4.3-2V7.4H3.1a10 10 0 0 0 0 9.2z"></path>'
          '<path fill="#EA4335" d="M12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.4L6.4 10C7.2 7.7 9.4 6 12 6z"></path></svg>')

BOARDS = []


def reg(sec, file, title, html, interactive=True, w=390, h=844, note=None):
    BOARDS.append(dict(sec=sec, file=file, title=title, html=html, interactive=interactive, w=w, h=h))


def sw(on_hole, label_id, toggle_hole):
    """Interruptor accesible ligado a estado: on_hole = nombre booleano, toggle_hole = handler."""
    return (f'<button class="swbtn" role="switch" aria-checked="{H(on_hole)}" aria-labelledby="{label_id}" onClick="{H(toggle_hole)}">'
            f'<span class="{H(on_hole + "Cls")}"></span></button>')


def sw_static(on, label_id):
    return f'<span class="switch{" on" if on else ""}" role="switch" aria-checked="{"true" if on else "false"}" aria-labelledby="{label_id}"></span>'
