import bpy, json, math
from mathutils import Vector
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets/source/nailong_colored.blend'))
report = {'blender': bpy.app.version_string, 'objects': []}
for obj in bpy.data.objects:
    entry = {'name': obj.name, 'type': obj.type, 'location': list(obj.location), 'scale': list(obj.scale), 'rotation': list(obj.rotation_euler)}
    if obj.type == 'MESH':
        mesh = obj.data
        entry['vertices'] = len(mesh.vertices)
        entry['modifiers'] = [{'name':m.name,'type':m.type} for m in obj.modifiers]
        entry['faces'] = len(mesh.polygons)
        points = [obj.matrix_world @ v.co for v in mesh.vertices]
        entry['bounds'] = [[min(v[i] for v in points), max(v[i] for v in points)] for i in range(3)]
        entry['materials'] = []
        for idx, mat in enumerate(mesh.materials):
            faces = [p for p in mesh.polygons if p.material_index == idx]
            vi = set(v for p in faces for v in p.vertices)
            ps = [points[i] for i in vi]
            entry['materials'].append({'name': mat.name, 'face_count': len(faces), 'center': list(sum(ps, Vector()) / len(ps)) if ps else None,
              'nodes': [{'name':n.name, 'type':n.type, 'inputs': {s.name: list(s.default_value) if hasattr(s.default_value, '__len__') else s.default_value for s in n.inputs if hasattr(s, 'default_value') and not isinstance(s.default_value, bpy.types.ID)}} for n in mat.node_tree.nodes] if mat.use_nodes else [],
              'links': [f'{l.from_node.name}.{l.from_socket.name} -> {l.to_node.name}.{l.to_socket.name}' for l in mat.node_tree.links] if mat.use_nodes else []})
        adjacency = [[] for _ in mesh.vertices]
        for edge in mesh.edges:
            a,b = edge.vertices
            adjacency[a].append(b); adjacency[b].append(a)
        seen=set(); components=[]
        for start in range(len(points)):
            if start in seen: continue
            stack=[start]; seen.add(start); ids=[]
            while stack:
                v=stack.pop();ids.append(v)
                for n in adjacency[v]:
                    if n not in seen:seen.add(n);stack.append(n)
            ps=[points[i] for i in ids]
            components.append({'count':len(ids),'center':list(sum(ps,Vector())/len(ps)),'bounds':[[min(v[i] for v in ps),max(v[i] for v in ps)] for i in range(3)]})
        entry['components']=sorted(components,key=lambda c:-c['count'])[:30]
    report['objects'].append(entry)
(ROOT/'artifacts/source-inspection.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('MODEL_REPORT',json.dumps(report,ensure_ascii=False))
