"""Canonical CadQuery/OpenCascade compiler for NET30 ModelingGraph.

Only this static interpreter creates product solids. Blender consumes its
tessellation and never re-interprets model-authored geometry instructions.
"""
import json, math, pathlib, sys, time

try:
    import cadquery as cq
except ImportError as error:
    raise SystemExit("cad_runtime_unavailable: install the pinned CadQuery/OCP runtime before modeling") from error


def vec(value, fallback=(0.0, 0.0, 0.0)):
    value = value or {}
    return (float(value.get("x", fallback[0])), float(value.get("y", fallback[1])), float(value.get("z", fallback[2])))


def transform_shape(shape, transform):
    if not transform: return shape
    rotation = vec(transform.get("rotationDeg")); translation = vec(transform.get("translationMm"))
    for axis, angle in (((1, 0, 0), rotation[0]), ((0, 1, 0), rotation[1]), ((0, 0, 1), rotation[2])):
        if abs(angle) > 1e-9: shape = shape.rotate((0, 0, 0), axis, angle)
    if any(abs(item) > 1e-9 for item in translation): shape = shape.translate(translation)
    return shape


def revolve(params):
    """Build an axisymmetric solid from a component-local generating curve.

    The profile is deliberately kept in the part coordinate system.  Assembly
    placement belongs exclusively to the XDE assembly, otherwise an exported
    child GLB receives the same transform a second time when it is assembled.
    ``curveSegments`` is the v3 representation; the legacy point list remains
    a lossless compatibility input while existing assets are migrated.
    """
    segments = params.get("curveSegments") or []
    raw = [(float(point["xMm"]), float(point["zMm"])) for point in (params.get("profile") or [])]
    if segments:
        raw = []
        for segment in segments:
            kind = segment.get("kind")
            if kind not in ("line", "arc", "bezier", "nurbs"):
                raise RuntimeError(f"unsupported_operation: profile segment {kind}")
            points = segment.get("points") or []
            if kind == "nurbs":
                points = segment.get("poles") or points
            for point in points:
                pair = (float(point["xMm"]), float(point["zMm"]))
                if not raw or math.dist(pair, raw[-1]) > 1e-8:
                    raw.append(pair)
    points = []
    for point in raw:
        if not points or math.dist(point, points[-1]) > 1e-8: points.append(point)
    if len(points) > 2 and math.dist(points[0], points[-1]) <= 1e-8: points.pop()
    if len(points) < 2: raise RuntimeError("graph_invalid: revolve profile requires at least two points")
    wire = cq.Workplane("XZ").moveTo(*points[0]).spline(points[1:]).close()
    return wire.revolve(float(params.get("angleDeg") or 360), (0, 0, 0), (0, 1, 0))


def primitive(params):
    dimensions = params.get("dimensionsMm") or {"x": float(params.get("radiusMm") or 10) * 2, "y": float(params.get("radiusMm") or 10) * 2, "z": float(params.get("heightMm") or 10)}
    kind = params.get("primitive") or "cylinder"; x, y, z = vec(dimensions, (20, 20, 20))
    if params.get("innerRadiusMm") is not None: return cq.Workplane("XY").circle(float(params.get("radiusMm") or x / 2)).circle(float(params["innerRadiusMm"])).extrude(float(params.get("heightMm") or z)).translate((0, 0, -float(params.get("heightMm") or z) / 2))
    if kind == "box": return cq.Workplane("XY").box(x, y, z)
    if kind == "sphere": return cq.Workplane("XY").sphere(x / 2)
    if kind == "cone": return cq.Workplane("XY").circle(x / 2).workplane(offset=z).circle(max(.01, y / 2)).loft(combine=True).translate((0, 0, -z / 2))
    if kind == "torus": return cq.Workplane("XY").transformed(offset=(x / 2, 0, 0)).circle(max(.01, y / 2)).revolve(360, (0, 0, 0), (0, 0, 1))
    return cq.Workplane("XY").circle(float(params.get("radiusMm") or x / 2)).extrude(float(params.get("heightMm") or z)).translate((0, 0, -float(params.get("heightMm") or z) / 2))


def radial_pattern(shape, count):
    if count is None or int(count) < 1:
        raise RuntimeError("graph_invalid: radial pattern requires a positive count")
    count = min(512, int(count)); result = None
    for index in range(count):
        instance = shape.rotate((0, 0, 0), (0, 0, 1), 360 * index / count)
        result = instance if result is None else result.union(instance)
    return result


