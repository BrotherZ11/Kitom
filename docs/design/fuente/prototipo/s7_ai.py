from lib import *
import os, re

SEC = 'ai'
SYMPTOMS = [('watery_eyes', 'Ojos llorosos'), ('limping', 'Cojera'), ('lethargy', 'Decaimiento'),
            ('wound', 'Heridas visibles'), ('appetite_loss', 'Falta de apetito'), ('excessive_vocal', 'Vocalización excesiva')]

URGENT_HINT = (f'<div class="banner" style="background: var(--danger-bg); color: var(--danger-ink); align-items: flex-start">{icon("alert", 20, 2, "flex: none; margin-top: 1px")}'
               '<span>Si no respira bien, convulsiona, sangra o no puede ponerse en pie, no esperes: <a href="tel:+34000000000" style="color: inherit; font-weight: 600">llama a tu veterinario</a>.</span></div>')

# 7.1 Introducción y límites
reg(SEC, 'ConsultaIntro.dc.html', '7.1 Consultar · introducción', page('Consultar con una foto', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Home.dc.html', '<span class="tag neutral" style="font-weight: 500">[N] de [LÍMITE] este mes</span>')}
    <div class="col" style="gap: 8px">
      <p class="over">Kika</p>
      <h1 class="t1">¿Notas algo raro?</h1>
      <p class="muted">Cuéntanos qué ves y te damos una orientación: posibles causas, qué hacer en casa y cuándo ir al veterinario.</p>
    </div>
    <div class="list">
      {li('Una foto, si quieres', 'De lo que te preocupa: el ojo, una herida, cómo camina', 'camera')}
      {li('Lo que ves', 'Elige las señales de una lista', 'list')}
      {li('Su historia', 'Tenemos en cuenta sus últimos 30 días de registros', 'chart')}
    </div>
    {alert('info', 'info', 'Es una orientación, no una respuesta médica', 'Kitom no puede confirmar enfermedades ni sustituye a un veterinario. Si dudas, consulta siempre.', 'note')}
    {URGENT_HINT}
  </div>
  {foot(btn('Empezar', 'ConsentimientoFoto.dc.html'), '<a class="btn ghost md" href="Consultas.dc.html">Ver consultas anteriores</a>')}
</div>"""))

# 7.2 Consentimiento de fotos (granular, primera vez)
reg(SEC, 'ConsentimientoFoto.dc.html', '7.2 Consentimiento de fotos · hoja', page('Consentimiento de fotos', sheet('Antes de tu primera foto', f"""
        <p class="muted">Tú decides cómo usamos tus fotos. Puedes cambiarlo en Ajustes › Privacidad.</p>
        <div class="list">
          <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">
            <span class="col grow" style="gap: 2px"><span class="strong" id="c1">Usar mis fotos para preparar la orientación</span><span class="cap muted">Necesario para consultar con foto. Se guardan de forma privada con tu consulta.</span></span>
            {sw('c1', 'c1', 'toggle1')}
          </div>
          <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">
            <span class="col grow" style="gap: 2px"><span class="strong" id="c2">Ayudar a mejorar Kitom con mis fotos</span><span class="cap muted">Opcional. Anónimas y revisadas por veterinarios. Nunca se activa sola.</span></span>
            {sw('c2', 'c2', 'toggle2')}
          </div>
        </div>
        <p class="cap muted">Evita que salgan personas en las fotos.</p>""",
    close='ConsultaIntro.dc.html', footer=f'<sc-if value="{H("c1")}" hint-placeholder-val="{{{{ false }}}}"><a class="btn primary" href="ConsultaFoto.dc.html">Hacer la foto</a></sc-if>'
    f'<sc-if value="{H("no1")}" hint-placeholder-val="{{{{ true }}}}"><span class="btn disabled" aria-disabled="true">Hacer la foto</span></sc-if>'
    '<a class="btn ghost md" href="Consulta.dc.html">Seguir sin foto</a>', behind=behind_title('¿Notas algo raro?'), maxh=600),
    script=toggle_script({'c1': False, 'c2': False}, """    const { c1, c2 } = this.state;
    return { c1, no1: !c1, c2, c1Cls: c1 ? 'switch on' : 'switch', c2Cls: c2 ? 'switch on' : 'switch',
      toggle1: () => this.setState({ c1: !c1 }), toggle2: () => this.setState({ c2: !c2 }) };""")))

# 7.3 Captura de foto
reg(SEC, 'ConsultaFoto.dc.html', '7.3 Hacer la foto', page('Hacer la foto', f"""
<div class="app dark" style="background: #0A1413">
  <div class="scr" style="gap: 14px; padding-bottom: 12px">
    <div class="top">
      <a class="ib" href="ConsultaIntro.dc.html" aria-label="Cerrar" style="color: #F2F5F3">{icon('x', 24)}</a>
      <span class="strong" style="color: #F2F5F3">Foto para la consulta</span>
      <span style="width: 44px"></span>
    </div>
    <div class="viewfinder" role="img" aria-label="Visor de la cámara">
      <div class="frame"></div>
      <span class="cap" style="position: absolute; top: 16px; left: 0; right: 0; text-align: center; color: #C9D8D4">Centra lo que te preocupa</span>
    </div>
    <div class="chips" style="justify-content: center">
      <span class="tag neutral">Con buena luz</span><span class="tag neutral">De cerca</span><span class="tag neutral">Sin personas</span>
    </div>
  </div>
  <div class="foot" style="background: #0A1413; flex-direction: row; align-items: center; justify-content: space-between; padding-bottom: 40px">
    <a class="ib" href="ConsultaPrevia.dc.html" aria-label="Elegir de la galería" style="background: #1D3331; color: #F2F5F3; width: 52px; height: 52px; border-radius: 14px">{icon('image', 24)}</a>
    <a class="shutter" href="ConsultaPrevia.dc.html" aria-label="Hacer la foto"></a>
    <a class="link" href="Consulta.dc.html" style="color: #F2F5F3; width: 52px; text-align: center; font-size: 14px">Sin foto</a>
  </div>
</div>"""))

# 7.4 Vista previa
reg(SEC, 'ConsultaPrevia.dc.html', '7.4 Vista previa de la foto', page('Vista previa', f"""
<div class="app">
  <div class="scr" style="gap: 16px">
    {top('Vista previa', 'ConsultaFoto.dc.html')}
    <div class="shot photo" style="height: 420px; flex: none" role="img" aria-label="Foto de Kika: ojo derecho"><span>Foto de Kika<br>(ojo derecho)</span></div>
    {alert('warn', 'users', '¿Sale alguna persona?', 'Repite la foto o recórtala antes de seguir.')}
  </div>
  {foot(btn('Usar esta foto', 'Consulta.dc.html'), '<div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">' + btn('Repetir', 'ConsultaFoto.dc.html', 'secondary md', 'refresh') + btn('Quitar', 'Consulta.dc.html', 'secondary md', 'trash', ' style="color: var(--danger-ink)"') + '</div>')}
</div>"""))

# 7.5 Señales e información adicional (interactivo)
reg(SEC, 'Consulta.dc.html', '7.5 Consultar · señales', page('Consultar · señales', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Consultar', 'ConsultaIntro.dc.html', '<span class="data muted" style="width: 44px; text-align: right">2/3</span>', sub='Kika')}
    <div class="card flat" style="flex-direction: row; align-items: center; gap: 12px">
      <div class="thumb photo" role="img" aria-label="Foto añadida"></div>
      <div class="col grow" style="gap: 0"><span class="strong">Foto añadida</span><span class="cap muted">Ojo derecho</span></div>
      <a class="btn secondary sm" href="ConsultaFoto.dc.html">Cambiar</a>
    </div>
    <div class="col" style="gap: 10px">
      <h2 class="t3">¿Qué ves?</h2>
      <div class="chips">
        <sc-for list="{H('symptoms')}" as="c" hint-placeholder-count="6"><button class="{H('c.cls')}" aria-pressed="{H('c.on')}" onClick="{H('c.toggle')}">{H('c.label')}</button></sc-for>
      </div>
      <p class="cap muted">Señales revisadas por nuestro veterinario colaborador para perros y gatos.</p>
    </div>
    <div class="field">
      <label for="desc">Cuéntanos más <span style="font-weight: 400; color: var(--muted)">· opcional</span></label>
      <textarea id="desc" class="input">Desde ayer tiene el ojo derecho lloroso y se lo frota con la pata.</textarea>
      <p class="help">Desde cuándo, si ha cambiado algo en casa, si come y bebe.</p>
    </div>
  </div>
  <div class="foot">
    <sc-if value="{H('ready')}" hint-placeholder-val="{{{{ true }}}}"><a class="btn primary" href="ConsultaRevision.dc.html">Revisar y enviar</a></sc-if>
    <sc-if value="{H('notReady')}" hint-placeholder-val="{{{{ false }}}}"><span class="btn disabled" aria-disabled="true">Elige al menos una señal</span></sc-if>
  </div>
</div>""", script=toggle_script({'on': {'watery_eyes': True}}, """    const list = %s;
    const symptoms = list.map((c) => { const on = !!this.state.on[c[0]]; return { label: c[1], on, cls: on ? 'chip on' : 'chip',
      toggle: () => this.setState({ on: { ...this.state.on, [c[0]]: !on } }) }; });
    const n = symptoms.filter((s) => s.on).length;
    return { symptoms, ready: n > 0, notReady: n === 0 };""" % str([list(s) for s in SYMPTOMS]))))

