import cadquery as cq

solid = cq.Workplane("XY").box(10, 10, 10).faces(">Z").workplane().circle(3).cutThruAll().val()
face = [f for f in solid.Faces() if f.geomType() == "PLANE" and f.Center().z > 4][0]

def wire_to_svg_path(wire):
    edges = wire.Edges()
    pts = []
    for e in edges:
        for i in range(11):
            pt = e.positionAt(i / 10.0)
            pts.append(f"{pt.x:.2f},{pt.y:.2f}")
    if not pts: return ""
    return "M " + pts[0] + " L " + " ".join(pts[1:]) + " Z"

outer = face.outerWire()
inners = face.innerWires()

path_d = wire_to_svg_path(outer)
for inner in inners:
    path_d += " " + wire_to_svg_path(inner)

svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20">
<path d="{path_d}" fill="white" fill-rule="evenodd" />
</svg>'''
print(svg[:1000])
