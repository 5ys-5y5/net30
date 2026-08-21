"""Canonical CadQuery/OpenCascade compiler for NET30 ModelingGraph.

Only this static interpreter creates product solids. Blender consumes its
tessellation and never re-interprets model-authored geometry instructions.
"""
import json, math, pathlib, struct, sys, time

try:
    import cadquery as cq
    from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeEdge, BRepBuilderAPI_MakeWire
    from OCP.Geom import Geom_BSplineCurve, Geom_BezierCurve
    from OCP.TColgp import TColgp_Array1OfPnt
    from OCP.TColStd import TColStd_Array1OfInteger, TColStd_Array1OfReal
    from OCP.gp import gp_Pnt, gp_Vec
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


def rational_bspline_curve(segment):
    """Make the declared rational NURBS edge without re-interpolating it.

    CadQuery's ``Workplane.spline`` is an interpolation convenience.  It does
    not consume a graph's knots, multiplicities, or rational weights, so it
    cannot be the manufacturing source for a declared NURBS.  This function
    passes the approved control net directly to OCCT instead.  Invalid knot
    vectors are a graph error rather than an excuse to substitute a generic
    smooth curve.
    """
    poles = segment.get("poles") or segment.get("points") or []
    weights = segment.get("weights") or []
    knots = segment.get("knots") or []
    multiplicities = segment.get("multiplicities") or []
    degree = int(segment.get("degree") or 0)
    if len(poles) < 2 or degree < 1 or degree >= len(poles):
        raise RuntimeError("graph_invalid: NURBS degree requires at least degree + 1 poles")
    if len(weights) != len(poles):
        raise RuntimeError("graph_invalid: NURBS weights must match pole count")
    if len(knots) != len(multiplicities) or len(knots) < 2:
        raise RuntimeError("graph_invalid: NURBS knots and multiplicities must be paired")
    if sum(int(value) for value in multiplicities) != len(poles) + degree + 1:
        raise RuntimeError("graph_invalid: NURBS knot multiplicities do not match poles and degree")
    if any(float(value) <= 0 for value in weights) or any(int(value) < 1 for value in multiplicities):
        raise RuntimeError("graph_invalid: NURBS weights and multiplicities must be positive")
    if any(float(right) <= float(left) for left, right in zip(knots, knots[1:])):
        raise RuntimeError("graph_invalid: NURBS knots must be strictly increasing")
    points = TColgp_Array1OfPnt(1, len(poles)); values = TColStd_Array1OfReal(1, len(poles))
    for index, point in enumerate(poles, 1):
        points.SetValue(index, gp_Pnt(float(point["xMm"]), 0, float(point["zMm"])))
        values.SetValue(index, float(weights[index - 1]))
    knot_values = TColStd_Array1OfReal(1, len(knots)); knot_multiplicities = TColStd_Array1OfInteger(1, len(knots))
    for index, (knot, multiplicity) in enumerate(zip(knots, multiplicities), 1):
        knot_values.SetValue(index, float(knot)); knot_multiplicities.SetValue(index, int(multiplicity))
    return Geom_BSplineCurve(points, values, knot_values, knot_multiplicities, degree, bool(segment.get("periodic", False)))


def rational_bspline_edge(segment):
    return BRepBuilderAPI_MakeEdge(rational_bspline_curve(segment)).Edge()


def profile_face_from_curve(curve, first, last, axis_start, axis_end):
    """Close a radial OCCT curve with explicit, planar axial datum edges."""
    return profile_face_from_edges([BRepBuilderAPI_MakeEdge(curve).Edge()], first, last, axis_start, axis_end)


def profile_face_from_edges(radial_edges, first, last, axis_start, axis_end):
    """Close one or more continuous radial edges with planar datum edges."""
    first_point = gp_Pnt(float(first[0]), 0, float(first[1]))
    last_point = gp_Pnt(float(last[0]), 0, float(last[1]))
    start_point = gp_Pnt(float(axis_start[0]), 0, float(axis_start[1]))
    end_point = gp_Pnt(float(axis_end[0]), 0, float(axis_end[1]))
    edges = [
        BRepBuilderAPI_MakeEdge(start_point, first_point).Edge(),
        *radial_edges,
        BRepBuilderAPI_MakeEdge(last_point, end_point).Edge(),
        BRepBuilderAPI_MakeEdge(end_point, start_point).Edge(),
    ]
    wire_builder = BRepBuilderAPI_MakeWire()
    for edge in edges: wire_builder.Add(edge)
    if not wire_builder.IsDone():
        raise RuntimeError("graph_invalid: declared NURBS profile edges cannot form a closed wire")
    return cq.Face.makeFromWires(cq.Wire(wire_builder.Wire()))


