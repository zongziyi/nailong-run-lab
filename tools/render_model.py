import bpy, math, json, sys
from mathutils import Vector
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
scene=bpy.context.scene
rig=bpy.data.objects['Nailong_Rig'];obj=bpy.data.objects['Nailong_Rounded']
for o in list(scene.objects):
    if o not in [rig,obj]:bpy.data.objects.remove(o,do_unlink=True)
for track in rig.animation_data.nla_tracks:track.mute=True
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=20;scene.cycles.use_denoising=True
scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.world=bpy.data.worlds.new('StudioWorld');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.77,.78,.71,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=0
def light(name,pos,power,size):
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size
    o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=pos;o.rotation_euler=(Vector((0,0,1.5))-o.location).to_track_quat('-Z','Y').to_euler()
light('Softbox_Key',(-3,-4,6),300,5);light('Softbox_Fill',(4,-2,4),150,4);light('Softbox_Rim',(0,4,5),250,4)
mat=bpy.data.materials.new('Studio_Sand');mat.diffuse_color=(.78,.75,.64,1)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.025));floor=bpy.context.object;floor.data.materials.append(mat)
camdata=bpy.data.cameras.new('ReviewCamera');camera=bpy.data.objects.new('ReviewCamera',camdata);scene.collection.objects.link(camera);scene.camera=camera;camdata.type='ORTHO'
def setcam(pos,target,scale):
    camera.location=pos;camera.rotation_euler=(Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler();camdata.ortho_scale=scale
def pose(name,frame):
    rig.animation_data.action=bpy.data.actions[name];scene.frame_set(frame);bpy.context.view_layer.update()
def render(name,w=600,h=760):
    scene.render.resolution_x=w;scene.render.resolution_y=h;scene.render.filepath=str(ROOT/'artifacts'/name);bpy.ops.render.render(write_still=True)
pose('Idle',0)
for name,angle in [('front',0),('side',-90),('back',180)]:
    rig.rotation_euler.z=math.radians(angle);setcam((0,-8,2.8),(0,0,1.5),3.65);render('model-'+name+'.png')
rig.rotation_euler.z=0
for name,action,frame in [('run','Run',12),('jump','Jump',27),('slide','Slide',24)]:
    pose(action,frame);setcam((4,-7,3.2),(0,0,1.45),3.9);render('pose-'+name+'.png')

if '--appearance-review' in sys.argv:
    pose('Idle',0)
    setcam((4,-8.3,3.4),(0,0,1.5),3.65)
    render('model-threequarter.png')
    frame_dir=ROOT/'.cache/appearance-idle'
    frame_dir.mkdir(parents=True,exist_ok=True)
    scene.cycles.samples=8
    # Thirty images cover the complete two-second cycle at 15 fps.
    for frame in range(0,120,4):
        pose('Idle',frame)
        render(str(frame_dir/f'{frame:03}.png'),320,406)
    scene.cycles.samples=20

# True simultaneous three-view render of the same edited mesh and rest pose.
pose('Idle',0);rig.location.x=-3.0;rig.rotation_euler.z=math.radians(-90)
copies=[]
for x,angle in [(0,0),(3,180)]:
    duplicate=rig.copy();duplicate.data=rig.data.copy();scene.collection.objects.link(duplicate);duplicate.animation_data_clear();duplicate.location=(x,0,0);duplicate.rotation_euler.z=math.radians(angle)
    mesh=obj.copy();mesh.data=obj.data;scene.collection.objects.link(mesh);mesh.parent=duplicate;mesh.matrix_parent_inverse=obj.matrix_parent_inverse.copy();mesh.modifiers['Nailong_Skin'].object=duplicate
    copies.extend([duplicate,mesh])
setcam((0,-14,4.5),(0,0,1.4),10.3);render('model-three-views.png',1600,850)
print('RENDERED_REVIEW_VIEWS')
