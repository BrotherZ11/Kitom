from lib import *
import re, os

SEC = 'auth'
_main_src = open(os.path.join(os.path.dirname(__file__), 'base', 'Main.dc.html'), encoding='utf-8').read()
LOGO_INV = re.search(r'<svg width="156".*?</svg>', _main_src, re.S).group(0)
LOGO = LOGO_INV.replace('#F2F5F3', '#0F2A29').replace('width="156" height="45"', 'width="138" height="40"')

# 1.0 Splash
reg(SEC, 'Splash.dc.html', '1.0 Splash', page('Kitom', f"""
<div class="app" style="align-items: center; justify-content: center">
  <a href="Main.dc.html" aria-label="Kitom. Abrir" style="display: flex; flex-direction: column; align-items: center; gap: 28px; text-decoration: none">
    {symbol(96, '#0E3B39')}
  </a>
  <p class="cap muted" style="position: absolute; bottom: 48px; left: 0; right: 0; text-align: center">Toca para continuar (prototipo)</p>
</div>"""))

# 1.1 Bienvenida (se conserva el diseño aprobado)
reg(SEC, 'Main.dc.html', '1.1 Bienvenida', page('Bienvenida', f"""
<div class="app" style="background: #0E3B39; color: #F2F5F3">
  <div class="scr" style="justify-content: space-between; padding-top: 84px">
    <div style="display: flex; justify-content: center">
      {LOGO_INV}
    </div>
    <div style="display: flex; justify-content: center">
      <svg width="220" height="220" viewBox="0 0 64 64" role="img" aria-label="Seis días registrados y hoy pendiente">
        <g fill="none" stroke-width="5.5" stroke-linecap="round" stroke="#6CC0B4">{''.join(f'<path d="{p}"></path>' for p in SEGS)}</g>
        <circle cx="22.45" cy="12.18" r="4.6" fill="#F2B441"></circle>
        <text x="32" y="35.5" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-weight="500" font-size="9" fill="#F2F5F3">6/7</text>
      </svg>
    </div>
    <div class="col" style="gap: 12px; text-align: center; align-items: center">
      <h1 class="display" style="color: #F2F5F3">Cuidar bien es una suma de días</h1>
      <p class="blg" style="color: #C9D8D4; max-width: 320px">Registra cómo está tu perro o tu gato en menos de un minuto, entiende sus cambios y sabe cuándo hace falta un veterinario.</p>
    </div>
  </div>
  <div class="foot" style="background: #0E3B39">
    <a class="btn" href="Onboarding.dc.html" style="background: #F2F5F3; color: #0E3B39">Empezar</a>
    <a class="btn" href="Login.dc.html" style="background: transparent; color: #F2F5F3; box-shadow: inset 0 0 0 1.5px rgba(242,245,243,.5)">Ya tengo cuenta</a>
    <p class="cap" style="text-align: center; color: #A9C2BD">Hecha para Atom y Kika, y para el tuyo.</p>
  </div>
</div>"""))

# 1.2 Cómo funciona
def _idea(ic_html, t, d):
    return f"""<div class="card" style="flex-direction: row; gap: 16px; align-items: flex-start">
        <div class="av s40" style="border-radius: 12px">{ic_html}</div>
        <div class="col" style="gap: 4px"><h2 class="t3">{t}</h2><p class="muted">{d}</p></div>
      </div>"""

mini_ring = ('<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><g fill="none" stroke="#1F6F6B" stroke-width="7" stroke-linecap="round">'
             + ''.join(f'<path d="{p}"></path>' for p in SEGS) + '</g><circle cx="22.45" cy="12.18" r="6" fill="#F2B441"></circle></svg>')
