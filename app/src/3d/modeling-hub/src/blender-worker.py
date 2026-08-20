"""Compile only validated NET30 v2 component DSL into job-scoped GLB files."""
import json, math, pathlib, sys, traceback
import bpy

MM = .001
def request_path():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 1: raise RuntimeError("usage: blender-worker.py -- <request.json>")
    return pathlib.Path(values[0])
def clear():
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections): bpy.data.collections.remove(collection)
def col(name):
    value = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(value); return value
def link(obj, target):
    for source in list(obj.users_collection): source.objects.unlink(obj)
    target.objects.link(obj)
def rgb(value):
    value = value.lstrip("#"); return tuple(int(value[i:i+2], 16) / 255 for i in (0,2,4))
def mat(name, spec):
    value = bpy.data.materials.new(name); value.use_nodes = True; p = value.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*rgb(spec["color"]), 1); p.inputs["Roughness"].default_value = spec["roughness"]
    if "Transmission Weight" in p.inputs: p.inputs["Transmission Weight"].default_value = spec["transmission"]
    if spec["transmission"]: p.inputs["IOR"].default_value = 1.52
    return value
def smooth(obj, bevel=.0003):
    if obj.type != "MESH": return
    for face in obj.data.polygons: face.use_smooth=True
    if bevel:
        modifier=obj.modifiers.new("Manufacturing edge radius", "BEVEL"); modifier.width=bevel; modifier.segments=3
def lathe(name, profile, radius, height, target, material, wall=0, cap_ends=False):
    rings=128; vertices=[]; faces=[]
    for point in profile:
        z=point["zRatio"]*height; r=max(.0003, point["radiusRatio"]*radius)
        for i in range(rings):
            a=math.tau*i/rings; vertices.append((r*math.cos(a), r*math.sin(a), z))
    for j in range(len(profile)-1):
        for i in range(rings):
            n=(i+1)%rings; faces.append((j*rings+i,j*rings+n,(j+1)*rings+n,(j+1)*rings+i))
    if cap_ends:
        vertices.extend([(0,0,0),(0,0,height)]); b=len(vertices)-2; t=b+1
        for i in range(rings):
            n=(i+1)%rings; faces.extend([(b,n,i),(t,(len(profile)-1)*rings+i,(len(profile)-1)*rings+n)])
    mesh=bpy.data.meshes.new(name+"Mesh"); mesh.from_pydata(vertices,[],faces); mesh.update()
    obj=bpy.data.objects.new(name,mesh); target.objects.link(obj); obj.data.materials.append(material); smooth(obj)
    if wall:
        solidify=obj.modifiers.new("True visual wall", "SOLIDIFY"); solidify.thickness=-wall; solidify.offset=-1; solidify.use_even_offset=True
    return obj
def cylinder(name, radius, height, z, target, material):
    bpy.ops.mesh.primitive_cylinder_add(vertices=128,radius=radius,depth=height,location=(0,0,z+height/2)); obj=bpy.context.object; obj.name=name; link(obj,target); obj.data.materials.append(material); smooth(obj); return obj
def cap_ribs(radius,height,z,count,depth,target,material):
    for i in range(count):
        a=math.tau*i/count; bpy.ops.mesh.primitive_cube_add(location=((radius+depth*.45)*math.cos(a),(radius+depth*.45)*math.sin(a),z+height*.52)); obj=bpy.context.object; obj.name=f"CapRib_{i+1:02d}"; obj.dimensions=(depth,depth*2.2,height*.84); obj.rotation_euler[2]=a; link(obj,target); obj.data.materials.append(material); smooth(obj,.00012)
def decal(component,radius,target,material):
    band=component["features"]["labelBand"]
    if not band: return
    segments=48; sweep=math.radians(band["sweepDegrees"]); z=band["zMm"]*MM; h=band["heightMm"]*MM; r=radius+.00015; vs=[]; fs=[]
    for j in range(2):
        for i in range(segments+1):
            a=-sweep/2+sweep*i/segments; vs.append((r*math.sin(a),-r*math.cos(a),z+j*h))
    for i in range(segments): fs.append((i,i+1,segments+2+i,segments+1+i))
    mesh=bpy.data.meshes.new(component["component"]+"DecalMesh"); mesh.from_pydata(vs,[],fs); mesh.update(); obj=bpy.data.objects.new(component["component"].title()+"Decal",mesh); target.objects.link(obj); obj.data.materials.append(material)
    obj["net30_label_text"]=component["features"]["labelText"]; obj["net30_material_role"]="printed-decal"
