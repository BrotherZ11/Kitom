from lib import *

SEC = 'agenda'
TYPES = [('vaccine', 'Vacuna', 'syringe', 'Vacuna anual'), ('medication', 'Medicación', 'pill', 'Antiinflamatorio'),
         ('appointment', 'Cita veterinaria', 'steth', 'Revisión en la clínica'), ('bath', 'Baño y peluquería', 'drops', 'Baño'),
         ('deworming', 'Desparasitación', 'shield-plus', 'Desparasitación interna'), ('other', 'Otro cuidado', 'heart', '')]
TI = {t[0]: t[2] for t in TYPES}


def agenda_top(view):
    seg = ''.join(f'<span class="on" role="tab" aria-selected="true">{l}</span>' if l == view else f'<a href="{h}" role="tab" aria-selected="false">{l}</a>'
                  for l, h in [('Lista', 'Agenda.dc.html'), ('Mes', 'AgendaMes.dc.html')])
    return f"""<div class="top"><h1 class="t1">Agenda</h1><a class="ib soft" href="Recordatorio.dc.html" aria-label="Nuevo recordatorio">{icon('plus', 22)}</a></div>
    <div class="seg" role="tablist" aria-label="Vista">{seg}</div>"""


def check_item(title_hole, cls_hole, btn_hole, done_hole, toggle_hole, sub, ic, typ, label='Marcar como hecho'):
    return f"""<div class="li">
          <a class="ico" href="RecordatorioDetalle.dc.html" aria-label="{typ}">{icon(ic)}</a>
          <a class="col grow" href="RecordatorioDetalle.dc.html" style="gap: 0; text-decoration: none; color: inherit"><span class="{H(cls_hole)}">{title_hole}</span><span class="cap muted">{typ} · {sub}</span></a>
          <button class="{H(btn_hole)}" aria-pressed="{H(done_hole)}" aria-label="{label}" onClick="{H(toggle_hole)}"><span><sc-if value="{H(done_hole)}" hint-placeholder-val="{{{{ false }}}}">{icon('check', 14, 3)}</sc-if></span></button>
        </div>"""


AG_SCRIPT = toggle_script({'pill': False, 'eye': True, 'late': False}, """    const s = this.state;
    const one = (k) => ({ done: s[k], cls: s[k] ? 'strike' : 'strong', btn: s[k] ? 'done-btn on' : 'done-btn', toggle: () => this.setState({ [k]: !s[k] }) });
    return { pill: one('pill'), eye: one('eye'), late: one('late') };""")

reg(SEC, 'Agenda.dc.html', '8.1 Agenda · lista', page('Agenda', f"""
<div class="app">
  <div class="scr" style="gap: 18px">
    {agenda_top('Lista')}
    <div class="col" style="gap: 10px">
      <p class="over" style="color: var(--routine-fg)">Pendiente</p>
      <div class="list" style="box-shadow: inset 0 0 0 1.5px var(--routine-bg), var(--shadow)">
        {check_item('Desparasitación externa', 'late.cls', 'late.btn', 'late.done', 'late.toggle', 'Era ayer, 15 oct', 'shield-plus', 'Desparasitación')}
      </div>
    </div>
    <div class="col" style="gap: 10px">
      <p class="over">Hoy · jueves 16</p>
      <div class="list">
        {check_item('Antiinflamatorio · 1 pastilla', 'pill.cls', 'pill.btn', 'pill.done', 'pill.toggle', '21:00 · día 3 de 5', 'pill', 'Medicación', 'Marcar como dada')}
        {check_item('Revisar el ojo derecho', 'eye.cls', 'eye.btn', 'eye.done', 'eye.toggle', 'Desde la orientación del 14 oct', 'heart', 'Otro cuidado')}
      </div>
    </div>
    <div class="col" style="gap: 10px">
      <p class="over">Próximos</p>
      <div class="list">
        {li('Desparasitación interna', 'Desparasitación · sábado 18 · 10:00', 'shield-plus', href='RecordatorioDetalle.dc.html')}
        {li('Vacuna anual', 'Vacuna · martes 28 · 17:30 · cada año', 'syringe', '<span class="tag neutral" style="font-weight: 500">' + icon('clip', 14) + '1</span>', 'RecordatorioDetalle.dc.html')}
        {li('Baño', 'Baño y peluquería · domingo 2 nov · cada mes', 'drops', href='RecordatorioDetalle.dc.html')}
      </div>
    </div>
  </div>
  {tabbar('agenda')}
</div>""", script=AG_SCRIPT))

