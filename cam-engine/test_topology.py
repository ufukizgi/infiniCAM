import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()
extrusion_axis = (1, 0, 0)

# Build an edge-to-face map
edge_to_faces = {}
for f in solid.Faces():
    for e in f.Edges():
        # use hashcode to identify edges
        ekey = e.hashCode()
        if ekey not in edge_to_faces:
            edge_to_faces[ekey] = []
        edge_to_faces[ekey].append(f)

cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

slots = []
holes = []

for idx, cyl in enumerate(cylinders):
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        # Check edges
        straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
        
        is_slot_end = False
        if len(straight_edges) > 0:
            # Check what they are connected to
            for e in straight_edges:
                faces = edge_to_faces.get(e.hashCode(), [])
                # If connected to a PLANE, it's a slot end!
                for f2 in faces:
                    if f2 != cyl and f2.geomType() == "PLANE":
                        is_slot_end = True
                        break
        
        loc = surf.Location()
        pos = (round(loc.X(), 2), round(loc.Y(), 2), round(loc.Z(), 2))
        r = round(surf.Radius(), 2)
        
        if is_slot_end:
            slots.append({"r": r, "pos": pos})
        else:
            holes.append({"r": r, "pos": pos})

print(f"Holes: {len(holes)}")
print(f"Slot ends: {len(slots)}")
