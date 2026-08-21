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
        declared = []
        for segment in segments:
            kind = segment.get("kind")
            if kind not in ("line", "arc", "bezier", "nurbs"):
                raise RuntimeError(f"unsupported_operation: profile segment {kind}")
            points = segment.get("points") or []
            if kind == "nurbs":
                points = segment.get("poles") or points
            for point in points:
                pair = (float(point["xMm"]), float(point["zMm"]))
                if not declared or math.dist(pair, declared[-1]) > 1e-8:
                    declared.append(pair)
    points = []
    for point in raw:
        if not points or math.dist(point, points[-1]) > 1e-8: points.append(point)
    if len(points) > 2 and math.dist(points[0], points[-1]) <= 1e-8: points.pop()
    if len(points) < 2: raise RuntimeError("graph_invalid: revolve profile requires at least two points")
    workplane = cq.Workplane("XZ").moveTo(*points[0])
    # Raw measured samples are a *point cloud*, not yet a declared NURBS.
    # Interpolating all of them as a free B-spline can overshoot the approved
    # base/rim planes by centimetres. Until the fitter emits explicit rational
    # curveSegments (degree/poles/weights/knots), preserve the measured points
    # as an exact OCCT wire. This is still a B-Rep surface of revolution, not a
    # polygon mesh; a later curve-fitting pass may replace this wire with its
    # validated NURBS declaration without changing the product datum.
    # A declared v3 NURBS/Bézier segment is a manufacturing curve, not a
    # display hint.  Preserve it as an OCCT B-spline edge before revolving;
    # only legacy measured point samples remain a polyline to avoid inventing
    # a curve that was never approved. CadQuery creates the OCCT edge, so the
    # subsequent STEP and GLB tessellation still have one B-Rep source.
    declared_curve = next((segment for segment in segments if segment.get("kind") in ("nurbs", "bezier")), None)
    if declared_curve and len(declared) >= 2:
        try:
            # The NURBS declaration describes the *visible radial contour*.
            # Keep the approved axial base/mouth closing edges from ``profile``
            # linear; splining through the rotation axis would bow a flat base
            # or invent a sealed mouth. This yields one exact OCCT B-Rep wire
            # composed of axis/planar edges plus the measured spline edge.
            radial = [point for point in declared if point[0] > 1e-8]
            if len(radial) < 2: raise RuntimeError("declared curve has no visible radial contour")
            axis_start = next((point for point in points if abs(point[0]) <= 1e-8), points[0])
            axis_end = next((point for point in reversed(points) if abs(point[0]) <= 1e-8), points[-1])
            wire = workplane.lineTo(*radial[0]).spline(radial[1:], periodic=bool(declared_curve.get("periodic", False)), includeCurrent=True).lineTo(*axis_end).close()
        except Exception as error:
            raise RuntimeError(f"graph_invalid: declared {declared_curve.get('kind')} profile cannot form an OCCT wire") from error
    else:
        wire = workplane.polyline(points[1:]).close()
    return wire.revolve(float(params.get("angleDeg") or 360), (0, 0, 0), (0, 1, 0))


def primitive(params):
    # ModelingGraph component-local coordinates use the assembly datum plane at
    # z=0.  Revolved/extruded profiles already follow that rule, so primitives
    # must extend upward from z=0 as well.  Centering only primitives around
    # the origin was shifting a cap down by half its height after a correct
    # mate transform had been calculated.
    dimensions = params.get("dimensionsMm") or {"x": float(params.get("radiusMm") or 10) * 2, "y": float(params.get("radiusMm") or 10) * 2, "z": float(params.get("heightMm") or 10)}
    kind = params.get("primitive") or "cylinder"; x, y, z = vec(dimensions, (20, 20, 20))
    height = float(params.get("heightMm") or z)
    if params.get("innerRadiusMm") is not None: return cq.Workplane("XY").circle(float(params.get("radiusMm") or x / 2)).circle(float(params["innerRadiusMm"])).extrude(height)
    if kind == "box": return cq.Workplane("XY").box(x, y, z, centered=(True, True, False))
    if kind == "sphere": return cq.Workplane("XY").sphere(x / 2).translate((0, 0, x / 2))
    if kind == "cone": return cq.Workplane("XY").circle(x / 2).workplane(offset=z).circle(max(.01, y / 2)).loft(combine=True)
    if kind == "torus": return cq.Workplane("XY").transformed(offset=(x / 2, 0, 0)).circle(max(.01, y / 2)).revolve(360, (0, 0, 0), (0, 0, 1))
    return cq.Workplane("XY").circle(float(params.get("radiusMm") or x / 2)).extrude(height)


