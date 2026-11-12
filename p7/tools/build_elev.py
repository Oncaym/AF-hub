import sys, os; sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from elev import *
S=18.0  # pt per ft at 1/4"
def inch(v): return round(v/S*12,1)
def merge_rects(L,tol=4):
    out=[]
    for r in sorted(L,key=lambda r:(r.y0,r.x0)):
        if r.height<2 or r.width<2: continue
        m=[o for o in out if abs(o.x0-r.x0)<tol and abs(o.x1-r.x1)<tol and (abs(o.y0-r.y0)<tol or abs(o.y1-r.y1)<tol)]
        if m: m[0].include_rect(r)
        else: out.append(pymupdf.Rect(r))
    return out
def hcount(H,r):
    return sum(1 for h in H if r.x0+1<h[0]+ (h[1]-h[0])/2 <r.x1-1 and r.y0+1<h[2]<r.y1-1 and (h[1]-h[0])>0.6*r.width)
_DIAG={}
def diag_count(page,r):
    k=id(page)
    if k not in _DIAG:
        L=[]
        for dr in page.get_drawings():
            for it in dr['items']:
                if it[0]=='l':
                    a,b=it[1],it[2]
                    if abs(a.x-b.x)>1 and abs(a.y-b.y)>1: L.append(pymupdf.Point((a.x+b.x)/2,(a.y+b.y)/2))
        _DIAG[k]=L
    return sum(1 for q in _DIAG[k] if r.contains(q))
