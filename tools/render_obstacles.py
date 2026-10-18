"""Offline render of exported Three.js obstacle meshes, not a webpage capture."""
import bpy
import json
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1440
scene.render.resolution_y = 960
scene.render.resolution_percentage = 100
scene.world.color = (.08, .12, .15)
scene.view_settings.view_transform = 'AgX'

data = json.loads((ROOT / 'artifacts/obstacle-preview-meshes.json').read_text())
materials = {}
for n, item in enumerate(data['meshes']):
    geometry = bpy.data.meshes.new(f'obstacle-{n}')
    indices = item['indices']
    geometry.from_pydata(item['positions'], [], [indices[i:i+3] for i in range(0, len(indices), 3)])
    geometry.update()
    obj = bpy.data.objects.new(f'obstacle-{n}', geometry)
    scene.collection.objects.link(obj)
    key = tuple(item['color'] + item['emissive'])
    if key not in materials:
        mat = bpy.data.materials.new(f'paint-{len(materials)}')
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*item['color'], 1)
        bsdf.inputs['Roughness'].default_value = .72
        bsdf.inputs['Metallic'].default_value = .03
        bsdf.inputs['Emission Color'].default_value = (*item['emissive'], 1)
        bsdf.inputs['Emission Strength'].default_value = item['emissiveIntensity']
        materials[key] = mat
    obj.data.materials.append(materials[key])

bpy.ops.mesh.primitive_plane_add(size=200)
floor = bpy.context.object
floor.location.z = -.02
mat = bpy.data.materials.new('platform')
mat.diffuse_color = (.055, .10, .12, 1)
floor.data.materials.append(mat)

def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()

for location, power, size, color in [((-5,-5,11),2400,8,(1,.87,.65)), ((8,4,9),2000,7,(.63,.85,1))]:
    bpy.ops.object.light_add(type='AREA', location=location)
    light = bpy.context.object
    light.data.energy = power
    light.data.shape = 'DISK'
    light.data.size = size
    light.data.color = color
    aim(light, (0,2,1.7))

bpy.ops.object.camera_add(location=(11,-18,12))
camera = bpy.context.object
camera.data.type = 'ORTHO'
camera.location=(17,-25,21)
camera.data.ortho_scale = 35
aim(camera, (0,10,3))
scene.camera = camera
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = str(ROOT / 'artifacts/obstacles-preview.png')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'artifacts/obstacles-preview.blend'))
bpy.ops.render.render(write_still=True)
