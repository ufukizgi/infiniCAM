import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

extrusion_axis = (1, 0, 0) # X axis
cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

for idx, cyl in enumerate(cylinders):
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        edges = cyl.Edges()
        types = [e.geomType() for e in edges]
        if idx >= 145:
            print(f"Cyl {idx}: r={surf.Radius():.2f}, edge types: {types}")
