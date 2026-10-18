"""Local mesh corrections shared by full conversion and the appearance updater."""
import bmesh
import math
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree

REVISION = 1
EYE_INSET = .02


def repair_center_seam(obj):
    """Remove collapsed mirror caps, leaving the existing outer shell intact."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    caps = [face for face in bm.faces
            if all(abs(vertex.co.x) < 1e-6 for vertex in face.verts)]
    removed = len(caps)
    if caps:
        bmesh.ops.delete(bm, geom=caps, context='FACES_ONLY')
        loose = [vertex for vertex in bm.verts if not vertex.link_faces]
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    center = [vertex for vertex in bm.verts if abs(vertex.co.x) < 1e-6]
    bmesh.ops.remove_doubles(bm, verts=center, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    open_center = [edge for edge in bm.edges if edge.is_boundary
                   and all(abs(vertex.co.x) < 1e-6 for vertex in edge.verts)]
    assert not open_center, 'The center shell must be closed after removing mirror caps'
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return {'removed_center_faces': removed, 'center_boundary_edges': len(open_center)}


def move_eyes_inward(obj, inset=EYE_INSET):
    """Move complete eyes around the head and blend their socket collars locally.

    The eye sockets are real openings in the source shell. Moving only the four
    detached eye surfaces would reveal a crescent-shaped hole at their edges.
    Rotate each eye and its socket together, fading the socket motion to zero in
    a small collar. UVs, rig weights, head crown and body outline are retained.
    """
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.verts.ensure_lookup_table()
    visited = set()
    components = []
    for vertex in bm.verts:
        if vertex in visited:
            continue
        stack = [vertex]
        visited.add(vertex)
        component = []
        while stack:
            current = stack.pop()
            component.append(current)
            for edge in current.link_edges:
                neighbor = edge.other_vert(current)
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        components.append(component)
    body = max(components, key=len)
    eyes = [component for component in components if component is not body
            and len(component) > 100
            and min(vertex.co.z for vertex in component) > 2.5]
    assert len(eyes) == 4, 'Expected two complete outer eyes and two pupils'
    original = {vertex: vertex.co.copy() for vertex in bm.verts}
    report = []
    for sign in [-1, 1]:
        side_eyes = [component for component in eyes
                     if sum(vertex.co.x for vertex in component) * sign > 0]
        assert len(side_eyes) == 2
        outer = max(side_eyes, key=lambda component:
                    max(vertex.co.x for vertex in component)
                    - min(vertex.co.x for vertex in component))
        center = sum((original[vertex] for vertex in outer), Vector()) / len(outer)
        radius = math.hypot(center.x, center.y)
        new_x = center.x - sign * inset
        new_y = -math.sqrt(radius * radius - new_x * new_x)
        angle = math.atan2(new_y, new_x) - math.atan2(center.y, center.x)
        rotation = Matrix.Rotation(angle, 3, 'Z')
        pivot = Vector((0, 0, center.z))
        socket = [vertex for vertex in body if vertex.is_boundary
                  and original[vertex].x * sign > 0 and original[vertex].z > 2.5]
        assert len(socket) == 48, 'Expected the original eye socket boundary'
        tree = KDTree(len(socket))
        for index, vertex in enumerate(socket):
            tree.insert(original[vertex], index)
        tree.balance()
        for component in side_eyes:
            for vertex in component:
                vertex.co = pivot + rotation @ (original[vertex] - pivot)
        for vertex in body:
            point = original[vertex]
            if point.x * sign <= 0 or point.z < 2.5:
                continue
            _, _, distance = tree.find(point)
            # A rigid socket rim followed by a C1 continuous collar.
            t = min(1, max(0, (distance - .008) / .092))
            blend = 1 - t * t * (3 - 2 * t)
            if blend > 0:
                target = pivot + rotation @ (point - pivot)
                vertex.co = point.lerp(target, blend)
        report.append({'side': 'L' if sign > 0 else 'R',
                       'inset': inset, 'rotation_degrees': math.degrees(angle),
                       'center_before': list(center),
                       'center_after': list(pivot + rotation @ (center - pivot)),
                       'socket_vertices': len(socket)})
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj['appearance_revision'] = REVISION
    return report
