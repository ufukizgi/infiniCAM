import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

for idx, cyl in enumerate(cylinders):
    # Get the bounding box in 2D parametric space (u, v)
    u_min, u_max, v_min, v_max = cyl._geomAdaptor().Cylinder().Surface().Bounds()
    
    # Wait, the underlying surface bounds might be infinite or 0 to 2pi.
    # To get the face's actual trimmed bounds, we need BRepTools
    from OCP.BRepTools import BRepTools
    u_min, u_max, v_min, v_max = cq.Shape.computeBounds(cyl) # this is 3D bounds
    
    # Let's try just getting the area.
    # Area of full cylinder = 2 * pi * r * h
    # Area of half cylinder = pi * r * h
    # This requires knowing h. 
    # Let's use bounding box to find h.
    bb = cyl.BoundingBox()
    
    # Or much simpler: check if it has CIRCLE edges vs LINE edges
    edges = cyl.Edges()
    circles = [e for e in edges if e.geomType() == "CIRCLE"]
    lines = [e for e in edges if e.geomType() == "LINE"]
    
    # A full hole in STEP is either 1 face with 2 circular edges,
    # or 2 faces (each 180 deg) with 2 semi-circular edges and 2 line edges.
    # A slot end is ALSO a 180 deg face with 2 semi-circular edges and 2 line edges.
    # So edge types are NOT enough if the CAD exports holes as two halves.
    
    # Wait! If a hole is exported as two halves, the two halves have the EXACT SAME AXIS LOCATION!
    # If a slot has two ends, the two ends have DIFFERENT AXIS LOCATIONS!
    pass

print("Test complete.")
