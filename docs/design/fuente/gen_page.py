import os, re
from brand import *
from lt import logotype
from gen_ds import ic, week_ring, chart_svg, ICONS

def inline(svgtxt, h=None, w=None, extra=''):
    s = re.sub(r'<title>.*?</title>', '', svgtxt.strip())
    s = s.replace('xmlns="http://www.w3.org/2000/svg" ', '')
    attrs = ''
    if h: attrs += f' height="{h}"'
    if w: attrs += f' width="{w}"'
    return s.replace('<svg ', f'<svg{attrs} {extra} ', 1)

LT = lambda ink='#0F2A29', dot='#F2B441': logotype(ink, dot, ss=0.95, gap=6, r=4.0)
SYM = lambda ink='#0F2A29', dot='#F2B441': logo_symbol(ink, dot)
SYMS = lambda ink='#0F2A29', dot='#F2B441': logo_symbol_small(ink, dot)
def sym_v0(h):
    P = ["M16 9V55","M16 38L36.5 13.5Q41 8.5 42.6 15L44 31","M27 26.5Q39 40 43.5 49.5Q46.5 55.5 52.5 52Q56.5 49.2 53.8 44.3"]
    return (f'<svg viewBox="12.5 5.5 45.5 53" height="{h}" aria-hidden="true"><g fill="none" stroke="#0F2A29" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">'
            + ''.join(f'<path d="{d}"/>' for d in P) + '</g><circle cx="53" cy="14" r="4.6" fill="#F2B441"/></svg>')

def alt(paths_svg):
    return f'<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">{paths_svg}</svg>'
ALT_EAR = alt('<g fill="none" stroke="#0F2A29" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10V54"/><path d="M18 38L39 13Q43 8.5 44.5 14L46 32"/><path d="M29 26L46 54"/></g><circle cx="54" cy="12" r="4" fill="#F2B441"/>')
ALT_SOLID = alt('<path d="M12.5 9a3.5 3.5 0 0 1 7 0v46a3.5 3.5 0 0 1-7 0z" fill="#0F2A29"/><path d="M19.5 34L38 10.5Q43 5.5 45 12.5L46.5 34Q37 29 27 38L19.5 44z" fill="#0F2A29"/><path d="M28 33Q39 41 43.5 49.5Q46.5 55.5 52.5 52Q56.5 49.2 53.8 44.3" fill="none" stroke="#0F2A29" stroke-width="7" stroke-linecap="round"/><circle cx="54" cy="14" r="4.6" fill="#F2B441"/>')
ALT_TWO = alt('<g fill="none" stroke="#0F2A29" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10V54"/><path d="M18 36L38 12Q42 8 44 13L46 30"/><path d="M27 29Q42 32 46 44Q48 54 40 54Q34 53 36 44"/></g>')

# diagrama de construcción
def construction():
    x0, y0 = SYM_BOX[0], SYM_BOX[1]
    grid = ''.join(f'<line x1="{x}" y1="0" x2="{x}" y2="64" />' for x in range(0, 65, 8)) + ''.join(f'<line x1="0" y1="{y}" x2="64" y2="{y}" />' for y in range(0, 65, 8))
    p = SYM_PATHS
    return f'''<svg viewBox="0 0 64 64" width="100%" style="max-width:320px" role="img" aria-label="Construcción del símbolo">
<g stroke="var(--line)" stroke-width="0.25">{grid}</g>
<g fill="none" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
<path d="{p[0]}" stroke="#0F2A29"/><path d="{p[1]}" stroke="#1F6F6B"/><path d="{p[2]}" stroke="#5A9C92"/></g>
<circle cx="{SYM_DOT[0]}" cy="{SYM_DOT[1]}" r="{SYM_DOT[2]}" fill="#F2B441"/>
<g fill="none" stroke="var(--fg)" stroke-width="0.4" stroke-dasharray="1 1"><path d="M16 37.5 L35.8 14"/></g>
</svg>'''

