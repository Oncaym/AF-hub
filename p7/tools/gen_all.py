import sys, json, math, os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from gen_kb import pieces_for, corners, CLIPS as KBCLIPS
from seam2 import seglist, hatch_area
from dlo import segs, box
import pymupdf
from PIL import Image, ImageOps
pymupdf.TOOLS.mupdf_display_errors(False)
R=pymupdf.Rect
OUT=os.environ.get('P7_OUT','p7v2'); os.makedirs(OUT,exist_ok=True)
# Final Design-2 sets: A37811_DU2C (Kingsbridge, 117 pp) and A37811_DU1C (167th St, 75 pp)
KB=pymupdf.open(os.environ.get('P7_KB_PDF','KB.pdf')); S7=pymupdf.open(os.environ.get('P7_S167_PDF','S167.pdf'))
FLOORS=[]; PIECES=[]
def add_floor(key,name,doc,pg,clip,sheet,dpi=150):
    pix=doc[pg-1].get_pixmap(dpi=dpi,clip=clip)
    im=Image.frombytes("RGB",(pix.width,pix.height),pix.samples).convert("L")
    fn=f"{key.lower()}.png"; im.save(f"{OUT}/{fn}",optimize=True)
    ImageOps.invert(im).save(f"{OUT}/{key.lower()}-white.png",optimize=True)
    FLOORS.append(dict(key=key,name=name,img=fn,imgDark=f"{key.lower()}-white.png",sheet=sheet,size=[pix.width,pix.height],clip=list(clip)))
def norm(clip,r):
    return dict(x=round((r.x0-clip.x0)/clip.width*100,3),y=round((r.y0-clip.y0)/clip.height*100,3),
                w=round(r.width/clip.width*100,3),h=round(r.height/clip.height*100,3))
def normpoly(clip,pts):
    return [[round((x-clip.x0)/clip.width*100,3),round((y-clip.y0)/clip.height*100,3)] for x,y in pts]
TYPE={'frame':'Frame','glass':'Glass','band':'Metal Panel','panel':'Metal Panel','louver':'Louver','cp':'Control Panel',
      'com':'Composite Panel','canopy':'Glass Canopy','corner':'Corner Panel','roof':'Standing Seam Roof'}
def piece(pid,kind,zone,floor,geos,ppf,sub=None,extra=None):
    # geos: list of (floorkey, clip, rect)
    r0=geos[0][2]
    w_in=round(r0.width/ppf*12,1); h_in=round(r0.height/ppf*12,1)
    sf=round(w_in*h_in/144,1)
    u=dict(key=pid,id=pid,type=TYPE[kind],kind=kind,zone=zone,level=floor,status='pending',date='',louver='na',
           sub=sub or '',w=w_in,h=h_in,sf=sf,geo=[dict(f=f,**norm(c,r)) for f,c,r in geos])
    sz=f'{w_in}" x {h_in}"'
    u['note']=' · '.join(x for x in [sub or TYPE[kind], sz, f'{sf} sf'] if x)
    if extra: u.update(extra)
    PIECES.append(u)
# ---------------- KB elevations
for el,pg,sheet in (('535',56,'KGS-A-421'),('536',59,'KGS-A-424')):
    page=KB[pg-1]; SP={}
    for side,nm in (('E','East'),('S','South'),('W','West'),('N','North')):
        clip=R(KBCLIPS[side].x0,95,KBCLIPS[side].x1,1000) if True else None
        clip=R(KBCLIPS[side].x0,95,KBCLIPS[side].x1,1012)
        fk=f"{el}{side}"; add_floor(fk,{'en':f'EL-{el} {nm}','zh':f'EL-{el} {nm}'},KB,pg,clip,sheet)
        SP[side]=pieces_for(page,el,side)
        for p in SP[side]:
            piece(p['id'],p['kind'],f'EL-{el}',fk,[(fk,clip,p['r'])],18.0,sub=p.get('sub'),extra={'frame':p.get('frame','')} if p.get('frame') else None)
    for c in corners(page,el,SP):
        geos=[(f"{el}{s}",R(KBCLIPS[s].x0,95,KBCLIPS[s].x1,1012),r) for s,r in c['geos']]
        piece(c['id'],'corner',f'EL-{el}',geos[0][0],geos,18.0,extra={'corner':c['corner']})
