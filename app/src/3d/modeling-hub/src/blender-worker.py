"""Compile only validated NET30 v2 component DSL into job-scoped GLB files."""
import base64, json, math, pathlib, sys, traceback
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
def sticker_slot(name, source_id, radius, height, target, values):
    width=float(values.get("physicalWidthMm",38))*MM; h=float(values.get("physicalHeightMm",52))*MM; sweep=math.radians(float(values.get("wrapDegrees",105))); z=(height-h)/2; offset=float(values.get("surfaceOffsetMm",.15))*MM
    segments=48; vs=[]; fs=[]
    for j in range(2):
        for i in range(segments+1):
            a=-sweep/2+sweep*i/segments; vs.append(((radius+offset)*math.sin(a),-(radius+offset)*math.cos(a),z+j*h))
    for i in range(segments): fs.append((i,i+1,segments+2+i,segments+1+i))
    mesh=bpy.data.meshes.new(name+"Mesh"); mesh.from_pydata(vs,[],fs); mesh.update(); obj=bpy.data.objects.new(name,mesh); target.objects.link(obj)
    material=bpy.data.materials.new(name+"Material"); material.use_nodes=True; material.node_tree.nodes.get("Principled BSDF").inputs["Alpha"].default_value=0
    if hasattr(material, "surface_render_method"): material.surface_render_method='DITHERED'
    elif hasattr(material, "blend_method"): material.blend_method='BLEND'
    obj.data.materials.append(material)
    obj["net30_sticker_slot"]={"sourceGraphicId":source_id,"physicalWidthMm":width/MM,"physicalHeightMm":h/MM,"wrapDegrees":math.degrees(sweep),"surfaceOffsetMm":offset/MM}; return obj
def graph_material(name, spec):
    return mat(name,{"color":spec["baseColor"],"roughness":spec["roughness"],"transmission":spec["transmission"]})
def absolute_lathe(name, points, target, material, wall=0):
    if len(points)<2: raise RuntimeError(f"{name}: revolve profile needs at least two points")
    rings=128; vertices=[]; faces=[]
    for point in points:
        r=max(.0001,float(point["xMm"])*MM); z=float(point["zMm"])*MM
        for i in range(rings):
            a=math.tau*i/rings; vertices.append((r*math.cos(a),r*math.sin(a),z))
    for j in range(len(points)-1):
        for i in range(rings):
            n=(i+1)%rings; faces.append((j*rings+i,j*rings+n,(j+1)*rings+n,(j+1)*rings+i))
    mesh=bpy.data.meshes.new(name+"Mesh"); mesh.from_pydata(vertices,[],faces); mesh.update(); obj=bpy.data.objects.new(name,mesh); target.objects.link(obj); obj.data.materials.append(material); smooth(obj)
    if wall:
        modifier=obj.modifiers.new("Approved graph wall","SOLIDIFY"); modifier.thickness=-float(wall)*MM; modifier.offset=-1; modifier.use_even_offset=True
    return obj
def graph_texture_material(name, spec, image_input, job_dir):
    material=graph_material(name,spec)
    if not image_input: return material
    data_url=image_input.get("dataUrl",""); encoded=data_url.split(",",1)[1] if "," in data_url else ""
    if not encoded: return material
    suffix=pathlib.Path(image_input.get("filename","artwork.png")).suffix or ".png"; image_path=pathlib.Path(job_dir)/("artwork-"+str(image_input.get("id","input"))+suffix)
    image_path.write_bytes(base64.b64decode(encoded)); image=bpy.data.images.load(str(image_path),check_existing=True)
    nodes=material.node_tree.nodes; links=material.node_tree.links; texture=nodes.new("ShaderNodeTexImage"); texture.image=image; bsdf=nodes.get("Principled BSDF"); links.new(texture.outputs["Color"],bsdf.inputs["Base Color"])
    if "Alpha" in texture.outputs and "Alpha" in bsdf.inputs:
        links.new(texture.outputs["Alpha"],bsdf.inputs["Alpha"])
        if hasattr(material, "surface_render_method"): material.surface_render_method='DITHERED'
        elif hasattr(material, "blend_method"): material.blend_method='BLEND'
    return material
