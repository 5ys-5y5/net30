import bpy
import pathlib
import sys

def parse_arguments():
    if "--" not in sys.argv:
        raise RuntimeError(
            "render GLB와 physics GLB 출력 경로가 필요합니다."
        )

    args = sys.argv[sys.argv.index("--") + 1 :]

    if len(args) != 2:
        raise RuntimeError(
            "사용법: export_runtime_assets.py -- "
            "<render.glb> <physics.glb>"
        )

    return pathlib.Path(args[0]), pathlib.Path(args[1])

def collection_objects(name):
    collection = bpy.data.collections.get(name)

    if collection is None:
        raise RuntimeError(
            f"필수 Collection이 없습니다: {name}"
        )

    objects = [
        obj
        for obj in collection.all_objects
        if obj.type in {"MESH", "EMPTY"}
    ]

    if not objects:
        raise RuntimeError(
            f"Collection에 export할 객체가 없습니다: {name}"
        )

    return objects

def export_collection(name, filepath):
    filepath.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="DESELECT")

    objects = collection_objects(name)

    for obj in objects:
        obj.select_set(True)

    mesh_objects = [
        obj for obj in objects if obj.type == "MESH"
    ]

    if mesh_objects:
        bpy.context.view_layer.objects.active = mesh_objects[0]

    bpy.ops.export_scene.gltf(
        filepath=str(filepath),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_cameras=False,
        export_lights=False,
    )

    bpy.ops.object.select_all(action="DESELECT")

render_path, physics_path = parse_arguments()

export_collection("RENDER_EXPORT", render_path)
export_collection("PHYSICS_EXPORT", physics_path)

print(f"RENDER_GLB={render_path}")
print(f"PHYSICS_GLB={physics_path}")
