// Leaf photo check: which model reads which crop, what its outputs mean, and what was measured. Data only.
// The models and every number below come from the SafeGuard Lab reports (REPORT / REPORT3 / DISTILL); see models/leaf/MODELS.md.
// Nothing here was re-measured in the app, and the Lab's test photos were not taken in Myanmar.

/** The model must be at least this sure before the screen calls its top answer "fairly sure" (the Lab's confidence policy). */
export const GATE = 0.7;

/** ONNX Runtime Web 1.20.1, stored as four parts (a serverless host will not send one 11 MB response). */
export const ENGINE = { dir: "/vendor/ort/", glue: "ort.wasm.min.mjs", wasm: "ort-wasm-simd-threaded.wasm", parts: 4, bytes: 11246032, sha256: "207d02be4591c156b0a98f024f3d58005b5b04c92274d759fb390338c63559ea" };

const RICE14 = ["Bacterial Blight", "Bacterial Leaf Streak", "Bacterial Panicle Blight", "Blast", "Brown Spot", "Dead Heart", "Downy Mildew", "Healthy", "Hispa", "Leaf Scald", "Narrow Brown Leaf Spot", "Neck Blast", "Sheath Blight", "Tungro"];
const PV38 = ["Apple___Apple_scab", "Apple___Black_rot", "Apple___Cedar_apple_rust", "Apple___healthy", "Blueberry___healthy", "Cherry_(including_sour)___Powdery_mildew", "Cherry_(including_sour)___healthy", "Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot", "Corn_(maize)___Common_rust_", "Corn_(maize)___Northern_Leaf_Blight", "Corn_(maize)___healthy", "Grape___Black_rot", "Grape___Esca_(Black_Measles)", "Grape___Leaf_blight_(Isariopsis_Leaf_Spot)", "Grape___healthy", "Orange___Haunglongbing_(Citrus_greening)", "Peach___Bacterial_spot", "Peach___healthy", "Pepper,_bell___Bacterial_spot", "Pepper,_bell___healthy", "Potato___Early_blight", "Potato___Late_blight", "Potato___healthy", "Raspberry___healthy", "Soybean___healthy", "Squash___Powdery_mildew", "Strawberry___healthy", "Strawberry___Leaf_scorch", "Tomato___Bacterial_spot", "Tomato___Early_blight", "Tomato___Late_blight", "Tomato___Leaf_Mold", "Tomato___Septoria_leaf_spot", "Tomato___Spider_mites Two-spotted_spider_mite", "Tomato___Target_Spot", "Tomato___Tomato_Yellow_Leaf_Curl_Virus", "Tomato___Tomato_mosaic_virus", "Tomato___healthy"];

export const MODELS = {
  rice: { file: "/models/leaf/rice_student_mbv3s.onnx", bytes: 3103989, sha256: "0af21e86c46537ed85eb053664556051449447a2147cb5d2f72364164acb8f7a", prep: "imagenet224", classes: RICE14 },
  pv: { file: "/models/leaf/pv_int8.onnx", bytes: 2653866, sha256: "0db0651a4df688d752dd70366ea7ddaef8e75a4a5b19609b8eb3e1169e4fe765", prep: "pv", classes: PV38 },
};

/** Crops with a photo check. mode "gate": answer only above GATE (rice). "hint": this model is weak, always show as possibilities only,
 *  ranked among the crop's own classes (potato). "single": the model knows one disease of this crop and has no healthy class (cucurbit). */
export const PHOTO = {
  rice: { model: "rice", mode: "gate", only: null },
  potato: { model: "pv", mode: "hint", only: ["Potato___Early_blight", "Potato___Late_blight", "Potato___healthy"] },
  cucurbit: { model: "pv", mode: "single", only: ["Squash___Powdery_mildew"], target: "Squash___Powdery_mildew" },
};

/** What each output is called. `pest` links it to an entry of the app's own guide (pests.js) so its signs and prevention can be shown;
 *  `my` is Burmese (with the English name in brackets, as in the guide). Classes without `pest` are not in the guide's 61. */
export const CLASSES = {
  "Bacterial Blight": { en: "Bacterial leaf blight", my: "စပါးရွက်ကြွပ်ရောဂါ (Bacterial leaf blight)", pest: "bacterial_blight" },
  "Bacterial Leaf Streak": { en: "Bacterial leaf streak", my: "စပါး ဘက်တီးရီးယား အရွက်အစင်းရောဂါ (Bacterial leaf streak)" },
  "Bacterial Panicle Blight": { en: "Bacterial panicle blight", my: "စပါး ဘက်တီးရီးယား နှံညှိုးရောဂါ (Bacterial panicle blight)" },
  "Blast": { en: "Rice blast", my: "စပါးရွက်ပေါက်ရောဂါ (Rice blast)", pest: "rice_blast" },
  "Brown Spot": { en: "Brown spot", my: "စပါး အညိုစက်ရောဂါ (Brown spot)" },
  "Dead Heart": { en: "Dead heart (often stem borer damage)", my: "စပါး အလယ်ထွာသေခြင်း (Dead heart၊ ပင်စည်တူးပိုးကြောင့် များ)", pest: "stem_borer" },
  "Downy Mildew": { en: "Downy mildew (rice)", my: "စပါး အညိုမှိုရောဂါ (Downy mildew)" },
  "Healthy": { en: "Looks healthy", healthy: true },
  "Hispa": { en: "Rice hispa", my: "စပါးရွက်ကိုက်ပိုး (Rice hispa)" },
  "Leaf Scald": { en: "Leaf scald", my: "စပါး ရွက်လောင်ရောဂါ (Leaf scald)" },
  "Narrow Brown Leaf Spot": { en: "Narrow brown leaf spot", my: "စပါး ရွက်ကျဉ်းအညိုစက်ရောဂါ (Narrow brown leaf spot)" },
  "Neck Blast": { en: "Neck blast", my: "စပါးနှံလည်ပင်း ရောဂါ (Neck blast)", pest: "rice_blast" },
  "Sheath Blight": { en: "Rice sheath blight", my: "စပါးအခွံ/ပင်စည်ပုပ်ရောဂါ (Sheath blight)", pest: "sheath_blight" },
  "Tungro": { en: "Rice tungro disease", my: "စပါး တန်ဂရိုး ဗိုင်းရပ်စ်ရောဂါ (Tungro)", pest: "tungro" },
  "Potato___Early_blight": { en: "Early blight", my: "အာလူး ရွက်အစက်ရောဂါ (Early blight)", pest: "potato_early_blight" },
  "Potato___Late_blight": { en: "Late blight", my: "အာလူး ရွက်ပုပ်ရောဂါ (Late blight)", pest: "potato_late_blight" },
  "Potato___healthy": { en: "Looks healthy", healthy: true },
  "Squash___Powdery_mildew": { en: "Powdery mildew", my: "သခွားသီး အမှုန့်ဖြူရောဂါ (Powdery mildew)", pest: "cucurbit_powdery_mildew" },
};

/** One sentence of what was measured, per crop, for the "How far can this be trusted?" note. Numbers: SafeGuard Lab reports. */
export const FACTS = {
  rice: { n: 125, top1: 89.6, top3: 98.4, answered: 75.2, right: 98.9 },
  potato: { n: 40, top1: 65.0 },
  cucurbit: { n: 20, hit: 20 },
};
