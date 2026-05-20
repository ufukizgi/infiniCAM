import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

planes = [f for f in solid.Faces() if f.geomType() == "PLANE"]
print(f"Found {len(planes)} planes.")

if len(planes) > 0:
    p = planes[0]
    # Try normalAt
    try:
        normal = p.normalAt(p.Center())
        print(f"Normal via normalAt: {normal.x}, {normal.y}, {normal.z}")
    except Exception as e:
        print("normalAt failed:", e)

    # Try geomAdaptor
    try:
        # In CQ 2.4, Face has a surface() method returning the underlying Geom_Surface
        # or we can use normalAt()
        pass
    except Exception as e:
        pass