reg(SEC, 'Onboarding.dc.html', '1.2 Cómo funciona', page('Cómo funciona', f"""
<div class="app">
  <div class="scr">
    <div class="top">
      <a class="ib" href="Main.dc.html" aria-label="Volver">{icon('chev-l', 24)}</a>
      <a class="link" href="Cuenta.dc.html" style="min-width: 44px; text-align: right; font-size: 15px">Saltar</a>
    </div>
    <div class="col" style="gap: 8px">
      <p class="over">Cómo funciona</p>
      <h1 class="t1">Tres hábitos pequeños que suman mucho</h1>
    </div>
    <div class="col" style="gap: 16px">
      {_idea(mini_ring, 'Registra su día', 'Energía, apetito, ánimo y actividad en unos 40 segundos. Cada día completa un punto de la semana.')}
      {_idea(icon('chart', 22), 'Entiende sus cambios', 'Kitom compara cada día con lo normal en tu mascota y te avisa si algo cambia varios días seguidos.')}
      {_idea(icon('calendar', 22), 'No olvides sus cuidados', 'Vacunas, medicación y citas con aviso. Y si algo te preocupa, consulta con una foto y te orientamos.')}
    </div>
    <p class="cap muted">Kitom te orienta y te avisa de señales de alerta. Nunca sustituye a tu veterinario.</p>
  </div>
  {foot(btn('Crear mi cuenta', 'Cuenta.dc.html'))}
</div>"""))

# 1.3 Crear cuenta
reg(SEC, 'Cuenta.dc.html', '1.3 Crear cuenta · error en el campo', page('Crear cuenta', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Onboarding.dc.html')}
    <div class="col" style="gap: 8px">
      <h1 class="t1">Crea tu cuenta</h1>
      <p class="muted">Así guardamos el historial de tu mascota y lo recuperas en cualquier móvil.</p>
    </div>
    <a class="btn secondary" href="TuPerfil.dc.html">{GOOGLE}Continuar con Google</a>
    <a class="btn secondary" href="Telefono.dc.html">{icon('phone-dev')}Continuar con el teléfono</a>
    <div class="row" style="gap: 12px"><hr class="divider grow"><span class="cap muted">o con tu email</span><hr class="divider grow"></div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" class="input error" type="email" value="david.ejemplo.com" aria-invalid="true" aria-describedby="email-err">
      <p id="email-err" class="err">{icon('alert-c', 14, 2.4)}Falta la @. Revisa el email.</p>
    </div>
    <div class="field">
      <label for="pass">Contraseña</label>
      <div class="input" style="padding-right: 4px"><input id="pass" type="password" value="kikaatom" aria-describedby="pass-help" style="border: 0; background: transparent; font: inherit; color: inherit; flex: 1; min-width: 0; outline: none"><button class="ib" aria-label="Mostrar contraseña">{icon('eye', 20)}</button></div>
      <p id="pass-help" class="help">Mínimo 8 caracteres.</p>
    </div>
  </div>
  {foot(btn('Crear cuenta', 'VerificaEmail.dc.html'), cap('Al crear la cuenta aceptas los <a href="Legal.dc.html">Términos</a> y la <a href="Legal.dc.html">Política de privacidad</a>.'), '<a class="btn ghost md" href="Login.dc.html">Ya tengo cuenta</a>')}
</div>"""))

# 1.4 Verifica tu email
reg(SEC, 'VerificaEmail.dc.html', '1.4 Verifica tu email', page('Verifica tu email', f"""
<div class="app">
  <div class="scr" style="align-items: center; text-align: center; padding-top: 120px; gap: 24px">
    <div class="empty">
      <div class="ill">{icon('mail', 32)}</div>
      <h1 class="t1">Revisa tu correo</h1>
      <p class="blg muted" style="max-width: 310px">Te hemos enviado un enlace a <span class="strong" style="color: var(--ink)">david@ejemplo.com</span>. Ábrelo en este móvil para activar tu cuenta.</p>
    </div>
    <div class="card flat" style="width: 100%; text-align: left; gap: 6px">
      <p class="strong">¿No te llega?</p>
      <p class="cap muted">Mira en la carpeta de spam. Puedes pedir otro enlace dentro de 60 segundos.</p>
    </div>
  </div>
  {foot(btn('Abrir mi correo', 'TuPerfil.dc.html', 'primary', 'ext'), '<span class="btn disabled md" aria-disabled="true">Reenviar enlace · 0:42</span>', '<a class="btn ghost md" href="Cuenta.dc.html">Cambiar el email</a>')}
</div>"""))

# 1.5 Iniciar sesión (interactivo: Google cargando)
reg(SEC, 'Login.dc.html', '1.5 Iniciar sesión', page('Iniciar sesión', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Main.dc.html')}
    <div class="col" style="gap: 8px">
      <h1 class="t1">Hola de nuevo</h1>
      <p class="muted">Entra para ver cómo está tu mascota.</p>
    </div>
    <sc-if value="{H('loading')}" hint-placeholder-val="{{{{ false }}}}">
      <span class="btn secondary loading" role="status"><span class="spinner" aria-hidden="true"></span>Conectando con Google…</span>
    </sc-if>
    <sc-if value="{H('idle')}" hint-placeholder-val="{{{{ true }}}}">
      <button class="btn secondary" onClick="{H('google')}">{GOOGLE}Continuar con Google</button>
    </sc-if>
    <a class="btn secondary" href="Telefono.dc.html">{icon('phone-dev')}Continuar con el teléfono</a>
    <div class="row" style="gap: 12px"><hr class="divider grow"><span class="cap muted">o con tu email</span><hr class="divider grow"></div>
    <div class="field">
      <label for="le">Email</label>
      <input id="le" class="input" type="email" value="david@ejemplo.com" autocomplete="email">
    </div>
    <div class="field">
      <label for="lp">Contraseña</label>
      <input id="lp" class="input error" type="password" value="kika1234" aria-invalid="true" aria-describedby="lp-err">
      <p id="lp-err" class="err">{icon('alert-c', 14, 2.4)}El email o la contraseña no coinciden.</p>
    </div>
    <a class="link" href="Recuperar.dc.html" style="font-size: 15px; align-self: flex-start">He olvidado mi contraseña</a>
  </div>
  {foot(btn('Entrar', 'Home.dc.html'), '<a class="btn ghost md" href="Cuenta.dc.html">Crear una cuenta</a>')}
</div>""", script=toggle_script({'loading': False}, """    const loading = this.state.loading;
    return { loading, idle: !loading, google: () => this.setState({ loading: true }) };""")))

