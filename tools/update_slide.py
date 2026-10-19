"""Update only the derived model's Slide clip, retaining packed materials."""
import bpy,sys,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'tools'))
from slide_pose import apply_slide,settle_slide

source=ROOT/'assets/source/nailong_colored.blend'
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
bpy.context.preferences.filepaths.save_version=0
scene=bpy.context.scene;rig=bpy.data.objects['Nailong_Rig'];obj=bpy.data.objects['Nailong_Rounded']
pose=rig.pose.bones
rig.animation_data.action=None
for track in list(rig.animation_data.nla_tracks):
    if track.name=='Slide':rig.animation_data.nla_tracks.remove(track)
    else:track.mute=True
old=bpy.data.actions.get('Slide')
if old:bpy.data.actions.remove(old)
# Retiming both keyframes and NLA strips preserves the three existing clips.
factor=60/scene.render.fps
if factor!=1:
    for action in bpy.data.actions:
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        for key in curve.keyframe_points:
                            key.co.x*=factor;key.handle_left.x*=factor;key.handle_right.x*=factor
    for track in rig.animation_data.nla_tracks:
        for strip in track.strips:
            strip.action_frame_end*=factor;strip.frame_end=strip.action_frame_end
scene.render.fps=60
def clear_pose():
    for bone in pose:
        bone.rotation_mode='XYZ';bone.rotation_euler=(0,0,0);bone.location=(0,0,0);bone.scale=(1,1,1)
samples=[]
for frame in range(52):
    scene.frame_set(frame);clear_pose()
    s=apply_slide(pose,frame/60);settle_slide(bpy,rig,obj,s)
    for bone in pose:
        for channel in ['rotation_euler','location','scale']:bone.keyframe_insert(channel,frame=frame,group=bone.name)
    if frame in [12,24,39]:
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        points=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
        samples.append({'seconds':frame/60,'scaled_top':max(p.z for p in points)*.8,'scaled_depth':(max(p.y for p in points)-min(p.y for p in points))*.8})
action=rig.animation_data.action;action.name='Slide';action.use_fake_user=True
print('SLIDE_BOUNDS',json.dumps(samples))
assert max(s['scaled_top'] for s in samples)<=1.35,'Slide does not fit the configured collider'
track=rig.animation_data.nla_tracks.new();track.name='Slide';track.strips.new('Slide',0,action);track.mute=True
rig.animation_data.action=None;clear_pose();scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=rig
details=bpy.data.objects.get('Laugh_Details')
if details:details.select_set(True)
scene.frame_start=0;scene.frame_end=120
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'assets/nailong-rounded.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_nla_strips=True,
    export_yup=True,export_skins=True,export_def_bones=True,export_morph=True,export_morph_normal=True,
    export_try_sparse_sk=False,export_try_omit_sparse_sk=False)
if details:
    from laugh_export import finish_laugh_export
    finish_laugh_export(ROOT/'assets/nailong-rounded.glb')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
(ROOT/'artifacts/slide-report.json').write_text(json.dumps({'source_sha256':source_hash,'stable_samples':samples,'clip_seconds':.85},indent=2),encoding='utf-8')
report_path=ROOT/'artifacts/model-report.json'
report=json.loads(report_path.read_text(encoding='utf-8'))
report.update(glb_bytes=(ROOT/'assets/nailong-rounded.glb').stat().st_size,animation_fps=60,
    durations={'Idle':2,'Run':.8,'Jump':.9,'Slide':.85},slide_style='back-leaning slide tackle')
if details:report['durations']['Laugh']=.85
report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
