from PIL import Image,ImageDraw
from pathlib import Path
p=Path(__file__).resolve().parent
im=Image.new('RGBA',(512,512));d=ImageDraw.Draw(im)
d.rounded_rectangle((8,8,504,504),radius=110,fill='#123e4b',outline='#bd9962',width=8)
for i,c in enumerate(['#246b7d','#278b96','#36a6ab']):d.ellipse((-100,265+i*55,640,650+i*55),fill=c)
d.ellipse((313,76,394,157),fill='#f5c675')
d.polygon([(96,335),(268,279),(426,345),(252,417)],fill='#8c603d',outline='#153e49',width=5)
for i in range(5):
 x=99+i*34;z=330-i*11
 d.polygon([(x,z),(x+27,z-9),(x+181,z+67),(x+151,z+79)],fill=['#cb995b','#deb577'][i%2],outline='#946939',width=3)
d.line([(265,300),(265,104)],fill='#775331',width=12)
d.polygon([(254,117),(254,278),(127,278)],fill='#f9e7bb',outline='#b99461',width=5)
d.polygon([(281,144),(281,279),(371,279)],fill='#e7c68b',outline='#b99461',width=5)
d.line([(254,267),(145,267)],fill='#dd8d55',width=9)
d.polygon([(267,103),(319,115),(269,130)],fill='#e89b5c')
im.save(p/'little-raft.png');im.save(p/'little-raft.ico',sizes=[(16,16),(32,32),(48,48),(128,128),(256,256)])