def bezier_edge(segment):
    points = segment.get("points") or []
    if len(points) != 4:
        raise RuntimeError("graph_invalid: Bézier profile needs four control points")
    values = TColgp_Array1OfPnt(1, 4)
    for index, point in enumerate(points, 1): values.SetValue(index, gp_Pnt(float(point["xMm"]), 0, float(point["zMm"])))
    return BRepBuilderAPI_MakeEdge(Geom_BezierCurve(values)).Edge()


def bezier_profile_face(segments, axis_start, axis_end):
    first = segments[0].get("points", [])[0]
    last = segments[-1].get("points", [])[-1]
    if not first or not last or abs(float(first["xMm"])) <= 1e-8 or abs(float(last["xMm"])) <= 1e-8:
        raise RuntimeError("graph_invalid: Bézier radial profile must exclude the rotation axis")
    previous = None
    for segment in segments:
        points = segment.get("points") or []
        if len(points) != 4: raise RuntimeError("graph_invalid: Bézier profile needs four control points")
        if previous and math.dist((float(previous["xMm"]), float(previous["zMm"])), (float(points[0]["xMm"]), float(points[0]["zMm"]))) > 1e-5:
            raise RuntimeError("graph_invalid: Bézier profile segments are not connected")
        previous = points[-1]
    return profile_face_from_edges([bezier_edge(segment) for segment in segments], (first["xMm"], first["zMm"]), (last["xMm"], last["zMm"]), axis_start, axis_end)


def rational_profile_face(segment, axis_start, axis_end):
    """Close one declared radial NURBS with only the approved axial datum edges."""
    poles = segment.get("poles") or segment.get("points") or []
    if len(poles) < 2:
        raise RuntimeError("graph_invalid: NURBS profile requires two radial poles")
    if any(abs(float(point["xMm"])) <= 1e-8 for point in poles):
        raise RuntimeError("graph_invalid: NURBS radial profile must exclude the rotation axis")
    first, last = poles[0], poles[-1]
    return profile_face_from_curve(rational_bspline_curve(segment), (first["xMm"], first["zMm"]), (last["xMm"], last["zMm"]), axis_start, axis_end)


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
    if declared_curve and declared_curve.get("kind") == "nurbs":
        # A rational NURBS is an approved engineering curve.  Build its OCCT
        # edge from the exact control net, rather than asking CadQuery to fit a
        # second unrelated interpolation.  The two closing edges are planar
        # assembly datums retained from the graph profile.
        axis_start = next((point for point in points if abs(point[0]) <= 1e-8), points[0])
        axis_end = next((point for point in reversed(points) if abs(point[0]) <= 1e-8), points[-1])
        try:
            face = rational_profile_face(declared_curve, axis_start, axis_end)
            return cq.Workplane("XZ").newObject([face]).toPending().revolve(float(params.get("angleDeg") or 360), (0, 0, 0), (0, 1, 0))
        except Exception as error:
            if isinstance(error, RuntimeError): raise
            raise RuntimeError("graph_invalid: declared NURBS profile cannot form an OCCT face") from error
    bezier_segments = [segment for segment in segments if segment.get("kind") == "bezier"]
    if bezier_segments and len(bezier_segments) == len(segments):
        axis_start = next((point for point in points if abs(point[0]) <= 1e-8), points[0])
        axis_end = next((point for point in reversed(points) if abs(point[0]) <= 1e-8), points[-1])
        try:
            face = bezier_profile_face(bezier_segments, axis_start, axis_end)
            return cq.Workplane("XZ").newObject([face]).toPending().revolve(float(params.get("angleDeg") or 360), (0, 0, 0), (0, 1, 0))
        except Exception as error:
            if isinstance(error, RuntimeError): raise
            raise RuntimeError("graph_invalid: declared Bézier profile cannot form an OCCT face") from error
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


