"""Compile a validated NET30 ModelingSpec into portable GLB assets in headless Blender."""
import json
import math
import pathlib
import sys
import traceback

import bpy


def request_path():
    if "--" not in sys.argv:
        raise RuntimeError("request JSON path is required after --")
    values = sys.argv[sys.argv.index("--") + 1:]
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


def hex_color(value):
    value = value.lstrip("#")
    return tuple(int(value[index:index + 2], 16) / 255 for index in (0, 2, 4))


def material(name, color, metallic=0.0, roughness=0.4, transmission=0.0):
    value = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    value.use_nodes = True
    node = value.node_tree.nodes.get("Principled BSDF")
    node.inputs["Base Color"].default_value = (*color, 1.0)
    node.inputs["Roughness"].default_value = roughness
    node.inputs["Metallic"].default_value = metallic
    if "Transmission Weight" in node.inputs:
        node.inputs["Transmission Weight"].default_value = transmission
    if "IOR" in node.inputs:
        node.inputs["IOR"].default_value = 1.52 if transmission else 1.45
    return value


def smooth(obj, bevel=0.00065):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    modifier = obj.modifiers.new("Soft manufacturing edges", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3


def add_lathed(name, profile, target, mat, wall):
    segments = 96
    vertices, faces = [], []
    for z, radius in profile:
        for index in range(segments):
            angle = (index / segments) * math.tau
            vertices.append((radius * math.cos(angle), radius * math.sin(angle), z))
    for ring in range(len(profile) - 1):
        for index in range(segments):
            nxt = (index + 1) % segments
            faces.append((ring * segments + index, ring * segments + nxt, (ring + 1) * segments + nxt, (ring + 1) * segments + index))
    mesh = bpy.data.meshes.new(f"{name}Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    target.objects.link(obj)
    obj.data.materials.append(mat)
    smooth(obj)
    solidify = obj.modifiers.new("Physical wall", "SOLIDIFY")
    solidify.thickness = wall
    solidify.offset = -1
    solidify.use_even_offset = True
    return obj


def add_cylinder(name, radius, depth, z, target, mat, bevel=0.0008):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    move_to(obj, target)
    obj.data.materials.append(mat)
    if bevel:
        smooth(obj, bevel)
    return obj


def add_label(radius, z, height, target, mat, label_text):
    label = add_cylinder("FrontLabel", radius + 0.00055, height, z, target, mat, 0.00025)
    label["net30_label_text"] = label_text
    label["net30_material_role"] = "label"
    return label


def add_cap_ribs(radius, z, cap_height, target, mat):
    for index in range(32):
        angle = math.tau * index / 32
        bpy.ops.mesh.primitive_cube_add(location=((radius + 0.00045) * math.cos(angle), (radius + 0.00045) * math.sin(angle), z))
        rib = bpy.context.object
        rib.name = f"CapRib{index + 1:02d}"
        rib.dimensions = (0.0014, 0.0031, cap_height * 0.80)
        rib.rotation_euler[2] = angle
        move_to(rib, target)
        rib.data.materials.append(mat)
        smooth(rib, 0.00022)


def export_collection(name, destination):
    import addon_utils
    addon_utils.enable("io_scene_gltf2", default_set=False, persistent=False)
    target = bpy.data.collections.get(name)
    meshes = [obj for obj in target.all_objects if obj.type == "MESH"] if target else []
    if not meshes:
        raise RuntimeError(f"No mesh in {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_materials="EXPORT", export_cameras=False, export_lights=False)


def build_scene(payload, spec):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for col in list(bpy.data.collections):
        if col.name != "Collection":
            bpy.data.collections.remove(col)
    render, physics, vitamins = collection("RENDER_EXPORT"), collection("PHYSICS_EXPORT"), collection("VITAMIN_LIBRARY")
    dimensions, parts, materials = spec["dimensionsMm"], spec["parts"], spec["materials"]
    width, depth, height, wall = dimensions["width"] / 1000, dimensions["depth"] / 1000, dimensions["height"] / 1000, dimensions["wall"] / 1000
    radius = max(width, depth) / 2
    if spec["silhouette"] == "short-wide": radius *= 1.12
    if spec["silhouette"] == "tall-slim": radius *= 0.84
    shoulder_radius = radius * (0.87 if parts["shoulder"] == "rounded" else 0.94)
    neck_radius, neck_height = radius * parts["neckRatio"], max(height * 0.12, 0.012)
    cap_height, body_top = max(height * parts["capRatio"], 0.011), height * 0.82
    glass = material("BottleGlassMaterial", hex_color(materials["bodyColor"]), roughness=0.12 if "gloss" in materials["finish"].lower() else 0.24, transmission=0.62 if materials["body"] == "glass" else 0.0)
    cap = material("CapMaterial", hex_color(materials["capColor"]), metallic=0.65 if materials["cap"] == "metal" else 0.0, roughness=0.26)
    label = material("LabelMaterial", hex_color(materials["labelColor"]), roughness=0.48)
    collider = material("ColliderMaterial", (0.1, 0.1, 0.1), roughness=0.9)
    vitamin = material("VitaminMaterial", (0.94, 0.56, 0.12), roughness=0.35)
    profile = [(0.0, radius * 0.84), (height * 0.025, radius), (body_top * 0.82, radius), (body_top * 0.93, shoulder_radius), (body_top, neck_radius), (height - cap_height - neck_height * 0.25, neck_radius)]
    body = add_lathed("BottleGlass", profile, render, glass, min(wall, radius * 0.22))
    body["net30_prompt"] = payload["prompt"]
    body["net30_spec_version"] = spec["version"]
    add_cylinder("BottleNeck", neck_radius, neck_height, height - cap_height - neck_height / 2, render, glass)
    cap_center = height - cap_height / 2
    add_cylinder("CapClosure", neck_radius * 1.15, cap_height, cap_center, render, cap)
    if parts["ribbedCap"] or spec["silhouette"] == "ribbed":
        add_cap_ribs(neck_radius * 1.15, cap_center, cap_height, render, cap)
    add_label(radius, height * 0.47, height * parts["labelRatio"], render, label, parts["labelText"])
    add_cylinder("BottleCollider", max(radius - wall, 0.001), max(height - cap_height - wall, 0.001), (height - cap_height) / 2, physics, collider, 0)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=(0, 0, height * 0.42))
    pill = bpy.context.object
    pill.name = "CapsulePrototype"
    pill.scale = (radius * 0.30, radius * 0.30, height * 0.08)
    move_to(pill, vitamins)
    pill.data.materials.append(vitamin)


def main():
    request = json.loads(request_path().read_text(encoding="utf-8"))
    paths = request["paths"]
    build_scene(request["payload"], request["spec"])
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
