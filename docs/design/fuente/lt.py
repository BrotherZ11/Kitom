import json
from brand import *
IT=json.load(open(os.path.join(HERE,'wm_itom2.json')))
def sym_nodot(ink,tx,ty,s):
  x0,y0=SYM_BOX[0],SYM_BOX[1]
  paths="".join(f'<path d="{d}"/>' for d in SYM_PATHS)
  return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({s:.4f}) translate({-x0} {-y0})">'
          f'<g fill="none" stroke="{ink}" stroke-width="{SYM_STROKE}" stroke-linecap="round" stroke-linejoin="round">{paths}</g></g>')
def logotype(ink='#0F2A29',dot='#F2B441',word=None,ss=0.95,gap=2.0,r=4.4):
  word=word or ink
  w=SYM_W*ss
  base=(55-SYM_BOX[1])*ss+2.2
  wx=w+gap-64*WM_S
  W=wx+IT['width']*WM_S+1
  top_dot=base-633*WM_S-r
  H=max(SYM_H*ss,base+0.6)
  dx=wx+119.5*WM_S; dy=base-640*WM_S
  body=(sym_nodot(ink,0,0,ss)+f'<path transform="translate({wx:.2f} {base:.2f}) scale({WM_S})" fill="{word}" d="{IT["d"]}"/>'
        f'<circle cx="{dx:.2f}" cy="{dy:.2f}" r="{r}" fill="{dot}"/>')
  return svg(round(W,1),round(H,1),body)
if __name__=='__main__':
  out=os.path.join(HERE,'out','try');os.makedirs(out,exist_ok=True)
  for i,(ss,g) in enumerate([(0.95,1.5),(0.9,3),(1.0,1.0),(0.95,4)]):
    open(f'{out}/t{i}.svg','w').write(logotype(ss=ss,gap=g))
  open(f'{out}/t4.svg','w').write(logotype('#F2F5F3',ss=0.95,gap=3))
