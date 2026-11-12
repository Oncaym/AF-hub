import pymupdf, math, collections
def seglist(page, color=(0,0,0), w=0.48, minlen=6, clip=None):
    out=[]
    for dr in page.get_drawings():
        col=tuple(round(x,2) for x in (dr.get('color') or ()))
        if color is not None and col!=color: continue
        if w is not None and abs((dr.get('width') or 0)-w)>0.01: continue
        for it in dr['items']:
            if it[0]!='l': continue
            a,b=it[1],it[2]
            if clip and not (clip.contains(a) and clip.contains(b)): continue
            L=math.hypot(b.x-a.x,b.y-a.y)
            if L>=minlen: out.append((a,b,L))
    return out
def hatch_area(segs, spacing, tol=0.35, angtol=0.6):
    """sum L*spacing for segments that have a parallel neighbour at ~spacing with overlap"""
    g=collections.defaultdict(list)
    for a,b,L in segs:
        th=math.degrees(math.atan2(b.y-a.y,b.x-a.x))%180
        k=round(th/angtol)
        g[k].append((a,b,L,th))
    tot=0; used=[]
    for k,G in g.items():
        th=math.radians(sum(x[3] for x in G)/len(G))
        ux,uy=math.cos(th),math.sin(th); nx,ny=-uy,ux
        P=[]
        for a,b,L,_ in G:
            off=a.x*nx+a.y*ny
            t1=a.x*ux+a.y*uy; t2=b.x*ux+b.y*uy
            P.append((off,min(t1,t2),max(t1,t2),L,a,b))
        P.sort(key=lambda r:r[0])
        for i,s in enumerate(P):
            ok=False
            for j in range(max(0,i-80),min(len(P),i+80)):
                if j==i: continue
                t=P[j]; d=abs(t[0]-s[0])
                if abs(d-spacing)>tol: continue
                ov=min(s[2],t[2])-max(s[1],t[1])
                if ov>0.3*min(s[2]-s[1],t[2]-t[1]): ok=True; break
            if ok: tot+=s[3]*spacing; used.append((s[4],s[5]))
    return tot, used
