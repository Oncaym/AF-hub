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
      'com':'Composite Panel','canopy':'Glass Canopy','corner':'Corner Panel','angle':'Steel Corner Angle','roof':'Standing Seam Roof',
      'porc':'Porcelain Enamel Panel'}
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
def angle_extra(cn,ln_ft,h_in):
    """steel corner angle: counted by length (lf), not area"""
    return {'corner':cn,'lf':round(ln_ft,2),'sf':0,'note':f'Steel corner angle · {h_in}" long · {round(ln_ft,2)} lf'}
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
        if c['kind']=='angle':
            piece(c['id'],'angle',f'EL-{el}',geos[0][0],geos,18.0,extra=angle_extra(c['corner'],c['len_ft'],round(c['len_ft']*12,1)))
        else:
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
    # corner panel from the roof fascia (220) down to the stone base (811); below it, to grade
    # (1000), is a steel corner angle — 167-A-201/202 draw the strip lines 220-811 and 811-1000
    # separately (Leo 11-13: the 8' V2 used to run through the stone)
    y0,y1,yg=220,811,1000; seg=8*P54; n=math.ceil((y1-y0)/seg-0.05)
    for cn,gs in cg.items():
        for k in range(n):
            a=y0+k*seg; b=min(y1,a+seg)
            piece(f"{el}-{cn}-V{k+1}",'corner',f'EL-{el}',gs[0][0],[(fk,clip,R(x[0],a,x[1],b)) for fk,clip,x in gs],P54,extra={'corner':cn})
        ln=(yg-y1)/P54
        piece(f"{el}-{cn}-SA",'angle',f'EL-{el}',gs[0][0],[(fk,clip,R(x[0],y1,x[1],yg)) for fk,clip,x in gs],P54,extra=angle_extra(cn,ln,round(ln*12,1)))
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
def roof_shapes(clip,RO,used,fixed=(),s=2.0,reach=45):
    """Outline each roof from the standing-seam hatch it owns (Leo 11-13: hand boxes left gaps).
    Hatch lines are painted solid, gaps closed, and every painted pixel goes to the nearest
    seed polygon (RO) within `reach` pt. Elevator roofs (`fixed`) keep their seed box and
    are carved out of the others. Returns {rid: [poly pts in pt]}, {rid: [segments]}."""
    import numpy as np, cv2
    W=int(clip.width*s)+2; H=int(clip.height*s)+2
    P=lambda pt:(int(round((pt[0]-clip.x0)*s)),int(round((pt[1]-clip.y0)*s)))
    mask=np.zeros((H,W),np.uint8)
    for p,q in used: cv2.line(mask,P((p.x,p.y)),P((q.x,q.y)),255,thickness=int(4.5*s)+2)
    k=cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(int(7*s)|1,int(7*s)|1))
    mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,k)
    ids=list(RO); seedm={}
    for rid in ids:
        m=np.zeros((H,W),np.uint8); cv2.fillPoly(m,[np.array([P(v) for v in RO[rid][1]],np.int32)],255); seedm[rid]=m
    fixed=[r for r in fixed if r in RO]
    for rid in fixed: mask[seedm[rid]>0]=0
    free=[r for r in ids if r not in fixed]
    D=np.stack([cv2.distanceTransform(255-seedm[r],cv2.DIST_L2,5) for r in free])
    lab=D.argmin(0); dmin=D.min(0)
    ok=(mask>0)&(dmin<reach*s)
    shapes={}; segs_of={r:[] for r in ids}
    for rid in fixed:
        if rid in RO: shapes[rid]=[RO[rid][1]]
    for i,rid in enumerate(free):
        m=((lab==i)&ok).astype(np.uint8)*255
        m=cv2.morphologyEx(m,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
        cs,_=cv2.findContours(m,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        cs=sorted([c for c in cs if cv2.contourArea(c)>150*s*s],key=cv2.contourArea,reverse=True)
        out=[]
        for c in cs:
            ap=cv2.approxPolyDP(c,1.2*s,True).reshape(-1,2)
            out.append([(round(x/s+clip.x0,1),round(y/s+clip.y0,1)) for x,y in ap])
        shapes[rid]=out or [RO[rid][1]]
    for p,q in used:
        x,y=P(((p.x+q.x)/2,(p.y+q.y)/2))
        if not(0<=x<W and 0<=y<H): continue
        hit=[r for r in fixed if r in seedm and seedm[r][y,x]]
        if hit: segs_of[hit[0]].append((p,q)); continue
        if dmin[y,x]<reach*s: segs_of[free[lab[y,x]]].append((p,q))
    return shapes,segs_of
for fk,nm,pg,clip,RO,sheet in (('KBRE',{'en':'KB Roofs East','zh':'KB 屋面 东'},36,R(550,100,1500,1300),ROOF_E,'KGS-A-151'),('KBRW',{'en':'KB Roofs West','zh':'KB 屋面 西'},35,R(400,60,1720,1300),ROOF_W,'KGS-A-150')):
    add_floor(fk,nm,KB,pg,clip,sheet,dpi=130)
    page=KB[pg-1]; a,used=hatch_area(seglist(page),4.5)
    shapes,segs_of=roof_shapes(clip,RO,used,fixed=('R-EL535','R-EL536'))
    for rid,(label,poly) in RO.items():
        segsin=segs_of[rid]
        sf=round(sum(math.hypot(q.x-p.x,q.y-p.y)*4.5 for p,q in segsin)/81)
        panels=max(1,round(len(segsin)/2))
        if rid in('R-EL535','R-EL536'): sf,panels=146,49
        geo=[]
        for P in shapes[rid]:
            xs=[x for x,y in P]; ys=[y for x,y in P]
            geo.append(dict(f=fk,poly=normpoly(clip,P),**norm(clip,R(min(xs),min(ys),max(xs),max(ys)))))
        u=dict(key=rid,id=rid,type='Standing Seam Roof',kind='roof',zone='KB Roofs',level=fk,status='pending',date='',louver='na',
               sub=label,sf=sf,panelsTotal=panels,geo=geo,
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
        [('EL535',R(795,815,865,905)),('EL536',R(860,470,925,560)),
         ('KBR',R(780,905,870,990),'KBRE'),('KBR',R(830,380,890,468),'KBRW')]),
      '167KEY':(S7,16,R(300,150,1750,1100),'167-A-111',{'en':'167th St key plan','zh':'167街 总平面'},
        [('EL534',R(1095,415,1195,515)),('EL533',R(1105,770,1205,870))])}
HOT={}
for fk,(doc,pg,clip,sheet,nm,hs) in KEYS.items():
    add_floor(fk,nm,doc,pg,clip,sheet,dpi=110)
    # (group, rect[, floor]) — a floor sends the hot spot straight to that sheet (roofs E / W)
    HOT[fk]=[dict(group=h[0],**norm(clip,h[1]),**({'floor':h[2]} if len(h)>2 else {})) for h in hs]
# ---------------- KB plans, coloured by scope like the proposal's "Overall Item View" (Leo 11-13/11-17)
# Colour only — no pieces, no numbers; status is still kept on the elevations. Everything is a band
# along the wall (a plan only has material where the wall is), like the proposal pp. 6-7.
#   enc = elevator hoistway enclosure (closed band)     mp = EMR exterior metal panel (KGS-A-601/602)
#   ws  = windscreen with porcelain enamel panels on BOTH control-area long walls (A-402 / A-404 note 9)
#         + porcelain enamel wall panels around the control-area rooms (A-402 note 13, A-404 note 14)
# Points are PDF pt on the Final-2 sheets (1/8" = 1'-0"), on the wall centre lines (vectors, re-snapped 11-19).
# (k, pts[, 'closed' | 'open']) — ws is an open line unless marked closed; enc / mp are closed unless marked open.
PLANS={
 'P134':(28,R(1150,620,1600,1150),'KGS-A-134',{'en':'EL-536 Mezzanine plan (A-134)','zh':'EL-536 夹层平面 (A-134)'},
        [('enc',[(1263.8,786.3),(1354.4,761.3),(1393.8,871.9),(1300.0,901.3)]),
         ('mp', [(1298.8,903.1),(1393.8,873.8),(1445.6,1025.0),(1351.3,1055.0)])]),
 'P139':(33,R(1150,650,1700,1300),'KGS-A-139',{'en':'EL-536 Control Area R290B plan (A-139)','zh':'EL-536 控制区 R290B 平面 (A-139)'},
        [('enc',[(1206.7,748.7),(1291.3,726.7),(1318.0,822.0),(1235.3,848.7)]),
         ('ws', [(1168.1,869.4),(1263.4,1162.7)]),                     # long wall = A-402 elev. 1 'South' (34'-2½")
         ('ws', [(1323.4,818.0),(1408.1,1078.0)]),                     # long wall = A-402 elev. 3 'North' (30'-10½")
         # new pieces tying into the existing windscreen at the edge (black on A-139, grey = existing);
         # the proposal colours them too, and everything in the proposal is current scope (Leo 11-17)
         ('ws', [(1232.2,1189.0),(1272.0,1189.0)]),
         ('ws', [(1561.8,1189.0),(1601.6,1189.0)]),
         # Cleaner's 025 north + east = wall type 1A, 18 ga metal panel on girts (A-410, A-603) (Leo 11-19)
         ('mp', [(1494.0,1086.5),(1565.0,1086.5),(1565.0,1164.5)],'open'),
         # EPR 024 north wall = exterior metal panel, not porcelain: interior porcelain enamel panel
         # only where the control area faces the platform (Leo 11-24)
         ('mp', [(1425.0,1086.5),(1494.0,1086.5)],'open')]),
 'P135':(29,R(650,430,1050,950),'KGS-A-135',{'en':'EL-535 Mezzanine plan (A-135)','zh':'EL-535 夹层平面 (A-135)'},
        [('enc',[(811.0,611.0),(907.5,611.0),(907.5,720.6),(811.0,720.6)]),
         ('mp', [(795.0,724.0),(906.0,724.0),(906.0,875.0),(795.0,875.0)])]),
 'P140':(34,R(650,200,1250,750),'KGS-A-140',{'en':'EL-535 Control Area R290A plan (A-140)','zh':'EL-535 控制区 R290A 平面 (A-140)'},
        [('enc',[(803.6,591.4),(896.4,591.4),(896.4,697.9),(803.6,697.9)]),
         ('ws', [(789.0,443.0),(789.0,592.0)]),                         # west long wall
         ('ws', [(959.5,443.0),(959.5,592.0)]),                         # east long wall
         # wall type 1 / 1A = metal panel on girts (A-408, A-409): Cleaner's 021 west + south,
         # Refuse 023 / EPR 022 east, EPR 022 south (Leo 11-19)
         ('mp', [(715.0,335.0),(715.0,440.5),(791.0,440.5)],'open'),
         ('mp', [(1034.5,335.0),(1034.5,440.5),(958.0,440.5)],'open')]),
}
PLAN={}
for fk,(pg,clip,sheet,nm,shapes) in PLANS.items():
    add_floor(fk,nm,KB,pg,clip,sheet,dpi=150)
    PLAN[fk]=[dict(k=s[0],pts=normpoly(clip,s[1]),open=(s[0]=='ws' and len(s)<3) or (len(s)>2 and s[2]=='open')) for s in shapes]
# ---------------- Interior porcelain enamel wall panels (09 78 10) + station louvers LV-x (Leo 11-19)
# Porcelain = walls tagged wall type 2 / 2A on the enlarged room plans KGS-A-407..410 (A-603: porcelain
# enamel wall panel system on one side). Lengths are the outer face on those 1/2" plans (door openings
# left out); heights 7'-6" at 290B (dimension next to note 13 on A-402) and 9'-6" at 290A (A-404,
# windscreen height; the room wall has no own dimension). Drawn as bands on the A-139 / A-140 key plans.
PORC=[ # id, zone, floor, (p0, p1) on the key plan, length ft, height ft, where
 ('EPR 024 N',      'EL-536','P139',((1425.0,1086.5),(1494.0,1086.5)), 8.25,7.5,'A-407 (wall type 2)'),
 ('EPR 024 W',      'EL-536','P139',((1425.0,1086.5),(1450.4,1164.5)), 9.8, 7.5,'A-407 (wall type 2, slanted)'),
 ('EPR 024 S',      'EL-536','P139',((1459.0,1164.5),(1494.0,1164.5)), 4.03,7.5,'A-407 (wall type 2, door left out)'),
 ("Cleaner's 025 S",'EL-536','P139',((1525.0,1164.5),(1565.0,1164.5)), 4.64,7.5,'A-410 (wall type 2A, door left out)'),
 ("Cleaner's 021 N",'EL-535','P140',((715.0,335.0),(791.0,335.0)),     8.83,9.5,'A-409 (wall type 2A)'),
 ("Cleaner's 021 E",'EL-535','P140',((791.0,335.0),(791.0,402.0)),     8.67,9.5,'A-409 (wall type 2A, door left out)'),
 ('Refuse 023 N',   'EL-535','P140',((958.0,335.0),(1034.5,335.0)),   8.94,9.5,'A-408 (wall type 2A)'),
 ('Refuse 023 W',   'EL-535','P140',((958.0,335.0),(958.0,387.0)),    5.72,9.5,'A-408 (wall type 2A)'),
 ('EPR 022 W',      'EL-535','P140',((958.0,387.0),(958.0,402.0)),    1.64,9.5,'A-408 (wall type 2, above door D06)'),
]
FLOOR_CLIP={k:(v[1]) for k,v in PLANS.items()}
def band_poly(p0,p1,half=3.0):
    (x0,y0),(x1,y1)=p0,p1; L=math.hypot(x1-x0,y1-y0); nx,ny=-(y1-y0)/L*half,(x1-x0)/L*half
    return [(x0+nx,y0+ny),(x1+nx,y1+ny),(x1-nx,y1-ny),(x0-nx,y0-ny)]
PORC_DROP={'EPR 024 N'}   # Leo 11-24: metal panel, not porcelain. Kept in PORC so PE-xx keys don't shift.
for i,(pid,zone,fk,(p0,p1),ln,ht,src) in enumerate(PORC,1):
    if pid in PORC_DROP: continue
    clip=FLOOR_CLIP[fk]; P=band_poly(p0,p1); xs=[x for x,y in P]; ys=[y for x,y in P]
    sf=round(ln*ht,1)
    PIECES.append(dict(key=f'PE-{i:02d}',id=pid,type=TYPE['porc'],kind='porc',zone=zone,level=fk,status='pending',date='',louver='na',
        sub='',w=round(ln*12,1),h=round(ht*12,1),sf=sf,
        geo=[dict(f=fk,poly=normpoly(clip,P),**norm(clip,R(min(xs),min(ys),max(xs),max(ys))))],
        note=f"Porcelain enamel wall panel · {ln}' x {ht}' · {sf} sf · {src}"))
# Station louvers from the KGS-A-604 schedule, placed from the LV tags on the RCPs of A-405..A-410
LVSIZE={1:(36,24),2:(36,24),3:(54,26),4:(30,48),5:(60,24),6:(16,12),7:(16,12),8:(16,12),9:(16,12),
        10:(16,12),11:(16,12),12:(16,12),13:(16,12),14:(16,12),15:(18,18),16:(18,18)}
LVROOM={1:'EMR 536',2:'EMR 536',3:'EMR 536',4:'EMR 535',5:'EMR 535',6:'EPR 024',7:'EPR 024',8:"Cleaner's 025",
        9:"Cleaner's 025",10:"Cleaner's 021",11:"Cleaner's 021",12:'Refuse 023',13:'EPR 022',14:'EPR 022'}
LVS=[ # key, LV#, zone, floor, (x, y) on the key plan, wall, source
 ('LV-01W',1,'EL-536','P134',(1309.3,933.5),'west','A-405 RCP'),
 ('LV-01E',1,'EL-536','P134',(1407.3,913.1),'east','A-405 RCP'),
 ('LV-03', 3,'EL-536','P134',(1385.2,1044.2),'south','A-405 RCP'),
 ('LV-05', 5,'EL-535','P135',(795.0,750.0),'west','A-406 RCP'),
 ('LV-04', 4,'EL-535','P135',(795.0,857.0),'west','A-406 RCP'),
 ('LV-07', 7,'EL-536','P139',(1432.0,1086.5),'north','A-407 RCP'),
 ('LV-06', 6,'EL-536','P139',(1470.0,1164.5),'south','A-407 RCP'),
 ('LV-09', 9,'EL-536','P139',(1510.0,1086.5),'north','A-410 RCP'),
 ('LV-08', 8,'EL-536','P139',(1565.0,1150.0),'east','A-410 RCP'),
 ('LV-10',10,'EL-535','P140',(715.0,350.0),'west','A-409 RCP'),
 ('LV-11',11,'EL-535','P140',(715.0,430.0),'west','A-409 RCP'),
 ('LV-12',12,'EL-535','P140',(1034.5,341.0),'east','A-408 RCP'),
 ('LV-13',13,'EL-535','P140',(1034.5,393.0),'east','A-408 RCP'),
 ('LV-14',14,'EL-535','P140',(1034.5,411.0),'east','A-408 RCP'),
]
for key,n,zone,fk,(x,y),wall,src in LVS:
    clip=FLOOR_CLIP[fk]; w_in,h_in=LVSIZE[n]; sf=round(w_in*h_in/144,1); hs=6.0
    PIECES.append(dict(key=f'KB-{key}',id=f'LV-{n}',type='Louver',kind='louver',zone=zone,level=fk,status='pending',date='',louver='na',
        sub='',w=w_in,h=h_in,sf=sf,geo=[dict(f=fk,**norm(clip,R(x-hs,y-hs,x+hs,y+hs)))],
        note=f'LV-{n} · {LVROOM[n]} {wall} wall · {w_in}" x {h_in}" · {sf} sf · KGS-A-604, {src}'))
# Control-area windscreen sf, both long walls: length x 9'-6" (gross; height dimensioned on A-402 elev. 3
# and A-404 elev. 4). 290B lengths are dimensioned; 290A has no dimension, so grid 23-26 is scaled
# off A-404 (1/4" = 1'-0", 18 pt/ft). Room porcelain walls are pieces (PORC above).
WSA={'P139':dict(src='KGS-A-402',rows=[
        dict(en='South wall',zh='南墙',w_ft=round(3+4/12+3*(10+3.5/12),2),h_ft=9.5,ref="KGS-A-402 elev. 1 · 3'-4\" + 3 × 10'-3½\""),
        dict(en='North wall',zh='北墙',w_ft=round(3*(10+3.5/12),2),h_ft=9.5,ref="KGS-A-402 elev. 3 · 3 × 10'-3½\""),
        dict(en='2 tie-ins to existing',zh='接现有 2 段',w_ft=round((1272.0-1232.2+1601.6-1561.8)/9,2),h_ft=9.5,ref="KGS-A-139 scaled 1/8\" · height assumed 9'-6\"")]),
     'P140':dict(src='KGS-A-404',rows=[
        dict(en='North wall',zh='北墙',w_ft=round((1422.3-1142.6)/18,2),h_ft=9.5,ref='KGS-A-404 elev. 2 · grid 23–26, scaled'),
        dict(en='South wall',zh='南墙',w_ft=round((589.7-309.9)/18,2),h_ft=9.5,ref='KGS-A-404 elev. 4 · grid 26–23, scaled')])}
for v in WSA.values():
    for r in v['rows']: r['sf']=round(r['w_ft']*r['h_ft'],1)
    v['sf']=round(sum(r['sf'] for r in v['rows']),1)
json.dump(dict(floors=FLOORS,pieces=PIECES,hot=HOT,plans=PLAN,ws=WSA),open(f'{OUT}/p7data.json','w'),ensure_ascii=False)
import collections
print(len(FLOORS),'floors',len(PIECES),'pieces')
print(collections.Counter(p['kind'] for p in PIECES))
print(collections.Counter(p['zone'] for p in PIECES))
dup=[k for k,v in collections.Counter(p['key'] for p in PIECES).items() if v>1]; print('dups',dup[:20])
