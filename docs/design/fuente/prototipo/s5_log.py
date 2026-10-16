from lib import *

SEC = 'log'

REL = "['Mucho menos', 'Menos', 'Como siempre', 'Más', 'Mucho más']"
QUA = "['Muy mal', 'Mal', 'Normal', 'Bien', 'Muy bien']"

# Escalas: energía, apetito y actividad son relativas a lo habitual; ánimo es calidad (igual que el frontend: i18n dailyLogs.scale)
LOG_SCRIPT = """class Component extends DCLogic {
  constructor(props) {
    super(props);
    const v = this.props.values ?? null;
    this.state = v ? { energy: v[0], appetite: v[1], mood: v[2], activity: v[3] } : { energy: 4, appetite: null, mood: null, activity: null };
  }
  renderVals() {
    const REL = %s;
    const QUA = %s;
    const defs = [
      { id: 'energy', label: 'Energía', words: REL, low: 'Mucho menos', high: 'Mucho más' },
      { id: 'appetite', label: 'Apetito', words: REL, low: 'Mucho menos', high: 'Mucho más' },
      { id: 'mood', label: 'Ánimo', words: QUA, low: 'Muy mal', high: 'Muy bien' },
      { id: 'activity', label: 'Actividad', words: REL, low: 'Mucho menos', high: 'Mucho más' }
    ];
    const metrics = defs.map((d) => {
      const v = this.state[d.id];
      return {
        ...d,
        current: v ? d.words[v - 1] : 'Sin indicar',
        steps: [1, 2, 3, 4, 5].map((n) => ({
          n, on: v === n, cls: v === n ? 'step on' : 'step', aria: d.label + ': ' + d.words[n - 1],
          pick: () => this.setState({ [d.id]: v === n ? null : n })
        }))
      };
    });
    const done = defs.filter((d) => this.state[d.id]).length;
    return {
      metrics, done,
      pct: (done / 4) * 100 + '%%',
      progressLabel: done + ' de 4 respondidas',
      ready: done === 4, notReady: done !== 4,
      closeHref: done > 0 ? 'RegistroDescartar.dc.html' : 'Home.dc.html',
      allUsual: () => this.setState({ energy: 3, appetite: 3, mood: 3, activity: 3 }),
      saveHref: this.props.saveHref ?? 'RegistroGuardado.dc.html',
      title: this.props.title ?? 'Hoy, jueves 16',
      editing: this.props.editing ?? false,
      fresh: !(this.props.editing ?? false),
      historical: this.props.historical ?? false,
      failed: this.props.failed ?? false,
      saveLabel: (this.props.editing ?? false) ? 'Guardar cambios' : 'Guardar el día'
    };
  }
}""" % (REL, QUA)

