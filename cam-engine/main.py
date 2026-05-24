from fastapi import FastAPI, HTTPException, Body
from pydantic import BaseModel
import cadquery as cq
import os

app = FastAPI(title="infiniCAM Feature Recognition Engine")

class AnalyzeRequest(BaseModel):
    file_path: str

@app.post("/analyze")
def analyze_step(request: AnalyzeRequest):
    if not os.path.exists(request.file_path):
        raise HTTPException(status_code=404, detail="STEP file not found")

    try:
        # 1. Load the STEP file
        part = cq.importers.importStep(request.file_path)
        solid = part.val()
        
        # 2. Extract linear edges to detect the extrusion axis
        edges = solid.Edges()
        lines = [e for e in edges if e.geomType() == "LINE"]
        
        if not lines:
            return {"error": "No linear edges found. Not a standard extrusion."}
            
        # Group by direction vector (ignoring sign)
        direction_lengths = {}
        straight_edges_info = []
        for line in lines:
            # We need the tangent vector of the line
            start = line.startPoint()
            end = line.endPoint()
            
            # Vector from start to end
            dx = round(end.x - start.x, 3)
            dy = round(end.y - start.y, 3)
            dz = round(end.z - start.z, 3)
            
            # Normalize vector (handling sign so [1,0,0] and [-1,0,0] go to the same bucket)
            length = (dx**2 + dy**2 + dz**2)**0.5
            if length == 0: continue
            
            # Create a uniform key for the direction
            nx = dx / length
            ny = dy / length
            nz = dz / length
            
            # Force positive primary direction for bucket key
            if nx < 0 or (nx == 0 and ny < 0) or (nx == 0 and ny == 0 and nz < 0):
                nx, ny, nz = -nx, -ny, -nz
                
            key = f"{nx:.3f},{ny:.3f},{nz:.3f}"
            direction_lengths[key] = direction_lengths.get(key, 0) + length
            
            straight_edges_info.append({
                "length": round(length, 1),
                "dir": (round(nx, 2), round(ny, 2), round(nz, 2))
            })
            
        # The extrusion axis is the direction with the maximum total length
        extrusion_axis_str = max(direction_lengths.items(), key=lambda x: x[1])[0]
        extrusion_axis = [float(x) for x in extrusion_axis_str.split(',')]
        
        # Determine X, Y, or Z axis mapping for clarity
        axis_name = "Unknown"
        if abs(extrusion_axis[0]) > 0.99: axis_name = "X"
        elif abs(extrusion_axis[1]) > 0.99: axis_name = "Y"
        elif abs(extrusion_axis[2]) > 0.99: axis_name = "Z"

        # 3. Fast Feature Recognition (B-Rep Topology Analysis)
        features = []
        
        # Map edges to faces for topology analysis
        edge_to_faces = {}
        for f in solid.Faces():
            for e in f.Edges():
                try:
                    ekey = e.hashCode()
                except AttributeError:
                    ekey = hash(e)
                if ekey not in edge_to_faces: edge_to_faces[ekey] = []
                edge_to_faces[ekey].append(f)
                
        # 3.1 Detect Drilled Holes and Slots
        cylinders = [f for f in solid.Faces() if f.geomType() == "CYLINDER"]
        cyl_groups = {}
        quarter_cyls = {}
        slot_wall_faces = set()
        
        idx_counter = 0
        import math
        
        for cyl in cylinders:
            surf = cyl._geomAdaptor().Cylinder()
            axis = surf.Axis().Direction()
            dir_vec = [axis.X(), axis.Y(), axis.Z()]
            dot_product = abs(sum(dir_vec[i] * extrusion_axis[i] for i in range(3)))
            
            if dot_product < 0.99:
                loc = surf.Location() # True axis location
                r = round(surf.Radius(), 3)
                
                # Normalize direction
                dx, dy, dz = dir_vec
                mag = (dx**2 + dy**2 + dz**2)**0.5
                if mag == 0: continue
                dx, dy, dz = dx/mag, dy/mag, dz/mag
                if dx < 0 or (dx == 0 and dy < 0) or (dx == 0 and dy == 0 and dz < 0):
                    dx, dy, dz = -dx, -dy, -dz
                    
                # Physical center
                try:
                    pc = cyl.Center()
                except:
                    continue
                
                # Project pc onto the axis passing through loc
                vx, vy, vz = pc.x - loc.X(), pc.y - loc.Y(), pc.z - loc.Z()
                dist = vx*dx + vy*dy + vz*dz
                
                # True physical center along the hole depth
                cx = loc.X() + dx*dist
                cy = loc.Y() + dy*dist
                cz = loc.Z() + dz*dist
                pos = (round(cx, 3), round(cy, 3), round(cz, 3))
                
                # Determine angle span using arc edges
                arc_edges = [e for e in cyl.Edges() if e.geomType() in ["CIRCLE", "ELLIPSE"]]
                if not arc_edges: continue
                
                arc_len = max(e.Length() for e in arc_edges)
                
                is_full = False
                is_half = False
                is_quarter = False
                
                expected_full = 2 * math.pi * r
                expected_half = math.pi * r
                expected_quarter = math.pi * r / 2
                
                # 15% tolerance for full/half, 35% tolerance for quarters to catch trimmed pocket corners
                if abs(arc_len - expected_full) < 0.15 * r:
                    is_full = True
                elif abs(arc_len - expected_half) < 0.15 * r:
                    is_half = True
                    # Mark slot walls
                    straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
                    for e in straight_edges:
                        faces = edge_to_faces.get(e.hashCode() if hasattr(e, 'hashCode') else hash(e), [])
                        for f2 in faces:
                            if f2 != cyl and f2.geomType() == "PLANE":
                                slot_wall_faces.add(f2.hashCode() if hasattr(f2, 'hashCode') else hash(f2))
                elif abs(arc_len - expected_quarter) < 0.35 * r:
                    is_quarter = True
                    # Mark pocket walls
                    straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
                    for e in straight_edges:
                        faces = edge_to_faces.get(e.hashCode() if hasattr(e, 'hashCode') else hash(e), [])
                        for f2 in faces:
                            if f2 != cyl and f2.geomType() == "PLANE":
                                slot_wall_faces.add(f2.hashCode() if hasattr(f2, 'hashCode') else hash(f2))
                else:
                    continue # Partial feature
                    
                # Calculate actual depth from straight edges
                straight_edges_len = [e.Length() for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
                actual_depth = round(max(straight_edges_len), 1) if straight_edges_len else 10.0
                    
                key = f"{r}_{dx:.2f}_{dy:.2f}_{dz:.2f}"
                
                if is_full:
                    # Prevent duplicate full holes
                    if not any(f['type'] == 'drill' and f['position'] == pos for f in features):
                        features.append({
                            "id": f"drill_{idx_counter}",
                            "type": "drill",
                            "radius": r,
                            "depth": actual_depth,
                            "position": pos,
                            "vector": [dx, dy, dz]
                        })
                        idx_counter += 1
                elif is_half:
                    if key not in cyl_groups: cyl_groups[key] = []
                    cyl_groups[key].append((pos, actual_depth, cyl))
                elif is_quarter:
                    if key not in quarter_cyls: quarter_cyls[key] = []
                    quarter_cyls[key].append((pos, actual_depth, cyl))

        # Process slot pairs
        for key, positions_with_depth in cyl_groups.items():
            radius = float(key.split('_')[0])
            dx, dy, dz = [float(x) for x in key.split('_')[1:]]
            
            while len(positions_with_depth) >= 2:
                p1, d1, cyl1 = positions_with_depth.pop(0)
                p2 = None
                d2 = 10.0
                min_dist = 999999
                idx_to_remove = -1
                
                # Find the closest valid match
                for i, (p, d, cyl_other) in enumerate(positions_with_depth):
                    dist = math.dist(p1, p)
                    
                    if dist >= 0.1:
                        pass # Trust the pairing based on proximity for intersected slots
                            
                    if dist < min_dist:
                        min_dist = dist
                        p2 = p
                        d2 = d
                        idx_to_remove = i
                
                if p2:
                    if min_dist < 0.1: # Split drill (two halves on same center)
                        positions_with_depth.pop(idx_to_remove)
                        features.append({
                            "id": f"drill_{idx_counter}",
                            "type": "drill",
                            "radius": radius,
                            "depth": max(d1, d2),
                            "position": p1,
                            "vector": [dx, dy, dz]
                        })
                        idx_counter += 1
                    elif min_dist < 400: # Found a slot
                        positions_with_depth.pop(idx_to_remove)
                        center_pos = [(p1[0]+p2[0])/2, (p1[1]+p2[1])/2, (p1[2]+p2[2])/2]
                        features.append({
                            "id": f"slot_{idx_counter}",
                            "type": "slot",
                            "radius": radius,
                            "width": radius * 2,
                            "length": min_dist + (radius * 2), # Total length
                            "travel": min_dist,
                            "depth": max(d1, d2),
                            "position": [round(c, 3) for c in center_pos],
                            "p1": p1,
                            "p2": p2,
                            "vector": [dx, dy, dz]
                        })
                        idx_counter += 1
                    else:
                        continue
                else:
                    continue

            # Salvage leftover half-cylinders (Open U-Slots) using Face Adjacency
            for p, d, cyl in positions_with_depth:
                straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
                attached_planes = []
                for e in straight_edges:
                    ekey = e.hashCode() if hasattr(e, 'hashCode') else hash(e)
                    faces = edge_to_faces.get(ekey, [])
                    for f2 in faces:
                        if f2 != cyl and f2.geomType() == "PLANE":
                            attached_planes.append(f2)
                
                if len(attached_planes) >= 2:
                    all_vs = []
                    for p_face in attached_planes:
                        all_vs.extend([(v.X(), v.Y(), v.Z()) for v in p_face.Vertices()])
                        
                    c_x = (max(v[0] for v in all_vs) + min(v[0] for v in all_vs)) / 2
                    c_y = (max(v[1] for v in all_vs) + min(v[1] for v in all_vs)) / 2
                    c_z = (max(v[2] for v in all_vs) + min(v[2] for v in all_vs)) / 2
                    center_pos = [round(c_x, 3), round(c_y, 3), round(c_z, 3)]
                    
                    w_x = max(v[0] for v in all_vs) - min(v[0] for v in all_vs)
                    w_y = max(v[1] for v in all_vs) - min(v[1] for v in all_vs)
                    w_z = max(v[2] for v in all_vs) - min(v[2] for v in all_vs)
                    
                    if abs(dx) > 0.99:
                        travel_dist = w_z if abs(w_y - radius*2) < 0.2 else w_y
                    elif abs(dy) > 0.99:
                        travel_dist = w_z if abs(w_x - radius*2) < 0.2 else w_x
                    else: # dz > 0.99
                        travel_dist = w_y if abs(w_x - radius*2) < 0.2 else w_x
                        
                    duplicate = False
                    for f in features:
                        if f["type"] == "slot" and math.dist(f["position"], center_pos) < 0.1:
                            duplicate = True
                            break
                            
                    if not duplicate and travel_dist > 0:
                        features.append({
                            "id": f"slot_{idx_counter}",
                            "type": "slot",
                            "radius": radius,
                            "width": radius * 2,
                            "length": round(travel_dist + (radius * 2), 1),
                            "travel": round(travel_dist, 1),
                            "depth": d,
                            "position": center_pos,
                            "p1": p,
                            "p2": p,
                            "vector": [dx, dy, dz]
                        })
                        idx_counter += 1
                        continue
                        
                features.append({
                    "id": f"drill_{idx_counter}",
                    "type": "drill",
                    "radius": radius,
                    "depth": d,
                    "position": p,
                    "vector": [dx, dy, dz]
                })
                idx_counter += 1

        # Process pocket corners (Face Adjacency Tracking)
        for key, positions_with_depth in quarter_cyls.items():
            radius = float(key.split('_')[0])
            dx, dy, dz = [float(x) for x in key.split('_')[1:]]
            
            for p, d, cyl in positions_with_depth:
                straight_edges = [e for e in cyl.Edges() if e.geomType() in ["LINE", "BSPLINE"]]
                attached_planes = []
                for e in straight_edges:
                    ekey = e.hashCode() if hasattr(e, 'hashCode') else hash(e)
                    faces = edge_to_faces.get(ekey, [])
                    for f2 in faces:
                        if f2 != cyl and f2.geomType() == "PLANE":
                            attached_planes.append(f2)
                            
                if len(attached_planes) >= 2:
                    all_vs = []
                    for p_face in attached_planes:
                        all_vs.extend([(v.X(), v.Y(), v.Z()) for v in p_face.Vertices()])
                        
                    c_x = (max(v[0] for v in all_vs) + min(v[0] for v in all_vs)) / 2
                    c_y = (max(v[1] for v in all_vs) + min(v[1] for v in all_vs)) / 2
                    c_z = (max(v[2] for v in all_vs) + min(v[2] for v in all_vs)) / 2
                    center_pos = [round(c_x, 3), round(c_y, 3), round(c_z, 3)]
                    
                    w_x = max(v[0] for v in all_vs) - min(v[0] for v in all_vs)
                    w_y = max(v[1] for v in all_vs) - min(v[1] for v in all_vs)
                    w_z = max(v[2] for v in all_vs) - min(v[2] for v in all_vs)
                    
                    if abs(dx) > 0.99:
                        l = w_y
                        w = w_z
                    elif abs(dy) > 0.99:
                        l = w_x
                        w = w_z
                    else: # dz > 0.99
                        l = w_x
                        w = w_y
                        
                    duplicate = False
                    for f in features:
                        # Match center position with 0.1 tolerance
                        if f["type"] == "pocket" and math.dist(f["position"], center_pos) < 0.1:
                            duplicate = True
                            break
                            
                    if not duplicate and l > 0 and w > 0:
                        features.append({
                            "id": f"pocket_{idx_counter}",
                            "type": "pocket",
                            "radius": radius,
                            "width": round(min(w, l), 1),
                            "length": round(max(w, l), 1),
                            "depth": d,
                            "position": center_pos,
                            "vector": [dx, dy, dz]
                        })
                        idx_counter += 1
                        continue
                        
                # Fallback to drill if no walls found (e.g. standalone quarter cylinder)
                features.append({
                    "id": f"drill_{idx_counter}",
                    "type": "drill",
                    "radius": radius,
                    "depth": d,
                    "position": p,
                    "vector": [dx, dy, dz]
                })
                idx_counter += 1

        # 3.2 Detect End Cuts (Flat and Angled Saw Cuts)
        planes = [f for f in solid.Faces() if f.geomType() == "PLANE"]
        for idx, p in enumerate(planes):
            pkey = p.hashCode() if hasattr(p, 'hashCode') else hash(p)
            if pkey in slot_wall_faces:
                continue # Ignore slot walls
                
            loc = p.Center()
            # normalAt might fail on some complex trimmed faces, but usually works for planes
            try:
                normal = p.normalAt(loc)
            except:
                continue
                
            n_vec = [normal.x, normal.y, normal.z]
            dot_product = abs(sum(n_vec[i] * extrusion_axis[i] for i in range(3)))
            
            # If normal is perpendicular (dot ~ 0), it's a side wall.
            # If dot > 0.01, it's a cut.
            if dot_product > 0.01:
                feat_type = "cut_angled" if dot_product < 0.99 else "cut_flat"
                area = p.Area()
                if area > 10.0: # Skip micro-chamfers
                    features.append({
                        "id": f"plane_{idx}",
                        "type": feat_type,
                        "area": round(area, 1),
                        "position": [round(loc.x, 2), round(loc.y, 2), round(loc.z, 2)],
                        "vector": [round(n_vec[0], 2), round(n_vec[1], 2), round(n_vec[2], 2)]
                    })

        # Filter duplicate features (not needed since we already unique'd in grouping, but safe for cuts)
        unique_features = []
        seen_locs = set()
        for f in features:
            loc_key = f"{f['type']}_{f['position'][0]:.1f},{f['position'][1]:.1f},{f['position'][2]:.1f}"
            if loc_key not in seen_locs:
                seen_locs.add(loc_key)
                unique_features.append(f)
                
        # 4. Generate SVG Cross Section
        svg_opts = {
            "projectionDir": tuple(extrusion_axis),
            "showAxes": False,
            "showHidden": False,
            "strokeWidth": 1.5,
            "strokeColor": (255, 255, 255)
        }
        
        all_u = []
        all_v = []
        
        def get_2d(pt):
            if axis_name == "X": return pt.y, pt.z
            elif axis_name == "Y": return pt.x, pt.z
            else: return pt.x, pt.y

        from OCP.BRepTools import BRepTools_WireExplorer
        from OCP.TopAbs import TopAbs_REVERSED

        def wire_to_svg_path(wire):
            pts = []
            explorer = BRepTools_WireExplorer(wire.wrapped)
            while explorer.More():
                e = cq.Edge(explorer.Current())
                ori = e.wrapped.Orientation()
                
                num_samples = 2 if e.geomType() == "LINE" else 41
                if ori == TopAbs_REVERSED:
                    samples = [1.0 - (i / (num_samples - 1)) for i in range(num_samples)]
                else:
                    samples = [i / (num_samples - 1) for i in range(num_samples)]
                    
                for t in samples:
                    pt = e.positionAt(t)
                    u, v = get_2d(pt)
                    all_u.append(u)
                    all_v.append(v)
                    pts.append(f"{u:.2f},{-v:.2f}")
                    
                explorer.Next()
                
            if not pts: return ""
            return "M " + pts[0] + " L " + " ".join(pts[1:]) + " Z"
            
        # Find unmachined cross section by taking 31 slices and picking the max area
        bounds = solid.BoundingBox()
        z_min = 0; z_max = 0
        if axis_name == "X":
            z_min, z_max = bounds.xmin, bounds.xmax
        elif axis_name == "Y":
            z_min, z_max = bounds.ymin, bounds.ymax
        else:
            z_min, z_max = bounds.zmin, bounds.zmax

        best_area = -1
        best_wires = []
        
        # 31 slices guarantees we find an untouched cross section if one exists
        for i in range(31):
            val = z_min + (z_max - z_min) * (i + 0.5) / 31.0
            origin = [0, 0, 0]
            if axis_name == "X": origin[0] = val
            elif axis_name == "Y": origin[1] = val
            else: origin[2] = val
            
            wp = cq.Workplane(cq.Plane(origin=tuple(origin), normal=tuple(extrusion_axis)))
            try:
                section_wp = wp.add(solid).section()
                wires = section_wp.wires().vals()
                if not wires: continue
                
                wires_sorted = sorted(wires, key=lambda w: w.BoundingBox().DiagonalLength, reverse=True)
                try:
                    face = cq.Face.makeFromWires(wires_sorted[0], wires_sorted[1:])
                    area = face.Area()
                except:
                    area = wires_sorted[0].BoundingBox().DiagonalLength
                    
                if area > best_area:
                    best_area = area
                    best_wires = wires
            except: pass
            
        wires = best_wires
            
        if wires:
            path_d = ""
            for w in wires:
                path_d += " " + wire_to_svg_path(w)
                
            if all_u and all_v:
                min_u, max_u = min(all_u), max(all_u)
                min_v, max_v = min(all_v), max(all_v)
                
                w = max_u - min_u
                h = max_v - min_v
                
                pad_w, pad_h = w * 0.1, h * 0.1
                w += pad_w * 2
                h += pad_h * 2
                
                vb_x = min_u - pad_w
                vb_y = -max_v - pad_h
                
                svg_str = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb_x:.2f} {vb_y:.2f} {w:.2f} {h:.2f}"><path d="{path_d}" fill="#ffffff" fill-rule="evenodd" /></svg>'
            else:
                svg_str = cq.exporters.getSVG(solid, opts=svg_opts)
        else:
            svg_str = cq.exporters.getSVG(solid, opts=svg_opts)
                
        # Sort features by X coordinate ascending
        unique_features.sort(key=lambda f: f['position'][0])

        return {
            "success": True,
            "extrusion_axis": {
                "name": axis_name,
                "vector": extrusion_axis
            },
            "features": unique_features,
            "cross_section_svg": svg_str
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
