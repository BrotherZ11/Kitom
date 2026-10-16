from lib import *

# =============================================================== 9 · Logros y vínculo
SEC = 'bond'

BADGES = [('first_log', 'Primer registro', 'got', 'medal', 'Ganada el 12 jun'),
          ('streak_7', '7 días seguidos', 'prog', None, '4 de 7'),
          ('first_photo_scan', 'Primera consulta con foto', 'got', 'camera', 'Ganada el 14 oct'),
          ('streak_30', 'Constancia mensual', 'lock', 'lock', '30 días seguidos')]


def badge(code, title, state, ic, sub):
    inner = icon(ic, 26) if ic else '<span class="data" style="font-size: 15px">4/7</span>'
    return f'<a class="bd" href="LogroDetalle.dc.html" aria-label="{title}: {sub}"><span class="medal {state}">{inner}</span><span class="label">{title}</span><span class="cap muted">{sub}</span></a>'


def week_dots():
    days = [('L', 'on'), ('M', 'on'), ('X', 'on'), ('J', 'today'), ('V', ''), ('S', ''), ('D', '')]
    out = ''
    for d, st in days:
        cls = {'on': 'on', 'today': 'today', '': ''}[st]
        inner = icon('check', 14, 3) if st == 'on' else ''
        lab = {'on': 'registrado', 'today': 'hoy, pendiente', '': 'por llegar'}[st]
        out += f'<span aria-label="{d}: {lab}"><i class="{cls}">{inner}</i>{d}</span>'
    return f'<div class="week" role="list" aria-label="Esta semana">{out}</div>'


LG_SCRIPT = toggle_script({'voice': True}, """    const v = this.state.voice;
    return { voice: v, voiceCls: v ? 'switch on' : 'switch', toggleVoice: () => this.setState({ voice: !v }) };""")