LOG_BODY = f"""
<div class="app">
  <div class="scr" style="gap: 22px; padding-top: 54px">
    <div class="top">
      <a class="ib" href="{H('closeHref')}" aria-label="Cerrar">{icon('x', 24)}</a>
      <div class="col" style="gap: 0; align-items: center"><span class="strong">{H('title')}</span><span class="cap muted">Kika</span></div>
      <span class="data muted" style="width: 44px; text-align: right" aria-label="{H('progressLabel')}">{H('done')}/4</span>
    </div>
    <div class="bar" aria-hidden="true"><i style="width: {H('pct')}"></i></div>
    <sc-if value="{H('historical')}" hint-placeholder-val="{{{{ false }}}}">
      {alert('info', 'pencil', 'Estás editando un día anterior', 'Registrado por ti el miércoles a las 21:04.')}
    </sc-if>
    <sc-if value="{H('fresh')}" hint-placeholder-val="{{{{ true }}}}">
      <button class="chip" onClick="{H('allUsual')}" style="align-self: flex-start">{icon('check', 16)}Todo como siempre</button>
    </sc-if>
    <sc-for list="{H('metrics')}" as="m" hint-placeholder-count="4">
      <div class="metric" role="group" aria-label="{H('m.label')}">
        <div class="between"><h2 class="t3">{H('m.label')}</h2><span class="label muted">{H('m.current')}</span></div>
        <div class="steps">
          <sc-for list="{H('m.steps')}" as="s" hint-placeholder-count="5">
            <button class="{H('s.cls')}" aria-pressed="{H('s.on')}" aria-label="{H('s.aria')}" onClick="{H('s.pick')}">{H('s.n')}</button>
          </sc-for>
        </div>
        <div class="scale"><span>{H('m.low')}</span><span>{H('m.high')}</span></div>
      </div>
    </sc-for>
    <a class="li" href="RegistroDetalles.dc.html" style="border: 0; padding: 0; min-height: 48px"><span class="ico">{icon('plus')}</span><span class="col grow" style="gap: 0"><span class="strong">Añadir detalles</span><span class="cap muted">Sueño, vocalizaciones, algo raro, etiquetas o una nota</span></span>{icon('chev-r', 20, 2, 'color: var(--subtle)')}</a>
  </div>
  <div class="foot">
    <sc-if value="{H('failed')}" hint-placeholder-val="{{{{ false }}}}">
      {alert('bad', 'alert-c', 'No hemos podido guardar el registro', 'Lo que has marcado sigue aquí. Vuelve a intentarlo en un momento.', 'alert')}
    </sc-if>
    <sc-if value="{H('ready')}" hint-placeholder-val="{{{{ false }}}}"><a class="btn primary" href="{H('saveHref')}">{H('saveLabel')}</a></sc-if>
    <sc-if value="{H('notReady')}" hint-placeholder-val="{{{{ true }}}}"><span class="btn disabled" aria-disabled="true">{H('saveLabel')}</span></sc-if>
  </div>
</div>"""

LOG_PROPS = {'values': {'editor': None}, 'saveHref': {'editor': None}, 'title': {'editor': None},
             'editing': {'editor': 'boolean', 'default': False}, 'historical': {'editor': 'boolean', 'default': False},
             'failed': {'editor': 'boolean', 'default': False}}

# 5.1 Registro · estado inicial y selección
reg(SEC, 'Registro.dc.html', '5.1 Registro · bienestar', page('Registro de hoy', LOG_BODY, props=LOG_PROPS, script=LOG_SCRIPT))

# 5.2 Detalles opcionales (tres opciones → 2/3/4)
DET_SCRIPT = toggle_script({'sleep': 'Normal', 'voc': 'Más', 'soc': 'Normal', 'odd': True, 'tags': {}}, """    const seg = (key) => ['Menos', 'Normal', 'Más'].map((o) => ({ label: o, on: this.state[key] === o,
      cls: this.state[key] === o ? 'on' : '', pick: () => this.setState({ [key]: o }) }));
    const TAGS = [['vet_visit', 'Visita al veterinario'], ['home_change', 'Cambio de casa'], ['new_pet', 'Nueva mascota en casa']];
    const odd = this.state.odd;
    return {
      sleep: seg('sleep'), voc: seg('voc'), soc: seg('soc'),
      odd, oddCls: odd ? 'switch on' : 'switch', toggleOdd: () => this.setState({ odd: !odd }),
      tags: TAGS.map((t) => { const on = !!this.state.tags[t[0]]; return { label: t[1], on, cls: on ? 'chip on' : 'chip',
        toggle: () => this.setState({ tags: { ...this.state.tags, [t[0]]: !on } }) }; })
    };""")


def segrow(title, key, gid):
    return f"""<div class="col" style="gap: 10px">
      <h2 class="t3" id="{gid}">{title}</h2>
      <div class="seg three" role="radiogroup" aria-labelledby="{gid}">
        <sc-for list="{H(key)}" as="o" hint-placeholder-count="3"><button class="{H('o.cls')}" role="radio" aria-checked="{H('o.on')}" onClick="{H('o.pick')}">{H('o.label')}</button></sc-for>
      </div>
    </div>"""


