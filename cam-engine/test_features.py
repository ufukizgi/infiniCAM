import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

# Find all cylindrical faces
cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]
print(f"Found {len(cylinders)} cylindrical faces.")

holes = []
for idx, cyl in enumerate(cylinders):
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    loc = surf.Location()
    radius = surf.Radius()
    
    dir_vec = (round(axis.X(), 3), round(axis.Y(), 3), round(axis.Z(), 3))
    loc_vec = (round(loc.X(), 3), round(loc.Y(), 3), round(loc.Z(), 3))
    
    # The extrusion axis is X [1, 0, 0]
    # If the cylinder axis is parallel to X (dot product is ~1 or ~-1), it's a fillet/extrusion feature.
    # Otherwise, it's a hole drilled into the profile!
    dot_product = abs(dir_vec[0] * 1.0 + dir_vec[1] * 0.0 + dir_vec[2] * 0.0)
    if dot_product > 0.99:
        continue # Skip extrusion fillets
        
    holes.append({
        "radius": round(radius, 2),
        "dir": dir_vec,
        "loc": loc_vec
    })

print(f"Extracted {len(holes)} holes.")
for h in holes[:5]:
    print(h)
