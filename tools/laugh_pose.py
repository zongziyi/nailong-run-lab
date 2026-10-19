"""Shared belly-laugh authoring, used by both incremental and full conversion."""
import math
import bpy
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from slide_pose import smooth, settle_slide


def strength(seconds):
    return smooth(0, .16, seconds) * (1 - smooth(.67, .85, seconds))


BODY_CORRECTIVES={'LaughBody25':.25,'LaughBody50':.5,'LaughBody75':.75,'LaughBody100':1.0}


def belly_transform(sample):
    return Matrix.Identity(4)


def expression_weights(seconds):
    s=strength(seconds)
    return {'LaughExpression':s,**{name:max(0,1-abs(s-sample)*4) for name,sample in BODY_CORRECTIVES.items()}}


def _aim(rig, name, end):
    bone = rig.pose.bones[name]
    rest = bone.bone.matrix_local
    parent = bone.parent
    matrix = parent.matrix @ parent.bone.matrix_local.inverted() @ rest if parent else rest.copy()
    direction = (end - matrix.translation).normalized()
    rotation = (matrix.to_3x3() @ Vector((0, 1, 0))).rotation_difference(direction)
    bone.matrix = Matrix.Translation(matrix.translation) @ rotation.to_matrix().to_4x4() @ matrix.to_quaternion().to_matrix().to_4x4()
    bpy.context.view_layer.update()


def _two_bones(rig, upper, lower, target, pole):
    bone = rig.pose.bones[upper]
    matrix = bone.parent.matrix @ bone.parent.bone.matrix_local.inverted() @ bone.bone.matrix_local
    start = matrix.translation
    axis = target - start
    distance = max(.001, min(axis.length, bone.length + rig.pose.bones[lower].length - .001))
    axis.normalize()
    a, b = bone.length, rig.pose.bones[lower].length
    along = (a*a - b*b + distance*distance) / (2*distance)
    bend = pole - axis * pole.dot(axis)
    bend.normalize()
    elbow = start + axis*along + bend*math.sqrt(max(0, a*a-along*along))
    _aim(rig, upper, elbow)
    _aim(rig, lower, target)


def apply_laugh(rig, obj, seconds):
    pose = rig.pose.bones
    s = strength(seconds)
    phase = max(0, min(1, (seconds-.16)/.51))
    shake = math.sin(phase*math.tau*2) * s
    # Bow the round trunk as one volume. A small knee bend supports it without
    # spreading the hips into the wide, angular squat visible from behind.
    pose['Pelvis'].location[1] = -.24*s
    pose['Pelvis'].rotation_euler[0] = math.radians(60*s+.4*shake)
    pose['Chest'].rotation_euler[0] = math.radians(4*s+.7*shake)
    pose['Head'].rotation_euler[0] = math.radians(-3*s-.7*shake)
    bpy.context.view_layer.update()
    for side, sign in [('L', 1), ('R', -1)]:
        # Feet remain planted while the knees bend forwards under the body.
        ankle = rig.data.bones['Foot.'+side].head_local.copy()
        ankle.x+=sign*.08*s
        _two_bones(rig, 'Thigh.'+side, 'Shin.'+side, ankle, Vector((sign*.15, -1, 0)))
        foot=rig.data.bones['Foot.'+side].matrix_local.copy();foot.translation.x+=sign*.08*s
        pose['Foot.'+side].matrix = foot
        bpy.context.view_layer.update()
        chest = pose['Chest'].matrix @ pose['Chest'].bone.matrix_local.inverted()
        rest_wrist = chest @ rig.data.bones['Hand.'+side].head_local
        belly = pose['Pelvis'].matrix @ pose['Pelvis'].bone.matrix_local.inverted()
        wrist = rest_wrist.lerp(belly @ Vector((sign*.34, -.85, 1.35)), s)
        _two_bones(rig, 'UpperArm.'+side, 'Forearm.'+side, wrist, chest.to_3x3() @ Vector((sign*.65, -.35, -.65)))
        rest_tip = chest @ rig.data.bones['Hand.'+side].tail_local
        palm = rest_tip.lerp(belly @ Vector((sign*.16, -.90, 1.20)), s)
        _aim(rig, 'Hand.'+side, palm)
    # The rest limbs have a slight bend already. Fade the IK's local rotation
    # from that exact rest pose so the zero-weight endpoint is truly neutral.
    for bone in pose:
        if '.' not in bone.name:continue
        bone.rotation_euler=Quaternion().slerp(bone.rotation_euler.to_quaternion(),s).to_euler('XYZ')
        bone.location*=s
    bpy.context.view_layer.update()
    return s


