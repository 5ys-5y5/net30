"""CadQuery/OpenCascade compiler for the restricted NET30 container DSL.

This worker deliberately accepts JSON only; it never evaluates LLM-generated Python.
"""
import json, pathlib, sys

try:
    import cadquery as cq
except ImportError as error:
    raise SystemExit("CadQuery is not installed; visual GLB can be produced but STEP requires CadQuery/OpenCascade.") from error

def main():
    request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    component, contract, output = request["component"], request["contract"], pathlib.Path(request["output"])
    d = contract["dimensionsMm"]; radius = max(d["widthMm"], d["depthMm"]) / 2
    if component["component"] == "bottle":
        # Separate outer/inner solids: this is a manufacturable B-Rep wall, not a Blender modifier.
        points = [(point["radiusRatio"] * radius, point["zRatio"] * d["heightMm"]) for point in component["profile"]]
        outer = cq.Workplane("XZ").moveTo(*points[0]).spline(points[1:]).lineTo(0, d["heightMm"]).lineTo(0, 0).close().revolve(360, (0, 0, 0), (0, 1, 0))
        inner = cq.Workplane("XY").workplane(offset=d["wallMm"]).circle(max(.2, radius - d["wallMm"])).extrude(d["heightMm"] - d["wallMm"])
        shape = outer.cut(inner)
    elif component["component"] == "cap":
        height = component["features"]["skirtHeightMm"] or 25
        shape = cq.Workplane("XY").circle(radius * .965).extrude(height).cut(cq.Workplane("XY").workplane(offset=1.2).circle(radius * .62).extrude(height))
    elif component["component"] == "pouringRing":
        shape = cq.Workplane("XY").circle(radius * .68).circle(radius * .58).extrude(7)
    elif component["component"] == "liner":
        shape = cq.Workplane("XY").circle(radius * .59).extrude(1.6)
    else:
        return
    if not shape.val().isValid(): raise RuntimeError("CAD B-Rep validity check failed")
    output.parent.mkdir(parents=True, exist_ok=True); cq.exporters.export(shape, str(output))
if __name__ == "__main__": main()