reg(SEC, 'RegistroDetalles.dc.html', '5.2 Registro · detalles opcionales', page('Detalles del registro', f"""
<div class="app">
  <div class="scr" style="gap: 22px; padding-top: 54px">
    <div class="top">
      <a class="ib" href="Registro.dc.html" aria-label="Volver">{icon('chev-l', 24)}</a>
      <span class="strong">Detalles</span>
      <span class="cap muted" style="width: 44px; text-align: right">Opcional</span>
    </div>
    <p class="cap muted" style="margin-top: -10px">Comparado con lo habitual en Kika.</p>
    {segrow('Sueño', 'sleep', 'g1')}
    {segrow('Vocalizaciones', 'voc', 'g2')}
    {segrow('Con personas y otros animales', 'soc', 'g3')}
    <div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3" id="odd">¿Algo fuera de lo habitual?</h2>{sw('odd', 'odd', 'toggleOdd')}</div>
      <sc-if value="{H('odd')}" hint-placeholder-val="{{{{ true }}}}">
        <textarea class="input" aria-labelledby="odd" placeholder="Cuéntanos qué has notado">Se escondió debajo de la cama con los petardos.</textarea>
      </sc-if>
    </div>
    <div class="col" style="gap: 10px">
      <h2 class="t3">Etiquetas del día</h2>
      <div class="chips">
        <sc-for list="{H('tags')}" as="c" hint-placeholder-count="3"><button class="{H('c.cls')}" aria-pressed="{H('c.on')}" onClick="{H('c.toggle')}">{H('c.label')}</button></sc-for>
      </div>
    </div>
    <div class="field">
      <label for="note">Nota</label>
      <textarea id="note" class="input" placeholder="Lo que quieras recordar de hoy">Ladró bastante por la tarde.</textarea>
    </div>
  </div>
  {foot(btn('Guardar el día', 'RegistroGuardado.dc.html'))}
</div>""", script=DET_SCRIPT))

# 5.3 Registro guardado (única celebración: se rellena el punto de hoy)
reg(SEC, 'RegistroGuardado.dc.html', '5.3 Registro guardado', page('Registro guardado', f"""
<div class="app">
  <div class="scr" style="align-items: center; text-align: center; padding-top: 110px; gap: 28px">
    {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'done', '6/7', '6 de 7 días; hoy completado', 200, sub='ESTA SEMANA', fs=9)}
    <div class="col" style="gap: 8px; align-items: center">
      <h1 class="t1">Hecho</h1>
      <p class="blg muted" style="max-width: 300px">Kika lleva 6 de 7 días esta semana y 4 días seguidos.</p>
    </div>
    <a class="card flat" href="Logros.dc.html" style="width: 100%; flex-direction: row; align-items: center; gap: 14px; text-align: left; text-decoration: none; color: inherit">
      <div class="medal prog" style="width: 44px; height: 44px">{icon('medal', 22)}</div>
      <div class="col grow" style="gap: 6px">
        <p class="strong">7 días seguidos</p>
        <div class="bar" role="img" aria-label="4 de 7 días"><i style="width: 57%; background: var(--accent)"></i></div>
        <p class="cap muted">Lleváis 4. Sin prisa: cada día cuenta.</p>
      </div>
    </a>
  </div>
  {foot(btn('Volver al inicio', 'HomeHecho.dc.html'), '<a class="btn ghost md" href="RegistroHoyEditar.dc.html">Editar el registro</a>')}
</div>"""))

# 5.4 Editar un día anterior (desde el historial)
reg(SEC, 'RegistroEditar.dc.html', '5.4 Editar un registro anterior', page('Editar registro',
    '<dc-import name="Registro" values="{{ vals }}" title="Miércoles 15" editing="{{ true }}" historical="{{ true }}" save-href="DiaDetalle.dc.html" hint-size="390px,844px"></dc-import>',
    script="""class Component extends DCLogic {
  renderVals() {
    return { vals: [3, 2, 3, 2] };
  }
}"""))

# 5.5 Editar el registro de hoy
reg(SEC, 'RegistroHoyEditar.dc.html', '5.5 Editar el registro de hoy', page('Editar registro de hoy',
    '<dc-import name="Registro" values="{{ vals }}" editing="{{ true }}" save-href="HomeHecho.dc.html" hint-size="390px,844px"></dc-import>',
    script="""class Component extends DCLogic {
  renderVals() {
    return { vals: [4, 3, 4, 3] };
  }
}"""))

