"""Deterministic product-image evidence extraction for NET30.

This worker deliberately does not identify a product or invent dimensions.  It
only extracts a centred, near-white-background object's measurable silhouette,
blue-cap bounds, and repeat-edge evidence.  The Node layer decides whether an
image is allowed to affect a given graph field and calibrates pixels with an
approved product dimension.
"""
import json
import pathlib
import sys

import numpy as np
from PIL import Image, ImageOps


def _samples(mask, start, end, count=72):
    height, width = mask.shape
    rows = []
    for y in np.linspace(start, max(start, end), count).round().astype(int):
        y = int(np.clip(y, 0, height - 1))
        xs = np.flatnonzero(mask[y])
        if xs.size < max(4, width // 100):
            continue
        rows.append({"y": y, "left": int(xs.min()), "right": int(xs.max())})
    return rows


def analyse(item):
    image = ImageOps.exif_transpose(Image.open(item["path"]).convert("RGB"))
    # A bounded working resolution makes runtime independent of phone-camera
    # megapixels while preserving bottle shoulder/cap edges.
    max_height = 1800
    if image.height > max_height:
        ratio = max_height / image.height
        image = image.resize((round(image.width * ratio), max_height), Image.Resampling.LANCZOS)
    rgb = np.asarray(image, dtype=np.int16)
    h, w, _ = rgb.shape
    corner = np.concatenate((rgb[:max(4, h // 20), :max(4, w // 20)].reshape(-1, 3), rgb[:max(4, h // 20), -max(4, w // 20):].reshape(-1, 3), rgb[-max(4, h // 20):, :max(4, w // 20)].reshape(-1, 3), rgb[-max(4, h // 20):, -max(4, w // 20):].reshape(-1, 3)))
    background = np.median(corner, axis=0)
    delta = np.sqrt(np.square(rgb - background).sum(axis=2))
    chroma = rgb.max(axis=2) - rgb.min(axis=2)
    value = rgb.mean(axis=2)
    # Transparent glass is faint but its edge is darker/chromatic than the
    # corner background.  A small morphology-free horizontal persistence rule
    # below rejects isolated JPEG noise.
    foreground = (delta > 24) | ((value < 244) & (chroma > 8)) | (value < 210)
    row_counts = foreground.sum(axis=1)
    active = np.flatnonzero(row_counts >= max(8, w // 120))
    if active.size < 16:
        raise RuntimeError("evidence_missing: primary image silhouette is not separable from its background")
    top, bottom = int(active.min()), int(active.max())
    # Keep a preliminary scale only for the independently detected cap. The
    # final product silhouette is recomputed below after its robust top datum
    # has been established.
    rough_rows = _samples(foreground, top, bottom)
    if len(rough_rows) < 12:
        raise RuntimeError("evidence_missing: insufficient measurable silhouette rows")
    rough_half_width = max((row["right"] - row["left"] + 1) / 2 for row in rough_rows)
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    # Require substantial absolute chroma, not just a blue-tinted transparent
    # glass pixel.  This keeps the blue closure separate from the bottle.
    blue_mask = ((blue - red) > 110) & ((blue - green) > 65) & (blue > 90)
    # A cap spans a meaningful share of the image width; faint blue glass and
    # printed marks do not.  This avoids using the bottle's transparent tint
    # as a false cap boundary.
    blue_rows = np.flatnonzero(blue_mask.sum(axis=1) >= max(12, w // 8))
    cap = None
    if blue_rows.size:
        cap_top, cap_bottom = int(blue_rows.min()), int(blue_rows.max())
        cap_x = np.flatnonzero(blue_mask[cap_top:cap_bottom + 1].any(axis=0))
        # This is a measured visual envelope, not an asserted nominal cap
        # diameter.  The Node layer calibrates it only with an approved overall
        # product width and records the source so users can override it.
        cap_width = int(cap_x.max() - cap_x.min() + 1) if cap_x.size else 0
        cap = {
            "topY": cap_top, "bottomY": cap_bottom,
            "heightNorm": round((cap_bottom - cap_top + 1) / max(1, bottom - top + 1), 7),
            "outerDiameterRatio": round(cap_width / max(1.0, 2 * rough_half_width), 7) if cap_width else None,
        }
        # Keep the coloured closure's actual left/right envelope as a separate
        # curve. It is deliberately not mixed into the transparent vessel
        # silhouette: a patterned cap often has a lower skirt/brim whose
        # axial order is critical to a revolved B-Rep.
        cap_rows = []
        # Anti-aliased corner pixels at a coloured cap's top/bottom can be a
        # few pixels wide. They are not an exterior manufacturing contour.
        # Retain rows that cover a substantial fraction of the independently
        # measured cap width, while preserving their original axial position.
        minimum_cap_span = max(4, int(cap_width * .60))
        for y in np.linspace(cap_top, cap_bottom, 64).round().astype(int):
            y = int(np.clip(y, cap_top, cap_bottom))
            xs = np.flatnonzero(blue_mask[y])
            if xs.size >= minimum_cap_span:
                cap_rows.append({"y": y, "left": int(xs.min()), "right": int(xs.max())})
        if len(cap_rows) >= 12:
            # `topY` remains the colour-band bounding box for evidence
            # provenance. `contourTopY` is the first row with a substantial
            # cap span, and is the only safe axial datum for the exterior
            # curve. A few anti-aliased pixels above it are not a physical
            # chamfer or a manufacturing contour.
            cap["contourTopY"] = cap_rows[0]["y"]
            cap["contourBottomY"] = cap_rows[-1]["y"]
            cap["blueSilhouette"] = [{
                "zNorm": round((cap_bottom - row["y"]) / max(1, cap_bottom - cap_top), 7),
                "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / rough_half_width, 7),
            } for row in cap_rows]
    # Vertical luminance transitions across the cap band are a measurable rib
    # cue.  The feature planner may use it, but it is never a mandatory count.
    rib_hint = None
    if cap:
        band = rgb[cap["topY"]:cap["bottomY"] + 1].mean(axis=0).mean(axis=1)
        slope = np.abs(np.diff(band))
        threshold = max(8.0, float(np.percentile(slope, 87)))
        peaks = [index + 1 for index in range(1, len(slope) - 1) if slope[index] >= threshold and slope[index] >= slope[index - 1] and slope[index] >= slope[index + 1]]
        # paired light/dark transitions represent one rib; this remains only a
        # confidence-weighted hint rather than a claimed engineering value.
        rib_hint = {"edgePeakCount": len(peaks), "estimatedRepeatCount": max(0, round(len(peaks) / 2)), "confidence": round(min(.85, len(peaks) / 80), 3)}
    # A strongly detected coloured closure is a wider, connected product
    # datum than a few anti-aliased/chromatic pixels above it.  Those isolated
    # pixels previously became the global top, compressing every following
    # sample and making the measured assembly look like it had a pointed cap.
    # This does not invent a product category: it only uses the independently
    # measured wide blue envelope already accepted as a closure evidence cue.
    if cap and cap.get("contourTopY", cap["topY"]) > top:
        top = int(cap.get("contourTopY", cap["topY"]))
    # The last foreground row of a transparent product photo can be a lone
    # anti-aliased shadow pixel.  It is not a legitimate conical endpoint if
    # the two preceding measured rows form a continuous, broad base.  Trim
    # only that specific one-row discontinuity; a real cone or chamfer has a
    # progressive change over several samples and is retained.  This keeps
    # the evidence extractor product-agnostic while preventing one noisy
    # pixel from becoming a multi-millimetre B-Rep fitting target.
    raw_bottom = bottom
    rows = _samples(foreground, top, bottom)
    if len(rows) >= 3:
        spans = [row["right"] - row["left"] + 1 for row in rows]
        last, previous, before_previous = spans[-1], spans[-2], spans[-3]
        abrupt_terminal_drop = last < previous * .60
        stable_base_before_drop = abs(previous - before_previous) <= max(3, previous * .10)
        if abrupt_terminal_drop and stable_base_before_drop:
            bottom = int(rows[-2]["y"])
            rows = _samples(foreground, top, bottom)
    if len(rows) < 12:
        raise RuntimeError("evidence_missing: insufficient measurable silhouette rows")
    center = float(np.median([(row["left"] + row["right"]) / 2 for row in rows]))
    half_width = max((row["right"] - row["left"] + 1) / 2 for row in rows)
    silhouette = [{
        "zNorm": round((bottom - row["y"]) / max(1, bottom - top), 7),
        "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / half_width, 7),
        "centerOffsetNorm": round((((row["left"] + row["right"]) / 2) - center) / half_width, 7),
    } for row in rows]
    if cap and cap.get("contourTopY") is not None and cap.get("contourBottomY") is not None:
        # Blue chroma reliably identifies the closure *band*, but specular
        # rib highlights and shadows make it a poor exterior measuring mask.
        # Once the band is known, fit its actual outline from the same
        # foreground contour used for the complete product.  Keep the blue
        # samples separately for repeat/material evidence; do not let colour
        # threshold gaps narrow an otherwise measured B-Rep curve.
        cap_foreground_rows = _samples(foreground, int(cap["contourTopY"]), int(cap["contourBottomY"]), 64)
        if len(cap_foreground_rows) >= 12:
            cap["silhouette"] = [{
                "zNorm": round((int(cap["contourBottomY"]) - row["y"]) / max(1, int(cap["contourBottomY"]) - int(cap["contourTopY"])), 7),
                "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / half_width, 7),
            } for row in cap_foreground_rows]
            cap["silhouetteSource"] = "foreground_product_contour_with_blue_band_crop"
    body_start = min(bottom, (cap["bottomY"] + 1) if cap else top)
    body_rows = _samples(foreground, body_start, bottom, 64)
    body = [{
        "zNorm": round((bottom - row["y"]) / max(1, bottom - body_start), 7),
        "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / half_width, 7),
    } for row in body_rows]
    # Keep a separately measured upper-detail contour for evidence whose
    # declared role is neck/detail.  It is intentionally a normalized local
    # shape, not a second product-scale calibration: a related no-cap photo
    # may establish the lip, neck rings and shoulder continuity, but must not
    # overwrite the primary product's overall width or height.
    detail_end = int(round(top + (bottom - top) * .48))
    detail_rows = _samples(foreground, top, detail_end, 48)
    top_detail = [{
        "zNorm": round((detail_end - row["y"]) / max(1, detail_end - top), 7),
        "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / half_width, 7),
    } for row in detail_rows]
    # A no-cap reference often contains the neck, shoulder and upper body in
    # its top crop. Treating all of those rows as one short neck curve was
    # stretching the shoulder into the mouth. Extract only the first stable
    # narrow band, ending before the first sustained radial expansion. This is
    # a product-agnostic contour rule: it does not inspect labels, product
    # names, colours, or a fixed bottle dimension. A single anti-aliased rim
    # pixel is discarded only when it is substantially narrower than the next
    # stable rows; a real rim is retained as part of the band.
    neck_rows = list(detail_rows)
    if len(neck_rows) >= 8:
        spans = [float(row["right"] - row["left"] + 1) for row in neck_rows]
        stable_start = 0
        if spans[0] < float(np.median(spans[1:min(len(spans), 6)])) * .60:
            stable_start = 1
        stable = neck_rows[stable_start:]
        stable_spans = [float(row["right"] - row["left"] + 1) for row in stable]
        baseline_count = min(8, len(stable_spans))
        baseline = float(np.median(stable_spans[:baseline_count]))
        breakpoint = len(stable)
        # Three consecutive wider rows distinguish a shoulder transition from
        # an individual specular highlight or one noisy silhouette scanline.
        for index in range(max(3, baseline_count - 1), len(stable_spans) - 2):
            if all(value >= baseline * 1.12 for value in stable_spans[index:index + 3]):
                breakpoint = max(8, index)
                break
        neck_rows = stable[:breakpoint]
    neck_top = neck_rows[0]["y"] if neck_rows else top
    neck_bottom = neck_rows[-1]["y"] if neck_rows else detail_end
    neck_detail = [{
        "zNorm": round((neck_bottom - row["y"]) / max(1, neck_bottom - neck_top), 7),
        "radiusNorm": round(((row["right"] - row["left"] + 1) / 2) / half_width, 7),
    } for row in neck_rows]
    return {
        "imageId": item["id"], "filename": item.get("filename", "image"),
        "widthPx": w, "heightPx": h,
        "backgroundRgb": [round(float(value), 2) for value in background],
        "axisXNorm": round(center / max(1, w), 7),
        "silhouette": silhouette, "bodySilhouette": body,
        "topDetailSilhouette": top_detail,
        "neckDetailSilhouette": neck_detail,
        "bounds": {"topY": top, "bottomY": bottom, "rawBottomY": raw_bottom, "halfWidthPx": round(float(half_width), 4)},
        "cap": cap, "capRibHint": rib_hint,
        "measurementMethod": "corner-background-delta-horizontal-persistence-v1",
    }


def main():
    request = json.loads(pathlib.Path(sys.argv[1]).read_text())
    result = {"version": "net30.image-evidence.v1", "images": []}
    for item in request.get("images", []):
        try:
            result["images"].append({"ok": True, "measurement": analyse(item)})
        except Exception as error:
            result["images"].append({"ok": False, "imageId": item.get("id"), "error": str(error)})
    print(json.dumps(result))


if __name__ == "__main__":
    main()
