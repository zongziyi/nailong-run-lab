"""Reproducible conversion of WeDai's original mesh; run with Blender --background."""
import bpy, math, json, sys
import numpy as np
from mathutils import Vector
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'assets'
sys.path.insert(0,str(ROOT/'tools'))
from appearance import REVISION,repair_center_seam,move_eyes_inward
bpy.ops.wm.open_mainfile(filepath=str(ASSETS/'source/nailong_colored.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene
obj=next(o for o in scene.objects if o.type=='MESH')
obj.name='Nailong_Rounded';obj.data.name='WeDai_Nailong_AdaptedMesh'
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj

# Bake only the original base colors, never scene lighting. This preserves the
# procedural belly/hand/foot masks when proportions and skinning later change.
cache=ASSETS/'nailong-color.png'
if len(obj.data.uv_layers)==0:obj.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=.00003)
bpy.ops.mesh.delete_loose(use_verts=True,use_edges=True,use_faces=False)
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
obj.data.validate(verbose=True)
obj.data.update()
appearance_seam=repair_center_seam(obj)
bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66),island_margin=.018)
bpy.ops.object.mode_set(mode='OBJECT')
source_materials=list(obj.data.materials)
source_material_indices=[p.material_index for p in obj.data.polygons]
image=bpy.data.images.new('Nailong_BaseColor_Baked',width=2048,height=2048,alpha=False)
for mat in obj.data.materials:
    nodes=mat.node_tree.nodes;links=mat.node_tree.links
    bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
    # Warmer pale belly, matching the user-supplied three-view reference.
    if mat.name=='yellow':
        last=bsdf.inputs['Base Color'].links[0].from_node
        assert last.type=='MIX_RGB'
        last.inputs['Color2'].default_value=(.92,.80,.51,1)
    emission=nodes.new('ShaderNodeEmission')
    source=bsdf.inputs['Base Color']
    if source.is_linked:links.new(source.links[0].from_socket,emission.inputs['Color'])
    else:emission.inputs['Color'].default_value=source.default_value
    output=next(n for n in nodes if n.type=='OUTPUT_MATERIAL' and n.is_active_output)
    links.new(emission.outputs[0],output.inputs['Surface'])
    tex=nodes.new('ShaderNodeTexImage');tex.image=image;nodes.active=tex
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
bpy.ops.object.bake(type='EMIT',margin=10,use_clear=True)
image.filepath_raw=str(cache);image.file_format='PNG';image.save();image.pack()
mat=bpy.data.materials.new('Nailong_Baked_PBR');mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.63;bsdf.inputs['Metallic'].default_value=0
tex=mat.node_tree.nodes.new('ShaderNodeTexImage');tex.image=image
mat.node_tree.links.new(tex.outputs['Color'],bsdf.inputs['Base Color'])
obj.data.materials.clear();obj.data.materials.append(mat)
for poly in obj.data.polygons:poly.material_index=0;poly.use_smooth=True

# Local shaping: shorten only the lower leg region, expand the abdomen in both
# width and depth, and shorten hanging arms toward the shoulders. Not a global scale.
obj.location=(0,0,0)
verts=obj.data.vertices
minz=min(v.co.z for v in verts);height=max(v.co.z for v in verts)-minz
maxx=max(abs(v.co.x) for v in verts)
original_coords=[v.co.copy() for v in verts]
source_adjacency=[[] for _ in verts]
for edge in obj.data.edges:
    a,b=edge.vertices
    if (original_coords[a].z-minz)/height<.54 and (original_coords[b].z-minz)/height<.54:source_adjacency[a].append(b);source_adjacency[b].append(a)
source_seen=set();source_hands=set()
for start in range(len(verts)):
    if start in source_seen or not source_adjacency[start]:continue
    stack=[start];source_seen.add(start);component=[]
    while stack:
        vi=stack.pop();component.append(vi)
        for n in source_adjacency[vi]:
            if n not in source_seen:source_seen.add(n);stack.append(n)
    if min((original_coords[i].z-minz)/height for i in component)>.17 and abs(sum(original_coords[i].x for i in component)/len(component))>.25:source_hands.update(component)
