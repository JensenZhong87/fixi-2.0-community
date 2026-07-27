import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  Download,
  Eye,
  History,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Moon,
  Save,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  Wand2,
  X
} from "lucide-react";
import { PRESET_PROMPTS } from "./presetData";
import Aurora from "./components/Aurora";
import { HistoryItem, PromptResult, RepairEngine, RepairEngineId, RepairTab, VisionProblem, VisionProblemCategory } from "./types";

const REPAIR_ENGINES: RepairEngine[] = [
  {
    id: "nano-banana-2",
    name: "NanoBanana",
    provider: "unified",
    model: "nano-banana-2",
    endpoint: "internal",
    description: "使用你在设置中配置的 NanoBanana 图生图网关。"
  },
  {
    id: "gpt-image-2",
    name: "ChatGPT Image 2",
    provider: "unified",
    model: "gpt-image-2",
    endpoint: "internal",
    description: "使用你在设置中配置的 ChatGPT Image 2 图生图网关。"
  }
];

const DEFAULT_REPAIR_PROMPT = [
  "修复 AI 图片中的明显画损与结构错误",
  "保持原图主体、构图、风格、颜色和身份一致",
  "修正面部、手部、肢体、文字粘连、边缘破碎、压缩噪点、模糊、局部撕裂",
  "只修复异常区域，不改变原图主题，不添加无关元素",
  "输出自然、干净、可商用的完整图片"
].join("；");

type CommunityGatewayDraft = {
  endpoint: string;
  apiKey: string;
  model: string;
  hasApiKey?: boolean;
};

type CommunitySettingsDraft = {
  nanoBanana: CommunityGatewayDraft;
  chatgptImage2: CommunityGatewayDraft;
};

const DEFAULT_COMMUNITY_SETTINGS: CommunitySettingsDraft = {
  nanoBanana: { endpoint: "", apiKey: "", model: "nano-banana-2", hasApiKey: false },
  chatgptImage2: { endpoint: "", apiKey: "", model: "gpt-image-2", hasApiKey: false }
};

const PROBLEM_ORDER: VisionProblemCategory[] = [
  "pixel_collapse",
  "image_tearing",
  "render_distortion",
  "hand_collapse",
  "face_collapse",
  "limb_proportion",
  "object_topology",
  "ripple_artifact",
  "material_confusion",
  "dark_noise",
  "texture_misalignment",
  "text_problem"
];

const REPAIR_PROMPT_TEMPLATES: Record<VisionProblemCategory, string> = {
  pixel_collapse: "修复画面中的像素破碎、细节崩坏和压缩块状噪点，清理杂色与脏点，恢复连续清晰的边缘和稳定细节，保持原图主体、构图、颜色、光影和画风不变",
  image_tearing: "仅修复画面撕裂、断裂边缘、错位拼接和破损区域，让断裂处自然衔接、边缘干净锐利、纹理连续融合；不得改变主体位置、数量、画幅比例和整体构图",
  render_distortion: "修复渲染失真、异常拉伸、局部变形、塌陷和不合理透视，使形体结构恢复真实稳定；保留原图风格、笔触、色彩、光影、背景和主体身份不变",
  hand_collapse: "只修复手部崩坏，恢复正确手指数量、自然关节、合理掌骨结构和清晰指尖轮廓，消除多指、断指、粘连、肿胀和畸形；人物姿态、服装、表情和构图不变",
  face_collapse: "只修复脸部崩坏，恢复五官对称、眼睛大小一致、鼻梁自然、嘴巴位置正确、皮肤过渡平滑；保留人物发型、表情、年龄感、服装、光影和原图画风不变",
  limb_proportion: "只修复肢体比例失调，恢复胳膊、腿部、肩颈和关节的合理长度、角度与连接关系，使姿势自然符合人体结构；保留主体身份、服装、动作和画面布局不变",
  object_topology: "修复物体拓扑结构错误、连接穿插、悬空断裂和内部逻辑错误，使物体形状、边缘、连接点和空间关系符合现实逻辑；保留物体整体轮廓、材质、颜色和位置不变",
  ripple_artifact: "去除棋盘格、波纹伪影、摩尔纹、条带和异常纹理干扰，恢复平滑自然的纯色、渐变和干净背景；保持原有色彩准确、明暗关系和主体细节不变",
  material_confusion: "修复材质混淆和质感错误，让金属、玻璃、布料、皮肤、纸张、塑料等材质回到应有的真实触感、反射和纹理；保留物体形状、位置、颜色和光影关系不变",
  dark_noise: "清理暗部脏感、阴影噪点、颗粒、色块和灰雾感，提升暗部纯净度与层次，让明暗过渡自然；不得提亮过度，不改变高光、主体色彩、整体氛围和画风",
  texture_misalignment: "修复纹理错位、贴图偏移、材质断层、图案漂移和边缘不对齐问题，使纹理方向、图案连接、材质边界与光影逻辑自然连续；保留物体形状和构图不变",
  text_problem: "擦除这张图片中所有乱码的文字，然后在相同位置添加清晰的文字：[正确文字内容]，字体风格与原图一致"
};

const TEMPLATE_ENABLED_CATEGORIES = PROBLEM_ORDER.filter((category) => category !== "text_problem");

const DETECTION_REPAIR_KEYWORDS: Record<VisionProblemCategory, string[]> = Object.fromEntries(
  PROBLEM_ORDER.map((category) => [category, [REPAIR_PROMPT_TEMPLATES[category]]])
) as Record<VisionProblemCategory, string[]>;

const ENABLE_CATEGORY_PROMPT_TEMPLATES = true;

