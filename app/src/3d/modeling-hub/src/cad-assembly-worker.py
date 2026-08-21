"""Build the immutable parent XDE/STEP assembly from approved child B-Reps."""
import json, math, pathlib, sys, time

try:
    import cadquery as cq
except ImportError as error:
    raise SystemExit("cad_runtime_unavailable: install the pinned CadQuery/OCP runtime") from error


def bounds(shape):
    box = shape.val().BoundingBox()
    return {"x": box.xlen, "y": box.ylen, "z": box.zlen}


def volume(shape):
    """Return OCCT's exact solid volume for STEP round-trip verification."""
    return float(shape.val().Volume())


def placed(shape, transform):
    """Apply the assembly-only transform to a local child B-Rep."""
    transform = transform or {}
    translation = transform.get("translationMm") or transform
    rotation = transform.get("rotationDeg") or {}
    for axis, angle in (((1, 0, 0), rotation.get("x", 0)), ((0, 1, 0), rotation.get("y", 0)), ((0, 0, 1), rotation.get("z", 0))):
        if abs(float(angle)) > 1e-9:
            shape = shape.rotate((0, 0, 0), axis, float(angle))
    return shape.translate((float(translation.get("x", translation.get("xMm", 0))), float(translation.get("y", translation.get("yMm", 0))), float(translation.get("z", translation.get("zMm", 0)))))


def main():
    started = time.perf_counter()
    request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    assembly = cq.Assembly(name=request.get("name") or "NET30_ASSEMBLY")
    parts = []
    for item in request["components"]:
        shape = placed(cq.importers.importBrep(item["brep"]), item.get("transform"))
        assembly.add(shape, name=item["id"])
        parts.append(shape)
    paths = request["paths"]
    for target in paths.values(): pathlib.Path(target).parent.mkdir(parents=True, exist_ok=True)
    assembly.save(paths["xbf"], exportType="XBF")
    assembly.save(paths["step"], exportType="STEP", mode="default")
    reloaded = cq.importers.importStep(paths["step"])
    # XDE/STEP assembly keeps its children as a compound.  Do not Boolean-fuse
    # them only for the source-side comparison: a cap/ring is allowed to have
    # contact with its bottle, whereas fusing it subtracts the contact volume
    # and makes a faithful STEP re-import appear to differ by several percent.
    # Comparing compound-to-compound retains the intended assembly semantics.
    source = cq.Workplane(obj=cq.Compound.makeCompound([part.val() for part in parts]))
    source_bounds, reloaded_bounds = bounds(source), bounds(reloaded)
    source_volume, reloaded_volume = volume(source), volume(reloaded)
    delta = {axis: abs(source_bounds[axis] - reloaded_bounds[axis]) for axis in source_bounds}
    volume_delta = abs(source_volume - reloaded_volume) / max(abs(source_volume), 1e-9)
    report = {"valid": reloaded.val().isValid(), "componentCount": len(parts), "sourceBoundsMm": source_bounds, "reloadedBoundsMm": reloaded_bounds, "boundsDeltaMm": delta, "sourceVolumeMm3": source_volume, "reloadedVolumeMm3": reloaded_volume, "volumeDeltaRatio": volume_delta, "roundTripWithinTolerance": max(delta.values(), default=0) <= float(request.get("toleranceMm", .01)) and volume_delta <= .001, "elapsedMs": round((time.perf_counter() - started) * 1000, 3)}
    pathlib.Path(paths["report"]).write_text(json.dumps(report, indent=2) + "\n")
    # A STEP round-trip discrepancy is a manufacturing-release blocker, not a
    # reason to discard an otherwise valid B-Rep review model.  The caller
    # reads this report, blocks manufacturing export, and still derives the
    # review GLB from these same child B-Reps.  Only an invalid re-import means
    # there is no trustworthy assembly geometry to display at all.
    if not report["valid"]: raise RuntimeError("assembly_step_invalid")


if __name__ == "__main__": main()
