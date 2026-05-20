import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

extrusion_axis = (1, 0, 0) # X axis

cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

print(f"Total cylinders: {len(cylinders)}")

holes = []
slots = []

for idx, cyl in enumerate(cylinders):
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        # Not parallel to extrusion axis
        # Analyze the edges of this face
        edges = cyl.Edges()
        circles = [e for e in edges if e.geomType() == "CIRCLE"]
        arcs = [e for e in edges if e.geomType() == "CIRCLE" and not e.IsClosed()] # Actually, CadQuery edge.IsClosed() might not exist, but we can check if start == end.
        lines = [e for e in edges if e.geomType() == "LINE"]
        
        is_full_circle = False
        if len(circles) >= 2 and len(lines) == 0:
            is_full_circle = True
            
        print(f"Cyl {idx}: r={surf.Radius():.2f}, edges={len(edges)}, circles={len(circles)}, lines={len(lines)}, is_full={is_full_circle}")

        # Let's get exact position from the first circular edge center instead of face center
        if len(circles) > 0:
            circ = circles[0]._geomAdaptor().Circle()
            c_loc = circ.Location()
            pos = (round(c_loc.X(), 3), round(c_loc.Y(), 3), round(c_loc.Z(), 3))
        else:
            c_loc = cyl.Center()
            pos = (round(c_loc.x, 3), round(c_loc.y, 3), round(c_loc.z, 3))
            
        print(f"   Pos: {pos}")
