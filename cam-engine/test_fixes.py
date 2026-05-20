import cadquery as cq
import math

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()
extrusion_axis = (1, 0, 0)

# DEBUG 1: Why are slot walls detected as cut_flat?
print("=== END CUTS DEBUG ===")
planes = [f for f in solid.Faces() if f.geomType() == "PLANE"]
for idx, p in enumerate(planes):
    try:
        normal = p.normalAt(p.Center())
    except:
        continue
    n_vec = [normal.x, normal.y, normal.z]
    dot_product = abs(sum(n_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product > 0.05: # Not a side wall
        cut_type = "cut_flat" if dot_product > 0.95 else "cut_angled"
        area = p.Area()
        print(f"Plane {idx}: {cut_type}, dot={dot_product:.3f}, area={area:.1f}, normal={n_vec}")


# DEBUG 2: Connecting faces to differentiate hole halves vs slot halves
print("\n=== HOLE/SLOT CONNECTIVITY DEBUG ===")
cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

# Map edges to faces to find adjacency
edge_to_faces = {}
for f in solid.Faces():
    for e in f.Edges():
        # using hash code or center to uniquely identify edge
        # center is usually robust
        try:
            c = e.Center()
            ekey = f"{c.x:.3f}_{c.y:.3f}_{c.z:.3f}_{e.Length():.3f}"
            if ekey not in edge_to_faces:
                edge_to_faces[ekey] = []
            edge_to_faces[ekey].append(f)
        except:
            pass

for idx, cyl in enumerate(cylinders):
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        loc = surf.Location()
        r = round(surf.Radius(), 3)
        pos = (round(loc.X(), 3), round(loc.Y(), 3), round(loc.Z(), 3))
        
        # Check what the straight lines are connected to
        straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
        if len(straight_edges) == 0:
            # It's a full hole (360 deg)!
            pass
        else:
            # It's a half cylinder. What is it connected to?
            connected_geom_types = []
            for e in straight_edges:
                try:
                    c = e.Center()
                    ekey = f"{c.x:.3f}_{c.y:.3f}_{c.z:.3f}_{e.Length():.3f}"
                    faces = edge_to_faces.get(ekey, [])
                    for f2 in faces:
                        if f2 != cyl:
                            connected_geom_types.append(f2.geomType())
                except:
                    pass
            
            if idx < 10: # Just print first few holes to see
                print(f"Cyl {idx} (r={r}, pos={pos}): half-cylinder. Straight edges connected to: {connected_geom_types}")