for v in verts:
    x,y,z=v.co
    t=(z-minz)/height
    belly=math.exp(-((t-.49)/.21)**2)
    widen=1+.25*belly+.035*math.exp(-((t-.89)/.13)**2)
    deep=1+.26*belly
    arm_mask=max(0,min(1,(abs(x)-.29)/.12))*max(0,min(1,(t-.18)/.10))*max(0,min(1,(.78-t)/.15))
    if v.index in source_hands:arm_mask=1.0
    # Lift the hands slightly, reducing long dangling arms while keeping shoulders attached.
    shaped_t=t+.13*(.70-t)*arm_mask
    newt=.68*shaped_t if shaped_t<.32 else .32*.68+shaped_t-.32
    v.co=(-x*widen,-y*deep,newt*height)
scale=3/max(v.co.z for v in verts)
for v in verts:v.co*=scale
obj.data.update()
appearance_eyes=move_eyes_inward(obj)
# BMesh round-tripping rebuilds vertex wrappers; refresh before rigging.
verts=obj.data.vertices

# A compact, real armature drives limb motion and body poses.
arm=bpy.data.armatures.new('Nailong_Rig');rig=bpy.data.objects.new('Nailong_Rig',arm);scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;obj.select_set(False);rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
def bone(name,head,tail,parent=None):
    b=arm.edit_bones.new(name);b.head=head;b.tail=tail
    if parent:b.parent=arm.edit_bones[parent]
    return b
bone('Root',(0,0,0),(0,0,.35))
bone('Pelvis',(0,0,.83),(0,0,1.25),'Root')
bone('Chest',(0,0,1.25),(0,0,2.12),'Pelvis')
bone('Head',(0,0,2.12),(0,0,2.95),'Chest')
for side,sign in [('L',1),('R',-1)]:
    bone('UpperArm.'+side,(sign*.57,0,2.08),(sign*.78,-.015,1.64),'Chest')
    bone('Forearm.'+side,(sign*.78,-.015,1.64),(sign*.76,-.035,1.15),'UpperArm.'+side)
    bone('Hand.'+side,(sign*.76,-.035,1.15),(sign*.68,-.10,.94),'Forearm.'+side)
    bone('Thigh.'+side,(sign*.37,0,.89),(sign*.36,-.01,.49),'Pelvis')
    bone('Shin.'+side,(sign*.36,-.01,.49),(sign*.37,-.035,.15),'Thigh.'+side)
    bone('Foot.'+side,(sign*.37,-.035,.15),(sign*.37,-.40,.12),'Shin.'+side)
bpy.ops.object.mode_set(mode='OBJECT')
groups={b.name:obj.vertex_groups.new(name=b.name) for b in arm.bones}
def smooth(a,b,v):
    t=max(0,min(1,(v-a)/(b-a)));return t*t*(3-2*t)
for v,old in zip(verts,original_coords):
    x,y,z=v.co
    t=(old.z-minz)/height
    side='L' if x>=0 else 'R'
    # Arm region is gated in original coordinates, so belly vertices never
    # get pulled along with a swinging arm. Blend gently across shoulder seams.
    ax=abs(old.x)
    arm_weight=smooth(.295,.39,ax)*(1-smooth(.73,.80,t))*smooth(.20,.30,t)
    leg_weight=(1-smooth(.29,.39,t))
    weights={}
    def add(name,w):
        if w>1e-5:weights[name]=weights.get(name,0)+w
    if arm_weight>0:
        lower=1-smooth(1.49,1.79,z)
        add('UpperArm.'+side,arm_weight*(1-lower));add('Forearm.'+side,arm_weight*lower)
    remaining=1-arm_weight
    if leg_weight>0:
        ankle=1-smooth(.16,.27,z)
        knee=smooth(.40,.60,z)
        add('Foot.'+side,remaining*leg_weight*ankle)
        add('Shin.'+side,remaining*leg_weight*(1-ankle)*(1-knee))
        add('Thigh.'+side,remaining*leg_weight*(1-ankle)*knee)
    body=remaining*(1-leg_weight)
    head=smooth(2.05,2.48,z)
    chest=smooth(.95,1.53,z)
    add('Head',body*head);add('Chest',body*(1-head)*chest);add('Pelvis',body*(1-head)*(1-chest))
    total=sum(weights.values())
    if total==0:weights={'Pelvis':1};total=1
    # glTF skinning supports four weights per vertex. Keep the dominant four,
    # then normalize explicitly, matching the exported mesh exactly.
    selected=sorted(weights.items(),key=lambda kv:-kv[1])[:4];total=sum(w for _,w in selected)
    for name,w in selected:groups[name].add([v.index],w/total,'REPLACE')