def build_component(component, contract, target):
    d=contract["dimensionsMm"]; kind=component["component"]; material=mat(kind+"Material",component["material"])
    radius=max(d["widthMm"],d["depthMm"])*MM/2; height=d["heightMm"]*MM; wall=d["wallMm"]*MM
    if kind=="bottle":
        obj=lathe("BottleGlass",component["profile"],radius,height,target,material,wall); obj["net30_component"]="bottle"
        # Visible neck rings separated from the wall rather than a painted cylinder.
        for i in range(component["features"]["neckRings"]): cylinder(f"NeckRing_{i+1}",radius*.665+(i*.0001),.0012,height*.82+i*.0022,target,material)
    elif kind=="cap":
        h=25*MM if height>.03 else height*.24; z=height-h; obj=lathe("CapClosure",component["profile"],radius*.965,h,target,material,0,True); obj.location.z=z; obj["net30_component"]="cap"; cap_ribs(radius*.965,h,z,component["features"]["ribCount"],component["features"]["ribDepthMm"]*MM,target,material)
    elif kind=="pouringRing":
        h=.007; cylinder("PouringRing",radius*.67,h,height-.032,target,material)
    elif kind.startswith("decoration"):
        decal(component,radius,target,material)
    elif kind=="liner": cylinder("ClosureLiner",radius*.59,.0016,height-.028,target,material)
    elif kind=="contents":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(0,0,height*.38)); obj=bpy.context.object; obj.name="SelectedContents"; obj.scale=(radius*.24,radius*.24,height*.06); link(obj,target); obj.data.materials.append(material); smooth(obj)
def export(objects,destination):
    import addon_utils; addon_utils.enable("io_scene_gltf2",default_set=False,persistent=False)
    bpy.ops.object.select_all(action="DESELECT")
    meshes=[obj for obj in objects if obj.type=="MESH"]
    if not meshes: return False
    for obj in meshes: obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]; destination.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(destination),export_format="GLB",use_selection=True,export_yup=True,export_apply=True,export_materials="EXPORT",export_cameras=False,export_lights=False)
    return True
def assemble_library(request):
    clear(); assembly=col("LIBRARY_ASSEMBLY")
    for item in request["components"]:
        source=pathlib.Path(item["sourcePath"])
        if not source.is_file(): raise RuntimeError(f"Missing component GLB: {source}")
        before=set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(source))
        imported=[obj for obj in bpy.data.objects if obj not in before and obj.type=="MESH"]
        if not imported: raise RuntimeError(f"No mesh imported from {source}")
        for obj in imported:
            obj.name=f"{item['component']}_{obj.name}"; obj["net30_component"]=item["component"]; link(obj,assembly)
    destination=pathlib.Path(request["paths"]["assemblyGlb"])
    if not export(list(assembly.all_objects),destination): raise RuntimeError("No selected component mesh could be assembled")
    print("ASSEMBLY_GLB="+str(destination))
def main():
    request=json.loads(request_path().read_text())
    if request.get("mode")=="assemble-library": return assemble_library(request)
    paths=request["paths"]; clear(); assembly=col("ASSEMBLY")
    for component in request["spec"]["components"]:
        part=col("PART_"+component["component"]); build_component(component,request["spec"]["contract"],part)
        export(list(part.all_objects),pathlib.Path(paths["componentDir"])/(component["component"]+".glb"))
        for obj in list(part.objects): link(obj,assembly)
    if not export(list(assembly.all_objects),pathlib.Path(paths["assemblyGlb"])): raise RuntimeError("No selected component created a mesh")
    print("ASSEMBLY_GLB="+paths["assemblyGlb"])
try: main()
except Exception: traceback.print_exc(); sys.exit(1)