# 7.6 Revisión antes de enviar
reg(SEC, 'ConsultaRevision.dc.html', '7.6 Revisar antes de enviar', page('Revisar consulta', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Revisa tu consulta', 'Consulta.dc.html', '<span class="data muted" style="width: 44px; text-align: right">3/3</span>', sub='Kika')}
    <div class="list">
      <div class="li"><div class="thumb photo" role="img" aria-label="Foto"></div><span class="col grow" style="gap: 0"><span class="strong">1 foto</span><span class="cap muted">Ojo derecho</span></span><a class="link" href="ConsultaFoto.dc.html" style="font-size: 14px">Cambiar</a></div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px"><span class="col grow" style="gap: 8px"><span class="strong">Señales</span><span class="chips"><span class="tag brand">Ojos llorosos</span></span></span><a class="link" href="Consulta.dc.html" style="font-size: 14px">Cambiar</a></div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px"><span class="col grow" style="gap: 4px"><span class="strong">Tu nota</span><span class="cap muted">Desde ayer tiene el ojo derecho lloroso y se lo frota con la pata.</span></span></div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px"><span class="col grow" style="gap: 4px"><span class="strong">Su contexto</span><span class="cap muted">Perra, 5 años, 12,4 kg · últimos 30 días de registros: el apetito bajó de lunes a miércoles.</span></span></div>
    </div>
    <p class="cap muted">Esta consulta cuenta para tu límite: te quedarán [N] de [LÍMITE] este mes.</p>
  </div>
  {foot(btn('Pedir orientación', 'Analizando.dc.html'), cap('Orientación informativa. No sustituye a un veterinario.'))}
</div>"""))

# 7.7 Procesando (se conserva)
reg(SEC, 'Analizando.dc.html', '7.7 Preparando la orientación', page('Preparando la orientación', f"""
<div class="app">
  <div class="scr" style="align-items: center; padding-top: 110px; gap: 28px">
    <svg class="ring" width="120" height="120" viewBox="0 0 64 64" role="img" aria-label="Preparando la orientación">
      <g class="spin" stroke-width="5.5">{''.join(f'<path class="{c}" d="{p}"></path>' for c, p in zip(['on', 'off'] * 3, SEGS))}<circle class="today" cx="22.45" cy="12.18" r="4.6"></circle></g>
    </svg>
    <div class="col" style="gap: 8px; align-items: center; text-align: center">
      <h1 class="t2">Preparando la orientación para Kika</h1>
      <p class="muted" style="max-width: 300px">Suele tardar menos de un minuto. Puedes salir; te avisamos cuando esté lista.</p>
    </div>
    <div class="card" style="width: 100%; gap: 4px" role="list" aria-live="polite">
      <div class="stp" role="listitem"><span class="ok">{icon('check', 14, 3)}</span><span>Foto y señales recibidas</span></div>
      <div class="stp" role="listitem"><span class="now" aria-hidden="true"><i></i></span><span class="strong">Comparando con sus últimos 30 días</span></div>
      <div class="stp" role="listitem"><span class="wait" aria-hidden="true"></span><span class="muted">Preparando posibles causas y consejos</span></div>
    </div>
  </div>
  {foot(btn('Ver el resultado (prototipo)', 'Resultado.dc.html', 'secondary'), '<a class="btn ghost md" href="ConsultaError.dc.html">Ver un error (prototipo)</a>', cap('Si te parece urgente, no esperes: llama a tu veterinario.'))}
</div>""", style="""
@keyframes kspin2{to{transform:rotate(360deg)}}
.spin{animation:kspin2 2.4s cubic-bezier(.2,0,0,1) infinite;transform-origin:50% 50%}
@media (prefers-reduced-motion: reduce){.spin{animation:none}}
.stp{display:flex;align-items:center;gap:12px;min-height:40px}
.ok{width:24px;height:24px;border-radius:999px;background:var(--primary);color:var(--on-primary);display:flex;align-items:center;justify-content:center;flex:none}
.wait{width:24px;height:24px;border-radius:999px;box-shadow:inset 0 0 0 2px var(--line);flex:none}
.now{width:24px;height:24px;border-radius:999px;box-shadow:inset 0 0 0 2px var(--primary);flex:none;display:flex;align-items:center;justify-content:center}
.now i{width:10px;height:10px;border-radius:999px;background:var(--accent);display:block}
"""))

# Resultados por nivel ------------------------------------------------------------
FB_SCRIPT = toggle_script({'fb': None}, """    const fb = this.state.fb;
    return { yes: fb === 'yes', no: fb === 'no', answered: fb !== null, askWhy: fb === 'no',
      yesCls: fb === 'yes' ? 'fb on' : 'fb', noCls: fb === 'no' ? 'fb on' : 'fb',
      pickYes: () => this.setState({ fb: 'yes' }), pickNo: () => this.setState({ fb: 'no' }) };""")
FEEDBACK = f"""<div class="col" style="gap: 10px">
      <p class="strong" id="fb">¿Te ha sido útil?</p>
      <div class="row" role="group" aria-labelledby="fb" style="gap: 8px">
        <button class="{H('yesCls')}" aria-pressed="{H('yes')}" onClick="{H('pickYes')}">Sí</button>
        <button class="{H('noCls')}" aria-pressed="{H('no')}" onClick="{H('pickNo')}">No</button>
      </div>
      <sc-if value="{H('askWhy')}" hint-placeholder-val="{{{{ false }}}}"><textarea class="input" aria-label="Qué ha faltado (opcional)" placeholder="¿Qué ha faltado? (opcional)"></textarea></sc-if>
      <sc-if value="{H('answered')}" hint-placeholder-val="{{{{ false }}}}"><p class="cap muted">Gracias. Nos ayuda a mejorar las orientaciones.</p></sc-if>
    </div>"""


def causes(items):
    return '<div class="list">' + ''.join(f'<div class="li"><span class="grow">{t}</span><span class="tag neutral">{p}</span></div>' for t, p in items) + '</div>'


def bullets(items):
    return '<ul class="ul">' + ''.join(f'<li>{t}</li>' for t in items) + '</ul>'


def result(file, title, lvl, headline, sub, cz, todo, vetif, footer, context='Hemos tenido en cuenta que Kika ha comido algo menos esta semana.'):
    reg(SEC, file, title, page('Orientación · ' + LEVELS[lvl][0], f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Orientación para Kika', 'Home.dc.html', '<span class="cap muted" style="width: 44px; text-align: right">16 oct</span>', 'x', 'Cerrar')}
    <div class="lvl {lvl}" role="status">
      {icon(LEVELS[lvl][1], 24, 2, 'flex: none')}
      <div class="col" style="gap: 4px"><p class="over" style="color: inherit">{LEVELS[lvl][0]}</p><p class="t3">{headline}</p><p class="body">{sub}</p></div>
    </div>
    <div class="col" style="gap: 10px"><h2 class="t3">Posibles causas</h2>{causes(cz)}</div>
    <div class="col" style="gap: 10px"><h2 class="t3">Qué puedes hacer</h2>{bullets(todo)}</div>
    <div class="card warm" style="gap: 8px; color: var(--ink)"><p class="strong">Consulta a tu veterinario si…</p>{bullets(vetif)}</div>
    <p class="cap muted">{context}</p>
    {FEEDBACK}
    {disclaimer()}
  </div>
  {footer}
</div>""", script=FB_SCRIPT))