reg(SEC, 'Logros.dc.html', '9.1 Logros y racha', page('Logros de Kika', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Logros de Kika', 'PerfilMascota.dc.html')}
    <div class="card" style="align-items: center; text-align: center; gap: 10px; padding: 20px">
      {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'pending', '4', '4 días seguidos; hoy pendiente', 132, fs=16, sub='DÍAS SEGUIDOS')}
      <p class="muted">Su mejor racha: <span class="data" style="color: var(--ink)">12</span> días, en agosto.</p>
    </div>
    <div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Esta semana</h2><span class="cap muted">3 de 7</span></div>
      {week_dots()}
    </div>
    <div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Insignias</h2><span class="cap muted">2 de 4</span></div>
      <div class="badges">{''.join(badge(*b) for b in BADGES)}</div>
    </div>
    <div class="card flat" style="gap: 6px">
      <div class="between"><p class="strong">Retos de la semana</p><span class="tmark">Próximamente</span></div>
      <p class="cap muted">Pequeños planes para hacer juntos, como un paseo por un sitio nuevo. Sin puntos ni presión.</p>
    </div>
    <div class="list">
      <div class="li"><span class="col grow" style="gap: 0"><span class="strong" id="pv">Mensajes de Kika</span><span class="cap muted">Frases cortas en primera persona en la pantalla Hoy</span></span>
        <button class="swbtn" role="switch" aria-checked="{H('voice')}" aria-labelledby="pv" onClick="{H('toggleVoice')}"><span class="{H('voiceCls')}"></span></button></div>
    </div>
    <p class="cap muted">Si un día no registras, la racha vuelve a empezar y ya está. Lo que cuenta es el conjunto.</p>
  </div>
</div>""", script=LG_SCRIPT))

reg(SEC, 'LogroDetalle.dc.html', '9.2 Detalle de insignia · hoja', page('Detalle de insignia', sheet('', f"""
        <div class="col" style="align-items: center; text-align: center; gap: 12px">
          <span class="medal prog big"><span class="dlg">4/7</span></span>
          <h2 class="t2">7 días seguidos</h2>
          <p class="muted" style="max-width: 300px">Registra el bienestar de Kika siete días seguidos. Es la mejor forma de que Kitom aprenda qué es lo normal en ella.</p>
          <div class="bar" role="img" aria-label="4 de 7 días" style="width: 100%"><i style="width: 57%; background: var(--accent)"></i></div>
          <p class="cap muted">Lleváis 4. Si seguís, el domingo la tenéis.</p>
        </div>""", close='Logros.dc.html', footer=btn('Entendido', 'Logros.dc.html', 'secondary'), behind=behind_title('Logros de Kika'), maxh=520)))

reg(SEC, 'LogroNuevo.dc.html', '9.3 Insignia conseguida', page('Insignia conseguida', f"""
<div class="app">
  <div class="scr" style="align-items: center; text-align: center; padding-top: 100px; gap: 24px">
    <div style="position: relative; width: 200px; height: 200px; display: flex; align-items: center; justify-content: center">
      <div style="position: absolute; inset: 0">{ring(['on'] * 6, 'done', '', 'Siete de siete días', 200, 3.4)}</div>
      <span class="medal got big">{icon('medal', 52, 1.8)}</span>
    </div>
    <div class="col" style="gap: 8px; align-items: center">
      <span class="tag sol">Nueva insignia</span>
      <h1 class="t1">Primera semana completa</h1>
      <p class="blg muted" style="max-width: 300px">Siete días seguidos cuidando de Kika. Ya sabemos mucho mejor qué es lo normal en ella.</p>
    </div>
  </div>
  {foot(btn('Seguir', 'HomeHecho.dc.html'), '<a class="btn ghost md" href="Logros.dc.html">Ver sus logros</a>')}
</div>"""))

# =============================================================== 10 · Perfil de usuario y ajustes
SEC = 'settings'

AJ_SCRIPT = toggle_script({'theme': 'system', 'voice': True}, """    const opts = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']];
    const v = this.state.voice;
    return {
      appCls: this.state.theme === 'dark' ? 'app dark' : 'app',
      themes: opts.map((o) => ({ label: o[1], on: this.state.theme === o[0], cls: this.state.theme === o[0] ? 'on' : '', pick: () => this.setState({ theme: o[0] }) })),
      voice: v, voiceCls: v ? 'switch on' : 'switch', toggleVoice: () => this.setState({ voice: !v })
    };""")
val = lambda t: f'<span class="muted" style="font-size: 14px">{t}</span>'
reg(SEC, 'Ajustes.dc.html', '10.1 Tu cuenta y ajustes', page('Tu cuenta y ajustes', f"""
<div class="{H('appCls')}">
  <div class="scr" style="gap: 20px; padding-top: 54px">
    {top('Tu cuenta', 'PerfilMascota.dc.html')}
    <div class="card" style="flex-direction: row; align-items: center; gap: 14px">
      <div class="av s64">D</div>
      <div class="col grow" style="gap: 2px"><p class="t3">David</p><p class="cap muted">david@ejemplo.com</p><span class="tag neutral" style="align-self: flex-start; margin-top: 4px">Plan gratuito</span></div>
      <a class="btn primary sm" href="Premium.dc.html">Mejorar</a>
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Preferencias</p>
      <div class="list">
        {li('Idioma', '', 'globe', val('Español'), 'Idioma.dc.html', strong=False)}
        {li('Zona horaria', '', 'clock', val('Europa/Madrid'), chev=False, strong=False)}
        <div class="li" style="flex-direction: column; align-items: stretch; gap: 10px; padding-top: 12px; padding-bottom: 14px">
          <span class="row"><span class="ico">{icon('moon')}</span><span id="th">Tema</span></span>
          <div class="seg three" role="radiogroup" aria-labelledby="th">
            <sc-for list="{H('themes')}" as="t" hint-placeholder-count="3"><button class="{H('t.cls')}" role="radio" aria-checked="{H('t.on')}" onClick="{H('t.pick')}">{H('t.label')}</button></sc-for>
          </div>
        </div>
        <div class="li"><span class="ico">{icon('chat')}</span><span class="col grow" style="gap: 0"><span id="pv">Mensajes de Kika</span><span class="cap muted">Frases en primera persona en Hoy</span></span>
          <button class="swbtn" role="switch" aria-checked="{H('voice')}" aria-labelledby="pv" onClick="{H('toggleVoice')}"><span class="{H('voiceCls')}"></span></button></div>
        {li('Notificaciones', 'Registro diario a las 20:00', 'bell', href='AvisosAjustes.dc.html', strong=False)}
        {li('Mi clínica veterinaria', 'Para llamar con un toque en una urgencia', 'phone', val('Añadir'), '#clinica', strong=False)}
      </div>
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Cuenta y privacidad</p>
      <div class="list">
        {li('Seguridad y acceso', 'Google · email', 'key', href='Seguridad.dc.html', strong=False)}
        {li('Privacidad y consentimientos', '', 'shield', href='Consentimientos.dc.html', strong=False)}
        {li('Fotos', 'Las de Kika, sus consultas y su agenda', 'image', href='Fotos.dc.html', strong=False)}
        {li('Exportar mis datos', '', 'download', href='Exportar.dc.html', strong=False)}
        {li('Suscripción', 'Plan gratuito', 'heart', href='Premium.dc.html', strong=False)}
      </div>
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Ayuda</p>
      <div class="list">
        {li('Ayuda y contacto', '', 'help', href='Ayuda.dc.html', strong=False)}
        {li('Información legal y de la app', '', 'file', href='Legal.dc.html', strong=False)}
      </div>
    </div>
    <div class="list">
      <a class="li" href="Main.dc.html" style="color: var(--primary); font-weight: 600">{icon('logout', 20)}Cerrar sesión</a>
      <a class="li" href="EliminarCuenta.dc.html" style="color: var(--danger-ink); font-weight: 600">{icon('trash', 20)}Eliminar mi cuenta</a>
    </div>
    <p class="cap muted" style="text-align: center">Kitom 1.0 · Hecha para Atom y Kika</p>
  </div>
</div>""", script=AJ_SCRIPT))

reg(SEC, 'Seguridad.dc.html', '10.2 Seguridad y acceso', page('Seguridad y acceso', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Seguridad y acceso', 'Ajustes.dc.html')}
    <div class="list">
      {li('Email', 'david@ejemplo.com', 'mail', '<span class="tag success">' + icon('check', 14, 2.6) + 'Verificado</span>', strong=False)}
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Formas de entrar</p>
      <div class="list">
        <div class="li"><span class="ico">{GOOGLE}</span><span class="col grow" style="gap: 0"><span>Google</span><span class="cap muted">Conectada</span></span></div>
        {li('Email y contraseña', 'Cambiar la contraseña', 'key', href='CambiarClave.dc.html', strong=False)}
        {li('Teléfono', 'Entra con un código por SMS', 'phone-dev', val('Añadir'), 'Telefono.dc.html', strong=False)}
      </div>
    </div>
    {btn('Cerrar sesión en todos los dispositivos', 'Main.dc.html', 'secondary', 'logout')}
    <p class="cap muted">Si cierras sesión, los registros que aún no se hayan subido se subirán la próxima vez que entres en este móvil.</p>
  </div>
</div>"""))