def extrude(params):
    """Extrude an approved planar sketch, never a generic cylinder fallback.

    ``profile`` is an ordered component-local XY wire.  A circular/annular
    sketch can alternatively use the explicit radius fields; that is still an
    analytical extrusion, not a replacement for an unknown arbitrary profile.
    """
    height = float(params.get("heightMm") or (params.get("dimensionsMm") or {}).get("z") or 0)
    if height <= 1e-8:
        raise RuntimeError("graph_invalid: extrude requires positive heightMm")
    raw = params.get("profile") or []
    if raw:
        points = [(float(point["xMm"]), float(point["yMm"]), float(point["zMm"])) for point in raw]
        if len(points) < 3:
            raise RuntimeError("graph_invalid: extrude profile needs at least three ordered points")
        z_values = [point[2] for point in points]; z = z_values[0]
        if any(abs(value - z) > 1e-6 for value in z_values):
            raise RuntimeError("graph_invalid: extrude profile must be planar in component-local XY")
        planar = [(point[0], point[1]) for point in points]
        if math.dist(planar[0], planar[-1]) <= 1e-8: planar.pop()
        if len(planar) < 3:
            raise RuntimeError("graph_invalid: extrude profile collapses after closing-point normalization")
        return cq.Workplane("XY").workplane(offset=z).moveTo(*planar[0]).polyline(planar[1:]).close().extrude(height)
    radius = params.get("radiusMm")
    if radius is None:
        raise RuntimeError("graph_invalid: extrude requires a profile or explicit radiusMm")
    workplane = cq.Workplane("XY").circle(float(radius))
    if params.get("innerRadiusMm") is not None:
        workplane = workplane.circle(float(params["innerRadiusMm"]))
    return workplane.extrude(height)


def loft(params):
    """Create a component-local solid from two or more explicit planar wires.

    A loft is a manufacturing feature, not a triangulated visual shortcut.  A
    graph profile is an ordered closed XY wire at one Z datum; each datum is
    checked here instead of silently flattening arbitrary three-dimensional
    point clouds.  OCCT owns the resulting B-Rep, and the same persisted B-Rep
    subsequently produces STEP and the display tessellation.
    """
    profiles = params.get("profiles") or []
    if len(profiles) < 2:
        raise RuntimeError("graph_invalid: loft requires at least two planar profiles")
    workplane = cq.Workplane("XY")
    previous_z = 0.0
    for index, raw_profile in enumerate(profiles):
        points = [(float(point["xMm"]), float(point["yMm"]), float(point["zMm"])) for point in raw_profile]
        if len(points) < 3:
            raise RuntimeError("graph_invalid: loft profile needs at least three ordered points")
        z_values = [point[2] for point in points]
        z = z_values[0]
        if any(abs(value - z) > 1e-6 for value in z_values):
            raise RuntimeError("graph_invalid: each loft profile must be planar at one component-local Z datum")
        if index and z <= previous_z + 1e-6:
            raise RuntimeError("graph_invalid: loft profiles must be strictly ordered along component-local Z")
        planar = [(point[0], point[1]) for point in points]
        if math.dist(planar[0], planar[-1]) <= 1e-8:
            planar.pop()
        if len(planar) < 3:
            raise RuntimeError("graph_invalid: loft profile collapses after closing-point normalization")
        workplane = workplane.workplane(offset=z - previous_z).moveTo(*planar[0]).polyline(planar[1:]).close()
        previous_z = z
    return workplane.loft(combine=True)


