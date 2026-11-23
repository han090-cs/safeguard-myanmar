"""Writes tests/fixtures/leaf_prep.json: what Pillow gives for the photo preparation in leaf_prep.js, on synthetic images that both
languages can rebuild from a formula (so no image files are needed). Run: python3 tools/make_leaf_prep_fixture.py   (needs Pillow, numpy).
The JS test (tests/leaf_prep.test.mjs) rebuilds the same pixels, runs leaf_prep.js and compares: resized pixels exactly, tensor values within 1e-6."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)
CASES = [("imagenet224", 640, 480), ("imagenet224", 300, 700), ("imagenet224", 224, 224), ("imagenet224", 97, 61),
         ("pv", 800, 600), ("pv", 333, 333), ("pv", 256, 400), ("pv", 129, 300), ("pv", 1024, 768)]


def pixels(w, h):
    """Interleaved RGBA bytes from an integer formula (the same one is written in the JS test)."""
    i = np.arange(w * h * 4, dtype=np.uint64)
    v = (i * np.uint64(1103515245) + np.uint64(12345)) & np.uint64(0xFFFFFFFF)
    b = ((v >> np.uint64(16)) & np.uint64(255)).astype(np.uint8)
    b[3::4] = 255
    # smooth it a little so the resize is not only fed noise: add a horizontal gradient to the red channel
    b[0::4] = ((b[0::4].astype(np.uint16) + (np.arange(w * h) % w) * 255 // max(1, w - 1)) // 2).astype(np.uint8)
    return b


out = []
for kind, w, h in CASES:
    rgba = pixels(w, h).reshape(h, w, 4)
    img = Image.fromarray(rgba[:, :, :3], "RGB")
    if kind == "imagenet224":
        rs = img.resize((224, 224), Image.BILINEAR)
        t = ((np.asarray(rs, np.float32) / 255.0 - MEAN) / STD).transpose(2, 0, 1).astype(np.float32)
    else:
        s = 256 / min(w, h)
        nw, nh = round(w * s), round(h * s)
        rs = img.resize((nw, nh), Image.BILINEAR)
        l, tp = (nw - 224) // 2, (nh - 224) // 2
        t = (np.asarray(rs.crop((l, tp, l + 224, tp + 224)), np.float32) / 127.5 - 1.0).transpose(2, 0, 1).astype(np.float32)
    flat = t.reshape(-1)
    idx = list(range(0, flat.size, 211))
    out.append({"kind": kind, "w": w, "h": h, "resized": [rs.width, rs.height], "resized_sha": hashlib.sha256(np.asarray(rs, np.uint8).tobytes()).hexdigest(),
                "idx": idx, "vals": [float(flat[i]) for i in idx], "sum": float(flat.astype(np.float64).sum())})
dest = ROOT / "tests" / "fixtures" / "leaf_prep.json"
dest.write_text(json.dumps({"pillow": Image.__version__, "numpy": np.__version__, "cases": out}), encoding="utf-8")
print("wrote", dest, len(out), "cases, Pillow", Image.__version__)
