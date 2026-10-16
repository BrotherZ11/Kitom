def lum(h):
  h=h.lstrip('#');r,g,b=[int(h[i:i+2],16)/255 for i in (0,2,4)]
  f=lambda c:c/12.92 if c<=0.03928 else ((c+0.055)/1.055)**2.4
  return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b)
def cr(a,b):
  la,lb=sorted([lum(a),lum(b)],reverse=True);return (la+0.05)/(lb+0.05)
pairs={
'light':[('ink','#0F2A29','#F2F5F3'),('muted','#566A67','#F2F5F3'),('muted/white','#566A67','#FFFFFF'),('primary/white','#1F6F6B','#FFFFFF'),('white/primary','#FFFFFF','#1F6F6B'),
 ('control border','#7E918D','#FFFFFF'),('focus','#1F6F6B','#F2F5F3'),('subtle','#7E918D','#FFFFFF'),
 ('obs text','#2D5F80','#E3EEF5'),('rut text','#7A4D00','#FCEFCF'),('pronto text','#9A3412','#FBE2D5'),('urg white','#FFFFFF','#B42318'),('ok text','#1D6B47','#DDF0E6'),
 ('sol/pino','#F2B441','#0E3B39'),('ink/sol','#0F2A29','#F2B441'),('accent-ink on white','#8A5A00','#FFFFFF'),('ink/brandsoft','#0F2A29','#DCEBE6')],
'dark':[('ink','#E6EFEC','#0C1918'),('muted','#9DB2AE','#0C1918'),('muted/surface','#9DB2AE','#152624'),('primary/bg','#6CC0B4','#0C1918'),('onprimary','#06201E','#6CC0B4'),
 ('control border','#5E7773','#152624'),('focus','#6CC0B4','#152624'),
 ('obs text','#9CC8E4','#152A36'),('rut text','#F2C46B','#33270F'),('pronto text','#F5A783','#3A1F14'),('urg white','#FFFFFF','#B42318'),('ok text','#8FD3B0','#123325'),('sol/bg','#F2B441','#0C1918')]}
if __name__=="__main__":
 for t,ps in pairs.items():
   for n,a,b in ps: print(t,n,round(cr(a,b),2))