def graph_decal(name, params, radius, height, target, material):
    crop=params.get("artworkCrop") or {"x":0,"y":0,"width":1,"height":1}; sweep=math.radians(float(params.get("wrapDegrees") or 118)); h=max(.001,float(crop.get("height",.3))*height); z=max(0,(1-float(crop.get("y",.4))-float(crop.get("height",.3)))*height); r=radius+float(params.get("offsetMm") or .15)*MM
    segments=64; vs=[]; fs=[]
    for j in range(2):
        for i in range(segments+1):
            a=-sweep/2+sweep*i/segments; vs.append((r*math.sin(a),-r*math.cos(a),z+j*h))
    for i in range(segments): fs.append((i,i+1,segments+2+i,segments+1+i))
    mesh=bpy.data.meshes.new(name+"Mesh"); mesh.from_pydata(vs,[],fs); mesh.update(); uv=mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        for loop_index in polygon.loop_indices:
            vertex_index=mesh.loops[loop_index].vertex_index; row=1 if vertex_index>=segments+1 else 0; column=vertex_index%(segments+1); uv.data[loop_index].uv=(float(crop.get("x",0))+float(crop.get("width",1))*column/segments,float(crop.get("y",0))+float(crop.get("height",1))*row)
    obj=bpy.data.objects.new(name,mesh); target.objects.link(obj); obj.data.materials.append(material); obj["net30_component_kind"]="dynamic-surface-decal"; obj["net30_artwork_image_id"]=params.get("artworkImageId") or ""; return obj
def apply_graph_transform(objects, value):
    translation=value.get("translationMm",{}); rotation=value.get("rotationDeg",{}); scale=value.get("scale",{})
    for obj in objects:
        obj.location.x+=float(translation.get("x",0))*MM; obj.location.y+=float(translation.get("y",0))*MM; obj.location.z+=float(translation.get("z",0))*MM
        obj.rotation_euler.x+=math.radians(float(rotation.get("x",0))); obj.rotation_euler.y+=math.radians(float(rotation.get("y",0))); obj.rotation_euler.z+=math.radians(float(rotation.get("z",0)))
        obj.scale.x*=float(scale.get("x",1)); obj.scale.y*=float(scale.get("y",1)); obj.scale.z*=float(scale.get("z",1))
