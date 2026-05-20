import cadquery as cq
import sys

try:
    file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
    part = cq.importers.importStep(file_path)
    
    # Check if .val() gives the solid
    solid = part.val()
    edges = solid.Edges()
    lines = [e for e in edges if e.geomType() == "LINE"]
    
    print(f"Success! Found {len(lines)} linear edges out of {len(edges)} total edges.")
except Exception as e:
    print(f"Error: {e}")
