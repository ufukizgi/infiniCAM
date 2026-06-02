import cadquery as cq
import math

# Create a star profile by sweeping a star shape
# We'll just create a box rotated by 45 degrees to simulate an angled face
profile = cq.Workplane("XY").box(100, 100, 100).rotate((0,0,0), (0,0,1), 45)

# Create a pentagonal tool
# Tool direction should be perpendicular to one of the 45-degree faces
# The face normal is (sqrt(2)/2, sqrt(2)/2, 0)
dir_vec_true = [math.sqrt(2)/2, math.sqrt(2)/2, 0]

# Create tool
tool = cq.Workplane("XY").polygon(5, 20).extrude(30)
# Orient tool to point along dir_vec_true
# Default extrude is along Z. We need to rotate Z to dir_vec_true.
# Wait,
# Let's just create the tool explicitly.
tool = cq.Workplane(cq.Plane(origin=(50*math.sqrt(2), 0, 50), normal=dir_vec_true)).polygon(5, 20).extrude(-20)

chip = profile.intersect(tool).val()

# Now find dir_vec!
candidate_dirs = []
for e in chip.Edges():
    if e.geomType() == "LINE":
        p1 = e.positionAt(0.0)
        p2 = e.positionAt(1.0)
        d = p2 - p1
        if d.Length > 1e-5:
            d = d.normalized()
            # Check if it's already in candidates (ignoring sign)
            found = False
            for c in candidate_dirs:
                if abs(c.dot(d)) > 0.99:
                    found = True
                    break
            if not found:
                candidate_dirs.append(d)

print(f"Found {len(candidate_dirs)} candidate directions.")

best_dir = None
max_score = -1

for d in candidate_dirs:
    score = 0
    area_score = 0
    for f in chip.Faces():
        try:
            n = f.normalAt(None)
            if abs(n.dot(d)) < 0.1: # Face is parallel to D
                score += 1
                area_score += f.Area()
        except:
            pass
    print(f"Dir ({d.x:.3f}, {d.y:.3f}, {d.z:.3f}) matches {score} faces, area {area_score:.1f}")
    if score > max_score or (score == max_score and area_score > max_score_area):
        max_score = score
        max_score_area = area_score
        best_dir = d

print(f"True dir: ({dir_vec_true[0]:.3f}, {dir_vec_true[1]:.3f}, {dir_vec_true[2]:.3f})")
print(f"Best dir: ({best_dir.x:.3f}, {best_dir.y:.3f}, {best_dir.z:.3f})")

