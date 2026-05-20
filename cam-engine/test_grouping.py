import cadquery as cq
import math

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()
extrusion_axis = (1, 0, 0)

cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]

groups = {}
for cyl in cylinders:
    surf = cyl._geomAdaptor().Cylinder()
    axis = surf.Axis().Direction()
    dir_vec = [axis.X(), axis.Y(), axis.Z()]
    dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
    
    if dot_product < 0.99:
        # Get position from Face center (or bounding box center)
        # For slots, cyl.Center() might be slightly offset because of the straight lines.
        # Let's get the center of the cylinder surface itself:
        loc = surf.Location()
        r = round(surf.Radius(), 3)
        
        # Normalize direction
        dx, dy, dz = dir_vec
        if dx < 0 or (dx == 0 and dy < 0) or (dx == 0 and dy == 0 and dz < 0):
            dx, dy, dz = -dx, -dy, -dz
            
        key = f"{r}_{dx:.2f}_{dy:.2f}_{dz:.2f}"
        
        if key not in groups:
            groups[key] = []
            
        # Check if we already have this exact location in the group
        pos = (round(loc.X(), 2), round(loc.Y(), 2), round(loc.Z(), 2))
        groups[key].append(pos)

holes = []
slots = []

for key, positions in groups.items():
    # Remove exact duplicates (two halves of a hole)
    unique_pos = []
    for p in positions:
        if p not in unique_pos:
            unique_pos.append(p)
            
    # If we have 1 unique position, it's a hole!
    # If we have multiple unique positions, we need to pair them into slots!
    # A slot is formed by 2 positions that are close to each other.
    # Actually, a slot could have multiple slots with the same radius/direction!
    # We need to pair them by distance.
    while len(unique_pos) >= 2:
        p1 = unique_pos.pop(0)
        # Find the closest point to p1
        p2 = None
        min_dist = 999999
        for p in unique_pos:
            d = math.dist(p1, p)
            if d < min_dist:
                min_dist = d
                p2 = p
        
        # If they are paired, it's a slot!
        if p2 and min_dist < 100: # Assuming slots aren't 100mm long? Or maybe they are!
            unique_pos.remove(p2)
            slots.append({"radius": float(key.split('_')[0]), "p1": p1, "p2": p2, "length": round(min_dist, 2)})
        else:
            holes.append({"radius": float(key.split('_')[0]), "pos": p1})
            
    # Any remaining is a hole
    for p in unique_pos:
        holes.append({"radius": float(key.split('_')[0]), "pos": p})

print(f"Detected {len(holes)} holes and {len(slots)} slots.")
for s in slots[:5]:
    print(f"Slot: r={s['radius']}, p1={s['p1']}, p2={s['p2']}, len={s['length']}")