# 8.2 Mes
def agcal():
    wd = ''.join(f'<span class="wd">{d}</span>' for d in 'LMXJVSD')
    cells = ''.join(f'<span class="d out">{d}<i></i></span>' for d in (28, 29, 30))
    ev = {2: 1, 12: 1, 14: 1, 15: 1, 16: 1, 18: 1, 28: 1}
    for d in range(1, 32):
        cls = 'd today' if d == 16 else ('d sel' if d == 28 else 'd')
        if d in ev and d != 16:
            cls += ' log'
        cells += f'<a class="{cls}" href="#dia-{d}" aria-label="{d} de octubre{"; con recordatorios" if d in ev else ""}">{d}<i></i></a>'
    cells += '<span class="d out">1<i></i></span>'
    return '<div class="cal" role="grid" aria-label="Octubre de 2026">' + wd + cells + '</div>'


reg(SEC, 'AgendaMes.dc.html', '8.2 Agenda · calendario', page('Agenda · mes', f"""
<div class="app">
  <div class="scr" style="gap: 18px">
    {agenda_top('Mes')}
    <div class="card" style="gap: 12px">
      <div class="between"><a class="ib" href="#sep" aria-label="Mes anterior">{icon('chev-l', 22)}</a><span class="strong">Octubre 2026</span><a class="ib" href="#nov" aria-label="Mes siguiente">{icon('chev-r', 22)}</a></div>
      {agcal()}
    </div>
    <div class="col" style="gap: 10px">
      <p class="over">Martes 28</p>
      <div class="list">{li('Vacuna anual', 'Vacuna · 17:30 · cada año', 'syringe', href='RecordatorioDetalle.dc.html')}</div>
    </div>
  </div>
  {tabbar('agenda')}
</div>"""))

# 8.3 Nuevo recordatorio (hoja, interactiva)
NR_SCRIPT = toggle_script({'type': 'vaccine', 'rep': 'YEARLY'}, """    const list = %s;
    const reps = [['NONE', 'No se repite'], ['DAILY', 'Cada día'], ['WEEKLY', 'Cada semana'], ['MONTHLY', 'Cada mes'], ['YEARLY', 'Cada año']];
    const cur = list.find((t) => t[0] === this.state.type);
    return {
      title: cur[3],
      types: list.map((t) => ({ label: t[1], on: t[0] === this.state.type, cls: t[0] === this.state.type ? 'chip on' : 'chip', pick: () => this.setState({ type: t[0] }) })),
      reps: reps.map((r) => ({ label: r[1], on: r[0] === this.state.rep, cls: r[0] === this.state.rep ? 'chip on' : 'chip', pick: () => this.setState({ rep: r[0] }) }))
    };""" % str([list(t) for t in TYPES]))

