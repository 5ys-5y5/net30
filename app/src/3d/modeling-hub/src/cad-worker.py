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
    component, graph_component, graph_nodes, contract, output = request["component"], request.get("graphComponent"), request.get("graphNodes", []), request["contract"], pathlib.Path(request["output"])
    d = contract["dimensionsMm"]; radius = max(d["widthMm"], d["depthMm"]) / 2
    if graph_component and graph_component.get("representation") == "brep_solid":
        shapes = []
        for node in graph_nodes:
            params, operation = node["parameters"], node["operation"]
            if operation == "revolve":
                points = [(point["xMm"], point["zMm"]) for point in (params.get("profile") or [])]
                if len(points) < 2: raise RuntimeError("Approved revolve profile needs at least two points")
                outer = cq.Workplane("XZ").moveTo(*points[0]).spline(points[1:]).lineTo(0, points[-1][1]).lineTo(0, points[0][1]).close().revolve(360, (0, 0, 0), (0, 1, 0))
                thickness = float(params.get("thicknessMm") or 0)
                if thickness > 0:
                    inner_points = [(max(.1, x - thickness), z) for x, z in points]
                    inner = cq.Workplane("XZ").moveTo(*inner_points[0]).spline(inner_points[1:]).lineTo(0, inner_points[-1][1]).lineTo(0, inner_points[0][1]).close().revolve(360, (0, 0, 0), (0, 1, 0)); outer = outer.cut(inner)
                shapes.append(outer)
            elif operation in ["extrude", "primitive"]:
                dimensions = params.get("dimensionsMm") or {"x": float(params.get("radiusMm") or 10) * 2, "y": float(params.get("radiusMm") or 10) * 2, "z": float(params.get("heightMm") or 10)}
                primitive = params.get("primitive") or "cylinder"
                if params.get("innerRadiusMm") is not None: shape = cq.Workplane("XY").circle(float(params.get("radiusMm") or dimensions["x"] / 2)).circle(float(params["innerRadiusMm"])).extrude(float(params.get("heightMm") or dimensions["z"]))
                elif primitive == "box": shape = cq.Workplane("XY").box(float(dimensions["x"]), float(dimensions["y"]), float(dimensions["z"]))
                elif primitive == "sphere": shape = cq.Workplane("XY").sphere(float(dimensions["x"]) / 2)
                else: shape = cq.Workplane("XY").circle(float(params.get("radiusMm") or dimensions["x"] / 2)).extrude(float(params.get("heightMm") or dimensions["z"]))
                shapes.append(shape)
        if not shapes: return
        shape = shapes[0]
        for addition in shapes[1:]: shape = shape.union(addition)
    elif component["component"] == "bottle":
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
