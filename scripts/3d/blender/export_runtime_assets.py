import bpy
import pathlib
import sys

def parse_arguments():
    if "--" not in sys.argv:
        raise RuntimeError("render/physics/vitamin export paths are required")
    args = sys.argv[sys.argv.index("--") + 1 :]
    if len(args) != 3:
        raise RuntimeError("usage: export_runtime_assets.py -- <render.glb> <physics.glb> <vitamin.glb>")
    return pathlib.Path(args[0]), pathlib.Path(args[1]), pathlib.Path(args[2])

def export_collection(name, filepath):
    collection = bpy.data.collections.get(name)
    if collection is None:
        raise RuntimeError(f"Missing collection: {name}")
    bpy.ops.object.select_all(action="DESELECT")
    selected = []
    for obj in collection.all_objects:
        if obj.type in {"MESH", "EMPTY"}:
            obj.select_set(True)
            selected.append(obj)
    if not selected:
        raise RuntimeError(f"No exportable objects in {name}")
    mesh_objects = [obj for obj in selected if obj.type == "MESH"]
    if mesh_objects:
        bpy.context.view_layer.objects.active = mesh_objects[0]
    filepath.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(filepath), export_format="GLB", use_selection=True, export_yup=True, export_apply=True, export_cameras=False, export_lights=False)

render_path, physics_path, vitamin_path = parse_arguments()
export_collection("RENDER_EXPORT", render_path)
export_collection("PHYSICS_EXPORT", physics_path)
export_collection("VITAMIN_LIBRARY", vitamin_path)
print(f"RENDER_GLB={render_path}")
print(f"PHYSICS_GLB={physics_path}")
print(f"VITAMIN_GLB={vitamin_path}")
