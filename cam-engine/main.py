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

        # 3. Volumetric Feature Recognition (Boolean Difference)
        features = []
        idx_counter = 0
        
        # 3.1 Create Stock Profile by Fusing 31 Slices
        bounds = solid.BoundingBox()
        z_min, z_max = 0, 0
        if axis_name == "X": z_min, z_max = bounds.xmin, bounds.xmax
        elif axis_name == "Y": z_min, z_max = bounds.ymin, bounds.ymax
        else: z_min, z_max = bounds.zmin, bounds.zmax

        from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
        from OCP.gp import gp_Trsf, gp_Vec
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
        import math

        fused_face = None
        
        for i in range(31):
            val = z_min + (z_max - z_min) * (i + 0.5) / 31.0
            origin = [0, 0, 0]
            if axis_name == "X": origin[0] = val
            elif axis_name == "Y": origin[1] = val
            else: origin[2] = val
            
            wp = cq.Workplane(cq.Plane(origin=tuple(origin), normal=tuple(extrusion_axis)))
            try:
                section = wp.add(solid).section()
                if section.vals():
                    wires = sorted(section.vals(), key=lambda w: w.Length(), reverse=True)
                    f = cq.Face.makeFromWires(wires[0], wires[1:])
                    
                    # Project face to z=0 (or val=0) along extrusion axis
                    trsf = gp_Trsf()
                    vec = [-origin[0], -origin[1], -origin[2]]
                    trsf.SetTranslation(gp_Vec(*vec))
                    moved_f = BRepBuilderAPI_Transform(f.wrapped, trsf, True).Shape()
                    
                    if fused_face is None:
                        fused_face = moved_f
                    else:
                        fused_face = BRepAlgoAPI_Fuse(fused_face, moved_f).Shape()
            except Exception as e:
                pass
                
        if fused_face:
            # 3.2 Create 3D Stock Solid
            base_face = cq.Face(fused_face)
            
            # Move the base face to z_min
            trsf = gp_Trsf()
            vec_min = [extrusion_axis[0]*z_min, extrusion_axis[1]*z_min, extrusion_axis[2]*z_min]
            trsf.SetTranslation(gp_Vec(*vec_min))
            base_face = cq.Face(BRepBuilderAPI_Transform(base_face.wrapped, trsf, True).Shape())
            
            # Extrude the face to full length
            extrude_vec = cq.Vector(extrusion_axis[0]*(z_max-z_min), extrusion_axis[1]*(z_max-z_min), extrusion_axis[2]*(z_max-z_min))
            stock = cq.Solid.extrudeLinear(base_face, extrude_vec)
            
            # 3.3 Boolean Subtraction (Stock - Part = Machining Volumes)
            cut_algo = BRepAlgoAPI_Cut(stock.wrapped, solid.wrapped)
            cut_algo.Build()
            chips_shape = cut_algo.Shape()
            chips = cq.Shape(chips_shape)
            
            # 3.4 Classify Chips
            volumes = chips.Solids() if chips.geomType() == "COMPOUND" else [chips]
            
            for v in volumes:
                if v.Volume() < 1.0: continue # Skip micro-slivers and noise
                
                bbox = v.BoundingBox()
                w_x = round(bbox.xmax - bbox.xmin, 2)
                w_y = round(bbox.ymax - bbox.ymin, 2)
                w_z = round(bbox.zmax - bbox.zmin, 2)
                
                c_pos = [round((bbox.xmin + bbox.xmax)/2, 3), 
                         round((bbox.ymin + bbox.ymax)/2, 3), 
                         round((bbox.zmin + bbox.zmax)/2, 3)]
                         
                faces = v.Faces()
                chip_cyls = [f for f in faces if f.geomType() == "CYLINDER"]
                
                if chip_cyls:
                    # Get axis and radius from the largest cylinder
                    largest_cyl = max(chip_cyls, key=lambda f: f.Area())
                    surf = largest_cyl._geomAdaptor().Cylinder()
                    r = round(surf.Radius(), 3)
                    cyl_axis = surf.Axis().Direction()
                    dir_vec = [cyl_axis.X(), cyl_axis.Y(), cyl_axis.Z()]
                    
                    # Normalize
                    mag = (dir_vec[0]**2 + dir_vec[1]**2 + dir_vec[2]**2)**0.5
                    if mag > 0: dir_vec = [d/mag for d in dir_vec]
                    
                    # Determine Depth based on the cylinder axis
                    if abs(dir_vec[0]) > 0.99: depth = w_x; w = w_y; l = w_z
                    elif abs(dir_vec[1]) > 0.99: depth = w_y; w = w_x; l = w_z
                    else: depth = w_z; w = w_x; l = w_y
                    
                    if len(chip_cyls) == 1:
                        if max(w, l) > r * 2.5: # Open U-Slot (long single cylinder)
                            feat_type = "slot"
                        else:
                            feat_type = "drill"
                    elif len(chip_cyls) == 2: # Regular closed Slot
                        feat_type = "slot"
                    else: # 3 or 4 cylinders -> Pocket
                        feat_type = "pocket"
                        
                    # Fix direction for drills (point towards part)
                    if feat_type == "drill":
                        if c_pos[0] * dir_vec[0] + c_pos[1] * dir_vec[1] + c_pos[2] * dir_vec[2] > 0:
                            dir_vec = [-d for d in dir_vec]
                            
                    features.append({
                        "id": f"{feat_type}_{idx_counter}",
                        "type": feat_type,
                        "radius": r,
                        "width": round(min(w, l), 1) if feat_type != "drill" else r*2,
                        "length": round(max(w, l), 1) if feat_type != "drill" else r*2,
                        "depth": round(depth, 1),
                        "position": c_pos,
                        "vector": dir_vec
                    })
                    idx_counter += 1
                else:
                    # No cylinders -> Sharp pocket or cut
                    if axis_name == "X": depth = w_x; w = w_y; l = w_z; dir_vec = [1,0,0]
                    elif axis_name == "Y": depth = w_y; w = w_x; l = w_z; dir_vec = [0,1,0]
                    else: depth = w_z; w = w_x; l = w_y; dir_vec = [0,0,1]
                    
                    features.append({
                        "id": f"pocket_{idx_counter}",
                        "type": "pocket",
                        "radius": 0,
                        "width": round(min(w, l), 1),
                        "length": round(max(w, l), 1),
                        "depth": round(depth, 1),
                        "position": c_pos,
                        "vector": dir_vec
                    })
                    idx_counter += 1
                    
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
        features.sort(key=lambda f: f['position'][0])

        return {
            "success": True,
            "extrusion_axis": {
                "name": axis_name,
                "vector": extrusion_axis
            },
            "features": features,
            "cross_section_svg": svg_str
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
