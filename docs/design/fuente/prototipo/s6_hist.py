from lib import *

SEC = 'hist'


def period(active):
    items = [('Semana', 'Tendencias.dc.html'), ('Mes', 'HistorialMes.dc.html'), ('Todo', 'HistorialLimite.dc.html')]
    out = []
    for label, href in items:
        if label == active:
            out.append(f'<span class="on" role="tab" aria-selected="true">{label}</span>')
        else:
            out.append(f'<a href="{href}" role="tab" aria-selected="false">{label}</a>')
    return '<div class="seg three" role="tablist" aria-label="Periodo">' + ''.join(out) + '</div>'


def hist_top():
    return f'<div class="top"><h1 class="t1">Historial</h1><a class="row" href="SelectorMascota.dc.html" style="gap: 6px; text-decoration: none; color: inherit" aria-label="Mascota: Kika"><div class="av s40 warm">K</div></a></div>'


# 6.1 Historial · semana (gráfico con categorías activables, mensaje prudente y línea de tiempo)
TREND_SCRIPT = toggle_script({'hidden': {'activity': True, 'sleep': True}}, """    const data = {
      energy: [4, 4, null, 3, 3, 3, 4],
      appetite: [3, 3, null, 2, 2, 2, 3],
      mood: [4, 4, null, 3, 4, 3, 4],
      activity: [3, 4, null, 3, 2, 3, 3],
      sleep: [3, 3, null, 3, 2, 3, 3]
    };
    const defs = [
      { id: 'energy', label: 'Energía', color: 'var(--c-energy)', dash: '' },
      { id: 'appetite', label: 'Apetito', color: 'var(--c-appetite)', dash: '6 4' },
      { id: 'mood', label: 'Ánimo', color: 'var(--c-mood)', dash: '1 4' },
      { id: 'activity', label: 'Actividad', color: 'var(--c-activity)', dash: '10 3 2 3' },
      { id: 'sleep', label: 'Sueño', color: 'var(--c-sleep)', dash: '2 2' }
    ];
    const step = 304 / 6;
    const path = (vals) => {
      let d = ''; let pen = false;
      vals.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += (pen ? ' L' : ' M') + (8 + i * step).toFixed(1) + ' ' + (160 - (v - 1) * 35).toFixed(1);
        pen = true;
      });
      return d.trim();
    };
    const shown = defs.filter((d) => !this.state.hidden[d.id]).length;
    const out = {};
    defs.forEach((d) => { const on = !this.state.hidden[d.id]; out[d.id] = { d: path(data[d.id]), op: on ? 1 : 0 }; });
    return {
      ...out,
      series: defs.map((d) => {
        const on = !this.state.hidden[d.id];
        const blocked = !on && shown >= 3;
        return { ...d, on, chipCls: on ? 'chip on' : 'chip',
          toggle: () => { if (!blocked) this.setState({ hidden: { ...this.state.hidden, [d.id]: on } }); } };
      }),
      full: shown >= 3,
      bandX: (8 + 3 * step - step / 2).toFixed(1),
      bandW: (3 * step).toFixed(1)
    };""")

