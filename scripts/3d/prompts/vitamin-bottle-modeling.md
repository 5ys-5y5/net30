You are controlling Blender through the official Blender MCP server.

All file reads and writes for this task must stay under:

/Users/gy/Documents/dev/net30-3d-assets

Reference front image:

/Users/gy/Documents/dev/net30-3d-assets/reference/vitamin-bottle/front.jpg

Source Blender file:

/Users/gy/Documents/dev/net30-3d-assets/blender/vitamin-bottle/source/vitamin-bottle.blend

Render GLB export:

/Users/gy/Documents/dev/net30-3d-assets/exports/render/vitamin-bottle-render.glb

Physics GLB export:

/Users/gy/Documents/dev/net30-3d-assets/exports/physics/vitamin-bottle-collider.glb

QA renders:

/Users/gy/Documents/dev/net30-3d-assets/qa/renders

Create a production-quality vitamin bottle asset using these rules.

1. Set the scene unit system to metric and use meters.

2. Create these top-level collections:

RENDER_EXPORT
PHYSICS_EXPORT
WORKING
QA

3. Build the render bottle in RENDER_EXPORT.

Required render objects:

BottleOuter
BottleInner
BottleBottom
BottleLip
BottleThread
CapBluePP
CapTamperRing
LabelFront
LabelBack

4. Reconstruct the glass bottle from the reference silhouette.

Do not approximate the shoulder or body using a small number of long straight profile segments.

Use a smooth Bezier or NURBS side profile with sufficient control points, then revolve it around the vertical Y axis.

The bottle must have:

a smooth outer shell
a separate inner shell
real wall thickness
a substantially thicker bottom
a closed watertight glass volume
a short GL45-style neck
three thread rings
smooth shoulder curvature
correctly applied transforms
consistent outward normals

5. The cap must be fully opaque polypropylene.

The cap must hide the bottle neck and opening behind it.

Create actual radial ribs around the cap.

Use at least 64 evenly spaced ribs.

The cap material must have zero transmission and no alpha transparency.

6. Create a PBR glass material suitable for glTF export.

Use:

Transmission 1.0
IOR approximately 1.52
very low roughness
subtle blue-gray attenuation
physically meaningful volume thickness
no fake global opacity

7. Create LabelFront and LabelBack as separate slightly curved meshes.

Do not join them into a continuous wraparound strip.

They must follow the bottle curvature but remain independent.

Do not bake UI text into the model. The web service supplies the actual front and back textures.

8. Build a physically simplified closed collider in PHYSICS_EXPORT.

Required physics objects:

COL_Body
COL_Shoulder
COL_Neck
COL_Bottom
COL_TopStopper

The collider must form a closed interior vessel so dynamic vitamins cannot escape through the body, neck, bottom, or cap.

Do not reuse the high-poly glass mesh as the runtime collider.

9. Keep all object origins on the same bottle center axis.

The render model and physics model must use the same world origin, scale, and Y-up orientation.

10. Create QA_CAMERA_FRONT as an orthographic front camera.

Create neutral white studio lighting and render a 450 by 450 PNG against the reference image.

Iteratively adjust silhouette, cap proportion, neck height, shoulder curvature, body width, and bottom curvature.

11. Validate before export:

render glass volume is manifold
physics collider is closed
no non-manifold edges
normals are correct
no unapplied scale
no negative scale
no absolute texture paths
all required object and collection names exist

12. Save the working Blender file to:

/Users/gy/Documents/dev/net30-3d-assets/blender/vitamin-bottle/source/vitamin-bottle.blend

13. Export RENDER_EXPORT to:

/Users/gy/Documents/dev/net30-3d-assets/exports/render/vitamin-bottle-render.glb

14. Export PHYSICS_EXPORT to:

/Users/gy/Documents/dev/net30-3d-assets/exports/physics/vitamin-bottle-collider.glb

15. Save front, side, three-quarter, wireframe, and silhouette QA renders under:

/Users/gy/Documents/dev/net30-3d-assets/qa/renders

Report the exact file paths, polygon counts, dimensions, manifold status, and any remaining uncertainty.