def make_expression(rig, obj):
    """Close complete eye sockets; add expandable, head-skinned laugh details."""
    if obj.data.shape_keys:
        raise ValueError('Laugh authoring expects the neutral derived mesh, without existing shape keys')
    basis = obj.shape_key_add(name='Basis')
    expression = obj.shape_key_add(name='LaughExpression')
    mesh = obj.data
    adjacency = [[] for _ in mesh.vertices]
    for edge in mesh.edges:
        a,b = edge.vertices
        adjacency[a].append(b);adjacency[b].append(a)
    components=[];seen=set()
    for vertex in mesh.vertices:
        if vertex.index in seen:continue
        stack=[vertex.index];seen.add(vertex.index);component=[]
        while stack:
            vi=stack.pop();component.append(vi)
            for neighbor in adjacency[vi]:
                if neighbor not in seen:seen.add(neighbor);stack.append(neighbor)
        components.append(component)
    eyes=[ids for ids in components if len(ids)>100 and min(mesh.vertices[i].co.z for i in ids)>2.5]
    assert len(eyes)==4, 'Expected the four eye surfaces'
    eye_ids={i for ids in eyes for i in ids}
    centers={}
    for sign in [-1,1]:
        ids=[i for i in eye_ids if mesh.vertices[i].co.x*sign>0]
        center=sum((mesh.vertices[i].co for i in ids),Vector())/len(ids)
        centers[sign]=center
        for i in ids:
            co=expression.data[i].co
            co.z=center.z+(co.z-center.z)*.025
            co.x=center.x+(co.x-center.x)*.025
            co.y+=.12
    # A matching yellow lid covers each socket as the eye retracts. Keep the
    # surrounding shell intact so closing the eyes cannot crease the forehead.
    # A subtle lift at the mouth corners gives the shell an actual smile morph.
    for vertex in mesh.vertices:
        x,y,z=vertex.co
        if y<-.05 and 2.25<z<2.63 and abs(x)<.28:
            fade=(1-smooth(.17,.28,abs(x)))*(1-smooth(.08,.18,abs(z-2.46)))
            expression.data[vertex.index].co.z += .025*(abs(x)/.20-.35)*fade

    tree=BVHTree.FromPolygons([v.co for v in mesh.vertices],[list(p.vertices) for p in mesh.polygons])
    vertices=[];faces=[];material_ids=[];anchors=[]
    def surface(x,z,offset=.014):
        hit=tree.ray_cast(Vector((x,-4,z)),Vector((0,1,0)))[0]
        return Vector((x,(hit.y if hit else -.25)-offset,z))
    def add(coords,polygons,material,anchor):
        offset=len(vertices);vertices.extend(coords);anchors.extend([anchor]*len(coords))
        faces.extend([tuple(offset+i for i in p) for p in polygons]);material_ids.extend([material]*len(polygons))
    # Dark mouth follows the rounded face surface instead of floating as a card.
    count=48;mouth=[]
    for radius in [0,.5,1]:
        for i in range(count):
            angle=i/count*math.tau;x=.19*math.cos(angle)*radius
            z=2.465+(.135 if math.sin(angle)>0 else .155)*math.sin(angle)*radius+.025*(abs(x)/.19)**2
            mouth.append(surface(x,z,.019))
    polygons=[(i,(i+1)%count,count+(i+1)%count,count+i) for i in range(count)]
    polygons += [(count+i,count+(i+1)%count,2*count+(i+1)%count,2*count+i) for i in range(count)]
    mouth_anchor=Vector((0,-.12,2.47));add(mouth,polygons,0,mouth_anchor)
    # One curved tooth band, with rounded corners; a restrained lower tongue.
    for material,width,zbase,height in [(1,.157,2.56,.038),(2,.097,2.365,.024)]:
        coords=[]
        for row in [0,1]:
            for i in range(25):
                x=width*(i/12-1);z=zbase+.028*(1-(x/width)**2)-row*height*math.sqrt(max(0,1-(x/width)**2))
                coords.append(surface(x,z,.025))
        add(coords,[(i,i+1,26+i,25+i) for i in range(24)],material,mouth_anchor)
    for sign in [-1,1]:
        center=centers[sign];coords=[]
        def lid_y(x,z):
            radius=min(1,((x-center.x)/.108)**2+((z-center.z)/.118)**2)
            return -.245+sign*.55*(x-center.x)-.078*math.sqrt(max(0,1-radius))
        lid=[]
        for r in [0,.3,.65,1]:
            for i in range(48):
                a=i/48*math.tau;x=center.x+.108*r*math.cos(a);z=center.z+.118*r*math.sin(a)
                lid.append(Vector((x,lid_y(x,z),z)))
        add(lid,[(row*48+i,row*48+(i+1)%48,(row+1)*48+(i+1)%48,(row+1)*48+i) for row in range(3) for i in range(48)],3,Vector((center.x,-.12,center.z)))
        for i in range(25):
            x=center.x+.079*(i/12-1)
            z=center.z+.026*(1-((x-center.x)/.079)**2)
            for j in range(8):
                a=j/8*math.tau
                coords.append(Vector((x,lid_y(x,z)-.009+.007*math.cos(a),z+.007*math.sin(a))))
        add(coords,[(i*8+j,i*8+(j+1)%8,(i+1)*8+(j+1)%8,(i+1)*8+j) for i in range(24) for j in range(8)],0,Vector((center.x,-.12,center.z)))
    data=bpy.data.meshes.new('Laugh_Details');data.from_pydata(vertices,[],faces);data.update()
    details=bpy.data.objects.new('Laugh_Details',data);bpy.context.scene.collection.objects.link(details)
    for name,color in [('Laugh_Ink',(.028,.006,.009,1)),('Laugh_Teeth',(.96,.91,.77,1)),('Laugh_Tongue',(.62,.08,.10,1))]:
        mat=bpy.data.materials.get(name) or bpy.data.materials.new(name);mat.diffuse_color=color;mat.use_nodes=True
        mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=color
        mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.7
        data.materials.append(mat)
    data.materials.append(obj.data.materials[0])
    # Use the original yellow texel so the animated lids match the baked skin.
    uv=data.uv_layers.new(name='UVMap')
    sample=min(mesh.vertices,key=lambda v:abs(v.co.x)+abs(v.co.z-2.61)+max(0,v.co.y)*5)
    source_loop=next(loop for loop in mesh.loops if loop.vertex_index==sample.index)
    yellow_uv=mesh.uv_layers.active.data[source_loop.index].uv.copy()
    for loop in uv.data:loop.uv=yellow_uv
    for p,material in zip(data.polygons,material_ids):p.material_index=material;p.use_smooth=True
    group=details.vertex_groups.new(name='Head');group.add(list(range(len(vertices))),1,'REPLACE')
    modifier=details.modifiers.new('Laugh_Skin','ARMATURE');modifier.object=rig;details.parent=rig
    details.shape_key_add(name='Basis');target=details.shape_key_add(name='LaughExpression')
    for i,(point,anchor) in enumerate(zip(vertices,anchors)):
        data.shape_keys.key_blocks['Basis'].data[i].co=anchor
        target.data[i].co=point
    return details