reg(SEC, 'CambiarClave.dc.html', '10.3 Cambiar contraseña', page('Cambiar contraseña', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Cambiar contraseña', 'Seguridad.dc.html')}
    <div class="field">
      <label for="c1">Contraseña nueva</label>
      <input id="c1" class="input error" type="password" value="kika" aria-invalid="true" aria-describedby="c1-e">
      <p id="c1-e" class="err">{icon('alert-c', 14, 2.4)}Necesita al menos 8 caracteres.</p>
    </div>
    <div class="field">
      <label for="c2">Repite la contraseña</label>
      <input id="c2" class="input off" type="password" value="" disabled aria-describedby="c2-h">
      <p id="c2-h" class="help">Primero escribe una contraseña válida.</p>
    </div>
  </div>
  {foot('<span class="btn disabled" aria-disabled="true">Guardar contraseña</span>')}
</div>"""))

CS_SCRIPT = toggle_script({'c1': True, 'c2': False, 'mk': False}, """    const s = this.state;
    const f = (k) => ({ on: s[k], cls: s[k] ? 'switch on' : 'switch', toggle: () => this.setState({ [k]: !s[k] }) });
    return { c1: f('c1'), c2: f('c2'), mk: f('mk') };""")


def swrow(key, lid, title, sub):
    return f"""<div class="li" style="align-items: flex-start; padding-top: 12px; padding-bottom: 12px">
        <span class="col grow" style="gap: 2px"><span class="strong" id="{lid}">{title}</span><span class="cap muted">{sub}</span></span>
        <button class="swbtn" role="switch" aria-checked="{H(key + '.on')}" aria-labelledby="{lid}" onClick="{H(key + '.toggle')}"><span class="{H(key + '.cls')}"></span></button>
      </div>"""


reg(SEC, 'Consentimientos.dc.html', '10.4 Privacidad y consentimientos', page('Privacidad y consentimientos', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Privacidad', 'Ajustes.dc.html')}
    <div class="list">
      {li('Aviso veterinario', 'Aceptado el 16 jun 2026 · versión 1.0', 'steth', href='Aviso.dc.html', strong=False)}
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Fotos</p>
      <div class="list">
        {swrow('c1', 'p1', 'Usar mis fotos para preparar la orientación', 'Si lo desactivas, podrás consultar sin foto.')}
        {swrow('c2', 'p2', 'Ayudar a mejorar Kitom con mis fotos', 'Opcional. Anónimas y revisadas por veterinarios.')}
      </div>
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Comunicaciones</p>
      <div class="list">{swrow('mk', 'p3', 'Consejos y novedades por email', 'Como mucho, uno al mes.')}</div>
    </div>
    <p class="cap muted">Puedes leer la <a href="Legal.dc.html">Política de privacidad</a> o pedir tus datos en <a href="Exportar.dc.html">Exportar mis datos</a>.</p>
  </div>
</div>""", script=CS_SCRIPT))

