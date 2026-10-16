from lib import *

SEC = 'pets'

# 3.1 Perfil mínimo (interactivo: especie; «Otro» aún no disponible)
reg(SEC, 'MascotaNueva.dc.html', '3.1 Perfil mínimo', page('Nueva mascota', f"""
<div class="app">
  <div class="scr">
    <div class="col" style="gap: 8px; padding-top: 8px">
      <p class="over">Tu mascota</p>
      <h1 class="t1">¿A quién vas a cuidar?</h1>
      <p class="muted">Solo necesitamos su nombre y especie. El resto, cuando quieras.</p>
    </div>
    <div style="display: flex; justify-content: center">
      <a class="photo-btn" href="FotoHoja.dc.html" aria-label="Añadir foto (opcional)">{icon('camera', 24)}Foto<span class="cap">opcional</span></a>
    </div>
    <div class="field">
      <label for="name">Nombre</label>
      <input id="name" class="input focus" type="text" value="Kika" maxlength="40">
    </div>
    <div class="field">
      <span class="flabel" id="sp-label">Especie</span>
      <div role="radiogroup" aria-labelledby="sp-label" style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px">
        <sc-for list="{H('species')}" as="s" hint-placeholder-count="3">
          <button class="{H('s.cls')}" role="radio" aria-checked="{H('s.on')}" onClick="{H('s.pick')}">{H('s.label')}</button>
        </sc-for>
      </div>
      <sc-if value="{H('other')}" hint-placeholder-val="{{{{ false }}}}">
        {alert('info', 'info', 'Por ahora, perros y gatos', 'Kitom está pensada y revisada para ellos. Te avisaremos cuando podamos acompañar a otras especies.')}
      </sc-if>
    </div>
  </div>
  <div class="foot">
    <sc-if value="{H('ok')}" hint-placeholder-val="{{{{ true }}}}"><a class="btn primary" href="MascotaLista.dc.html">Crear perfil de Kika</a></sc-if>
    <sc-if value="{H('other')}" hint-placeholder-val="{{{{ false }}}}"><span class="btn disabled" aria-disabled="true">Crear perfil de Kika</span></sc-if>
    <p class="cap muted" style="text-align: center">Raza, edad o peso se piden más adelante, en el momento oportuno.</p>
  </div>
</div>""", style="""
.sp{height:56px;border-radius:14px;border:0;background:var(--surface);box-shadow:inset 0 0 0 1px var(--line);color:var(--ink);font:600 15px/20px 'Hanken Grotesk',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;cursor:pointer}
.sp.on{background:var(--brand);box-shadow:inset 0 0 0 2px var(--primary);color:var(--primary)}
.photo-btn{width:112px;height:112px;border-radius:999px;border:1.5px dashed var(--control);background:var(--surface);color:var(--muted);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;text-decoration:none;font:500 13px/18px 'Hanken Grotesk',system-ui,sans-serif}
""", script=toggle_script({'sp': 'dog'}, """    const opts = [['dog', 'Perro'], ['cat', 'Gato'], ['other', 'Otro']];
    const other = this.state.sp === 'other';
    return {
      other, ok: !other,
      species: opts.map((o) => ({ id: o[0], label: o[1], on: this.state.sp === o[0],
        cls: this.state.sp === o[0] ? 'sp on' : 'sp', pick: () => this.setState({ sp: o[0] }) }))
    };""")))

# 3.2 Foto de la mascota (hoja)
reg(SEC, 'FotoHoja.dc.html', '3.2 Foto · hoja de opciones', page('Foto de la mascota', sheet('Foto de Kika', f"""
        <div class="list">
          {li('Hacer una foto', '', 'camera', href='PermisoFotos.dc.html', chev=False)}
          {li('Elegir de la galería', '', 'image', href='MascotaNueva.dc.html', chev=False)}
          <a class="li" href="MascotaNueva.dc.html" style="color: var(--danger-ink)"><span class="ico" style="background: var(--danger-bg); color: var(--danger-ink)">{icon('trash')}</span><span class="strong grow">Quitar la foto</span></a>
        </div>
        <p class="cap muted">La foto es privada: solo la ves tú. Se recorta en círculo; usa una con su cara bien visible.</p>""",
    close='MascotaNueva.dc.html', behind=behind_title('¿A quién vas a cuidar?'), maxh=440)))

