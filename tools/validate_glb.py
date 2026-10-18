"""Inspect the actual exported binary (no browser or .blend assumptions)."""
import json, struct, hashlib, math
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
raw=(ROOT/'assets/nailong-rounded.glb').read_bytes()
magic,version,length=struct.unpack_from('<III',raw)
assert magic==0x46546C67 and version==2 and length==len(raw)
json_len,json_type=struct.unpack_from('<II',raw,12)
doc=json.loads(raw[20:20+json_len]);start=20+json_len
bin_len,bin_type=struct.unpack_from('<II',raw,start);binary=raw[start+8:start+8+bin_len]
TYPES={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
COUNTS={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def access(idx):
    a=doc['accessors'][idx];view=doc['bufferViews'][a['bufferView']];dtype=np.dtype(TYPES[a['componentType']]);n=COUNTS[a['type']]
    offset=view.get('byteOffset',0)+a.get('byteOffset',0);stride=view.get('byteStride',dtype.itemsize*n)
    result=np.ndarray((a['count'],n),dtype=dtype,buffer=binary,offset=offset,strides=(stride,dtype.itemsize)).copy()
    if a.get('normalized') and dtype.kind in 'ui':result=result.astype(float)/np.iinfo(dtype).max
    assert np.isfinite(result).all()
    return result
nodes=doc['nodes'];parents={}
for i,node in enumerate(nodes):
    for child in node.get('children',[]):parents[child]=i
mesh_node=next(i for i,n in enumerate(nodes) if 'mesh' in n and 'skin' in n)
skin=doc['skins'][nodes[mesh_node]['skin']]
primitive=doc['meshes'][nodes[mesh_node]['mesh']]['primitives'][0]
attrs=primitive['attributes'];positions=access(attrs['POSITION']);joints=access(attrs['JOINTS_0']).astype(int);weights=access(attrs['WEIGHTS_0'])
indices=access(primitive['indices']).reshape(-1)
assert indices.max()<len(positions) and joints.max()<len(skin['joints'])
assert np.max(np.abs(weights.sum(axis=1)-1))<1e-4
assert np.min(weights)>=0
assert set(a['name'] for a in doc.get('animations',[]))=={'Idle','Run','Jump','Slide'}
assert len(skin['joints'])==16
assert len(doc.get('images',[]))==1 and 'bufferView' in doc['images'][0]
inverse_bind=access(skin['inverseBindMatrices']).reshape(-1,4,4).transpose(0,2,1)
homogeneous=np.column_stack([positions,np.ones(len(positions))])
def matrix(t,q,s):
    x,y,z,w=q
    result=np.eye(4)
    result[:3,:3]=np.array([[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]])@np.diag(s)
    result[:3,3]=t;return result
def deform(animation=None,time=0):
    transforms=[{'translation':np.array(n.get('translation',[0,0,0]),float),'rotation':np.array(n.get('rotation',[0,0,0,1]),float),'scale':np.array(n.get('scale',[1,1,1]),float)} for n in nodes]
    if animation:
        for channel in animation['channels']:
            sampler=animation['samplers'][channel['sampler']];times=access(sampler['input']).reshape(-1);values=access(sampler['output'])
            assert np.all(np.diff(times)>0)
            hi=min(max(1,int(np.searchsorted(times,time,side='right'))),len(times)-1);lo=hi-1
            u=max(0,min(1,float((time-times[lo])/(times[hi]-times[lo]))))
            a,b=values[lo],values[hi]
            path=channel['target']['path']
            if path=='rotation' and np.dot(a,b)<0:b=-b
            val=a if sampler.get('interpolation')=='STEP' else a*(1-u)+b*u
            if path=='rotation':val=val/np.linalg.norm(val)
            transforms[channel['target']['node']][path]=val
    worlds={}
    def world(i):
        if i in worlds:return worlds[i]
        n=nodes[i];v=transforms[i]
        local=np.array(n['matrix']).reshape(4,4).T if 'matrix' in n else matrix(v['translation'],v['rotation'],v['scale'])
        worlds[i]=(world(parents[i])@local) if i in parents else local
        return worlds[i]
    matrices=np.stack([world(i)@inverse_bind[j] for j,i in enumerate(skin['joints'])])
    skinned=np.einsum('nvij,nj->nvi',matrices[joints],homogeneous)
    return (skinned*weights[:,:,None]).sum(axis=1)[:,:3]
rest=deform()
triangles=indices.reshape(-1,3)
edges=np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]])
base_lengths=np.linalg.norm(rest[edges[:,0]]-rest[edges[:,1]],axis=1)
valid=base_lengths>.015
summary=[]
for animation in doc['animations']:
    duration=max(access(s['input'])[-1,0] for s in animation['samplers'])
    snapshots=[]
    for phase in [0,.25,.5,.75,1]:
        pts=deform(animation,float(duration)*phase)
        assert np.isfinite(pts).all() and np.max(np.abs(pts))<6
        stretches=np.linalg.norm(pts[edges[valid,0]]-pts[edges[valid,1]],axis=1)/base_lengths[valid]
        assert stretches.max()<5, 'Extreme skinning stretch detected'
        entry={'phase':phase,'dimensions':np.round(np.ptp(pts,axis=0),4).tolist(),'edge_stretch_p99':round(float(np.quantile(stretches,.99)),4),'max_edge_stretch':round(float(stretches.max()),4)}
        if phase==.5:
            selected=edges[valid][np.argsort(stretches)[-3:]]
            entry['largest_edges']=[{'rest':np.round(rest[pair],4).tolist(),'posed':np.round(pts[pair],4).tolist(),'joints':[[nodes[skin['joints'][int(j)]]['name'] for j in joints[i]] for i in pair],'weights':weights[pair].tolist()} for pair in selected]
        snapshots.append(entry)
    summary.append({'name':animation['name'],'duration':round(float(duration),4),'channels':len(animation['channels']),'samples':snapshots})