# 1.6 Teléfono
reg(SEC, 'Telefono.dc.html', '1.6 Acceso con teléfono', page('Acceso con teléfono', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Cuenta.dc.html')}
    <div class="col" style="gap: 8px">
      <h1 class="t1">Tu número de teléfono</h1>
      <p class="muted">Te enviaremos un código por SMS para entrar. No lo usamos para nada más.</p>
    </div>
    <div class="field">
      <label for="tel">Teléfono</label>
      <div class="prefix">
        <div class="input mono" role="button" tabindex="0" aria-label="Prefijo: España +34">+34{icon('chev-d', 18)}</div>
        <input id="tel" class="input mono focus" type="tel" value="612 345 678" autocomplete="tel">
      </div>
      <p class="help">Pueden aplicarse tarifas de tu operador.</p>
    </div>
  </div>
  {foot(btn('Enviar código', 'Codigo.dc.html'))}
</div>"""))

# 1.7 Código OTP (interactivo: correcto / error)
reg(SEC, 'Codigo.dc.html', '1.7 Código de verificación', page('Código de verificación', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Telefono.dc.html')}
    <div class="col" style="gap: 8px">
      <h1 class="t1">Escribe el código</h1>
      <p class="muted">Lo hemos enviado al <span class="mono" style="color: var(--ink)">+34 612 345 678</span>.</p>
    </div>
    <div class="field">
      <span class="flabel" id="otpl">Código de 6 cifras</span>
      <div class="{H('otpCls')}" role="group" aria-labelledby="otpl">
        <span>4</span><span>8</span><span>1</span><span>9</span><span>0</span><span class="f">{H('last')}</span>
      </div>
      <sc-if value="{H('bad')}" hint-placeholder-val="{{{{ false }}}}"><p class="err">{icon('alert-c', 14, 2.4)}El código no es correcto. Revísalo o pide otro.</p></sc-if>
    </div>
    <p class="cap muted">¿No te llega? Podrás pedir otro en <span class="mono">0:38</span>.</p>
  </div>
  {foot(btn('Verificar', 'TuPerfil.dc.html'), '<a class="btn ghost md" href="Telefono.dc.html">Cambiar el número</a>')}
</div>""", props={'error': {'editor': 'boolean', 'default': False}}, script="""class Component extends DCLogic {
  renderVals() {
    const bad = this.props.error ?? false;
    return { bad, last: bad ? '3' : '7', otpCls: bad ? 'otp error' : 'otp' };
  }
}"""))