def inner_revolve_from_profile(params, thickness):
    """Create an explicit inner cavity for an axisymmetric solid.

    OCCT's generic ``shell`` can fail for an open mouth or a highly curved
    shoulder.  For a revolve source we have a better, deterministic
    manufacturing representation: an independently generated inner curve is
    subtracted from the outer B-Rep.  It uses the approved wall thickness and
    deliberately opens above the rim; it never substitutes an arbitrary
    cylinder for the cavity.
    """
    raw = [(float(point["xMm"]), float(point["zMm"])) for point in (params.get("profile") or [])]
    visible = [(x, z) for x, z in raw if x > 1e-6]
    if len(visible) < 2:
        raise RuntimeError("graph_invalid: shell source revolve needs a visible outer profile")
    visible.sort(key=lambda item: item[1])
    z_min, z_max = visible[0][1], visible[-1][1]
    start_z = z_min + thickness
    if start_z >= z_max - 1e-6:
        raise RuntimeError("graph_invalid: shell thickness leaves no interior height")
    def radius_at(z):
        if z <= visible[0][1]: return visible[0][0]
        if z >= visible[-1][1]: return visible[-1][0]
        for (x0, z0), (x1, z1) in zip(visible, visible[1:]):
            if z0 <= z <= z1:
                ratio = 0 if abs(z1 - z0) < 1e-9 else (z - z0) / (z1 - z0)
                return x0 + (x1 - x0) * ratio
        return visible[-1][0]
    sample_z = [start_z] + [z for _, z in visible if start_z < z < z_max] + [z_max]
    inner = [(0.0, start_z)]
    for z in sample_z:
        radius = radius_at(z) - thickness
        if radius <= 1e-5:
            raise RuntimeError("graph_invalid: shell thickness exceeds the approved outer profile")
        inner.append((radius, z))
    # Extending only the cavity's axial closing edge past the mouth opens the
    # container without altering the approved outer silhouette.
    inner.append((0.0, z_max + thickness))
    return revolve({**params, "profile": [{"xMm": x, "zMm": z} for x, z in inner], "curveSegments": []})


def compile_graph(graph_component, graph_nodes):
    results = {}
    nodes_by_id = {node["id"]: node for node in graph_nodes}
    pattern_count_by_seed = {}
    for node in graph_nodes:
        if node.get("operation") == "pattern":
            for source in node.get("inputNodeIds", []):
                pattern_count_by_seed[source] = node.get("parameters", {}).get("count")
    for node in graph_nodes:
        op, params = node["operation"], node.get("parameters") or {}; inputs = [results[item] for item in node.get("inputNodeIds", []) if item in results]
        if op == "revolve": shape = revolve(params)
        elif op in ("primitive", "extrude"): shape = primitive(params)
        elif op == "boolean":
            if len(inputs) < 2: raise RuntimeError(f"graph_invalid: boolean node {node['id']} requires two inputs")
            shape = inputs[0]; mode = params.get("operation")
            for operand in inputs[1:]: shape = shape.cut(operand) if mode == "cut" else shape.intersect(operand) if mode == "intersect" else shape.union(operand)
        elif op == "shell":
            if len(inputs) != 1: raise RuntimeError(f"graph_invalid: shell node {node['id']} requires one input")
            thickness = float(params.get("thicknessMm") or 0)
            if thickness <= 0: raise RuntimeError(f"graph_invalid: shell node {node['id']} requires positive thicknessMm")
            source = nodes_by_id.get(node.get("inputNodeIds", [None])[0])
            if source and source.get("operation") == "revolve":
                # Exact inner/outer B-Rep curves are more stable than a
                # generic face-shell for vessel mouths and retain the source
                # profile as the dimensional authority.
                shape = inputs[0].cut(inner_revolve_from_profile(source.get("parameters") or {}, thickness))
            else:
                shape = cq.Workplane(obj=inputs[0].val()).faces("<Z").shell(-thickness)
        elif op == "pattern":
            if len(inputs) not in (1, 2): raise RuntimeError(f"graph_invalid: pattern node {node['id']} requires a seed, optionally preceded by its base solid")
            # ``rib`` consumes the following pattern count so the base solid
            # is not copied 36 times.  Other patterns still instance their
            # seed exactly as requested.
            seed_id = node.get("inputNodeIds", [])[-1] if node.get("inputNodeIds") else None
            if seed_id and nodes_by_id.get(seed_id, {}).get("operation") == "rib": shape = inputs[-1]
            else:
                patterned = radial_pattern(inputs[-1], params.get("count"))
                shape = inputs[0].union(patterned) if len(inputs) == 2 else patterned
        elif op == "rib":
            if len(inputs) < 1: raise RuntimeError(f"graph_invalid: rib node {node['id']} requires baseSolidNodeId input")
            # A feature planner may express the radial count on its following
            # Pattern node and use the approved rib thickness for both radial
            # depth and tangential width.  Those are graph fields already
            # supplied by the planner, not invented 1 mm defaults.
            count = params.get("count") if params.get("count") is not None else pattern_count_by_seed.get(node["id"])
            width_value = params.get("spacingMm") if params.get("spacingMm") is not None else params.get("thicknessMm")
            depth_value = params.get("depthMm") if params.get("depthMm") is not None else params.get("thicknessMm")
            required = {"count": count, "spacingMm": width_value, "depthMm": depth_value, "heightMm": params.get("heightMm")}
            missing = [key for key, value in required.items() if value is None]
            if missing: raise RuntimeError(f"graph_invalid: rib node {node['id']} missing {','.join(missing)}")
            width = max(.05, float(width_value)); depth = max(.05, float(depth_value)); height = max(.05, float(params["heightMm"]))
            base_box = inputs[0].val().BoundingBox()
            local_transform = params.get("transform") or {}
            translation = local_transform.get("translationMm") or {}
            radius = float(params["radiusMm"]) if params.get("radiusMm") is not None else float(translation.get("x", max(abs(base_box.xmin), abs(base_box.xmax), abs(base_box.ymin), abs(base_box.ymax))))
            z_center = float(params.get("zMm", float(translation.get("z", base_box.zmin)) + height / 2))
            # A radial rib is placed tangent to the exterior, then patterned
            # around the part.  It is never silently substituted by a 1 mm box.
            rib = cq.Workplane("XY").box(depth, width, height).translate((radius + depth / 2, 0, z_center))
            shape = inputs[0].union(radial_pattern(rib, count))
        elif op in ("transform", "mate"):
            if len(inputs) != 1: raise RuntimeError(f"graph_invalid: {op} node {node['id']} requires one input")
            shape = transform_shape(inputs[0], params.get("transform"))
        elif op in ("surface_decal", "surface_artwork", "volume", "instance_distribution"): continue
        else: raise RuntimeError(f"unsupported_operation: {node['id']}.{op}")
        # transform/mate already consumed their transform above.  Applying it a
        # second time used to shift caps and rings away from their assemblies.
        if op not in ("transform", "mate", "rib"):
            shape = transform_shape(shape, params.get("transform"))
        legacy_boolean = params.get("operation")
        # A dedicated Boolean node already consumed its operands above.  The
        # legacy inline operation is only for compatibility on a generating
        # node; applying it again inverted a cap cavity into a void B-Rep.
        if op != "boolean" and legacy_boolean in ("cut", "union", "intersect") and inputs:
            base = inputs[0]; shape = base.cut(shape) if legacy_boolean == "cut" else base.intersect(shape) if legacy_boolean == "intersect" else base.union(shape)
        results[node["id"]] = shape
    roots = [results[item] for item in graph_component.get("rootNodeIds", []) if item in results]
    if not roots: raise RuntimeError("graph_invalid: component has no compiled B-Rep root")
    shape = roots[0]
    for addition in roots[1:]: shape = shape.union(addition)
    # OCCT can return a void result when fusing coplanar, independently
    # modelled cap ribs and sealing rings.  Preserve those approved B-Rep
    # roots as an XDE-compatible compound rather than silently dropping the
    # component.  The validation report exposes its solid count, so a compound
    # is never mistaken for a single production-released solid.
    try:
        final_value = shape.val()
        if final_value.isNull(): raise RuntimeError("void fused root")
        final_value.BoundingBox()
    except Exception:
        compound = cq.Compound.makeCompound([root.val() for root in roots if not root.val().isNull()])
        if compound.isNull(): raise RuntimeError("brep_empty: component roots could not form a B-Rep compound")
        shape = cq.Workplane(obj=compound)
    # Component transforms are assembly transforms.  B-Rep children are always
    # exported in local coordinates; cad-assembly-worker/XDE owns placement.
    return shape


