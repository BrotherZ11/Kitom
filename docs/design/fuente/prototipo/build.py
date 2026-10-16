import json, os, re, shutil, sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import lib
import s0_sys, s1_auth, s2_onb, s3_pets, s4_home, s5_log, s6_hist, s7_ai, s8_agenda, s9_s12  # noqa: F401  (registran pantallas)

OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), 'prototipo')
os.makedirs(OUT, exist_ok=True)

B = lib.BOARDS
names = [b['file'] for b in B]
dup = {n for n in names if names.count(n) > 1}
assert not dup, dup

# Mapa con el inventario completo
for b in B:
    if b['file'] == 'Mapa.dc.html':
        b['html'] = s0_sys.make_map(B)

NOTES = {
    'sys': 'Componentes con todos sus estados (normal, seleccionado, deshabilitado, cargando, error, éxito) y mapa navegable: cada fila del mapa abre su pantalla.\nTokens nuevos de gráfica: actividad #6B7A1F / #B9C46A y sueño #7B5EA7 / #C2A8E8 (contraste AA sobre fondo claro y oscuro).',
    'auth': 'Orden: Bienvenida → Cómo funciona → Crear cuenta. El aviso veterinario pasa a después de crear la cuenta porque su aceptación se guarda en el perfil (profiles.disclaimer_accepted_at).\nGoogle y email existen en el código; teléfono con código (1.7–1.8) es diseño, pendiente en Auth.\nTransición: deslizamiento horizontal 200 ms.',
    'onb': 'Tres pasos con indicador: Tu perfil → Aviso veterinario (obligatorio, casilla) → Privacidad (comunicaciones opcionales, desactivadas por defecto).\nEl idioma se elige en una hoja (es activo, en marcado como próximamente). La zona horaria se toma del dispositivo.',
    'pets': 'Perfil mínimo: nombre + especie (perro o gato; «Otro» se explica y no deja continuar). Foto opcional con permiso del sistema explicado antes.\nEl resto del perfil (raza, nacimiento, peso, sexo, esterilización, condiciones, alergias, carácter) se completa después.\nCambio de mascota: toca el nombre en la cabecera.',
    'home': 'Seis estados: nuevo, día pendiente, día hecho, oscuro, con alerta (veterinario pronto) y pocos datos.\nComo mucho una tarjeta de señal; si es urgente sustituye al bloque del día. La voz de la mascota es opcional (Ajustes).\n«Consultar» en la cabecera abre la orientación con foto.',
    'log': 'Ruta estándar ≈ 25 s: cuatro escalas (energía, apetito, ánimo, actividad) → Guardar. «Todo como siempre» rellena en un toque. Detalles opcionales sin bloquear.\nEstados: guardado, edición de hoy y de días anteriores, error con datos conservados, salir sin guardar, sin conexión, conflicto entre dispositivos y sincronizado.\nOffline y conflictos: diseño; en código el guardado sigue siendo online.',
    'hist': 'Semana y mes. Cinco series (energía, apetito, ánimo, actividad, sueño), máximo tres a la vez; comparación con pequeños múltiplos. Huecos sin interpolar.\nMensajes prudentes: «parece», «en comparación con su semana habitual», nunca causas.\nPlan gratuito: [LÍMITE] días; lo anterior difuminado con invitación sobria.',
    'ai': 'Consentimiento de foto antes de la primera foto (mejorar el modelo, desactivado por defecto). Foto opcional + síntomas del catálogo.\nLa IA la llama el servidor (Edge Function pendiente); la app solo muestra el estado.\nCuatro niveles con color, icono y texto. Disclaimer en cada resultado. «¿Te ha sido útil?» sí/no con comentario. En urgente, primero llamar; la valoración se pide más tarde.',
    'agenda': 'Tipos: vacuna, medicación, cita, baño, desparasitación, otro. Repetición: nunca, diaria, semanal, mensual, anual. Adjunto opcional.\nMarcar hecho con un toque (se puede deshacer). Vencidos arriba, sin rojo de error.\nAjustes de avisos con estado de permiso denegado y botón a los ajustes del sistema.',
    'bond': 'MVP: racha, progreso semanal, cuatro insignias del catálogo, detalle y celebración (el punto de hoy se rellena; sin confeti).\nFuturo (marcado): retos semanales.\nVoz de la mascota: interruptor en Logros y en Ajustes.',
    'settings': 'Cuenta, seguridad (contraseña, métodos de acceso), consentimientos, fotos, exportar, ayuda, legal, versión y cerrar sesión.\nEliminar cuenta: lista explícita de lo que se borra y sugerencia de exportar antes; foco inicial en Cancelar.\nExportar e informe PDF dependen de Edge Functions pendientes.',
    'premium': 'Comparativa Gratis/Premium honesta: funciones futuras marcadas «Pronto». Precio y límites como [PRECIO] / [LÍMITE].\nMensual y anual con el precio total a la vista; cierre siempre visible; renovación y cancelación explicadas antes de pagar.\nRestaurar compras y gestionar en la tienda del sistema. RevenueCat pendiente.',
    'global': 'Carga con esqueleto tras 300 ms, sin conexión (se puede seguir registrando), error de carga con reintento y sesión caducada.\nEl resto de estados (vacíos, permisos, confirmaciones, borrados, errores de formulario, éxito, pendiente de sincronizar, bloqueo por plan) viven en su sección.',
}