def radial_pattern(shape, count):
    if count is None or int(count) < 1:
        raise RuntimeError("graph_invalid: radial pattern requires a positive count")
    count = min(512, int(count)); result = None
    for index in range(count):
        instance = shape.rotate((0, 0, 0), (0, 0, 1), 360 * index / count)
        # ``Workplane.union`` can retain a compound when its input is already a
        # compound.  That is acceptable for unrelated assembly children, but a
        # radial rib feature must become one B-Rep with its host surface.  Use
        # OCCT's Shape fuse directly and wrap the result once at the boundary.
        result = instance.val() if result is None else result.fuse(instance.val())
    return cq.Workplane(obj=result)


def fuse_roots(roots):
    """Fuse feature roots into one intended component solid.

    A compound is not an acceptable silent substitute for a single cap or
    bottle component: it masks disconnected ribs, rings, or decals as a
    manufacturing candidate.  Callers may intentionally emit an assembly
    compound elsewhere, but each ``brep_solid`` graph component must pass this
    direct OCCT fuse before it can reach the manufacturing validator.
    """
    if not roots:
        raise RuntimeError("graph_invalid: component has no compiled B-Rep root")
    result = roots[0].val()
    for addition in roots[1:]:
        result = result.fuse(addition.val())
        if result.isNull():
            raise RuntimeError("graph_invalid: component roots do not form a fuseable B-Rep; repair the feature topology")
    return cq.Workplane(obj=result)


def copy_workplane(shape):
    """Return an OCCT copy for a DAG edge.

    CadQuery Boolean and transform methods may mutate a workplane's wrapped
    shape. ModelingGraph nodes are immutable values: a later pattern must not
    alter the B-Rep cached for an earlier shell or revolve node.
    """
    return cq.Workplane(obj=shape.val().copy())


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
    outer_top_z = max(z for _, z in raw)
    # A profile which returns to the rotation axis above its last visible
    # radius is a roofed closure, not an open vessel. Its cavity must break
    # through the lower datum while stopping below the roof; treating it like
    # a bottle cavity cuts through the roof and can split the cap B-Rep.
    roofed = outer_top_z > z_max + 1e-6 and any(abs(x) <= 1e-6 and abs(z - outer_top_z) <= 1e-6 for x, z in raw)
    start_z = z_min + thickness
    inner_top_z = z_max
    if start_z >= inner_top_z - 1e-6:
        raise RuntimeError("graph_invalid: shell thickness leaves no interior height")
    def radius_at(z):
        if z <= visible[0][1]: return visible[0][0]
        if z >= visible[-1][1]: return visible[-1][0]
        for (x0, z0), (x1, z1) in zip(visible, visible[1:]):
            if z0 <= z <= z1:
                ratio = 0 if abs(z1 - z0) < 1e-9 else (z - z0) / (z1 - z0)
                return x0 + (x1 - x0) * ratio
        return visible[-1][0]
    # A roofed closure has a datum-facing opening and an exterior roof. OCCT
    # face-shell selection is orientation-sensitive for this profile, so form
    # its exact axisymmetric cavity from the measured outer radius at the
    # approved roof-thickness plane. It is a derived analytical B-Rep feature,
    # not a name-based or arbitrary primitive fallback.
    if roofed:
        inner_top_z = z_max - thickness
        inner_radius = radius_at(inner_top_z) - thickness
        if inner_top_z <= z_min + 1e-6 or inner_radius <= 1e-5:
            raise RuntimeError("graph_invalid: shell thickness leaves no roofed-closure cavity")
        return cq.Workplane("XY").circle(inner_radius).extrude(inner_top_z - z_min)
    sample_z = [start_z] + [z for _, z in visible if start_z < z < inner_top_z] + [inner_top_z]
    inner = [(0.0, start_z)]
    for z in sample_z:
        radius = radius_at(z) - thickness
        if radius <= 1e-5:
            raise RuntimeError("graph_invalid: shell thickness exceeds the approved outer profile")
        inner.append((radius, z))
    # Close the cutter exactly on the approved mouth plane.  Extending the
    # axial edge beyond that plane looks harmless in a profile diagram, but
    # for a shoulder/neck transition it can split the outer revolution into
    # two solids during the Boolean.  The outer B-Rep already defines the
    # datum face; an exact closing edge produces the same open-mouth cut
    # without inventing geometry above the measured silhouette.
    inner.append((0.0, z_max))
    return revolve({**params, "profile": [{"xMm": x, "zMm": z} for x, z in inner], "curveSegments": []})