# ---------------- 167 elevations (manual grid from vector lines, 3/4" = 54 pt/ft)
P54=54.0
def grid167(fk,clip,el,face,spec):
    """spec: list of (kind, rect, sub, label-prefix-hint)"""
    frames=[s for s in spec if s[0]=='frame']
    frames.sort(key=lambda s:(round(s[1].y0/10),s[1].x0))
    fid={}
    for i,s in enumerate(frames,1):
        fid[id(s)]=f"{el}{face}-{i}"; piece(f"{el}{face}-{i}",'frame',f'EL-{el}',fk,[(fk,clip,s[1])],P54)
    for s in frames:
        kids=[k for k in spec if k[0] in('glass','louver','panel') and s[1].contains(pymupdf.Point((k[1].x0+k[1].x1)/2,(k[1].y0+k[1].y1)/2))]
        kids.sort(key=lambda k:(round(k[1].y0/10),k[1].x0)); n={'glass':0,'louver':0,'panel':0}; pre={'glass':'G','louver':'L','panel':'M'}
        for k in kids:
            n[k[0]]+=1; piece(f"{fid[id(s)]}-{pre[k[0]]}{n[k[0]]}",k[0],f'EL-{el}',fk,[(fk,clip,k[1])],P54,sub=k[2],extra={'frame':fid[id(s)]})
    bands=sorted([s for s in spec if s[0]=='band'],key=lambda s:(s[1].y0,s[1].x0))
    for j,s in enumerate(bands,1): piece(f"{el}{face}-H{j}",'band',f'EL-{el}',fk,[(fk,clip,s[1])],P54,sub=s[2])
    for j,s in enumerate([s for s in spec if s[0]=='cp'],1): piece(f"{el}{face}-CP{j}",'cp',f'EL-{el}',fk,[(fk,clip,s[1])],P54)
    for j,s in enumerate([s for s in spec if s[0]=='canopy'],1): piece(f"{el}{face}-GC{j}",'canopy',f'EL-{el}',fk,[(fk,clip,s[1])],P54)
def cols_rows(xs,ys,kind,sub):
    out=[]
    for (y0,y1) in ys:
        for (x0,x1) in xs: out.append((kind,R(x0,y0,x1,y1),sub))
    return out
C167={}
def front(el,xs,sl,sr,cp,clip,fk):
    spec=[('frame',R(xs[0][0],220,xs[-1][1],499),None)]
    spec+=cols_rows(xs,[(220,358),(360,499)],'glass','GL-02')
    spec+=[('band',R(xs[0][0],502,xs[-1][1],610),'Signage / MT-03'),
           ('frame',R(sl[0],612,sl[1],809),None),('glass',R(sl[0]+1,613,sl[1]-1,808),'GL-03'),
           ('frame',R(sr[0],612,sr[1],809),None),('glass',R(sr[0]+1,613,sr[1]-1,808),'GL-03'),
           ('cp',R(cp[0],612,cp[1],809),None),
           ('canopy',R(xs[0][0]-12,440,xs[-1][1]+12,512),None)]
    grid167(fk,clip,el,'N',spec)
def side(el,face,clip,fk):
    xs=[(480,607),(609,731),(733,854),(857,981)]
    spec=[('frame',R(480,220,981,499),None)]+cols_rows(xs,[(220,358),(360,499)],'glass','GL-02')
    spec+=[('frame',R(480,502,981,809),None),('glass',R(480,502,607,610),'GL-03'),('glass',R(857,502,981,610),'GL-03'),
           ('band',R(609,502,854,610),'Signage')]+cols_rows(xs,[(612,809)],'glass','GL-03')
    grid167(fk,clip,el,face,spec)
def back(el,clip,fk):
    xs=[(1567,1690),(1692,1812),(1814,1933),(1935,2059)]
    spec=[('frame',R(1567,220,2059,499),None),('louver',R(1571,223,2054,353),None)]+cols_rows(xs,[(360,499)],'glass','GL-02')
    spec+=[('frame',R(1567,502,2059,809),None),('glass',R(1567,502,1690,610),'GL-03'),('glass',R(1935,502,2059,610),'GL-03'),
           ('band',R(1692,502,1933,610),'Signage')]+cols_rows(xs,[(612,809)],'glass','GL-03')
    grid167(fk,clip,el,'S',spec)