modifier=obj.modifiers.new('Nailong_Skin','ARMATURE');modifier.object=rig
obj.parent=rig
# Heat diffusion respects the continuous arm/torso surface and avoids fingers
# being assigned to the nearby belly merely because of their x coordinate.
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
for duplicate in list(obj.modifiers):
    if duplicate.type=='ARMATURE' and duplicate.name!='Nailong_Skin':obj.modifiers.remove(duplicate)
# The source's long, thin digits lie near the hip surface. Keep the brown hand
# region rigid to the terminal hand bone instead of letting heat weights pull
# individual fingertips toward the pelvis during a swing.
hand_ids=set();uv=obj.data.uv_layers.active.data
pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels)
for loop in obj.data.loops:
    old=original_coords[loop.vertex_index];t=(old.z-minz)/height
    if not (.18<t<.46 and abs(old.x)>.22):continue
    u,w=uv[loop.index].uv;px=max(0,min(image.size[0]-1,int(u*image.size[0])));py=max(0,min(image.size[1]-1,int(w*image.size[1])))
    i=(py*image.size[0]+px)*4
    if pixels[i]<.50 and pixels[i+1]<.40:hand_ids.add(loop.vertex_index)
# Grow seeds along mesh connectivity below the wrists. This catches every
# fingertip, including UV boundary pixels, without selecting the nearby thigh.
adjacency=[[] for _ in verts]
for edge in obj.data.edges:
    a,b=edge.vertices
    if verts[a].co.z<1.45 and verts[b].co.z<1.45:adjacency[a].append(b);adjacency[b].append(a)
seen=set();hand_region=set()
for seed in hand_ids:
    if seed in seen:continue
    stack=[seed];seen.add(seed);component=[]
    while stack:
        vi=stack.pop();component.append(vi)
        for neighbor in adjacency[vi]:
            if neighbor not in seen:seen.add(neighbor);stack.append(neighbor)
    if min(verts[i].co.z for i in component)>.50 and abs(sum(verts[i].co.x for i in component)/len(component))>.50:hand_region.update(component)
for vi in hand_region:
    blend=1-smooth(1.25,1.45,verts[vi].co.z)
    old_weights={g.group:g.weight for g in verts[vi].groups}
    for group in obj.vertex_groups:group.remove([vi])
    for gi,w in old_weights.items():
        if w*(1-blend)>1e-6:obj.vertex_groups[gi].add([vi],w*(1-blend),'REPLACE')
    side='L' if verts[vi].co.x>=0 else 'R'
    obj.vertex_groups['Hand.'+side].add([vi],blend,'ADD')
# Keep the face/eyes and crown rigid; automatic weights on this single rounded
# body otherwise allow the arm bones to tug the top of the head.
for v in verts:
    if v.co.z<=1.75:continue
    blend=smooth(1.75,2.25,v.co.z)
    head_weight=smooth(1.95,2.35,v.co.z)
    old_weights={g.group:g.weight for g in v.groups}
    for group in obj.vertex_groups:group.remove([v.index])
    for gi,w in old_weights.items():
        if w*(1-blend)>1e-6:obj.vertex_groups[gi].add([v.index],w*(1-blend),'REPLACE')
    if head_weight>0:obj.vertex_groups['Head'].add([v.index],head_weight*blend,'ADD')
    if head_weight<1:obj.vertex_groups['Chest'].add([v.index],(1-head_weight)*blend,'ADD')
bpy.context.view_layer.objects.active=obj
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL',limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL',lock_active=False)
unweighted=0
for v in verts:
    if sum(g.weight for g in v.groups)<1e-6:
        obj.vertex_groups['Head' if v.co.z>2.0 else 'Pelvis'].add([v.index],1,'REPLACE');unweighted+=1
bpy.context.view_layer.objects.active=rig

