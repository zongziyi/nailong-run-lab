"""Correct the current derived mesh without rebuilding its materials or actions."""
import bpy
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from appearance import REVISION, repair_center_seam, move_eyes_inward

source = ROOT / 'assets/source/nailong_colored.blend'
source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/nailong-rounded.blend'))
bpy.context.preferences.filepaths.save_version = 0
scene = bpy.context.scene
rig = bpy.data.objects['Nailong_Rig']
obj = bpy.data.objects['Nailong_Rounded']
assert obj.get('appearance_revision', 0) < REVISION, 'Appearance correction already applied'


def action_signature():
    result = {}
    for action in bpy.data.actions:
        digest = hashlib.sha256()
        for layer in action.layers:
            for strip in layer.strips:
                for bag in strip.channelbags:
                    for curve in bag.fcurves:
                        digest.update(str((curve.data_path, curve.array_index)).encode())
                        for key in curve.keyframe_points:
                            digest.update(str((tuple(key.co), tuple(key.handle_left),
                                               tuple(key.handle_right), key.interpolation)).encode())
        result[action.name] = digest.hexdigest()
    return result


actions_before = action_signature()
texture = next(node.image for node in obj.data.materials[0].node_tree.nodes
               if node.type == 'TEX_IMAGE')
texture_hash = hashlib.sha256((ROOT / 'assets/nailong-color.png').read_bytes()).hexdigest()
rig.animation_data.action = None
for track in rig.animation_data.nla_tracks:
    track.mute = True
for bone in rig.pose.bones:
    bone.location = (0, 0, 0)
    bone.rotation_euler = (0, 0, 0)
    bone.scale = (1, 1, 1)
scene.frame_set(0)
seam = repair_center_seam(obj)
eyes = move_eyes_inward(obj)
assert actions_before == action_signature(), 'Appearance editing must retain every animation key'

bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
obj.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'assets/nailong-rounded.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT / 'assets/nailong-rounded.glb'),
    export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_force_sampling=True,
    export_nla_strips=True, export_yup=True, export_skins=True, export_def_bones=True)
assert source_hash == hashlib.sha256(source.read_bytes()).hexdigest()
assert texture_hash == hashlib.sha256((ROOT / 'assets/nailong-color.png').read_bytes()).hexdigest()
report = {'revision': REVISION, 'source_sha256': source_hash,
          'texture_sha256': texture_hash, 'texture_rebaked': False,
          'animations_unchanged': actions_before, 'seam': seam, 'eyes': eyes,
          'vertices': len(obj.data.vertices), 'faces': len(obj.data.polygons)}
(ROOT / 'artifacts/appearance-report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
report_path = ROOT / 'artifacts/model-report.json'
model_report = json.loads(report_path.read_text(encoding='utf-8'))
model_report.update(vertices=len(obj.data.vertices), faces=len(obj.data.polygons),
                    bounds=[[min(v.co[i] for v in obj.data.vertices),
                             max(v.co[i] for v in obj.data.vertices)] for i in range(3)],
                    glb_bytes=(ROOT / 'assets/nailong-rounded.glb').stat().st_size,
                    appearance_revision=REVISION)
report_path.write_text(json.dumps(model_report, indent=2), encoding='utf-8')
print('APPEARANCE_UPDATED', json.dumps(report))
