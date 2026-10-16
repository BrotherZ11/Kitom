from lib import *

# =============================================================== 0 · Sistema: componentes y mapa
SEC = 'sys'
WIDE = 'width: 1280px; height: auto; min-height: 100%'


def block(title, inner, span=1, note=''):
    n = f'<p class="cap muted">{note}</p>' if note else ''
    return (f'<section class="card col" style="gap: 14px; padding: 20px; grid-column: span {span}">'
            f'<h2 class="t3">{title}</h2>{n}{inner}</section>')


def lab(t):
    return f'<span class="cap muted" style="min-width: 92px">{t}</span>'


def rowc(*items, gap=10):
    return f'<div class="row" style="gap: {gap}px; flex-wrap: wrap; align-items: center">' + ''.join(items) + '</div>'


def bx(w, inner):
    return f'<div style="width: {w}px">{inner}</div>'


def comp_body(dark=False):
    d = ' dark' if dark else ''
    buttons = block('Botones', ''.join([
        rowc(lab('Principal'), bx(200, btn('Guardar el día', '#')), bx(200, f'<span class="btn primary loading" role="status"><span class="spinner"></span>Guardando…</span>'), bx(200, '<span class="btn disabled" aria-disabled="true">Guardar el día</span>')),
        rowc(lab('Secundario'), bx(200, btn('Añadir detalles', '#', 'secondary')), bx(200, btn('Ver tendencias', '#', 'ghost')), bx(200, btn('Eliminar', '#', 'danger'))),
        rowc(lab('Compactos'), f'<a class="btn secondary sm" href="#">{icon("camera", 18)}Consultar</a>', '<a class="btn primary sm" href="#">Reintentar</a>', '<a class="btn ghost sm" href="#">Deshacer</a>'),
        rowc(lab('Urgencia'), f'<div style="background: var(--urgent); padding: 12px; border-radius: 14px; width: 420px" class="row">{bx(190, btn("Llamar a mi clínica", "#", "urgent", "phone"))}<span style="width: 12px"></span>{bx(190, btn("Ver qué hacer", "#", "onurgent"))}</div>'),
    ]), 2, 'Alto 52 (md 44, sm 36). Un solo primario por pantalla. Cargando: spinner + verbo en gerundio, el botón no cambia de tamaño. Deshabilitado solo cuando falta algo obligatorio, y se explica al lado.')

    fields = block('Campos', ''.join([
        '<div class="field"><label>Email</label><div class="input">kika@ejemplo.com</div></div>',
        '<div class="field"><label>Email · enfocado</label><div class="input focus">kika@ejemp|</div></div>',
        f'<div class="field"><label>Contraseña · error</label><div class="input error">••••••</div><p class="err row" style="gap: 6px">{icon("alert-c", 16)}Mínimo 8 caracteres.</p></div>',
        f'<div class="field"><label>Código · correcto</label><div class="input ok">482 913</div><p class="okmsg">{icon("check", 16)}Código verificado</p></div>',
        '<div class="field"><label>Especie · bloqueado</label><div class="input off">Perro</div><p class="help">La especie no se puede cambiar.</p></div>',
    ]), 1, 'Etiqueta siempre visible encima; error en el propio campo con icono y texto (nunca solo color).')

    sel = block('Selección', ''.join([
        rowc(lab('Escala 1–5'), '<div class="steps" style="width: 300px"><span class="step">1</span><span class="step">2</span><span class="step on">3</span><span class="step">4</span><span class="step">5</span></div>'),
        rowc(lab('Tres opciones'), '<div class="seg three" style="width: 300px"><span>Menos</span><span class="on">Normal</span><span>Más</span></div>'),
        rowc(lab('Chips'), '<div class="chips"><span class="chip on">' + icon('check', 16) + 'Visita al veterinario</span><span class="chip">Cambio en casa</span><span class="chip" style="opacity: .45" aria-disabled="true">Máx. 3 series</span></div>'),
        rowc(lab('Interruptor'), sw_static(True, 'x'), '<span class="cap">Activado</span>', sw_static(False, 'x'), '<span class="cap">Desactivado</span>'),
        rowc(lab('Casilla / radio'), f'<span class="box on">{icon("check", 16, 3)}</span>', '<span class="box"></span>', '<span class="radio on"></span>', '<span class="radio"></span>'),
    ]), 1, 'Objetivo táctil ≥ 44 px. Tocar un paso elegido lo deselecciona (registro). Seleccionado = fondo laguna, nunca solo un borde.')

    tags = block('Etiquetas y niveles', ''.join([
        rowc(utag('observe'), utag('routine')),
        rowc(utag('vet'), utag('urgent')),
        rowc('<span class="tag success">' + icon('check', 16) + 'Guardado</span>', '<span class="tag neutral">Pendiente de enviar</span>', '<span class="tag sol">Hoy</span>', '<span class="tag brand">Premium</span>', '<span class="tmark">Próximamente</span>'),
    ]), 1, 'Los cuatro colores de urgencia se reservan para la orientación veterinaria. Siempre icono + texto.')

    alerts = block('Alertas y avisos', ''.join([
        alert('info', 'info', '', 'Esta orientación es informativa y no sustituye a un veterinario.', 'note'),
        alert('ok', 'check', 'Registro sincronizado', 'Los cambios de esta mañana ya están en tu cuenta.'),
        alert('warn', 'wifi-off', 'Sin conexión', 'Guardamos el registro en el móvil y lo enviaremos al volver.'),
        alert('bad', 'alert-c', 'No hemos podido guardar', 'Tus respuestas siguen aquí. Vuelve a intentarlo.', 'alert'),
    ]), 1)

    toasts = block('Avisos breves y banners', ''.join([
        f'<div class="banner">{icon("cloud-up", 20)}<span class="grow">1 registro pendiente de enviar</span><span class="spinner" style="color: var(--muted)"></span></div>',
        f'<div class="banner" style="background: var(--routine-bg); color: var(--routine-fg)">{icon("wifi-off", 20)}<span class="grow">Sin conexión. Puedes seguir registrando.</span></div>',
        f'<div class="toast" style="position: static">{icon("check", 20)}<span>Cambios guardados</span><a href="#">Deshacer</a></div>',
    ]), 1, 'Toast 4 s encima de la barra de pestañas, con «Deshacer» cuando la acción se puede revertir. Banner fijo bajo la cabecera mientras dure el estado.')

    ring_b = block('Anillo semanal y racha', rowc(
        '<div class="col" style="gap: 6px; align-items: center">' + ring(['on', 'on', 'gap', 'on', 'on', 'on'], 'pending', '4', 'Racha de 4 días, hoy pendiente', 96) + '<span class="cap muted">Hoy pendiente</span></div>',
        '<div class="col" style="gap: 6px; align-items: center">' + ring(['on', 'on', 'gap', 'on', 'on', 'on'], 'done', '5', 'Racha de 5 días, hoy registrado', 96) + '<span class="cap muted">Hoy hecho</span></div>',
        '<div class="col" style="gap: 6px; align-items: center">' + ring(['off'] * 6, 'pending', '0', 'Sin racha todavía', 96) + '<span class="cap muted">Primer día</span></div>',
        gap=24), 1, 'Seis segmentos (días anteriores) + punto sol (hoy). Un hueco no rompe el anillo: se ve, sin culpa.')

    badges_b = block('Insignias', rowc(
        f'<div class="col" style="gap: 6px; align-items: center"><span class="medal got">{icon("medal", 26)}</span><span class="cap muted">Ganada</span></div>',
        '<div class="col" style="gap: 6px; align-items: center"><span class="medal prog"><span class="data" style="font-size: 15px">4/7</span></span><span class="cap muted">En progreso</span></div>',
        f'<div class="col" style="gap: 6px; align-items: center"><span class="medal lock">{icon("lock", 22)}</span><span class="cap muted">Bloqueada</span></div>',
        gap=24), 1, 'Catálogo MVP: Primer registro, 7 días seguidos, Primera consulta con foto, Constancia mensual.')

    tabs_b = block('Barra de pestañas', ''.join([
        '<div style="width: 390px; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow)">' + tabbar('hoy') + '</div>',
        '<div style="width: 390px; border-radius: 16px; overflow: hidden; box-shadow: var(--shadow)">' + tabbar('hist', done=True) + '</div>',
    ]), 1, 'Registrar es una acción, no un destino: abre el registro a pantalla completa. Punto sol = hoy pendiente; «Hecho» cuando ya está.')

    states = block('Carga, vacío y error', rowc(
        '<div class="col" style="gap: 8px; width: 170px"><span class="sk" style="height: 18px; width: 60%"></span><span class="sk" style="height: 64px"></span><span class="sk" style="height: 14px; width: 80%"></span><span class="cap muted">Esqueleto</span></div>',
        f'<div class="empty" style="width: 200px"><span class="ill">{icon("calendar", 30)}</span><span class="strong">Nada en la agenda</span><span class="cap muted">Añade la próxima vacuna o una medicación.</span></div>',
        f'<div class="empty" style="width: 200px"><span class="ill" style="background: var(--danger-bg); color: var(--danger-ink)">{icon("wifi-off", 30)}</span><span class="strong">No hemos podido cargar</span><span class="cap muted">Comprueba la conexión.</span></div>',
        gap=20), 1, 'Esqueleto tras 300 ms; spinner solo dentro de botones. Animaciones desactivadas con «reducir movimiento».')

    overlays = block('Hoja y diálogo', rowc(
        f'<div class="sheet" style="width: 300px; padding: 0 0 18px"><div class="grab" aria-hidden="true"></div><div class="col" style="gap: 10px; padding: 8px 18px 0"><span class="t3">Hoja inferior</span><span class="cap muted">Selecciones y formularios cortos. Se cierra deslizando o con X.</span><span class="btn primary md">Guardar</span></div></div>',
        f'<div class="dialog" style="width: 300px"><div class="av s40" style="border-radius: 12px; background: var(--danger-bg); color: var(--danger-ink)">{icon("trash", 22)}</div><span class="t3">¿Eliminar el recordatorio?</span><span class="cap muted">Diálogo para acciones que no se pueden deshacer. Botón destructivo explícito.</span><span class="btn danger md">Eliminar</span><span class="btn ghost md">Cancelar</span></div>',
        gap=20), 2)

    return f"""<div class="app{d}" style="{WIDE}">
  <div class="col" style="gap: 20px; padding: 40px">
    <div class="between"><div class="col" style="gap: 4px"><p class="over">Kitom · Ritmo · v2</p><h1 class="display">Componentes y estados</h1></div>
    <p class="cap muted" style="max-width: 420px; text-align: right">Todo sale de kitom.css (los mismos tokens que tokens.ts). Contenido de ejemplo ficticio.</p></div>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; align-items: start">
      {buttons}{fields}
      {sel}{tags}{alerts}
      {toasts}{ring_b}{badges_b}
      {tabs_b}{states}
      {overlays}
    </div>
  </div>
</div>"""