CORN167={}  # floor -> (left strip x, right strip x)
for el,fx,frontspec in (('533',(420,40,1030,1012),dict(xs=[(478,566),(568,724),(726,879),(881,971)],sl=(478,566),sr=(881,971),cp=(568,696),L=(458,478),Rr=(971,991))),
                        ('534',(1490,40,2100,1012),dict(xs=[(1550,1644),(1646,1795),(1798,1945),(1947,2043)],sl=(1550,1639),sr=(1954,2043),cp=(1824,1952),L=(1530,1550),Rr=(2043,2063)))):
    clip=R(*fx); fk=f"{el}N"
    add_floor(fk,{'en':f'EL-{el} North (front)','zh':f'EL-{el} 北（正面）'},S7,24,clip,'167-A-201')
    front(el,frontspec['xs'],frontspec['sl'],frontspec['sr'],frontspec['cp'],clip,fk); CORN167[fk]=(frontspec['L'],frontspec['Rr'],clip)
    for face,nm in (('E','East (side)'),('W','West (side)')):
        clip=R(420,40,1030,1012); fk=f"{el}{face}"
        add_floor(fk,{'en':f'EL-{el} {nm}','zh':f'EL-{el} {nm}'},S7,25,clip,'167-A-202 (typ.)')
        side(el,face,clip,fk); CORN167[fk]=((460,480),(981,1001),clip)
    clip=R(1500,40,2120,1012); fk=f"{el}S"
    add_floor(fk,{'en':f'EL-{el} South (back)','zh':f'EL-{el} 南（背面）'},S7,25,clip,'167-A-202 (typ.)')
    back(el,clip,fk); CORN167[fk]=((1546,1567),(2059,2079),clip)
    # corners: N face left=NE right=NW; S: left=SW right=SE; E: left=SE right=NE; W: left=NW right=SW
    LR={'N':('NE','NW'),'S':('SW','SE'),'E':('SE','NE'),'W':('NW','SW')}
    cg={}
    for face in 'NSEW':
        fk=f"{el}{face}"; (l,r_,clip)=CORN167[fk]
        cg.setdefault(LR[face][0],[]).append((fk,clip,l)); cg.setdefault(LR[face][1],[]).append((fk,clip,r_))
    y0,y1=220,1000; seg=8*P54; n=math.ceil((y1-y0)/seg-0.05)
    for cn,gs in cg.items():
        for k in range(n):
            a=y0+k*seg; b=min(y1,a+seg)
            piece(f"{el}-{cn}-V{k+1}",'corner',f'EL-{el}',gs[0][0],[(fk,clip,R(x[0],a,x[1],b)) for fk,clip,x in gs],P54,extra={'corner':cn})
# platform level 167 (A-415 EL534 p43, A-416 EL533 p44) — lites from the frame lines
PLAT={'534':(43,R(950,440,1990,1060),'167-A-415',
        [ [(1462,504,1620,771),(1624,504,1783,771),(1786,504,1945,771),(1462,777,1620,982),(1624,777,1783,982),(1786,777,1945,982)],
          [(981,504,1118,771),(981,777,1118,982)] ], (1335,780,1420,985)),
      '533':(44,R(560,440,1600,1060),'167-A-416',
        [ [(601,530,767,774),(769,530,934,774),(936,530,1100,774),(601,779,767,981),(769,779,934,981),(936,779,1100,981)],
          [(1456,530,1581,771),(1456,776,1581,982)] ], (1138,779,1240,985))}
for el,(pg,clip,sheet,groups,gl5) in PLAT.items():
    fk=f"{el}P"; add_floor(fk,{'en':f'EL-{el} Platform','zh':f'EL-{el} 站台'},S7,pg,clip,sheet)
    spec=[]
    for g in groups:
        rs=[R(*t) for t in g]; fr=R(rs[0]); [fr.include_rect(r) for r in rs]
        spec.append(('frame',fr,None)); spec+=[('glass',r,'GL-04') for r in rs]
    spec+=[('frame',R(*gl5),None),('glass',R(gl5[0]+1,gl5[1]+1,gl5[2]-1,gl5[3]-1),'GL-05')]
    grid167(fk,clip,el,'P',spec)
# ---------------- roofs
ROOF_E={'R-KBE-HH':('Control area / head house roof (east)',[(706,328),(1042,328),(1042,580),(706,580)]),
        'R-EL535':('EL-535 roof',[(802,580),(898,580),(898,700),(802,700)]),
        'R-EMR535':('EMR 535 roof',[(784,700),(898,700),(898,928),(784,928)]),
        'R-ST-P9':('Stair P9 canopy roof',[(898,580),(964,580),(964,928),(898,928)]),
        'R-ST-M5S5':('Stair M5 / S5 canopy roof',[(838,928),(900,928),(900,1252),(838,1252)])}