def radial_extent_at_z(node_id, z_mm, nodes_by_id, seen=None):
    """Resolve the actual radial envelope at a feature's local Z ordinate.

    Ribs are attached to a *surface at their own height*, not to the widest
    point of a cap elsewhere in the profile. Bounding-box placement detached
    a ribbed taper from its host body even though the graph correctly named a
    base solid. This evaluator follows the declared feature graph and only
    returns a radius for operations whose radial extent is unambiguous.
    """
    seen = set() if seen is None else seen
    if node_id in seen:
        return None
    seen.add(node_id)
    node = nodes_by_id.get(node_id)
    if not node:
        return None
    params = node.get("parameters") or {}
    op = node.get("operation")
    transform = params.get("transform") or {}
    translation = transform.get("translationMm") or {}
    local_z = z_mm - float(translation.get("z") or 0)
    if op == "revolve":
        raw = [(float(point["xMm"]), float(point["zMm"])) for point in (params.get("profile") or []) if float(point["xMm"]) > 1e-8]
        if len(raw) < 2:
            return None
        raw.sort(key=lambda item: item[1])
        if local_z < raw[0][1] - 1e-6 or local_z > raw[-1][1] + 1e-6:
            return None
        if local_z <= raw[0][1]:
            return raw[0][0]
        for left, right in zip(raw, raw[1:]):
            if left[1] <= local_z <= right[1]:
                ratio = 0 if abs(right[1] - left[1]) < 1e-9 else (local_z - left[1]) / (right[1] - left[1])
                return left[0] + (right[0] - left[0]) * ratio
        return raw[-1][0]
    if op in ("primitive", "extrude"):
        dimensions = params.get("dimensionsMm") or {}
        height = float(params.get("heightMm") or dimensions.get("z") or 0)
        if local_z < -1e-6 or local_z > height + 1e-6:
            return None
        if params.get("radiusMm") is not None:
            return float(params["radiusMm"])
        return max(float(dimensions.get("x") or 0), float(dimensions.get("y") or 0)) / 2
    inputs = node.get("inputNodeIds") or []
    radii = [radial_extent_at_z(item, local_z, nodes_by_id, seen.copy()) for item in inputs]
    radii = [item for item in radii if item is not None]
    if not radii:
        return None
    if op == "boolean" and params.get("operation") == "cut":
        return radii[0]
    return max(radii)


def feature_depends_on(node_id, ancestor_id, nodes_by_id, seen=None):
    """Whether a graph result already contains a declared ancestor feature."""
    if node_id == ancestor_id:
        return True
    seen = set() if seen is None else seen
    if node_id in seen:
        return False
    seen.add(node_id)
    node = nodes_by_id.get(node_id) or {}
    return any(feature_depends_on(input_id, ancestor_id, nodes_by_id, seen.copy()) for input_id in node.get("inputNodeIds", []))


