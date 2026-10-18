"""Three slide stages, front and side. Offline Blender review, not web capture."""
import bpy,math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent.parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
scene=bpy.context.scene;rig=bpy.data.objects['Nailong_Rig'];obj=bpy.data.objects['Nailong_Rounded']
for item in list(scene.objects):
    if item not in [rig,obj]:bpy.data.objects.remove(item,do_unlink=True)
for track in rig.animation_data.nla_tracks:track.mute=True
rig.animation_data.action=bpy.data.actions['Slide']
copies=[]
for x,frame,label in [(-3.3,6,'ENTER  0.10s'),(0,24,'HOLD  0.40s'),(3.3,46,'RECOVER  0.77s')]:
    scene.frame_set(frame);bpy.context.view_layer.update()
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=bpy.data.meshes.new_from_object(evaluated)
    frozen=bpy.data.objects.new(label,mesh);scene.collection.objects.link(frozen)
    frozen.location=(x,0,0);frozen.scale=(.8,.8,.8);copies.append(frozen)
rig.hide_render=True;obj.hide_render=True
scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.render.resolution_x=1600;scene.render.resolution_y=700;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.77,.78,.71,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.02))
mat=bpy.data.materials.new('Sand');mat.diffuse_color=(.78,.75,.64,1);bpy.context.object.data.materials.append(mat)
def aim(item,target):item.rotation_euler=(Vector(target)-item.location).to_track_quat('-Z','Y').to_euler()
for position,power in [((-3,-4,7),500),((5,-2,5),350),((0,4,6),600)]:
    bpy.ops.object.light_add(type='AREA',location=position);light=bpy.context.object
    light.data.energy=power;light.data.size=6;aim(light,(0,0,1))
bpy.ops.object.camera_add(location=(0,-15,4.2));camera=bpy.context.object
camera.data.type='ORTHO';camera.data.ortho_scale=10.8;aim(camera,(0,0,1.2));scene.camera=camera
labels=[]
for frozen in copies:
    bpy.ops.object.text_add(location=(frozen.location.x,-.45,2.72))
    label=bpy.context.object;label.data.body=frozen.name;label.data.align_x='CENTER';label.data.size=.18
    label.rotation_euler=camera.rotation_euler;labels.append(label)
for name,angle in [('front',0),('side',math.pi/2)]:
    for frozen in copies:frozen.rotation_euler.z=angle
    scene.render.filepath=str(ROOT/f'artifacts/slide-stages-{name}.png')
    bpy.ops.render.render(write_still=True)
print('SLIDE_REVIEW_RENDERED')