# 5.6 Error al guardar
reg(SEC, 'RegistroError.dc.html', '5.6 Error al guardar', page('Error al guardar',
    '<dc-import name="Registro" values="{{ vals }}" failed="{{ true }}" hint-size="390px,844px"></dc-import>',
    script="""class Component extends DCLogic {
  renderVals() {
    return { vals: [4, 3, 4, 3] };
  }
}"""))

# 5.7 Salir sin guardar
reg(SEC, 'RegistroDescartar.dc.html', '5.7 Salir sin guardar · diálogo', page('Salir sin guardar', dialog(
    '¿Salir sin guardar?', 'Lo que has marcado hoy no se guardará.',
    '<a class="btn primary" href="Registro.dc.html" autofocus>Seguir con el registro</a><a class="btn secondary" href="Home.dc.html">Salir sin guardar</a>',
    behind='<div style="padding: 58px 20px 0" aria-hidden="true"><p class="strong" style="text-align: center">Hoy, jueves 16</p></div>')))

# 5.8 Guardado sin conexión (pendiente de subir)
reg(SEC, 'RegistroOffline.dc.html', '5.8 Guardado sin conexión', page('Guardado sin conexión', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head(right='<span class="tag neutral">' + icon('wifi-off', 16) + 'Sin conexión</span>')}
    {alert('info', 'phone-dev', 'Registro guardado en el móvil', 'Lo subiremos solo cuando vuelva la conexión. No tienes que hacer nada.')}
    <div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px; align-items: center">
        {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'done', '6/7', '6 de 7 días; hoy guardado en el móvil')}
        <div class="col grow" style="gap: 6px">
          <h1 class="t2">Hecho por hoy</h1>
          <span class="tag neutral" style="align-self: flex-start">{icon('clock', 14)}Pendiente de subir</span>
        </div>
      </div>
      <a class="btn secondary md" href="RegistroHoyEditar.dc.html">Editar el registro de hoy</a>
    </div>
    <div class="banner">{icon('camera', 20, 2, 'color: var(--muted)')}<span>Consultar con una foto necesita conexión.</span></div>
  </div>
  {tabbar('hoy', done=True)}
</div>"""))

# 5.9 Conflicto al sincronizar (daily_log_conflict)
reg(SEC, 'RegistroConflicto.dc.html', '5.9 Conflicto al sincronizar · hoja', page('Conflicto de edición', sheet('Hay dos versiones de hoy', f"""
        <p class="muted">Se guardó otro registro de Kika desde otro dispositivo mientras no tenías conexión. Elige cuál quieres conservar.</p>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
          <div class="card flat" style="gap: 8px; box-shadow: inset 0 0 0 2px var(--primary); background: var(--brand)">
            <p class="over">En este móvil · 21:32</p>
            <p class="cap">Energía <b>Más</b></p><p class="cap">Apetito <b>Normal</b></p><p class="cap">Ánimo <b>Bien</b></p><p class="cap">Actividad <b>Normal</b></p>
          </div>
          <div class="card flat" style="gap: 8px">
            <p class="over">Guardado · 21:40</p>
            <p class="cap">Energía <b>Como siempre</b></p><p class="cap">Apetito <b>Normal</b></p><p class="cap">Ánimo <b>Bien</b></p><p class="cap">Actividad <b>Menos</b></p>
          </div>
        </div>
        <p class="cap muted">Nada se pierde hasta que elijas.</p>""",
    close='RegistroOffline.dc.html', footer=btn('Conservar el de este móvil', 'RegistroSync.dc.html') + btn('Usar el guardado', 'RegistroSync.dc.html', 'secondary'),
    behind=behind_title('Kika'), maxh=620)))

# 5.10 Sincronizado
reg(SEC, 'RegistroSync.dc.html', '5.10 Registro sincronizado', page('Registro sincronizado',
    '<dc-import name="HomeHecho" synced="{{ true }}" hint-size="390px,844px"></dc-import>'))
