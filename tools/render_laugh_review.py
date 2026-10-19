"""Render the authored laugh in three views and measure the stable window."""
import bpy, math, json, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from laugh_pose import belly_transform,strength
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Nailong_Rig'];body=bpy.data.objects['Nailong_Rounded'];details=bpy.data.objects['Laugh_Details']
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=bpy.data.actions['Laugh']
for mesh in [body,details]:
    for track in mesh.data.shape_keys.animation_data.nla_tracks:track.mute=True
    mesh.data.shape_keys.animation_data.action=bpy.data.actions[mesh.name+'_Laugh']
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.resolution_x=720;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('Laugh_Review_World');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.38,.46,.44,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.5
scene.view_settings.view_transform='AgX'
for position,power,size in [((-3,-5,7),450,5),((4,-1,5),250,4),((0,4,6),350,4)]:
    bpy.ops.object.light_add(type='AREA',location=position);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(Vector((0,0,1.2))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));floor=bpy.context.object
material=bpy.data.materials.new('Laugh_Review_Floor');material.diffuse_color=(.20,.29,.27,1);floor.data.materials.append(material)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=3.8
def set_frame(frame):
    scene.frame_set(frame);bpy.context.view_layer.update()
def render(name,pos,target=(0,0,1.05)):
    camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    scene.render.filepath=str(ROOT/'artifacts'/name);bpy.ops.render.render(write_still=True)
samples=[]
# Measure the actual pale belly in the pelvis frame, so leaning/translation
# cannot disguise shrinkage. Select it from the existing baked colour atlas.
mesh=body.data;image=next(n.image for n in mesh.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
pixels=np.empty(len(image.pixels),dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(image.size[1],image.size[0],4)
uv=mesh.uv_layers.active.data;belly_ids=set()
for loop in mesh.loops:
    vertex=mesh.vertices[loop.vertex_index]
    if not (.95<vertex.co.z<2.1 and vertex.co.y<-.38 and abs(vertex.co.x)<.66):continue
    color=pixels[min(image.size[1]-1,int(uv[loop.index].uv.y*image.size[1])),min(image.size[0]-1,int(uv[loop.index].uv.x*image.size[0]))]
    if color[2]>.5 and color[1]>.7:belly_ids.add(vertex.index)
assert len(belly_ids)>500,'Expected the original pale belly'
reference=np.ptp(np.array([mesh.vertices[i].co for i in belly_ids]),axis=0)
belly_ratios=[];root_scale_error=0
for frame in range(12,40):
    set_frame(frame);deps=bpy.context.evaluated_depsgraph_get();points=[]
    for mesh in [body,details]:
        evaluated=mesh.evaluated_get(deps);points.extend(evaluated.matrix_world@v.co for v in evaluated.data.vertices)
    samples.append({'time':frame/60,'height':max(p.z for p in points)*.72,'bottom':min(p.z for p in points)*.72})
    evaluated=body.evaluated_get(deps)
    follow=rig.pose.bones['Pelvis'].matrix @ rig.data.bones['Pelvis'].matrix_local.inverted() @ belly_transform(strength(frame/60))
    pelvis_inverse=follow.inverted()
    local=np.array([pelvis_inverse@evaluated.data.vertices[i].co for i in belly_ids])
    belly_ratios.append((np.ptp(local,axis=0)/reference).tolist())
    root_scale_error=max(root_scale_error,max(abs(value-1) for value in rig.pose.bones['Root'].scale))
report={'stable_window':samples,'max_height':max(s['height'] for s in samples),'min_bottom':min(s['bottom'] for s in samples),
        'belly_preservation':{'vertices':len(belly_ids),'reference_dimensions':reference.tolist(),'min_dimension_ratios':np.min(belly_ratios,axis=0).tolist(),'max_dimension_ratios':np.max(belly_ratios,axis=0).tolist(),'root_scale_max_error':root_scale_error}}
(ROOT/'artifacts/laugh-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print('LAUGH_BOUNDS',json.dumps(report))
set_frame(24)
for name,pos in [('front',(0,-8,3.1)),('side',(8,-.5,2.6)),('back',(0,8,3.1))]:render('laugh-'+name+'.png',pos)
if '--stages' in sys.argv:
    for frame in [0,6,12,24,39,46,51]:
        set_frame(frame);render(f'laugh-rear-stage-{frame:02}.png',(0,8,3.1),(0,0,1.45))
assert min(report['belly_preservation']['min_dimension_ratios'])>=.95,'The belly must retain its normal proportions'
assert root_scale_error<1e-6,'Laugh must not shrink the whole character'
assert report['max_height']<=1.35,'Laugh must fit the existing low collider'
