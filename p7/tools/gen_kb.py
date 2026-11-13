import sys, json, math
import os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from build_elev import *
R=pymupdf.Rect
S=18.0
def I(v): return round(v/S*12,1)
CLIPS={'E':R(380,100,640,1090),'S':R(860,100,1240,1090),'W':R(1400,100,1720,1090),'N':R(1900,100,2260,1090)}
CORNER={'E':('SE','NE'),'S':('SW','SE'),'W':('NW','SW'),'N':('NE','NW')}
# manual zones: (zone rect) -> list of (suffix, kind, sub, rect).  Auto pieces whose centre falls in a zone are dropped.
OVR={
 '535E':{'zones':[R(436,737,582,1012)],
   'pieces':[('F','frame',None,R(439,737,578,826)),('G','glass','GL-2',R(442,740,486,824)),('G','glass','GL-2',R(487,740,531,824)),('G','glass','GL-2',R(532,740,576,824)),
             ('H','band',None,R(439,827,578,861)),('H','band',None,R(439,861,578,880)),
             ('F','frame',None,R(440,881,462,946)),('G','glass','GL-3',R(442,884,459,944)),
             ('CP','cp',None,R(523,881,563,1010)),
             ('F','frame',None,R(564,881,578,946)),('G','glass','GL-3',R(566,884,575,944))],
   'canopy':R(441,790,577,852),'com':R(439,525,578,710)},
 '535W':{'zones':[R(1478,186,1624,486)],
   'pieces':[('H','band',None,R(1481.1,181.1,1620.2,191.7)),   # top hatched panel (Leo 11-13)
             ('F','frame',None,R(1481,192,1620,277)),('L','louver',None,R(1482,192,1550,218)),('L','louver',None,R(1551,192,1619,218)),
             ('M','panel',None,R(1484,220,1527,276)),('M','panel',None,R(1528,220,1573,276)),('M','panel',None,R(1574,220,1617,276)),
             ('H','band',None,R(1481,278,1620,306)),
             ('F','frame',None,R(1482,306,1619,334)),('G','glass','GL-2',R(1484,309,1617,331)),
             ('H','band',None,R(1481,334,1620,354)),
             ('F','frame',None,R(1482,355,1496,471)),('G','glass','GL-2',R(1484,357,1493,469)),
             ('CP','cp',None,R(1497,355,1536,472)),
             ('F','frame',None,R(1598,355,1619,471)),('G','glass','GL-2',R(1600,357,1617,469))]},
 '536E':{'zones':[R(436,186,582,486)],
   'pieces':[('H','band',None,R(439.4,181.1,578.7,193.1)),     # top hatched panel (Leo 11-13)
             ('F','frame',None,R(439,193,579,277)),('L','louver',None,R(440,194,509,219)),('L','louver',None,R(509,194,578,219)),
             ('M','panel',None,R(442,220,509,276)),('M','panel',None,R(509,220,576,276)),
             ('H','band',None,R(439,278,579,312)),
             ('F','frame',None,R(440,312,578,334)),('G','glass','GL-2',R(442,315,576,331)),
             ('H','band',None,R(439,334,579,354)),
             ('F','frame',None,R(440,355,454,471)),('G','glass','GL-2',R(443,357,452,469)),
             ('CP','cp',None,R(456,355,495,472)),
             ('F','frame',None,R(556,355,578,471)),('G','glass','GL-2',R(559,357,576,469))]},
 '536W':{'zones':[R(1478,729,1624,1012)],
   'pieces':[('H','band',None,R(1481,732,1620,759)),
             ('F','frame',None,R(1484,759,1617,827)),('G','glass','GL-2',R(1487,762,1529,824)),('G','glass','GL-2',R(1530,762,1572,824)),('G','glass','GL-2',R(1572,762,1614,824)),
             ('H','band',None,R(1481,827,1620,861)),('H','band',None,R(1481,861,1620,880)),
             ('F','frame',None,R(1482,881,1503,946)),('G','glass','GL-3',R(1484,884,1501,944)),
             ('CP','cp',None,R(1565,881,1604,1010)),
             ('F','frame',None,R(1606,881,1619,946)),('G','glass','GL-3',R(1608,884,1617,944))],
   'canopy':R(1483,790,1618,852)},
}
def auto(page,clip,code):
    P,B,F=build(page,clip,code)
    return P