FT_SCRIPT = toggle_script({'tab': 'ai'}, """    const tabs = [['pet', 'Kika'], ['ai', 'Consultas'], ['agenda', 'Agenda']];
    return { tabs: tabs.map((t) => ({ label: t[1], on: this.state.tab === t[0], cls: this.state.tab === t[0] ? 'on' : '', pick: () => this.setState({ tab: t[0] }) })) };""")
grid = ''.join(f'<a class="photo" href="#foto-{i}" style="aspect-ratio: 1; border-radius: 12px; text-decoration: none" aria-label="{t}"><span>{t}</span></a>' for i, t in enumerate(['14 oct', '2 oct', '21 sep', '12 ago', '30 jul', '9 jul']))
reg(SEC, 'Fotos.dc.html', '10.5 Gestión de fotos', page('Gestión de fotos', f"""
<div class="app">
  <div class="scr" style="gap: 18px">
    {top('Fotos', 'Ajustes.dc.html')}
    <div class="seg three" role="tablist" aria-label="Tipo de foto">
      <sc-for list="{H('tabs')}" as="t" hint-placeholder-count="3"><button class="{H('t.cls')}" role="tab" aria-selected="{H('t.on')}" onClick="{H('t.pick')}">{H('t.label')}</button></sc-for>
    </div>
    <div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">{grid}</div>
    <p class="cap muted">Tus fotos son privadas. Solo se muestran dentro de Kitom con enlaces temporales.</p>
    <a class="btn ghost md" href="#borrar" style="color: var(--danger-ink)">{icon('trash', 18)}Borrar las fotos de las consultas</a>
  </div>
</div>""", script=FT_SCRIPT))

EX_SCRIPT = toggle_script({'sent': False}, """    const sent = this.state.sent;
    return { sent, form: !sent, go: () => this.setState({ sent: true }) };""")