def sweep(params):
    """Sweep one approved component-local section along an explicit 3-D path.

    The graph carries a closed XY section (``profile``) or a circle radius,
    and an ordered component-local path.  OCCT, not a display mesh, owns the
    resulting solid.  A Frenet frame makes non-planar industrial tubes and
    handles valid without treating the path as a sequence of approximate
    cylinders.  The section is deliberately translated to the first path
    point; children stay local and the XDE assembly remains the only place
    where component placement can occur.
    """
    raw_path = params.get("path") or []
    if len(raw_path) < 2:
        raise RuntimeError("graph_invalid: sweep requires an ordered path with at least two points")
    points = [(float(point["xMm"]), float(point["yMm"]), float(point["zMm"])) for point in raw_path]
    if any(math.dist(left, right) <= 1e-8 for left, right in zip(points, points[1:])):
        raise RuntimeError("graph_invalid: sweep path has a zero-length segment")
    path_builder = BRepBuilderAPI_MakeWire()
    for start, end in zip(points, points[1:]):
        path_builder.Add(BRepBuilderAPI_MakeEdge(gp_Pnt(*start), gp_Pnt(*end)).Edge())
    if not path_builder.IsDone():
        raise RuntimeError("graph_invalid: sweep path cannot form an OCCT wire")
    path = cq.Wire(path_builder.Wire())

    section = params.get("profile") or []
    radius = params.get("radiusMm")
    start = points[0]
    if section:
        if len(section) < 3:
            raise RuntimeError("graph_invalid: sweep profile needs at least three ordered points")
        if any(abs(float(point["zMm"])) > 1e-6 for point in section):
            raise RuntimeError("graph_invalid: sweep profile must use its local XY section plane (zMm=0)")
        contour = [(float(point["xMm"]), float(point["yMm"])) for point in section]
        if math.dist(contour[0], contour[-1]) <= 1e-8:
            contour.pop()
        if len(contour) < 3:
            raise RuntimeError("graph_invalid: sweep profile collapses after closing-point normalization")
        profile = cq.Workplane("XY").transformed(offset=start).moveTo(*contour[0]).polyline(contour[1:]).close()
    elif radius is not None and float(radius) > 0:
        profile = cq.Workplane("XY").transformed(offset=start).circle(float(radius))
    else:
        raise RuntimeError("graph_invalid: sweep requires a closed profile or positive radiusMm")
    try:
        return profile.sweep(path, makeSolid=True, isFrenet=True, transition="transformed", combine=True, clean=True)
    except Exception as error:
        raise RuntimeError("graph_invalid: sweep section and path cannot form a closed OCCT solid") from error


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
    segments = params.get("curveSegments") or []
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
    # The opening datum is graph-authored/measured.  Falling back to the old
    # wire-shape heuristic is only for pre-v3 assets; a normal bottle's closed
    # planar wire also returns to the axis and must not be mistaken for a cap.
    declared_opening = params.get("cavityOpenAt")
    roofed = declared_opening == "bottom" if declared_opening in ("top", "bottom") else outer_top_z > z_max + 1e-6 and any(abs(x) <= 1e-6 and abs(z - outer_top_z) <= 1e-6 for x, z in raw)
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
    # Pass the cutter a tiny, fixed manufacturing-kernel tolerance through
    # the mouth plane. A cutter ending exactly coincident with the outer rim
    # makes OCCT's Boolean ambiguous (and can return a null shape), whereas
    # this 0.01 mm extension is removed by the outer solid and never changes
    # the exterior curve, height, or approved mouth datum.
    cut_clearance = .01
    inner.append((inner[-1][0], z_max + cut_clearance))
    inner.append((0.0, z_max + cut_clearance))
    return revolve({**params, "profile": [{"xMm": x, "zMm": z} for x, z in inner], "curveSegments": []})