ROOF_W={'R-ST-M6S6':('Stair M6 / S6 canopy roof',[(1048,242),(1126,218),(1254,706),(1174,734)]),
        'R-ST-P10':('Stair P10 canopy roof',[(1132,724),(1192,724),(1192,820),(1132,820)]),
        'R-EL536':('EL-536 roof',[(1198,736),(1294,706),(1324,820),(1228,850)]),
        'R-KBW-CA':('Control area roof (west)',[(1144,772),(1330,832),(1414,1072),(1570,1074),(1570,1186),(1264,1186),(1168,940)])}
def inpoly(x,y,P):
    c=False; n=len(P)
    for i in range(n):
        x1,y1=P[i]; x2,y2=P[(i+1)%n]
        if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
    return c
for fk,nm,pg,clip,RO,sheet in (('KBRE',{'en':'KB Roofs East','zh':'KB 屋面 东'},36,R(550,100,1500,1300),ROOF_E,'KGS-A-151'),('KBRW',{'en':'KB Roofs West','zh':'KB 屋面 西'},35,R(400,60,1720,1300),ROOF_W,'KGS-A-150')):
    add_floor(fk,nm,KB,pg,clip,sheet,dpi=130)
    page=KB[pg-1]; a,used=hatch_area(seglist(page),4.5)
    for rid,(label,poly) in RO.items():
        segsin=[(p,q) for p,q in used if inpoly((p.x+q.x)/2,(p.y+q.y)/2,poly)]
        sf=round(sum(math.hypot(q.x-p.x,q.y-p.y)*4.5 for p,q in segsin)/81)
        panels=max(1,round(len(segsin)/2))
        if rid in('R-EL535','R-EL536'): sf,panels=146,49
        xs=[x for x,y in poly]; ys=[y for x,y in poly]
        u=dict(key=rid,id=rid,type='Standing Seam Roof',kind='roof',zone='KB Roofs',level=fk,status='pending',date='',louver='na',
               sub=label,sf=sf,panelsTotal=panels,geo=[dict(f=fk,poly=normpoly(clip,poly),**norm(clip,R(min(xs),min(ys),max(xs),max(ys))))],
               note=f'{label} · ≈{sf} sf plan · ≈{panels} panels @ 12" (estimate)')
        PIECES.append(u)
for el,pg,rr in (('534',40,R(460,184,837,567)),('533',41,R(442,199,819,582))):
    fk=f"R{el}"; clip=R(rr.x0-120,rr.y0-60,rr.x1+260,rr.y1+60)
    add_floor(fk,{'en':f'EL-{el} Roof','zh':f'EL-{el} 屋面'},S7,pg,clip,'167-A-413' if el=='533' else '167-A-412')
    w=rr.width/36; h=rr.height/36; sf=round(w*h); panels=round(2*(w+h))
    PIECES.append(dict(key=f'R-EL{el}',id=f'R-EL{el}',type='Standing Seam Roof',kind='roof',zone='167 Roofs',level=fk,status='pending',date='',louver='na',
        sub=f'EL-{el} roof',sf=sf,panelsTotal=panels,geo=[dict(f=fk,**norm(clip,rr))],note=f'EL-{el} roof · ≈{sf} sf plan · ≈{panels} panels @ 12" (estimate)'))
# ---------------- key plans
KEYS={'KBKEY':(KB,18,R(450,330,1350,1060),'KGS-A-103',{'en':'Kingsbridge key plan','zh':'Kingsbridge 总平面'},
        [('EL535',R(795,815,865,905)),('EL536',R(860,470,925,560)),('KBR',R(780,905,870,990))]),
      '167KEY':(S7,16,R(300,150,1750,1100),'167-A-111',{'en':'167th St key plan','zh':'167街 总平面'},
        [('EL534',R(1095,415,1195,515)),('EL533',R(1105,770,1205,870))])}
HOT={}
for fk,(doc,pg,clip,sheet,nm,hs) in KEYS.items():
    add_floor(fk,nm,doc,pg,clip,sheet,dpi=110)
    HOT[fk]=[dict(group=g,**norm(clip,r)) for g,r in hs]
json.dump(dict(floors=FLOORS,pieces=PIECES,hot=HOT),open(f'{OUT}/p7data.json','w'),ensure_ascii=False)
import collections
print(len(FLOORS),'floors',len(PIECES),'pieces')
print(collections.Counter(p['kind'] for p in PIECES))
print(collections.Counter(p['zone'] for p in PIECES))
dup=[k for k,v in collections.Counter(p['key'] for p in PIECES).items() if v>1]; print('dups',dup[:20])