reg(SEC, 'Exportar.dc.html', '10.6 Exportar mis datos', page('Exportar mis datos', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Exportar mis datos', 'Ajustes.dc.html')}
    <p class="muted">Prepararemos un archivo con todo lo que guardas en Kitom para que lo descargues o lo lleves a otra app.</p>
    <div class="list">
      {li('Tu cuenta y tus preferencias', '', 'user', strong=False)}
      {li('El perfil de Kika y sus registros', 'Como tabla (CSV) y como datos (JSON)', 'chart', strong=False)}
      {li('Consultas, agenda y adjuntos', '', 'calendar', strong=False)}
      {li('Fotos', 'En su tamaño original', 'image', strong=False)}
    </div>
    <sc-if value="{H('sent')}" hint-placeholder-val="{{{{ false }}}}">{alert('ok', 'mail', 'Estamos preparando tu archivo', 'Te enviaremos el enlace a david@ejemplo.com. Puede tardar unos minutos.')}</sc-if>
  </div>
  <div class="foot">
    <sc-if value="{H('form')}" hint-placeholder-val="{{{{ true }}}}"><button class="btn primary" onClick="{H('go')}">{icon('download', 20)}Preparar mi archivo</button></sc-if>
    <sc-if value="{H('sent')}" hint-placeholder-val="{{{{ false }}}}"><a class="btn secondary" href="Ajustes.dc.html">Volver a ajustes</a></sc-if>
  </div>
</div>""", script=EX_SCRIPT))

FAQ = [('¿Kitom sustituye al veterinario?', 'No. Kitom te ayuda a observar y te orienta sobre cuándo consultar, pero no confirma enfermedades. Ante cualquier duda seria, llama a tu veterinario.'),
       ('¿Cómo funciona la racha?', ''), ('¿Qué pasa si registro sin conexión?', ''), ('¿Quién puede ver mis fotos?', ''), ('¿Cómo cancelo Premium?', '')]
AY_SCRIPT = toggle_script({'open': 0}, """    const faq = %s;
    return { faq: faq.map((f, i) => ({ q: f[0], a: f[1], open: this.state.open === i, chevStyle: this.state.open === i ? 'transform: rotate(180deg)' : '',
      toggle: () => this.setState({ open: this.state.open === i ? -1 : i }) })) };""" % str([list(x) for x in FAQ]))
reg(SEC, 'Ayuda.dc.html', '10.7 Ayuda y contacto', page('Ayuda y contacto', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Ayuda', 'Ajustes.dc.html')}
    <div class="list">
      <sc-for list="{H('faq')}" as="f" hint-placeholder-count="5">
        <div style="border-bottom: 1px solid var(--line)">
          <button class="opt" aria-expanded="{H('f.open')}" onClick="{H('f.toggle')}" style="border: 0"><span class="strong grow">{H('f.q')}</span><span style="{H('f.chevStyle')}; display: flex; color: var(--subtle)">{icon('chev-d', 20)}</span></button>
          <sc-if value="{H('f.open')}" hint-placeholder-val="{{{{ false }}}}"><p class="muted" style="padding: 0 16px 14px">{H('f.a')}</p></sc-if>
        </div>
      </sc-for>
    </div>
    <div class="card" style="gap: 8px">
      <p class="strong">¿No encuentras lo que buscas?</p>
      <p class="cap muted">Te respondemos por email en un día laborable, como mucho.</p>
      {btn('Escríbenos', 'mailto:[EMAIL DE SOPORTE]', 'secondary md', 'mail')}
    </div>
    {alert('bad', 'alert', 'En una urgencia, no escribas: llama', 'Si tu mascota no respira bien, convulsiona o sangra, llama a tu veterinario o a urgencias veterinarias.', 'note')}
  </div>
</div>""", script=AY_SCRIPT))