def axisymmetric_shell_from_profile(params, thickness):
    """Create an open vessel from one continuous annular generating wire.

    Subtracting a second revolved solid from a thin, curved bottle can split
    OCCT into disconnected slivers.  ``faces().shell`` may look valid in
    memory yet serialise a different cavity in STEP.  Instead, this builds the
    outer wall, rim, inner wall and base as one planar cross-section and
    revolves that single wire.  The outer declared Bézier/NURBS edge remains
    the graph-authored analytical curve; only the hidden inner offset is
    derived from the approved wall thickness.
    """
    raw = [(float(point["xMm"]), float(point["zMm"])) for point in (params.get("profile") or [])]
    visible = sorted([(x, z) for x, z in raw if x > 1e-6], key=lambda item: item[1])
    if len(visible) < 2:
        raise RuntimeError("graph_invalid: shell source revolve needs a visible outer profile")
    if raw[0][0] > 1e-6:
        raise RuntimeError("graph_invalid: axisymmetric shell requires an approved lower axial datum")
    def offset_point(index):
        left, right = visible[max(0, index - 1)], visible[min(len(visible) - 1, index + 1)]
        dx, dz = right[0] - left[0], right[1] - left[1]; length = math.hypot(dx, dz)
        if length <= 1e-9: raise RuntimeError("graph_invalid: shell source profile has a zero-length tangent")
        # The generating curve travels bottom-to-mouth. Its inward normal is
        # (-dz, dx), so this is a normal wall thickness, not a radial shortcut.
        x, z = visible[index]
        return (x - thickness * dz / length, z + thickness * dx / length)
    inner = [offset_point(index) for index in range(len(visible))]
    start = next((index for index, (_, z) in enumerate(inner) if z >= visible[0][1] + thickness - 1e-6), None)
    if start is None or start >= len(inner) - 1:
        raise RuntimeError("graph_invalid: shell thickness leaves no approved interior profile")
    inner = inner[start:]
    # The open mouth is an annular rim on the approved outer mouth plane. A
    # normal offset can move its final point infinitesimally above that plane;
    # clamping that one inner endpoint preserves the datum without altering
    # the exterior B-spline/Bezier surface.
    inner[-1] = (inner[-1][0], visible[-1][1])
    if any(x <= 1e-5 for x, _ in inner):
        raise RuntimeError("graph_invalid: shell thickness exceeds the approved outer profile")

    segments = params.get("curveSegments") or []
    outer_edges = []
    if segments and all(segment.get("kind") == "bezier" for segment in segments):
        first = segments[0].get("points", [None])[0]; last = segments[-1].get("points", [None])[-1]
        if not first or not last: raise RuntimeError("graph_invalid: declared Bézier shell profile is incomplete")
        outer_edges = [bezier_edge(segment) for segment in segments]
        first_outer, last_outer = (float(first["xMm"]), float(first["zMm"])), (float(last["xMm"]), float(last["zMm"]))
    elif len(segments) == 1 and segments[0].get("kind") == "nurbs":
        poles = segments[0].get("poles") or segments[0].get("points") or []
        if len(poles) < 2: raise RuntimeError("graph_invalid: declared NURBS shell profile is incomplete")
        outer_edges = [rational_bspline_edge(segments[0])]
        first_outer, last_outer = (float(poles[0]["xMm"]), float(poles[0]["zMm"])), (float(poles[-1]["xMm"]), float(poles[-1]["zMm"]))
    else:
        first_outer, last_outer = visible[0], visible[-1]
        outer_edges = [BRepBuilderAPI_MakeEdge(gp_Pnt(x0, 0, z0), gp_Pnt(x1, 0, z1)).Edge() for (x0, z0), (x1, z1) in zip(visible, visible[1:])]

    edges = [BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, raw[0][1]), gp_Pnt(first_outer[0], 0, first_outer[1])).Edge(), *outer_edges, BRepBuilderAPI_MakeEdge(gp_Pnt(last_outer[0], 0, last_outer[1]), gp_Pnt(inner[-1][0], 0, inner[-1][1])).Edge()]
    for current, following in zip(reversed(inner), reversed(inner[:-1])):
        edges.append(BRepBuilderAPI_MakeEdge(gp_Pnt(current[0], 0, current[1]), gp_Pnt(following[0], 0, following[1])).Edge())
    edges.extend([BRepBuilderAPI_MakeEdge(gp_Pnt(inner[0][0], 0, inner[0][1]), gp_Pnt(0, 0, inner[0][1])).Edge(), BRepBuilderAPI_MakeEdge(gp_Pnt(0, 0, inner[0][1]), gp_Pnt(0, 0, raw[0][1])).Edge()])
    wire_builder = BRepBuilderAPI_MakeWire()
    for edge in edges: wire_builder.Add(edge)
    if not wire_builder.IsDone(): raise RuntimeError("graph_invalid: shell wall/rim/base cannot form one closed generating wire")
    face = cq.Face.makeFromWires(cq.Wire(wire_builder.Wire()))
    return cq.Workplane("XZ").newObject([face]).toPending().revolve(float(params.get("angleDeg") or 360), (0, 0, 0), (0, 1, 0))


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
    # A child B-Rep is intentionally component-local. Preflight/export used
    # to iterate every node in the parent graph even when asked to validate a
    # single child, so a temporary cap/ring candidate could fail the bottle's
    # check and each worker repeated the whole assembly's CAD work. Assembly
    # transforms and mates are applied later in XDE; no cross-component shape
    # input belongs in this local compiler closure.
    component_id = graph_component.get("id")
    component_nodes = [node for node in graph_nodes if node.get("componentId") == component_id]
    if not component_nodes:
        raise RuntimeError(f"graph_invalid: component {component_id} has no local feature nodes")
    nodes_by_id = {node["id"]: node for node in component_nodes}
    pattern_count_by_seed = {}
    for node in component_nodes:
        if node.get("operation") == "pattern":
            for source in node.get("inputNodeIds", []):
                pattern_count_by_seed[source] = node.get("parameters", {}).get("count")
    for node in component_nodes:
        op, params = node["operation"], node.get("parameters") or {}; inputs = [copy_workplane(results[item]) for item in node.get("inputNodeIds", []) if item in results]
        if op == "revolve": shape = revolve(params)
        elif op == "loft": shape = loft(params)
        elif op == "primitive": shape = primitive(params)
        elif op == "extrude": shape = extrude(params)
        elif op == "sweep": shape = sweep(params)
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
                source_params = {**(source.get("parameters") or {}), "cavityOpenAt": params.get("cavityOpenAt")}
                profile = [(float(point["xMm"]), float(point["zMm"])) for point in (source_params.get("profile") or [])]
                visible = [(x, z) for x, z in profile if x > 1e-6]
                visible_top = max((z for _, z in visible), default=-float("inf"))
                outer_top = max((z for _, z in profile), default=-float("inf"))
                declared_opening = params.get("cavityOpenAt")
                roofed = declared_opening == "bottom" if declared_opening in ("top", "bottom") else outer_top > visible_top + 1e-6 and any(abs(x) <= 1e-6 and abs(z - outer_top) <= 1e-6 for x, z in profile)
                if roofed:
                    cavity = inner_revolve_from_profile(source_params, thickness)
                    candidate = inputs[0].cut(cavity)
                    if candidate.val().isNull() or len(candidate.val().Solids()) != 1:
                        raise RuntimeError("graph_invalid: explicit roofed cavity cannot form one connected B-Rep")
                    shape = candidate
                else:
                    shape = axisymmetric_shell_from_profile(source_params, thickness)
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
            # A rib is not a vertical box placed at one radius.  On a tapered
            # cap or housing that approximation projects through the surface
            # near one end and erases the measured silhouette.  Build one
            # exact planar radial section from the host's declared B-Rep
            # profile, then extrude that section tangentially and pattern it.
            # The section follows only the approved host surface; it never
            # derives a replacement primitive from a component name.
            z_start = z_center - height / 2
            sample_count = max(2, min(24, int(math.ceil(height / 1.5)) + 1))
            sample_z = [z_start + height * index / (sample_count - 1) for index in range(sample_count)]
            host_radii = [radial_extent_at_z(base_node_id, z_value, nodes_by_id) for z_value in sample_z]
            if any(item is None or not math.isfinite(item) or item <= 0 for item in host_radii):
                raise RuntimeError(f"graph_invalid: rib node {node['id']} leaves its declared host surface")
            # The explicit 35% overlap is retained so the final OCCT fuse is
            # one connected solid.  Both sides of the new wire use the same
            # fitted host radii, preserving the taper as NURBS/analytic faces
            # in the host rather than creating a stack of mesh-like boxes.
            inner = [(radius_value - depth * .35, z_value) for radius_value, z_value in zip(host_radii, sample_z)]
            outer = [(radius_value + depth * .65, z_value) for radius_value, z_value in zip(host_radii, sample_z)]
            if min(point[0] for point in inner) <= 1e-6:
                raise RuntimeError(f"graph_invalid: rib node {node['id']} depth exceeds its declared host radius")
            rib_wire = outer + list(reversed(inner))
            try:
                rib = cq.Workplane("XZ").polyline(rib_wire).close().extrude(width / 2, both=True)
            except Exception as error:
                raise RuntimeError(f"graph_invalid: rib node {node['id']} cannot form a host-following section") from error
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
        # Earlier graph revisions represented a radial rib array as one
        # translated box primitive with ``count`` and an inline union against
        # its host.  That is still an explicit, measurable feature contract;
        # dropping its count produced a smooth cap even though the approved
        # graph requested 36 ribs.  Preserve the declared topology by
        # materialising the radial instances before the explicit host union.
        # New graphs emit the clearer rib -> pattern nodes above, while this
        # adapter keeps historic, user-approved revisions visually faithful.
        if op == "primitive" and legacy_boolean == "union" and inputs and params.get("count") is not None:
            shape = radial_pattern(shape, params.get("count"))
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
    # The local Z datum is the physical lower assembly plane, not an invisible
    # radial closing edge.  A revolved cap can close on the axis below its
    # exterior skirt, leaving its material bounds above zero; normalising the
    # finished child B-Rep here makes every graph component transform refer to
    # the same component-local assembly datum without applying it twice.
    bounds = shape.val().BoundingBox()
    datum_shift = -float(bounds.zmin)
    shape = shape.translate((0, 0, datum_shift)) if abs(datum_shift) > 1e-8 else shape
    shape._net30_local_datum_shift_mm = datum_shift
    return shape


