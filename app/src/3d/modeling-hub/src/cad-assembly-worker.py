"""Build the immutable parent XDE/STEP assembly from approved child B-Reps."""
import json, pathlib, sys, time

try:
    import cadquery as cq
except ImportError as error:
    raise SystemExit("cad_runtime_unavailable: install the pinned CadQuery/OCP runtime") from error


def bounds(shape):
    box = shape.val().BoundingBox()
    return {"x": box.xlen, "y": box.ylen, "z": box.zlen}


def main():
    started = time.perf_counter()
    request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    assembly = cq.Assembly(name=request.get("name") or "NET30_ASSEMBLY")
    parts = []
    for item in request["components"]:
        shape = cq.importers.importBrep(item["brep"])
        assembly.add(shape, name=item["id"])
        parts.append(shape)
    paths = request["paths"]
    for target in paths.values(): pathlib.Path(target).parent.mkdir(parents=True, exist_ok=True)
    assembly.save(paths["xbf"], exportType="XBF")
    assembly.save(paths["step"], exportType="STEP", mode="default")
    reloaded = cq.importers.importStep(paths["step"])
    source = parts[0]
    for part in parts[1:]: source = source.union(part)
    source_bounds, reloaded_bounds = bounds(source), bounds(reloaded)
    delta = {axis: abs(source_bounds[axis] - reloaded_bounds[axis]) for axis in source_bounds}
    report = {"valid": reloaded.val().isValid(), "componentCount": len(parts), "sourceBoundsMm": source_bounds, "reloadedBoundsMm": reloaded_bounds, "boundsDeltaMm": delta, "roundTripWithinTolerance": max(delta.values(), default=0) <= float(request.get("toleranceMm", .01)), "elapsedMs": round((time.perf_counter() - started) * 1000, 3)}
    pathlib.Path(paths["report"]).write_text(json.dumps(report, indent=2) + "\n")
    if not report["valid"] or not report["roundTripWithinTolerance"]: raise RuntimeError("assembly_step_roundtrip_failed")


if __name__ == "__main__": main()