# 3.3 Sin permiso de cámara o fotos
reg(SEC, 'PermisoFotos.dc.html', '3.3 Sin permiso de fotos', page('Sin permiso de fotos', f"""
<div class="app">
  <div class="scr" style="justify-content: center">
    {top('', 'MascotaNueva.dc.html', icon_name='x', label='Cerrar')}
    <div class="empty" style="flex: 1; justify-content: center">
      <div class="ill" style="background: var(--sunken); color: var(--muted)">{icon('camera', 32)}</div>
      <h1 class="t2">Kitom no puede usar la cámara</h1>
      <p class="muted" style="max-width: 300px">Para hacer la foto, permite el acceso a la cámara en los ajustes del móvil. También puedes seguir sin foto y añadirla después.</p>
    </div>
  </div>
  {foot(btn('Abrir los ajustes del móvil', '#ajustes-del-sistema', 'primary', 'ext'), '<a class="btn ghost md" href="MascotaNueva.dc.html">Seguir sin foto</a>')}
</div>"""))

# 3.4 Mascota creada + recordatorio diario (interactivo)
reg(SEC, 'MascotaLista.dc.html', '3.4 Mascota creada', page('Mascota creada', f"""
<div class="app">
  <div class="scr" style="align-items: center; text-align: center; padding-top: 96px">
    <div style="position: relative; width: 200px; height: 200px; display: flex; align-items: center; justify-content: center">
      <div style="position: absolute; inset: 0">{ring(['off'] * 6, 'pending', '', 'Semana vacía; hoy pendiente', 200, 3.2)}</div>
      <div class="av s96 warm" style="width: 104px; height: 104px; font-size: 40px">K</div>
    </div>
    <div class="col" style="gap: 8px; align-items: center">
      <h1 class="t1">Kika ya está en Kitom</h1>
      <p class="blg muted" style="max-width: 300px">Su semana empieza hoy. Cada registro completa un tramo del anillo.</p>
    </div>
    <div class="card" style="width: 100%; text-align: left">
      <div class="between">
        <div class="col" style="gap: 2px"><p class="strong" id="rd">Recordatorio diario</p><p class="cap muted">Una notificación al día, a la hora que elijas.</p></div>
        {sw('on', 'rd', 'toggle')}
      </div>
      <sc-if value="{H('on')}" hint-placeholder-val="{{{{ true }}}}">
        <div class="chips" role="radiogroup" aria-label="Hora del recordatorio">
          <sc-for list="{H('hours')}" as="h" hint-placeholder-count="4">
            <button class="{H('h.cls')}" role="radio" aria-checked="{H('h.on')}" onClick="{H('h.pick')}">{H('h.label')}</button>
          </sc-for>
        </div>
      </sc-if>
    </div>
  </div>
  <div class="foot">
    <a class="btn primary" href="{H('next')}">Hacer su primer registro</a>
    <a class="btn ghost md" href="HomeNuevo.dc.html">Ir al inicio</a>
  </div>
</div>""", script=toggle_script({'on': True, 'h': '20:00'}, """    const on = this.state.on;
    return {
      on, onCls: on ? 'switch on' : 'switch', toggle: () => this.setState({ on: !on }),
      next: on ? 'PermisoAvisos.dc.html' : 'Registro.dc.html',
      hours: ['09:00', '14:00', '20:00', 'Otra'].map((x) => ({ label: x, on: this.state.h === x,
        cls: this.state.h === x ? 'chip on' : 'chip', pick: () => this.setState({ h: x }) }))
    };""")))