def stl_axisymmetric_contour(stl, bins=64):
    """Return a bounded exterior contour from OCCT's emitted STL.

    This is a verification measurement only. The B-Rep and STEP stay the
    manufacturing source; sampling its display tessellation lets the quality
    gate detect divergence caused by a compiler operation after graph fitting.
    """
    raw = stl.read_bytes()
    if len(raw) < 84: return None
    count = struct.unpack_from("<I", raw, 80)[0]
    if 84 + count * 50 > len(raw): return None
    triangles = []
    z_min, z_max = math.inf, -math.inf
    for index in range(count):
        offset = 84 + index * 50 + 12
        triangle = [struct.unpack_from("<fff", raw, offset + delta) for delta in (0, 12, 24)]
        triangles.append(triangle)
        for _, _, z in triangle:
            z_min, z_max = min(z_min, z), max(z_max, z)
    if not triangles or z_max <= z_min: return None
    # A closed revolution can meet the axis at the exact boundary ordinate.
    # Sample the first/last section just inside the persisted B-Rep so the
    # dossier's exterior contour measures its adjacent face rather than that
    # singular topological pole.  This mirrors the JavaScript preflight path.
    span = z_max - z_min
    boundary_inset = min(span * .005, max(span / max(1, bins - 1) * .5, 1e-4))
    maxima = []
    for index in range(bins):
        nominal_z = z_min + span * index / max(1, bins - 1)
        z = min(z_max, nominal_z + boundary_inset) if index == 0 else max(z_min, nominal_z - boundary_inset) if index == bins - 1 else nominal_z
        radius = 0.0
        for triangle in triangles:
            for start, end in ((triangle[0], triangle[1]), (triangle[1], triangle[2]), (triangle[2], triangle[0])):
                low, high = min(start[2], end[2]), max(start[2], end[2])
                if z < low - 1e-7 or z > high + 1e-7: continue
                dz = end[2] - start[2]
                if abs(dz) <= 1e-9:
                    if abs(z - start[2]) <= 1e-7: radius = max(radius, math.hypot(start[0], start[1]), math.hypot(end[0], end[1]))
                    continue
                ratio = (z - start[2]) / dz
                if ratio < -1e-7 or ratio > 1 + 1e-7: continue
                x = start[0] + (end[0] - start[0]) * ratio; y = start[1] + (end[1] - start[1]) * ratio
                radius = max(radius, math.hypot(x, y))
        maxima.append(radius)
    max_radius = max(maxima)
    if max_radius <= 1e-9: return None
    return [{"zNorm": index / max(1, bins - 1), "radiusNorm": radius / max_radius} for index, radius in enumerate(maxima)]