reg(SEC, 'Tendencias.dc.html', '6.1 Historial · semana', page('Historial · semana', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {hist_top()}
    {period('Semana')}
    <div class="card" style="gap: 14px">
      <div class="chips" style="gap: 6px" aria-label="Categorías">
        <sc-for list="{H('series')}" as="s" hint-placeholder-count="5">
          <button class="{H('s.chipCls')}" aria-pressed="{H('s.on')}" onClick="{H('s.toggle')}" style="min-height: 36px; padding: 0 12px; font-size: 13px"><span class="dot" style="background: {H('s.color')}"></span>{H('s.label')}</button>
        </sc-for>
      </div>
      <div class="row" style="gap: 6px; align-items: stretch">
        <div class="col" style="justify-content: space-between; gap: 0; padding: 12px 0 14px; font-size: 10px; line-height: 12px; color: var(--muted); width: 44px; flex: none" aria-hidden="true"><span>Mucho más</span><span>Como siempre</span><span>Mucho menos</span></div>
        <svg class="chart" width="100%" height="180" viewBox="0 0 320 180" preserveAspectRatio="none" role="img" aria-label="Últimos 7 días comparados con lo habitual en Kika. El apetito bajó de lunes a miércoles." style="flex: 1; min-width: 0">
          <rect class="band" x="{H('bandX')}" y="8" width="{H('bandW')}" height="160" rx="6"></rect>
          <line class="grid" x1="0" x2="320" y1="20" y2="20"></line><line class="grid" x1="0" x2="320" y1="55" y2="55"></line>
          <line class="grid" x1="0" x2="320" y1="90" y2="90" style="stroke-dasharray: 3 3; stroke: var(--control)"></line>
          <line class="grid" x1="0" x2="320" y1="125" y2="125"></line><line class="grid" x1="0" x2="320" y1="160" y2="160"></line>
          <path class="s" d="{H('energy.d')}" style="stroke: var(--c-energy); opacity: {H('energy.op')}"></path>
          <path class="s" d="{H('appetite.d')}" style="stroke: var(--c-appetite); opacity: {H('appetite.op')}; stroke-dasharray: 6 4"></path>
          <path class="s" d="{H('mood.d')}" style="stroke: var(--c-mood); opacity: {H('mood.op')}; stroke-dasharray: 1 4"></path>
          <path class="s" d="{H('activity.d')}" style="stroke: var(--c-activity); opacity: {H('activity.op')}; stroke-dasharray: 10 3 2 3"></path>
          <path class="s" d="{H('sleep.d')}" style="stroke: var(--c-sleep); opacity: {H('sleep.op')}; stroke-dasharray: 2 2"></path>
        </svg>
      </div>
      <div class="xl" aria-hidden="true" style="padding-left: 54px"><span>V</span><span>S</span><span>D</span><span>L</span><span>M</span><span>X</span><span>J</span></div>
      <sc-if value="{H('full')}" hint-placeholder-val="{{{{ true }}}}"><p class="cap muted">Se ven hasta 3 categorías a la vez. Quita una para ver otra.</p></sc-if>
    </div>
    <div class="card" style="gap: 8px">
      <p class="over">Cómo ha ido la semana</p>
      <p>El apetito de Kika estuvo por debajo de lo habitual de lunes a miércoles (la zona azul). Hoy vuelve a lo normal.</p>
      <p class="cap muted">Kitom compara cada día con lo habitual en Kika. No es una valoración médica.</p>
      <a class="link row" href="Alertas.dc.html" style="gap: 6px">Ver el historial de alertas{icon('chev-r', 18)}</a>
    </div>
    <div class="col" style="gap: 10px">
      <h2 class="t3">Día a día</h2>
      <div class="list">
        {li('Hoy, jueves 16', 'Energía más · Apetito normal · Ánimo bien', href='DiaDetalle.dc.html')}
        {li('Miércoles 15', 'Apetito menos · Algo fuera de lo habitual · Con nota', href='DiaDetalle.dc.html')}
        {li('Martes 14', 'Apetito menos · Orientación: cambio de rutina', href='DiaDetalle.dc.html')}
        <div class="li"><span class="col grow" style="gap: 0"><span class="strong muted">Domingo 12</span><span class="cap muted">Sin registro</span></span><a class="link" href="Registro.dc.html" style="font-size: 14px">Añadir</a></div>
      </div>
    </div>
  </div>
  {tabbar('hist')}
</div>""", script=TREND_SCRIPT))

# 6.2 Historial · mes (calendario + comparación de tendencias en pequeño)
def cal():
    wd = ''.join(f'<span class="wd">{d}</span>' for d in 'LMXJVSD')
    cells = []
    # Octubre 2026: el 1 es jueves → 3 huecos (28, 29, 30 de septiembre)
    for d in (28, 29, 30):
        cells.append(f'<span class="d out">{d}<i></i></span>')
    nolog = {11, 12}
    for d in range(1, 32):
        cls = ['d']
        if d < 16 and d not in nolog:
            cls.append('log')
        if d in (13, 14, 15):
            cls.append('sig')
        if d == 16:
            cls = ['d', 'today']
        if d > 16:
            cls.append('out')
        lab = f'{d} de octubre' + ('; con registro' if 'log' in cls else '') + ('; con señal' if 'sig' in cls else '') + ('; hoy' if d == 16 else '')
        if d <= 16:
            cells.append(f'<a class="{" ".join(cls)}" href="DiaDetalle.dc.html" aria-label="{lab}">{d}<i></i></a>')
        else:
            cells.append(f'<span class="{" ".join(cls)}">{d}<i></i></span>')
    cells.append('<span class="d out">1<i></i></span>')
    return '<div class="cal" role="grid" aria-label="Octubre de 2026">' + wd + ''.join(cells) + '</div>'


SM = [('Energía', 'var(--c-energy)', '', [4,4,3,4,4,5,4,3,4,4,None,None,4,4,3,4,5,4,4,4,3,4,4,None,4,3,3,3,4,4], 'Como siempre'),
      ('Apetito', 'var(--c-appetite)', '5 3', [4,4,4,4,3,4,4,4,4,4,None,None,4,3,4,4,4,4,4,4,4,4,4,None,2,2,2,2,3,3], 'Algo menos los últimos días'),
      ('Ánimo', 'var(--c-mood)', '1 3', [4,4,4,3,4,4,5,4,4,4,None,None,4,4,4,4,4,5,4,4,4,4,4,None,3,3,4,3,4,4], 'Bien'),
      ('Actividad', 'var(--c-activity)', '8 3 2 3', [3,3,4,3,3,3,4,3,3,3,None,None,3,4,3,3,3,4,3,3,3,3,3,None,3,2,3,3,3,3], 'Como siempre'),
      ('Sueño', 'var(--c-sleep)', '2 2', [3,3,3,3,3,3,3,3,3,4,None,None,3,3,3,3,3,3,3,3,3,3,3,None,3,3,2,3,3,3], 'Como siempre')]
sm_rows = ''.join(f'<a class="sm-row" href="Tendencias.dc.html"><span class="dot" style="background: {c}"></span><span class="col grow" style="gap: 0"><span class="label">{t}</span><span class="cap muted">{w}</span></span>{spark(v, 132, 32, c, d, sw=1.8)}</a>' for t, c, d, v, w in SM)

reg(SEC, 'HistorialMes.dc.html', '6.2 Historial · mes', page('Historial · mes', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {hist_top()}
    {period('Mes')}
    <div class="card" style="gap: 12px">
      <div class="between"><a class="ib" href="#septiembre" aria-label="Mes anterior">{icon('chev-l', 22)}</a><span class="strong">Octubre 2026</span><span class="ib" aria-hidden="true" style="color: var(--subtle)">{icon('chev-r', 22)}</span></div>
      {cal()}
      <div class="legend"><span><span class="dot" style="background: var(--primary); width: 6px; height: 6px"></span>Con registro</span><span><span class="dot" style="box-shadow: inset 0 0 0 1.5px var(--observe-fg)"></span>Con señal</span><span><span class="dot" style="background: var(--accent)"></span>Hoy</span></div>
    </div>
    <div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Últimos 30 días</h2><span class="cap muted">frente a lo habitual</span></div>
      <div class="list">{sm_rows}</div>
      <p class="cap muted">13 de 15 días registrados. Los días sin registro quedan en blanco: no los rellenamos.</p>
    </div>
  </div>
  {tabbar('hist')}
</div>"""))