def pieces_for(page, el, side):
    code=f"{el}{side}"; clip=CLIPS[side]; ov=OVR.get(code,{})
    P=auto(page,clip,code)
    zones=ov.get('zones',[])
    def inzone(r):
        c=pymupdf.Point((r.x0+r.x1)/2,(r.y0+r.y1)/2); return any(z.contains(c) for z in zones)
    P=[p for p in P if p['kind'] not in('column',) and not inzone(p['r'])]
    # COM: auto frames that are one big untagged panel -> composite
    com=ov.get('com')
    out=[]
    for p in P:
        if p['kind']=='frame':
            kids=[q for q in P if q['id'].startswith(p['id']+'-')]
            if len(kids)==1 and kids[0]['kind']=='panel' and I(p['r'].height)>80:
                com=p['r']; p['drop']=True; kids[0]['drop']=True
    P=[p for p in P if not p.get('drop')]
    # manual pieces
    for suf,kind,sub,r in ov.get('pieces',[]):
        P.append(dict(id=None,kind=kind,sub=sub,r=r,manual=suf))
    # ---- renumber: frames top->bottom, left->right; children by containment
    frames=sorted([p for p in P if p['kind']=='frame'],key=lambda p:(round(p['r'].y0/12),p['r'].x0))
    for i,f in enumerate(frames,1): f['id']=f"{code}-{i}"
    for f in frames:
        kids=[p for p in P if p['kind'] in('glass','louver','panel') and f['r'].contains(pymupdf.Point((p['r'].x0+p['r'].x1)/2,(p['r'].y0+p['r'].y1)/2))]
        kids.sort(key=lambda p:(round(p['r'].y0/6),p['r'].x0))
        n={'glass':0,'louver':0,'panel':0}; pre={'glass':'G','louver':'L','panel':'M'}
        for k in kids:
            n[k['kind']]+=1; k['id']=f"{f['id']}-{pre[k['kind']]}{n[k['kind']]}"; k['frame']=f['id']
    bands=sorted([p for p in P if p['kind']=='band'],key=lambda p:p['r'].y0)
    for j,b in enumerate(bands,1): b['id']=f"{code}-H{j}"
    cps=sorted([p for p in P if p['kind']=='cp'],key=lambda p:p['r'].x0)
    for j,c in enumerate(cps,1): c['id']=f"{code}-CP{j}"
    orphans=[p for p in P if not p.get('id')]
    for o in orphans: print('  ! orphan',code,o['kind'],[round(v) for v in o['r']])
    P=[p for p in P if p.get('id')]
    if com: P.append(dict(id=f"{code}-COM1",kind='com',r=pymupdf.Rect(com)))
    if ov.get('canopy'): P.append(dict(id=f"{code}-GC1",kind='canopy',r=ov['canopy']))
    return P
def corners(page, el, sides_pieces):
    """corner strips: 1.44 vertical pairs left/right of each elevation, limited to the band/frame extent"""
    out={}
    for side,P in sides_pieces.items():
        clip=CLIPS[side]
        H0,V0=blacksegs(page,clip,minlen=30)
        VV=[v for v in V0 if abs(v[3]-1.44)<0.05 and v[1]-v[0]>100]
        fr=[p['r'] for p in P if p['kind'] in('frame','band','com')]
        X0=min(r.x0 for r in fr); X1=max(r.x1 for r in fr); Y0=min(r.y0 for r in fr); Y1=max(r.y1 for r in fr)
        left=[v[2] for v in VV if v[2]<=X0+1.5]; right=[v[2] for v in VV if v[2]>=X1-1.5]
        L=R(min(left),Y0,max(left),Y1) if len(set(round(x) for x in left))>=2 else R(X0-17,Y0,X0,Y1)
        Rr=R(min(right),Y0,max(right),Y1) if len(set(round(x) for x in right))>=2 else R(X1,Y0,X1+17,Y1)
        cl,cr=CORNER[side]
        out.setdefault(cl,[]).append((side,L)); out.setdefault(cr,[]).append((side,Rr))
    res=[]
    for cn,geos in out.items():
        y0=min(g[1].y0 for g in geos); y1=max(g[1].y1 for g in geos)
        seg=8*S  # 8 ft
        n=math.ceil((y1-y0)/seg-0.05)
        for k in range(n):
            a=y0+k*seg; b=min(y1,a+seg)
            res.append(dict(id=f"{el}-{cn}-V{k+1}",kind='corner',corner=cn,
                            geos=[(side,R(r.x0,a,r.x1,b)) for side,r in geos], len_ft=round((b-a)/S,2), width_in=I(geos[0][1].width)))
    return res
if __name__=='__main__':
    d=pymupdf.open(__import__('os').environ.get('P7_KB_PDF','KB.pdf')); ALL={}
    for el,pg in (('535',56),('536',59)):
        page=d[pg-1]; SP={}
        for side in 'ESWN':
            SP[side]=pieces_for(page,el,side)
        C=corners(page,el,SP)
        ALL[el]=(SP,C)
        import collections
        for side in 'ESWN': print(el+side, dict(collections.Counter(p['kind'] for p in SP[side])))
        print(el,'corners',len(C))