def author_laugh(rig,obj):
    scene=bpy.context.scene;scene.render.fps=60
    rig.animation_data.action=None
    for track in list(rig.animation_data.nla_tracks):
        if track.name=='Laugh':rig.animation_data.nla_tracks.remove(track)
    old=bpy.data.objects.get('Laugh_Details')
    if old:
        mesh=old.data;bpy.data.objects.remove(old,do_unlink=True)
        if mesh.users==0:bpy.data.meshes.remove(mesh)
    if obj.data.shape_keys:
        keys=obj.data.shape_keys
        keys.animation_data_clear()
        for key in list(keys.key_blocks):
            if key.name=='LaughExpression' or key.name in BODY_CORRECTIVES:obj.shape_key_remove(key)
        if len(keys.key_blocks)==1:obj.shape_key_remove(keys.key_blocks[0])
    for name in ['Laugh','Nailong_Rounded_Laugh','Laugh_Details_Laugh']:
        old=bpy.data.actions.get(name)
        if old:bpy.data.actions.remove(old,do_unlink=True)
    for bone in rig.pose.bones:
        bone.rotation_mode='XYZ';bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
    bpy.context.view_layer.update()
    details=make_expression(rig,obj)
    rig.animation_data.action=None
    for track in rig.animation_data.nla_tracks:track.mute=True
    for bone in rig.pose.bones:
        bone.rotation_mode='XYZ';bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
    # Keep a continuous round barrel from the back through the belly. All of
    # the trunk follows the same forward bow, with soft joins to limbs/head.
    # This is Laugh-only pose correction; the neutral mesh stays unchanged.
    group_names={group.index:group.name for group in obj.vertex_groups}
    edges=np.array([edge.vertices[:] for edge in obj.data.edges],dtype=int)
    sources=np.concatenate((edges[:,0],edges[:,1]));neighbors=np.concatenate((edges[:,1],edges[:,0]))
    degree=np.bincount(sources,minlength=len(obj.data.vertices))
    # Four small pose-space corrections avoid applying a fully crouched foot
    # or belly correction to a half-bent pose, which would create sharp bulges.
    for name,sample in BODY_CORRECTIVES.items():
        low,high=0,.16
        for _ in range(24):
            middle=(low+high)/2
            if strength(middle)<sample:low=middle
            else:high=middle
        for bone in rig.pose.bones:
            bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
        apply_laugh(rig,obj,(low+high)/2)
        transforms={name:rig.pose.bones[name].matrix @ rig.data.bones[name].matrix_local.inverted()
                    for name in group_names.values()}
        pelvis=transforms['Pelvis'] @ belly_transform(sample);key=obj.shape_key_add(name=name,from_mix=False)
        targets=[];inverse_skin=[];fairing=[]
        for vertex in obj.data.vertices:
            x,y,z=vertex.co
            arm=sum(group.weight for group in vertex.groups if any(part in group_names[group.group] for part in ['Arm.','Hand.']))
            matrix=Matrix(((0,0,0,0),)*4)
            for group in vertex.groups:matrix += transforms[group_names[group.group]]*group.weight
            side='L' if vertex.co.x>=0 else 'R'
            sign=1 if x>=0 else -1
            # A continuous pose-space surface avoids twisting the broad thigh
            # into the pointed hip wings produced by this compact game rig.
            leg=vertex.co.copy()
            leg.x+=sign*.08*sample*(1-smooth(.55,1.0,z))
            leg.z-=.24*sample*smooth(.15,.90,z)
            trunk=pelvis @ vertex.co
            back=smooth(.02,.35,y)*smooth(.48,.85,z)
            target=leg.lerp(trunk,max(smooth(.40,1.0,z),back))
            if arm:
                # Wrap the lower arms forwards around the round barrel. Keep
                # elbows along the flanks, hidden hands resting at the front.
                hand=1-smooth(1.12,1.94,z)
                wrapped=vertex.co.copy()
                wrapped.x-=sign*.43*sample*hand
                wrapped.y-=.25*sample*hand
                wrapped.z+=.50*sample*hand
                target=target.lerp(pelvis @ wrapped,arm*smooth(.60,.85,abs(x)))
            targets.append(tuple(target));inverse_skin.append(matrix.inverted_safe())
            fairing.append(smooth(.30,.60,z)*(1-smooth(1.15,1.50,z))*smooth(-.05,.22,y)*(1-arm)*.7*sample)
        # Fair the back/upper-thigh join on the final surface. The source has
        # a narrow crotch and dense hip topology; skinning it into a bow must
        # not leave a pinched V crease across the broad rear silhouette.
        targets=np.array(targets);fairing=np.array(fairing)[:,None]
        for _ in range(90):
            sums=np.zeros_like(targets);np.add.at(sums,sources,targets[neighbors])
            mean=sums/np.maximum(1,degree)[:,None]
            targets+=(mean-targets)*fairing
        for vertex,point,inverse in zip(key.data,targets,inverse_skin):vertex.co=inverse @ Vector(point)
    for frame in range(52):
        scene.frame_set(frame)
        for bone in rig.pose.bones:
            bone.rotation_mode='XYZ';bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
        apply_laugh(rig,obj,frame/60)
        for mesh in [obj,details]:
            for name,value in expression_weights(frame/60).items():
                key=mesh.data.shape_keys.key_blocks.get(name)
                if key:key.value=value
        # Settle the final corrected surface, not the uncorrected skin from
        # the preceding frame. Otherwise its root offset leaks into the pose.
        settle_slide(bpy,rig,obj,strength(frame/60))
        for bone in rig.pose.bones:
            for channel in ['location','rotation_euler','scale']:bone.keyframe_insert(channel,frame=frame,group=bone.name)
        for mesh in [obj,details]:
            for key in mesh.data.shape_keys.key_blocks:
                if key.name!='Basis':key.keyframe_insert('value',frame=frame)
    action=rig.animation_data.action;action.name='Laugh';action.use_fake_user=True
    track=rig.animation_data.nla_tracks.new();track.name='Laugh';track.strips.new('Laugh',0,action);track.mute=True
    rig.animation_data.action=None
    for mesh in [obj,details]:
        keys=mesh.data.shape_keys;action=keys.animation_data.action;action.name=mesh.name+'_Laugh';action.use_fake_user=True
        track=keys.animation_data.nla_tracks.new();track.name='Laugh';track.strips.new('Laugh',0,action);track.mute=True
        keys.animation_data.action=None
        for key in keys.key_blocks:key.value=0
    for bone in rig.pose.bones:bone.location=(0,0,0);bone.rotation_euler=(0,0,0);bone.scale=(1,1,1)
    scene.frame_set(0);bpy.context.view_layer.update()
    return details
