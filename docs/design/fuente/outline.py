import sys,json
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
f=TTFont('fonts/hanken600.ttf');gs=f.getGlyphSet();cmap=f.getBestCmap();upm=f['head'].unitsPerEm
text=sys.argv[1];track=float(sys.argv[2])*upm
pen=SVGPathPen(gs);x=0
for ch in text:
  g=cmap[ord(ch)];tp=TransformPen(pen,(1,0,0,-1,x,0));gs[g].draw(tp);x+=gs[g].width+track
x-=track
os2=f['OS/2']
print(json.dumps({"d":pen.getCommands(),"width":x,"upm":upm,"xh":os2.sxHeight,"cap":os2.sCapHeight,"asc":f['hhea'].ascent}))
