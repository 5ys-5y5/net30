#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import numpy as np
import trimesh
from scipy.interpolate import PchipInterpolator

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "models" / "reference-vial.glb"

# Units are metres. The profile is calibrated to the supplied 450 x 450 reference.
# The bottle body diameter is 56 mm; cap outer diameter is 53.6 mm.
OUTER = np.array([
    [0.0215, 0.0000],
    [0.0252, 0.0007],
    [0.0272, 0.0025],
    [0.0280, 0.0050],
    [0.0280, 0.0150],
    [0.0280, 0.0300],
    [0.0280, 0.0450],
    [0.0278, 0.0540],
    [0.0268, 0.0600],
    [0.0248, 0.0650],
    [0.0215, 0.0700],
    [0.0180, 0.0740],
    [0.0156, 0.0770],
    [0.0152, 0.0790],
    [0.0152, 0.0900],
    [0.0158, 0.0925],
    [0.0164, 0.0940],
], dtype=float)

INNER = np.array([
    [0.0208, 0.0045],
    [0.0238, 0.0054],
    [0.0257, 0.0072],
    [0.0260, 0.0100],
    [0.0260, 0.0250],
    [0.0260, 0.0420],
    [0.0257, 0.0540],
    [0.0244, 0.0600],
    [0.0217, 0.0660],
    [0.0185, 0.0705],
    [0.0154, 0.0745],
    [0.0134, 0.0780],
    [0.0130, 0.0800],
    [0.0130, 0.0900],
], dtype=float)


def smooth_profile(points: np.ndarray, samples: int = 96) -> np.ndarray:
    y = points[:, 1]
    r = points[:, 0]
    # PCHIP preserves shape and avoids the long straight facets seen in previous versions.
    f = PchipInterpolator(y, r)
    ys = np.linspace(float(y.min()), float(y.max()), samples)
    return np.column_stack([f(ys), ys])


def lathe_surface(profile: np.ndarray, segments: int = 256, reverse: bool = False) -> tuple[np.ndarray, np.ndarray]:
    rows = len(profile)
    vertices: list[list[float]] = []
    for radius, y in profile:
        for i in range(segments):
            a = 2.0 * np.pi * i / segments
            vertices.append([radius * np.cos(a), y, radius * np.sin(a)])
    faces: list[list[int]] = []
    for row in range(rows - 1):
        for i in range(segments):
            ni = (i + 1) % segments
            a = row * segments + i
            b = row * segments + ni
            c = (row + 1) * segments + i
            d = (row + 1) * segments + ni
            tri = [[a, c, b], [b, c, d]]
            if reverse:
                tri = [list(reversed(t)) for t in tri]
            faces.extend(tri)
    return np.asarray(vertices), np.asarray(faces)


def create_glass_volume() -> trimesh.Trimesh:
    outer = smooth_profile(OUTER)
    inner = smooth_profile(INNER)
    ov, of = lathe_surface(outer, reverse=False)
    iv, inf = lathe_surface(inner, reverse=True)
    offset = len(ov)
    vertices = np.vstack([ov, iv])
    faces = np.vstack([of, inf + offset])
    segments = 256

    # Connect the lip of the outer and inner surfaces.
    outer_top = (len(outer) - 1) * segments
    inner_top = offset + (len(inner) - 1) * segments
    lip = []
    for i in range(segments):
        ni = (i + 1) % segments
        lip.extend([
            [outer_top + i, inner_top + i, outer_top + ni],
            [outer_top + ni, inner_top + i, inner_top + ni],
        ])
    faces = np.vstack([faces, np.asarray(lip)])

    # Connect the thick glass bottom between the outer and inner first rings.
    bottom = []
    outer_bottom = 0
    inner_bottom = offset
    for i in range(segments):
        ni = (i + 1) % segments
        bottom.extend([
            [outer_bottom + i, outer_bottom + ni, inner_bottom + i],
            [outer_bottom + ni, inner_bottom + ni, inner_bottom + i],
        ])
    faces = np.vstack([faces, np.asarray(bottom)])

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=True)
    mesh.remove_unreferenced_vertices()
    mesh.fix_normals()
    mesh.metadata["name"] = "BottleGlass"
    return mesh


def create_ribbed_cap() -> trimesh.Trimesh:
    segments = 256
    rings = 16
    y0, y1 = 0.0775, 0.1120
    base = 0.0268
    rib_count = 64
    verts = []
    for j in range(rings + 1):
        t = j / rings
        y = y0 + (y1 - y0) * t
        end_blend = min(1.0, t / 0.12, (1.0 - t) / 0.12)
        for i in range(segments):
            a = 2 * np.pi * i / segments
            wave = np.cos(a * rib_count)
            r = base + 0.00075 * wave * max(0.22, end_blend)
            # Reference cap has very subtle top and bottom rounding.
            if t < 0.06:
                r -= 0.00035 * (1.0 - t / 0.06)
            if t > 0.94:
                r -= 0.00045 * ((t - 0.94) / 0.06)
            verts.append([r * np.cos(a), y, r * np.sin(a)])
    faces = []
    row_len = segments
    for j in range(rings):
        for i in range(segments):
            ni = (i + 1) % segments
            a = j * row_len + i
            b = j * row_len + ni
            c = (j + 1) * row_len + i
            d = (j + 1) * row_len + ni
            faces.extend([[a, c, b], [b, c, d]])
    # close top
    top_center = len(verts)
    verts.append([0, y1, 0])
    top_row = rings * row_len
    for i in range(segments):
        ni = (i + 1) % segments
        faces.append([top_center, top_row + i, top_row + ni])
    mesh = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=True)
    mesh.fix_normals()
    mesh.metadata["name"] = "CapBluePP"
    return mesh


def torus(major: float, minor: float, y: float, name: str) -> trimesh.Trimesh:
    mesh = trimesh.creation.torus(major_radius=major, minor_radius=minor, major_sections=160, minor_sections=20)
    mesh.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))
    mesh.apply_translation([0, y, 0])
    mesh.metadata["name"] = name
    return mesh


def main() -> None:
    scene = trimesh.Scene()
    scene.add_geometry(create_glass_volume(), node_name="BottleGlass", geom_name="BottleGlass")
    scene.add_geometry(create_ribbed_cap(), node_name="CapBluePP", geom_name="CapBluePP")
    scene.add_geometry(torus(0.0156, 0.00072, 0.0810, "ThreadLower"), node_name="ThreadLower", geom_name="ThreadLower")
    scene.add_geometry(torus(0.0156, 0.00072, 0.0841, "ThreadMiddle"), node_name="ThreadMiddle", geom_name="ThreadMiddle")
    scene.add_geometry(torus(0.0156, 0.00072, 0.0872, "ThreadUpper"), node_name="ThreadUpper", geom_name="ThreadUpper")
    scene.add_geometry(torus(0.0258, 0.00072, 0.0778, "CapTamperRing"), node_name="CapTamperRing", geom_name="CapTamperRing")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_bytes(scene.export(file_type="glb"))
    print(OUT)


if __name__ == "__main__":
    main()
