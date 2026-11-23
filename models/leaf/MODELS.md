# Leaf photo models (Lab tab)

Two small ONNX files read a leaf photo **on the visitor's own phone** (ONNX Runtime Web, no photo leaves the device).
They come from the SafeGuard Lab measurement rounds (`SafeGuard-Lab-Mini`: `reports/REPORT.md`, `REPORT3.md`, `DISTILL.md`).
The numbers below are the Lab's, measured on its own test photos. **They were not re-measured in this app, and the test photos
were taken in India, not Myanmar.** Expect lower scores on Myanmar field photos.

| file | bytes | sha256 | used for |
|---|---|---|---|
| `rice_student_mbv3s.onnx` | 3,103,989 | `0af21e86c46537ed85eb053664556051449447a2147cb5d2f72364164acb8f7a` | rice (14 classes) |
| `pv_int8.onnx` | 2,653,866 | `0db0651a4df688d752dd70366ea7ddaef8e75a4a5b19609b8eb3e1169e4fe765` | potato and cucurbit (PlantVillage 38 classes) |

`leaf_models.js` holds the same sizes and hashes; the browser checks both before it uses a file. The filenames are fixed in `leaf_models.js`,
`app/web.py` and `sw.js`: **when a model is replaced, give the new file a new name** and change all three (the service worker keeps files
cache-first, so a changed file under the same name would not reach phones that already have it).

## Rice: distilled student (MobileNetV3-Small)

- Teacher: ixrbhii ConvNeXt-Small rice model (CC-BY-4.0). Student: MobileNetV3-Small (ImageNet-pretrained), temperature 3, alpha 0.3, 14 epochs on 3,468 screened images, fp16 ONNX.
- Paddy Doctor test set, n = 125: top-1 **89.6%**, top-3 **98.4%**. With the 0.70 gate the model answers on **75.2%** of photos and is right on **98.9%** of those (1 confidently wrong photo).
- Second set (n = 50, 98% teacher): student top-1 94.0%, 2 confidently wrong. The Lab marks this as a weaker spot.
- The Lab README calls this student a **proposal for a future version**. It is shipped here because the Lab's own ship bar was passed and the screen never shows a single hard answer below the gate.
- Training data: the Lab's screened pool of rice photos (Paddy Doctor, doi 10.21227/hz4v-af08, among others); the teacher was trained on LeafNet and the author's own field photos. **Owner to confirm the dataset licences allow this use.**

## Potato and cucurbit: PlantVillage MobileNetV2 (int8)

- Source: LourivalGontijo/plantvillage-mobilenetv2 (Apache-2.0), exported to ONNX and int8-quantised by the Lab.
- The Lab's field numbers (PlantDoc photos from India) were measured on the **unquantised** model; the Lab README calls the int8 file "verified" for shipping. Treat the numbers as indicative.
- **Potato** (n = 40, 2 diseases): top-1 **65.0%**. This is weak, so the app shows potato results as *possibilities only*, ranked among the three potato classes (early blight, late blight, healthy), never as an answer.
- **Cucurbit** (n = 20 squash photos): powdery mildew **20/20**. The model has no healthy squash class, so the app only says "possible powdery mildew" or "not sure"; it cannot say "healthy".
- Other crops in this model (tomato, maize, ...) are not used by this app.

## How a photo is prepared

1. The page shrinks the photo to at most 1024 px on the long side with a canvas (so a 12 MP phone photo does not fill memory).
2. `leaf_prep.js` then resizes and normalises it the way the Lab's Python code did (Pillow-exact, checked by `tests/leaf_prep.test.mjs` against fixtures made by `tools/make_leaf_prep_fixture.py`).
3. The tensor goes to ONNX Runtime Web 1.20.1 (MIT), single thread, no worker.
4. In the browser the rice model's output differs from the Python runtime by up to about 3e-3 (runtime numerics); the top class was the same on every checked photo.

## Confidence policy (the Lab's)

Gate 0.70. At or above it the screen says "fairly sure" and still shows the model's other possibilities. Below it the screen says "not sure" and lists the top three as things to check against the pest guide.
A photo that the phone finds too dark, washed out or without leaf colour (`assessPhoto`, v9.20.0) never gets "fairly sure": the reading is shown as "not sure" whatever the model says. This guard is not a model change and was not measured on real photos.
Photo results, the sign checklist and the optional AI second look are shown side by side and never merged into one verdict.

## Runtime files

`vendor/ort/` holds `ort.wasm.min.mjs`, `ort-wasm-simd-threaded.mjs` and the WebAssembly binary (11,246,032 bytes, sha256 `207d02be4591c156b0a98f024f3d58005b5b04c92274d759fb390338c63559ea`)
split into four 2,811,508-byte parts (`.wasm.1` ... `.wasm.4`), because a serverless host will not send one 11 MB response. The page joins the parts, checks the hash and hands the bytes to the runtime.
First use downloads about 14 MB (engine plus one model); the service worker then keeps it (`sg-leaf-v1`).
