from lib import *

SEC = 'home'


def next_reminder(empty=False, days7=False):
    if empty:
        msg = 'Nada en los próximos 7 días.' if days7 else 'Su agenda está vacía.'
        return f"""<div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Próximo</h2><a class="link" href="Agenda.dc.html" style="font-size: 14px">Ver agenda</a></div>
      <a class="card flat" href="Recordatorio.dc.html" style="flex-direction: row; align-items: center; gap: 12px; text-decoration: none; color: inherit">
        <span class="ico" style="width: 36px; height: 36px; border-radius: 10px; background: var(--sunken); color: var(--muted); display: flex; align-items: center; justify-content: center; flex: none">{icon('calendar')}</span>
        <span class="col grow" style="gap: 0"><span>{msg}</span><span class="cap muted">Añade una vacuna, una cita o su medicación.</span></span>
        <span class="link" style="font-size: 14px">Añadir</span>
      </a>
    </div>"""
    return f"""<div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Próximo</h2><a class="link" href="Agenda.dc.html" style="font-size: 14px">Ver agenda</a></div>
      <div class="list">{li('Desparasitación interna', 'Sábado 18 · 10:00', 'pill', href='RecordatorioDetalle.dc.html')}</div>
    </div>"""


def day_card_pending(text='Unos 40 segundos. Kika lleva 5 días esta semana.', days=('on', 'on', 'off', 'on', 'on', 'on'), n='5/7',
                     title='Falta el registro de hoy', cta='Registrar el día'):
    return f"""<div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px; align-items: center">
        {ring(list(days), 'pending', n, n.replace('/', ' de ') + ' días registrados esta semana; hoy pendiente')}
        <div class="col grow" style="gap: 4px"><h1 class="t2">{title}</h1><p class="muted">{text}</p></div>
      </div>
      <a class="btn primary" href="Registro.dc.html">{cta}</a>
    </div>"""


def week_summary():
    rows = [('Energía', [4, 4, None, 3, 3, 3, 4], 'var(--c-energy)', '', 'Como siempre'),
            ('Apetito', [3, 3, None, 2, 2, 2, 3], 'var(--c-appetite)', '5 3', 'Vuelve a lo habitual'),
            ('Ánimo', [4, 4, None, 3, 4, 3, 4], 'var(--c-mood)', '1 3', 'Bien')]
    r = ''.join(f'<a class="sm-row" href="Tendencias.dc.html"><span class="col grow" style="gap: 0"><span class="label">{t}</span><span class="cap muted">{w}</span></span>{spark(v, 112, 30, c, d)}</a>' for t, v, c, d, w in rows)
    return f"""<div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Su semana</h2><a class="link" href="Tendencias.dc.html" style="font-size: 14px">Ver historial</a></div>
      <div class="list">{r}</div>
    </div>"""


# 4.1 Usuario nuevo (primer día, sin historial ni agenda)
reg(SEC, 'HomeNuevo.dc.html', '4.1 Hoy · usuario nuevo', page('Hoy · usuario nuevo', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head()}
    <p class="t2" style="margin-top: -4px">Hola, David</p>
    <div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px; align-items: center">
        {ring(['off'] * 6, 'pending', '0/7', 'Semana vacía; hoy pendiente')}
        <div class="col grow" style="gap: 4px"><h1 class="t2">Empieza la semana de Kika</h1><p class="muted">Su primer registro, en unos 40 segundos.</p></div>
      </div>
      <a class="btn primary" href="Registro.dc.html">Hacer el primer registro</a>
    </div>
    <div class="card flat" style="gap: 10px">
      <div class="between"><p class="strong">Así verás su evolución</p><span class="data muted">0/3</span></div>
      <div class="bar" aria-hidden="true"><i style="width: 0%"></i></div>
      <p class="cap muted">Con 3 registros empezarás a ver sus tendencias. Con unas semanas, Kitom sabrá qué es lo normal en Kika.</p>
    </div>
    {next_reminder(empty=True)}
  </div>
  {tabbar('hoy')}
</div>"""))

# 4.2 Día pendiente con señal «Observar»
reg(SEC, 'Home.dc.html', '4.2 Hoy · día pendiente con señal', page('Hoy · día pendiente', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head()}
    {day_card_pending()}
    <div class="card" style="gap: 10px">
      <div class="between">{utag('observe')}<span class="cap muted">Desde el lunes</span></div>
      <p class="t3">Kika ha comido menos estos 3 días</p>
      <p class="muted">Puede ser algo pasajero. Añade detalles en el registro o mira cómo ha ido su apetito.</p>
      <div class="row" style="gap: 16px; flex-wrap: wrap">
        <a class="link row" href="Tendencias.dc.html" style="gap: 6px">Ver su apetito{icon('chev-r', 18)}</a>
        <a class="link row" href="ConsultaIntro.dc.html" style="gap: 6px">Ver posibles causas{icon('chev-r', 18)}</a>
      </div>
    </div>
    {next_reminder()}
  </div>
  {tabbar('hoy')}
</div>"""))