result('ResultadoObservar.dc.html', '7.8 Resultado · observar', 'observe', 'Vigila cómo camina estos días',
       'No parece urgente. Anota en el registro si la cojera va a menos.',
       [('Un tirón o un golpe leve en el paseo', 'Más probable'), ('Algo clavado en la almohadilla', 'Posible'), ('Una uña rota', 'Posible')],
       ['Revisa la almohadilla y entre los dedos con buena luz.', 'Paseos cortos y tranquilos durante dos días.', 'Anota cada día cómo la ves.'],
       ['La cojera dura más de 3 días o va a más.', 'No apoya la pata o le duele al tocarla.', 'Ves hinchazón o sangre.'],
       foot(btn('Volver al inicio', 'Home.dc.html', 'secondary')), 'Sin foto. Hemos tenido en cuenta que su actividad ha sido la habitual.')

result('Resultado.dc.html', '7.9 Resultado · cambio de rutina', 'routine', 'Unos cuidados en casa y vigilarlo',
       'No parece urgente. Cuídalo en casa y míralo de nuevo en dos días.',
       [('Irritación por polvo, polen o el viento del paseo', 'Más probable'), ('Conjuntivitis leve', 'Posible'), ('Un pelo o una semilla dentro del ojo', 'Posible')],
       ['Limpia el ojo con una gasa y suero fisiológico, de dentro hacia fuera.', 'Evita que se lo frote; si insiste, usa un collar isabelino.', 'Anota en el registro de los próximos días cómo lo ves.'],
       ['Mantiene el ojo cerrado o le molesta la luz.', 'La secreción se vuelve verde o amarilla.', 'No mejora en 48 horas.'],
       foot(btn('Recordarme revisarlo en 2 días', 'Recordatorio.dc.html')))

