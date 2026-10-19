"""Add Laugh to the existing edited asset, preserving the four original clips."""
import bpy, sys, json, hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from laugh_pose import author_laugh
from laugh_export import finish_laugh_export

source=ROOT/'assets/source/nailong_colored.blend'
source_hash=hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
bpy.context.preferences.filepaths.save_version=0
rig=bpy.data.objects['Nailong_Rig'];obj=bpy.data.objects['Nailong_Rounded']
def signature(action):
    return [(curve.data_path,curve.array_index,[(tuple(key.co),tuple(key.handle_left),tuple(key.handle_right),key.interpolation)
            for key in curve.keyframe_points])
            for layer in action.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
original={name:signature(bpy.data.actions[name]) for name in ['Idle','Run','Jump','Slide']}
details=author_laugh(rig,obj)
assert all(signature(bpy.data.actions[name])==curves for name,curves in original.items()),'An original clip was modified'
bpy.ops.object.select_all(action='DESELECT')
for mesh in [rig,obj,details]:mesh.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/nailong-rounded.blend'))
export_path=ROOT/'.cache/laugh-export.glb'
export_path.parent.mkdir(exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(export_path),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_nla_strips=True,
    export_yup=True,export_skins=True,export_def_bones=True,export_morph=True,export_morph_normal=True,
    export_try_sparse_sk=False,export_try_omit_sparse_sk=False,export_optimize_disable_viewport=False)
finish_laugh_export(export_path)
export_path.replace(ROOT/'assets/nailong-rounded.glb')
assert hashlib.sha256(source.read_bytes()).hexdigest()==source_hash
report_path=ROOT/'artifacts/model-report.json';report=json.loads(report_path.read_text(encoding='utf-8'))
report.update(clips=['Idle','Run','Jump','Slide','Laugh'],glb_bytes=(ROOT/'assets/nailong-rounded.glb').stat().st_size)
report['durations']['Laugh']=.85;report['laugh_style']='grounded belly laugh with closed eyes and open mouth'
report_path.write_text(json.dumps(report,indent=2),encoding='utf-8')
print('LAUGH_EXPORTED',report['glb_bytes'])