def phone(theme='light'):
    L = theme == 'light'
    c = {k: (l if L else d) for k, l, d, _ in SEM}
    ring = week_ring(5, 92, '5 de 7 días; hoy pendiente').replace('class="k-ring"', 'class="k-ring pending"')
    return f'''<div class="phone {'' if L else 'dark'}" style="--p-bg:{c['bg']};--p-surface:{c['surface']};--p-ink:{c['ink']};--p-muted:{c['ink-muted']};--p-primary:{c['primary']};--p-onprimary:{c['on-primary']};--p-line:{c['line']};--p-accent:{c['accent']};--p-obsbg:{c['observe-bg']};--p-obsfg:{c['observe-fg']};--p-warm:{c['surface-warm']};--p-warmink:{c['warm-ink']};--p-sunken:{c['surface-sunken']};--p-down:{c['vet-fg']};--p-up:{c['success-fg']}">
<div class="sb"><span>9:41</span><span>●●● ▮</span></div>
<div class="scr">
 <div class="ph-top"><div>{inline(SYM(c['ink'], c['accent']), h=22)}</div><div class="petsw"><span class="av"></span>Kika ▾</div></div>
 <p class="ovl">JUE 15 OCT</p>
 <p class="ttl">Hola, David</p>
 <div class="pc ph-hero">{ring}<div><p class="h3">Falta el registro de hoy</p><p class="cap">Unos 40 segundos</p><span class="pbtn">Registrar el día</span></div></div>
 <div class="pc voice"><small>Kika dice</small>Hoy he dormido mucho. ¿Paseo largo?</div>
 <div class="tiles"><div class="pc t"><p class="cap">Energía</p><p class="num">4<small>/5</small></p><p class="tr">→ estable</p></div><div class="pc t"><p class="cap">Apetito</p><p class="num">3<small>/5</small></p><p class="tr dn">↓ 3 días</p></div><div class="pc t"><p class="cap">Ánimo</p><p class="num">4<small>/5</small></p><p class="tr up">↑ mejor</p></div></div>
 <div class="pc"><span class="otag">{ic('eye',13)}Observar</span><p class="body">Kika ha comido menos estos 3 días. ¿Quieres añadir detalles o ver posibles causas?</p></div>
</div>
<div class="tabs"><span class="on">{ic('home',22)}Hoy<i></i></span><span>{ic('chart',22)}Tendencias</span><span>{ic('camera',22)}Consultar</span><span>{ic('calendar',22)}Agenda</span><span>{ic('user',22)}Perfil</span></div>
</div>'''

SW = lambda hexv, name, note='': f'<div class="sw"><i style="background:{hexv}"></i><span><b>{name}</b><code>{hexv}</code>{note}</span></div>'