def build(page, clip, code):
    F=merge_rects(quads(page,clip,1.08)); B=merge_rects(quads(page,clip,1.8))
    H0,V0=blacksegs(page,clip,minlen=30)
    H=[h for h in H0 if abs(h[3]-1.44)>0.05]; V=[v for v in V0 if abs(v[3]-1.44)>0.05]
    def paired(L,s):
        if s[3]>1.0: return True
        return any(t is not s and 0.4<abs(t[2]-s[2])<1.4 and min(s[1],t[1])-max(s[0],t[0])>0.5*(s[1]-s[0]) for t in L)
    Hm=[h for h in H if paired(H,h)]; Vm=[v for v in V if paired(V,v)]
    T=tags(page,clip)
    W=max(r.width for r in B) if B else max(r.width for r in F)
    X0=min(r.x0 for r in B) if B else min(r.x0 for r in F)
    ymaxF=max(r.y1 for r in F)
    bands=[r for r in B if r.width>0.8*W and r.y0<ymaxF+10]
    frames=[]; cps=[]; extra_bands=[]
    for r in F:
        if r.width>0.8*W and inch(r.height)<26 and not any(r.contains(t[1]) for t in T): extra_bands.append(r); continue
        if inch(r.height)>=60 and inch(r.width)<40 and not any(r.contains(t[1]) for t in T): cps.append(r); continue
        frames.append(r)
    allb=[]
    for r in sorted(bands+extra_bands,key=lambda r:r.y0):
        if any((r & o).get_area()>0.6*min(r.get_area(),o.get_area()) for o in allb if r.intersects(o)): continue
        allb.append(r)
    bands=allb
    # louver gap above a full-width frame: extend frame up to band bottom
    for f in frames:
        if f.width<0.8*W: continue
        above=[b for b in bands if b.y1<=f.y0+1]
        if above:
            b=max(above,key=lambda b:b.y1)
            gap=pymupdf.Rect(f.x0,b.y1,f.x1,f.y0)
            blades=set(round(h[2]) for h in H if gap.y0+0.5<h[2]<gap.y1-0.5 and h[0]>=f.x0-2 and h[1]<=f.x1+2)
            if inch(f.y0-b.y1)>4 and len(blades)>=5: f.y0=b.y1
    frames=sorted(frames,key=lambda r:(round(r.y0/20),r.x0))
    pieces=[]
    for i,f in enumerate(frames,1):
        fid=f"{code}-{i}"
        pieces.append(dict(id=fid,kind='frame',r=f))
        # louver blades: clusters of closely spaced horizontals inside the frame
        hin=sorted([h for h in H if f.x0-1<=h[0] and h[1]<=f.x1+1 and f.y0<h[2]<f.y1],key=lambda h:h[2])
        lv=[]; cur=[]
        for h in hin:
            if cur and h[2]-cur[-1][2]<4.5: cur.append(h)
            else:
                if len(set(round(x[2]) for x in cur))>=5: lv.append(cur)
                cur=[h]
        if len(set(round(x[2]) for x in cur))>=5: lv.append(cur)
        lvr=[pymupdf.Rect(min(h[0] for h in c),min(h[2] for h in c),max(h[1] for h in c),max(h[2] for h in c)) for c in lv]
        Hf=[h for h in Hm if not any(r.x0-1<=h[0] and h[1]<=r.x1+1 and r.y0+0.6<h[2]<r.y1-0.6 for r in lvr)]
        # cells via seed grid
        boxes=[]
        y=f.y0+3
        while y<f.y1-2:
            x=f.x0+3
            while x<f.x1-2:
                c=cell([h for h in Hf if f.y0-2<=h[2]<=f.y1+2],[v for v in Vm if f.x0-2<=v[2]<=f.x1+2],x,y)
                if c and c.width>4 and c.height>4 and not any(abs(c.x0-o.x0)<1 and abs(c.y0-o.y0)<1 and abs(c.x1-o.x1)<1 and abs(c.y1-o.y1)<1 for o in boxes):
                    boxes.append(c)
                x+=5
            y+=5
        # drop boxes containing another box (keep finest) – but tags boxes are cut by tag outline: merge tiny
        boxes=[b for b in boxes if inch(b.width)>=6 and inch(b.height)>=6]
        boxes=[b for b in boxes if not any(o is not b and b.contains(o) and o.get_area()<b.get_area()-1 and inch(o.width)>=6 and inch(o.height)>=6 for o in boxes)]
        boxes.sort(key=lambda b:(round(b.y0/8),b.x0))
        # merge an untagged, unhatched cell into the glass cell right above it (canopy drawn in front)
        def tagged(b): return any(b.x0<(t[1].x0+t[1].x1)/2<b.x1 and b.y0<(t[1].y0+t[1].y1)/2<b.y1+12 for t in T)
        merged=True
        while merged:
            merged=False
            for b in boxes:
                if tagged(b): continue
                up=[o for o in boxes if o is not b and abs(o.x0-b.x0)<1.5 and abs(o.x1-b.x1)<1.5 and abs(o.y1-b.y0)<2.5 and tagged(o)]
                if up and diag_count(page,b)<6 and not any(b.intersects(r) for r in lvr):
                    up[0].include_rect(b); boxes.remove(b); merged=True; break
        if not boxes and any(f.contains(t[1]) for t in T):
            boxes=[pymupdf.Rect(f)]
        ng=nl=nm=0
        for b in boxes:
            tg=[t[0] for t in T if b.x0<(t[1].x0+t[1].x1)/2<b.x1 and b.y0<(t[1].y0+t[1].y1)/2<b.y1+12]
            if tg: ng+=1; pieces.append(dict(id=f"{fid}-G{ng}",kind='glass',sub=tg[0],r=b))
            elif any(b.intersects(r) and (b&r).get_area()>0.5*b.get_area() for r in lvr):
                halves=[b] if inch(b.width)<70 else [pymupdf.Rect(b.x0,b.y0,(b.x0+b.x1)/2,b.y1),pymupdf.Rect((b.x0+b.x1)/2,b.y0,b.x1,b.y1)]
                for hb in halves: nl+=1; pieces.append(dict(id=f"{fid}-L{nl}",kind='louver',r=hb))
            else: nm+=1; pieces.append(dict(id=f"{fid}-M{nm}",kind='panel',r=b))
    for j,b in enumerate(bands,1): pieces.append(dict(id=f"{code}-H{j}",kind='band',r=b))
    # column covers: 1.44 verticals pairs left/right of the frames
    VV=[v for v in V0 if abs(v[3]-1.44)<0.05 and v[1]-v[0]>150]
    left=[v for v in VV if v[2]<X0+1]; right=[v for v in VV if v[2]>X0+W-1]
    if left and right:
        lx0=min(v[2] for v in left); lx1=max(v[2] for v in left); rx0=min(v[2] for v in right); rx1=max(v[2] for v in right)
        y0=min(v[0] for v in VV); y1=max(v[1] for v in VV)
        if lx1-lx0>5: pieces.append(dict(id=f"{code}-V1",kind='column',r=pymupdf.Rect(lx0,y0,lx1,y1)))
        if rx1-rx0>5: pieces.append(dict(id=f"{code}-V2",kind='column',r=pymupdf.Rect(rx0,y0,rx1,y1)))
    for j,c in enumerate(sorted(cps,key=lambda r:r.x0),1): pieces.append(dict(id=f"{code}-CP{j}",kind='cp',r=c))
    return pieces, bands, frames