# 6.3 Detalle del día
def pips(n):
    return '<div class="pips" aria-hidden="true">' + ''.join('<i class="on"></i>' if i < n else '<i></i>' for i in range(5)) + '</div>'


reg(SEC, 'DiaDetalle.dc.html', '6.3 Detalle del día', page('Detalle del día', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Miércoles 15 de octubre', 'Tendencias.dc.html', f'<a class="ib" href="RegistroEditar.dc.html" aria-label="Editar este día">{icon("pencil", 22)}</a>')}
    <div class="card" style="gap: 14px">
      <div class="mrow"><span class="label">Energía</span>{pips(3)}<span class="cap" style="text-align: right">Como siempre</span></div>
      <div class="mrow"><span class="label">Apetito</span>{pips(2)}<span class="cap" style="text-align: right">Menos</span></div>
      <div class="mrow"><span class="label">Ánimo</span>{pips(3)}<span class="cap" style="text-align: right">Normal</span></div>
      <div class="mrow"><span class="label">Actividad</span>{pips(2)}<span class="cap" style="text-align: right">Menos</span></div>
      <hr class="divider">
      <div class="col" style="gap: 6px">
        <div class="between"><span class="muted">Sueño</span><span>Normal</span></div>
        <div class="between"><span class="muted">Vocalizaciones</span><span>Más</span></div>
        <div class="between"><span class="muted">Con personas y animales</span><span>Normal</span></div>
      </div>
    </div>
    <div class="col" style="gap: 10px">
      <h2 class="t3">Algo fuera de lo habitual</h2>
      <div class="card flat"><p>Se escondió debajo de la cama con los petardos.</p></div>
      <h2 class="t3">Nota</h2>
      <div class="card flat"><p>Ladró bastante por la tarde. Cenó la mitad.</p></div>
    </div>
    <p class="cap muted">Registrado por ti a las 21:04 · editado a las 22:15</p>
  </div>
  {foot(btn('Editar este día', 'RegistroEditar.dc.html', 'secondary'))}
</div>""", style="""
.mrow{display:grid;grid-template-columns:84px minmax(0,1fr) 96px;align-items:center;gap:12px}
.pips{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px}
.pips i{height:8px;border-radius:999px;background:var(--sunken);display:block}
.pips i.on{background:var(--primary)}
"""))

# 6.4 Historial de alertas (línea de tiempo con filtros)
def ev(when, lvl, title, text, href, last=False):
    color = {'observe': 'var(--observe-fg)', 'routine': 'var(--routine-fg)', 'vet': 'var(--vet-fg)', 'urgent': 'var(--urgent)'}[lvl]
    return f"""<a class="ev" href="{href}"><span class="when">{when}</span><span class="rail"><i style="background: {color}"></i>{'' if last else '<b></b>'}</span>
      <span class="body">{utag(lvl, True)}<span class="strong">{title}</span><span class="cap muted">{text}</span></span></a>"""


ALERT_SCRIPT = toggle_script({'f': 'all'}, """    return { filters: [['all', 'Todas'], ['pattern', 'Cambios en sus registros'], ['ai', 'Consultas']].map((o) => ({ label: o[1],
      on: this.state.f === o[0], cls: this.state.f === o[0] ? 'chip on' : 'chip', pick: () => this.setState({ f: o[0] }) })),
      showPattern: this.state.f !== 'ai', showAi: this.state.f !== 'pattern' };""")
reg(SEC, 'Alertas.dc.html', '6.4 Historial de alertas', page('Historial de alertas', f"""
<div class="app">
  <div class="scr" style="gap: 18px">
    {top('Historial de alertas', 'Tendencias.dc.html')}
    <div class="chips" role="radiogroup" aria-label="Filtrar">
      <sc-for list="{H('filters')}" as="f" hint-placeholder-count="3"><button class="{H('f.cls')}" role="radio" aria-checked="{H('f.on')}" onClick="{H('f.pick')}">{H('f.label')}</button></sc-for>
    </div>
    <div class="tl">
      <sc-if value="{H('showPattern')}" hint-placeholder-val="{{{{ true }}}}">{ev('13–15 oct', 'observe', 'Apetito por debajo de lo habitual', 'Detectado en sus registros · ya vuelve a lo normal', 'Tendencias.dc.html')}</sc-if>
      <sc-if value="{H('showAi')}" hint-placeholder-val="{{{{ true }}}}">{ev('14 oct', 'routine', 'Ojo derecho lloroso', 'Consulta con foto · te fue útil', 'Resultado.dc.html')}</sc-if>
      <sc-if value="{H('showAi')}" hint-placeholder-val="{{{{ true }}}}">{ev('2 oct', 'observe', 'Cojera leve después del paseo', 'Consulta sin foto', 'ResultadoObservar.dc.html')}</sc-if>
      <sc-if value="{H('showPattern')}" hint-placeholder-val="{{{{ true }}}}">{ev('24 sep', 'observe', 'Más inquieta por la noche', 'Detectado en sus registros', 'HistorialMes.dc.html', last=True)}</sc-if>
    </div>
    <p class="cap muted">En el plan gratuito ves las alertas de los últimos 30 días.</p>
  </div>
  {tabbar('hist')}
</div>""", script=ALERT_SCRIPT))

# 6.5 Sin datos suficientes
reg(SEC, 'HistorialVacio.dc.html', '6.5 Historial · sin datos suficientes', page('Historial sin datos', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {hist_top()}
    <div class="empty" style="padding-top: 40px">
      {ring(['off', 'off', 'off', 'off', 'off', 'on'], 'pending', '1/3', '1 de 3 registros', 140)}
      <h2 class="t2">Su evolución aparecerá aquí</h2>
      <p class="muted" style="max-width: 300px">Con 3 registros empezarás a ver cómo cambian su energía, apetito y ánimo. Por ahora, Kika tiene 1.</p>
    </div>
    <div class="list">{li('Ayer, miércoles 15', 'Primer registro de Kika', href='DiaDetalle.dc.html')}</div>
  </div>
  {foot(btn('Registrar hoy', 'Registro.dc.html'), style='padding-bottom: 12px')}
  {tabbar('hist')}
</div>"""))