reg(SEC, 'Recordatorio.dc.html', '8.3 Nuevo recordatorio · hoja', page('Nuevo recordatorio', sheet('Nuevo recordatorio', f"""
        <div class="field">
          <span class="flabel" id="tp">Tipo</span>
          <div class="chips" role="radiogroup" aria-labelledby="tp">
            <sc-for list="{H('types')}" as="t" hint-placeholder-count="6"><button class="{H('t.cls')}" role="radio" aria-checked="{H('t.on')}" onClick="{H('t.pick')}">{H('t.label')}</button></sc-for>
          </div>
        </div>
        <div class="field"><label for="ti">Título</label><input id="ti" class="input" type="text" value="{H('title')}" placeholder="Por ejemplo, pastilla del corazón"></div>
        <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">
          <div class="field"><label for="d">Día</label><input id="d" class="input" type="text" value="Mar 28 oct"></div>
          <div class="field"><label for="h">Hora</label><input id="h" class="input mono" type="text" value="17:30"></div>
        </div>
        <div class="field">
          <span class="flabel" id="rp">Repetir</span>
          <div class="chips" role="radiogroup" aria-labelledby="rp">
            <sc-for list="{H('reps')}" as="r" hint-placeholder-count="5"><button class="{H('r.cls')}" role="radio" aria-checked="{H('r.on')}" onClick="{H('r.pick')}">{H('r.label')}</button></sc-for>
          </div>
        </div>
        <div class="field"><label for="av">Avisarme</label><a class="input" id="av" href="#avisos" style="justify-content: space-between; text-decoration: none; color: inherit">El día antes, a las 20:00{icon('chev-d', 20)}</a></div>
        <div class="field"><label for="nt">Notas <span style="font-weight: 400; color: var(--muted)">· opcional</span></label><input id="nt" class="input" type="text" value="Clínica Arrabal. Llevar la cartilla."></div>
        <button class="attach">{icon('clip', 20)}Adjuntar receta, cartilla o foto</button>""",
    close='Agenda.dc.html', footer=btn('Guardar recordatorio', 'Agenda.dc.html'), behind=behind_title('Agenda'), maxh=790),
    style=""".attach{height:52px;border-radius:14px;border:1.5px dashed var(--control);background:transparent;color:var(--primary);font:600 15px/20px 'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;width:100%}""",
    script=NR_SCRIPT))

# 8.4 Detalle del recordatorio
reg(SEC, 'RecordatorioDetalle.dc.html', '8.4 Detalle del recordatorio', page('Detalle del recordatorio', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Agenda.dc.html', '<div class="row" style="gap: 0"><a class="ib" href="Recordatorio.dc.html" aria-label="Editar">' + icon('pencil', 22) + '</a><a class="ib" href="RecordatorioEliminar.dc.html" aria-label="Eliminar">' + icon('trash', 22) + '</a></div>')}
    <div class="col" style="gap: 12px">
      <span class="ico" style="width: 56px; height: 56px; border-radius: 16px; background: var(--brand); color: var(--primary); display: flex; align-items: center; justify-content: center">{icon('syringe', 28)}</span>
      <p class="over">Vacuna · Kika</p>
      <h1 class="t1">Vacuna anual</h1>
    </div>
    <div class="list">
      {li('Martes 28 de octubre', '17:30', 'calendar', strong=False)}
      {li('Cada año', 'Próxima vez: 28 oct 2027', 'refresh', strong=False)}
      {li('Aviso el día antes', '20:00', 'bell', strong=False)}
    </div>
    <div class="card flat" style="gap: 6px"><p class="over">Notas</p><p>Clínica Arrabal. Llevar la cartilla.</p></div>
    <div class="col" style="gap: 10px">
      <p class="over">Adjuntos</p>
      <div class="card flat" style="flex-direction: row; align-items: center; gap: 12px"><div class="thumb photo" role="img" aria-label="Foto de la cartilla"></div><span class="col grow" style="gap: 0"><span class="strong">cartilla-vacunas.jpg</span><span class="cap muted">Foto · 1,2 MB</span></span><a class="ib" href="#ver" aria-label="Abrir adjunto">{icon('ext', 20)}</a></div>
    </div>
  </div>
  {foot(btn('Marcar como hecha', 'Agenda.dc.html', 'primary', 'check'), btn('Posponer', '#posponer', 'secondary md', 'clock'))}
</div>"""))

# 8.5 Eliminar recordatorio
reg(SEC, 'RecordatorioEliminar.dc.html', '8.5 Eliminar recordatorio · diálogo', page('Eliminar recordatorio', dialog(
    '¿Eliminar «Vacuna anual»?', 'Se repite cada año: también se eliminarán los próximos avisos y su adjunto.',
    '<a class="btn secondary" href="RecordatorioDetalle.dc.html" autofocus style="box-shadow: inset 0 0 0 2px var(--primary)">Cancelar</a><a class="btn danger" href="Agenda.dc.html">Eliminar recordatorio</a>',
    ic='trash', behind='<div style="padding: 58px 20px 0" aria-hidden="true"><p class="t1" style="margin-top: 120px">Vacuna anual</p></div>')))

# 8.6 Agenda vacía
chips = ''.join(f'<a class="chip" href="Recordatorio.dc.html">{icon(i, 16)}{l}</a>' for _, l, i, _ in TYPES)
reg(SEC, 'AgendaVacia.dc.html', '8.6 Agenda · sin eventos', page('Agenda vacía', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    <div class="top"><h1 class="t1">Agenda</h1><a class="ib soft" href="Recordatorio.dc.html" aria-label="Nuevo recordatorio">{icon('plus', 22)}</a></div>
    <div class="empty" style="padding-top: 40px">
      <div class="ill">{icon('calendar', 32)}</div>
      <h2 class="t2">La agenda de Kika está vacía</h2>
      <p class="muted" style="max-width: 300px">Apunta sus vacunas, medicación y citas, y te avisamos a tiempo.</p>
    </div>
    <div class="chips" style="justify-content: center">{chips}</div>
  </div>
  {tabbar('agenda')}
</div>"""))