def build_graph_component(component, nodes, contract, image_inputs, job_dir, target):
    before=set(target.objects); base_material=graph_material(component["id"]+"Material",component["material"]); d=contract["dimensionsMm"]; radius=max(d["widthMm"],d["depthMm"])*MM/2; height=d["heightMm"]*MM
    for node in nodes:
        params=node["parameters"]; op=node["operation"]
        if op=="revolve":
            obj=absolute_lathe(component["requestedName"],params.get("profile") or [],target,base_material,params.get("thicknessMm") or 0)
            if params.get("count") and params.get("depthMm"): cap_ribs(max(point["xMm"] for point in params.get("profile") or [{"xMm":d["widthMm"]/2}])*MM,max(point["zMm"] for point in params.get("profile") or [{"zMm":d["heightMm"]}])*MM,0,int(params["count"]),float(params["depthMm"])*MM,target,base_material)
        elif op in ["extrude","primitive"]:
            dimensions=params.get("dimensionsMm") or {"x":params.get("radiusMm",10)*2,"y":params.get("radiusMm",10)*2,"z":params.get("heightMm",10)}; primitive=params.get("primitive") or "cylinder"
            if params.get("innerRadiusMm"):
                major=(float(params.get("radiusMm") or dimensions["x"]/2)+float(params["innerRadiusMm"]))/2*MM; minor=max(.0002,(float(params.get("radiusMm") or dimensions["x"]/2)-float(params["innerRadiusMm"]))/2*MM); bpy.ops.mesh.primitive_torus_add(major_radius=major,minor_radius=minor,major_segments=128,minor_segments=24); obj=bpy.context.object; obj.scale.z=max(.15,float(dimensions["z"])*MM/(minor*2)); link(obj,target); obj.data.materials.append(base_material)
            elif primitive=="box": bpy.ops.mesh.primitive_cube_add(); obj=bpy.context.object; obj.dimensions=(float(dimensions["x"])*MM,float(dimensions["y"])*MM,float(dimensions["z"])*MM); link(obj,target); obj.data.materials.append(base_material)
            elif primitive=="sphere": bpy.ops.mesh.primitive_uv_sphere_add(segments=48,ring_count=24); obj=bpy.context.object; obj.scale=(float(dimensions["x"])*MM/2,float(dimensions["y"])*MM/2,float(dimensions["z"])*MM/2); link(obj,target); obj.data.materials.append(base_material)
            else: cylinder(component["requestedName"],float(params.get("radiusMm") or dimensions["x"]/2)*MM,float(params.get("heightMm") or dimensions["z"])*MM,0,target,base_material)
        elif op=="surface_decal":
            image=next((item for item in image_inputs if item.get("id")==params.get("artworkImageId")),None); decal_material=graph_texture_material(component["id"]+"Artwork",component["material"],image,job_dir); graph_decal(component["requestedName"],params,radius,height,target,decal_material)
        elif op in ["instance_distribution","volume"]:
            dimensions=params.get("dimensionsMm") or {"x":8,"y":8,"z":16}; quantity=min(120,int(params.get("quantity") or 1))
            for index in range(quantity):
                angle=math.tau*index/max(1,quantity); radial=radius*.45*((index%7)+1)/7; z=height*(.15+.65*((index*37)%101)/100); bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=(radial*math.cos(angle),radial*math.sin(angle),z)); obj=bpy.context.object; obj.scale=(float(dimensions["x"])*MM/2,float(dimensions["y"])*MM/2,float(dimensions["z"])*MM/2); link(obj,target); obj.data.materials.append(base_material)
    created=[obj for obj in target.objects if obj not in before]; apply_graph_transform(created,component["transform"])
def build_component(component, contract, target):
    d=contract["dimensionsMm"]; kind=component["component"]; material=mat(kind+"Material",component["material"])
    features=component["features"]; radius=max(d["widthMm"],d["depthMm"])*MM/2; height=d["heightMm"]*MM; wall=float(features.get("wallMm",d["wallMm"]))*MM
    if kind=="bottle":
        obj=lathe("BottleGlass",component["profile"],radius,height,target,material,wall); obj["net30_component"]="bottle"
        # Visible neck rings separated from the wall rather than a painted cylinder.
        for i in range(features["neckRings"]): cylinder(f"NeckRing_{i+1}",radius*.665+(i*.0001),.0012,height*.82+i*.0022,target,material)
    elif kind=="cap":
        h=float(features.get("heightMm",25))*MM; cap_radius=float(features.get("outerDiameterMm",d["widthMm"]*.965))*MM/2; z=0; obj=lathe("CapClosure",component["profile"],cap_radius,h,target,material,0,True); obj.location.z=z; obj["net30_component"]="cap"; cap_ribs(cap_radius,h,z,features["ribCount"],features["ribDepthMm"]*MM,target,material)
    elif kind=="pouringRing":
        h=float(features.get("heightMm",7))*MM; cylinder("PouringRing",float(features.get("outerDiameterMm",d["widthMm"]*.67))*MM/2,h,0,target,material)
    elif kind.startswith("decoration"):
        decal(component,radius,target,material)
    elif kind=="liner": cylinder("ClosureLiner",float(features.get("outerDiameterMm",d["widthMm"]*.59))*MM/2,float(features.get("heightMm",1.6))*MM,0,target,material)
    elif kind=="contents":
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=16,location=(0,0,height*.38)); obj=bpy.context.object; obj.name="SelectedContents"; obj.scale=(radius*.24,radius*.24,height*.06); link(obj,target); obj.data.materials.append(material); smooth(obj)
    offset=component.get("transform",{});
    for obj in target.objects:
        obj.location.x += float(offset.get("xMm",0))*MM; obj.location.y += float(offset.get("yMm",0))*MM; obj.location.z += float(offset.get("zMm",0))*MM
