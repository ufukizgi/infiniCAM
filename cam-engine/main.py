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
        
        # 3.1 Create Stock Profile by finding the most "intact" cross-section
        bounds = solid.BoundingBox()
        prof_w_x = bounds.xmax - bounds.xmin
        prof_w_y = bounds.ymax - bounds.ymin
        prof_w_z = bounds.zmax - bounds.zmin
        
        z_min, z_max = 0, 0
        if axis_name == "X": z_min, z_max = bounds.xmin, bounds.xmax
        elif axis_name == "Y": z_min, z_max = bounds.ymin, bounds.ymax
        else: z_min, z_max = bounds.zmin, bounds.zmax

        from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
        from OCP.gp import gp_Trsf, gp_Vec
        from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
        import math

        best_area = -1
        best_face = None
        best_val = 0
        
        for i in range(31):
            val = z_min + (z_max - z_min) * (i + 0.5) / 31.0
            origin = [0, 0, 0]
            if axis_name == "X": origin[0] = val
            elif axis_name == "Y": origin[1] = val
            else: origin[2] = val
            
            wp = cq.Workplane(cq.Plane(origin=tuple(origin), normal=tuple(extrusion_axis)))
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
                pass
                
        if best_face:
            # 3.2 Create 3D Stock Solid
            # Project face from best_val to z_min
            trsf = gp_Trsf()
            vec_min = [extrusion_axis[0]*(z_min - best_val), 
                       extrusion_axis[1]*(z_min - best_val), 
                       extrusion_axis[2]*(z_min - best_val)]
            trsf.SetTranslation(gp_Vec(*vec_min))
            base_face = cq.Face(BRepBuilderAPI_Transform(best_face.wrapped, trsf, True).Shape())
            
            # Extrude the face to full length
            extrude_vec = cq.Vector(extrusion_axis[0]*(z_max-z_min), extrusion_axis[1]*(z_max-z_min), extrusion_axis[2]*(z_max-z_min))
            stock = cq.Solid.extrudeLinear(base_face, extrude_vec)
            
            # 3.3 Boolean Subtraction (Stock - Part = Machining Volumes)
            cut_algo = BRepAlgoAPI_Cut(stock.wrapped, solid.wrapped)
            cut_algo.Build()
            chips_shape = cut_algo.Shape()
            chips = cq.Shape(chips_shape)
            
            # 3.4 Classify Chips
            raw_volumes = chips.Solids() if chips.geomType() == "COMPOUND" else [chips]
            
            volumes = []
            for rv in raw_volumes:
                # OpenCASCADE often returns disjoint lumps as a single TopoDS_Solid
                # We must split it by outer shells so each pocket is evaluated independently!
                shells = rv.Shells()
                for shell in shells:
                    try:
                        s = cq.Solid.makeSolid(shell)
                        if s.Volume() > 1.0:
                            volumes.append(s)
                    except:
                        pass
                        
            for v in volumes:
                bbox = v.BoundingBox()
                w_x = round(bbox.xmax - bbox.xmin, 2)
                w_y = round(bbox.ymax - bbox.ymin, 2)
                w_z = round(bbox.zmax - bbox.zmin, 2)
                
                bbox_vol = w_x * w_y * w_z
                if bbox_vol > 0 and v.Volume() / bbox_vol < 0.05 and v.Volume() < 500:
                    continue # Skip paper-thin boolean artifacts (skins)
                
                c_pos = [round((bbox.xmin + bbox.xmax)/2, 3), 
                         round((bbox.ymin + bbox.ymax)/2, 3), 
                         round((bbox.zmin + bbox.zmax)/2, 3)]
                
                # 1. First check for angled planar faces (e.g., 45-degree miter cuts)
                angled_areas = {}
                angled_normals = {}
                for face in v.Faces():
                    if face.geomType() == "PLANE":
                        try:
                            n = face.normalAt(None)
                            dot = abs(n.x*extrusion_axis[0] + n.y*extrusion_axis[1] + n.z*extrusion_axis[2])
                            if 0.05 < dot < 0.95:
                                nx, ny, nz = round(abs(n.x), 2), round(abs(n.y), 2), round(abs(n.z), 2)
                                key = (nx, ny, nz)
                                if key not in angled_normals:
                                    angled_normals[key] = [n.x, n.y, n.z]
                                angled_areas[key] = angled_areas.get(key, 0) + face.Area()
                        except:
                            continue
                
                is_angled_cut = False
                cut_normal = None
                max_angled_area = 0
                
                # A true saw cut must span almost the entire profile in at least one cross-section dimension
                is_full_span = False
                if axis_name == "X":
                    if w_y > prof_w_y * 0.85 or w_z > prof_w_z * 0.85: is_full_span = True
                elif axis_name == "Y":
                    if w_x > prof_w_x * 0.85 or w_z > prof_w_z * 0.85: is_full_span = True
                else:
                    if w_x > prof_w_x * 0.85 or w_y > prof_w_y * 0.85: is_full_span = True
                
                # It must also have a significant area
                min_cut_area = max(10.0, best_area * 0.1)
                
                if is_full_span:
                    for key, area in angled_areas.items():
                        if area > min_cut_area and area > max_angled_area:
                            is_angled_cut = True
                            cut_normal = angled_normals[key]
                            max_angled_area = area
                
                if is_angled_cut and cut_normal:
                    features.append({
                        "id": f"cut_{idx_counter}",
                        "type": "cut",
                        "radius": 0,
                        "width": round(w_x, 1),
                        "length": round(w_y, 1),
                        "depth": round(w_z, 1),
                        "area": round(max_angled_area, 1),
                        "position": c_pos,
                        "vector": [round(x, 3) for x in cut_normal],
                        "p1": [round(x, 3) for x in c_pos],
                        "p2": [round(x, 3) for x in c_pos]
                    })
                    idx_counter += 1
                    continue
                
                # 2. Check for cylinders
                faces = v.Faces()
                chip_cyls = [f for f in faces if f.geomType() == "CYLINDER"]
                
                valid_cyls = []
                for cyl in chip_cyls:
                    try:
                        c_ax = cyl._geomAdaptor().Cylinder().Axis().Direction()
                        dot = abs(c_ax.X()*extrusion_axis[0] + c_ax.Y()*extrusion_axis[1] + c_ax.Z()*extrusion_axis[2])
                        # Ignore cylinders parallel to extrusion axis (like the pipe's main curved walls)
                        if dot < 0.95:
                            valid_cyls.append(cyl)
                    except:
                        pass
                
                if valid_cyls:
                    # Get axis and radius from the largest valid cylinder
                    largest_cyl = max(valid_cyls, key=lambda f: f.Area())
                    surf = largest_cyl._geomAdaptor().Cylinder()
                    r = round(surf.Radius(), 3)
                    cyl_axis = surf.Axis().Direction()
                    c_dir = [cyl_axis.X(), cyl_axis.Y(), cyl_axis.Z()]
                    
                    # Normalize
                    mag = (c_dir[0]**2 + c_dir[1]**2 + c_dir[2]**2)**0.5
                    if mag > 0: c_dir = [d/mag for d in c_dir]
                    
                    dir_vec = [round(c_dir[0], 3), round(c_dir[1], 3), round(c_dir[2], 3)]
                    
                    # Ensure direction points inwards
                    if c_pos[0] * dir_vec[0] + c_pos[1] * dir_vec[1] + c_pos[2] * dir_vec[2] > 0:
                        dir_vec = [-d for d in dir_vec]
                        
                    # Determine width and length based on UI hardcoded axes mapping
                    if abs(dir_vec[0]) > 0.99:
                        depth = w_x; l = w_y; w = w_z
                    elif abs(dir_vec[1]) > 0.99:
                        depth = w_y; l = w_x; w = w_z
                    else:
                        depth = w_z; l = w_x; w = w_y
                    
                    min_dim, max_dim = min(w, l), max(w, l)
                    
                    vol_ratio = v.Volume() / bbox_vol if bbox_vol > 0 else 0
                    
                    # Categorize based on dimensions and radius
                    if r > 0:
                        if abs(min_dim - 2*r) < 1.0: # Width matches diameter
                            if abs(max_dim - min_dim) < 1.0: # Length matches width
                                feat_type = "drill"
                            else:
                                feat_type = "slot"
                        else:
                            feat_type = "pocket"
                    else:
                        feat_type = "pocket"
                        
                    is_contour = False
                    if feat_type == "pocket" and vol_ratio < 0.85:
                        is_contour = True
                        
                    # Calculate p1 and p2 for slots
                    p1, p2 = list(c_pos), list(c_pos)
                    w_out, l_out = w, l
                    if feat_type == "slot":
                        travel = (max_dim - min_dim) / 2.0
                        w_out = min_dim
                        l_out = max_dim
                        if max_dim == w_x: p1[0] -= travel; p2[0] += travel
                        elif max_dim == w_y: p1[1] -= travel; p2[1] += travel
                        else: p1[2] -= travel; p2[2] += travel
                        
                    elif feat_type == "drill":
                        w_out = r*2
                        l_out = r*2
                        
                    prefix = "contour" if is_contour else feat_type
                        
                    features.append({
                        "id": f"{prefix}_{idx_counter}",
                        "type": feat_type,
                        "radius": r,
                        "width": round(w_out, 1),
                        "length": round(l_out, 1),
                        "depth": round(depth, 1),
                        "position": c_pos,
                        "vector": dir_vec,
                        "p1": [round(x, 3) for x in p1],
                        "p2": [round(x, 3) for x in p2]
                    })
                    idx_counter += 1
                else:
                    # Fallback for sharp pockets: The tool direction is usually the shortest dimension perpendicular to extrusion
                    dims = [(w_x, "X", [1,0,0]), (w_y, "Y", [0,1,0]), (w_z, "Z", [0,0,1])]
                    valid_dims = []
                    for w_val, ax_name, vec in dims:
                        dot = abs(vec[0]*extrusion_axis[0] + vec[1]*extrusion_axis[1] + vec[2]*extrusion_axis[2])
                        if dot < 0.95:
                            valid_dims.append((w_val, ax_name, vec))
                    
                    if valid_dims:
                        valid_dims.sort(key=lambda x: x[0])
                        depth_val, depth_ax, base_vec = valid_dims[0]
                        if c_pos[0]*base_vec[0] + c_pos[1]*base_vec[1] + c_pos[2]*base_vec[2] > 0:
                            dir_vec = [-x for x in base_vec]
                        else:
                            dir_vec = base_vec
                            
                        if depth_ax == "X":
                            depth = w_x; l = w_y; w = w_z
                        elif depth_ax == "Y":
                            depth = w_y; l = w_x; w = w_z
                        else:
                            depth = w_z; l = w_x; w = w_y
                    else:
                        depth = w_z; l = w_x; w = w_y
                        dir_vec = [0,0,-1]
                    
                    vol_ratio = v.Volume() / bbox_vol if bbox_vol > 0 else 0
                    is_contour = vol_ratio < 0.85
                    
                    prefix = "contour" if is_contour else "pocket"
                    
                    features.append({
                        "id": f"{prefix}_{idx_counter}",
                        "type": "pocket",
                        "radius": 0,
                        "width": round(w, 1),
                        "length": round(l, 1),
                        "depth": round(depth, 1),
                        "area": 0,
                        "position": c_pos,
                        "vector": [round(x, 3) for x in dir_vec],
                        "p1": [round(x, 3) for x in c_pos],
                        "p2": [round(x, 3) for x in c_pos]
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
