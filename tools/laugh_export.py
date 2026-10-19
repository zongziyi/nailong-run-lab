"""Finalize the GLB's shared laugh weight curve and smooth UV-split normals.

Blender's NLA export can sample KEY tracks as constant zero when merging them
with an armature track. Write the same authored 60 Hz envelope explicitly, and
check the exported asset in CPU tests instead of relying on exporter settings.
"""
import json, struct
import numpy as np
from laugh_pose import expression_weights, BODY_CORRECTIVES, strength, apply_laugh


def pose_normals(doc, floats):
    """Export normals of the final bent surface, then undo GPU skin rotation.

    Computing normals on the inverse-skinned corrective itself gives dark
    folds that are absent from the final mesh. Three.js skins normals with
    the weighted joint matrix, so invert that matrix for each authored pose.
    """
    import bpy
    from mathutils.kdtree import KDTree
    rig=bpy.data.objects['Nailong_Rig'];obj=bpy.data.objects['Nailong_Rounded']
    names={g.index:g.name for g in obj.vertex_groups}
    node=next(n for n in doc['nodes'] if n.get('name')=='Nailong_Rounded')
    mesh=doc['meshes'][node['mesh']]
    source=KDTree(len(obj.data.vertices))
    for v in obj.data.vertices:source.insert(v.co,v.index)
    source.balance()
    conversion=np.array([[1,0,0],[0,0,1],[0,-1,0]],dtype=float)
    for name,sample in BODY_CORRECTIVES.items():
        low,high=0,.16
        for _ in range(24):
            middle=(low+high)/2
            if strength(middle)<sample:low=middle
            else:high=middle
        for bone in rig.pose.bones:
            bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
        apply_laugh(rig,obj,(low+high)/2)
        for key in obj.data.shape_keys.key_blocks:key.value=float(key.name==name)
        bpy.context.view_layer.update()
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        surface=evaluated.to_mesh()
        transforms={b.name:np.array((b.matrix@b.bone.matrix_local.inverted()).to_3x3()) for b in rig.pose.bones}
        matrices=np.array([sum((transforms[names[g.group]]*g.weight for g in v.groups),np.zeros((3,3))) for v in obj.data.vertices])
        normals=np.array([v.normal for v in surface.vertices])
        unskinned=np.linalg.solve(matrices,normals[...,None])[...,0]
        unskinned/=np.maximum(1e-12,np.linalg.norm(unskinned,axis=1))[:,None]
        evaluated.to_mesh_clear()
        for primitive in mesh['primitives']:
            positions=floats(primitive['attributes']['POSITION'])
            matches=[source.find(conversion.T@point) for point in positions]
            assert max(match[2] for match in matches)<1e-5,'Exported rest vertices must match the authored mesh'
            indices=[match[1] for match in matches]
            target=primitive['targets'][mesh['extras']['targetNames'].index(name)]
            floats(target['NORMAL'])[:]=unskinned[indices]@conversion.T-floats(primitive['attributes']['NORMAL'])
    for bone in rig.pose.bones:
        bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
    for key in obj.data.shape_keys.key_blocks:key.value=0
    bpy.context.view_layer.update()


def finish_laugh_export(path):
    raw=path.read_bytes();size=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+size]);start=28+size
    binary=bytearray(raw[start:start+doc['buffers'][0]['byteLength']])
    def floats(index):
        accessor=doc['accessors'][index];view=doc['bufferViews'][accessor['bufferView']]
        count={'SCALAR':1,'VEC3':3}[accessor['type']]
        return np.ndarray((accessor['count'],count),dtype='<f4',buffer=binary,
                          offset=view.get('byteOffset',0)+accessor.get('byteOffset',0),
                          strides=(view.get('byteStride',count*4),4))
    pose_normals(doc,floats)
    # All body faces are smooth. UV copies of the repaired centre shell must
    # retain identical base AND morphed normals after adding shape keys.
    body=next(n for n in doc['nodes'] if n.get('name')=='Nailong_Rounded')
    for primitive in doc['meshes'][body['mesh']]['primitives']:
        positions=floats(primitive['attributes']['POSITION'])
        normals=floats(primitive['attributes']['NORMAL'])
        centre=np.flatnonzero(np.abs(positions[:,0])<1e-6)
        _,inverse=np.unique(positions[centre],axis=0,return_inverse=True)
        original=normals.copy()
        for group in range(int(inverse.max())+1):
            ids=centre[inverse==group]
            if len(ids)<2:continue
            average=original[ids].mean(axis=0);average/=max(1e-12,np.linalg.norm(average))
            normals[ids]=average
            for target in primitive.get('targets',[]):
                if 'NORMAL' not in target:continue
                delta=floats(target['NORMAL']);target_normal=(original[ids]+delta[ids]).mean(axis=0)
                target_normal/=max(1e-12,np.linalg.norm(target_normal))
                delta[ids]=target_normal-average
    # Release buffer views before growing the binary bytearray.
    del positions,normals,original
    def append(values):
        while len(binary)%4:binary.append(0)
        offset=len(binary);binary.extend(struct.pack('<'+'f'*len(values),*values))
        view=len(doc['bufferViews']);doc['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(values)*4})
        accessor=len(doc['accessors']);doc['accessors'].append({'bufferView':view,'componentType':5126,'count':len(values),'type':'SCALAR','min':[min(values)],'max':[max(values)]})
        return accessor
    # NumPy views may still reference the buffer. Append to a fresh bytearray.
    binary=bytearray(binary)
    times=append([frame/60 for frame in range(52)])
    clip=next(a for a in doc['animations'] if a['name']=='Laugh')
    channels=[c for c in clip['channels'] if c['target']['path']=='weights']
    assert len(channels)==2,'Both the body and head details need the laugh envelope'
    for channel in channels:
        mesh=doc['meshes'][doc['nodes'][channel['target']['node']]['mesh']]
        names=mesh['extras']['targetNames']
        weights=append([expression_weights(frame/60)[name] for frame in range(52) for name in names])
        sampler=len(clip['samplers']);clip['samplers'].append({'input':times,'output':weights,'interpolation':'LINEAR'})
        channel['sampler']=sampler
    doc['buffers'][0]['byteLength']=len(binary)
    json_bytes=json.dumps(doc,separators=(',',':')).encode('utf-8')
    json_bytes+=b' '*((-len(json_bytes))%4);binary+=b'\0'*((-len(binary))%4)
    total=12+8+len(json_bytes)+8+len(binary)
    path.write_bytes(struct.pack('<III',0x46546c67,2,total)+struct.pack('<II',len(json_bytes),0x4e4f534a)+json_bytes+struct.pack('<II',len(binary),0x004e4942)+binary)