# 1.8 Recuperar contraseña (interactivo: formulario / enviado)
reg(SEC, 'Recuperar.dc.html', '1.8 Recuperar contraseña', page('Recuperar contraseña', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Login.dc.html')}
    <sc-if value="{H('form')}" hint-placeholder-val="{{{{ true }}}}">
      <div class="col" style="gap: 20px">
        <div class="col" style="gap: 8px">
          <h1 class="t1">Recupera tu contraseña</h1>
          <p class="muted">Escribe el email de tu cuenta y te enviaremos un enlace para crear una nueva.</p>
        </div>
        <div class="field">
          <label for="re">Email</label>
          <input id="re" class="input focus" type="email" value="david@ejemplo.com">
        </div>
      </div>
    </sc-if>
    <sc-if value="{H('sent')}" hint-placeholder-val="{{{{ false }}}}">
      <div class="empty" style="padding-top: 48px">
        <div class="ill">{icon('mail', 32)}</div>
        <h1 class="t1">Enlace enviado</h1>
        <p class="blg muted" style="max-width: 310px">Si hay una cuenta con ese email, te llegará en unos minutos. Ábrelo en este móvil.</p>
      </div>
    </sc-if>
  </div>
  <div class="foot">
    <sc-if value="{H('form')}" hint-placeholder-val="{{{{ true }}}}"><button class="btn primary" onClick="{H('send')}">Enviar enlace</button></sc-if>
    <sc-if value="{H('sent')}" hint-placeholder-val="{{{{ false }}}}"><a class="btn primary" href="NuevaClave.dc.html">Abrir el enlace (prototipo)</a><a class="btn ghost md" href="Login.dc.html">Volver a entrar</a></sc-if>
  </div>
</div>""", script=toggle_script({'sent': False}, """    const sent = this.state.sent;
    return { sent, form: !sent, send: () => this.setState({ sent: true }) };""")))

# 1.9 Nueva contraseña
reg(SEC, 'NuevaClave.dc.html', '1.9 Nueva contraseña', page('Nueva contraseña', f"""
<div class="app">
  <div class="scr" style="gap: 20px">
    {top('', 'Login.dc.html', icon_name='x', label='Cancelar')}
    <div class="col" style="gap: 8px">
      <h1 class="t1">Crea una contraseña nueva</h1>
      <p class="muted">Úsala a partir de ahora para entrar en Kitom.</p>
    </div>
    <div class="field">
      <label for="n1">Contraseña nueva</label>
      <input id="n1" class="input ok" type="password" value="atomykika26" aria-describedby="n1-ok">
      <p id="n1-ok" class="okmsg">{icon('check', 14, 2.6)}Tiene al menos 8 caracteres.</p>
    </div>
    <div class="field">
      <label for="n2">Repite la contraseña</label>
      <input id="n2" class="input error" type="password" value="atomykika2" aria-invalid="true" aria-describedby="n2-err">
      <p id="n2-err" class="err">{icon('alert-c', 14, 2.4)}Las dos contraseñas no coinciden.</p>
    </div>
  </div>
  {foot(btn('Guardar contraseña', 'Home.dc.html'))}
</div>"""))