result('ResultadoPronto.dc.html', '7.10 Resultado · consultar pronto', 'vet', 'Pide cita con tu veterinario estos días',
       'No hace falta ir a urgencias, pero conviene que la vea un profesional pronto.',
       [('Conjuntivitis que no mejora sola', 'Más probable'), ('Una pequeña herida en la córnea', 'Posible'), ('Una alergia', 'Posible')],
       ['Mientras tanto, sigue limpiando el ojo con suero.', 'No le pongas colirios sin indicación veterinaria.', 'Lleva a la cita lo que has anotado estos días.'],
       ['Cierra el ojo del todo o lo ves turbio: ve hoy.', 'Le cuesta abrirlo o llora mucho.'],
       foot(btn('Llamar a mi clínica', 'tel:+34000000000', 'primary', 'phone'), btn('Añadir la cita a la agenda', 'Recordatorio.dc.html', 'secondary md'), cap('[Nombre de la clínica] · [teléfono]')),
       'Lleva 3 días igual según sus registros.')

# 7.11 Urgente (se conserva: pantalla completa, llamar primero)
reg(SEC, 'ResultadoUrgente.dc.html', '7.11 Resultado · urgente', page('Orientación · urgente', f"""
<div class="app urgent-panel" style="background: #B42318; color: #FFFFFF">
  <div class="scr" style="gap: 20px; padding-top: 54px">
    <div class="top">
      <a class="ib" href="Home.dc.html" aria-label="Cerrar" style="color: #FFFFFF">{icon('x', 24)}</a>
      <span class="strong">Orientación para Kika</span>
      <span style="width: 44px"></span>
    </div>
    <div class="col" style="gap: 12px" role="alert">
      <div class="row" style="gap: 10px">{icon('alert', 32)}<span class="over" style="color: #FFFFFF; font-size: 13px">Urgente, acudir ahora</span></div>
      <h1 class="display" style="color: #FFFFFF">Lleva a Kika al veterinario ahora</h1>
      <p class="blg muted">Respirar con dificultad y tener las encías pálidas son señales de alerta que necesitan atención inmediata.</p>
    </div>
    <div class="col" style="gap: 10px">
      <a class="btn urgent" href="tel:+34000000000">{icon('phone', 20)}Llamar a mi clínica</a>
      <a class="btn onurgent" href="#urgencias">{icon('pin', 20)}Urgencias veterinarias cercanas</a>
      <p class="cap muted" style="text-align: center">[Nombre de la clínica] · [teléfono]</p>
    </div>
    <div class="wbox">
      <p class="strong">Mientras vas</p>
      <ul class="ulw">
        <li>Mantén a Kika tranquila y con la cabeza y el cuello estirados.</li>
        <li>No le des comida, agua ni medicamentos.</li>
        <li>Llévala en brazos o en su transportín, sin apretar el pecho.</li>
      </ul>
    </div>
    <p class="cap" style="color: #FFFFFF; opacity: .92">Esta orientación es informativa y no sustituye a un veterinario.</p>
  </div>
</div>""", style="""
.ulw{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.ulw li{display:flex;gap:10px;align-items:flex-start}
.ulw li::before{content:"";width:6px;height:6px;border-radius:999px;background:#FFFFFF;margin-top:8px;flex:none}
.wbox{background:rgba(255,255,255,.12);border-radius:18px;padding:16px;display:flex;flex-direction:column;gap:10px}
"""))

