import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()
extrusion_axis = (1, 0, 0)

edge_to_faces = {}
for f in solid.Faces():
    for e in f.Edges():
        ekey = e.hashCode()
        if ekey not in edge_to_faces:
            edge_to_faces[ekey] = []
        edge_to_faces[ekey].append(f)

# Find all slot side walls
slot_wall_faces = set()
cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]
for cyl in cylinders:
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
        for e in straight_edges:
            faces = edge_to_faces.get(e.hashCode(), [])
            for f2 in faces:
                if f2 != cyl and f2.geomType() == "PLANE":
                    slot_wall_faces.add(f2.hashCode())

# Now check flat cuts
planes = [f for f in solid.Faces() if f.geomType() == "PLANE"]
print(f"Total planes: {len(planes)}")
for p in planes:
    try:
        normal = p.normalAt(p.Center())
    except:
        continue
    n_vec = [normal.x, normal.y, normal.z]
    dot_product = abs(sum(n_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product > 0.95: # It's a flat cut
        if p.hashCode() in slot_wall_faces:
            print(f"Plane {p.hashCode()} (Area {p.Area():.1f}) is a SLOT WALL. Ignoring.")
        else:
            print(f"Plane {p.hashCode()} (Area {p.Area():.1f}) is a VALID FLAT CUT.")