def main():
    started = time.perf_counter(); request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    graph_component, graph_nodes = request.get("graphComponent"), request.get("graphNodes", [])
    if not graph_component or graph_component.get("representation") != "brep_solid": raise SystemExit("not_brep_component: component does not define a B-Rep solid")
    print("CAD_PHASE=compile", flush=True); shape = compile_graph(graph_component, graph_nodes); print("CAD_PHASE=validate", flush=True); solid = shape.val()
    if not solid.isValid(): raise RuntimeError("brep_invalid: OpenCascade validity check failed")
    paths = request.get("paths") or {"step": request["output"]}; step = pathlib.Path(paths["step"]); step.parent.mkdir(parents=True, exist_ok=True)
    brep = pathlib.Path(paths.get("brep", step.with_suffix(".brep"))); stl = pathlib.Path(paths.get("stl", step.with_suffix(".stl"))); report = pathlib.Path(paths.get("report", step.with_suffix(".validation.json")))
    print("CAD_PHASE=step", flush=True); cq.exporters.export(shape, str(step)); print("CAD_PHASE=brep", flush=True); solid.exportBrep(str(brep))
    tolerance = float(request.get("tessellation", {}).get("chordMm", .05)); angular = math.radians(float(request.get("tessellation", {}).get("angularDeg", 7)))
    print("CAD_PHASE=tessellate", flush=True); cq.exporters.export(shape, str(stl), tolerance=tolerance, angularTolerance=angular)
    shells = solid.Shells(); closed = bool(shells) and all(item.Closed() for item in shells)
    box = solid.BoundingBox(); payload = {"valid": True, "closed": closed, "solidCount": len(solid.Solids()), "shellCount": len(shells), "volumeMm3": solid.Volume(), "surfaceAreaMm2": solid.Area(), "boundsMm": {"x": box.xlen, "y": box.ylen, "z": box.zlen}, "tessellation": {"chordMm": tolerance, "angularDeg": math.degrees(angular)}, "elapsedMs": round((time.perf_counter() - started) * 1000, 3), "outputs": {"brep": brep.name, "step": step.name, "stl": stl.name}}
    report.write_text(json.dumps(payload, indent=2) + "\n")


if __name__ == "__main__": main()