def page():
    urg = ''.join(f'<span class="tag" style="background:{sem(bg,"light")};color:{sem(fg,"light")}">{ic(icon,14)}{label}</span>' for key, label, icon, bg, fg in URGENCY)
    typerows = ''.join(
        f'<div class="trow"><code>{n}<br>{sz}/{lh} · {w}</code><span style="font-family:{"var(--k-mono)" if fam=="mono" else "var(--k-sans)"};font-size:{sz}px;line-height:{lh}px;font-weight:{w};letter-spacing:{ls}px;{"text-transform:uppercase;" if n=="overline" else ""}">{sm}</span></div>'
        for g, n, fam, sz, lh, w, ls, u, sm in TYPE)
    return f'''<title>Kitom · Identidad</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: guía de marca en una columna ancha; los especímenes de marca usan colores fijos, la carcasa sigue el tema. */
:root{{--bg:#F2F5F3;--panel:#FFFFFF;--fg:#0F2A29;--muted:#566A67;--line:#DAE4E0;--chip:#E6ECE9;--k-sans:'Hanken Grotesk',system-ui,-apple-system,'Segoe UI',sans-serif;--k-mono:'IBM Plex Mono',ui-monospace,Menlo,monospace}}
@media (prefers-color-scheme: dark){{:root:not([data-theme="light"]){{--bg:#0C1918;--panel:#152624;--fg:#E6EFEC;--muted:#9DB2AE;--line:#24403C;--chip:#1D3331;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#0C1918;--panel:#152624;--fg:#E6EFEC;--muted:#9DB2AE;--line:#24403C;--chip:#1D3331;color-scheme:dark}}
*{{box-sizing:border-box}}
body{{background:var(--bg);color:var(--fg);font-family:var(--k-sans);font-size:15px;line-height:1.55}}
.wrap{{max-width:1120px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:40px 80px}}
h1,h2,h3{{margin:0;text-wrap:balance;font-weight:600}}p{{margin:0}}
.ovl{{font-family:var(--k-mono);font-size:11.5px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}}
section{{padding-top:56px}}
section>h2{{font-size:clamp(24px,3vw,32px);letter-spacing:-.02em;margin-top:6px}}
.lead{{color:var(--muted);max-width:66ch;margin-top:10px;font-size:16px}}
.panel{{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:24px}}
.g2{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:20px}}
.g3{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:20px}}
.g4{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}}
.tile{{border-radius:18px;display:flex;align-items:center;justify-content:center;min-height:150px;padding:24px}}
.cap{{font-size:12.5px;color:var(--muted);margin-top:8px}}
.hero{{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:32px;align-items:center;padding-bottom:28px;border-bottom:1px solid var(--line)}}
.hero h1{{font-size:clamp(30px,4.2vw,44px);line-height:1.08;letter-spacing:-.025em;margin-top:10px}}
.hero .mark{{background:#FFFFFF;border-radius:24px;padding:48px 32px;display:flex;justify-content:center;border:1px solid var(--line)}}
.toc{{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}}.toc a{{text-decoration:none;color:inherit;font-size:13px;padding:6px 12px;border-radius:999px;background:var(--chip)}}
.story{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px;align-items:center}}
.story ol{{margin:12px 0 0;padding-left:20px;display:grid;gap:8px}}
.alts{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:20px}}
.alt{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;font-size:13px}}
.alt svg{{background:#fff;border-radius:12px}}
.alt.win{{border:2px solid #1F6F6B}}
.alt b{{font-weight:600}}
.sizes{{display:flex;gap:20px;align-items:end;flex-wrap:wrap}}
.home{{border-radius:24px;padding:28px 20px 18px;background:linear-gradient(160deg,#B9D7CF,#5A9C92);display:grid;grid-template-columns:repeat(4,64px);gap:18px 22px;justify-content:center}}
.home div{{display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11px;color:#fff}}
.home .other{{width:60px;height:60px;border-radius:14px;background:rgba(255,255,255,.35)}}
.swatches{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:14px}}
.sw{{border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--panel)}}
.sw i{{display:block;height:64px}}
.sw span{{display:block;padding:8px 10px;font-size:12px;line-height:1.35}}
.sw b{{display:block;font-weight:600;font-size:13px}}
.sw code,.trow code{{font-family:var(--k-mono);font-size:11px;color:var(--muted)}}
h3.sub{{font-size:15px;margin-top:24px}}
.tag{{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px 0 8px;border-radius:6px;font-weight:600;font-size:13px}}
.row{{display:flex;flex-wrap:wrap;gap:10px;align-items:center}}
.trow{{display:grid;grid-template-columns:150px minmax(0,1fr);gap:16px;align-items:baseline;padding:10px 0;border-top:1px solid var(--line)}}
.icons{{display:flex;flex-wrap:wrap;gap:14px;margin-top:14px;color:var(--fg)}}
.icons span{{display:flex;flex-direction:column;align-items:center;gap:6px;width:76px;font-size:11px;color:var(--muted);font-family:var(--k-mono)}}
.icons svg{{color:var(--fg)}}
.photos{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}}
.photo{{aspect-ratio:4/3;border-radius:16px;position:relative;overflow:hidden;max-width:100%}}
.photo span{{position:absolute;left:10px;bottom:8px;right:10px;font-size:11.5px;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4)}}
/* teléfono */
.phones{{display:flex;gap:28px;flex-wrap:wrap;justify-content:center;margin-top:20px}}
.phone{{width:300px;max-width:100%;height:640px;border-radius:44px;border:9px solid #0A1413;background:var(--p-bg);color:var(--p-ink);overflow:hidden;position:relative;font-family:var(--k-sans);box-shadow:0 30px 60px -30px rgba(0,0,0,.45)}}
.phone .sb{{height:34px;display:flex;justify-content:space-between;align-items:center;padding:0 22px;font-size:12px;font-weight:600}}
.phone .scr{{position:absolute;inset:34px 0 76px 0;padding:4px 16px;display:flex;flex-direction:column;gap:8px;overflow:hidden}}
.ph-top{{display:flex;justify-content:space-between;align-items:center}}
.petsw{{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;background:var(--p-surface);border-radius:99px;padding:4px 10px 4px 4px}}
.petsw .av{{width:22px;height:22px;border-radius:50%;background:radial-gradient(60% 60% at 40% 38%,#D9C3AE,#56786F)}}
.phone .ovl{{color:var(--p-muted);margin-top:4px}}
.ttl{{font-size:22px;line-height:28px;font-weight:600;letter-spacing:-.02em;margin-top:-6px}}
.pc{{background:var(--p-surface);border-radius:18px;padding:12px;box-shadow:0 1px 2px rgba(14,59,57,.06),0 6px 16px -10px rgba(14,59,57,.25)}}
.dark .pc{{box-shadow:0 0 0 1px rgba(255,255,255,.04)}}
.ph-hero{{display:flex;gap:12px;align-items:center}}
.ph-hero .k-ring .on{{stroke:var(--p-primary)}}.ph-hero .k-ring .off{{stroke:var(--p-line)}}.ph-hero .k-ring .today{{fill:none;stroke:var(--p-accent);stroke-width:2.4}}
.h3{{font-size:15px;line-height:20px;font-weight:600}}
.phone .cap{{font-size:11.5px;color:var(--p-muted);margin-top:2px}}
.pbtn{{display:inline-flex;margin-top:8px;height:36px;align-items:center;padding:0 14px;border-radius:10px;background:var(--p-primary);color:var(--p-onprimary);font-size:13px;font-weight:600}}
.voice{{background:var(--p-warm);box-shadow:none;font-size:14px;line-height:19px;font-weight:500}}
.voice small{{display:block;font-size:11px;font-weight:600;color:var(--p-warmink)}}
.tiles{{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}}
.tiles .t{{padding:9px}}
.num{{font-family:var(--k-mono);font-size:18px;font-weight:500}}.num small{{font-size:11px;color:var(--p-muted)}}
.tr{{font-family:var(--k-mono);font-size:10.5px;color:var(--p-muted)}}.tr.dn{{color:var(--p-down)}}.tr.up{{color:var(--p-up)}}
.otag{{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px 0 6px;border-radius:6px;background:var(--p-obsbg);color:var(--p-obsfg);font-size:11.5px;font-weight:600}}
.pc .body{{font-size:12.5px;line-height:17px;margin-top:6px}}
.phone .tabs{{position:absolute;left:0;right:0;bottom:0;height:76px;background:var(--p-surface);display:flex;justify-content:space-around;padding-top:9px;border-top:1px solid var(--p-line)}}
.phone .tabs span{{display:flex;flex-direction:column;align-items:center;gap:2px;font-size:10px;font-weight:500;color:var(--p-muted);position:relative}}
.phone .tabs .on{{color:var(--p-primary)}}.phone .tabs i{{width:4px;height:4px;border-radius:2px;background:var(--p-accent)}}
/* notificación */
.lock{{border-radius:24px;padding:22px 16px;background:linear-gradient(170deg,#1F6F6B,#0E3B39);display:flex;flex-direction:column;gap:10px}}
.notif{{background:rgba(255,255,255,.86);border-radius:18px;padding:11px 12px;display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;color:#0F2A29;font-size:13px;line-height:17px}}
.notif b{{display:block}}.notif small{{color:#566A67;font-size:11px}}
.copy{{width:100%;border-collapse:collapse;font-size:14px;margin-top:14px}}
.copy td,.copy th{{text-align:left;padding:10px 12px;border-top:1px solid var(--line);vertical-align:top}}
.copy th{{font-weight:500;color:var(--muted);font-size:12.5px}}
.tblw{{overflow-x:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel);margin-top:14px}}
.tblw table{{min-width:560px;margin:0}}
.dodont{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:20px}}
.dd{{border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--panel)}}
.dd .v{{height:120px;display:flex;align-items:center;justify-content:center;padding:16px}}
.dd p{{padding:10px 12px;font-size:13px;display:flex;gap:6px;align-items:flex-start}}
.dd.no p b{{color:#B42318}}.dd.yes p b{{color:#1D6B47}}
:root:not([data-theme="light"]) .dd.no p b{{}}
.next{{margin-top:40px;padding:22px;border-radius:16px;background:#0E3B39;color:#F2F5F3}}
.next a{{color:#F7CF7A}}
@media (max-width:860px){{.hero,.story,.g2{{grid-template-columns:minmax(0,1fr)}}.g3,.alts,.dodont{{grid-template-columns:repeat(2,minmax(0,1fr))}}.g4{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
@media (max-width:480px){{.g3,.dodont{{grid-template-columns:minmax(0,1fr)}}.trow{{grid-template-columns:minmax(0,1fr);gap:4px}}.photos{{grid-template-columns:repeat(2,minmax(0,1fr))}}}}
</style>
<div class="wrap">
<header class="hero">
 <div>
  <p class="ovl">Kitom · Identidad Ritmo · versión 1.0 final · 16 oct 2026</p>
  <h1>La K de Kitom, dibujada con una oreja y una cola</h1>
  <p class="lead">Identidad consolidada sobre la dirección Ritmo, con un símbolo nuevo nacido del de Cuaderno de campo. Orejas y cola son las dos señales con las que cualquier perro o gato te dice cómo está, que es justo lo que Kitom ayuda a leer. Para Atom y Kika.</p>
  <nav class="toc"><a href="#simbolo">Símbolo</a><a href="#versiones">Versiones</a><a href="#icono">Icono de app</a><a href="#color">Color</a><a href="#tipo">Tipografía</a><a href="#iconos">Iconos e imagen</a><a href="#aplicada">Home aplicada</a><a href="#voz">Voz</a><a href="#reglas">Reglas</a></nav>
 </div>
 <div class="mark">{inline(LT(), w="100%", extra='style="max-width:360px"')}</div>
</header>

<section id="simbolo">
 <p class="ovl">Símbolo</p><h2>Oreja y cola</h2>
 <div class="story" style="margin-top:20px">
  <div class="panel" style="display:flex;justify-content:center">{construction()}</div>
  <div>
   <p style="font-size:17px;line-height:1.5">Tres trazos y un punto. Se lee como una letra antes que como un animal, y por eso no es un cliché de mascota.</p>
   <ol>
    <li><b>El asta</b> es la K de Kitom.</li>
    <li><b>La oreja</b> (verde laguna en el esquema) es el brazo superior: sube y se pliega, atenta. Vale para una oreja de perro o de gato.</li>
    <li><b>La cola</b> es la pierna de la K y termina en un giro hacia arriba, el gesto de un animal contento.</li>
    <li><b>El punto sol</b> es hoy. En el logotipo pasa a ser el punto de la i, y en la app marca el día que falta por registrar.</li>
   </ol>
   <p class="cap">Trazo de 7/64, terminaciones redondas, el mismo peso que la tipografía Hanken Grotesk SemiBold, para que símbolo y letras sean una sola pieza.</p>
  </div>
 </div>
 <h3 class="sub">Pulido de la versión final</h3>
 <div class="alts">
  <div class="alt"><div class="row" style="align-items:end;gap:10px">{sym_v0(72)}{sym_v0(24)}{sym_v0(16)}</div><b>Antes</b>Pata interior de la oreja larga: a 16 px la oreja y la cola se tocaban.</div>
  <div class="alt win"><div class="row" style="align-items:end;gap:10px">{inline(SYM(), h=72)}{inline(SYM(), h=24)}</div><b>Después · símbolo</b>Oreja más redonda y corta, hueco abierto entre oreja y cola, giro final más cerrado y punto sol más cerca.</div>
  <div class="alt win"><div class="row" style="align-items:end;gap:10px">{inline(SYMS(), h=24)}{inline(SYMS(), h=20)}{inline(SYMS(), h=16)}</div><b>Corte pequeño</b>Nuevo, para 32 px o menos: trazo 9/64 y punto mayor. Favicon y notificaciones.</div>
  <div class="alt win"><div style="width:100%">{inline(LT(), w="100%")}</div><b>Logotipo</b>Más aire entre la cola y la ı (el mismo que entre la ı y la t) y punto de la i de diámetro 8.</div>
 </div>
 <h3 class="sub">Exploración</h3>
 <div class="alts">
  <div class="alt win">{inline(SYM(), h=72)}<b>Oreja y cola</b>Elegida. Más animal y más legible a 24 px.</div>
  <div class="alt">{ALT_EAR}<b>Oreja de Cuaderno</b>El punto de partida. Solo una señal; la pierna recta se lee como letra y nada más.</div>
  <div class="alt">{ALT_SOLID}<b>Oreja maciza</b>Más pesada; la oreja sólida rompe el lenguaje de línea del resto del sistema.</div>
  <div class="alt">{ALT_TWO}<b>Dos orejas</b>Una erguida y otra caída. Bonita idea, pero a tamaño pequeño parece un 8.</div>
 </div>
</section>

<section id="versiones">
 <p class="ovl">Logo</p><h2>Versiones</h2>
 <p class="lead">El logotipo usa el símbolo como K y el punto sol como punto de la i, así que nunca se escribe "kitom" en texto junto al símbolo. Letras de Hanken Grotesk SemiBold convertidas a trazado.</p>
 <div class="g2">
  <div><div class="tile" style="background:#FFFFFF;border:1px solid var(--line)">{inline(LT(), w="80%", extra='style="max-width:300px"')}</div><p class="cap">Principal y horizontal · kitom-logotipo</p></div>
  <div><div class="tile" style="background:#0E3B39">{inline(LT('#F2F5F3'), w="80%", extra='style="max-width:300px"')}</div><p class="cap">Inversa sobre laguna-900 · kitom-logotipo-inverso</p></div>
 </div>
 <div class="g4">
  <div><div class="tile" style="background:#FFFFFF;border:1px solid var(--line);min-height:120px">{inline(SYM(), h=64)}</div><p class="cap">Compacta · kitom-simbolo</p></div>
  <div><div class="tile" style="background:#0E3B39;min-height:120px">{inline(SYM('#F2F5F3'), h=64)}</div><p class="cap">Compacta inversa</p></div>
  <div><div class="tile" style="background:#E6ECE9;min-height:120px">{inline(LT('#0F2A29','#0F2A29'), w="85%")}</div><p class="cap">Mono, una tinta</p></div>
  <div><div class="tile" style="background:#1F6F6B;min-height:120px">{inline(LT('#FFFFFF','#FFFFFF'), w="85%")}</div><p class="cap">Mono blanco</p></div>
 </div>
 <div class="panel" style="margin-top:16px">
  <div class="sizes">{inline(LT(), h=40)}{inline(LT(), h=24)}{inline(LT(), h=16)}{inline(SYM(), h=48)}{inline(SYMS(), h=32)}{inline(SYMS(), h=24)}{inline(SYMS(), h=16)}{inline(icon_small(), h=32)}{inline(icon_small(), h=16)}</div>
  <p class="cap">Tamaños mínimos: logotipo 72 px de ancho, símbolo 16 px de alto. Desde 32 px hacia abajo se usa el corte pequeño (kitom-simbolo-pequeno), también en el favicon. Espacio libre alrededor: dos veces la altura del punto.</p>
 </div>
</section>

<section id="icono">
 <p class="ovl">Icono de app</p><h2>iOS y Android</h2>
 <div class="g3">
  <div class="panel" style="display:flex;flex-direction:column;align-items:center;gap:14px">
   <div class="row" style="align-items:end">{inline(app_icon(rounded=True), h=120)}{inline(app_icon(rounded=True), h=60)}{inline(app_icon(rounded=True), h=29)}</div>
   <p class="cap" style="text-align:center">iOS · 1024 px sin redondeo (lo aplica el sistema). Fondo laguna-900, símbolo niebla-100 y punto sol.</p></div>
  <div class="panel" style="display:flex;flex-direction:column;align-items:center;gap:14px">
   <div class="row" style="align-items:end">
    <div style="width:108px;height:108px;border-radius:50%;overflow:hidden">{inline(app_icon(frac=0.42), w=108)}</div>
    <div style="width:108px;height:108px;border-radius:30px;overflow:hidden">{inline(app_icon(frac=0.42), w=108)}</div>
    <div style="width:64px;height:64px;border-radius:50%;overflow:hidden;background:#DCEBE6">{inline(app_icon(ink='#185956',dot='#185956',frac=0.42,transparent=True), w=64)}</div>
   </div>
   <p class="cap" style="text-align:center">Android adaptativo (el símbolo vive dentro de la zona segura de 66 dp, sirve para cualquier máscara), versión monocroma para iconos temáticos e icono de notificación en blanco con el corte pequeño.</p></div>
  <div><div class="home">
   <div><span class="other"></span>Fotos</div><div><span class="other"></span>Mapas</div><div>{inline(app_icon(rounded=True), h=60)}Kitom</div><div><span class="other"></span>Notas</div>
   <div><span class="other"></span>Reloj</div><div><span class="other"></span>Tiempo</div><div><span class="other"></span>Música</div><div><span class="other"></span>Ajustes</div>
  </div><p class="cap">En la pantalla de inicio, a tamaño real.</p></div>
 </div>
</section>

<section id="color">
 <p class="ovl">Color</p><h2>Laguna, sol y arena</h2>
 <p class="lead">Laguna es la tinta de acción y de marca. Sol es solo "hoy", rachas e insignias. Arena aporta calidez a la voz de la mascota. Todo par de texto cumple 4,5:1 en tema claro y oscuro.</p>
 <h3 class="sub">Principal</h3>
 <div class="swatches">{SW('#1F6F6B','Laguna · primary','<br>Acción, foco, energía')}{SW('#0E3B39','Laguna 900','<br>Icono, racha, banners')}{SW('#DCEBE6','Laguna 100','<br>Selección, paneles')}{SW('#F2B441','Sol · accent','<br>Hoy, rachas, insignias')}</div>
 <h3 class="sub">Secundaria y neutros</h3>
 <div class="swatches">{SW('#F7EDE6','Arena 100','<br>Voz de la mascota')}{SW('#7D543C','Arena 700','<br>Texto cálido')}{SW('#F2F5F3','Niebla · bg','<br>Fondo claro')}{SW('#0F2A29','Tinta · ink','<br>Texto')}{SW('#566A67','ink-muted','<br>Texto secundario')}{SW('#0C1918','Noche · bg oscuro','<br>Fondo oscuro')}</div>
 <h3 class="sub">Semántica: urgencia y sistema</h3>
 <div class="row" style="margin-top:14px">{urg}</div>
 <div class="row" style="margin-top:10px"><span class="tag" style="background:#DDF0E6;color:#1D6B47">{ic('check',14)}Guardado</span><span class="tag" style="background:#FBE4E1;color:#B42318">{ic('info',14)}Error del sistema</span></div>
 <p class="cap">Observar pasa a azul pizarra para no confundirse con el verde de marca. Los cuatro niveles crecen en intensidad y se distinguen también en escala de grises; siempre llevan icono y texto.</p>
</section>

<section id="tipo">
 <p class="ovl">Tipografía</p><h2>Hanken Grotesk e IBM Plex Mono</h2>
 <p class="lead">Una sola familia para la interfaz, cálida y muy legible con texto grande. La mono solo para cifras, fechas y unidades, para comparar días de un vistazo.</p>
 <div class="panel" style="margin-top:16px;padding-top:8px">{typerows}</div>
</section>

<section id="iconos">
 <p class="ovl">Iconos e imagen</p><h2>Línea de 2 px y fotos reales</h2>
 <div class="icons">{''.join(f'<span>{ic(n,28)}{n}</span>' for n in ['home','chart','camera','calendar','user','eye','refresh-cw','stethoscope','triangle-alert','bell','notebook','wifi-off'])}</div>
 <p class="cap">Base Lucide: trazo 2 px, terminaciones redondas, rejilla de 24, el mismo trazo que el símbolo. Sin huellas, huesos ni siluetas como decoración.</p>
 <div class="photos">
  <div class="photo" style="background:radial-gradient(60% 50% at 45% 45%,#D9C3AE,transparent 70%),radial-gradient(70% 60% at 85% 90%,#2E5A52,transparent 70%),linear-gradient(170deg,#C9DCD4,#56786F)"><span>Su mascota, en casa, luz de día</span></div>
  <div class="photo" style="background:radial-gradient(55% 50% at 50% 40%,#EFD9CB,transparent 70%),linear-gradient(200deg,#A8C4BA,#1F4B47)"><span>Paseo, a la altura del animal</span></div>
  <div class="photo" style="background:#FFFFFF;display:flex;align-items:center;justify-content:center;border:1px solid var(--line)"><svg viewBox="0 0 120 70" width="80%" aria-hidden="true" fill="none" stroke="#0F2A29" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 46 Q14 22 24 14 Q28 30 30 46"/><path d="M50 46 Q50 18 58 8 Q66 22 68 46"/><path d="M88 46 Q100 30 114 30 Q104 40 106 46"/><g stroke="none" fill="#566A67" font-family="Hanken Grotesk,sans-serif" font-size="7" text-anchor="middle"><text x="20" y="60">relajada</text><text x="59" y="60">atenta</text><text x="100" y="60">hacia atrás</text></g></svg><span style="color:#566A67;text-shadow:none">Ilustración de línea para explicar señales</span></div>
 </div>
</section>

<section id="aplicada">
 <p class="ovl">Aplicación</p><h2>La Home con la identidad consolidada</h2>
 <p class="lead">Mismos tokens en claro y oscuro: anillo semanal con el punto de hoy pendiente, la voz de Kika en arena, métricas en mono y una señal en Observar.</p>
 <div class="phones">{phone('light')}{phone('dark')}</div>
</section>

<section id="voz">
 <p class="ovl">Voz y tono</p><h2>Como una amiga que sabe de animales</h2>
 <p class="lead">Cercana, tranquila y clara. Tuteamos, usamos el nombre de la mascota y nunca decimos "diagnóstico": decimos orientación, posibles causas y señales de alerta. En una urgencia, directos y sin suavizar.</p>
 <div class="g2">
  <div class="lock">
   <div class="notif">{inline(app_icon(rounded=True), h=34)}<span><b>¿Qué tal ha ido el día de Kika?</b>Un minuto para tu registro de hoy.<br><small>Kitom · ahora</small></span></div>
   <div class="notif">{inline(app_icon(rounded=True), h=34)}<span><b>Kika ha comido menos estos 3 días</b>Abre Kitom para añadir detalles o ver posibles causas.<br><small>Kitom · 9:12</small></span></div>
   <div class="notif">{inline(app_icon(rounded=True), h=34)}<span><b>Mañana: vacuna anual de Atom</b>Sábado 18 a las 10:00.<br><small>Kitom · ayer</small></span></div>
  </div>
  <div class="tblw"><table class="copy"><tr><th>Momento</th><th>Texto</th></tr>
   <tr><td>Registro guardado</td><td>Hecho. Kika lleva 5 de 7 días esta semana.</td></tr>
   <tr><td>Racha rota</td><td>Empezáis otra racha hoy.</td></tr>
   <tr><td>Sin conexión</td><td>Guardamos el registro en el móvil y lo subiremos al volver la conexión.</td></tr>
   <tr><td>Resultado de orientación</td><td>Posibles causas… Esta orientación es informativa y no sustituye a un veterinario.</td></tr>
   <tr><td>Urgencia</td><td>Lleva a Atom al veterinario ahora.</td></tr>
   <tr><td>Voz de la mascota</td><td>Hoy he dormido mucho. ¿Paseo largo?</td></tr>
  </table></div>
 </div>
</section>

<section id="reglas">
 <p class="ovl">Reglas</p><h2>Uso correcto e incorrecto</h2>
 <div class="dodont">
  <div class="dd yes"><div class="v" style="background:#FFFFFF">{inline(LT(), w="70%")}</div><p><b>Sí</b>Logotipo sobre niebla, blanco o laguna-900.</p></div>
  <div class="dd no"><div class="v" style="background:#FFFFFF;gap:8px">{inline(SYM(), h=40)}<span style="font:600 30px var(--k-sans);color:#0F2A29;letter-spacing:-.04em">kitom</span></div><p><b>No</b>Escribir "kitom" junto al símbolo: el símbolo ya es la K.</p></div>
  <div class="dd no"><div class="v" style="background:#FFFFFF">{inline(LT('#0F2A29','#B42318'), w="70%")}</div><p><b>No</b>Cambiar el color del punto. Es siempre sol (o la tinta, en mono).</p></div>
  <div class="dd no"><div class="v" style="background:linear-gradient(135deg,#7FA7C9,#8E6CC2)">{inline(LT('#FFFFFF'), w="70%")}</div><p><b>No</b>Degradados ni fondos de colores fuera de la paleta.</p></div>
  <div class="dd no"><div class="v" style="background:#FFFFFF"><span style="transform:rotate(-12deg) scaleX(1.25);display:inline-block">{inline(SYM(), h=56)}</span></div><p><b>No</b>Girar, inclinar o deformar el símbolo.</p></div>
  <div class="dd yes"><div class="v" style="background:#F2F5F3"><span class="tag" style="background:#B42318;color:#fff">{ic('triangle-alert',14)}Urgente, acudir ahora</span></div><p><b>Sí</b>Urgencia con su color, su icono y su texto, sin suavizarla.</p></div>
 </div>
</section>

<div class="next"><b>Para desarrollo:</b> tokens, 14 componentes con sus reglas, logos e iconos están en el <a href="https://claude.ai/artifact/LS1y4cit6jZWchSVfcg6c3">sistema de diseño de Kitom</a>. Siguiente paso, cuando lo apruebes: el prototipo de alta fidelidad de las 10 pantallas.</div>
</div>
'''

if __name__ == '__main__':
    out = os.path.join(SCR, 'kitom-identidad.html')
    open(out, 'w').write(page())
    print(out, os.path.getsize(out))