# 4.3 Día registrado (voz de la mascota, resumen, recomendación)
HH_SCRIPT = """class Component extends DCLogic {
  renderVals() {
    const dark = this.props.dark ?? false;
    return { appCls: dark ? 'app dark' : 'app', voice: this.props.petVoice ?? true, synced: this.props.synced ?? false };
  }
}"""
reg(SEC, 'HomeHecho.dc.html', '4.3 Hoy · día registrado', page('Hoy · día registrado', f"""
<div class="{H('appCls')}">
  <div class="scr" style="gap: 20px">
    {pet_head()}
    <div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px; align-items: center">
        {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'done', '6/7', '6 de 7 días registrados, hoy incluido')}
        <div class="col grow" style="gap: 4px"><h1 class="t2">Hecho por hoy</h1><p class="muted">Kika lleva 6 de 7 días esta semana y 4 seguidos.</p></div>
      </div>
      <div class="kv">
        <div><span class="cap muted">Energía</span><span class="label">Más</span></div>
        <div><span class="cap muted">Apetito</span><span class="label">Normal</span></div>
        <div><span class="cap muted">Ánimo</span><span class="label">Bien</span></div>
        <div><span class="cap muted">Actividad</span><span class="label">Normal</span></div>
      </div>
      <a class="btn secondary md" href="RegistroHoyEditar.dc.html">Editar el registro de hoy</a>
    </div>
    <sc-if value="{H('voice')}" hint-placeholder-val="{{{{ true }}}}">
      <div class="voice"><div class="av s32 warm" style="background: var(--surface)">K</div><p>«Hoy he comido un poco más. ¿Mañana paseo largo?»</p></div>
    </sc-if>
    {week_summary()}
    <div class="card warm" style="gap: 6px; color: var(--ink)">
      <p class="over" style="color: var(--warm-ink)">Idea para hoy</p>
      <p class="strong">Un juego de olfato después de cenar</p>
      <p class="cap" style="color: var(--warm-ink)">Esconde unos premios por el salón. A muchos perros les ayuda a relajarse cuando hay ruidos fuera.</p>
    </div>
    {next_reminder()}
  </div>
  <sc-if value="{H('synced')}" hint-placeholder-val="{{{{ false }}}}">
    <div class="toast" role="status">{icon('cloud-ok', 20)}El registro de hoy ya está subido</div>
  </sc-if>
  {tabbar('hoy', done=True)}
</div>""", props={'dark': {'editor': 'boolean', 'default': False}, 'petVoice': {'editor': 'boolean', 'default': True},
                  'synced': {'editor': 'boolean', 'default': False}}, script=HH_SCRIPT))

# 4.4 Tema oscuro
reg(SEC, 'HomeOscuro.dc.html', '4.4 Hoy · tema oscuro', page('Hoy · tema oscuro',
    '<dc-import name="HomeHecho" dark="{{ true }}" pet-voice="{{ true }}" hint-size="390px,844px"></dc-import>', bodybg='#0C1918'))

# 4.5 Con alerta relevante (consultar veterinario pronto): la acción veterinaria manda
reg(SEC, 'HomeAlerta.dc.html', '4.5 Hoy · con alerta relevante', page('Hoy · con alerta', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head()}
    <div class="card" style="gap: 12px; box-shadow: inset 0 0 0 1.5px var(--vet-fg)">
      <div class="between">{utag('vet')}<span class="cap muted">Desde el martes</span></div>
      <p class="t2">Pide cita para revisar el ojo de Kika</p>
      <p class="muted">La orientación del martes aconsejaba consultar si no mejoraba en 48 horas. Hoy lo has registrado igual.</p>
      <a class="btn primary" href="tel:+34000000000">{icon('phone', 20)}Llamar a mi clínica</a>
      <div class="row" style="gap: 16px; flex-wrap: wrap">
        <a class="link row" href="ResultadoPronto.dc.html" style="gap: 6px">Ver la orientación{icon('chev-r', 18)}</a>
        <a class="link row" href="Recordatorio.dc.html" style="gap: 6px">Añadir la cita{icon('chev-r', 18)}</a>
      </div>
    </div>
    <div class="card" style="flex-direction: row; align-items: center; gap: 14px">
      {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'pending', '5/7', '5 de 7 días; hoy pendiente', 64, 6, fs=12)}
      <div class="col grow" style="gap: 2px"><p class="strong">Falta el registro de hoy</p><p class="cap muted">Anota cómo ves el ojo.</p></div>
      <a class="btn secondary sm" href="Registro.dc.html">Registrar</a>
    </div>
    {next_reminder()}
  </div>
  {tabbar('hoy')}
</div>"""))

# 4.6 Pocos datos, racha nueva y sin recordatorios próximos
reg(SEC, 'HomePocos.dc.html', '4.6 Hoy · pocos datos y sin agenda', page('Hoy · pocos datos', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head()}
    {day_card_pending('Ayer no hubo registro. Empezáis otra racha hoy.', ('off', 'off', 'off', 'on', 'on', 'off'), '2/7', 'Falta el registro de hoy')}
    <div class="card flat" style="gap: 10px">
      <div class="between"><p class="strong">Casi podrás ver sus tendencias</p><span class="data muted">2/3</span></div>
      <div class="bar" aria-hidden="true"><i style="width: 66%"></i></div>
      <p class="cap muted">Con el registro de hoy verás cómo evolucionan su energía, apetito y ánimo.</p>
    </div>
    {next_reminder(empty=True, days7=True)}
  </div>
  {tabbar('hoy')}
</div>"""))
