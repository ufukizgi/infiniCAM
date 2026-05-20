import cadquery as cq
import time

try:
    file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
    print("Loading STEP...")
    t0 = time.time()
    part = cq.importers.importStep(file_path)
    solid = part.val()
    bb = solid.BoundingBox()
    
    print(f"Loaded in {time.time()-t0:.2f}s. Bounding Box: X({bb.xmin:.1f} to {bb.xmax:.1f})")
    
    # We know the extrusion axis is X [1,0,0]
    # Let's slice the part at 20 different points along X
    num_slices = 20
    step = (bb.xmax - bb.xmin) / (num_slices + 1)
    
    slices_2d = []
    
    t1 = time.time()
    for i in range(1, num_slices + 1):
        x_pos = bb.xmin + i * step
        # Create a workplane at x_pos
        wp = cq.Workplane("YZ").workplane(offset=x_pos)
        # Try to get the cross section
        # split(keepTop=True, keepBottom=True) doesn't give a 2D face easily.
        # CQ has a `section()` method for Workplane
        sec = part.section(height=x_pos)
        # sec contains the edges of the section.
        slices_2d.append(sec)
        
    print(f"Generated {num_slices} sections in {time.time()-t1:.2f}s")
    
except Exception as e:
    import traceback
    traceback.print_exc()