# The original procedural hand-color mask also paints a few thin brown marks
# onto the nearby belly. Restrict that mask to the actual connected hands/feet,
# then rebake so no "finger-shaped tattoo" remains when the arms move away.
mask=obj.data.attributes.new('HandFootColorMask','FLOAT','POINT')
for v in verts:mask.data[v.index].value=1.0 if v.index in hand_region or v.co.z<.35 else 0.0
yellow=source_materials[0];nodes=yellow.node_tree.nodes;links=yellow.node_tree.links
# Retain the original Generated coordinates after the mesh has been rotated and
# reshaped. Otherwise Blender would move the belly mask onto the back on rebake.
minimum=[min(co[i] for co in original_coords) for i in range(3)]
maximum=[max(co[i] for co in original_coords) for i in range(3)]
original_generated=obj.data.attributes.new('OriginalGenerated','FLOAT_VECTOR','POINT')
for i,co in enumerate(original_coords):original_generated.data[i].vector=tuple((co[j]-minimum[j])/(maximum[j]-minimum[j]) for j in range(3))
coordinate=next(n for n in nodes if n.type=='TEX_COORD')
source_coordinate=nodes.new('ShaderNodeAttribute');source_coordinate.attribute_name='OriginalGenerated'
for link in list(coordinate.outputs['Generated'].links):links.new(source_coordinate.outputs['Vector'],link.to_socket)
yellow_bsdf=next(n for n in nodes if n.type=='BSDF_PRINCIPLED')
belly_mix=yellow_bsdf.inputs['Base Color'].links[0].from_node
hand_mix=belly_mix.inputs['Color1'].links[0].from_node
assert hand_mix.type=='MIX_RGB' and hand_mix.inputs['Factor'].is_linked
if hand_mix.inputs['Factor'].is_linked:
    original_mask=hand_mix.inputs['Factor'].links[0].from_socket
    attr=nodes.new('ShaderNodeAttribute');attr.attribute_name='HandFootColorMask'
    multiply=nodes.new('ShaderNodeMath');multiply.operation='MULTIPLY'
    links.new(original_mask,multiply.inputs[0]);links.new(attr.outputs['Fac'],multiply.inputs[1]);links.new(multiply.outputs[0],hand_mix.inputs['Factor'])
obj.data.materials.clear()
for source_mat in source_materials:obj.data.materials.append(source_mat)
for p,idx in zip(obj.data.polygons,source_material_indices):p.material_index=idx
image=bpy.data.images.new('Nailong_Web_BaseColor',width=2048,height=2048,alpha=False)
for source_mat in source_materials:
    bake_node=next(n for n in source_mat.node_tree.nodes if n.type=='TEX_IMAGE')
    bake_node.image=image;source_mat.node_tree.nodes.active=bake_node
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.object.bake(type='EMIT',margin=10,use_clear=True)
image.filepath_raw=str(cache);image.file_format='PNG'
image.save();image.pack()
next(n for n in mat.node_tree.nodes if n.type=='TEX_IMAGE').image=image
obj.data.materials.clear();obj.data.materials.append(mat)
for p in obj.data.polygons:p.material_index=0
rig.select_set(True);bpy.context.view_layer.objects.active=rig

sys.path.insert(0,str(ROOT/'tools'))
from slide_pose import apply_slide,settle_slide
FPS=60;scene.render.fps=FPS
pose=rig.pose.bones
for b in pose:b.rotation_mode='XYZ'
def clear_pose():
    for b in pose:b.location=(0,0,0);b.rotation_euler=(0,0,0);b.scale=(1,1,1)
def radians(*args):return tuple(math.radians(a) for a in args)
def animate(name,frames,fn):
    rig.animation_data_create();rig.animation_data.action=None
    clear_pose()
    for frame in range(frames+1):
        scene.frame_set(frame);clear_pose();fn(frame/frames)
        for b in pose:
            b.keyframe_insert('rotation_euler',frame=frame,group=b.name)
            b.keyframe_insert('location',frame=frame,group=b.name)
            b.keyframe_insert('scale',frame=frame,group=b.name)
    action=rig.animation_data.action;action.name=name;action.use_fake_user=True
    # Explicit NLA tracks export to stable, named glTF clips.
    track=rig.animation_data.nla_tracks.new();track.name=name
    track.strips.new(name,0,action);track.mute=True
    rig.animation_data.action=None
    return action