# 6.6 Límite del plan gratuito (historial anterior a 30 días)
_lim_src = open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'base', 'HistorialLimite.dc.html'), encoding='utf-8').read()
import re as _re
_paths = _re.findall(r'<path d="(M[^"]+)" fill="none" stroke="var\(--c-energy\)"', _lim_src)
reg(SEC, 'HistorialLimite.dc.html', '6.6 Historial · límite del plan gratuito', page('Historial · todo', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {hist_top()}
    {period('Todo')}
    <div class="card" style="gap: 12px">
      <div class="between"><span class="label">Energía</span><span class="cap muted">jun – oct</span></div>
      <svg width="100%" height="150" viewBox="0 0 320 150" preserveAspectRatio="none" aria-hidden="true">
        <g class="veil"><path d="{_paths[0]}" fill="none" stroke="var(--c-energy)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></g>
        <line x1="232" x2="232" y1="6" y2="144" stroke="var(--control)" stroke-width="1" stroke-dasharray="3 3"></line>
        <path d="{_paths[1]}" fill="none" stroke="var(--c-energy)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path>
      </svg>
      <div class="xl" aria-hidden="true"><span>jun</span><span>jul</span><span>ago</span><span>sep</span><span>últimos 30 días</span></div>
    </div>
    <div class="card brand" style="gap: 12px">
      <div class="row" style="gap: 10px">{icon('lock', 22, 2, 'color: var(--primary)')}<h2 class="t3">Todo su historial, con Premium</h2></div>
      <p>Kika tiene registros desde junio. En el plan gratuito ves los últimos 30 días; lo anterior sigue guardado y no se pierde.</p>
      <a class="btn primary md" href="Premium.dc.html">Ver Kitom Premium</a>
      <a class="btn ghost md" href="Tendencias.dc.html">Ahora no</a>
    </div>
  </div>
  {tabbar('hist')}
</div>"""))
