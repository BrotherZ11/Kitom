import json,os
from brand import *
OUT=os.path.join(HERE,'out'); DS=os.path.join(HERE,'ds','project'); os.makedirs(DS,exist_ok=True); os.makedirs(OUT+'/tokens',exist_ok=True)
# ---------- Design System tokens.json (forma de listas)
ct=[]
for n,l,d,u in SEM: ct.append({"name":n,"value":{"light":l,"dark":d},"usage":u})
for n,v in PRIM: ct.append({"name":n,"value":v,"usage":PRIM_USAGE[n.split('-')[0]]})
groups={}
for g,n,fam,sz,lh,w,ls,u,sm in TYPE:
  groups.setdefault(g,[]).append({"name":n,"family":fam,"fontSize":f"{sz}px","lineHeight":f"{lh}px","fontWeight":w,"letterSpacing":f"{ls}px","usage":u,"sample":sm})
ds={"name":"Kitom","version":1,
 "meta":{"source":"Identidad Kitom · dirección Ritmo (oct 2026)"},
 "color":{"themes":[{"id":"light","name":"Claro"},{"id":"dark","name":"Oscuro"}],"tokens":ct},
 "type":{"fonts":[],"families":{"sans":FAM_SANS,"mono":FAM_MONO},
   "groups":[{"name":g,"family":("mono" if g=="Data" else "sans"),"styles":s} for g,s in groups.items()]},
 "spacing":{"tokens":[{"name":n,"value":f"{v}px","usage":u} for n,v,u in SPACING]},
 "radius":{"tokens":[{"name":n,"value":f"{v}px","usage":u} for n,v,u in RADIUS]},
 "shadow":{"tokens":[{"name":n,"value":{"light":l,"dark":d},"usage":u} for n,l,d,u in SHADOW]},
 "borderWidth":{"tokens":[{"name":n,"value":f"{v}px","usage":u} for n,v,u in BORDER]},
 "iconSize":{"tokens":[{"name":n,"value":f"{v}px","usage":u} for n,v,u in ICON]},
 "size":{"tokens":[{"name":n,"value":f"{v}px","usage":u} for n,v,u in SIZE]},
 "opacity":{"tokens":[{"name":n,"value":v,"usage":u} for n,v,u in OPACITY]},
}
json.dump(ds,open(DS+'/tokens.json','w'),ensure_ascii=False,indent=1)
# ---------- tokens planos (para cualquier herramienta)
flat={"color":{"light":{n:l for n,l,d,u in SEM},"dark":{n:d for n,l,d,u in SEM}},"palette":dict(PRIM),
 "typography":{n:{"family":fam,"fontSize":sz,"lineHeight":lh,"fontWeight":w,"letterSpacing":ls} for g,n,fam,sz,lh,w,ls,u,sm in TYPE},
 "spacing":{n:v for n,v,u in SPACING},"radius":{n:v for n,v,u in RADIUS},"borderWidth":{n:v for n,v,u in BORDER},
 "iconSize":{n:v for n,v,u in ICON},"size":{n:v for n,v,u in SIZE},"opacity":{n:float(v) for n,v,u in OPACITY},"motion":MOTION}
json.dump(flat,open(OUT+'/tokens/tokens.json','w'),ensure_ascii=False,indent=2)
# ---------- React Native (TypeScript)
def cc(n):
  p=n.replace('.','_').split('-');return p[0]+''.join(x[:1].upper()+x[1:] for x in p[1:])
def obj(d,ind=2):
  sp=' '*ind;return '{\n'+''.join(f"{sp}{k}: {v},\n" for k,v in d.items())+' '*(ind-2)+'}'
L=[]
L.append("""// Tokens de diseño de Kitom (dirección Ritmo). Generado desde la fuente de marca:
// no editar a mano; cambia brand.py y regenera. Ver docs de marca en docs/design/.
// Uso previsto: frontend/src/theme/tokens.ts + ThemeProvider (React Context) que elige light/dark
// según useColorScheme(). Requiere @expo-google-fonts/hanken-grotesk e ibm-plex-mono (pendiente de instalar).
""")
L.append("export const palette = "+obj({cc(n):f"'{v}'" for n,v in PRIM})+" as const;\n")
for th,idx in (("light",1),("dark",2)):
  L.append(f"const {th}Colors = "+obj({cc(r[0]):f"'{r[idx]}'" for r in SEM})+" as const;\n")
L.append("export type ColorTokens = { [K in keyof typeof lightColors]: string };\n")
L.append("export const colors: { light: ColorTokens; dark: ColorTokens } = { light: lightColors, dark: darkColors };\n")
L.append("export const fontFamily = "+obj({f"{fam}{w}":f"'{RN_FONT[(fam,w)]}'" for (fam,w) in RN_FONT})+" as const;\n")
ty={}
for g,n,fam,sz,lh,w,ls,u,sm in TYPE:
  extra=", textTransform: 'uppercase' as const" if n=='overline' else ''
  ty[cc(n)]="{ fontFamily: '%s', fontSize: %d, lineHeight: %d, letterSpacing: %s%s }"%(RN_FONT[(fam,w)],sz,lh,ls,extra)
L.append("/** Escala tipográfica. Respeta el tamaño de texto del sistema (allowFontScaling) con maxFontSizeMultiplier 1.6 en controles. */\nexport const typography = "+obj(ty)+" as const;\n")
for name,arr in (("spacing",SPACING),("radius",RADIUS),("borderWidth",BORDER),("iconSize",ICON),("size",SIZE)):
  pre={'spacing':'space-','radius':'radius-','borderWidth':'border-','iconSize':'icon-','size':'size-'}[name]
  L.append(f"export const {name} = "+obj({cc(n[len(pre):]) if not n[len(pre):][0].isdigit() else f"'{n[len(pre):]}'":v for n,v,u in arr})+" as const;\n")
L.append("export const opacity = "+obj({cc(n[8:]):v for n,v,u in OPACITY})+" as const;\n")
L.append("/** Sombras: iOS usa shadow*, Android usa elevation. En tema oscuro usar surface más clara en vez de sombra. */\nexport const elevation = "+obj({f"'{k[-1]}'":"{ shadowColor: '%s', shadowOpacity: %s, shadowRadius: %s, shadowOffset: { width: 0, height: %s }, elevation: %s }"%(v['shadowColor'],v['shadowOpacity'],v['shadowRadius'],v['shadowOffset']['height'],v['elevation']) for k,v in RN_SHADOW.items()})+" as const;\n")
L.append("export const motion = "+obj({cc(k):json.dumps(v) for k,v in MOTION.items()})+" as const;\n")
L.append("""/** Márgenes: gutter lateral de 20 y áreas seguras de react-native-safe-area-context (insets.top/bottom). */
export const layout = { screenGutter: 20, cardPadding: 16, sectionGap: 24, maxContentWidth: 560, bottomCtaGap: 12 } as const;
""")
u={}
for key,label,icon,bg,fg in URGENCY:
  u[cc(key.replace('_','-'))]="{ dbValue: '%s', background: '%s', foreground: '%s', icon: '%s', labelKey: 'urgency.%s' }"%(key,cc(bg),cc(fg),icon,key)
L.append("/** Niveles de urgencia (PRD 8.4). Claves de colors; siempre icono (Lucide) + texto, nunca solo color. */\nexport const urgency = "+obj(u)+" as const;\n")
open(OUT+'/tokens/tokens.ts','w').write('\n'.join(L))
print(open(OUT+'/tokens/tokens.ts').read()[-2600:])
