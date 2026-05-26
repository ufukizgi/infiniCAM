import cadquery as cq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.gp import gp_Trsf, gp_Vec
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
import math

def debug():
    # Load the user's part
    # Replace this path with the actual path inside the container, or read from args
    import sys
    if len(sys.argv) < 2:
        print("Usage: python debug_boolean.py <path_to_step>")
        return
        
    part_path = sys.argv[1]
    part = cq.importers.importStep(part_path)
    solid = part.val()
    
    # We assume Z is the extrusion axis based on previous logs
    extrusion_axis = [0, 0, 1]
    axis_name = "Z"
    
    bounds = solid.BoundingBox()
    z_min, z_max = bounds.zmin, bounds.zmax
    
    best_area = -1
    best_face = None
    best_val = 0
    
    for i in range(31):
        val = z_min + (z_max - z_min) * (i + 0.5) / 31.0
        wp = cq.Workplane(cq.Plane(origin=(0,0,val), normal=(0,0,1)))
        try:
            section = wp.add(solid).section()
            wires = section.wires().vals()
            if wires:
                wires_sorted = sorted(wires, key=lambda w: w.BoundingBox().DiagonalLength, reverse=True)
                f = cq.Face.makeFromWires(wires_sorted[0], wires_sorted[1:])
                area = f.Area()
                if area > best_area:
                    best_area = area
                    best_face = f
                    best_val = val
        except Exception as e:
            print(f"Slice {i} exception: {e}")
            
    if best_face:
        print(f"Best slice found at Z={best_val} with area {best_area}")
        trsf = gp_Trsf()
        trsf.SetTranslation(gp_Vec(0, 0, z_min - best_val))
        base_face = cq.Face(BRepBuilderAPI_Transform(best_face.wrapped, trsf, True).Shape())
        
        extrude_vec = cq.Vector(0, 0, z_max-z_min)
        stock = cq.Solid.extrudeLinear(base_face, extrude_vec)
        
        # Export stock to step
        cq.exporters.export(cq.Workplane("XY").add(stock), "debug_stock.step")
        print("Exported debug_stock.step")
        
        # Cut
        cut_algo = BRepAlgoAPI_Cut(stock.wrapped, solid.wrapped)
        cut_algo.Build()
        chips = cq.Shape(cut_algo.Shape())
        
        cq.exporters.export(cq.Workplane("XY").add(chips), "debug_chips.step")
        print("Exported debug_chips.step")
        
        # Fuzzy Cut
        cut_algo_f = BRepAlgoAPI_Cut(stock.wrapped, solid.wrapped)
        cut_algo_f.SetFuzzyValue(1e-4)
        cut_algo_f.Build()
        chips_f = cq.Shape(cut_algo_f.Shape())
        
        cq.exporters.export(cq.Workplane("XY").add(chips_f), "debug_chips_fuzzy.step")
        print("Exported debug_chips_fuzzy.step")
        
        volumes = chips.Solids() if chips.geomType() == "COMPOUND" else [chips]
        print(f"Found {len(volumes)} chips with standard cut.")
        
        volumes_f = chips_f.Solids() if chips_f.geomType() == "COMPOUND" else [chips_f]
        print(f"Found {len(volumes_f)} chips with fuzzy cut.")
        
    else:
        print("Failed to find best face")

if __name__ == "__main__":
    debug()