const PROBLEM_LABELS: Record<VisionProblemCategory, { title: string; className: string; dotClassName: string }> = {
  pixel_collapse: { title: "像素崩坏", className: "border-red-200 bg-red-50 text-red-700", dotClassName: "bg-red-500" },
  image_tearing: { title: "画面撕裂", className: "border-orange-200 bg-orange-50 text-orange-700", dotClassName: "bg-orange-500" },
  render_distortion: { title: "渲染失真", className: "border-yellow-200 bg-yellow-50 text-yellow-700", dotClassName: "bg-yellow-500" },
  hand_collapse: { title: "手部崩坏", className: "border-rose-200 bg-rose-50 text-rose-700", dotClassName: "bg-rose-500" },
  face_collapse: { title: "脸部崩坏", className: "border-pink-200 bg-pink-50 text-pink-700", dotClassName: "bg-pink-500" },
  limb_proportion: { title: "肢体比例失调", className: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700", dotClassName: "bg-fuchsia-500" },
  object_topology: { title: "物体拓扑错误", className: "border-violet-200 bg-violet-50 text-violet-700", dotClassName: "bg-violet-500" },
  ripple_artifact: { title: "波纹伪影", className: "border-blue-200 bg-blue-50 text-blue-700", dotClassName: "bg-blue-500" },
  material_confusion: { title: "材质混淆", className: "border-cyan-200 bg-cyan-50 text-cyan-700", dotClassName: "bg-cyan-500" },
  dark_noise: { title: "暗部脏感与噪点", className: "border-zinc-300 bg-zinc-50 text-zinc-700", dotClassName: "bg-zinc-500" },
  texture_misalignment: { title: "纹理错位", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dotClassName: "bg-emerald-500" },
  text_problem: { title: "文字问题", className: "border-sky-200 bg-sky-50 text-sky-700", dotClassName: "bg-sky-500" }
};

const VERSION_UPDATES = [
  "v2.0 Community：移除内置网关、密钥、历史和调用记录；改为用户自行配置 NanoBanana 与 ChatGPT Image 2。",
  "v2.0 Community：设置页新增网关连通性测试，验证当前输入的地址、API Key 与模型目录。",
  "v2.0 Community：保留整体修复、局部修复、无损放大、提示词优化、浅色与深色界面。"
];

type ImageSourceModel = "" | "nano-banana" | "gpt-image-2";
type ManualIssueId = VisionProblemCategory;
type VisionDetectEngineId = "gemini-3-flash-preview" | "doubao-seed-vision" | "gpt-5.5";
type SelectionRect = { x: number; y: number; width: number; height: number };
type SelectionPoint = { x: number; y: number };

const NO_SELECTION_MARK_OUTPUT_RULE =
  "硬性输出规则：红框、红色边框、框线、标注、选区痕迹只属于前端坐标辅助，不是原图内容；最终修复图片中绝对不能出现任何红框、红边、框线、标注或选区残留，也不要新增任何提示性图形";
type EditWorkspaceTab = Extract<RepairTab, "auto" | "local">;
type EditWorkspaceSnapshot = {
  uploadedImageSrc: string | null;
  uploadedMimeType: string;
  repairedImageSrc: string | null;
  repairPrompt: string;
  repairStatus: string;
  imageSourceModel: ImageSourceModel;
  selectedManualIssues: ManualIssueId[];
  detectedProblems: VisionProblem[];
  detectedRepairPrompt: string;
  previewMode: "before" | "after";
  note: string;
  selectionRects: SelectionRect[];
  additionalRequirementInput: string;
  confirmedAdditionalRequirement: string;
};

const VISION_DETECT_ENGINES: Array<{
  id: VisionDetectEngineId;
  name: string;
  tooltip: string;
}> = [
  {
    id: "gemini-3-flash-preview",
    name: "Gemini 3 Flash",
    tooltip: "最稳定效果最佳"
  },
  {
    id: "doubao-seed-vision",
    name: "Doubao vision",
    tooltip: "满血版豆包效果也不赖"
  },
  {
    id: "gpt-5.5",
    name: "ChatGPT 5.5",
    tooltip: "用于识别画面中的可修复错误"
  }
];

const HISTORY_DB_NAME = "fixi-history-db";
const HISTORY_STORE_NAME = "history";
const HISTORY_RECORD_ID = "current";
const HISTORY_STORAGE_KEY = "fixi:history:v1";
const THEME_STORAGE_KEY = "fixi:theme:v1";
const HISTORY_CLIENT_ID_KEY = "fixi:history:client-id:v1";

function getHistoryClientId() {
  if (typeof window === "undefined") return "server";
  const existing = window.localStorage.getItem(HISTORY_CLIENT_ID_KEY);
  if (existing) return existing;
  const id = typeof window.crypto?.randomUUID === "function"
    ? window.crypto.randomUUID()
    : `fixi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(HISTORY_CLIENT_ID_KEY, id);
  return id;
}

async function loadHistoryFromServer(): Promise<HistoryItem[] | null> {
  if (typeof window === "undefined") return null;
  const clientId = getHistoryClientId();
  const response = await fetch("/api/history", {
    headers: { "x-fixi-client-id": clientId }
  });
  if (!response.ok) throw new Error(`Server history load failed: ${response.status}`);
  const data = await response.json();
  if (data?.exists && Array.isArray(data.items)) return data.items;
  return null;
}

async function persistHistoryToServer(items: HistoryItem[]) {
  if (typeof window === "undefined") return;
  const clientId = getHistoryClientId();
  const response = await fetch("/api/history", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-fixi-client-id": clientId
    },
    body: JSON.stringify({ clientId, items })
  });
  if (!response.ok) throw new Error(`Server history persist failed: ${response.status}`);
}

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const request = window.indexedDB.open(HISTORY_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
        db.createObjectStore(HISTORY_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open history database"));
  });
}

function loadHistoryFromLocalStorage(): HistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Failed to load FIXI history from localStorage", error);
    return [];
  }
}

function persistHistoryToLocalStorage(items: HistoryItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(items));
  } catch (error) {
    console.warn("Failed to persist FIXI history to localStorage", error);
  }
}

async function loadHistoryFromIndexedDb(): Promise<HistoryItem[] | null> {
  const db = await openHistoryDb();
  return new Promise((resolve, reject) => {
    const close = () => db.close();
    const transaction = db.transaction(HISTORY_STORE_NAME, "readonly");
    const store = transaction.objectStore(HISTORY_STORE_NAME);
    const request = store.get(HISTORY_RECORD_ID);

    request.onsuccess = () => {
      const result = request.result;
      resolve(result && Array.isArray(result.items) ? result.items : null);
    };
    request.onerror = () => reject(request.error || new Error("Failed to read history"));
    transaction.oncomplete = close;
    transaction.onerror = () => {
      close();
      reject(transaction.error || new Error("Failed to read history transaction"));
    };
  });
}

async function persistHistoryToIndexedDb(items: HistoryItem[]) {
  const db = await openHistoryDb();
  return new Promise<void>((resolve, reject) => {
    const close = () => db.close();
    const transaction = db.transaction(HISTORY_STORE_NAME, "readwrite");
    const store = transaction.objectStore(HISTORY_STORE_NAME);

    store.put({
      id: HISTORY_RECORD_ID,
      items,
      updatedAt: Date.now()
    });

    transaction.oncomplete = () => {
      close();
      resolve();
    };
    transaction.onerror = () => {
      close();
      reject(transaction.error || new Error("Failed to persist history"));
    };
  });
}

async function loadPersistedHistory(): Promise<HistoryItem[]> {
  try {
    const serverHistory = await loadHistoryFromServer();
    if (serverHistory) return serverHistory;
  } catch (error) {
    console.warn("Failed to load FIXI history from server", error);
  }
  try {
    const indexedHistory = await loadHistoryFromIndexedDb();
    if (indexedHistory) return indexedHistory;
  } catch (error) {
    console.warn("Failed to load FIXI history from IndexedDB", error);
  }
  return loadHistoryFromLocalStorage();
}

async function persistHistory(items: HistoryItem[]) {
  try {
    await persistHistoryToServer(items);
  } catch (error) {
    console.warn("Failed to persist FIXI history to server", error);
  }
  try {
    await persistHistoryToIndexedDb(items);
  } catch (error) {
    console.warn("Failed to persist FIXI history to IndexedDB", error);
  }
  persistHistoryToLocalStorage(items);
}

const GEMINI_SUPPORTED_UPLOAD_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === "string") {
        resolve(event.target.result);
        return;
      }
      reject(new Error("Unable to read image file"));
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

function convertImageDataUrlToPng(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) {
        reject(new Error("Unable to normalize image format"));
        return;
      }
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("This image format cannot be decoded by the browser"));
    image.src = dataUrl;
  });
}

const VISION_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const VISION_IMAGE_MAX_SIDE = 1800;
const VISION_IMAGE_QUALITY_STEPS = [0.86, 0.76, 0.66, 0.56];
const MODEL_REPAIR_IMAGE_MAX_BYTES = 6 * 1024 * 1024;
const MODEL_REPAIR_IMAGE_MAX_SIDE = 2048;
const MODEL_REPAIR_IMAGE_QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58];

function getDataUrlByteLength(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] || dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function createVisionJpegDataUrl(dataUrl: string, maxSide: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      const context = canvas.getContext("2d");
      if (!context || !canvas.width || !canvas.height) {
        reject(new Error("Unable to prepare image for vision detection"));
        return;
      }
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => reject(new Error("This image format cannot be decoded by the browser"));
    image.src = dataUrl;
  });
}

function getImageDataUrlDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height
    });
    image.onerror = () => reject(new Error("This image format cannot be decoded by the browser"));
    image.src = dataUrl;
  });
}

async function prepareImageForModelRepairRequest(dataUrl: string, mimeType: string): Promise<{ dataUrl: string; mimeType: string; compressed: boolean }> {
  const dimensions = await getImageDataUrlDimensions(dataUrl);
  const largestSide = Math.max(dimensions.width, dimensions.height);
  if (getDataUrlByteLength(dataUrl) <= MODEL_REPAIR_IMAGE_MAX_BYTES && largestSide <= MODEL_REPAIR_IMAGE_MAX_SIDE) {
    return { dataUrl, mimeType, compressed: false };
  }

  const maxSides = [MODEL_REPAIR_IMAGE_MAX_SIDE, 1800, 1600, 1400, 1200];
  let bestDataUrl = dataUrl;
  for (const maxSide of maxSides) {
    for (const quality of MODEL_REPAIR_IMAGE_QUALITY_STEPS) {
      const candidate = await createVisionJpegDataUrl(dataUrl, maxSide, quality);
      bestDataUrl = candidate;
      if (getDataUrlByteLength(candidate) <= MODEL_REPAIR_IMAGE_MAX_BYTES) {
        return { dataUrl: candidate, mimeType: "image/jpeg", compressed: true };
      }
    }
  }
  return { dataUrl: bestDataUrl, mimeType: "image/jpeg", compressed: true };
}

async function prepareImageForVisionDetect(dataUrl: string, mimeType: string): Promise<{ dataUrl: string; mimeType: string; compressed: boolean }> {
  const supportedMimeType = GEMINI_SUPPORTED_UPLOAD_MIME_TYPES.has(mimeType) ? mimeType : "image/png";
  if (getDataUrlByteLength(dataUrl) <= VISION_IMAGE_MAX_BYTES && supportedMimeType === mimeType) {
    return { dataUrl, mimeType, compressed: false };
  }
  const maxSides = [VISION_IMAGE_MAX_SIDE, 1600, 1400, 1200, 1000];
  let bestDataUrl = dataUrl;
  for (const maxSide of maxSides) {
    for (const quality of VISION_IMAGE_QUALITY_STEPS) {
      const candidate = await createVisionJpegDataUrl(dataUrl, maxSide, quality);
      bestDataUrl = candidate;
      if (getDataUrlByteLength(candidate) <= VISION_IMAGE_MAX_BYTES) {
        return { dataUrl: candidate, mimeType: "image/jpeg", compressed: true };
      }
    }
  }
  return { dataUrl: bestDataUrl, mimeType: "image/jpeg", compressed: true };
}

async function normalizeUploadedImageForGemini(file: File): Promise<{ dataUrl: string; mimeType: string; normalized: boolean }> {
  const originalMimeType = file.type || "image/png";
  const dataUrl = await readFileAsDataUrl(file);
  if (GEMINI_SUPPORTED_UPLOAD_MIME_TYPES.has(originalMimeType)) {
    return { dataUrl, mimeType: originalMimeType, normalized: false };
  }
  const pngDataUrl = await convertImageDataUrlToPng(dataUrl);
  return { dataUrl: pngDataUrl, mimeType: "image/png", normalized: true };
}

const IMAGE_SOURCE_OPTIONS: Array<{ id: ImageSourceModel; label: string; note: string }> = [
  { id: "nano-banana", label: "NANO-BANNA", note: "将更关注该来源模型的高频异常区域。" },
  { id: "gpt-image-2", label: "GPT-IMAGE 2.0", note: "将更关注该来源模型的高频异常区域。" }
];

const GPT_IMAGE_SOURCE_REPAIR_PROMPT = "画面必须干净、平滑、统一，强调大色块叙事与整体轮廓，不要细碎噪点，不要高频纹理，不要脏污颗粒，不要密集小装饰，边缘清晰利落，颜色过渡平滑柔和有光晕，线条连续利落。保持高清；优化画面细节的渲染，确保纹理清晰且符合逻辑";

const MANUAL_ISSUE_OPTIONS: Array<{ id: ManualIssueId; code: string; label: string; template: string }> = TEMPLATE_ENABLED_CATEGORIES.map((id, index) => ({
  id,
  code: String(index + 1).padStart(2, "0"),
  label: PROBLEM_LABELS[id].title,
  template: REPAIR_PROMPT_TEMPLATES[id]
}));

const tabItems: Array<{ id: Exclude<RepairTab, "history">; label: string; icon: React.ElementType }> = [
  { id: "auto", label: "整体修复", icon: Wand2 },
  { id: "local", label: "局部修复", icon: BoxSelectIcon },
  { id: "upscale", label: "无损放大", icon: Maximize2 },
  { id: "prompt", label: "提示词优化", icon: Sparkles }
];

const UPSCALE_MODEL_OPTIONS = [
  {
    id: "RealESRGAN_General_x4_v3",
    label: "RealESRGAN 通用 x4",
    tone: "blue",
    note: "适合产品图、风景、人物、AI 图和截图，默认推荐。"
  },
  {
    id: "RealESRGAN_General_WDN_x4_v3",
    label: "RealESRGAN 通用降噪 x4",
    tone: "cyan",
    note: "适合有压缩噪点、脏点和颗粒感的低清图片。"
  },
  {
    id: "realesr-animevideov3-x2",
    label: "Anime Video x2",
    tone: "violet",
    note: "适合卡通、插画、二次元和线稿类图片，放大 2 倍。"
  },
  {
    id: "realesr-animevideov3-x3",
    label: "Anime Video x3",
    tone: "pink",
    note: "适合卡通/插画方向，放大 3 倍。"
  },
  {
    id: "realesr-animevideov3-x4",
    label: "Anime Video x4",
    tone: "amber",
    note: "适合卡通/插画，放大 4 倍，放大幅度最大。"
  }
];

const UPSCALE_QUICK_TIPS = [
  "普通照片/AI 图：选 RealESRGAN 通用 x4",
  "有噪点或压缩痕迹：选 RealESRGAN 通用降噪 x4",
  "卡通插画：选 Anime Video x2/x3/x4",
  "不确定时：先用 RealESRGAN 通用 x4 测一张"
];

function scaleForUpscaleModel(modelId: string) {
  if (modelId.includes("x2")) return 2;
  if (modelId.includes("x3")) return 3;
  return 4;
}

function localPromptFallback(prompt: string): PromptResult {
  return {
    original: prompt,
    issue: "提示词可能存在信息堆叠、结构约束不足或空泛画质词，容易导致手部、五官、透视和材质发散。",
    optimized: `${prompt}，主体清晰，结构符合真实解剖与透视关系，自然散射光，保留真实纹理和边缘层次，背景简洁，焦点集中`,
    negative: "多指，断指，关节错位，五官重影，面部融化，身体畸形，文字粘连，透视错误，塑料皮肤，过度磨皮，噪点块，画面撕裂",
    enhancementTags: ["结构约束", "真实纹理", "焦点简化"],
    reasoning: "本地规则会减少冲突词，补充结构边界和材质描述，并用负向词压制常见 AI 崩坏。"
  };
}

function toReadableMessage(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") {
    if (/Cloudflare|Attention Required|Sorry,\s*you have been blocked|cf-error-details|cdn-cgi\/challenge-platform|unable to access/i.test(value)) {
      return "GPT Image 2K 上游通道被 Cloudflare 拦截，当前网关无法完成该模型调用。请稍后重试或联系网关方处理 GPT 上游访问限制。";
    }
    if (/operation was aborted|aborterror|aborted|timeout|timed out|请求超时|超时/i.test(value)) {
      return "当前通道长时间未返回结果，系统会继续尝试同族可用节点。";
    }
    if (value.includes("openai_error") || value.includes("NanoBanana 图像通道")) {
      return "图生图修复通道暂不可用，请稍后重试或检查上游额度与通道状态。";
    }
    return value;
  }
  if (value instanceof Error) return toReadableMessage(value.message);
  try {
    const obj = value as { message?: unknown; error?: unknown; details?: unknown };
    const message = String(obj.message || obj.details || obj.error || JSON.stringify(value));
    if (/Cloudflare|Attention Required|Sorry,\s*you have been blocked|cf-error-details|cdn-cgi\/challenge-platform|unable to access/i.test(message)) {
      return "GPT Image 2K 上游通道被 Cloudflare 拦截，当前网关无法完成该模型调用。请稍后重试或联系网关方处理 GPT 上游访问限制。";
    }
    if (/operation was aborted|aborterror|aborted|timeout|timed out|请求超时|超时/i.test(message)) {
      return "当前通道长时间未返回结果，系统会继续尝试同族可用节点。";
    }
    if (message.includes("openai_error") || message.includes("NanoBanana 图像通道")) {
      return "图生图修复通道暂不可用，请稍后重试或检查上游额度与通道状态。";
    }
    return message;
  } catch {
    return String(value);
  }
}

function problemFromText(text: string): VisionProblem {
  const category = categoryFromText(text);
  return {
    category,
    title: PROBLEM_LABELS[category].title,
    summary: text,
    details: [text],
    severity: category === "face_collapse" || category === "hand_collapse" || category === "limb_proportion" || category === "object_topology" ? "high" : "medium",
    repairPrompt: REPAIR_PROMPT_TEMPLATES[category]
  };
}

function categoryFromText(text: string): VisionProblemCategory {
  const lower = text.toLowerCase();
  if (/手|手指|多指|断指|hand|finger/.test(text) || lower.includes("hand")) return "hand_collapse";
  if (/脸|面部|五官|眼睛|鼻子|嘴|face|facial/.test(text) || lower.includes("face")) return "face_collapse";
  if (/肢体|腿|胳膊|比例|关节|limb|body proportion/.test(text)) return "limb_proportion";
  if (/拓扑|结构|连接|交叉|断裂|物体|object|topology/.test(text) || lower.includes("topology")) return "object_topology";
  if (/文字|乱码|字体|字|text|word|typography/.test(text) || lower.includes("text")) return "text_problem";
  if (/材质|质感|金属|布料|皮肤|material/.test(text) || lower.includes("material")) return "material_confusion";
  if (/暗部|脏|噪点|颗粒|noise|dirty|shadow/.test(text) || lower.includes("noise")) return "dark_noise";
  if (/棋盘|波纹|伪影|moire|ripple|artifact/.test(text) || lower.includes("ripple")) return "ripple_artifact";
  if (/纹理错位|纹理|贴图|图案|texture/.test(text) || lower.includes("texture")) return "texture_misalignment";
  if (/撕裂|裂开|破损|边缘撕裂|tear|tearing/.test(text) || lower.includes("tear")) return "image_tearing";
  if (/渲染|失真|拉伸|变形|distortion|render/.test(text) || lower.includes("distortion")) return "render_distortion";
  return "pixel_collapse";
}

function normalizeVisionProblems(value: unknown): VisionProblem[] {
  if (!value) return [];
  const rawList = Array.isArray(value) ? value : [value];
  return rawList
    .map((item) => {
      if (typeof item === "string") return problemFromText(item);
      const source = item as Partial<VisionProblem> & Record<string, unknown>;
      const readable = toReadableMessage(item);
      const fallback = problemFromText(readable);
      const rawCategory = String(source.category || "");
      const category = PROBLEM_ORDER.includes(rawCategory as VisionProblemCategory) ? rawCategory as VisionProblemCategory : categoryFromText(rawCategory || readable);
      const details = Array.isArray(source.details)
        ? source.details.map((detail) => toReadableMessage(detail)).filter(Boolean)
        : [toReadableMessage(source.summary || source.title || source.details || readable)].filter(Boolean);
      return {
        category,
        title: toReadableMessage(source.title) || PROBLEM_LABELS[category].title,
        summary: toReadableMessage(source.summary) || fallback.summary,
        details: details.length ? details : fallback.details,
        severity: source.severity === "high" || source.severity === "medium" || source.severity === "low" ? source.severity : fallback.severity,
        repairPrompt: toReadableMessage(source.repairPrompt) || fallback.repairPrompt || REPAIR_PROMPT_TEMPLATES[category]
      };
    })
    .filter((problem) => problem.summary || problem.details.length);
}

function normalizePromptSentence(text: string) {
  return text
    .replace(/[\s\p{P}\p{S}]/gu, "")
    .replace(/[?????????????????????]/g, "")
    .toLowerCase();
}

function isSemanticallyRepeated(next: string, existing: string[]) {
  const normalizedNext = normalizePromptSentence(next);
  if (!normalizedNext) return true;
  return existing.some((item) => {
    const normalizedItem = normalizePromptSentence(item);
    if (!normalizedItem) return false;
    return normalizedItem === normalizedNext || normalizedItem.includes(normalizedNext) || normalizedNext.includes(normalizedItem);
  });
}

function uniqueTextParts(text: string) {
  return text
    .split(/[?;?\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce<string[]>((parts, part) => {
      if (!isSemanticallyRepeated(part, parts)) parts.push(part);
      return parts;
    }, []);
}

function compactRepairPrompt(text: string) {
  const parts = uniqueTextParts(text);
  return parts.slice(0, 8).join("\uFF1B");
}

function dedupeRepairPrompt(text: string) {
  return uniqueTextParts(text).join("\uFF1B");
}

function stripPromptWrapper(part: string) {
  return part
    .replace(/^Gemini\s*[\s\S]*?具体修复建议[:：]\s*/i, "")
    .replace(/^匹配到的问题分类模板[:：]\s*/i, "")
    .replace(/^根据当前图片实际检测结果，?仅处理这些异常[:：]\s*/i, "")
    .replace(/^本次自动修复重点[:：]\s*/i, "")
    .trim();
}

function actionablePromptParts(text: string) {
  return uniqueTextParts(text)
    .map(stripPromptWrapper)
    .filter((part) => part && !/^(Gemini|匹配到|根据当前|只修复已识别)/i.test(part));
}

function stripManualIssuePromptParts(value: string, selectedIssues: ManualIssueId[]) {
  if (!selectedIssues.length) return value;
  return uniqueTextParts(value)
    .filter((part) => !selectedIssues.some((issueId) => isSemanticallyRepeated(part, [REPAIR_PROMPT_TEMPLATES[issueId]])))
    .join("\uFF1B");
}

function composeRepairPrompt(basePrompt: string, selectedIssues: ManualIssueId[]) {
  const effectiveIssues = selectedIssues.filter((issueId) => issueId !== "text_problem");
  const cleanBase = stripManualIssuePromptParts(basePrompt, effectiveIssues);
  if (!ENABLE_CATEGORY_PROMPT_TEMPLATES) return dedupeRepairPrompt(cleanBase);
  const manualTemplates = effectiveIssues.map((issueId) => REPAIR_PROMPT_TEMPLATES[issueId]);
  return dedupeRepairPrompt([cleanBase, ...manualTemplates].filter(Boolean).join("\uFF1B"));
}

function buildSpecificRepairPromptFromProblems(problems: VisionProblem[], geminiPrompt = "") {
  const issueSummary = problems
    .map((problem) => {
      const label = PROBLEM_LABELS[problem.category].title;
      const details = problem.details.length ? problem.details.join("\u3001") : problem.summary;
      return "\u4FEE\u590D" + label + "\uFF1A" + details;
    })
    .filter(Boolean);

  const geminiSuggestions = actionablePromptParts(geminiPrompt)
    .filter((part) => !TEMPLATE_ENABLED_CATEGORIES.some((category) => isSemanticallyRepeated(part, [REPAIR_PROMPT_TEMPLATES[category]])));

  return dedupeRepairPrompt([
    issueSummary.join("\uFF1B"),
    geminiSuggestions.join("\uFF1B")
  ].filter(Boolean).join("\uFF1B"));
}

function buildTemplateRepairPromptFromProblems(problems: VisionProblem[]) {
  if (!ENABLE_CATEGORY_PROMPT_TEMPLATES) return "";
  const categories = Array.from(new Set(problems.map((problem) => problem.category)))
    .filter((category) => category !== "text_problem");
  return dedupeRepairPrompt(
    categories
      .flatMap((category) => DETECTION_REPAIR_KEYWORDS[category])
      .filter(Boolean)
      .join("\uFF1B")
  );
}

function buildRepairPromptFromProblems(problems: VisionProblem[], geminiPrompt = "") {
  if (!problems.length) return DEFAULT_REPAIR_PROMPT;
  const specificPrompt = buildSpecificRepairPromptFromProblems(problems, geminiPrompt);
  const templatePrompt = buildTemplateRepairPromptFromProblems(problems);

  return dedupeRepairPrompt([
    specificPrompt,
    templatePrompt,
    "\u4FDD\u7559\u539F\u56FE\u4E3B\u4F53\u8EAB\u4EFD\u3001\u6784\u56FE\u3001\u98CE\u683C\u3001\u989C\u8272\u3001\u5149\u5F71\u3001\u80CC\u666F\u5173\u7CFB\u548C\u753B\u5E45\u6BD4\u4F8B\u4E0D\u53D8\uFF0C\u4E0D\u751F\u6210\u65B0\u573A\u666F\uFF0C\u4E0D\u66FF\u6362\u4E3B\u4F53\u3002"
  ].filter(Boolean).join("\uFF1B"));
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function normalizeSelectionRect(start: SelectionPoint, end: SelectionPoint): SelectionRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x: clampPercent(x),
    y: clampPercent(y),
    width: clampPercent(Math.abs(end.x - start.x)),
    height: clampPercent(Math.abs(end.y - start.y))
  };
}

function selectionRectStyle(rect: SelectionRect): React.CSSProperties {
  return {
    left: `${rect.x}%`,
    top: `${rect.y}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`
  };
}

function buildSelectionRepairInstruction(rects: SelectionRect[]) {
  if (!rects.length) return "";
  const regionText = rects
    .map((rect, index) => {
      const x = Math.round(rect.x);
      const y = Math.round(rect.y);
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      return `区域${index + 1}：左上角 x=${x}%，y=${y}%，宽=${width}%，高=${height}%`;
    })
    .join("；");
  return `局部修复硬性规则：只允许修改用户红框框选的 ${rects.length} 个区域，${regionText}；用户附加要求、视觉识别结果和修复动作都只能作用在这些红框区域及其必要融合边缘；红框以外的所有内容绝对不修改，包括主体身份、构图、风格、颜色、光影、背景、文字、图案、比例和画幅；红框只是前端坐标标记，不是原图内容，最终输出必须自动去除所有红框；${NO_SELECTION_MARK_OUTPUT_RULE}`;
}

function appendSelectionRepairInstruction(prompt: string, rects: SelectionRect[]) {
  const instruction = buildSelectionRepairInstruction(rects);
  return instruction ? dedupeRepairPrompt([prompt, instruction].filter(Boolean).join("；")) : prompt;
}

function stripSelectionRepairInstruction(prompt: string) {
  return uniqueTextParts(prompt)
    .filter((part) => !/^重点修复用户/.test(part) && !/^局部修复硬性规则/.test(part) && !/红框|红色边框|框线|选区痕迹|选区残留|前端坐标辅助/.test(part))
    .join("；");
}

function composeAdditionalRequirementPrompt(additionalRequirement: string, detectedPrompt: string) {
  const requirement = additionalRequirement.trim();
  if (!requirement) return detectedPrompt;
  return dedupeRepairPrompt([
    `用户附加要求：${requirement}`,
    detectedPrompt,
    "附加要求必须合并进本次图生图修复流程；除用户附加要求和识别后的修复提示词涉及的区域外，其他区域不进行修复；保持其他区域主体、构图、风格、颜色、光影、背景关系和画幅比例不变"
  ].filter(Boolean).join("；"));
}

function createDefaultEditWorkspaceSnapshot(): EditWorkspaceSnapshot {
  return {
    uploadedImageSrc: null,
    uploadedMimeType: "image/jpeg",
    repairedImageSrc: null,
    repairPrompt: DEFAULT_REPAIR_PROMPT,
    repairStatus: "请选择图片和模型。",
    imageSourceModel: "",
    selectedManualIssues: [],
    detectedProblems: [],
    detectedRepairPrompt: "",
    previewMode: "after",
    note: "",
    selectionRects: [],
    additionalRequirementInput: "",
    confirmedAdditionalRequirement: ""
  };
}

function createImageWithSelectionBoxes(imageSrc: string, rects: SelectionRect[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("无法创建框选检测图。"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const strokeWidth = Math.max(6, Math.round(Math.min(canvas.width, canvas.height) * 0.008));
      context.save();
      context.strokeStyle = "#ff1f1f";
      context.lineWidth = strokeWidth;
      context.shadowColor = "rgba(255, 0, 0, 0.36)";
      context.shadowBlur = strokeWidth * 2;
      rects.forEach((rect) => {
        const x = (rect.x / 100) * canvas.width;
        const y = (rect.y / 100) * canvas.height;
        const width = (rect.width / 100) * canvas.width;
        const height = (rect.height / 100) * canvas.height;
        context.strokeRect(x, y, width, height);
      });
      context.restore();
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("图片读取失败，无法生成框选检测图。"));
    image.src = imageSrc;
  });
}

function loadCanvasImage(imageSrc: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败。"));
    image.src = imageSrc;
  });
}

async function removeSelectionMarksFromResult(
  resultImageSrc: string,
  originalImageSrc: string,
  rects: SelectionRect[]
) {
  if (!rects.length) return resultImageSrc;
  try {
    const [resultImage, originalImage] = await Promise.all([
      loadCanvasImage(resultImageSrc),
      loadCanvasImage(originalImageSrc)
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = resultImage.naturalWidth || resultImage.width;
    canvas.height = resultImage.naturalHeight || resultImage.height;
    const context = canvas.getContext("2d");
    if (!context || !canvas.width || !canvas.height) return resultImageSrc;

    const originalWidth = originalImage.naturalWidth || originalImage.width;
    const originalHeight = originalImage.naturalHeight || originalImage.height;
    context.drawImage(resultImage, 0, 0, canvas.width, canvas.height);
    const borderWidth = Math.max(10, Math.round(Math.min(canvas.width, canvas.height) * 0.016));

    const copyStrip = (dx: number, dy: number, dw: number, dh: number) => {
      const safeDx = Math.max(0, Math.min(canvas.width, dx));
      const safeDy = Math.max(0, Math.min(canvas.height, dy));
      const safeDw = Math.max(0, Math.min(canvas.width - safeDx, dw));
      const safeDh = Math.max(0, Math.min(canvas.height - safeDy, dh));
      if (!safeDw || !safeDh) return;
      const sx = (safeDx / canvas.width) * originalWidth;
      const sy = (safeDy / canvas.height) * originalHeight;
      const sw = (safeDw / canvas.width) * originalWidth;
      const sh = (safeDh / canvas.height) * originalHeight;
      context.drawImage(originalImage, sx, sy, sw, sh, safeDx, safeDy, safeDw, safeDh);
    };

    rects.forEach((rect) => {
      const x = (rect.x / 100) * canvas.width;
      const y = (rect.y / 100) * canvas.height;
      const width = (rect.width / 100) * canvas.width;
      const height = (rect.height / 100) * canvas.height;
      const left = x - borderWidth;
      const top = y - borderWidth;
      const right = x + width - borderWidth;
      const bottom = y + height - borderWidth;
      copyStrip(left, top, width + borderWidth * 2, borderWidth * 2);
      copyStrip(left, y + height - borderWidth, width + borderWidth * 2, borderWidth * 2);
      copyStrip(left, y, borderWidth * 2, height);
      copyStrip(right, y, borderWidth * 2, height);
      copyStrip(left, top, borderWidth * 2, borderWidth * 2);
      copyStrip(right, top, borderWidth * 2, borderWidth * 2);
      copyStrip(left, bottom, borderWidth * 2, borderWidth * 2);
      copyStrip(right, bottom, borderWidth * 2, borderWidth * 2);
    });

    return canvas.toDataURL("image/png");
  } catch {
    return resultImageSrc;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<RepairTab>("auto");
  const [uploadedImageSrc, setUploadedImageSrc] = useState<string | null>(null);
  const [uploadedMimeType, setUploadedMimeType] = useState("image/jpeg");
  const [repairedImageSrc, setRepairedImageSrc] = useState<string | null>(null);
  const [selectedEngineId, setSelectedEngineId] = useState<RepairEngineId>("nano-banana-2");
  const [repairPrompt, setRepairPrompt] = useState(DEFAULT_REPAIR_PROMPT);
  const [isRepairing, setIsRepairing] = useState(false);
  const [repairStatus, setRepairStatus] = useState("请选择图片和模型。");
  const [isDraggingUpload, setIsDraggingUpload] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isEngineOpen, setIsEngineOpen] = useState(false);
  const [isManualIssueOpen, setIsManualIssueOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "light" ? "light" : "dark";
  });
  const [imageSourceModel, setImageSourceModel] = useState<ImageSourceModel>("");
  const [selectedVisionEngineId, setSelectedVisionEngineId] = useState<VisionDetectEngineId>("gemini-3-flash-preview");
  const [selectedManualIssues, setSelectedManualIssues] = useState<ManualIssueId[]>([]);
  const [detectedProblems, setDetectedProblems] = useState<VisionProblem[]>([]);
  const [detectedRepairPrompt, setDetectedRepairPrompt] = useState("");
  const [previewMode, setPreviewMode] = useState<"before" | "after">("after");
  const [isPreviewZoomOpen, setIsPreviewZoomOpen] = useState(false);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [communitySettings, setCommunitySettings] = useState<CommunitySettingsDraft>(DEFAULT_COMMUNITY_SETTINGS);
  const [settingsStatus, setSettingsStatus] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [testingProvider, setTestingProvider] = useState<"nanoBanana" | "chatgptImage2" | null>(null);
  const [targetPrompt, setTargetPrompt] = useState(PRESET_PROMPTS[0].prompt);
  const [promptLoading, setPromptLoading] = useState(false);
  const [optimizedResult, setOptimizedResult] = useState<PromptResult | null>(localPromptFallback(PRESET_PROMPTS[0].prompt));
  const [historyList, setHistoryList] = useState<HistoryItem[]>([]);
  const [isHistoryLoaded, setIsHistoryLoaded] = useState(false);
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [imageCopied, setImageCopied] = useState(false);
  const [isRunLogOpen, setIsRunLogOpen] = useState(true);
  const [runLog, setRunLog] = useState<Array<{ time: string; status: "running" | "success" | "failed" | "info"; model: string; message: string; duration?: string }>>([]);
  const [repairNotice, setRepairNotice] = useState("");
  const [repairProgress, setRepairProgress] = useState(0);
  const [repairElapsedSeconds, setRepairElapsedSeconds] = useState(0);
  const [upscaleModel, setUpscaleModel] = useState("RealESRGAN_General_x4_v3");
  const [isUpscaleModelOpen, setIsUpscaleModelOpen] = useState(false);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaleStatus, setUpscaleStatus] = useState("上传图片后选择模型，即可调用本地 Upscayl / Real-ESRGAN 后端进行无损放大。");
  const [isGameMode, setIsGameMode] = useState(false);
  const [isBoxSelectMode, setIsBoxSelectMode] = useState(false);
  const [selectionRects, setSelectionRects] = useState<SelectionRect[]>([]);
  const [draftSelectionRect, setDraftSelectionRect] = useState<SelectionRect | null>(null);
  const [selectionStart, setSelectionStart] = useState<SelectionPoint | null>(null);
  const [additionalRequirementInput, setAdditionalRequirementInput] = useState("");
  const [confirmedAdditionalRequirement, setConfirmedAdditionalRequirement] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectionStageRef = useRef<HTMLDivElement>(null);
  const editWorkspaceSnapshotsRef = useRef<Record<EditWorkspaceTab, EditWorkspaceSnapshot>>({
    auto: createDefaultEditWorkspaceSnapshot(),
    local: createDefaultEditWorkspaceSnapshot()
  });
  const currentEditWorkspaceRef = useRef<EditWorkspaceTab>("auto");

  const selectedEngine = useMemo(
    () => REPAIR_ENGINES.find((engine) => engine.id === selectedEngineId) || REPAIR_ENGINES[0],
    [selectedEngineId]
  );
  const selectedUpscaleModel = useMemo(
    () => UPSCALE_MODEL_OPTIONS.find((model) => model.id === upscaleModel) || UPSCALE_MODEL_OPTIONS[0],
    [upscaleModel]
  );
  const selectedUpscaleScale = useMemo(() => scaleForUpscaleModel(upscaleModel), [upscaleModel]);
  const isEditPanel = activeTab === "auto" || activeTab === "local";
  const isLocalRepairPanel = activeTab === "local";
  const activeSelectionRects = isLocalRepairPanel ? selectionRects : [];
  const panelTitle = isLocalRepairPanel ? "局部修复" : "整体修复";
  const panelAction = "修复";
  const promptValue = useMemo(() => composeRepairPrompt(repairPrompt, selectedManualIssues), [repairPrompt, selectedManualIssues]);
  const setPromptValue = (value: string) => setRepairPrompt(stripManualIssuePromptParts(value, selectedManualIssues));
  const currentPreviewImage = uploadedImageSrc
    ? repairedImageSrc && previewMode === "after"
      ? repairedImageSrc
      : uploadedImageSrc
    : "";
  const currentPreviewAlt = repairedImageSrc && previewMode === "after" ? "修复后图片" : "修复前图片";
  const beforePreviewLabel = activeTab === "upscale" ? "原图" : "修复前";
  const afterPreviewLabel = activeTab === "upscale" ? "放大后" : "修复后";
  const shouldShowSelectionOverlay = isLocalRepairPanel && (!repairedImageSrc || previewMode === "before");

  const captureEditWorkspaceSnapshot = (): EditWorkspaceSnapshot => ({
    uploadedImageSrc,
    uploadedMimeType,
    repairedImageSrc,
    repairPrompt,
    repairStatus,
    imageSourceModel,
    selectedManualIssues,
    detectedProblems,
    detectedRepairPrompt,
    previewMode,
    note,
    selectionRects,
    additionalRequirementInput,
    confirmedAdditionalRequirement
  });

  const applyEditWorkspaceSnapshot = (snapshot: EditWorkspaceSnapshot) => {
    setUploadedImageSrc(snapshot.uploadedImageSrc);
    setUploadedMimeType(snapshot.uploadedMimeType);
    setRepairedImageSrc(snapshot.repairedImageSrc);
    setRepairPrompt(snapshot.repairPrompt);
    setRepairStatus(snapshot.repairStatus);
    setImageSourceModel(snapshot.imageSourceModel);
    setSelectedManualIssues(snapshot.selectedManualIssues);
    setDetectedProblems(snapshot.detectedProblems);
    setDetectedRepairPrompt(snapshot.detectedRepairPrompt);
    setPreviewMode(snapshot.previewMode);
    setNote(snapshot.note);
    setSelectionRects(snapshot.selectionRects);
    setAdditionalRequirementInput(snapshot.additionalRequirementInput);
    setConfirmedAdditionalRequirement(snapshot.confirmedAdditionalRequirement);
    setIsBoxSelectMode(false);
    setDraftSelectionRect(null);
    setSelectionStart(null);
  };

  const switchTab = (nextTab: RepairTab) => {
    if (isRepairing || isDetecting) {
      setRepairStatus("当前任务仍在运行，请等待完成后再切换板块。");
      return;
    }

    if (activeTab === "auto" || activeTab === "local") {
      editWorkspaceSnapshotsRef.current[activeTab] = captureEditWorkspaceSnapshot();
    }

    if (nextTab === "auto" || nextTab === "local") {
      applyEditWorkspaceSnapshot(editWorkspaceSnapshotsRef.current[nextTab]);
      currentEditWorkspaceRef.current = nextTab;
    }

    setActiveTab(nextTab);
  };

  const handleImageSourceSelect = (sourceId: ImageSourceModel) => {
    setImageSourceModel(sourceId);
    if (sourceId === "gpt-image-2") {
      setRepairPrompt((current) => {
        if (current.includes(GPT_IMAGE_SOURCE_REPAIR_PROMPT)) return current;
        return dedupeRepairPrompt([current, GPT_IMAGE_SOURCE_REPAIR_PROMPT].filter(Boolean).join("\n"));
      });
      setRepairStatus("已添加 GPT-IMAGE 2.0 来源修复提示词，可继续编辑后修复。");
    }
  };

  const appendRunLog = (entry: { status: "running" | "success" | "failed" | "info"; model: string; message: string }) => {
    setRunLog((items) => [{ ...entry, time: new Date().toLocaleTimeString("zh-CN") }, ...items].slice(0, 12));
  };

  const resetSelection = () => {
    setIsBoxSelectMode(false);
    setSelectionRects([]);
    setDraftSelectionRect(null);
    setSelectionStart(null);
  };

  const getSelectionPoint = (event: React.PointerEvent<HTMLDivElement>): SelectionPoint | null => {
    const bounds = selectionStageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    return {
      x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
      y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100)
    };
  };

  const handleSelectionStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isLocalRepairPanel || !isBoxSelectMode || !uploadedImageSrc) return;
    const point = getSelectionPoint(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreviewMode("before");
    setSelectionStart(point);
    setDraftSelectionRect({ ...point, width: 0, height: 0 });
  };

  const handleSelectionMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isLocalRepairPanel || !isBoxSelectMode || !selectionStart) return;
    const point = getSelectionPoint(event);
    if (!point) return;
    setDraftSelectionRect(normalizeSelectionRect(selectionStart, point));
  };

  const handleSelectionEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isLocalRepairPanel || !isBoxSelectMode || !selectionStart) return;
    const point = getSelectionPoint(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (point) {
      const rect = normalizeSelectionRect(selectionStart, point);
      if (rect.width >= 2 && rect.height >= 2) {
        setSelectionRects((rects) => [...rects, rect]);
        setRepairStatus("已新增一个重点修复区域，可继续框选其他区域，或确认并修复。");
      } else {
        setRepairStatus("框选区域过小，请重新拖拽选择需要修复的位置。");
      }
    }
    setDraftSelectionRect(null);
    setSelectionStart(null);
    setIsBoxSelectMode(false);
  };

  const handleBoxSelectToggle = () => {
    if (!isLocalRepairPanel) return;
    if (!uploadedImageSrc) {
      setRepairStatus("请先上传图片，再框选需要修复的区域。");
      return;
    }
    setPreviewMode("before");
    setIsBoxSelectMode((enabled) => {
      const next = !enabled;
      setRepairStatus(next ? "请在图片上拖拽框选需要重点修复的区域。" : `${selectedEngine.name} 已选择，等待处理。`);
      return next;
    });
  };

  const undoSelection = () => {
    setDraftSelectionRect(null);
    setSelectionStart(null);
    setIsBoxSelectMode(false);
    setSelectionRects((rects) => rects.slice(0, -1));
    setRepairStatus("已撤回最近一次框选区域。");
  };

  const confirmAdditionalRequirement = () => {
    const value = additionalRequirementInput.trim();
    if (!value) return;
    setConfirmedAdditionalRequirement(value);
    setRepairStatus("附加要求已确认，将与识别后的修复提示词一同发送给修复引擎。");
  };

  const clearAdditionalRequirement = () => {
    setAdditionalRequirementInput("");
    setConfirmedAdditionalRequirement("");
    setRepairStatus("已清除附加要求。");
  };

  const confirmSelectionRepair = async () => {
    if (!selectionRects.length) {
      setRepairStatus("请先框选需要重点修复的区域。");
      return;
    }
    const detectedPrompt = await runVisionDetect({ suppressPanelUpdate: true });
    if (!detectedPrompt) return;
    const finalPrompt = composeAdditionalRequirementPrompt(confirmedAdditionalRequirement || additionalRequirementInput, detectedPrompt);
    await runModelRepair({
      engine: selectedEngine,
      prompt: finalPrompt,
      statusPrefix: "已完成红框区域识别，正在调用"
    });
  };

  const normalizeRunAttempts = (attempts: any[], fallbackModel: string) => {
    if (!Array.isArray(attempts) || !attempts.length) {
      return [{ time: new Date().toLocaleTimeString("zh-CN"), status: "info" as const, model: fallbackModel, message: "等待模型返回运行记录。" }];
    }
    return attempts.map((attempt) => ({
      time: new Date(attempt.time || Date.now()).toLocaleTimeString("zh-CN"),
      status: attempt.status === "success" ? "success" as const : attempt.status === "running" ? "running" as const : "failed" as const,
      model: [attempt.gateway, attempt.model].filter(Boolean).join(" / ") || fallbackModel,
      message: toReadableMessage(attempt.message || attempt.reason) || (attempt.status === "success" ? "调用成功" : "调用失败"),
      duration: typeof attempt.durationMs === "number" ? formatAttemptDuration(attempt.durationMs) : undefined
    })).reverse().slice(0, 12);
  };

  const formatAttemptDuration = (milliseconds: number) => {
    const seconds = Math.max(0, Math.round(milliseconds / 1000));
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}分${seconds % 60}秒`;
  };

  const displayRepairModelLabel = (modelId: string) => {
    const normalized = modelId.toLowerCase();
    if (normalized.includes("gpt-image-2")) return "GPT Image 2 2K";
    if (normalized.includes("pro")) return "Nano Banana Pro 2K";
    if (normalized.includes("banana") || normalized.includes("banan")) return "Nano Banana 2 2K";
    return modelId;
  };

  const formatRepairDuration = (seconds: number) => {
    const safeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const rest = safeSeconds % 60;
    return minutes > 0 ? `${minutes}分${rest}秒` : `${rest}秒`;
  };

  const progressFromElapsed = (seconds: number) => {
    if (seconds <= 0) return 6;
    if (seconds < 180) return Math.min(80, Math.round(8 + (seconds / 180) * 72));
    return Math.min(95, Math.round(80 + ((seconds - 180) / 420) * 15));
  };

  const showBrowserNotification = async (title: string, body: string) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      let permission = Notification.permission;
      if (permission === "default") {
        permission = await Notification.requestPermission();
      }
      if (permission !== "granted") return;
      new Notification(title, {
        body,
        icon: "/fixi-logo.png",
        badge: "/fixi-logo.png"
      });
    } catch {
      // Browser notifications are best-effort and should never block repair results.
    }
  };

  const notifyRepairComplete = (engineName: string) => {
    setRepairNotice(`修复完成，最终调用模型：${engineName}`);
    void showBrowserNotification("FIXI 修复完成", `最终调用模型：${engineName}`);
    window.setTimeout(() => setRepairNotice(""), 4200);
  };

  useEffect(() => {
    let isMounted = true;

    loadPersistedHistory()
      .then((items) => {
        if (isMounted) setHistoryList(items);
      })
      .finally(() => {
        if (isMounted) setIsHistoryLoaded(true);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    fetch("/api/community/settings")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("无法读取本地配置")))
      .then((settings) => {
        setCommunitySettings({
          nanoBanana: { ...DEFAULT_COMMUNITY_SETTINGS.nanoBanana, ...settings.nanoBanana, apiKey: "" },
          chatgptImage2: { ...DEFAULT_COMMUNITY_SETTINGS.chatgptImage2, ...settings.chatgptImage2, apiKey: "" }
        });
      })
      .catch(() => setSettingsStatus("无法读取本地设置，请确认服务正在运行。"));
  }, []);

  useEffect(() => {
    if (!isHistoryLoaded) return;
    persistHistory(historyList);
  }, [historyList, isHistoryLoaded]);

  useEffect(() => {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (isRepairing) return;
    setRepairStatus(`${selectedEngine.name} 已选择，等待处理。`);
  }, [selectedEngine, isRepairing]);

  useEffect(() => {
    if (isLocalRepairPanel) return;
    setIsBoxSelectMode(false);
    setDraftSelectionRect(null);
    setSelectionStart(null);
    setRepairPrompt((current) => stripSelectionRepairInstruction(current));
    setDetectedRepairPrompt((current) => stripSelectionRepairInstruction(current));
  }, [isLocalRepairPanel]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.includes("image")) {
          const file = item.getAsFile();
          if (file) handleNormalizedFileImport(file);
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const handleFileImport = (file: File) => {
    setUploadedMimeType(file.type || "image/png");
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result !== "string") return;
      setUploadedImageSrc(event.target.result);
      setRepairedImageSrc(null);
      setDetectedProblems([]);
      setDetectedRepairPrompt("");
      setSelectedManualIssues([]);
      resetSelection();
      setAdditionalRequirementInput("");
      setConfirmedAdditionalRequirement("");
      setRepairProgress(0);
      setRepairElapsedSeconds(0);
      setUpscaleStatus("图片已导入，可以开始无损放大。");
      setPreviewMode("after");
      setRepairStatus("图片已导入，可以开始处理。");
    };
    reader.readAsDataURL(file);
  };

  const handleNormalizedFileImport = async (file: File) => {
    try {
      setRepairStatus("正在读取图片。");
      const normalizedImage = await normalizeUploadedImageForGemini(file);
      setUploadedMimeType(normalizedImage.mimeType);
      setUploadedImageSrc(normalizedImage.dataUrl);
      setRepairedImageSrc(null);
      setDetectedProblems([]);
      setDetectedRepairPrompt("");
      setSelectedManualIssues([]);
      resetSelection();
      setAdditionalRequirementInput("");
      setConfirmedAdditionalRequirement("");
      setRepairProgress(0);
      setRepairElapsedSeconds(0);
      setPreviewMode("after");
      setRepairStatus(
        normalizedImage.normalized
          ? "图片已导入，并已转为视觉识别支持的 PNG 格式。"
          : "图片已导入，可以开始处理。"
      );
    } catch (error: any) {
      setRepairStatus(`图片导入失败：${error?.message || "当前图片格式无法读取。"}`);
    }
  };

  const handleImageUploaded = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) handleNormalizedFileImport(file);
    event.target.value = "";
  };

  const addHistoryItem = (repairedImage: string, prompt = promptValue, engineName = selectedEngine.name) => {
    if (!uploadedImageSrc) return;
    const item: HistoryItem = {
      id: `history_${Date.now()}`,
      title: note.trim() || (activeTab === "upscale" ? "无损放大记录" : `${panelTitle}记录`),
      timestamp: new Date().toLocaleString("zh-CN"),
      originalImage: uploadedImageSrc,
      repairedImage,
      engineName,
      prompt,
      notes: note.trim()
    };
    setHistoryList((list) => [item, ...list]);
  };

  const toggleManualIssue = (issueId: ManualIssueId) => {
    setSelectedManualIssues((current) => {
      const next = current.includes(issueId)
        ? current.filter((id) => id !== issueId)
        : [...current, issueId];
      if (next.length) {
        setRepairStatus("已追加手动画面问题提示词，可继续编辑后修复。");
      } else {
        setRepairStatus(`${selectedEngine.name} 已选择，等待处理。`);
      }
      return next;
    });
  };

  const runVisionDetect = async (options?: { suppressPanelUpdate?: boolean }): Promise<string | null> => {
    if (!uploadedImageSrc) {
      setRepairStatus("请先上传需要检测的图片。");
      return null;
    }
    setIsDetecting(true);
    if (!options?.suppressPanelUpdate) {
      setDetectedProblems([]);
      setDetectedRepairPrompt("");
    }
    try {
      setRepairStatus(activeSelectionRects.length ? "正在识别红框内重点区域。" : "正在识别图片问题。");
      const detectionImageSrc = activeSelectionRects.length ? await createImageWithSelectionBoxes(uploadedImageSrc, activeSelectionRects) : uploadedImageSrc;
      const visionImage = await prepareImageForVisionDetect(
        detectionImageSrc,
        activeSelectionRects.length ? "image/png" : uploadedMimeType
      );
      const response = await fetch("/api/vision/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: visionImage.dataUrl,
          mimeType: visionImage.mimeType,
          engineId: selectedVisionEngineId,
          imageSourceModel: imageSourceModel || undefined,
          selectionBox: activeSelectionRects.length ? activeSelectionRects : undefined
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(toReadableMessage(data.details || data.error || data) || "视觉检测失败");
      const problems = normalizeVisionProblems(data.problems);
      const normalizedProblems = problems.length
        ? problems
        : [problemFromText("视觉模型未返回具体分类，按已上传图片需要修复处理：请检查并修复像素崩坏、局部撕裂、渲染失真、模糊、噪点、材质和纹理异常。")];
      const geminiSpecificPrompt = toReadableMessage(data.specificRepairPrompt);
      const nextRepairPrompt = appendSelectionRepairInstruction(
        compactRepairPrompt(buildRepairPromptFromProblems(normalizedProblems, geminiSpecificPrompt)),
        activeSelectionRects
      );
      if (!options?.suppressPanelUpdate) {
        setDetectedProblems(normalizedProblems);
        setDetectedRepairPrompt(nextRepairPrompt);
      }
      setRepairPrompt(nextRepairPrompt);
      const attempts = Array.isArray(data.attempts) ? data.attempts : [];
      const failedAttempts = attempts.filter((attempt: any) => attempt?.status === "failed");
      const successAttempt = attempts.find((attempt: any) => attempt?.status === "success");
      const fallbackStatus = failedAttempts.length && successAttempt
        ? `${failedAttempts.map((attempt: any) => attempt.model || "识别模型").join("、")} 调用失败，已自动顺延 ${successAttempt.model || "备用识别模型"} 并完成识别。`
        : "检测完成，请确认问题后开始修复。";
      setRepairStatus(options?.suppressPanelUpdate ? "红框区域识别完成，正在准备修复。" : fallbackStatus);
      return nextRepairPrompt;
    } catch (error: any) {
      if (!options?.suppressPanelUpdate) {
        setDetectedProblems([problemFromText(`检测失败：${toReadableMessage(error) || "请稍后重试"}`)]);
      }
      setRepairStatus(`视觉识别失败：${toReadableMessage(error) || "请稍后重试"}`);
      return null;
    } finally {
      setIsDetecting(false);
    }
  };

  const runModelRepair = async (options?: { engine?: RepairEngine; prompt?: string; statusPrefix?: string }) => {
    if (isRepairing) {
      setRepairStatus("当前修复任务仍在调用模型，请等待结果返回。");
      return;
    }
    if (!uploadedImageSrc) {
      setRepairStatus("请先上传需要处理的图片。");
      return;
    }

    const engine = options?.engine || selectedEngine;
    const basePrompt = (options?.prompt || promptValue || DEFAULT_REPAIR_PROMPT).trim() || DEFAULT_REPAIR_PROMPT;
    if (!promptValue.trim() && !options?.prompt) {
      setRepairPrompt(DEFAULT_REPAIR_PROMPT);
    }
    const activePrompt = activeSelectionRects.length
      ? appendSelectionRepairInstruction(basePrompt, activeSelectionRects)
      : stripSelectionRepairInstruction(basePrompt);
    const repairSelectionRects = activeSelectionRects.map((rect) => ({ ...rect }));
    const startedAt = Date.now();
    setIsRepairing(true);
    setRepairStatus(`正在调用：${engine.name}`);
    setRepairProgress(6);
    setRepairElapsedSeconds(0);
    setRunLog([]);
    setRepairNotice("");
    appendRunLog({
      status: "running",
      model: engine.model || engine.name,
      message: "已提交图生图修复任务，正在后台调用模型并自动切换可用线路。"
    });
    try {
      const modelRequestImage = await prepareImageForModelRepairRequest(uploadedImageSrc, uploadedMimeType);
      if (modelRequestImage.compressed) {
        appendRunLog({
          status: "running",
          model: engine.model || engine.name,
          message: "已为模型通道压缩参考图，避免网关请求过大导致解析失败。"
        });
      }
      const startResponse = await fetch("/api/image-edit/repair/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineId: engine.id,
          provider: engine.provider,
          modelId: engine.model,
          prompt: activePrompt,
          imageBase64: modelRequestImage.dataUrl,
          mimeType: modelRequestImage.mimeType
        })
      });
      const startData = await startResponse.json();
      if (!startResponse.ok || !startData.jobId) {
        throw new Error(toReadableMessage(startData.details || startData.error || startData) || "模型任务提交失败");
      }
      appendRunLog({
        status: "running",
        model: engine.model || engine.name,
        message: "模型任务已进入后台队列，前端将持续等待最终输出。"
      });
      setRepairStatus(`正在调用：${engine.name}`);

      let data: any = null;
      for (let pollIndex = 0; pollIndex < 900; pollIndex += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
        setRepairElapsedSeconds(elapsedSeconds);
        setRepairProgress(progressFromElapsed(elapsedSeconds));
        const jobResponse = await fetch(`/api/image-edit/repair/job/${encodeURIComponent(startData.jobId)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" }
        });
        const jobData = await jobResponse.json();
        if (!jobResponse.ok) {
          throw new Error(toReadableMessage(jobData.details || jobData.error || jobData) || "模型任务状态读取失败");
        }

        if (jobData.status === "queued") {
          setRepairStatus(`正在调用：${engine.name}`);
        } else if (jobData.status === "running") {
          const runningAttempt = Array.isArray(jobData.attempts)
            ? [...jobData.attempts].reverse().find((attempt: any) => attempt?.status === "running")
            : null;
          const runningModel = runningAttempt?.model || engine.name;
          setRepairStatus(`正在调用：${runningModel}`);
          if (Array.isArray(jobData.attempts) && jobData.attempts.length) {
            setRunLog(normalizeRunAttempts(jobData.attempts, engine.model || engine.name));
          } else if (pollIndex % 8 === 0) {
            appendRunLog({
              status: "running",
              model: engine.model || engine.name,
              message: "模型仍在生成修复结果，尚未返回最终图片。"
            });
          }
        } else if (jobData.status === "success") {
          data = jobData.result;
          break;
        } else if (jobData.status === "failed") {
          setRunLog(normalizeRunAttempts(jobData.attempts, engine.model || engine.name));
          throw new Error(toReadableMessage(jobData.message || jobData.error || "模型接口调用失败"));
        }
      }

      if (!data) throw new Error("模型任务等待超时，请稍后查看历史或重新尝试。");
      const actualEngineName = data.modelId || data.engineName || engine.name;
      const actualEngineLabel = displayRepairModelLabel(String(actualEngineName));
      const finishedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      setRepairElapsedSeconds(finishedSeconds);
      setRepairProgress(100);
      setRunLog(normalizeRunAttempts(data.attempts, actualEngineLabel));
      const modelOutputImage = data.imageBase64;
      if (!modelOutputImage) throw new Error("图生图接口未返回有效修复图");
      const cleanedOutputImage = isLocalRepairPanel && repairSelectionRects.length
        ? await removeSelectionMarksFromResult(modelOutputImage, uploadedImageSrc, repairSelectionRects)
        : modelOutputImage;
      if (isLocalRepairPanel) {
        resetSelection();
      }
      setRepairedImageSrc(cleanedOutputImage);
      setPreviewMode("after");
      addHistoryItem(cleanedOutputImage, activePrompt, actualEngineLabel);
      notifyRepairComplete(actualEngineLabel);
      const failedAttempts = Array.isArray(data.attempts) ? data.attempts.filter((attempt: any) => attempt?.status === "failed") : [];
      setRepairStatus(
        failedAttempts.length
          ? `${panelTitle}完成，用时 ${formatRepairDuration(finishedSeconds)}。原有通道失败 ${failedAttempts.length} 次，已顺延并调用 ${actualEngineLabel} 完成修复。`
          : `${panelTitle}完成，用时 ${formatRepairDuration(finishedSeconds)}，实际调用模型：${actualEngineLabel}`
      );
    } catch (error: any) {
      setRepairProgress(0);
      setRepairStatus(`模型修复失败：${toReadableMessage(error) || "图生图接口未返回有效修复图"}`);
    } finally {
      setIsRepairing(false);
    }
  };

  const confirmDetectedRepair = async () => {
    if (!detectedProblems.length) {
      setRepairStatus("请先完成视觉识别检测。");
      return;
    }
    const detectedPrompt = dedupeRepairPrompt(promptValue || detectedRepairPrompt || buildRepairPromptFromProblems(detectedProblems));
    await runModelRepair({
      engine: selectedEngine,
      prompt: detectedPrompt,
      statusPrefix: "已确认检测结果，正在调用"
    });
  };

  const runPromptOptimizer = async () => {
    if (!targetPrompt.trim()) return;
    setPromptLoading(true);
    try {
      const response = await fetch("/api/gemini/fix-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: targetPrompt, imageBase64: uploadedImageSrc, mimeType: uploadedMimeType })
      });
      if (!response.ok) throw new Error("prompt failed");
      const data = await response.json();
      setOptimizedResult({
        original: targetPrompt,
        issue: data.issue,
        optimized: data.optimized_prompt,
        negative: data.negative_prompt,
        enhancementTags: data.enhancement_tags || [],
        reasoning: data.reasoning || ""
      });
    } catch {
      setOptimizedResult(localPromptFallback(targetPrompt));
    } finally {
      setPromptLoading(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1600);
  };

  const copyImageToClipboard = async (src: string) => {
    const response = await fetch(src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
    setImageCopied(true);
    window.setTimeout(() => setImageCopied(false), 1600);
  };

  const downloadImage = (src: string, prefix: string) => {
    const link = document.createElement("a");
    link.href = src;
    link.download = `${prefix}_${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const saveHistory = () => {
    if (!repairedImageSrc) return;
    addHistoryItem(repairedImageSrc);
    setNote("");
    setRepairStatus("已保存到历史记录。");
  };

  const runImageUpscale = async () => {
    if (isUpscaling) {
      setUpscaleStatus("当前无损放大任务仍在运行，请等待结果返回。");
      return;
    }
    if (!uploadedImageSrc) {
      setUpscaleStatus("请先上传需要放大的图片。");
      return;
    }

    setIsUpscaling(true);
    setRepairNotice("");
    setUpscaleStatus(`正在调用本地 Upscayl / Real-ESRGAN，执行 ${selectedUpscaleScale}x 无损放大。`);
    try {
      const response = await fetch("/api/image-upscale", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: uploadedImageSrc,
          mimeType: uploadedMimeType,
          scale: selectedUpscaleScale,
          model: upscaleModel
        })
      });
      const data = await response.json();
      if (!response.ok || !data.imageBase64) {
        throw new Error(toReadableMessage(data.details || data.error || data) || "无损放大失败");
      }
      setRepairedImageSrc(data.imageBase64);
      setPreviewMode("after");
      addHistoryItem(data.imageBase64, `${selectedUpscaleScale}x 无损放大`, `Upscayl / ${data.model || upscaleModel}`);
      setUpscaleStatus(`无损放大完成：${data.scale || selectedUpscaleScale}x，模型：${data.model || upscaleModel}。`);
      setRepairNotice("无损放大完成，结果已加入历史记录。");
      void showBrowserNotification("FIXI 无损放大完成", `模型：${data.model || upscaleModel}`);
      window.setTimeout(() => setRepairNotice(""), 4200);
    } catch (error: any) {
      setUpscaleStatus(`无损放大失败：${toReadableMessage(error) || "请检查 Upscayl 后端和 Vulkan 显卡环境。"}`);
    } finally {
      setIsUpscaling(false);
    }
  };

  const updateCommunityGateway = (
    provider: "nanoBanana" | "chatgptImage2",
    field: keyof CommunityGatewayDraft,
    value: string
  ) => {
    setCommunitySettings((current) => ({
      ...current,
      [provider]: { ...current[provider], [field]: value }
    }));
    setSettingsStatus("");
  };

  const saveCommunitySettings = async () => {
    setIsSavingSettings(true);
    setSettingsStatus("");
    try {
      const response = await fetch("/api/community/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(communitySettings)
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "保存失败");
      setCommunitySettings({
        nanoBanana: { ...communitySettings.nanoBanana, ...data.settings.nanoBanana, apiKey: "" },
        chatgptImage2: { ...communitySettings.chatgptImage2, ...data.settings.chatgptImage2, apiKey: "" }
      });
      setSettingsStatus("配置已保存到当前设备。API Key 不会显示在界面中。");
    } catch (error: any) {
      setSettingsStatus(`保存失败：${toReadableMessage(error) || "请检查输入内容。"}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const testCommunityGateway = async (provider: "nanoBanana" | "chatgptImage2") => {
    setTestingProvider(provider);
    setSettingsStatus("");
    try {
      const response = await fetch("/api/community/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, settings: communitySettings })
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "连接测试失败");
      setSettingsStatus(data.message || "连接测试成功。");
    } catch (error: any) {
      setSettingsStatus(toReadableMessage(error) || "连接测试失败，请检查网关、模型 ID 和 API Key。");
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className={`fixi-app min-h-screen antialiased ${theme === "dark" ? "dark" : ""} ${isGameMode ? "game-mode" : ""}`}>
      {theme === "dark" && <Aurora colorStops={["#78ebff", "#c59ee9", "#5227FF"]} amplitude={1} blend={0.39} speed={0.68} />}
      <header className="app-header border-b">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <img src="/fixi-logo.png" alt="FIXI" className="h-20 w-40 rounded-2xl object-contain" />
            <div>
              <p className="text-sm font-medium text-emerald-700">修复崩坏 · 还原细节 · 重塑完美</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight md:text-3xl">FIXI 图片修复 Community</h1>
              <p className="mt-1 text-xs text-zinc-400/80">开源版本不包含任何网关或密钥，请在设置中配置自己的图生图服务。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-3">
              {tabItems.filter((item) => item.id !== "prompt").map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => switchTab(item.id)}
                    className={`inline-flex min-h-16 items-center gap-3 rounded-lg border px-6 py-4 text-xl font-semibold transition ${
                      active ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400"
                    }`}
                  >
                    <Icon className="h-6 w-6" />
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="theme-switch flex rounded-lg border border-zinc-200 bg-white p-1">
              <button
                onClick={() => setTheme("light")}
                aria-label="白日模式"
                className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ${theme === "light" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
              >
                <Sun className="h-4 w-4" />
              </button>
              <button
                onClick={() => setTheme("dark")}
                aria-label="黑夜模式"
                className={`inline-flex h-10 w-10 items-center justify-center rounded-md text-sm font-medium ${theme === "dark" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
              >
                <Moon className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              className="inline-flex h-12 w-12 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 transition hover:border-zinc-400 dark:border-white/15 dark:bg-white/5 dark:text-white"
              aria-label="打开网关设置"
              title="网关设置"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <button type="button" className="guide-float-button" onClick={() => setIsGuideOpen(true)} aria-label="打开使用教程">
        <BookOpen className="h-5 w-5" />
        <span>使用教程</span>
      </button>

      <main className="mx-auto grid max-w-[1720px] gap-6 px-6 py-7 lg:grid-cols-[540px_minmax(0,1fr)]">
        {isEditPanel && (
          <>
            <aside className="space-y-5">
              <section
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingUpload(true);
                }}
                onDragLeave={() => setIsDraggingUpload(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingUpload(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) handleNormalizedFileImport(file);
                }}
                className={`rounded-lg border bg-white p-4 shadow-sm ${isDraggingUpload ? "border-emerald-500 ring-2 ring-emerald-100" : "border-zinc-200"}`}
              >
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUploaded} />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">导入图片</h2>
                    <p className="mt-1 text-sm text-zinc-500">拖入、粘贴或选择图片。</p>
                  </div>
                  <ImageIcon className="h-5 w-5 text-zinc-400" />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  选择图片
                </button>
                <div className="mt-3 flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5">
                  <div className="group relative shrink-0">
                    <button
                      type="button"
                      aria-label="图片来源说明"
                      className="flex h-6 w-6 items-center justify-center rounded-full border border-zinc-300 text-xs font-semibold text-zinc-500"
                    >
                      ?
                    </button>
                    <div className="pointer-events-none absolute left-0 top-8 z-20 hidden w-64 rounded-md border border-zinc-200 bg-white p-3 text-xs leading-5 text-zinc-600 shadow-lg group-hover:block">
                      图片来源非必选。未选择时按默认规则检测；选择来源后，检测会更贴近该模型的常见出错区域。
                    </div>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-zinc-600">来源</span>
                  <div className="flex min-w-0 flex-1 gap-1.5">
                    {IMAGE_SOURCE_OPTIONS.map((option) => {
                      const active = imageSourceModel === option.id;
                      return (
                        <button
                          key={option.label}
                          onClick={() => handleImageSourceSelect(option.id)}
                          className={`min-w-0 flex-1 rounded-md border px-2 py-1.5 text-xs font-semibold transition ${
                            active
                              ? theme === "dark"
                                ? "border-emerald-500 bg-emerald-950/60 text-emerald-50"
                                : "border-emerald-600 bg-emerald-50"
                              : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  {imageSourceModel && (
                    <button
                      onClick={() => setImageSourceModel("")}
                      className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 hover:bg-white dark:hover:bg-zinc-800"
                    >
                      清除
                    </button>
                  )}
                </div>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <button
                  onClick={() => setIsEngineOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <h2 className="text-sm font-semibold">模型引擎</h2>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      修复会按所选模型在多个图生图网关中自动顺延；Gemini 仅用于视觉检测。
                    </p>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-500 transition ${isEngineOpen ? "rotate-180" : ""}`} />
                </button>
                {isEngineOpen && (
                  <div className="mt-2 space-y-1.5">
                    {REPAIR_ENGINES.map((engine) => {
                      return (
                        <button
                          key={engine.id}
                          onClick={() => {
                            setSelectedEngineId(engine.id);
                          }}
                          className={`w-full rounded-md border px-3 py-2 text-left transition ${
                            selectedEngineId === engine.id
                              ? theme === "dark"
                                ? "border-emerald-500 bg-emerald-950/60 text-emerald-50"
                                : "border-emerald-600 bg-emerald-50"
                              : "border-zinc-200 bg-white hover:border-zinc-400"
                          }`}
                        >
                          <span className="flex items-center justify-between gap-2 text-sm font-semibold leading-5">
                            {engine.name}
                          </span>
                          <span className="mt-0.5 block truncate text-xs text-zinc-500">
                            {engine.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">视觉识别检测</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      {isLocalRepairPanel ? "选择局部识别引擎，确认后自动识别红框并修复。" : "选择视觉识别引擎后检测画面问题。"}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="进入游戏模式"
                    title="进入游戏模式"
                    onClick={() => setIsGameMode(true)}
                    className="game-entry-button inline-flex h-9 w-9 items-center justify-center rounded-full text-zinc-400 transition hover:text-zinc-700"
                  >
                    <Eye className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-1 rounded-md border border-zinc-200 bg-zinc-50 p-1">
                  {VISION_DETECT_ENGINES.map((engine) => (
                    <button
                      key={engine.id}
                      type="button"
                      title={engine.tooltip}
                      onClick={() => setSelectedVisionEngineId(engine.id)}
                      className={`min-w-0 rounded-md px-1.5 py-2 text-center text-[11px] font-semibold leading-tight transition ${
                        selectedVisionEngineId === engine.id
                          ? theme === "dark"
                            ? "bg-white text-zinc-950 shadow-sm"
                            : "bg-zinc-950 text-white shadow-sm"
                          : "text-zinc-500 hover:bg-white hover:text-zinc-900"
                      }`}
                    >
                      {engine.name}
                    </button>
                  ))}
                </div>
                {!isLocalRepairPanel && (
                  <>
                    <button
                      onClick={() => runVisionDetect()}
                      disabled={isDetecting}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60"
                    >
                      {isDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
                      检测图片问题
                    </button>
                    <div className="mt-3 max-h-[560px] min-h-[220px] overflow-y-auto rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-700">
                      {detectedProblems.length > 0 ? (
                        <VisionProblemPanel problems={detectedProblems} repairPrompt={detectedRepairPrompt} />
                      ) : (
                        <p className="text-zinc-500">检测结果会显示在这里。</p>
                      )}
                    </div>
                    <button
                      onClick={confirmDetectedRepair}
                      disabled={isRepairing || isDetecting || detectedProblems.length === 0}
                      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {isRepairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      确认并开始修复
                    </button>
                  </>
                )}
                <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <button
                    onClick={() => setIsVersionOpen((open) => !open)}
                    className="flex w-full items-center justify-between gap-3 text-left text-xs font-medium text-zinc-500"
                  >
                    <span>Community 2.0</span>
                    <span className="inline-flex items-center gap-1">
                      更新内容
                      <ChevronDown className={`h-3.5 w-3.5 transition ${isVersionOpen ? "rotate-180" : ""}`} />
                    </span>
                  </button>
                  {isVersionOpen && (
                    <ul className="mt-2 space-y-1 text-xs leading-5 text-zinc-500">
                      {VERSION_UPDATES.map((item) => (
                        <li key={item}>• {item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            </aside>

            <section className="right-workspace space-y-6">
              {!isLocalRepairPanel && <section className="repair-card rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">{panelTitle}</h2>
                    <p className="mt-1 text-sm text-zinc-500">{repairStatus}</p>
                    {(isRepairing || repairProgress > 0) && (
                      <div className="mt-3 max-w-md">
                        <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                          <div
                            className="h-full rounded-full bg-zinc-950 transition-all duration-500"
                            style={{ width: `${Math.min(100, Math.max(0, repairProgress))}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-xs text-zinc-500">
                          <span>{Math.round(repairProgress)}%</span>
                          <span>{repairElapsedSeconds > 0 ? `已用时 ${formatRepairDuration(repairElapsedSeconds)}` : "准备中"}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => switchTab("history")}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    >
                      <History className="h-4 w-4" />
                      历史{historyList.length > 0 ? ` (${historyList.length})` : ""}
                    </button>
                    <button
                      onClick={runModelRepair}
                      disabled={isRepairing}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {isRepairing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      {panelAction}
                    </button>
                  </div>
                </div>
                <label className="mt-4 block text-sm">
                  <span className="font-medium">修复关键词</span>
                  <textarea
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    className="mt-1 min-h-32 w-full resize-y rounded-md border border-zinc-200 p-3 leading-6 outline-none focus:border-emerald-500"
                  />
                </label>
              </section>}

              {!isLocalRepairPanel && <section className="manual-issue-card relative overflow-hidden rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="relative z-20 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">画面问题</h2>
                    <p className="mt-1 text-sm text-zinc-500">已知问题时可直接选择，系统会跳过视觉检测并生成通用修复模板。</p>
                  </div>
                  <button
                    onClick={() => setIsManualIssueOpen((open) => !open)}
                    className="self-start inline-flex items-center gap-1 rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 md:self-auto"
                  >
                    {isManualIssueOpen ? "收起" : "展开"}
                    <ChevronDown className={`h-3.5 w-3.5 transition ${isManualIssueOpen ? "rotate-180" : ""}`} />
                  </button>
                  {selectedManualIssues.length > 0 && (
                    <button
                      onClick={() => {
                        setSelectedManualIssues([]);
                        setRepairStatus(`${selectedEngine.name} 已选择，等待处理。`);
                      }}
                      className="self-start rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-50 md:self-auto"
                    >
                      清除选择
                    </button>
                  )}
                </div>
                {isManualIssueOpen && (
                  <>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  {MANUAL_ISSUE_OPTIONS.map((option) => {
                    const active = selectedManualIssues.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        onClick={() => toggleManualIssue(option.id)}
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          active
                            ? theme === "dark"
                              ? "border-emerald-500 bg-emerald-950/60 text-emerald-50"
                              : "border-emerald-600 bg-emerald-50"
                            : "border-zinc-200 bg-white hover:border-zinc-400"
                        }`}
                      >
                        <span className="block text-xs font-semibold text-zinc-500">{option.code}</span>
                        <span className="mt-1 block text-sm font-semibold">{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                  </>
                )}
              </section>}

              {isLocalRepairPanel && (
                <section className="additional-requirement-card rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">附加要求</h2>
                        <p className="mt-1 text-sm text-zinc-500">确认后会与红框识别结果一起发送给修复引擎。</p>
                      </div>
                      {confirmedAdditionalRequirement && (
                        <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                          已确认
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start">
                      <textarea
                        value={additionalRequirementInput}
                        onChange={(event) => setAdditionalRequirementInput(event.target.value)}
                        className="min-h-20 flex-1 resize-y rounded-md border border-zinc-200 p-3 text-sm leading-6 outline-none focus:border-emerald-500"
                        placeholder="例如：顺便修正红框外左侧文字，让画面整体更干净。"
                      />
                      {additionalRequirementInput.trim() && (
                        <div className="flex gap-2 md:flex-col">
                          <button
                            onClick={clearAdditionalRequirement}
                            className="inline-flex items-center justify-center rounded-md border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
                          >
                            清除
                          </button>
                          <button
                            onClick={confirmAdditionalRequirement}
                            className="inline-flex items-center justify-center rounded-md bg-zinc-950 px-3 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
                          >
                            确定
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}

              <section className="preview-card rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">图片预览</h2>
                    {isLocalRepairPanel && (
                      <>
                        <p className="mt-1 text-sm text-zinc-500">{repairStatus}</p>
                        {(isRepairing || repairProgress > 0) && (
                          <div className="mt-3 max-w-md">
                            <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                              <div
                                className="h-full rounded-full bg-zinc-950 transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, repairProgress))}%` }}
                              />
                            </div>
                            <div className="mt-1 flex justify-between text-xs text-zinc-500">
                              <span>{Math.round(repairProgress)}%</span>
                              <span>{repairElapsedSeconds > 0 ? `已用时 ${formatRepairDuration(repairElapsedSeconds)}` : "准备中"}</span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {isLocalRepairPanel && uploadedImageSrc && (
                      <div className="flex rounded-md border border-zinc-200 bg-white p-1">
                        <button
                          onClick={handleBoxSelectToggle}
                          className={`inline-flex h-9 w-9 items-center justify-center rounded transition ${
                            isBoxSelectMode ? "bg-red-600 text-white" : "text-zinc-700 hover:bg-zinc-100"
                          }`}
                          title="框选修复区域"
                          aria-label="框选修复区域"
                        >
                          <BoxSelectIcon className="h-5 w-5" />
                        </button>
                        {(isBoxSelectMode || selectionRects.length > 0) && (
                          <button
                            onClick={undoSelection}
                            disabled={!selectionRects.length && !isBoxSelectMode}
                            className="inline-flex h-9 w-9 items-center justify-center rounded text-zinc-700 transition hover:bg-zinc-100"
                            title="撤回框选"
                            aria-label="撤回框选"
                          >
                            <Undo2 className="h-5 w-5" />
                          </button>
                        )}
                      </div>
                    )}
                    {isLocalRepairPanel && uploadedImageSrc && selectionRects.length > 0 && (
                      <button
                        onClick={confirmSelectionRepair}
                        disabled={isRepairing || isDetecting}
                        className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 disabled:opacity-60"
                      >
                        {isRepairing || isDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                        确认识别并修复
                      </button>
                    )}
                    {uploadedImageSrc && repairedImageSrc && (
                      <div className="flex rounded-md border border-zinc-200 bg-white p-1">
                        <button
                          onClick={() => setPreviewMode("before")}
                          className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "before" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
                        >
                          {beforePreviewLabel}
                        </button>
                        <button
                          onClick={() => setPreviewMode("after")}
                          className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "after" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
                        >
                          {afterPreviewLabel}
                        </button>
                      </div>
                    )}
                    </div>
                </div>
                {!uploadedImageSrc ? (
                  <div className="mt-3 flex aspect-video items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500">
                    请先导入图片
                  </div>
                ) : (
                  <div className="preview-image-stage relative mt-3 flex items-center justify-center rounded-lg bg-zinc-950 p-3">
                    <div
                      ref={selectionStageRef}
                      className={`selection-image-wrap relative ${isBoxSelectMode ? "is-selecting" : ""}`}
                      onPointerDown={handleSelectionStart}
                      onPointerMove={handleSelectionMove}
                      onPointerUp={handleSelectionEnd}
                      onPointerCancel={handleSelectionEnd}
                    >
                      <img
                        src={currentPreviewImage}
                        alt={currentPreviewAlt}
                        className="preview-image-full rounded-lg object-contain"
                        draggable={false}
                      />
                      {shouldShowSelectionOverlay && selectionRects.map((rect, index) => (
                        <div key={`${rect.x}-${rect.y}-${rect.width}-${rect.height}-${index}`} className="selection-box" style={selectionRectStyle(rect)}>
                          <span className="selection-box-index">{index + 1}</span>
                        </div>
                      ))}
                      {shouldShowSelectionOverlay && draftSelectionRect && <div className="selection-box selection-box-draft" style={selectionRectStyle(draftSelectionRect)} />}
                    </div>
                    <button
                      onClick={() => setIsPreviewZoomOpen(true)}
                      className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-zinc-950/45 text-white shadow-lg backdrop-blur transition hover:bg-zinc-950/70"
                      aria-label="放大预览图片"
                    >
                      <Maximize2 className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </section>

              {!isLocalRepairPanel && repairedImageSrc && (
                <section className="result-actions-card rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-end">
                    <label className="flex-1">
                      <span className="text-sm font-medium">记录备注</span>
                      <input
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        className="mt-1 w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-emerald-500"
                        placeholder="例如：头像修复第一版"
                      />
                    </label>
                    <button
                      onClick={() => copyImageToClipboard(repairedImageSrc)}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
                    >
                      {imageCopied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                      {imageCopied ? "已复制" : "复制图片"}
                    </button>
                    <button
                      onClick={() => downloadImage(repairedImageSrc, "fixi_result")}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
                    >
                      <Download className="h-4 w-4" />
                      下载
                    </button>
                    <button
                      onClick={saveHistory}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2 text-sm font-medium text-white"
                    >
                      <Save className="h-4 w-4" />
                      保存
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}

        {activeTab === "upscale" && (
          <>
            <aside className="space-y-5">
              <section
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDraggingUpload(true);
                }}
                onDragLeave={() => setIsDraggingUpload(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setIsDraggingUpload(false);
                  const file = event.dataTransfer.files?.[0];
                  if (file) handleNormalizedFileImport(file);
                }}
                className={`rounded-lg border bg-white p-4 shadow-sm ${isDraggingUpload ? "border-emerald-500 ring-2 ring-emerald-100" : "border-zinc-200"}`}
              >
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUploaded} />
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">导入图片</h2>
                    <p className="mt-1 text-sm text-zinc-500">拖入、粘贴或选择低清图片。</p>
                  </div>
                  <ImageIcon className="h-5 w-5 text-zinc-400" />
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Upload className="h-4 w-4" />
                  选择图片
                </button>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">放大设置</h2>
                    <p className="mt-1 text-sm leading-6 text-zinc-500">使用本地 Upscayl / Real-ESRGAN 后端，倍率由模型自动决定。</p>
                  </div>
                  <Maximize2 className="h-5 w-5 text-zinc-400" />
                </div>
                <div className="mt-4">
                  <p className="text-sm font-medium">模型</p>
                  <button
                    onClick={() => setIsUpscaleModelOpen((open) => !open)}
                    className={`upscale-model-option upscale-model-option-${selectedUpscaleModel.tone} mt-1 flex w-full items-start justify-between gap-3 rounded-md border border-zinc-200 px-3 py-2.5 text-left`}
                    aria-expanded={isUpscaleModelOpen}
                  >
                    <span>
                      <span className="block text-sm font-semibold">{selectedUpscaleModel.label}</span>
                      <span className="mt-1 block text-xs leading-5 text-zinc-500">{selectedUpscaleModel.note}</span>
                      <span className="mt-2 inline-flex rounded-full border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-500">
                        当前倍率：{selectedUpscaleScale}x
                      </span>
                    </span>
                    <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-zinc-400 transition ${isUpscaleModelOpen ? "rotate-180" : ""}`} />
                  </button>
                  {isUpscaleModelOpen && (
                    <div className="upscale-model-menu mt-2 space-y-3 rounded-md border border-zinc-200 bg-white p-3">
                      {UPSCALE_MODEL_OPTIONS.map((model) => {
                        const active = model.id === upscaleModel;
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              setUpscaleModel(model.id);
                              setIsUpscaleModelOpen(false);
                            }}
                            className={`upscale-model-option upscale-model-option-${model.tone} w-full rounded-md border px-3 py-2.5 text-left transition ${
                              active
                                ? "border-emerald-500 bg-emerald-50"
                                : "border-zinc-200 bg-white hover:border-zinc-400"
                            }`}
                          >
                            <span className="block text-sm font-semibold">{model.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-zinc-500">{model.note}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <button
                  onClick={runImageUpscale}
                  disabled={isUpscaling}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isUpscaling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
                  开始无损放大
                </button>
                <p className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">{upscaleStatus}</p>
              </section>

              <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">简单建议</h2>
                    <p className="mt-1 text-sm text-zinc-500">根据图片类型快速选择模型。</p>
                  </div>
                  <Sparkles className="h-5 w-5 text-zinc-400" />
                </div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-600">
                  {UPSCALE_QUICK_TIPS.map((tip) => (
                    <li key={tip} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
                      {tip}
                    </li>
                  ))}
                </ul>
              </section>
            </aside>

            <section className="right-workspace space-y-6">
              <section className="preview-card rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-base font-semibold">无损放大预览</h2>
                    <p className="mt-1 text-sm text-zinc-500">{upscaleStatus}</p>
                  </div>
                  {uploadedImageSrc && repairedImageSrc && (
                    <div className="flex rounded-md border border-zinc-200 bg-white p-1">
                      <button
                        onClick={() => setPreviewMode("before")}
                        className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "before" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
                      >
                        {beforePreviewLabel}
                      </button>
                      <button
                        onClick={() => setPreviewMode("after")}
                        className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "after" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
                      >
                        {afterPreviewLabel}
                      </button>
                    </div>
                  )}
                </div>
                {!uploadedImageSrc ? (
                  <div className="mt-3 flex aspect-video items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 text-sm text-zinc-500">
                    请先导入图片
                  </div>
                ) : (
                  <div className="preview-image-stage relative mt-3 flex items-center justify-center rounded-lg bg-zinc-950 p-3">
                    <img src={currentPreviewImage} alt={currentPreviewAlt} className="preview-image-full rounded-lg object-contain" draggable={false} />
                    <button
                      onClick={() => setIsPreviewZoomOpen(true)}
                      className="absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/40 bg-zinc-950/45 text-white shadow-lg backdrop-blur transition hover:bg-zinc-950/70"
                      aria-label="放大预览图片"
                    >
                      <Maximize2 className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </section>

              {repairedImageSrc && (
                <section className="result-actions-card rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:justify-end">
                    <button
                      onClick={() => copyImageToClipboard(repairedImageSrc)}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
                    >
                      {imageCopied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                      {imageCopied ? "已复制" : "复制图片"}
                    </button>
                    <button
                      onClick={() => downloadImage(repairedImageSrc, "fixi_upscale")}
                      className="inline-flex items-center justify-center gap-2 rounded-md border border-zinc-200 px-4 py-2 text-sm hover:bg-zinc-50"
                    >
                      <Download className="h-4 w-4" />
                      下载
                    </button>
                  </div>
                </section>
              )}
            </section>
          </>
        )}

        {activeTab === "prompt" && (
          <>
            <aside className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
              <h2 className="text-base font-semibold">提示词优化</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRESET_PROMPTS.map((preset) => (
                  <button
                    key={preset.title}
                    onClick={() => setTargetPrompt(preset.prompt)}
                    className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-700 hover:border-emerald-500"
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
              <textarea
                value={targetPrompt}
                onChange={(event) => setTargetPrompt(event.target.value)}
                className="mt-4 min-h-44 w-full resize-y rounded-md border border-zinc-200 p-3 text-sm outline-none focus:border-emerald-500"
              />
              <button
                onClick={runPromptOptimizer}
                disabled={promptLoading}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-zinc-950 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {promptLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                生成优化方案
              </button>
            </aside>
            <PromptResultPanel result={optimizedResult} copied={copied} onCopy={copyToClipboard} />
          </>
        )}

        {activeTab === "history" && (
          <section className="lg:col-span-2">
            <HistoryPanel
              historyList={historyList}
              onDelete={(id) => setHistoryList((list) => list.filter((item) => item.id !== id))}
              onDownload={downloadImage}
            />
          </section>
        )}
      </main>
      {isPreviewZoomOpen && currentPreviewImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          {uploadedImageSrc && repairedImageSrc && (
            <div className="absolute left-5 top-5 flex rounded-md border border-white/20 bg-white/10 p-1 text-white backdrop-blur">
              <button
                onClick={() => setPreviewMode("before")}
                className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "before" ? "bg-white text-zinc-950" : "text-white/80"}`}
              >
                修复前
              </button>
              <button
                onClick={() => setPreviewMode("after")}
                className={`rounded px-3 py-1.5 text-sm font-medium ${previewMode === "after" ? "bg-white text-zinc-950" : "text-white/80"}`}
              >
                修复后
              </button>
            </div>
          )}
          <button
            onClick={() => setIsPreviewZoomOpen(false)}
            className="absolute right-5 top-5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/30 bg-white/10 text-white hover:bg-white/20"
            aria-label="关闭放大预览"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={currentPreviewImage}
            alt={currentPreviewAlt}
            className="max-h-[92vh] max-w-[96vw] rounded-lg object-contain shadow-2xl"
          />
        </div>
      )}
      {isGuideOpen && <GuideModal onClose={() => setIsGuideOpen(false)} />}
      {isSettingsOpen && (
        <CommunitySettingsModal
          settings={communitySettings}
          status={settingsStatus}
          isSaving={isSavingSettings}
          testingProvider={testingProvider}
          onClose={() => setIsSettingsOpen(false)}
          onChange={updateCommunityGateway}
          onSave={saveCommunitySettings}
          onTest={testCommunityGateway}
        />
      )}
      {isGameMode && <SnakeMiniGame onExit={() => setIsGameMode(false)} />}
    </div>
  );
}

function CommunitySettingsModal({
  settings,
  status,
  isSaving,
  testingProvider,
  onClose,
  onChange,
  onSave,
  onTest
}: {
  settings: CommunitySettingsDraft;
  status: string;
  isSaving: boolean;
  testingProvider: "nanoBanana" | "chatgptImage2" | null;
  onClose: () => void;
  onChange: (provider: "nanoBanana" | "chatgptImage2", field: keyof CommunityGatewayDraft, value: string) => void;
  onSave: () => void;
  onTest: (provider: "nanoBanana" | "chatgptImage2") => void;
}) {
  const sections: Array<{ id: "nanoBanana" | "chatgptImage2"; title: string; hint: string }> = [
    { id: "nanoBanana", title: "NanoBanana", hint: "用于 NanoBanana 图生图修复。" },
    { id: "chatgptImage2", title: "ChatGPT Image 2", hint: "用于 ChatGPT Image 2 图生图修复。" }
  ];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="community-settings-title">
      <section className="w-full max-w-2xl rounded-2xl border border-white/20 bg-white p-5 shadow-2xl dark:bg-zinc-900">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="community-settings-title" className="text-xl font-semibold">网关设置</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">配置仅保存在当前设备，不会写入开源代码或上传到 FIXI。</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/10" aria-label="关闭设置">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {sections.map(({ id, title, hint }) => {
            const setting = settings[id];
            const testing = testingProvider === id;
            return (
              <div key={id} className="rounded-xl border border-zinc-200 p-4 dark:border-white/10">
                <div className="mb-3 flex items-baseline justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{title}</h3>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
                  </div>
                  {setting.hasApiKey && !setting.apiKey && <span className="text-xs text-emerald-600 dark:text-emerald-400">已保存 Key</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium sm:col-span-2">
                    网关地址
                    <input value={setting.endpoint} onChange={(event) => onChange(id, "endpoint", event.target.value)} placeholder="https://example.com/v1" className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/15" />
                  </label>
                  <label className="text-sm font-medium">
                    模型 ID
                    <input value={setting.model} onChange={(event) => onChange(id, "model", event.target.value)} placeholder={id === "nanoBanana" ? "nano-banana-2" : "gpt-image-2"} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/15" />
                  </label>
                  <label className="text-sm font-medium">
                    API Key
                    <input type="password" value={setting.apiKey} onChange={(event) => onChange(id, "apiKey", event.target.value)} placeholder={setting.hasApiKey ? "留空则保留已保存 Key" : "输入 API Key"} className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-white/15" />
                  </label>
                </div>
                <div className="mt-3 flex justify-end">
                  <button type="button" onClick={() => onTest(id)} disabled={testing} className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium transition hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-white/15 dark:hover:bg-white/10">
                    {testing && <Loader2 className="h-4 w-4 animate-spin" />}
                    测试连接
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {status && <p className="mt-4 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/10 dark:text-zinc-200">{status}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/10">取消</button>
          <button type="button" onClick={onSave} disabled={isSaving} className="inline-flex items-center gap-2 rounded-lg bg-zinc-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200">
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            保存配置
          </button>
        </div>
      </section>
    </div>
  );
}

function GuideModal({ onClose }: { onClose: () => void }) {
  const quickIssues = ["文字或图案扭曲", "细节崩坏", "元素错位", "主体比例异常", "模糊噪点", "局部撕裂", "边缘破碎", "材质断层"];
  const troubleshooting = [
    "局域网用户打不开时，先确认双方在同一网络，并检查主机 Windows 防火墙端口入站权限。",
    "视觉检测失败通常与额度或上游队列有关，可稍后重试或切换视觉识别模型。",
    "修复失败但检测成功时，多半是修复模型排队、额度或网关异常，可切换另一个修复模型再试。",
    "局部修复板块仍在优化中，复杂区域建议多次小范围尝试。"
  ];
  const priorityTips = [
    "修复效果不明显时，可复制修复后的图片重新粘贴进行二次修复，或换用另一个模型。",
    "特殊比例或只有局部问题时，不建议整张图修复；可截取局部或使用局部修复，效果更稳。"
  ];

  return (
    <div className="guide-modal-layer" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title">
      <div className="guide-modal-panel">
        <div className="guide-modal-header">
          <div>
            <p className="guide-kicker">FIXI 快速上手</p>
            <h2 id="guide-modal-title">使用教程</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭使用教程" className="guide-close-button">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="guide-modal-body">
          <section className="guide-section guide-hero-section">
            <div>
              <h3>适用对象</h3>
              <p>适合同一办公室、工作室或局域网内多人协作。只要主机电脑运行 FIXI 服务，其他电脑无需安装完整开发环境，通过浏览器即可使用。</p>
            </div>
            <div className="guide-chip-cloud">
              {quickIssues.map((issue) => (
                <span key={issue}>{issue}</span>
              ))}
            </div>
          </section>

          <section className="guide-section">
            <div className="guide-section-title">
              <span>01</span>
              <h3>基础用法</h3>
              <p>最简单仅三步：导入图片，检测问题，确认并开始修复。</p>
            </div>
            <img src="/guide/guide-basic-usage.png" alt="基础用法示例" className="guide-example-image" />
          </section>

          <section className="guide-section">
            <div className="guide-section-title">
              <span>02</span>
              <h3>进阶用法</h3>
              <p>有 AI 生图经验时，可根据图片来源、识别模型、修复模型和提示词内容进行细调。</p>
            </div>
            <img src="/guide/guide-advanced-usage.png" alt="进阶用法示例" className="guide-example-image" />
            <div className="guide-note-grid">
              <div>
                <strong>来源选择</strong>
                <p>如果图片来自 GPT Image 2，可选择对应来源，让系统加入更贴近该模型常见问题的提示词。</p>
              </div>
              <div>
                <strong>模型切换</strong>
                <p>Nano 与 GPT 擅长修复的问题不同，效果不理想时可切换模型再次尝试。</p>
              </div>
              <div>
                <strong>提示词编辑</strong>
                <p>检测后仍可手动补充要求，再把最终提示词送入修复引擎。</p>
              </div>
            </div>
          </section>

          <section className="guide-section">
            <div className="guide-section-title">
              <span>03</span>
              <h3>报错快速排障</h3>
              <p>遇到不可用时，优先判断是网络、额度、上游排队还是修复范围选择问题。</p>
            </div>
            <div className="guide-priority-tips">
              {priorityTips.map((item) => (
                <div key={item}>
                  <Check className="h-4 w-4" />
                  <p>{item}</p>
                </div>
              ))}
            </div>
            <ul className="guide-trouble-list">
              {troubleshooting.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="guide-section guide-address-section">
            <div>
              <h3>局域网访问</h3>
              <p>目前仅面向同局域网用户。主机服务运行后，其他设备使用主机提供的局域网地址访问。</p>
            </div>
            <div className="guide-address-card">http://10.0.0.124:3006/</div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SnakeMiniGame({ onExit }: { onExit: () => void }) {
  const baseBoardWidth = 36;
  const baseBoardHeight = 24;
  const maxBoardWidth = 40;
  const maxBoardHeight = 26;
  const initialSnake = useMemo(() => [{ x: 9, y: 12 }, { x: 8, y: 12 }, { x: 7, y: 12 }], []);
  const [snake, setSnake] = useState(initialSnake);
  const [food, setFood] = useState({ x: 16, y: 12 });
  const [elapsed, setElapsed] = useState(0);
  const [gameOverScore, setGameOverScore] = useState<number | null>(null);
  const directionRef = useRef({ x: 1, y: 0 });
  const nextDirectionRef = useRef({ x: 1, y: 0 });
  const startedAtRef = useRef(Date.now());

  const getPlayArea = (scoreValue: number) => ({
    width: baseBoardWidth + Math.min(maxBoardWidth - baseBoardWidth, Math.floor(scoreValue / 10)),
    height: baseBoardHeight + Math.min(maxBoardHeight - baseBoardHeight, Math.floor(scoreValue / 15))
  });

  const placeFood = (body: Array<{ x: number; y: number }>) => {
    const occupied = new Set(body.map((cell) => `${cell.x},${cell.y}`));
    const freeCells: Array<{ x: number; y: number }> = [];
    const head = body[0] || { x: 9, y: 12 };
    const playArea = getPlayArea(Math.max(0, body.length - 3));
    const edgePadding = 2;

    for (let y = edgePadding; y < playArea.height - edgePadding; y += 1) {
      for (let x = edgePadding; x < playArea.width - edgePadding; x += 1) {
        if (!occupied.has(`${x},${y}`)) freeCells.push({ x, y });
      }
    }

    const nearbyCells = freeCells.filter((cell) => {
      const distance = Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y);
      return distance >= 4 && distance <= 10;
    });
    const pool = nearbyCells.length > 0 ? nearbyCells : freeCells;
    return pool[Math.floor(Math.random() * pool.length)] || { x: 16, y: 12 };
  };

  const resetGame = () => {
    directionRef.current = { x: 1, y: 0 };
    nextDirectionRef.current = { x: 1, y: 0 };
    setSnake(initialSnake);
    setFood({ x: 16, y: 12 });
    startedAtRef.current = Date.now();
    setElapsed(0);
    setGameOverScore(null);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if (key === "escape") {
        event.preventDefault();
        onExit();
        return;
      }

      const current = directionRef.current;
      const next =
        key === "w" || key === "arrowup" ? { x: 0, y: -1 } :
        key === "s" || key === "arrowdown" ? { x: 0, y: 1 } :
        key === "a" || key === "arrowleft" ? { x: -1, y: 0 } :
        key === "d" || key === "arrowright" ? { x: 1, y: 0 } :
        null;

      if (!next) return;
      event.preventDefault();
      if (current.x + next.x !== 0 || current.y + next.y !== 0) {
        nextDirectionRef.current = next;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onExit]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (gameOverScore !== null) return;
    const speed = Math.max(112, 208 - Math.floor(elapsed / 24) * 3 - Math.max(0, snake.length - 3) * 0.9);
    const timer = window.setInterval(() => {
      setSnake((currentSnake) => {
        const nextDirection = nextDirectionRef.current;
        directionRef.current = nextDirection;
        const head = currentSnake[0];
        const nextHead = { x: head.x + nextDirection.x, y: head.y + nextDirection.y };
        const playArea = getPlayArea(Math.max(0, currentSnake.length - 3));
        const hitWall = nextHead.x < 0 || nextHead.x >= playArea.width || nextHead.y < 0 || nextHead.y >= playArea.height;
        const hitSelf = currentSnake.some((cell) => cell.x === nextHead.x && cell.y === nextHead.y);

        if (hitWall || hitSelf) {
          setGameOverScore(Math.max(0, currentSnake.length - 3));
          return currentSnake;
        }

        const ateFood = nextHead.x === food.x && nextHead.y === food.y;
        const nextSnake = ateFood ? [nextHead, ...currentSnake] : [nextHead, ...currentSnake.slice(0, -1)];
        if (ateFood) setFood(placeFood(nextSnake));
        return nextSnake;
      });
    }, speed);

    return () => window.clearInterval(timer);
  }, [elapsed, food.x, food.y, gameOverScore, snake.length]);

  const unit = 8;
  const score = Math.max(0, snake.length - 3);
  const playArea = getPlayArea(score);
  const centerPoint = (cell: { x: number; y: number }) => `${cell.x * unit + unit / 2},${cell.y * unit + unit / 2}`;
  const snakePoints = snake.map(centerPoint).join(" ");
  const head = snake[0] || { x: 0, y: 0 };
  const headCx = head.x * unit + unit / 2;
  const headCy = head.y * unit + unit / 2;
  const headDirection = directionRef.current;
  const normal = { x: -headDirection.y, y: headDirection.x };
  const eyeForward = 2.1;
  const eyeSide = 1.6;
  const eyeOne = {
    x: headCx + headDirection.x * eyeForward + normal.x * eyeSide,
    y: headCy + headDirection.y * eyeForward + normal.y * eyeSide
  };
  const eyeTwo = {
    x: headCx + headDirection.x * eyeForward - normal.x * eyeSide,
    y: headCy + headDirection.y * eyeForward - normal.y * eyeSide
  };
  const tongueStart = {
    x: headCx + headDirection.x * 4.2,
    y: headCy + headDirection.y * 4.2
  };
  const tongueEnd = {
    x: headCx + headDirection.x * 7.2,
    y: headCy + headDirection.y * 7.2
  };
  const tongueForkOne = {
    x: tongueEnd.x + headDirection.x * 1.8 + normal.x * 1.3,
    y: tongueEnd.y + headDirection.y * 1.8 + normal.y * 1.3
  };
  const tongueForkTwo = {
    x: tongueEnd.x + headDirection.x * 1.8 - normal.x * 1.3,
    y: tongueEnd.y + headDirection.y * 1.8 - normal.y * 1.3
  };
  const tonguePath = `M ${tongueStart.x} ${tongueStart.y} L ${tongueEnd.x} ${tongueEnd.y} M ${tongueEnd.x} ${tongueEnd.y} L ${tongueForkOne.x} ${tongueForkOne.y} M ${tongueEnd.x} ${tongueEnd.y} L ${tongueForkTwo.x} ${tongueForkTwo.y}`;
  const mood = gameOverScore === null
    ? ""
    : gameOverScore >= 50
      ? "👍"
      : gameOverScore >= 30
        ? "😆"
        : gameOverScore >= 20
          ? "🙂"
          : gameOverScore >= 15
            ? "😔"
            : "😭";

  return (
    <div className="snake-game" aria-label="贪吃蛇游戏区域">
      <div className="snake-score">{score}</div>
      <svg className="snake-stage" viewBox={`0 0 ${maxBoardWidth * unit} ${maxBoardHeight * unit}`} aria-hidden="true">
        <rect className="snake-boundary" x="1.5" y="1.5" width={playArea.width * unit - 3} height={playArea.height * unit - 3} rx="12" />
        <polyline className="snake-line-shadow" points={snakePoints} />
        <polyline className="snake-line" points={snakePoints} />
        <circle className="snake-head-dot" cx={headCx} cy={headCy} r="4.2" />
        <circle className="snake-eye" cx={eyeOne.x} cy={eyeOne.y} r="0.9" />
        <circle className="snake-eye" cx={eyeTwo.x} cy={eyeTwo.y} r="0.9" />
        <path className="snake-tongue" d={tonguePath} />
        <circle className="snake-food-dot" cx={food.x * unit + unit / 2} cy={food.y * unit + unit / 2} r="3.8" />
      </svg>
      {gameOverScore !== null && (
        <div className="snake-game-over">
          <div className="snake-game-over-mood">{mood}</div>
          <div className="snake-game-over-score">积分 {gameOverScore}</div>
          <button type="button" onClick={resetGame}>继续</button>
        </div>
      )}
    </div>
  );
}

function BoxSelectIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2" />
      <path d="M3.5 8.5V4.8c0-.7.6-1.3 1.3-1.3h3.7M15.5 3.5h3.7c.7 0 1.3.6 1.3 1.3v3.7M20.5 15.5v3.7c0 .7-.6 1.3-1.3 1.3h-3.7M8.5 20.5H4.8c-.7 0-1.3-.6-1.3-1.3v-3.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function VisionProblemPanel({ problems, repairPrompt }: { problems: VisionProblem[]; repairPrompt: string }) {
  const uniqueProblems = PROBLEM_ORDER
    .map((category) => problems.find((problem) => problem.category === category))
    .filter(Boolean) as VisionProblem[];
  const compactPrompt = compactRepairPrompt(repairPrompt);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {uniqueProblems.map((problem) => {
          const label = PROBLEM_LABELS[problem.category];
          return (
            <span key={problem.category} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${label.className}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${label.dotClassName}`} />
              {label.title}
              {problem.severity === "high" ? " · 严重" : problem.severity === "medium" ? " · 中等" : " · 轻微"}
            </span>
          );
        })}
      </div>
      {compactPrompt && (
        <article className="rounded-md border border-emerald-200 bg-emerald-50 p-3">
          <h3 className="text-sm font-semibold text-emerald-900">Gemini 建议修复提示词</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-emerald-800">{compactPrompt}</p>
        </article>
      )}
    </div>
  );
}

function PromptResultPanel({
  result,
  copied,
  onCopy
}: {
  result: PromptResult | null;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  if (!result) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <Clipboard className="mx-auto h-8 w-8 text-zinc-400" />
        <p className="mt-3 text-sm text-zinc-500">输入提示词后生成优化方案。</p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold">问题诊断</h2>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{result.issue}</p>
      </section>
      <TextCard title="优化后正向词" text={result.optimized} id="optimized" copied={copied} onCopy={onCopy} />
      <TextCard title="负向词" text={result.negative} id="negative" copied={copied} onCopy={onCopy} />
    </div>
  );
}

function TextCard({
  title,
  text,
  id,
  copied,
  onCopy
}: {
  title: string;
  text: string;
  id: string;
  copied: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const isCopied = copied === id;
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <button onClick={() => onCopy(text, id)} className="inline-flex items-center gap-2 rounded-md border border-zinc-200 px-3 py-1.5 text-sm">
          {isCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {isCopied ? "已复制" : "复制"}
        </button>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-zinc-700">{text}</p>
    </section>
  );
}

function HistoryPreview({ original, repaired }: { original: string; repaired: string }) {
  const [mode, setMode] = useState<"before" | "after">("after");
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <div className="flex rounded-md border border-zinc-200 bg-white p-1">
          <button
            onClick={() => setMode("before")}
            className={`rounded px-2.5 py-1 text-xs font-medium ${mode === "before" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
          >
            修复前
          </button>
          <button
            onClick={() => setMode("after")}
            className={`rounded px-2.5 py-1 text-xs font-medium ${mode === "after" ? "bg-zinc-950 text-white" : "text-zinc-600"}`}
          >
            修复后
          </button>
        </div>
      </div>
      <div className="history-preview-stage flex items-center justify-center rounded-lg bg-zinc-950 p-2">
        <img src={mode === "after" ? repaired : original} alt={mode === "after" ? "修复后" : "修复前"} className="history-preview-image rounded-lg object-contain" />
      </div>
    </div>
  );
}

function HistoryPanel({
  historyList,
  onDelete,
  onDownload
}: {
  historyList: HistoryItem[];
  onDelete: (id: string) => void;
  onDownload: (src: string, prefix: string) => void;
}) {
  if (historyList.length === 0) {
    return (
      <section className="rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <History className="mx-auto h-8 w-8 text-zinc-400" />
        <h2 className="mt-3 text-base font-semibold">暂无历史</h2>
        <p className="mt-1 text-sm text-zinc-500">修复或重绘完成后会自动生成记录。</p>
      </section>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {historyList.map((item) => (
        <article key={item.id} className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
          <HistoryPreview original={item.originalImage} repaired={item.repairedImage} />
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{item.title}</h2>
              <p className="mt-1 text-xs text-zinc-500">
                {item.timestamp} · {item.engineName}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onDownload(item.repairedImage, "fixi_history")} className="rounded-md border border-zinc-200 p-2">
                <Download className="h-4 w-4" />
              </button>
              <button onClick={() => onDelete(item.id)} className="rounded-md border border-zinc-200 p-2">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <p className="mt-2 line-clamp-3 text-sm text-zinc-600">{item.prompt}</p>
        </article>
      ))}
    </div>
  );
}







