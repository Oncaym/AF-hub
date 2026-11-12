import pymupdf, collections, sys
def segs(page, minw=0.0, maxw=9, clip=None, black=False):
    H=[];V=[]
    for dr in page.get_drawings():
        w=dr.get('width') or 0
        if w<minw or w>maxw: continue
        if black and tuple(round(x,2) for x in (dr.get('color') or ()))!=(0.0,0.0,0.0): continue
        for it in dr['items']:
            pts=[]
            if it[0]=='l': pts=[(it[1],it[2])]
            elif it[0]=='re':
                r=it[1]; a,b,c,d=pymupdf.Point(r.x0,r.y0),pymupdf.Point(r.x1,r.y0),pymupdf.Point(r.x1,r.y1),pymupdf.Point(r.x0,r.y1)
                pts=[(a,b),(b,c),(c,d),(d,a)]
            elif it[0]=='qu':
                q=it[1]; pts=[(q.ul,q.ur),(q.ur,q.lr),(q.lr,q.ll),(q.ll,q.ul)]
            for p1,p2 in pts:
                if abs(p1.y-p2.y)<0.3 and abs(p1.x-p2.x)>3: H.append((min(p1.x,p2.x),max(p1.x,p2.x),(p1.y+p2.y)/2))
                elif abs(p1.x-p2.x)<0.3 and abs(p1.y-p2.y)>3: V.append((min(p1.y,p2.y),max(p1.y,p2.y),(p1.x+p2.x)/2))
    return H,V
def box(H,V,x,y,pad=1.0,tb=None):
    if tb:
        X0,Y0,X1,Y1=tb[0]-12,tb[1]-7,tb[2]+12,tb[3]+7
        H=[h for h in H if not(h[0]>=X0 and h[1]<=X1 and Y0<=h[2]<=Y1)]
        V=[v for v in V if not(v[0]>=Y0 and v[1]<=Y1 and X0<=v[2]<=X1)]
    L=[v[2] for v in V if v[0]<=y<=v[1] and v[2]<x-pad]; R=[v[2] for v in V if v[0]<=y<=v[1] and v[2]>x+pad]
    U=[h[2] for h in H if h[0]<=x<=h[1] and h[2]<y-pad]; D=[h[2] for h in H if h[0]<=x<=h[1] and h[2]>y+pad]
    if not(L and R and U and D): return None
    return (max(L),max(U),min(R),min(D))
def tags(page, pref=("GL-",)):
    out=[]
    for w in page.get_text("words"):
        if any(w[4].startswith(p) for p in pref) and len(w[4])<=5:
            out.append((w[4],(w[0]+w[2])/2,(w[1]+w[3])/2,w[:4]))
    return out

def measure(page, ymax=1100, xr=None, S=18.0, dy=8):
    H,V=segs(page)
    out=[]
    for t,x,y,bb in tags(page):
        if y>ymax or (xr and not(xr[0]<x<xr[1])): continue
        b=box(H,V,x,y-dy,tb=bb)
        if not b: out.append((t,x,y,None,None)); continue
        out.append((t,x,y,(b[2]-b[0])/S*12,(b[3]-b[1])/S*12))
    return out
