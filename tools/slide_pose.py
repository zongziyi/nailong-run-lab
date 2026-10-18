"""Shared slide-tackle pose for the editable asset and reproducible converter."""
import math

def smooth(a,b,t):
    t=max(0,min(1,(t-a)/(b-a)))
    return t*t*(3-2*t)

def apply_slide(pose,seconds):
    s=smooth(0,.16,seconds)*(1-smooth(.67,.85,seconds))
    pose['Root'].rotation_euler[0]=math.radians(-88*s)
    pose['Pelvis'].rotation_euler[0]=math.radians(2*s)
    pose['Chest'].rotation_euler[0]=math.radians(-4*s)
    pose['Head'].rotation_euler[0]=math.radians(14*s)
    # One extended leg, one drawn-up knee; arms provide lateral balance.
    for side,sign in [('L',1),('R',-1)]:
        pose['Thigh.'+side].rotation_euler[0]=math.radians((28 if side=='L' else -28)*s)
        pose['Shin.'+side].rotation_euler[0]=math.radians((0 if side=='L' else 58)*s)
        pose['Foot.'+side].rotation_euler[0]=math.radians(-8*s)
        pose['UpperArm.'+side].rotation_euler=(math.radians(-10*s),math.radians(sign*24*s),0)
        pose['Forearm.'+side].rotation_euler[0]=math.radians(-24*s)
    return s

def settle_slide(bpy,rig,obj,strength):
    bpy.context.view_layer.update()
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    points=[evaluated.matrix_world@v.co for v in evaluated.data.vertices]
    root=rig.pose.bones['Root']
    # Root's local Y is world Z; local Z is world -Y. Keep the visual footprint
    # centered on the controller while the torso leans back and the leg extends.
    root.location[1]+=.018*strength-min(p.z for p in points)
    root.location[2]+=(min(p.y for p in points)+max(p.y for p in points))*.5*strength
    bpy.context.view_layer.update()