def idle(t):
    s=math.sin(t*math.tau)
    pose['Chest'].scale=(1+s*.008,1+s*.008,1)
    pose['Chest'].rotation_euler[0]=math.radians(1.2*s)
    pose['Head'].rotation_euler[2]=math.radians(1.8*s)
    for side,sign in [('L',1),('R',-1)]:pose['UpperArm.'+side].rotation_euler[1]=math.radians(sign*(2+s))
def run(t):
    phase=t*math.tau
    pose['Root'].location[1]=.035*(1-math.cos(phase*2))
    pose['Pelvis'].rotation_euler[2]=math.radians(3*math.sin(phase))
    pose['Chest'].rotation_euler=radians(4,0,-3*math.sin(phase))
    pose['Head'].rotation_euler[0]=math.radians(-3)
    for side,sign in [('L',1),('R',-1)]:
        swing=math.sin(phase)*sign
        pose['Thigh.'+side].rotation_euler[0]=math.radians(25*swing)
        pose['Shin.'+side].rotation_euler[0]=math.radians(max(0,swing)*32)
        pose['Foot.'+side].rotation_euler[0]=math.radians(10*swing)
        pose['UpperArm.'+side].rotation_euler=radians(-23*swing,sign*-4,0)
        pose['Forearm.'+side].rotation_euler[0]=math.radians(-12-8*max(0,-swing))
def jump(t):
    s=math.sin(math.pi*t)
    pose['Chest'].rotation_euler[0]=math.radians(-5*s)
    for side,sign in [('L',1),('R',-1)]:
        pose['UpperArm.'+side].rotation_euler=radians(-35*s,sign*-12*s,0)
        pose['Forearm.'+side].rotation_euler[0]=math.radians(-15*s)
        pose['Thigh.'+side].rotation_euler[0]=math.radians(28*s)
        pose['Shin.'+side].rotation_euler[0]=math.radians(-40*s)
def slide(t):
    s=apply_slide(pose,t*.85)
    settle_slide(bpy,rig,obj,s)
animate('Idle',120,idle);animate('Run',48,run);animate('Jump',54,jump);animate('Slide',51,slide)
from laugh_pose import author_laugh
details=author_laugh(rig,obj)
clear_pose();scene.frame_set(0)
for b in pose:b.scale=(1,1,1)
rig.animation_data.action=None

# Keep an editable Blender deliverable, and export only the character/rig.
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);details.select_set(True);bpy.context.view_layer.objects.active=rig
scene.frame_start=0;scene.frame_end=120
bpy.ops.wm.save_as_mainfile(filepath=str(ASSETS/'nailong-rounded.blend'))
bpy.ops.export_scene.gltf(filepath=str(ASSETS/'nailong-rounded.glb'),export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_nla_strips=True,export_yup=True,export_skins=True,export_def_bones=True,export_morph=True,export_morph_normal=True,export_try_sparse_sk=False,export_try_omit_sparse_sk=False,export_optimize_disable_viewport=False)
from laugh_export import finish_laugh_export
finish_laugh_export(ASSETS/'nailong-rounded.glb')
report={'source':'https://github.com/bigdiu/naiwa-nailoong-blender-model','author':'WeDai','blender':bpy.app.version_string,'vertices':len(verts),'faces':len(obj.data.polygons),'bounds':[[min(v.co[i] for v in verts),max(v.co[i] for v in verts)] for i in range(3)],'bones':len(arm.bones),'hand_region_vertices':len(hand_region),'unweighted_vertices_repaired':unweighted,'clips':['Idle','Run','Jump','Slide'],'glb_bytes':(ASSETS/'nailong-rounded.glb').stat().st_size}
report.update(appearance_revision=REVISION,appearance_seam=appearance_seam,appearance_eyes=appearance_eyes)
report.update(clips=['Idle','Run','Jump','Slide','Laugh'],animation_fps=60,durations={'Idle':2,'Run':.8,'Jump':.9,'Slide':.85,'Laugh':.85},laugh_style='grounded belly laugh with closed eyes and open mouth')
(ROOT/'artifacts/model-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print('PREPARED_MODEL',json.dumps(report))