def compile_graph(graph_component, graph_nodes):
    results = {}
    nodes_by_id = {node["id"]: node for node in graph_nodes}
    pattern_count_by_seed = {}
    for node in graph_nodes:
        if node.get("operation") == "pattern":
            for source in node.get("inputNodeIds", []):
                pattern_count_by_seed[source] = node.get("parameters", {}).get("count")
    for node in graph_nodes:
        op, params = node["operation"], node.get("parameters") or {}; inputs = [copy_workplane(results[item]) for item in node.get("inputNodeIds", []) if item in results]
        if op == "revolve": shape = revolve(params)
        elif op in ("primitive", "extrude"): shape = primitive(params)
        elif op == "boolean":
            if len(inputs) < 2: raise RuntimeError(f"graph_invalid: boolean node {node['id']} requires two inputs")
            mode = params.get("operation")
            # Pattern(base, rib) is already the complete base-plus-pattern
            # result. Re-unioning its explicit base duplicates a compound and
            # can split valid OCCT solids. Preserve the graph DAG meaning
            # rather than treating each reference as a separate solid.
            input_ids = node.get("inputNodeIds", [])
            if mode == "union" and len(input_ids) == 2 and nodes_by_id.get(input_ids[1], {}).get("operation") == "pattern" and feature_depends_on(input_ids[1], input_ids[0], nodes_by_id):
                shape = inputs[1]
            else:
                shape = inputs[0]
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
            if seed_id and nodes_by_id.get(seed_id, {}).get("operation") == "rib":
                # A pattern's first input is the immutable host/base; its
                # second input is one rib seed. Return the complete fused cap,
                # not a compound of 36 detached rib solids.
                shape = fuse_roots([inputs[0], radial_pattern(inputs[-1], params.get("count"))])
            else:
                patterned = radial_pattern(inputs[-1], params.get("count"))
                shape = fuse_roots([inputs[0], patterned]) if len(inputs) == 2 else patterned
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
            local_transform = params.get("transform") or {}
            translation = local_transform.get("translationMm") or {}
            base_box = inputs[0].val().BoundingBox()
            z_center = float(params.get("zMm", float(translation.get("z", base_box.zmin)) + height / 2))
            base_node_id = node.get("inputNodeIds", [None])[0]
            surface_radius = radial_extent_at_z(base_node_id, z_center, nodes_by_id)
            radial_datum = float(translation.get("x") or 0)
            radius = float(params["radiusMm"]) if params.get("radiusMm") is not None else radial_datum if abs(radial_datum) > 1e-8 else surface_radius if surface_radius is not None else max(abs(base_box.xmin), abs(base_box.xmax), abs(base_box.ymin), abs(base_box.ymax))
            # The rib deliberately penetrates the approved exterior by 35% of
            # its radial depth.  A merely tangent box becomes a separate B-Rep
            # compound; this overlap makes the Boolean fuse deterministic while
            # retaining the explicit protrusion requested by the graph.
            rib = cq.Workplane("XY").box(depth, width, height).translate((radius + depth * .15, 0, z_center))
            # A following Pattern node owns the radial repetition.  Returning
            # only the seed here prevents the base cylinder from being copied
            # once per rib, which previously made cap root fusion void.
            shape = rib if node["id"] in pattern_count_by_seed else fuse_roots([inputs[0], radial_pattern(rib, count)])
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
            base = inputs[0]
            # Keep a legacy inline union on the same OCCT fuse path as an
            # explicit Boolean union.  ``Workplane.union`` may preserve a
            # compound after a patterned rib feature even when every rib
            # overlaps the cap shell, which made a visibly correct cap fail
            # the one-connected-solid manufacturing gate.
            shape = base.cut(shape) if legacy_boolean == "cut" else base.intersect(shape) if legacy_boolean == "intersect" else fuse_roots([base, shape])
        results[node["id"]] = shape
    roots = [results[item] for item in graph_component.get("rootNodeIds", []) if item in results]
    shape = fuse_roots(roots)
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
    if not closed or payload["solidCount"] != 1:
        raise RuntimeError(f"brep_preflight_failed: closed={closed}, solidCount={payload['solidCount']}")


if __name__ == "__main__": main()