def export(objects,destination):
    import addon_utils; addon_utils.enable("io_scene_gltf2",default_set=False,persistent=False)
    bpy.ops.object.select_all(action="DESELECT")
    meshes=[obj for obj in objects if obj.type=="MESH"]
    if not meshes: return False
    for obj in meshes: obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]; destination.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(destination),export_format="GLB",use_selection=True,export_yup=True,export_apply=True,export_materials="EXPORT",export_cameras=False,export_lights=False,export_extras=True)
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
            transform=item.get("transform") or {}
            obj.location.x += float(transform.get("xMm",transform.get("x",0)))*MM
            obj.location.y += float(transform.get("yMm",transform.get("y",0)))*MM
            obj.location.z += float(transform.get("zMm",transform.get("z",0)))*MM
            obj.rotation_euler.x += math.radians(float(transform.get("rotationX",0)))
            obj.rotation_euler.y += math.radians(float(transform.get("rotationY",0)))
            obj.rotation_euler.z += math.radians(float(transform.get("rotationZ",0)))
    destination=pathlib.Path(request["paths"]["assemblyGlb"])
    if not export(list(assembly.all_objects),destination): raise RuntimeError("No selected component mesh could be assembled")
    print("ASSEMBLY_GLB="+str(destination))
def main():
    request=json.loads(request_path().read_text())
    if request.get("mode")=="assemble-library": return assemble_library(request)
    paths=request["paths"]; clear(); assembly=col("ASSEMBLY")
    graph=request["spec"].get("modelingGraph"); graph_components={item["id"]:item for item in (graph or {}).get("components",[])}; graph_nodes=(graph or {}).get("nodes",[])
    for component in request["spec"]["components"]:
        instance_id=component.get("componentInstanceId",component["component"]); part=col("PART_"+instance_id)
        if instance_id in graph_components: build_graph_component(graph_components[instance_id],[node for node in graph_nodes if node["componentId"]==instance_id],request["spec"]["contract"],request.get("imageInputs",[]),paths["jobDir"],part)
        else: build_component(component,request["spec"]["contract"],part)
        export(list(part.all_objects),pathlib.Path(paths["componentDir"])/(instance_id+".glb"))
        for obj in list(part.objects): link(obj,assembly)
    approved=request.get("payload",{}).get("approvedDraft") or {}
    if approved.get("stickerSlots"):
        values={}
        for item in approved.get("questions",[]):
            if str(item.get("path","")).startswith("stickerSlots."):
                pieces=item["path"].split("."); values.setdefault(pieces[1],{})[pieces[2]]=item.get("userValue",item.get("recommendedValue"))
        radius=max(request["spec"]["contract"]["dimensionsMm"]["widthMm"],request["spec"]["contract"]["dimensionsMm"]["depthMm"])*MM/2
        for source_id in ["korean-product-information","full-price-structure"]: sticker_slot("NET30_STICKER_SLOT_"+source_id.upper().replace("-","_"),source_id,radius,request["spec"]["contract"]["dimensionsMm"]["heightMm"]*MM,assembly,values.get(source_id,{}))
    if not export(list(assembly.all_objects),pathlib.Path(paths["assemblyGlb"])): raise RuntimeError("No selected component created a mesh")
    print("ASSEMBLY_GLB="+paths["assemblyGlb"])
try: main()
except Exception: traceback.print_exc(); sys.exit(1)