# 8.7 Notificaciones (ajustes y permiso denegado)
NT_SCRIPT = """class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { daily: true, alerts: true, agenda: true, mk: false };
  }
  renderVals() {
    const s = this.state;
    const f = (k) => ({ on: s[k], cls: s[k] ? 'switch on' : 'switch', toggle: () => this.setState({ [k]: !s[k] }) });
    return { denied: this.props.denied ?? false, daily: f('daily'), alerts: f('alerts'), agenda: f('agenda'), mk: f('mk') };
  }
}"""


def swrow(key, lid, title, sub):
    return f"""<div class="li" style="align-items: flex-start; padding-top: 12px; padding-bottom: 12px">
        <span class="col grow" style="gap: 2px"><span class="strong" id="{lid}">{title}</span><span class="cap muted">{sub}</span></span>
        <button class="swbtn" role="switch" aria-checked="{H(key + '.on')}" aria-labelledby="{lid}" onClick="{H(key + '.toggle')}"><span class="{H(key + '.cls')}"></span></button>
      </div>"""


reg(SEC, 'AvisosAjustes.dc.html', '8.7 Notificaciones', page('Notificaciones', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Notificaciones', 'Ajustes.dc.html')}
    <sc-if value="{H('denied')}" hint-placeholder-val="{{{{ false }}}}">
      <div class="alert warn" role="alert">{icon('bell-off', 20, 2, 'flex: none; margin-top: 1px')}<div><strong>Los avisos están desactivados en tu móvil</strong>Actívalos en los ajustes del sistema para recibir los de Kitom. <a href="#ajustes-sistema" style="color: inherit; font-weight: 600">Abrir ajustes</a></div></div>
    </sc-if>
    <div class="list">
      {swrow('daily', 'n1', 'Recordatorio diario', 'Uno al día para el registro de Kika')}
      <a class="li" href="#hora"><span class="grow">Hora</span><span class="data muted">20:00</span>{icon('chev-r', 20, 2, 'color: var(--subtle)')}</a>
    </div>
    <div class="list">
      {swrow('agenda', 'n2', 'Agenda', 'Vacunas, medicación, citas y otros cuidados. Cada recordatorio tiene su aviso.')}
      {swrow('alerts', 'n3', 'Cambios en Kika', 'Cuando sus registros cambian varios días seguidos')}
      {swrow('mk', 'n4', 'Consejos y novedades por email', 'Como mucho, uno al mes')}
    </div>
    <p class="cap muted">Nunca te enviaremos más de un aviso de hábito al día.</p>
  </div>
</div>""", props={'denied': {'editor': 'boolean', 'default': True}}, script=NT_SCRIPT))
