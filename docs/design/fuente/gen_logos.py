import os
from brand import *
from lt import logotype
LT=lambda ink='#0F2A29',dot='#F2B441':logotype(ink,dot,ss=0.95,gap=6,r=4.0)
OUT=os.path.join(HERE,'out','logos'); os.makedirs(OUT,exist_ok=True)
F={
 'kitom-simbolo.svg':logo_symbol(),
 'kitom-simbolo-inverso.svg':logo_symbol('#F2F5F3','#F2B441'),
 'kitom-simbolo-mono-tinta.svg':logo_symbol('#0F2A29','#0F2A29'),
 'kitom-simbolo-mono-blanco.svg':logo_symbol('#FFFFFF','#FFFFFF'),
 'kitom-logotipo.svg':LT(),
 'kitom-logotipo-inverso.svg':LT('#F2F5F3','#F2B441'),
 'kitom-logotipo-mono-tinta.svg':LT('#0F2A29','#0F2A29'),
 'kitom-logotipo-mono-blanco.svg':LT('#FFFFFF','#FFFFFF'),
 'app-icon-ios.svg':app_icon(),
 'app-icon-redondeado-preview.svg':app_icon(rounded=True),
 'android-adaptive-foreground.svg':app_icon(frac=0.42,transparent=True),
 'android-adaptive-background.svg':svg(1024,1024,'<rect width="1024" height="1024" fill="#0E3B39"/>'),
 'android-monochrome.svg':app_icon(ink='#000000',dot='#000000',frac=0.42,transparent=True),
 'splash-icon.svg':app_icon(frac=0.42,transparent=True,ink='#0E3B39',dot='#F2B441'),
 'kitom-simbolo-pequeno.svg':logo_symbol_small(),
 'kitom-simbolo-pequeno-inverso.svg':logo_symbol_small('#F2F5F3','#F2B441'),
 'favicon.svg':icon_small(size=64,frac=0.66,rounded=True),
 'android-notification.svg':icon_small(ink='#FFFFFF',dot='#FFFFFF',size=96,frac=0.75,transparent=True),
}
for k,v in F.items(): open(os.path.join(OUT,k),'w').write(v)
print(len(F))
# PNG: render con Chromium (fondo transparente donde no hay rectángulo)
import subprocess, tempfile
CH='/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
PNG=os.path.join(HERE,'out','png'); os.makedirs(PNG,exist_ok=True)
for name,size in [('app-icon-ios',1024),('android-adaptive-foreground',1024),('android-adaptive-background',1024),
                  ('android-monochrome',1024),('splash-icon',1024),('favicon',64),('android-notification',96)]:
    svgp=os.path.join(OUT,name+'.svg')
    html=os.path.join(tempfile.gettempdir(),'k_'+name+'.html')
    open(html,'w').write(f'<html><body style="margin:0;background:transparent"><img src="file://{svgp}" width="{size}" height="{size}" style="display:block"></body></html>')
    subprocess.run([CH,'--headless','--no-sandbox','--disable-gpu','--hide-scrollbars','--default-background-color=00000000',
                    f'--window-size={size},{size}',f'--screenshot={os.path.join(PNG,name+".png")}','file://'+html],capture_output=True)
print(sorted(os.listdir(PNG)))