# 7.12 Error de procesamiento
reg(SEC, 'ConsultaError.dc.html', '7.12 Error al preparar la orientación', page('Error en la consulta', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Home.dc.html', icon_name='x', label='Cerrar')}
    <div class="empty" style="padding-top: 48px">
      <div class="ill" style="background: var(--danger-bg); color: var(--danger-ink)">{icon('alert-c', 32)}</div>
      <h1 class="t2">No hemos podido preparar la orientación</h1>
      <p class="muted" style="max-width: 310px">Ha fallado algo por nuestra parte. Tu foto y las señales siguen guardadas: puedes volver a intentarlo.</p>
    </div>
    {URGENT_HINT}
  </div>
  {foot(btn('Volver a intentarlo', 'Analizando.dc.html', 'primary', 'refresh'), '<a class="btn ghost md" href="Home.dc.html">Volver al inicio</a>')}
</div>"""))

# 7.13 Límite del plan gratuito
reg(SEC, 'ConsultaLimite.dc.html', '7.13 Límite de consultas', page('Límite de consultas', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Home.dc.html', icon_name='x', label='Cerrar')}
    <div class="col" style="gap: 8px">
      <p class="over">Plan gratuito</p>
      <h1 class="t1">Has usado tus [LÍMITE] consultas de este mes</h1>
      <p class="muted">Vuelven a estar disponibles el 1 de noviembre. El registro diario y la agenda siguen igual.</p>
    </div>
    {URGENT_HINT}
    <div class="card brand" style="gap: 10px">
      <p class="strong">Con Kitom Premium</p>
      {bullets(['Consultas sin límite.', 'Cada orientación tiene en cuenta todo su historial, no solo 30 días.'])}
    </div>
  </div>
  {foot(btn('Ver Kitom Premium', 'Premium.dc.html'), '<a class="btn ghost md" href="Home.dc.html">Ahora no</a>')}
</div>"""))

