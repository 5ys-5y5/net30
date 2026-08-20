"""Headless Blender worker for NET30's runtime vitamin-bottle assets."""
import json
import pathlib
import sys
import traceback

import bpy


def request_path():
    if "--" not in sys.argv:
        raise RuntimeError("request JSON path is required after --")
    values = sys.argv[sys.argv.index("--") + 1 :]
    if len(values) != 1:
        raise RuntimeError("usage: blender-worker.py -- <request.json>")
    return pathlib.Path(values[0])


def collection(name):
    current = bpy.data.collections.get(name)
    if current:
        return current
    current = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(current)
    return current


def move_to(obj, target):
    for source in list(obj.users_collection):
        source.objects.unlink(obj)
    target.objects.link(obj)


def material(name, color, metallic=0.0, roughness=0.4, transmission=0.0):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.use_nodes = True
    principled = value.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = (*color, 1.0)
    principled.inputs["Roughness"].default_value = roughness
    principled.inputs["Metallic"].default_value = metallic
    if "Transmission Weight" in principled.inputs:
        principled.inputs["Transmission Weight"].default_value = transmission
    return value


def add_cylinder(name, radius, depth, z, target, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    move_to(obj, target)
    if bevel:
        modifier = obj.modifiers.new("Soft edge", "BEVEL")
        modifier.width = bevel
        modifier.segments = 4
    obj.data.materials.append(mat)
    return obj


def export_collection(name, destination):
    try:
        import addon_utils
        addon_utils.enable("io_scene_gltf2", default_set=False, persistent=False)
    except Exception as error:
        raise RuntimeError(f"glTF exporter를 활성화할 수 없습니다: {error}") from error
    target = bpy.data.collections.get(name)
    if target is None:
        raise RuntimeError(f"Missing collection: {name}")
    bpy.ops.object.select_all(action="DESELECT")
    meshes = [obj for obj in target.all_objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh in {name}")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(destination), export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_cameras=False, export_lights=False,
    )


def setting(values, modern, legacy, default):
    return float(values.get(modern) or values.get(legacy) or default)


def cap_color(prompt, tone):
    source = f"{prompt} {tone}".lower()
    if "red" in source or "빨" in source:
        return (0.72, 0.06, 0.08)
    if "green" in source or "초록" in source:
        return (0.06, 0.38, 0.18)
    if "black" in source or "검정" in source:
        return (0.025, 0.03, 0.05)
    return (0.08, 0.22, 0.72)


def build_scene(payload):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        if col.name != "Collection":
            bpy.data.collections.remove(col)

    render = collection("RENDER_EXPORT")
    physics = collection("PHYSICS_EXPORT")
    vitamins = collection("VITAMIN_LIBRARY")
    collection("QA")
    settings = payload["settings"]
    prompt = payload["prompt"]
    width = setting(settings, "sizeXmm", "widthMm", 54) / 1000
    depth = setting(settings, "sizeYmm", "depthMm", 54) / 1000
    height = setting(settings, "sizeZmm", "heightMm", 116) / 1000
    thickness = setting(settings, "shellThicknessMm", "thicknessMm", 2.4) / 1000
    radius = max(width, depth) / 2
    cap_height = max(height * 0.16, 0.012)

    glass = material("Bottle glass", (0.74, 0.88, 0.98), roughness=0.18, transmission=0.22)
    cap = material("Cap", cap_color(prompt, settings.get("tone", settings.get("color", "blue"))), roughness=0.28)
    label = material("Label", (0.96, 0.95, 0.89), roughness=0.62)
    vitamin = material("Vitamin", (0.94, 0.56, 0.12), roughness=0.35)
    collider = material("Collider", (0.1, 0.1, 0.1), roughness=0.9)

    # Keep runtime semantic names stable: the browser uses them to apply its
    # glass/cap treatment even after a Blender-generated asset replaces seed GLB.
    body = add_cylinder("BottleGlass", radius, height, height / 2, render, glass, min(thickness * 1.5, radius * 0.15))
    body["net30_prompt"] = prompt
    add_cylinder("BottleNeck", radius * 0.72, height * 0.12, height * 1.02, render, glass, min(thickness, radius * 0.1))
    add_cylinder("CapBluePP", radius * 0.81, cap_height, height * 1.02 + cap_height / 2, render, cap, min(thickness, radius * 0.08))
    label_obj = add_cylinder("FrontLabel", radius * 1.012, height * 0.36, height * 0.48, render, label, 0.001)
    label_obj.scale.x = 1.002

    add_cylinder("Bottle collider", max(radius - thickness, 0.001), max(height - thickness, 0.001), height / 2, physics, collider)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0, 0, height * 0.42))
    pill = bpy.context.object
    pill.name = "Capsule prototype"
    pill.scale = (radius * 0.30, radius * 0.30, height * 0.08)
    move_to(pill, vitamins)
    pill.data.materials.append(vitamin)


def main():
    source = request_path()
    request = json.loads(source.read_text(encoding="utf-8"))
    paths = request["paths"]
    build_scene(request["payload"])
    blend_file = pathlib.Path(paths["blendFile"])
    blend_file.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_file))
    export_collection("RENDER_EXPORT", pathlib.Path(paths["renderGlb"]))
    export_collection("PHYSICS_EXPORT", pathlib.Path(paths["physicsGlb"]))
    export_collection("VITAMIN_LIBRARY", pathlib.Path(paths["vitaminGlb"]))
    export_collection("RENDER_EXPORT", pathlib.Path(paths["publishedGlb"]))
    print(f"PUBLISHED_GLB={paths['publishedGlb']}")


try:
    main()
except Exception:
    traceback.print_exc()
    sys.exit(1)