# 3.5 Permiso de notificaciones (antes del diálogo del sistema)
reg(SEC, 'PermisoAvisos.dc.html', '3.5 Permiso de avisos', page('Permiso de avisos', f"""
<div class="app">
  <div class="scr" style="gap: 24px; padding-top: 110px">
    <div class="empty" style="padding: 0">
      <div class="ill">{icon('bell', 32)}</div>
      <h1 class="t1">¿Te avisamos a las 20:00?</h1>
      <p class="blg muted" style="max-width: 310px">Tu móvil te pedirá permiso a continuación.</p>
    </div>
    <div class="card" style="gap: 4px">
      {''.join(f'<div class="row" style="min-height: 44px">{icon(i, 20, 2, "color: var(--primary)")}<span>{t}</span></div>' for i, t in [('clock', 'Un aviso al día para el registro, como mucho'), ('calendar', 'Vacunas, medicación y citas de su agenda'), ('eye', 'Cambios en Kika que merece la pena mirar')])}
    </div>
    <p class="cap muted" style="text-align: center">Elige qué avisos recibes en Ajustes › Notificaciones.</p>
  </div>
  {foot(btn('Permitir avisos', 'Registro.dc.html'), '<a class="btn ghost md" href="Registro.dc.html">Ahora no</a>')}
</div>"""))

# 3.6 Perfil de mascota (pestaña Perfil)
PET_SCRIPT = """class Component extends DCLogic {
  renderVals() {
    return { saved: this.props.saved ?? false };
  }
}"""
reg(SEC, 'PerfilMascota.dc.html', '3.6 Perfil de mascota', page('Perfil de Kika', f"""
<div class="app">
  <div class="scr" style="gap: 22px; padding-top: 0; padding-left: 0; padding-right: 0">
    <div class="photo" style="height: 220px; border-radius: 0 0 24px 24px; position: relative; flex: none" role="img" aria-label="Foto de Kika">
      <span>Foto de Kika</span>
      <a class="ib soft" href="SelectorMascota.dc.html" aria-label="Cambiar de mascota" style="position: absolute; top: 54px; left: 16px">{icon('swap', 22)}</a>
      <a class="ib soft" href="Ajustes.dc.html" aria-label="Tu cuenta y ajustes" style="position: absolute; top: 54px; right: 16px">{icon('gear', 22)}</a>
    </div>
    <div class="col" style="gap: 22px; padding: 0 20px">
      <div class="between">
        <div class="col" style="gap: 2px">
          <h1 class="t1">Kika</h1>
          <p class="muted">Perra · mestiza · 5 años</p>
        </div>
        <a class="btn secondary sm" href="CompletarPerfil.dc.html">{icon('pencil', 18)}Editar</a>
      </div>
      <a class="card brand" href="CompletarPerfil.dc.html" style="text-decoration: none; color: inherit; gap: 10px">
        <div class="between"><p class="strong">Completa el perfil de Kika</p><span class="data">6/9</span></div>
        <div class="bar" aria-hidden="true"><i style="width: 66%"></i></div>
        <p class="cap muted">Faltan alergias, enfermedades conocidas y su carácter. Todo es opcional.</p>
      </a>
      <a class="card" href="Logros.dc.html" style="text-decoration: none; color: inherit; flex-direction: row; align-items: center; gap: 14px">
        {ring(['on', 'on', 'off', 'on', 'on', 'on'], 'pending', '4', '4 días seguidos', 56, 6, fs=14)}
        <div class="col grow" style="gap: 2px"><p class="strong">4 días seguidos</p><p class="cap muted">2 de 4 insignias · la próxima, 7 días seguidos</p></div>
        {icon('chev-r', 20, 2, 'color: var(--subtle)')}
      </a>
      <div class="col" style="gap: 8px">
        <p class="over">Cuidar de Kika</p>
        <div class="list">
          {li('Consultar con una foto', 'Orientación con posibles causas y señales de alerta', 'camera', href='ConsultaIntro.dc.html')}
          {li('Consultas anteriores', '3 orientaciones', 'list', href='Consultas.dc.html')}
          {li('Historial de alertas', 'La última, el lunes', 'flag', href='Alertas.dc.html')}
        </div>
      </div>
      <div class="col" style="gap: 8px">
        <p class="over">Con Premium</p>
        <div class="list">
          {li('Añadir otra mascota', '¿Atom también?', 'plus', '<span class="tag neutral">Premium</span>', 'PlanBloqueado.dc.html')}
          {li('Co-tutores', 'Cuida de Kika con otra persona', 'users', '<span class="tmark">Próximamente</span>', chev=False)}
          {li('Informe para el veterinario', 'PDF con su historial', 'file', '<span class="tmark">Próximamente</span>', chev=False)}
        </div>
      </div>
    </div>
  </div>
  <sc-if value="{H('saved')}" hint-placeholder-val="{{{{ false }}}}">
    <div class="toast" role="status">{icon('check', 20, 2.4)}Cambios guardados</div>
  </sc-if>
  {tabbar('perfil')}
</div>""", props={'saved': {'editor': 'boolean', 'default': False}}, script=PET_SCRIPT))