# 7.14 Consultas anteriores
def crow(date, title, lvl, sub, href):
    return f'<a class="li" href="{href}" style="align-items: flex-start; padding-top: 12px; padding-bottom: 12px"><span class="col grow" style="gap: 6px"><span class="cap muted mono">{date}</span><span class="strong">{title}</span>{utag(lvl, True)}<span class="cap muted">{sub}</span></span>{icon("chev-r", 20, 2, "color: var(--subtle); margin-top: 22px")}</a>'


reg(SEC, 'Consultas.dc.html', '7.14 Consultas anteriores', page('Consultas anteriores', f"""
<div class="app">
  <div class="scr" style="gap: 18px">
    {top('Consultas de Kika', 'PerfilMascota.dc.html')}
    <div class="list">
      {crow('14 OCT 2026', 'Ojo derecho lloroso', 'routine', 'Con foto · te fue útil', 'Resultado.dc.html')}
      {crow('2 OCT 2026', 'Cojera leve después del paseo', 'observe', 'Sin foto · sin valorar', 'ResultadoObservar.dc.html')}
      {crow('21 SEP 2026', 'Respiración agitada y encías pálidas', 'urgent', 'Con foto · ¿te fue útil? Cuéntanoslo', 'ResultadoUrgente.dc.html')}
    </div>
    <p class="cap muted">Las orientaciones urgentes no piden valoración en el momento; te la pedimos aquí, después.</p>
  </div>
  {foot(btn('Nueva consulta', 'ConsultaIntro.dc.html', 'primary', 'camera'))}
</div>"""))