reg(SEC, 'Legal.dc.html', '10.8 Información legal y de la app', page('Información legal', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Legal e información', 'Ajustes.dc.html')}
    <div class="list">
      {li('Términos de uso', '', 'file', '<span class="tmark">[Pendiente de asesoría]</span>', '#terminos', strong=False)}
      {li('Política de privacidad', '', 'shield', '<span class="tmark">[Pendiente de asesoría]</span>', '#privacidad', strong=False)}
      {li('Aviso veterinario', 'Versión 1.0', 'steth', href='Aviso.dc.html', strong=False)}
      {li('Licencias de código abierto', '', 'list', href='#licencias', strong=False)}
    </div>
    <div class="card" style="align-items: center; text-align: center; gap: 10px; padding: 24px">
      {symbol(48, '#0E3B39')}
      <p class="strong">Kitom 1.0.0</p>
      <p class="cap muted mono">build [N] · iOS</p>
      <p class="cap muted">Hecha para Atom y Kika, y para el tuyo.</p>
    </div>
  </div>
</div>"""))

reg(SEC, 'EliminarCuenta.dc.html', '10.9 Eliminar cuenta · diálogo', page('Eliminar cuenta', dialog(
    '¿Eliminar tu cuenta?', 'Se borrará todo y no se puede deshacer:',
    '<a class="btn secondary" href="Ajustes.dc.html" autofocus style="box-shadow: inset 0 0 0 2px var(--primary)">Cancelar</a><a class="btn danger" href="Main.dc.html">Eliminar mi cuenta</a>',
    ic='trash', extra="""<ul class="ul ulr">
          <li>Tu cuenta y tus datos personales.</li>
          <li>El perfil de Kika, sus 124 registros y sus fotos.</li>
          <li>La agenda y las orientaciones guardadas.</li>
        </ul>
        <p class="cap muted">Si quieres conservarlos, <a href="Exportar.dc.html">exporta tus datos</a> antes.</p>""",
    behind='<div style="padding: 58px 20px 0" aria-hidden="true"><p class="strong" style="text-align: center">Tu cuenta</p></div>'),
    style='.ulr li::before{background:var(--danger-ink)}'))

# =============================================================== 11 · Suscripción y Premium
SEC = 'premium'
PR_SCRIPT = toggle_script({'plan': 'year'}, """    const year = this.state.plan === 'year';
    return { isYear: year, isMonth: !year, yearCls: year ? 'plan on' : 'plan', monthCls: year ? 'plan' : 'plan on',
      cta: year ? 'Continuar con el plan anual' : 'Continuar con el plan mensual',
      pickYear: () => this.setState({ plan: 'year' }), pickMonth: () => this.setState({ plan: 'month' }) };""")
soon = '<span class="tmark" style="font-size: 10px">Pronto</span>'
reg(SEC, 'Premium.dc.html', '11.1 Kitom Premium · comparativa', page('Kitom Premium', f"""
<div class="app">
  <div class="scr" style="gap: 20px; padding-top: 54px">
    <div class="top"><a class="ib" href="Home.dc.html" aria-label="Cerrar">{icon('x', 24)}</a><a class="link" href="RestaurarCompras.dc.html" style="font-size: 14px">Restaurar compras</a></div>
    <div class="col" style="gap: 8px">
      <p class="over">Kitom Premium</p>
      <h1 class="t1">Todo su historial, para cuidarla mejor</h1>
      <p class="muted">Más contexto en cada orientación y todas tus mascotas en un sitio.</p>
    </div>
    <div class="cmp">
      <span class="h" style="text-align: left">Incluye</span><span class="h">Gratis</span><span class="h" style="color: var(--primary)">Premium</span>
      <span>Registro diario y agenda</span><span class="c">Sí</span><span class="p">Sí</span>
      <span>Historial</span><span class="c">30 días</span><span class="p">Completo</span>
      <span>Mascotas</span><span class="c">1</span><span class="p">Sin límite</span>
      <span>Consultas con foto</span><span class="c">[LÍMITE]</span><span class="p">Sin límite</span>
      <span>La orientación usa todo su historial</span><span class="c">30 días</span><span class="p">Sí</span>
      <span>Adjuntos en la agenda</span><span class="c">[LÍMITE]</span><span class="p">Sin límite</span>
      <span class="row" style="gap: 6px">Informe PDF para el veterinario {soon}</span><span class="c">No</span><span class="p">Sí</span>
      <span class="row" style="gap: 6px">Co-tutores {soon}</span><span class="c">No</span><span class="p">Sí</span>
    </div>
    <div class="col" role="radiogroup" aria-label="Plan" style="gap: 10px">
      <button class="{H('yearCls')}" role="radio" aria-checked="{H('isYear')}" onClick="{H('pickYear')}"><span class="radio" aria-hidden="true"></span><span class="col grow" style="gap: 0"><span class="strong">Anual</span><span class="cap muted">[PRECIO AL AÑO] · equivale a [PRECIO/MES]</span></span><span class="tag sol">[AHORRO]</span></button>
      <button class="{H('monthCls')}" role="radio" aria-checked="{H('isMonth')}" onClick="{H('pickMonth')}"><span class="radio" aria-hidden="true"></span><span class="col grow" style="gap: 0"><span class="strong">Mensual</span><span class="cap muted">[PRECIO AL MES]</span></span></button>
    </div>
    <p class="cap muted">«Pronto» significa que llegará en una próxima versión; no lo cobramos como si ya estuviera.</p>
  </div>
  <div class="foot">
    <a class="btn primary" href="PremiumActivo.dc.html">{H('cta')}</a>
    <p class="cap muted" style="text-align: center">Se renueva automáticamente. Cancela cuando quieras desde tu tienda de apps.</p>
  </div>
</div>""", script=PR_SCRIPT))

ok = lambda t: f'<div class="row" style="min-height: 44px"><span style="width: 28px; height: 28px; border-radius: 999px; background: var(--success-bg); color: var(--success-fg); display: flex; align-items: center; justify-content: center; flex: none">{icon("check", 16, 3)}</span>{t}</div>'
reg(SEC, 'PremiumActivo.dc.html', '11.2 Premium activado', page('Premium activado', f"""
<div class="app">
  <div class="scr" style="gap: 24px; padding-top: 110px">
    <div class="row" style="justify-content: center; gap: 0">
      <div class="av s64 warm" style="box-shadow: 0 0 0 4px var(--bg)">K</div>
      <div style="width: 64px; height: 64px; border-radius: 999px; border: 1.5px dashed var(--control); display: flex; align-items: center; justify-content: center; color: var(--muted); background: var(--bg); margin-left: -10px" aria-hidden="true">{icon('plus', 22)}</div>
    </div>
    <div class="col" style="gap: 8px; text-align: center; align-items: center">
      <span class="tag sol">Premium</span>
      <h1 class="t1">Ya tienes Kitom Premium</h1>
      <p class="blg muted" style="max-width: 310px">Gracias por apoyar Kitom. Esto se activa desde hoy:</p>
    </div>
    <div class="card" style="gap: 4px">
      {ok('El historial completo de Kika, desde junio')}
      {ok('Orientaciones con todo su historial')}
      {ok('Más mascotas en tu cuenta')}
      {ok('Informe PDF y co-tutores, en cuanto lleguen')}
    </div>
    <p class="cap muted" style="text-align: center">Lo confirma nuestro servidor con tu tienda de apps; puede tardar unos segundos.</p>
  </div>
  {foot(btn('Añadir otra mascota', 'MascotaNueva.dc.html'), '<a class="btn ghost md" href="HomeHecho.dc.html">Ir al inicio</a>')}
</div>"""))

reg(SEC, 'Suscripcion.dc.html', '11.3 Gestionar suscripción', page('Gestionar suscripción', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Suscripción', 'Ajustes.dc.html')}
    <div class="card" style="gap: 10px">
      <div class="between"><span class="tag sol">Premium</span><span class="tag success">{icon('check', 14, 2.6)}Activa</span></div>
      <p class="t2">Plan anual</p>
      <p class="muted">Se renueva el <span class="strong" style="color: var(--ink)">16 oct 2027</span> por [PRECIO AL AÑO].</p>
    </div>
    <div class="list">
      {li('Gestionar el pago en App Store', 'Cambiar de plan o de método de pago', 'ext', href='#app-store', strong=False)}
      {li('Restaurar compras', 'Si cambias de móvil', 'refresh', href='RestaurarCompras.dc.html', strong=False)}
    </div>
    <div class="card flat" style="gap: 6px">
      <p class="strong">Si cancelas</p>
      <p class="cap muted">Sigues con Premium hasta el 16 oct 2027. Después vuelves al plan gratuito y ves los últimos 30 días; lo anterior queda guardado.</p>
      <a class="link" href="SuscripcionCancelada.dc.html" style="color: var(--danger-ink)">Cancelar la suscripción</a>
    </div>
  </div>
</div>"""))