# 3.7 Perfil guardado (confirmación de cambios)
reg(SEC, 'PerfilGuardado.dc.html', '3.7 Perfil · cambios guardados', page('Cambios guardados',
    '<dc-import name="PerfilMascota" saved="{{ true }}" hint-size="390px,844px"></dc-import>'))

# 3.8 Completar / editar perfil
def seg(name, opts, on):
    b = ''.join(f'<button class="{"on" if o == on else ""}" role="radio" aria-checked="{"true" if o == on else "false"}">{o}</button>' for o in opts)
    cls = 'seg three' if len(opts) == 3 else 'seg'
    return f'<div class="field"><span class="flabel" id="{name}">{name.capitalize()}</span><div class="{cls}" role="radiogroup" aria-labelledby="{name}">{b}</div></div>'

reg(SEC, 'CompletarPerfil.dc.html', '3.8 Editar perfil · datos progresivos', page('Editar perfil de Kika', f"""
<div class="app">
  <div class="scr" style="gap: 20px; padding-top: 54px">
    <div class="top">
      <a class="ib" href="PerfilMascota.dc.html" aria-label="Volver">{icon('chev-l', 24)}</a>
      <span class="strong">Perfil de Kika</span>
      <span class="data muted" style="width: 44px; text-align: right">6/9</span>
    </div>
    <div class="row" style="gap: 16px">
      <a href="FotoHoja.dc.html" class="av s64 warm" aria-label="Cambiar la foto" style="text-decoration: none">K</a>
      <div class="field grow"><label for="pn">Nombre</label><input id="pn" class="input" type="text" value="Kika"></div>
    </div>
    <p class="muted">Todo es opcional. Cuanto más sepamos de Kika, mejor se ajustan sus tendencias y orientaciones.</p>
    <div class="field">
      <label for="br">Raza</label>
      <a class="input" id="br" href="#razas" style="justify-content: space-between; text-decoration: none; color: inherit">Mestiza{icon('chev-d', 20)}</a>
      <p class="help">Elige del catálogo, escribe la suya, «mestiza» o «no lo sé».</p>
    </div>
    <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px">
      <div class="field"><label for="bd">Nacimiento</label><input id="bd" class="input mono" type="text" value="03/2021"></div>
      <div class="field"><label for="wt">Peso</label><input id="wt" class="input mono" type="text" value="12,4 kg"></div>
    </div>
    {seg('sexo', ['Hembra', 'Macho', 'No lo sé'], 'Hembra')}
    {seg('esterilizada', ['Sí', 'No', 'No lo sé'], 'Sí')}
    <div class="field"><label for="al">Alergias <span style="font-weight: 400; color: var(--muted)">· opcional</span></label><input id="al" class="input" type="text" placeholder="Por ejemplo, pollo o pulgas"></div>
    <div class="field"><label for="kc">Enfermedades conocidas <span style="font-weight: 400; color: var(--muted)">· opcional</span></label><input id="kc" class="input" type="text" placeholder="Las que te haya dicho tu veterinario"></div>
    <div class="field"><label for="ch">Su carácter <span style="font-weight: 400; color: var(--muted)">· opcional</span></label><textarea id="ch" class="input" placeholder="Cómo es en casa, qué le asusta, qué le encanta"></textarea></div>
    <hr class="divider">
    <a class="btn ghost md" href="EliminarMascota.dc.html" style="color: var(--danger-ink)">{icon('trash', 18)}Eliminar a Kika de Kitom</a>
  </div>
  {foot(btn('Guardar cambios', 'PerfilGuardado.dc.html'))}
</div>"""))

