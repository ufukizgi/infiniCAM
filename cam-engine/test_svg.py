import cadquery as cq

file_path = r"c:\Users\ufuk.izgi\stp2gcode\CPD_EKSTRUZYON_TELEVRE_SOL_AL._1ADET.stp"
part = cq.importers.importStep(file_path)
solid = part.val()

opts = {
    "projectionDir": (1, 0, 0),
    "showAxes": False,
    "showHidden": False,
    "strokeWidth": 1.0,
    "strokeColor": (255, 255, 255)
}

try:
    svg_str = cq.exporters.getSVG(solid, opts=opts)
    print("SVG generated successfully!")
    print(svg_str[:200])
except Exception as e:
    print("Error:", e)