reg(SEC, 'SuscripcionCancelada.dc.html', '11.4 Suscripción cancelada', page('Suscripción cancelada', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('Suscripción', 'Ajustes.dc.html')}
    <div class="card" style="gap: 10px">
      <div class="between"><span class="tag sol">Premium</span><span class="tag neutral">{icon('clock', 14)}No se renovará</span></div>
      <p class="t2">Premium hasta el 16 oct 2027</p>
      <p class="muted">Después vuelves al plan gratuito: historial de 30 días, una mascota y [LÍMITE] consultas al mes. No se borra nada.</p>
    </div>
    {btn('Reactivar en App Store', '#app-store', 'secondary', 'ext')}
    <p class="cap muted">La cancelación y los reembolsos los gestiona tu tienda de apps.</p>
  </div>
</div>"""))

reg(SEC, 'RestaurarCompras.dc.html', '11.5 Restaurar compras · diálogo', page('Restaurar compras', dialog(
    'No hemos encontrado compras', 'No hay ninguna suscripción de Kitom en esta cuenta de App Store. Si pagaste con otra cuenta, entra con ella e inténtalo de nuevo.',
    '<a class="btn primary" href="Premium.dc.html" autofocus>Entendido</a><a class="btn ghost md" href="Ayuda.dc.html">Pedir ayuda</a>',
    ic='refresh', ictone='brand', behind=behind_title('Kitom Premium'))))

reg(SEC, 'PlanBloqueado.dc.html', '11.6 Contenido de Premium · hoja', page('Función de Premium', sheet('Más mascotas, con Premium', f"""
        <p class="muted">En el plan gratuito cuidas de una mascota. Con Premium puedes añadir a Atom y a todas las que quieras, cada una con su historial.</p>
        <div class="row" style="gap: 0"><div class="av s64 warm" style="box-shadow: 0 0 0 4px var(--raised)">K</div><div class="av s64" style="margin-left: -12px; box-shadow: 0 0 0 4px var(--raised)">A</div><div class="av s64" style="margin-left: -12px; background: var(--sunken); color: var(--muted); box-shadow: 0 0 0 4px var(--raised)">{icon('plus', 22)}</div></div>""",
    close='PerfilMascota.dc.html', footer=btn('Ver Kitom Premium', 'Premium.dc.html') + '<a class="btn ghost md" href="PerfilMascota.dc.html">Ahora no</a>', behind=behind_title('Kika'), maxh=460)))

# =============================================================== 12 · Estados globales
SEC = 'global'
reg(SEC, 'Cargando.dc.html', '12.1 Cargando', page('Cargando', f"""
<div class="app">
  <div class="scr" style="gap: 20px" aria-busy="true" aria-label="Cargando">
    <div class="top"><div class="row" style="gap: 12px"><div class="sk" style="width: 40px; height: 40px; border-radius: 999px"></div><div class="col" style="gap: 6px"><div class="sk" style="width: 90px; height: 10px"></div><div class="sk" style="width: 60px; height: 16px"></div></div></div><div class="sk" style="width: 110px; height: 36px"></div></div>
    <div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px"><div class="sk" style="width: 104px; height: 104px; border-radius: 999px"></div><div class="col grow" style="gap: 8px"><div class="sk" style="height: 20px; width: 80%"></div><div class="sk" style="height: 12px; width: 95%"></div><div class="sk" style="height: 12px; width: 60%"></div></div></div>
      <div class="sk" style="height: 52px; border-radius: 14px"></div>
    </div>
    <div class="sk" style="height: 120px; border-radius: 18px"></div>
    <div class="sk" style="height: 56px; border-radius: 18px"></div>
  </div>
  {tabbar('hoy')}
</div>"""))

reg(SEC, 'SinConexion.dc.html', '12.2 Sin conexión', page('Sin conexión', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {pet_head(right='<span class="btn secondary sm" aria-disabled="true" style="opacity: .5">' + icon('camera', 18) + 'Consultar</span>')}
    <div class="banner" role="status">{icon('wifi-off', 20, 2, 'color: var(--muted)')}<span class="grow">Sin conexión. Puedes registrar el día igual; lo subiremos al volver.</span></div>
    <div class="card" style="padding: 20px; gap: 16px">
      <div class="row" style="gap: 16px; align-items: center">
        {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'pending', '5/7', '5 de 7 días; hoy pendiente')}
        <div class="col grow" style="gap: 4px"><h1 class="t2">Falta el registro de hoy</h1><p class="muted">Funciona sin conexión.</p></div>
      </div>
      <a class="btn primary" href="Registro.dc.html">Registrar el día</a>
    </div>
    <div class="col" style="gap: 10px">
      <div class="between"><h2 class="t3">Próximo</h2><span class="cap muted">Actualizado a las 18:20</span></div>
      <div class="list">{li('Desparasitación interna', 'Sábado 18 · 10:00', 'pill', href='RecordatorioDetalle.dc.html')}</div>
    </div>
  </div>
  {tabbar('hoy')}
</div>"""))

reg(SEC, 'ErrorRed.dc.html', '12.3 Error de carga', page('Error de carga', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    <div class="top"><h1 class="t1">Historial</h1><div class="av s40 warm">K</div></div>
    <div class="empty" style="flex: 1; justify-content: center">
      <div class="ill" style="background: var(--sunken); color: var(--muted)">{icon('wifi-off', 32)}</div>
      <h2 class="t2">No hemos podido cargar el historial</h2>
      <p class="muted" style="max-width: 300px">Revisa la conexión y vuelve a intentarlo. Tus registros están a salvo.</p>
      {btn('Volver a intentarlo', 'Tendencias.dc.html', 'secondary md auto', 'refresh')}
    </div>
  </div>
  {tabbar('hist')}
</div>"""))

reg(SEC, 'SesionCaducada.dc.html', '12.4 Sesión caducada · diálogo', page('Sesión caducada', dialog(
    'Vuelve a entrar', 'Tu sesión ha caducado por seguridad. Lo que no se haya subido sigue guardado en este móvil.',
    '<a class="btn primary" href="Login.dc.html" autofocus>Entrar de nuevo</a>',
    ic='lock', ictone='brand', behind=behind_title('Hoy'))))