# 3.9 Selector de mascota (hoja)
reg(SEC, 'SelectorMascota.dc.html', '3.9 Selector de mascota · hoja', page('Elegir mascota', sheet('Tus mascotas', f"""
        <div class="list" role="radiogroup" aria-labelledby="sh">
          <a class="opt" role="radio" aria-checked="true" href="Home.dc.html">
            <span class="av s40 warm">K</span>
            <span class="col grow" style="gap: 0"><span class="strong">Kika</span><span class="cap muted">Perra · hoy pendiente</span></span>
            <span class="radio on" aria-hidden="true"></span>
          </a>
          <a class="opt" href="PlanBloqueado.dc.html">
            <span class="av s40" style="background: var(--sunken); color: var(--muted)">{icon('plus', 20)}</span>
            <span class="col grow" style="gap: 0"><span class="strong">Añadir otra mascota</span><span class="cap muted">En el plan gratuito, una mascota</span></span>
            <span class="tag neutral">Premium</span>
          </a>
        </div>
        <p class="cap muted">Con varias mascotas, la que elijas aquí es la que ves en Hoy, Historial y Agenda.</p>""",
    close='Home.dc.html', behind=behind_title('Kika'), maxh=460)))

# 3.10 Sin mascotas
reg(SEC, 'SinMascotas.dc.html', '3.10 Sin mascotas', page('Sin mascotas', f"""
<div class="app">
  <div class="scr" style="justify-content: center">
    <div class="empty">
      <div class="ill">{symbol(36, '#1F6F6B')}</div>
      <h1 class="t1">Todavía no cuidas de ninguna mascota aquí</h1>
      <p class="muted" style="max-width: 300px">Añade a tu perro o a tu gato para empezar su registro diario. Solo te pediremos su nombre y especie.</p>
    </div>
  </div>
  {foot(btn('Añadir mascota', 'MascotaNueva.dc.html', 'primary', 'plus'), '<a class="btn ghost md" href="Ajustes.dc.html">Ir a mi cuenta</a>')}
</div>"""))

# 3.11 Eliminar mascota (diálogo)
reg(SEC, 'EliminarMascota.dc.html', '3.11 Eliminar mascota · diálogo', page('Eliminar mascota', dialog(
    '¿Eliminar a Kika?',
    'Se borrarán su perfil, sus registros, sus fotos y su agenda. No se puede deshacer.',
    '<a class="btn secondary" href="CompletarPerfil.dc.html" autofocus style="box-shadow: inset 0 0 0 2px var(--primary)">Cancelar</a>'
    '<a class="btn danger" href="SinMascotas.dc.html">Eliminar a Kika</a>',
    ic='trash', behind='<div style="padding: 58px 20px 0" aria-hidden="true"><p class="strong" style="text-align: center">Perfil de Kika</p></div>')))
