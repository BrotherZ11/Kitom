from lib import *

SEC = 'onb'

# 2.1 Tu perfil
reg(SEC, 'TuPerfil.dc.html', '2.1 Tu perfil', page('Tu perfil', f"""
<div class="app">
  <div class="scr" style="gap: 22px">
    <div class="top"><span style="width: 44px"></span>{dots(1)}<span style="width: 44px"></span></div>
    <div class="col" style="gap: 8px">
      <h1 class="t1">¿Cómo te llamamos?</h1>
      <p class="muted">Lo usamos para saludarte. Puedes cambiarlo cuando quieras.</p>
    </div>
    <div class="field">
      <label for="nm">Tu nombre</label>
      <input id="nm" class="input focus" type="text" value="David" autocomplete="given-name">
      <p class="help">Lo hemos tomado de tu cuenta de Google.</p>
    </div>
    <div class="list">
      {li('Idioma', 'El de tu móvil', 'globe', '<span class="muted" style="font-size: 14px">Español</span>', 'Idioma.dc.html')}
      {li('Zona horaria', 'Para saber cuándo empieza el día de tu mascota', 'clock', '<span class="muted" style="font-size: 14px">Madrid</span>', chev=False)}
    </div>
  </div>
  {foot(btn('Continuar', 'Aviso.dc.html'))}
</div>"""))

# 2.2 Idioma (hoja)
LANGS = [('es', 'Español', 'Idioma de tu móvil'), ('en', 'English', 'Inglés')]
reg(SEC, 'Idioma.dc.html', '2.2 Idioma · hoja', page('Idioma', sheet('Idioma', f"""
        <div class="list" role="radiogroup" aria-labelledby="sh">
          <sc-for list="{H('langs')}" as="l" hint-placeholder-count="2">
            <button class="opt" role="radio" aria-checked="{H('l.on')}" onClick="{H('l.pick')}">
              <span class="col grow" style="gap: 0"><span class="strong">{H('l.label')}</span><span class="cap muted">{H('l.sub')}</span></span>
              <span class="{H('l.cls')}" aria-hidden="true"></span>
            </button>
          </sc-for>
        </div>
        <p class="cap muted">Más idiomas, próximamente. Las fechas y los números siguen el formato del idioma.</p>""",
    close='TuPerfil.dc.html', footer=btn('Usar este idioma', 'TuPerfil.dc.html'), behind=behind_title('¿Cómo te llamamos?'), maxh=480),
    script=toggle_script({'lang': 'es'}, """    const opts = %s;
    return { langs: opts.map((o) => ({ id: o[0], label: o[1], sub: o[2], on: this.state.lang === o[0],
      cls: this.state.lang === o[0] ? 'radio on' : 'radio', pick: () => this.setState({ lang: o[0] }) })) };""" % str([list(x) for x in LANGS]))))

# 2.3 Aviso veterinario (aprobado; paso 2 de 3)
reg(SEC, 'Aviso.dc.html', '2.3 Aviso veterinario', page('Aviso veterinario', f"""
<div class="app">
  <div class="scr">
    <div class="top"><a class="ib" href="TuPerfil.dc.html" aria-label="Volver">{icon('chev-l', 24)}</a>{dots(2)}<span style="width: 44px"></span></div>
    <div class="col" style="gap: 12px">
      <div class="av s64" style="border-radius: 18px">{icon('steth', 32)}</div>
      <h1 class="t1">Kitom orienta, tu veterinario decide</h1>
      <p class="blg muted">Antes de empezar, queremos que esto quede claro.</p>
    </div>
    <div class="list">
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">{icon('check', 20, 2, 'margin-top: 1px; color: var(--primary)')}<p>Te damos <strong>orientación</strong>: posibles causas, señales de alerta y cuándo consultar.</p></div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">{icon('check', 20, 2, 'margin-top: 1px; color: var(--primary)')}<p>No es una valoración médica ni sustituye una consulta veterinaria.</p></div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">{icon('alert', 20, 2, 'margin-top: 1px; color: var(--urgent)')}<p>Si ves dificultad para respirar, convulsiones, sangrado o que no puede ponerse en pie, <strong>acude a un veterinario ahora</strong>.</p></div>
    </div>
    <button class="check" onClick="{H('toggle')}" role="checkbox" aria-checked="{H('accepted')}" style="background: none; border: 0; padding: 0; text-align: left; font: inherit; color: inherit">
      <span class="{H('boxCls')}"><sc-if value="{H('accepted')}" hint-placeholder-val="{{{{ false }}}}">{icon('check', 16, 3)}</sc-if></span>
      <span class="body">He leído y entiendo que Kitom no sustituye la atención veterinaria.</span>
    </button>
  </div>
  <div class="foot">
    <sc-if value="{H('accepted')}" hint-placeholder-val="{{{{ false }}}}"><a class="btn primary" href="Privacidad.dc.html">Aceptar y continuar</a></sc-if>
    <sc-if value="{H('notAccepted')}" hint-placeholder-val="{{{{ true }}}}"><span class="btn disabled" aria-disabled="true">Aceptar y continuar</span></sc-if>
    <p class="cap muted" style="text-align: center">Marca la casilla para continuar. Guardamos la fecha y la versión del aviso.</p>
  </div>
</div>""", script=toggle_script({'accepted': False}, """    const accepted = this.state.accepted;
    return { accepted, notAccepted: !accepted, boxCls: accepted ? 'box on' : 'box', toggle: () => this.setState({ accepted: !accepted }) };""")))

# 2.4 Datos y privacidad (consentimiento)
reg(SEC, 'Privacidad.dc.html', '2.4 Datos y privacidad', page('Datos y privacidad', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    <div class="top"><a class="ib" href="Aviso.dc.html" aria-label="Volver">{icon('chev-l', 24)}</a>{dots(3)}<span style="width: 44px"></span></div>
    <div class="col" style="gap: 8px">
      <h1 class="t1">Tus datos, bajo tu control</h1>
      <p class="muted">Usamos lo justo para que Kitom funcione. Lo opcional empieza desactivado.</p>
    </div>
    <div class="list">
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">
        <span class="ico">{icon('shield')}</span>
        <span class="col grow" style="gap: 2px"><span class="strong">Perfil y registros de tu mascota</span><span class="cap muted">Para mostrarte su evolución y avisarte de cambios. Solo los ves tú.</span></span>
        <span class="tag neutral">Necesario</span>
      </div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">
        <span class="ico">{icon('camera')}</span>
        <span class="col grow" style="gap: 2px"><span class="strong">Fotos en las consultas</span><span class="cap muted">Te lo preguntaremos la primera vez que consultes con una foto. Nunca son públicas.</span></span>
      </div>
      <div class="li" style="align-items: flex-start; padding-top: 14px; padding-bottom: 14px">
        <span class="ico">{icon('mail')}</span>
        <span class="col grow" style="gap: 2px"><span class="strong" id="mk">Consejos y novedades por email</span><span class="cap muted">Opcional. Puedes cambiarlo en Ajustes.</span></span>
        {sw('mk', 'mk', 'toggleMk')}
      </div>
    </div>
    <p class="cap muted">Puedes exportar o borrar tus datos cuando quieras. Lee la <a href="Legal.dc.html">Política de privacidad</a>.</p>
  </div>
  {foot(btn('Continuar', 'MascotaNueva.dc.html'))}
</div>""", script=toggle_script({'mk': False}, """    const mk = this.state.mk;
    return { mk, mkCls: mk ? 'switch on' : 'switch', toggleMk: () => this.setState({ mk: !mk }) };""")))
