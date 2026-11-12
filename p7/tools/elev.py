import pymupdf, math, collections
pymupdf.TOOLS.mupdf_display_errors(False)
def quads(page, clip, w):
    out=[]
    for dr in page.get_drawings():
        if abs((dr.get('width') or 0)-w)>0.01: continue
        col=tuple(round(x,2) for x in (dr.get('color') or ()))
        if col!=(0.0,0.0,0.0): continue
        for it in dr['items']:
            if it[0] in ('qu','re'):
                r=it[1].rect if it[0]=='qu' else it[1]
                if clip.contains(r): out.append(pymupdf.Rect(r))
    # dedupe
    res=[]
    for r in out:
        if not any(abs(r.x0-o.x0)<1.5 and abs(r.y0-o.y0)<1.5 and abs(r.x1-o.x1)<1.5 and abs(r.y1-o.y1)<1.5 for o in res): res.append(r)
    return res
def blacksegs(page, clip, minlen=12):
    H=[];V=[]
    for dr in page.get_drawings():
        col=tuple(round(x,2) for x in (dr.get('color') or ()))
        if col!=(0.0,0.0,0.0): continue
        w=dr.get('width') or 0
        for it in dr['items']:
            pts=[]
            if it[0]=='l': pts=[(it[1],it[2])]
            elif it[0]=='re':
                r=it[1]; pts=[(r.tl,r.tr),(r.tr,r.br),(r.br,r.bl),(r.bl,r.tl)]
            elif it[0]=='qu':
                q=it[1]; pts=[(q.ul,q.ur),(q.ur,q.lr),(q.lr,q.ll),(q.ll,q.ul)]
            for a,b in pts:
                if not (clip.contains(a) or clip.contains(b)): continue
                if abs(a.y-b.y)<0.3 and abs(a.x-b.x)>=minlen: H.append((min(a.x,b.x),max(a.x,b.x),(a.y+b.y)/2,w))
                elif abs(a.x-b.x)<0.3 and abs(a.y-b.y)>=minlen: V.append((min(a.y,b.y),max(a.y,b.y),(a.x+b.x)/2,w))
    return H,V
def cell(H,V,x,y):
    L=[v[2] for v in V if v[0]-0.5<=y<=v[1]+0.5 and v[2]<x]; R=[v[2] for v in V if v[0]-0.5<=y<=v[1]+0.5 and v[2]>x]
    U=[h[2] for h in H if h[0]-0.5<=x<=h[1]+0.5 and h[2]<y]; D=[h[2] for h in H if h[0]-0.5<=x<=h[1]+0.5 and h[2]>y]
    if not(L and R and U and D): return None
    return pymupdf.Rect(max(L),max(U),min(R),min(D))
def tags(page, clip):
    out=[]
    for w in page.get_text("words", clip=clip):
        if w[4].startswith('GL-') and len(w[4])<=5: out.append((w[4],pymupdf.Rect(w[:4])))
    return out