def main():
    started = time.perf_counter(); request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    graph_component, graph_nodes = request.get("graphComponent"), request.get("graphNodes", [])
    if not graph_component or graph_component.get("representation") != "brep_solid": raise SystemExit("not_brep_component: component does not define a B-Rep solid")
    print("CAD_PHASE=compile", flush=True); shape = compile_graph(graph_component, graph_nodes)
    local_datum_shift = float(getattr(shape, "_net30_local_datum_shift_mm", 0))
    print("CAD_PHASE=validate", flush=True); solid = shape.val()
    if not solid.isValid(): raise RuntimeError("brep_invalid: OpenCascade validity check failed")
    paths = request.get("paths") or {"step": request["output"]}; step = pathlib.Path(paths["step"]); step.parent.mkdir(parents=True, exist_ok=True)
    brep = pathlib.Path(paths.get("brep", step.with_suffix(".brep"))); stl = pathlib.Path(paths.get("stl", step.with_suffix(".stl"))); report = pathlib.Path(paths.get("report", step.with_suffix(".validation.json")))
    print("CAD_PHASE=brep", flush=True); solid.exportBrep(str(brep))
    # The B-Rep file is the manufacturing source of truth.  Some OCCT curve
    # wrappers expose a conservative in-memory BoundingBox until they are
    # serialised, while the stored shape has the exact declared pole bounds.
    # Validate and report the persisted canonical B-Rep, not that transient
    # wrapper, so a quality gate cannot reject or accept a different shape
    # from the one exported as STEP/GLB source.
    persisted = cq.importers.importBrep(str(brep)).val()
    if not persisted.isValid(): raise RuntimeError("brep_invalid: persisted OpenCascade B-Rep validity check failed")
    canonical = cq.Workplane(obj=persisted)
    # Snapshot the canonical B-Rep dimensions before the STEP writer runs.
    # OCCT's transfer layer may mutate a wrapper's cached bounding box while
    # it prepares the export; the on-disk B-Rep remains unchanged.
    box = canonical.val().BoundingBox()
    source_bounds = {"x": float(box.xlen), "y": float(box.ylen), "z": float(box.zlen)}
    # STEP and the display tessellation must derive from this reloaded B-Rep,
    # never from the pre-healing transient shape.  Record the actual STEP
    # round-trip per child so a visually plausible GLB cannot be mistaken for
    # a releaseable manufacturing part.
    print("CAD_PHASE=step", flush=True); cq.exporters.export(canonical, str(step)); step_shape = cq.importers.importStep(str(step)).val()
    if not step_shape.isValid(): raise RuntimeError("step_roundtrip_invalid: exported STEP cannot be imported as a valid OCCT shape")
    tolerance = float(request.get("tessellation", {}).get("chordMm", .05)); angular = math.radians(float(request.get("tessellation", {}).get("angularDeg", 7)))
    print("CAD_PHASE=tessellate", flush=True); cq.exporters.export(canonical, str(stl), tolerance=tolerance, angularTolerance=angular)
    shells = persisted.Shells(); closed = bool(shells) and all(item.Closed() for item in shells)
    # CadQuery's Shape wrapper can report a conservative box for a persisted
    # compound. Query the canonical workplane value instead; it is the same
    # B-Rep exported as STEP/STL and therefore the only valid manufacturing
    # datum for this report.
    step_box = step_shape.BoundingBox()
    step_bounds = {"x": float(step_box.xlen), "y": float(step_box.ylen), "z": float(step_box.zlen)}
    step_shells = step_shape.Shells()
    bounds_delta = {axis: abs(source_bounds[axis] - step_bounds[axis]) for axis in source_bounds}
    volume_delta = abs(persisted.Volume() - step_shape.Volume()) / max(abs(persisted.Volume()), 1e-9)
    step_closed = bool(step_shells) and all(item.Closed() for item in step_shells)
    step_round_trip = {"valid": step_shape.isValid(), "closed": step_closed, "solidCount": len(step_shape.Solids()), "boundsDeltaMm": bounds_delta, "volumeDeltaRatio": volume_delta, "withinTolerance": step_closed and len(step_shape.Solids()) == 1 and max(bounds_delta.values(), default=0) <= .01 and volume_delta <= .001}
    payload = {"valid": True, "closed": closed, "solidCount": len(persisted.Solids()), "shellCount": len(shells), "volumeMm3": persisted.Volume(), "surfaceAreaMm2": persisted.Area(), "boundsMm": source_bounds, "localDatumShiftMm": local_datum_shift, "stepRoundTrip": step_round_trip, "silhouette": stl_axisymmetric_contour(stl), "tessellation": {"chordMm": tolerance, "angularDeg": math.degrees(angular)}, "elapsedMs": round((time.perf_counter() - started) * 1000, 3), "outputs": {"brep": brep.name, "step": step.name, "stl": stl.name}}
    report.write_text(json.dumps(payload, indent=2) + "\n")
    if not closed or payload["solidCount"] != 1:
        raise RuntimeError(f"brep_preflight_failed: closed={closed}, solidCount={payload['solidCount']}")


if __name__ == "__main__": main()