report={'status':'PASS','bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'source_sha256':hashlib.sha256((ROOT/'assets/source/nailong_colored.blend').read_bytes()).hexdigest(),'vertices_after_uv_splits':len(positions),'triangles':len(indices)//3,'joints':len(skin['joints']),'max_weight_sum_error':float(np.max(np.abs(weights.sum(axis=1)-1))),'embedded_images':len(doc['images']),'animations':summary}
expected_durations={'Idle':2,'Run':.8,'Jump':.9,'Slide':.85}
for entry in summary:assert abs(entry['duration']-expected_durations[entry['name']])<.001
slide=next(a for a in doc['animations'] if a['name']=='Slide')
stable=[]
for time in np.linspace(.20,.65,28):
    pts=deform(slide,float(time))*.8
    assert pts[:,1].min()>-.002,'Slide penetrates the ground'
    assert pts[:,1].max()<=1.35,'Visible slide pose exceeds the configured height'
    stable.append(float(pts[:,1].max()))
report['slide_stable_window']={'samples':len(stable),'scaled_max_top':max(stable),'collider_height':1.35}
# Inspect every authored Idle frame, including loop closure. UV seams duplicate
# exported vertices, but copies of the repaired center shell must move together
# and retain matching smooth normals so neither cracks nor dark lines return.
center=np.flatnonzero(np.abs(positions[:,0])<1e-6)
_,inverse=np.unique(positions[center],axis=0,return_inverse=True)
first={};pairs=[]
for index,group in zip(center,inverse):
    if group in first:pairs.append((first[group],index))
    else:first[group]=index
pairs=np.asarray(pairs,dtype=int)
assert len(pairs)>0,'Expected UV-split center vertices'
normals=access(attrs['NORMAL'])
normal_gap=float(np.max(np.linalg.norm(normals[pairs[:,0]]-normals[pairs[:,1]],axis=1)))
assert normal_gap<1e-4,'Discontinuous center normals can produce a dark seam'
idle=next(a for a in doc['animations'] if a['name']=='Idle')
max_seam_gap=0.0
for time in np.linspace(0,2,121):
    pts=deform(idle,float(time))
    assert np.isfinite(pts).all()
    max_seam_gap=max(max_seam_gap,float(np.max(np.linalg.norm(pts[pairs[:,0]]-pts[pairs[:,1]],axis=1))))
assert max_seam_gap<1e-5,'The center shell opens during Idle'
loop_gap=float(np.max(np.linalg.norm(deform(idle,0)-deform(idle,2),axis=1)))
assert loop_gap<1e-5,'Idle does not loop continuously'
report['idle_full_cycle']={'samples':121,'seconds':2,'center_uv_pairs':len(pairs),
    'max_center_normal_gap':normal_gap,'max_center_position_gap':max_seam_gap,'loop_gap':loop_gap}
(ROOT/'artifacts/glb-validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