reg(SEC, 'Componentes.dc.html', '0.1 Componentes y estados', page('Componentes y estados', comp_body(), w=1280, h=2140), w=1280, h=2140)


# ---------------------------------------------------------------- mapa de navegación (se genera con el inventario completo)
SECTIONS = [
    ('sys', '0 · Sistema'), ('auth', '1 · Arranque y cuenta'), ('onb', '2 · Configuración inicial y consentimientos'),
    ('pets', '3 · Mascotas'), ('home', '4 · Hoy'), ('log', '5 · Registro diario (< 45 s)'),
    ('hist', '6 · Historial y evolución'), ('ai', '7 · Orientación con foto y síntomas'),
    ('agenda', '8 · Agenda y recordatorios'), ('bond', '9 · Logros y vínculo'),
    ('settings', '10 · Perfil de usuario y ajustes'), ('premium', '11 · Suscripción y Premium'), ('global', '12 · Estados globales'),
]


def make_map(boards):
    cards = []
    for key, title in SECTIONS[1:]:
        items = [b for b in boards if b['sec'] == key]
        links = ''.join(f'<a class="li" href="{b["file"]}" style="min-height: 36px; padding: 6px 12px"><span class="cap grow">{b["title"]}</span></a>' for b in items)
        cards.append(f'<section class="card col" style="gap: 8px; padding: 16px"><h2 class="t3">{title}</h2>'
                     f'<div class="list" style="box-shadow: none; background: var(--bg)">{links}</div></section>')
    tabs = ''.join(f'<div class="col" style="gap: 4px; align-items: center; padding: 14px; border-radius: 14px; background: {bg}; color: {fg}; flex: 1">'
                   f'{icon(ic, 22)}<span class="strong">{t}</span><span class="cap" style="text-align: center">{s}</span></div>'
                   for ic, t, s, bg, fg in [
                       ('home', 'Hoy', 'Mascota activa, día, próxima tarea, una señal como mucho', 'var(--surface)', 'var(--ink)'),
                       ('chart', 'Historial', 'Semana · mes · días · alertas', 'var(--surface)', 'var(--ink)'),
                       ('plus', 'Registrar', 'Acción central: abre el registro de hoy a pantalla completa', 'var(--primary)', 'var(--on-primary)'),
                       ('calendar', 'Agenda', 'Recordatorios: lista y mes', 'var(--surface)', 'var(--ink)'),
                       ('user', 'Perfil', 'Mascota, logros, consultas, ajustes de cuenta', 'var(--surface)', 'var(--ink)')])
    body = f"""<div class="app" style="{WIDE}">
  <div class="col" style="gap: 20px; padding: 40px">
    <div class="between"><div class="col" style="gap: 4px"><p class="over">Kitom · arquitectura de navegación</p><h1 class="display">Mapa de pantallas</h1></div>
    <p class="cap muted" style="max-width: 460px; text-align: right">Cada fila abre su pantalla. {len(boards)} pantallas y estados. Diseño, no implementación: ver PANTALLAS.md para lo que existe en código. Contenido de ejemplo ficticio.</p></div>
    <div class="card col" style="gap: 12px; padding: 20px">
      <h2 class="t3">Barra de pestañas</h2>
      <div class="row" style="gap: 10px; align-items: stretch">{tabs}</div>
      <p class="cap muted">La orientación con foto no es una pestaña: se abre con «Consultar» en la cabecera de Hoy, desde las tarjetas de señal, desde Alertas y desde el perfil de la mascota. El cambio de mascota está en la cabecera (toca el nombre). Ajustes de cuenta: rueda en Perfil.</p>
    </div>
    <div class="card col" style="gap: 8px; padding: 20px">
      <h2 class="t3">Primer uso</h2>
      <p class="cap">Bienvenida → Cómo funciona → Crear cuenta (Google · email · teléfono) → Verificar email o código → Tu perfil → Aviso veterinario (obligatorio) → Privacidad → Primera mascota → Mascota creada (recordatorio diario) → Permiso de avisos → Primer registro → Hoy</p>
    </div>
    <div style="display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; align-items: start">
      {''.join(cards)}
    </div>
  </div>
</div>"""
    return page('Mapa de pantallas', body, w=1280, h=MAP_H)


MAP_H = 2000
reg(SEC, 'Mapa.dc.html', '0.2 Mapa de navegación', '', w=1280, h=MAP_H)