ROW_MAX = 8
GAP = 80
TITLE_GAP = 240
ROW_GAP = 176

boards, order, notes = {}, [], {}
y = 60
for i, (key, title) in enumerate(s0_sys.SECTIONS):
    items = [b for b in B if b['sec'] == key]
    if not items:
        continue
    rows = [items[j:j + ROW_MAX] for j in range(0, len(items), ROW_MAX)]
    maxw = 0
    notes[f't{i}'] = {'x': 0, 'y': y, 'text': title, 'kind': 'title1', 'maxW': 3200}
    y += TITLE_GAP
    for r, row in enumerate(rows):
        x = 0
        h = max(b['h'] for b in row)
        for b in row:
            boards[b['file']] = {'x': x, 'y': y, 'w': b['w'], 'h': b['h'], 'title': b['title'],
                                 'is_interactive': True, 'radius': 0 if b['w'] > 390 else 44}
            order.append(b['file'])
            x += b['w'] + GAP
        if r == 0:
            notes[f's{i}'] = {'x': x, 'y': y, 'w': 380, 'text': NOTES[key], 'fill': 'teal'}
        maxw = max(maxw, x)
        y += h + (GAP if r < len(rows) - 1 else 0)
    y += ROW_GAP

base = json.load(open(os.path.join(HERE, 'base', 'canvas.base.json')))
canvas = {k: base[k] for k in ('v', 'createdOnFiles', 'title', 'launch', 'pages')}
canvas.update(boards=boards, order=order, notes=notes, designSystems=base['designSystems'])
canvas['launch'] = {'view': 'canvas'}

# Escribir
for f in os.listdir(OUT):
    if f.endswith('.dc.html'):
        os.remove(os.path.join(OUT, f))
for b in B:
    open(os.path.join(OUT, b['file']), 'w').write(b['html'])
css = open(os.path.join(HERE, 'base', 'kitom.base.css')).read().rstrip() + '\n\n/* ---- v2: pantallas completas ---- */\n' + open(os.path.join(HERE, 'extra.css')).read()
open(os.path.join(OUT, 'kitom.css'), 'w').write(css)
json.dump(canvas, open(os.path.join(OUT, 'canvas.json'), 'w'), ensure_ascii=False, indent=1)

# Comprobaciones ligeras (sin renderizar)
VOID = {'meta', 'link', 'br', 'img', 'input', 'hr', 'source', 'area', 'base', 'col', 'wbr', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'stop', 'use'}


class Bal(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.st, self.err = [], []

    def handle_starttag(self, t, a):
        if t not in VOID:
            self.st.append(t)

    def handle_startendtag(self, t, a):
        pass

    def handle_endtag(self, t):
        if t in VOID:
            return
        if self.st and self.st[-1] == t:
            self.st.pop()
        else:
            self.err.append(f'</{t}> vs {self.st[-3:]}')
            if t in self.st:
                while self.st and self.st.pop() != t:
                    pass


files = set(names)
problems = []
bad_words = re.compile(r'diagn[oó]stic', re.I)
for b in B:
    h = b['html']
    p = Bal()
    p.feed(h)
    if p.err or p.st:
        problems.append((b['file'], 'balance', p.err[:3], p.st[-3:]))
    for m in re.findall(r'href="([A-Za-z]+\.dc\.html)"', h):
        if m not in files:
            problems.append((b['file'], 'link', m))
    for m in re.findall(r'<dc-import name="([A-Za-z]+)"', h):
        if m + '.dc.html' not in files:
            problems.append((b['file'], 'import', m))
    for m in re.findall(r'\{\{\s*([^}]*?)\s*\}\}', h):
        if not re.fullmatch(r'[A-Za-z_][\w]*(\.[\w]+)*|true|false|-?\d+', m):
            problems.append((b['file'], 'hole', m))
    body = re.sub(r'<script.*?</script>', '', h, flags=re.S)
    if bad_words.search(h):
        problems.append((b['file'], 'copy: diagnóstico'))
    if '<script src="./support.js"></script>' not in h:
        problems.append((b['file'], 'support.js'))

print(len(B), 'pantallas;', sum(len(open(os.path.join(OUT, f)).read()) for f in os.listdir(OUT)) // 1024, 'KB')
for pr in problems:
    print('PROBLEMA', pr)
