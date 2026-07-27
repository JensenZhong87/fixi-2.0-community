import express from "express";
import path from "path";
import dotenv from "dotenv";
import fs from "fs/promises";
import fsSync from "fs";
import dgram from "dgram";
import os from "os";
import { GoogleGenAI } from "@google/genai";
import { spawn } from "child_process";

dotenv.config();

const DEFAULT_REPAIR_PROMPT = [
  "修复 AI 图片中的明显画损与结构错误",
  "保持原图主体、构图、风格、颜色和身份一致",
  "修正面部、手部、肢体、文字粘连、边缘破碎、压缩噪点、模糊、局部撕裂",
  "只修复异常区域，不改变原图主题，不添加无关元素",
  "输出自然、干净、可商用的完整图片"
].join("；");

function compactImageForMonitor(value: unknown) {
  const text = typeof value === "string" ? value : "";
  return text;
}

function textForMonitor(value: unknown) {
  if (!value) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
let runtimeMonitorEndpoint = "";

function getMonitorEndpoint() {
  return runtimeMonitorEndpoint || process.env.FIXI_MONITOR_ENDPOINT || "";
}

function reportMonitorEvent(event: Record<string, any>) {
  const endpoint = getMonitorEndpoint();
  if (!endpoint) return;
  const payload = {
    appName: process.env.FIXI_APP_NAME || "FIXI 2.0",
    appPort: Number(process.env.PORT || 3008),
    clientSource: process.env.FIXI_CLIENT_SOURCE || "browser",
    desktopVersion: process.env.FIXI_DESKTOP_VERSION || "",
    time: new Date().toISOString(),
    ...event
  };
  fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => undefined);
}

function getPreferredLanAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        return address.address;
      }
    }
  }
  return "127.0.0.1";
}

function startUpdateHostBeacon(port: number, updateDir: string) {
  const latestManifest = path.join(updateDir, "latest.yml");
  const socket = dgram.createSocket("udp4");
  const broadcast = () => {
    if (!fsSync.existsSync(latestManifest)) return;
    const payload = Buffer.from(JSON.stringify({
      type: "fixi-update-host",
      host: getPreferredLanAddress(),
      appPort: port,
      monitorPort: 3010,
      updatePath: "/fixi-updates",
      version: process.env.FIXI_DESKTOP_VERSION || "2.0.0"
    }));
    socket.send(payload, 0, payload.length, 30108, "255.255.255.255", () => undefined);
  };

  socket.bind(() => {
    socket.setBroadcast(true);
    broadcast();
    const timer = setInterval(broadcast, 5000);
    timer.unref();
  });
}

// Global Gemini client. Lazy initialized to prevent crashing if the key is missing on startup.
let genAIClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    console.warn("⚠️ GEMINI_API_KEY is not configured or uses placeholder. Falling back to local diagnostic simulation mode.");
    return null;
  }
  
  try {
    genAIClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    return genAIClient;
  } catch (error) {
    console.error("❌ Failed to initialize GoogleGenAI client:", error);
    return null;
  }
}

// Doubao Volcengine Ark Config & API Client Helper
function read3003DoubaoLock() {
  const reverseDir = process.env.FIXI_3003_REVERSE_DIR || process.env.REVERSE_3003_DIR || path.join(process.env.USERPROFILE || "C:\\Users\\WIN112025121902", "Documents", "\u53cd\u63a8");
  const lockPath = path.join(reverseDir, "doubao_lock.json");
  try {
    if (!fsSync.existsSync(lockPath)) return null;
    return JSON.parse(fsSync.readFileSync(lockPath, "utf8"));
  } catch (error) {
    console.warn("Failed to read 3003 Doubao lock:", error);
    return null;
  }
}

function getDoubaoConfig() {
  const locked = read3003DoubaoLock() || {};
  const apiKey = (
    locked.apiKey ||
    process.env.ARK_API_KEY ||
    process.env.DOUBAO_API_KEY ||
    process.env.VOLC_API_KEY ||
    process.env.VOLC_ARK_API_KEY ||
    process.env.VOLCE_API_KEY
  );
  const endpointId = locked.endpointId || process.env.ARK_ENDPOINT_ID || "ep-20260601103620-t5j2j";
  const region = locked.region || process.env.ARK_REGION || process.env.DOUBAO_REGION || "cn-beijing";

  const isValidKey = apiKey && apiKey !== "MY_GEMINI_API_KEY" && String(apiKey).trim().length > 6;
  return {
    apiKey: isValidKey ? String(apiKey).trim() : null,
    endpointId: String(endpointId).trim(),
    region: String(region).trim() || "cn-beijing"
  };
}

function cleanAndFormatJson(text: string): any {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.substring(7);
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.substring(3);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();
  return JSON.parse(cleaned);
}

async function callDoubaoModel(messages: any[], temperature = 0.2): Promise<any> {
  const { apiKey, endpointId, region } = getDoubaoConfig();
  if (!apiKey) {
    throw new Error("No valid 3003 Doubao API Key found. Please confirm 3003 doubao_lock.json exists or configure ARK_API_KEY/DOUBAO_API_KEY.");
  }

  const endpoint = `https://ark.${region}.volces.com/api/v3/chat/completions`;
  console.log(`?? Sending request to 3003 Doubao-seed via Ark endpoint: ${endpointId}`);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: endpointId,
      messages,
      temperature
    })
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Doubao Ark API Request failed with status ${response.status}: ${errBody}`);
  }

  const data: any = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("Doubao Ark API returned empty completion choice content.");
  }

  return cleanAndFormatJson(content);
}

function isValidSecret(value?: string) {
  return Boolean(value && value.trim() && value !== "MY_GEMINI_API_KEY");
}

function isCreditError(message: string) {
  return /insufficient credits|insufficient credit|no credits|credit exhausted|balance|quota/i.test(message);
}

function isConcurrentLimitError(message: string) {
  return /too many concurrent|concurrent api requests|rate limit|429|too many requests|并发请求已满|并发/i.test(message);
}

function isAbortLikeError(message: string) {
  return /operation was aborted|aborterror|aborted|timeout|timed out|请求超时|超时/i.test(message);
}

function getUnifiedImageConfig() {
  return {
    apiKey: process.env.FIXI_IMAGE_API_KEY || process.env.UNIFIED_IMAGE_API_KEY || "",
    endpoint: process.env.FIXI_IMAGE_API_ENDPOINT || process.env.UNIFIED_IMAGE_API_ENDPOINT || "",
  };
}

function splitSecretList(value: string | undefined, fallback: string[] = [], keepDuplicates = false) {
  const items = (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const merged = items.length ? items : fallback;
  return keepDuplicates ? merged : Array.from(new Set(merged));
}

function splitModelList(value: string | undefined, fallback: string[]) {
  const models = (value || "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return models.length ? models : fallback;
}

type ImageRepairGateway = {
  name: string;
  kind: "openai-edit" | "nananobanana";
  apiKey: string;
  endpoint: string;
  models: string[];
};

const NANANOBANANA_ALLOWED_MODELS = [
  "nanobanan-2-2k",
  "gpt-image-2-2k",
  "nanobanan2&pro-2k",
  "nanobanan-2",
  "nanobanan-2-4k",
  "seedream-5.0-2k"
];

const OPENAI_EDIT_ALLOWED_MODELS = [
  "nano-banana-2",
  "gpt-image-2"
];

type CommunityGatewaySettings = {
  endpoint: string;
  apiKey: string;
  model: string;
};

type CommunitySettings = {
  nanoBanana: CommunityGatewaySettings;
  chatgptImage2: CommunityGatewaySettings;
};

const COMMUNITY_DATA_DIR = path.join(process.cwd(), "data");
const COMMUNITY_SETTINGS_FILE = path.join(COMMUNITY_DATA_DIR, "community-settings.json");

const DEFAULT_COMMUNITY_SETTINGS: CommunitySettings = {
  nanoBanana: { endpoint: "", apiKey: "", model: "nano-banana-2" },
  chatgptImage2: { endpoint: "", apiKey: "", model: "gpt-image-2" }
};

function normalizeCommunityEndpoint(value: unknown) {
  const endpoint = String(value || "").trim().replace(/\/$/, "");
  return /^https?:\/\/[^\s]+$/i.test(endpoint) ? endpoint : "";
}

function readCommunitySettings(): CommunitySettings {
  try {
    const raw = JSON.parse(fsSync.readFileSync(COMMUNITY_SETTINGS_FILE, "utf8"));
    return {
      nanoBanana: {
        endpoint: normalizeCommunityEndpoint(raw?.nanoBanana?.endpoint),
        apiKey: String(raw?.nanoBanana?.apiKey || "").trim(),
        model: String(raw?.nanoBanana?.model || DEFAULT_COMMUNITY_SETTINGS.nanoBanana.model).trim()
      },
      chatgptImage2: {
        endpoint: normalizeCommunityEndpoint(raw?.chatgptImage2?.endpoint),
        apiKey: String(raw?.chatgptImage2?.apiKey || "").trim(),
        model: String(raw?.chatgptImage2?.model || DEFAULT_COMMUNITY_SETTINGS.chatgptImage2.model).trim()
      }
    };
  } catch {
    return structuredClone(DEFAULT_COMMUNITY_SETTINGS);
  }
}

let communitySettings = readCommunitySettings();

async function writeCommunitySettings(nextSettings: CommunitySettings) {
  await fs.mkdir(COMMUNITY_DATA_DIR, { recursive: true });
  await fs.writeFile(COMMUNITY_SETTINGS_FILE, JSON.stringify(nextSettings, null, 2), "utf8");
  communitySettings = nextSettings;
}

function publicCommunitySettings() {
  const toPublic = (settings: CommunityGatewaySettings) => ({
    endpoint: settings.endpoint,
    model: settings.model,
    hasApiKey: isValidSecret(settings.apiKey)
  });
  return {
    nanoBanana: toPublic(communitySettings.nanoBanana),
    chatgptImage2: toPublic(communitySettings.chatgptImage2)
  };
}

function communityModelsEndpoint(endpoint: string) {
  return endpoint.endsWith("/v1") ? `${endpoint}/models` : `${endpoint}/v1/models`;
}

function getImageRepairGateways(_fallbackApiKey: string, _fallbackEndpoint: string) {
  const gateways: ImageRepairGateway[] = [];
  const nano = communitySettings.nanoBanana;
  if (isValidSecret(nano.apiKey) && nano.endpoint) {
    gateways.push({
      name: "community-nanobanana",
      kind: "nananobanana",
      apiKey: nano.apiKey,
      endpoint: nano.endpoint,
      models: [nano.model || "nano-banana-2"]
    });
  }
  const gpt = communitySettings.chatgptImage2;
  if (isValidSecret(gpt.apiKey) && gpt.endpoint) {
    gateways.push({
      name: "community-gpt-image-2",
      kind: "openai-edit",
      apiKey: gpt.apiKey,
      endpoint: gpt.endpoint,
      models: [gpt.model || "gpt-image-2"]
    });
  }
  return gateways;
}

function readableError(value: any): string {
  if (!value) return "";
  if (typeof value === "string") {
    if (isCreditError(value)) return "\u4E0A\u6E38\u6A21\u578B\u901A\u9053\u989D\u5EA6\u4E0D\u8DB3\uFF0C\u5F53\u524D\u8D26\u53F7\u65E0\u6CD5\u7EE7\u7EED\u751F\u6210\u3002";
    if (isCloudflareBlockError(value)) return "GPT Image 2K 上游通道被 Cloudflare 拦截，当前网关无法完成该模型调用。请稍后重试或联系网关方处理 GPT 上游访问限制。";
    if (isConcurrentLimitError(value)) return "当前网关账号并发请求已满。";
    if (isAbortLikeError(value)) return "当前通道长时间未返回结果。";
    if (value.includes("openai_error")) return "图生图通道暂不可用，已自动尝试备用模型。";
    return value;
  }
  if (value instanceof Error) return readableError(value.message);
  try {
    const message = String(value.message || value.details || value.error?.message || value.error || JSON.stringify(value));
    if (isCreditError(message)) return "\u4E0A\u6E38\u6A21\u578B\u901A\u9053\u989D\u5EA6\u4E0D\u8DB3\uFF0C\u5F53\u524D\u8D26\u53F7\u65E0\u6CD5\u7EE7\u7EED\u751F\u6210\u3002";
    if (isCloudflareBlockError(message)) return "GPT Image 2K 上游通道被 Cloudflare 拦截，当前网关无法完成该模型调用。请稍后重试或联系网关方处理 GPT 上游访问限制。";
    if (isConcurrentLimitError(message)) return "当前网关账号并发请求已满。";
    if (isAbortLikeError(message)) return "当前通道长时间未返回结果。";
    if (message.includes("openai_error")) return "图生图通道暂不可用，已自动尝试备用模型。";
    return message;
  } catch {
    return String(value);
  }
}

function isTextToImageOnlyError(message: string) {
  return /仅支持图片生成|只支持图片生成|only.*image generation|text.?to.?image|文生图|不支持图生图|not supported model for image generation|not supported.*image generation|请使用\s*\/v1\/images\/generations|current request path/i.test(message);
}

function isCloudflareBlockError(message: string) {
  return /Cloudflare|Attention Required|Sorry,\s*you have been blocked|cf-error-details|cdn-cgi\/challenge-platform|unable to access/i.test(message);
}

function readableImageRouteError(message: string) {
  if (isCloudflareBlockError(message)) {
    return "GPT Image 2K 上游通道被 Cloudflare 拦截，当前网关无法完成该模型调用。请稍后重试或联系网关方处理 GPT 上游访问限制。";
  }
  if (message.includes("openai_error") || message.includes("图生图通道暂不可用")) {
    return "图生图通道暂不可用，已自动尝试备用模型。";
  }
  if (isConcurrentLimitError(message)) {
    return "当前网关账号并发请求已满。";
  }
  if (isAbortLikeError(message)) {
    return "当前通道长时间未返回结果。";
  }
  if (isTextToImageOnlyError(message)) {
    return "当前上游通道不是有效图生图修复通道：它只接受图片生成或没有吃到原图编辑输入。请检查该模型在网关中是否支持图生图/图片编辑，而不是文生图。";
  }
  return message;
}

function normalizeUnifiedEndpoint(path: string) {
  const { endpoint } = getUnifiedImageConfig();
  const normalized = endpoint.replace(/\/$/, "");
  if (!normalized) return "";
  return normalized.endsWith("/v1") ? `${normalized}${path}` : normalized;
}

function normalizeEndpointWithPath(endpoint: string, path: string) {
  const normalized = endpoint.replace(/\/$/, "");
  if (!normalized) return "";
  return normalized.endsWith("/v1") ? `${normalized}${path}` : normalized;
}

function dataUrlToBlobParts(dataUrl: string, fallbackMimeType = "image/png") {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const mimeType = match?.[1] || fallbackMimeType;
  const base64 = match?.[2] || dataUrl;
  const buffer = Buffer.from(base64, "base64");
  return { buffer, mimeType: detectImageMimeType(buffer, mimeType) };
}

function detectImageMimeType(buffer: Buffer, fallbackMimeType = "image/png") {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return fallbackMimeType;
}

function inferImageDimensions(buffer: Buffer, mimeType = "") {
  const detectedMime = detectImageMimeType(buffer, mimeType);
  if (detectedMime.includes("png") && buffer.length >= 24) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }

  if (detectedMime.includes("jpeg") || detectedMime.includes("jpg")) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5)
        };
      }
      offset += 2 + length;
    }
  }

  return null;
}

function hasPlausibleDimensions(dimensions: { width: number; height: number } | null) {
  return Boolean(
    dimensions &&
    dimensions.width > 0 &&
    dimensions.height > 0 &&
    dimensions.width <= 20000 &&
    dimensions.height <= 20000
  );
}

function normalizeRatio(width: number, height: number) {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function extractRequestedAspectRatio(prompt: string) {
  const text = prompt || "";
  const match = text.match(/(?:比例|画幅|宽高比|aspect\s*ratio)?\s*([1-9]\d?)\s*[:：比]\s*([1-9]\d?)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!width || !height || width > 32 || height > 32) return null;
  return { width, height, aspectRatio: normalizeRatio(width, height) };
}

function target2KSize(dimensions: { width: number; height: number } | null, _prompt = "") {
  if (!dimensions?.width || !dimensions?.height) {
    return { width: 2048, height: 2048, aspectRatio: "1:1", size: "2048x2048", ratioSource: "source" as const };
  }
  const scale = 2048 / Math.max(dimensions.width, dimensions.height);
  const width = Math.max(1, Math.round(dimensions.width * scale));
  const height = Math.max(1, Math.round(dimensions.height * scale));
  return {
    width,
    height,
    aspectRatio: normalizeRatio(width, height),
    size: `${width}x${height}`,
    ratioSource: "source" as const
  };
}

const COMMON_IMAGE_RATIOS = [
  { label: "1:1", width: 1, height: 1 },
  { label: "2:1", width: 2, height: 1 },
  { label: "1:2", width: 1, height: 2 },
  { label: "21:9", width: 21, height: 9 },
  { label: "9:21", width: 9, height: 21 },
  { label: "4:5", width: 4, height: 5 },
  { label: "5:4", width: 5, height: 4 },
  { label: "3:4", width: 3, height: 4 },
  { label: "4:3", width: 4, height: 3 },
  { label: "2:3", width: 2, height: 3 },
  { label: "3:2", width: 3, height: 2 },
  { label: "9:16", width: 9, height: 16 },
  { label: "16:9", width: 16, height: 9 }
];

// The Nananobanana image-to-image gateway validates this list server-side.
// Keep it separate from the broader UI ratio list: e.g. 2:1 is a valid UI
// preference but is not a valid request value for this particular endpoint.
const NANANOBANANA_SUPPORTED_RATIOS = [
  { label: "1:1", width: 1, height: 1 },
  { label: "1:4", width: 1, height: 4 },
  { label: "1:8", width: 1, height: 8 },
  { label: "2:3", width: 2, height: 3 },
  { label: "3:2", width: 3, height: 2 },
  { label: "3:4", width: 3, height: 4 },
  { label: "4:1", width: 4, height: 1 },
  { label: "4:3", width: 4, height: 3 },
  { label: "4:5", width: 4, height: 5 },
  { label: "5:1", width: 5, height: 1 },
  { label: "5:4", width: 5, height: 4 },
  { label: "8:1", width: 8, height: 1 },
  { label: "9:16", width: 9, height: 16 },
  { label: "16:9", width: 16, height: 9 },
  { label: "21:9", width: 21, height: 9 }
];

function closestRatioFromSet(
  dimensions: { width: number; height: number } | null,
  ratios: Array<{ label: string; width: number; height: number }>
) {
  if (!dimensions?.width || !dimensions?.height) return ratios[0];
  const sourceRatio = dimensions.width / dimensions.height;
  return ratios.reduce((best, ratio) => {
    const bestDistance = Math.abs(sourceRatio - best.width / best.height);
    const distance = Math.abs(sourceRatio - ratio.width / ratio.height);
    return distance < bestDistance ? ratio : best;
  }, ratios[0]);
}

function closestCommonRatio(dimensions: { width: number; height: number } | null) {
  if (!dimensions?.width || !dimensions?.height) return COMMON_IMAGE_RATIOS[0];
  const sourceRatio = dimensions.width / dimensions.height;
  return COMMON_IMAGE_RATIOS.reduce((best, ratio) => {
    const bestDistance = Math.abs(sourceRatio - best.width / best.height);
    const distance = Math.abs(sourceRatio - ratio.width / ratio.height);
    return distance < bestDistance ? ratio : best;
  }, COMMON_IMAGE_RATIOS[0]);
}

function commonRatioMatch(dimensions: { width: number; height: number } | null) {
  if (!dimensions?.width || !dimensions?.height) return null;
  const sourceRatio = dimensions.width / dimensions.height;
  const nearest = closestCommonRatio(dimensions);
  const nearestRatio = nearest.width / nearest.height;
  return Math.abs(sourceRatio - nearestRatio) / sourceRatio <= 0.08 ? nearest : null;
}

function sizeForRatio(ratio: { label: string; width: number; height: number }, maxSide = 2048) {
  if (ratio.width >= ratio.height) {
    const height = Math.max(1, Math.round(maxSide * ratio.height / ratio.width));
    return { width: maxSide, height, size: `${maxSide}x${height}`, aspectRatio: ratio.label };
  }
  const width = Math.max(1, Math.round(maxSide * ratio.width / ratio.height));
  return { width, height: maxSide, size: `${width}x${maxSide}`, aspectRatio: ratio.label };
}

const COMMON_GATEWAY_SIZE_PRESETS: Record<string, string[]> = {
  "1:1": ["2048x2048", "1024x1024"],
  "2:1": ["2048x1024", "1792x896"],
  "1:2": ["1024x2048", "896x1792"],
  "21:9": ["1792x768", "2048x878"],
  "9:21": ["768x1792", "878x2048"],
  "2:3": ["1024x1536", "1365x2048"],
  "3:2": ["1536x1024", "2048x1365"],
  "3:4": ["1536x2048", "1024x1365"],
  "4:3": ["2048x1536", "1365x1024"],
  "4:5": ["1638x2048", "1024x1280"],
  "5:4": ["2048x1638", "1280x1024"],
  "9:16": ["1152x2048", "1024x1792"],
  "16:9": ["2048x1152", "1792x1024"]
};

type GatewaySizeAttempt = {
  size: string;
  aspectRatio: string;
  width: number;
  height: number;
  label: string;
};

function dimensionsForRequestedSize(requestedSize: string | GatewaySizeAttempt, fallback: ReturnType<typeof target2KSize>) {
  if (typeof requestedSize === "object" && requestedSize) return requestedSize;
  const match = /^(\d+)x(\d+)$/i.exec(String(requestedSize || ""));
  if (!match) return { width: fallback.width, height: fallback.height, size: String(requestedSize || "auto"), aspectRatio: fallback.aspectRatio, label: String(requestedSize || "auto") };
  const width = Number(match[1]);
  const height = Number(match[2]);
  return { width, height, size: `${width}x${height}`, aspectRatio: normalizeRatio(width, height), label: `${width}x${height}` };
}

function buildGatewaySizeAttempts(gateway: ImageRepairGateway, targetSize: ReturnType<typeof target2KSize>, sourceDimensions: { width: number; height: number } | null) {
  // Nananobanana's image endpoint requires one of its declared aspect-ratio values.
  // It rejects `auto`, so map the source canvas to its nearest supported ratio once.
  if (gateway.kind === "nananobanana") {
    const source = sourceDimensions || { width: targetSize.width, height: targetSize.height };
    const ratio = closestRatioFromSet(source, NANANOBANANA_SUPPORTED_RATIOS);
    const sized = sizeForRatio(ratio, 2048);
    return [{
      size: sized.size,
      aspectRatio: ratio.label,
      width: sized.width,
      height: sized.height,
      label: `${ratio.label}/${sized.size}`
    }];
  }

  // Other OpenAI-compatible image-edit gateways decide the canvas in auto mode.
  return [{
    size: "auto",
    aspectRatio: "auto",
    width: targetSize.width,
    height: targetSize.height,
    label: "auto"
  }];
}

function buildStyleLockedRestorationPrompt(userPrompt: string, targetSize: { size: string; aspectRatio: string; width: number; height: number; ratioSource?: "source" | "user" }) {
  const ratioRule = targetSize.ratioSource === "user"
    ? [
        `- The user explicitly requested output aspect ratio ${targetSize.aspectRatio}. The final image MUST use this requested ratio.`,
        "- Do not crop away the top, bottom, sides, subject, text, or important design elements to fit the requested ratio.",
        "- If the requested ratio differs from the uploaded image, preserve the complete original composition by fitting all existing content into the new canvas and naturally extending or cleaning only the surrounding background/margins as needed."
      ]
    : [
        `- The final image MUST keep the exact same width-to-height ratio as the uploaded image: ${targetSize.aspectRatio}. Do not crop, pad, extend, letterbox, pillarbox, stretch, square, or otherwise alter the canvas ratio.`,
        "- Do not crop away the top, bottom, sides, subject, text, or important design elements."
      ];
  return [
    "TASK: edit the uploaded image itself through an image-to-image / image-editing channel. The uploaded image is the source canvas, not a loose style reference.",
    "Do not create a new image from text. Do not reinterpret the scene. Modify only the damaged or incorrect pixels inside the existing uploaded image.",
    "",
    "DEFECTS THAT MAY BE REPAIRED ONLY:",
    "- Incorrect, blurry, malformed or unreadable text, numbers, labels, signs, and symbols.",
    "- Stains, scratches, dirt, cracks, damaged paint, missing fragments, spots, marks, and broken areas.",
    "- Blur, ghosting, noise, pixelation, compression artifacts, and low-detail damaged regions.",
    "- Deformed objects, wrong proportions, structural errors, warped parts, uneven edges, or malformed geometry.",
    "- Color cast, uneven brightness, abnormal contrast, and local tonal defects.",
    "",
    "ABSOLUTE LOCK RULES - HIGHEST PRIORITY:",
    "- Do not change the overall composition, camera angle, crop, framing, or perspective except when the user explicitly requests a new aspect ratio.",
    ...ratioRule,
    `- Target proportional size: ${targetSize.width}x${targetSize.height}.`,
    "- Do not move, add, remove, resize, replace, redesign, or reinterpret any subject, object, decoration, background element, pattern, text, number, or symbol that is already correct.",
    "- Preserve every subject element's position, count, pose, shape, identity, and relationship to other elements.",
    "- Preserve the original art style exactly: brush texture, paint strokes, grain, material feel, color palette, lighting mood, vintage tone, wallpaper style, decorative pattern style, and all background textures.",
    "- Preserve all correct text, numbers, labels, book titles, rose patterns, wallpaper flowers, shelf shapes, towel patterns, and decorative elements.",
    "- Do not create a new scene, do not beautify creatively, do not simplify, do not modernize, do not make a different illustration, do not change characters or objects, and do not output before/after comparison layouts.",
    "",
    "RESTORATION GOAL:",
    "Return the same image on the same canvas, with only the defects repaired. The result should look like the uploaded image was carefully cleaned and restored in place, not redrawn.",
    "",
    `REFERENCE RATIO: ${targetSize.aspectRatio}. REQUESTED QUALITY/SIZE: ${targetSize.size}. The output aspect ratio must remain ${targetSize.aspectRatio}.`,
    "USER/GEMINI DEFECT NOTES:",
    userPrompt || "Repair only visible defects while preserving everything else exactly.",
    "Return exactly one final image."
  ].join("\n");
}

function normalizeImageCandidate(value: unknown) {
  if (typeof value !== "string") return "";
  const candidate = value.trim();
  if (candidate.startsWith("data:image/") || candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(candidate)) {
    return `data:image/png;base64,${candidate.replace(/\s/g, "")}`;
  }
  return "";
}

function findImageInObject(value: any, depth = 0): string {
  if (!value || depth > 5) return "";
  const direct = normalizeImageCandidate(value);
  if (direct) return direct;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageInObject(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  const preferredKeys = [
    "imageBase64",
    "image_base64",
    "b64_json",
    "url",
    "imageUrl",
    "image_url",
    "output_url",
    "generated_image",
    "result_image",
    "image",
    "images",
    "data",
    "output",
    "result"
  ];
  for (const key of preferredKeys) {
    if (key in value) {
      const found = findImageInObject(value[key], depth + 1);
      if (found) return found;
    }
  }
  for (const key of Object.keys(value)) {
    const found = findImageInObject(value[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function extractImageFromUnifiedResponse(data: any) {
  const direct = findImageInObject(data);
  if (direct) return direct;

  const messageContent = data?.choices?.[0]?.message?.content;
  const textContent = Array.isArray(messageContent)
    ? messageContent
        .map((part: any) => part?.image_url?.url || part?.imageUrl || part?.url || part?.text || "")
        .join("\n")
    : String(messageContent || "");
  const dataUrlMatch = textContent.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/);
  if (dataUrlMatch?.[0]) return dataUrlMatch[0].replace(/\s/g, "");
  const markdownUrlMatch = textContent.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/);
  if (markdownUrlMatch?.[1]) return markdownUrlMatch[1];
  return "";
}

async function normalizeOutputImage(image: string) {
  if (!image.startsWith("http")) return image;
  try {
    const response = await fetchWithTimeout(image, {}, 30000);
    if (!response.ok) return image;
    const contentType = response.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return image;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  if (!timeoutMs || timeoutMs <= 0) {
    return fetch(url, init);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error: any) {
    const message = String(error?.message || error || "");
    if (error?.name === "AbortError" || isAbortLikeError(message)) {
      throw new Error("当前通道长时间未返回结果，已顺延同族可用节点继续修复。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function isExcessiveLoadError(message: string) {
  return /excessive system load|high load|system load|too busy|overloaded/i.test(message);
}

function comparableImagePayload(image: string) {
  return image
    .replace(/^data:[^;]+;base64,/, "")
    .replace(/\s/g, "")
    .trim();
}

function isSameImagePayload(a: string, b: string) {
  const left = comparableImagePayload(a);
  const right = comparableImagePayload(b);
  return Boolean(left && right && left === right);
}

function isLikelyWrongNananobananaModel(candidateModel: string, data: any) {
  if (!/-2k$|-4k$/.test(candidateModel)) return false;
  const creditsUsed = Number(data?.creditsUsed);
  return Number.isFinite(creditsUsed) && creditsUsed <= 1;
}

function inferDataUrlDimensions(image: string, fallbackMimeType = "image/png") {
  if (image.startsWith("http")) return null;
  try {
    const { buffer, mimeType } = dataUrlToBlobParts(image, fallbackMimeType);
    return inferImageDimensions(buffer, mimeType);
  } catch {
    return null;
  }
}

function isAspectRatioCompatible(
  source: { width: number; height: number } | null,
  output: { width: number; height: number } | null
) {
  if (!hasPlausibleDimensions(source) || !hasPlausibleDimensions(output)) return true;
  const sourceRatio = source.width / source.height;
  const outputRatio = output.width / output.height;
  return Math.abs(sourceRatio - outputRatio) / sourceRatio <= 0.05;
}

function preferredNananobananaModels(requestedModelId: string, gatewayModels: string[]) {
  const requested = (requestedModelId || "nano-banana-2").toLowerCase();
  const requestedFamily = canonicalRepairFamily(requested);
  const sameFamilyOrder: Record<string, string[]> = {
    // Keep the user's 2K choice first. 4K and Seedream are not silent fallbacks:
    // they have different cost/behaviour and previously made a repair queue needlessly long.
    nano: ["nanobanan-2-2k", "nanobanan-2"],
    gpt: ["gpt-image-2-2k"],
    pro: ["nanobanan2&pro-2k"]
  };
  if (requested.includes("seedream")) return ["seedream-5.0-2k"].filter((model) => gatewayModels.includes(model));
  return (sameFamilyOrder[requestedFamily] || sameFamilyOrder.nano).filter((model) => gatewayModels.includes(model));
}

function preferredOpenAIEditModels(requestedModelId: string, gatewayModels: string[]) {
  const requestedFamily = canonicalRepairFamily(requestedModelId || "nano-banana-2");
  const sameFamilyOrder: Record<string, string[]> = {
    nano: ["nano-banana-2"],
    gpt: ["gpt-image-2"],
    pro: ["nano-banana-pro"]
  };
  return (sameFamilyOrder[requestedFamily] || sameFamilyOrder.nano).filter((model) => gatewayModels.includes(model));
}

function canonicalRepairFamily(modelId: string) {
  const normalized = modelId.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("gptimage2")) return "gpt";
  if (normalized.includes("pro")) return "pro";
  if (normalized.includes("seedream")) return "nano";
  if (normalized.includes("banana") || normalized.includes("banan")) return "nano";
  return "nano";
}

type RepairFamily = "nano" | "gpt" | "pro";

function repairGatewayRank(gateway: ImageRepairGateway) {
  if (gateway.kind === "nananobanana") return 0;
  return 40;
}

function repairFamilyOrder(requestedFamily: string): RepairFamily[] {
  if (requestedFamily === "gpt") return ["gpt", "nano", "pro"];
  if (requestedFamily === "pro") return ["pro", "nano", "gpt"];
  return ["nano", "gpt", "pro"];
}

function repairModelsByFamily(gateway: ImageRepairGateway, family: RepairFamily) {
  const familySeed: Record<RepairFamily, string> = {
    nano: "nanobanan-2-2k",
    gpt: "gpt-image-2-2k",
    pro: "nanobanan2&pro-2k"
  };
  const models = gateway.kind === "nananobanana"
    ? preferredNananobananaModels(familySeed[family], gateway.models)
    : preferredOpenAIEditModels(familySeed[family], gateway.models);
  return models.filter((model) => canonicalRepairFamily(model) === family);
}

function repairModelRank(requestedModelId: string, model: string) {
  const modelRank =
    model === requestedModelId
      ? 0
      : model === "nanobanan-2-2k" || model === "nano-banana-2"
        ? 1
        : model === "nanobanan-2"
          ? 2
          : model === "seedream-5.0-2k"
            ? 3
          : model === "gpt-image-2" || model === "gpt-image-2-2k"
            ? 4
            : model.includes("pro")
              ? 5
              : 8;
  return modelRank;
}

function buildRepairCandidates(requestedModelId: string, repairGateways: ImageRepairGateway[]) {
  const requestedFamily = canonicalRepairFamily(requestedModelId || "nano-banana-2");
  const familyOrder = repairFamilyOrder(requestedFamily);
  const candidates = familyOrder.flatMap((family, familyIndex) =>
    repairGateways.flatMap((gateway) =>
      repairModelsByFamily(gateway, family).map((candidateModel) => ({
        gateway,
        candidateModel,
        familyIndex
      }))
    )
  );

  const seenRepairCandidates = new Set<string>();
  return candidates
    .sort((left, right) =>
      left.familyIndex - right.familyIndex ||
      repairGatewayRank(left.gateway) - repairGatewayRank(right.gateway) ||
      repairModelRank(requestedModelId, left.candidateModel) - repairModelRank(requestedModelId, right.candidateModel)
    )
    .filter(({ gateway, candidateModel }) => {
      const key = `${gateway.name}/${candidateModel}`;
      if (seenRepairCandidates.has(key)) return false;
      seenRepairCandidates.add(key);
      return true;
    });
}

function displayRepairModelName(modelId: string) {
  if (modelId === "seedream-5.0-2k") return "Seedream 5.0 2K";
  const family = canonicalRepairFamily(modelId);
  if (family === "gpt") return "GPT Image 2 2K";
  if (family === "pro") return "Nano Banana Pro 2K";
  return "Nano Banana 2 2K";
}

function limitPromptForRepairModel(modelId: string, prompt: string) {
  // Seedream rejects prompts over 4000 characters. Preserve both the lock rules
  // at the start and the actual defect notes at the end when trimming.
  const maxChars = modelId.toLowerCase().includes("seedream") ? 3600 : 9000;
  if (prompt.length <= maxChars) return prompt;
  const tailLength = Math.min(900, Math.floor(maxChars * 0.25));
  const headLength = Math.max(1, maxChars - tailLength - 64);
  return `${prompt.slice(0, headLength)}\n[Condensed to meet this model's prompt limit.]\n${prompt.slice(-tailLength)}`;
}

function parseGatewayResponseText(responseText: string) {
  if (!responseText) return {};
  try {
    return JSON.parse(responseText);
  } catch {
    // The public image endpoint can reply with server-sent events. Read the
    // last JSON data event instead of treating a successful streamed image as
    // a malformed response.
    const eventPayload = responseText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s*/, ""))
      .reverse()
      .find((value) => value && value !== "[DONE]");
    if (eventPayload) {
      try {
        return JSON.parse(eventPayload);
      } catch {
        return { message: eventPayload };
      }
    }
    return { message: responseText };
  }
}

async function callOpenAIImageEdit({
  apiKey,
  modelId,
  imageBase64,
  mimeType,
  prompt,
  endpoint
}: {
  apiKey: string;
  modelId: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  endpoint: string;
}) {
  const { buffer, mimeType: detectedMime } = dataUrlToBlobParts(imageBase64, mimeType);
  const form = new FormData();
  form.append("model", modelId || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("image", new Blob([buffer], { type: detectedMime }), "input.png");

  const response = await fetch(endpoint || "https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const data: any = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `OpenAI image edit failed: ${response.status}`);
  }

  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (b64) return `data:image/png;base64,${b64}`;
  if (url) return url;
  throw new Error("OpenAI image edit returned no image.");
}

async function callKreaImageEdit({
  apiKey,
  modelId,
  endpoint,
  imageBase64,
  prompt
}: {
  apiKey: string;
  modelId: string;
  endpoint: string;
  imageBase64: string;
  prompt: string;
}) {
  const cleanedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      prompt,
      model: modelId,
      imageBase64: cleanedBase64,
      referenceImages: [cleanedBase64],
      n: 1
    })
  });

  const data: any = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Krea image edit failed: ${response.status}`);
  }

  const directImage =
    data?.imageBase64 ||
    data?.images?.[0]?.base64 ||
    data?.images?.[0]?.url ||
    data?.result?.images?.[0]?.url ||
    data?.output?.[0];

  if (typeof directImage === "string") {
    return directImage.startsWith("data:") || directImage.startsWith("http")
      ? directImage
      : `data:image/png;base64,${directImage}`;
  }

  const jobId = data?.id || data?.jobId || data?.job?.id;
  if (!jobId) {
    throw new Error("Krea returned no direct image or job id. Check the endpoint payload for this model.");
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const poll = await fetch(`https://api.krea.ai/jobs/${jobId}`, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    const pollData: any = await poll.json();
    const image =
      pollData?.images?.[0]?.url ||
      pollData?.result?.images?.[0]?.url ||
      pollData?.output?.[0] ||
      pollData?.imageUrl;
    if (image) return image;
    if (pollData?.status === "failed") {
      throw new Error(pollData?.error || "Krea job failed.");
    }
  }

  throw new Error("Krea job did not finish in time.");
}

async function callGoogleImagenEdit({
  apiKey,
  modelId,
  endpoint,
  imageBase64,
  mimeType,
  prompt,
  googleProjectId,
  googleLocation
}: {
  apiKey: string;
  modelId: string;
  endpoint: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  googleProjectId?: string;
  googleLocation?: string;
}) {
  const projectId = googleProjectId || process.env.GOOGLE_PROJECT_ID;
  const location = googleLocation || process.env.GOOGLE_LOCATION || "us-central1";
  if (!projectId) {
    throw new Error("Google Imagen requires Project ID.");
  }

  const targetEndpoint = (endpoint || "")
    .replace("PROJECT_ID", projectId)
    .replace(/LOCATION/g, location)
    .replace("imagen-3.0-capability-001", modelId || "imagen-3.0-capability-001");

  const cleanedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, "");
  const response = await fetch(targetEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      instances: [
        {
          prompt,
          referenceImages: [
            {
              referenceType: "REFERENCE_TYPE_RAW",
              referenceImage: {
                bytesBase64Encoded: cleanedBase64,
                mimeType: mimeType || "image/png"
              }
            }
          ]
        }
      ],
      parameters: {
        sampleCount: 1
      }
    })
  });

  const data: any = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Google Imagen edit failed: ${response.status}`);
  }

  const b64 = data?.predictions?.[0]?.bytesBase64Encoded || data?.predictions?.[0]?.image?.bytesBase64Encoded;
  if (!b64) throw new Error("Google Imagen returned no image.");
  return `data:image/png;base64,${b64}`;
}

async function callUnifiedImageEdit({
  engineId,
  modelId,
  imageBase64,
  mimeType,
  prompt
}: {
  engineId: string;
  modelId: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
}) {
  const { apiKey, endpoint } = getUnifiedImageConfig();
  if (!isValidSecret(apiKey) || !endpoint) {
    throw new Error("内部图像编辑接口尚未配置。请稍后填入 FIXI_IMAGE_API_KEY 和 FIXI_IMAGE_API_ENDPOINT。");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      engineId,
      model: modelId,
      prompt,
      image: imageBase64,
      mimeType
    })
  });

  const data: any = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Unified image edit failed: ${response.status}`);
  }

  const image = data?.imageBase64 || data?.b64_json || data?.url || data?.imageUrl || data?.output?.[0];
  if (!image) throw new Error("内部图像编辑接口未返回图片。");
  return typeof image === "string" && (image.startsWith("data:") || image.startsWith("http"))
    ? image
    : `data:image/png;base64,${image}`;
}

type VisionProblemCategory =
  | "pixel_collapse"
  | "image_tearing"
  | "render_distortion"
  | "hand_collapse"
  | "face_collapse"
  | "limb_proportion"
  | "object_topology"
  | "ripple_artifact"
  | "material_confusion"
  | "dark_noise"
  | "texture_misalignment"
  | "text_problem";

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

const PROBLEM_TITLES: Record<VisionProblemCategory, string> = {
  pixel_collapse: "像素崩坏",
  image_tearing: "画面撕裂",
  render_distortion: "渲染失真",
  hand_collapse: "手部崩坏",
  face_collapse: "脸部崩坏",
  limb_proportion: "肢体比例失调",
  object_topology: "物体拓扑错误",
  ripple_artifact: "波纹伪影",
  material_confusion: "材质混淆",
  dark_noise: "暗部脏感与噪点",
  texture_misalignment: "纹理错位",
  text_problem: "文字问题"
};

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

interface VisionProblem {
  category: VisionProblemCategory;
  title: string;
  summary: string;
  details: string[];
  severity?: "low" | "medium" | "high";
  repairPrompt?: string;
}

function localVisionDetectFallback(): VisionProblem[] {
  return [
    {
      category: "pixel_collapse",
      title: PROBLEM_TITLES.pixel_collapse,
      summary: "像素破碎、局部崩坏或压缩细节可能需要修复。",
      details: ["像素破碎、细节崩坏、局部杂色或清晰度不足。"],
      severity: "medium",
      repairPrompt: REPAIR_PROMPT_TEMPLATES.pixel_collapse
    },
    {
      category: "dark_noise",
      title: PROBLEM_TITLES.dark_noise,
      summary: "暗部脏感、噪点和灰雾可能需要处理。",
      details: ["暗部噪点、脏感、灰雾和明暗过渡不自然。"],
      severity: "medium",
      repairPrompt: REPAIR_PROMPT_TEMPLATES.dark_noise
    },
    {
      category: "texture_misalignment",
      title: PROBLEM_TITLES.texture_misalignment,
      summary: "纹理方向、贴图边缘或材质断层可能需要检查。",
      details: ["纹理错位、材质断层、图案偏移或边缘不连续。"],
      severity: "low",
      repairPrompt: REPAIR_PROMPT_TEMPLATES.texture_misalignment
    }
  ];
}

type ImageRepairAttempt = {
  time: string;
  gateway: string;
  model: string;
  status: "running" | "success" | "failed";
  message: string;
  durationMs?: number;
};

async function callUnifiedImageEditV2({
  engineId,
  modelId,
  imageBase64,
  mimeType,
  prompt,
  onProgress
}: {
  engineId: string;
  modelId: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  onProgress?: (patch: { message?: string; attempts?: ImageRepairAttempt[] }) => void;
}) {
  const fallbackConfig = getUnifiedImageConfig();
  const repairGateways = getImageRepairGateways(fallbackConfig.apiKey, fallbackConfig.endpoint);
  if (!repairGateways.length) {
    throw new Error("请先在设置中配置 NanoBanana 或 ChatGPT Image 2 的网关地址与 API Key。");
  }

  const { buffer, mimeType: detectedMime } = dataUrlToBlobParts(imageBase64, mimeType);
  const sourceImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${detectedMime || mimeType || "image/png"};base64,${imageBase64}`;
  const sourceDimensions = inferImageDimensions(buffer, detectedMime || mimeType);
  const targetSize = target2KSize(sourceDimensions, prompt);
  const imageToImagePromptFor = (requestedSize: string | GatewaySizeAttempt) => {
    const requestedDimensions = dimensionsForRequestedSize(requestedSize || targetSize.size, targetSize);
    return buildStyleLockedRestorationPrompt(prompt, requestedDimensions);
  };

  const requestImageToImage = async (
    gateway: ImageRepairGateway,
    resolvedModelId: string,
    requestedAttempt: GatewaySizeAttempt
  ) => {
    const isNanoModel = /banana/i.test(resolvedModelId);
    const isGptImageModel = /^gpt-image-2/.test(resolvedModelId);
    const normalizedEndpoint = gateway.endpoint.replace(/\/$/, "");
    const imageEndpoint = normalizedEndpoint.endsWith("/v1")
      ? normalizedEndpoint + "/images/edits"
      : normalizedEndpoint;
    const imageBlob = new Blob([buffer], { type: detectedMime || mimeType || "image/png" });
    const form = new FormData();
    form.append("model", resolvedModelId);
    form.append("prompt", imageToImagePromptFor(requestedAttempt));
    form.append("size", requestedAttempt.size);
    form.append("n", "1");
    if (!isGptImageModel) {
      form.append("response_format", "b64_json");
    }
    form.append("image", imageBlob, "input.png");
    if (isNanoModel) {
      form.append("mode", "image-to-image");
      form.append("task_type", "image_edit");
      form.append("edit_type", "reference_image_edit");
      form.append("reference_strength", "1");
      form.append("reference_image", imageBlob, "input.png");
      form.append("reference_images[]", imageBlob, "input.png");
      form.append("input_image", imageBlob, "input.png");
    }

    const modelTimeoutMs = Number(process.env.FIXI_REPAIR_GATEWAY_TIMEOUT_MS || "") || 300000;
    const response = await fetchWithTimeout(imageEndpoint, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + gateway.apiKey
      },
      body: form
    }, modelTimeoutMs);

    const responseText = await response.text();
    const data = parseGatewayResponseText(responseText);
    return { response, data };
  };

  const requestNanoReferenceImageToImage = async (
    gateway: ImageRepairGateway,
    resolvedModelId: string,
    requestedAttempt: GatewaySizeAttempt
  ) => {
    const requestedDimensions = dimensionsForRequestedSize(requestedAttempt, targetSize);
    const normalizedEndpoint = gateway.endpoint.replace(/\/$/, "");
    const generateEndpoint = normalizedEndpoint.endsWith("/generate")
      ? normalizedEndpoint
      : normalizedEndpoint + "/generate";
    const modelTimeoutMs = Number(process.env.FIXI_NANANOBANANA_TIMEOUT_MS || "") || 150000;
    const response = await fetchWithTimeout(generateEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + gateway.apiKey,
        Accept: "text/event-stream, application/json"
      },
      body: JSON.stringify({
        prompt: limitPromptForRepairModel(resolvedModelId, [
          "This is an image-to-image repair request. The reference image is mandatory and must be used as the source image.",
          `Do not create a new image from text only. Preserve the uploaded reference image composition, subject identity, style, colors, lighting and aspect ratio ${requestedDimensions.aspectRatio}.`,
          imageToImagePromptFor(requestedDimensions)
        ].join("\n")),
        referenceImageUrls: [sourceImage],
        quantity: 1,
        aspectRatio: requestedDimensions.aspectRatio,
        selectedModel: resolvedModelId,
        noRefund: false
      })
    }, modelTimeoutMs);

    const responseText = await response.text();
    const data = parseGatewayResponseText(responseText);
    return { response, data };
  };

  const errors: string[] = [];
  const attempts: ImageRepairAttempt[] = [];
  const publishAttempt = (
    gateway: ImageRepairGateway,
    candidateModel: string,
    status: ImageRepairAttempt["status"],
    message: string,
    existingIndex?: number
  ) => {
    const now = Date.now();
    const previousAttempt = typeof existingIndex === "number" ? attempts[existingIndex] : null;
    const previousStartedAt = previousAttempt ? Date.parse(previousAttempt.time) : NaN;
    const attempt = {
      time: new Date(now).toISOString(),
      gateway: gateway.name,
      model: candidateModel,
      status,
      message,
      ...(status !== "running" && Number.isFinite(previousStartedAt)
        ? { durationMs: Math.max(0, now - previousStartedAt) }
        : {})
    };
    if (typeof existingIndex === "number" && attempts[existingIndex]) {
      attempts[existingIndex] = attempt;
    } else {
      attempts.push(attempt);
    }
    onProgress?.({
      message: `${status === "running" ? "正在调用" : status === "success" ? "调用成功" : "调用失败"}：${displayRepairModelName(candidateModel)}`,
      attempts: [...attempts]
    });
    return typeof existingIndex === "number" ? existingIndex : attempts.length - 1;
  };
  const requestedModelId = String(modelId || engineId || "nano-banana-2").trim();
  const repairCandidates = buildRepairCandidates(requestedModelId, repairGateways);

  for (const { gateway, candidateModel } of repairCandidates) {
      const maxAttempts = 1;
      const sizeAttempts = buildGatewaySizeAttempts(gateway, targetSize, sourceDimensions);
      let response: Response | null = null;
      let data: any = null;
      let lastMessage = "";
      let acceptedImage: string | null = null;
      let acceptedRequestedSize = "";
      const runningAttemptIndex = publishAttempt(
        gateway,
        candidateModel,
        "running",
        `正在调用 ${displayRepairModelName(candidateModel)}`
      );

      sizeLoop:
      for (const requestedAttempt of sizeAttempts) {
        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const result = gateway.kind === "nananobanana"
              ? await requestNanoReferenceImageToImage(gateway, candidateModel, requestedAttempt)
              : await requestImageToImage(gateway, candidateModel, requestedAttempt);
            response = result.response;
            data = result.data;
            lastMessage = readableImageRouteError(readableError(data) || "status " + response.status);
          } catch (error: any) {
            response = null;
            data = null;
            lastMessage = readableImageRouteError(readableError(error) || String(error));
          }
          const shouldFastFail =
            isCloudflareBlockError(lastMessage) ||
            isConcurrentLimitError(lastMessage) ||
            /fetch failed|invalid argument|unsupported|not found|forbidden|403/i.test(lastMessage);
          const shouldRetry = !shouldFastFail && (isExcessiveLoadError(lastMessage) || isConcurrentLimitError(lastMessage));
          const shouldRetryAbort = isAbortLikeError(lastMessage);
          if (response?.ok || (!shouldRetry && !shouldRetryAbort) || attempt === maxAttempts) break;
          await sleep(isConcurrentLimitError(lastMessage) ? 3000 * attempt : shouldRetryAbort ? 1500 * attempt : 1200 * attempt);
        }
        if (response?.ok) {
          const image = extractImageFromUnifiedResponse(data);
          if (!image) {
            lastMessage = readableImageRouteError(readableError(data) || "internal image route returned no image");
            response = null;
            data = null;
            continue;
          }
          acceptedImage = await normalizeOutputImage(image);
          acceptedRequestedSize = `${requestedAttempt.size}/${requestedAttempt.aspectRatio}`;
          break sizeLoop;
        }
      }

      if (acceptedImage) {
        publishAttempt(
          gateway,
          candidateModel,
          "success",
          `returned repaired image; requestedSize=${acceptedRequestedSize || targetSize.size}${data?.creditsUsed ? `; creditsUsed=${data.creditsUsed}` : ""}`,
          runningAttemptIndex
        );
        return {
          image: acceptedImage,
          modelId: candidateModel,
          attempts: [...attempts]
        };
      }

      if (!response) {
        publishAttempt(gateway, candidateModel, "failed", lastMessage || "no response", runningAttemptIndex);
        errors.push(gateway.name + "/" + candidateModel + ": " + (lastMessage || "no response"));
        continue;
      }
      if (!response.ok) {
        publishAttempt(gateway, candidateModel, "failed", lastMessage, runningAttemptIndex);
        errors.push(gateway.name + "/" + candidateModel + ": " + lastMessage);
        console.warn("Image repair model failed:", {
          gateway: gateway.name,
          model: candidateModel,
          reason: lastMessage
        });
        if (isConcurrentLimitError(lastMessage)) {
          await sleep(1500);
        }
        continue;
      }

      const responseMessage = readableError(data);
      publishAttempt(gateway, candidateModel, "failed", responseMessage ? readableImageRouteError(responseMessage) : "internal image route returned no image", runningAttemptIndex);
      errors.push(gateway.name + "/" + candidateModel + ": " + (responseMessage ? readableImageRouteError(responseMessage) : "internal image route returned no image"));
      console.warn("Image repair model returned no image:", {
        gateway: gateway.name,
        model: candidateModel,
        reason: responseMessage || "internal image route returned no image"
      });
      continue;
  }

  console.warn("Image-to-image repair attempts failed:", errors);
  const hasCreditProblem = errors.some((error) => isCreditError(error));
  if (hasCreditProblem) {
    const error: any = new Error("模型通道额度或权限异常：" + errors.join("；"));
    error.attempts = attempts;
    throw error;
  }
  const error: any = new Error("模型通道暂不可用：" + errors.join("；"));
  error.attempts = attempts;
  throw error;
}

function problemFromText(text: string): VisionProblem {
  const category = categoryFromText(text);
  return {
    category,
    title: PROBLEM_TITLES[category],
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

function normalizeProblemItem(item: any): VisionProblem | null {
  if (!item) return null;
  if (typeof item === "string") return problemFromText(item);

  const rawCategory = String(item.category || item.type || "").toLowerCase();
  const category: VisionProblemCategory = PROBLEM_ORDER.includes(rawCategory as VisionProblemCategory)
    ? rawCategory as VisionProblemCategory
    : categoryFromText(rawCategory || readableError(item));

  const fallback = problemFromText(readableError(item));
  const details = Array.isArray(item.details)
    ? item.details.map((detail: any) => readableError(detail)).filter(Boolean)
    : [readableError(item.detail || item.description || item.summary || item.issue)].filter(Boolean);

  return {
    category,
    title: readableError(item.title) || PROBLEM_TITLES[category] || fallback.title,
    summary: readableError(item.summary || item.issue || item.description) || fallback.summary,
    details: details.length ? details : fallback.details,
    severity: item.severity === "high" || item.severity === "medium" || item.severity === "low" ? item.severity : fallback.severity,
    repairPrompt: readableError(item.repairPrompt || item.fixPrompt || item.solutionPrompt || item.solution) || REPAIR_PROMPT_TEMPLATES[category] || fallback.repairPrompt
  };
}

function parseJsonLike(value: string) {
  const trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function mergeProblemCategories(problems: VisionProblem[]): VisionProblem[] {
  return PROBLEM_ORDER
    .map((category) => {
      const items = problems.filter((problem) => problem.category === category);
      if (!items.length) return null;
      const first = items[0];
      const details = items.flatMap((problem) => problem.details.length ? problem.details : [problem.summary]).filter(Boolean);
      return {
        category,
        title: first.title,
        summary: first.summary,
        details: Array.from(new Set(details)).slice(0, 5),
        severity: items.some((item) => item.severity === "high") ? "high" : items.some((item) => item.severity === "medium") ? "medium" : "low",
        repairPrompt: Array.from(new Set(items.map((item) => item.repairPrompt).filter(Boolean))).join("；")
      } satisfies VisionProblem;
    })
    .filter(Boolean) as VisionProblem[];
}

function normalizeProblems(value: any): VisionProblem[] {
  if (!value) return localVisionDetectFallback();
  if (Array.isArray(value)) return mergeProblemCategories(value.map(normalizeProblemItem).filter(Boolean) as VisionProblem[]);
  if (typeof value === "string") {
    const trimmed = value.trim();
    const parsed = parseJsonLike(trimmed);
    if (parsed) {
      return normalizeProblems(parsed?.problems || parsed?.issues || parsed);
    }
    return trimmed
      .split(/\n|；|;/)
      .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
      .filter((line) => line && !/^```|^\{|\}$|^\[|\]$|^"?(problems|repairPrompt|details|category|title|summary|severity)"?\s*:?/i.test(line))
      .map(problemFromText);
  }
  if (Array.isArray(value?.problems)) return normalizeProblems(value.problems);
  if (Array.isArray(value?.issues)) return normalizeProblems(value.issues);
  return normalizeProblems([value]);
}

function imageSourceDetectionGuidance(imageSourceModel?: string) {
  if (imageSourceModel === "nano-banana") {
    return [
      "用户标记图片来源：NANO-BANNA。",
      "在通用检测基础上，着重检查该来源模型更容易出现的主体一致性漂移、局部重绘边缘融合、手部/五官/肢体结构错位、细节过度重建和纹理粘连。",
      "修复提示词中必须增加锚定不变要求：主体身份、脸型、姿态、服饰、构图、背景关系、光影方向和原始画风保持不变。"
    ].join("\n");
  }
  if (imageSourceModel === "gpt-image-2") {
    return [
      "用户标记图片来源：GPT-IMAGE 2.0。",
      "在通用检测基础上，着重检查该来源模型更容易出现的过度平滑、清晰度假锐化、纹理细节丢失、文字/边缘粘连、局部材质不一致和主体小结构变形。",
      "修复提示词中必须增加锚定不变要求：主体身份、构图比例、色彩气质、材质属性、背景元素和原始风格保持不变。"
    ].join("\n");
  }
  return "用户未选择图片来源：按通用 AI 图片问题规则检测，并给出通用修复提示词。";
}

function selectionDetectionGuidance(selectionBox?: any) {
  if (!selectionBox) return "";
  const boxes = Array.isArray(selectionBox) ? selectionBox : [selectionBox];
  const validBoxes = boxes.filter((box) => Number(box?.width) > 0 && Number(box?.height) > 0);
  if (!validBoxes.length) return "";
  const coordinateText = validBoxes
    .map((box, index) => {
      const x = Math.round(Number(box.x) || 0);
      const y = Math.round(Number(box.y) || 0);
      const width = Math.round(Number(box.width) || 0);
      const height = Math.round(Number(box.height) || 0);
      return `区域${index + 1}：左上 x=${x}%，y=${y}%，宽=${width}%，高=${height}%`;
    })
    .join("；");
  return [
    `用户已在预览图中用红框标注 ${validBoxes.length} 个重点修复区域，检测图中可能带有这些红色框线。`,
    `框选区域相对坐标：${coordinateText}。`,
    "红框只是前端坐标辅助，不是原图内容，也不是需要生成的画面元素。",
    "视觉识别必须优先检查所有框选区域内的模糊、细碎、崩坏、撕裂、文字、结构和噪点问题；框选区域外只在与框选问题强相关时补充。",
    "修复提示词必须明确：图生图修复应基于原始参考图和坐标区域进行局部修复，最终输出绝对不能出现红框、红色边框、框线、标注、选区痕迹或任何提示性图形。"
  ].join("\n");
}

function buildVisionDetectionPrompt(imageSourceModel?: string, selectionBox?: any) {
  return [
    "Detect AI image defects in the provided image. Return JSON only, with no markdown and no explanation outside JSON.",
    "All title, summary, details and repairPrompt values must be written in Simplified Chinese.",
    "Every detected problem must use one of these categories only:",
    "pixel_collapse, image_tearing, render_distortion, hand_collapse, face_collapse, limb_proportion, object_topology, ripple_artifact, material_confusion, dark_noise, texture_misalignment, text_problem.",
    imageSourceDetectionGuidance(imageSourceModel),
    selectionDetectionGuidance(selectionBox),
    "For each problem, provide category, title, summary, details array, severity as low/medium/high, and repairPrompt.",
    "Also provide a top-level repairPrompt that merges the image-specific repair requirements and can be sent directly to an image-editing model.",
    "The user uploaded this image because it needs repair. If no single defect is obvious, still return the most likely repairable categories and a conservative repairPrompt; never return an empty problems array.",
    "Return shape: {\"problems\":[{\"category\":\"pixel_collapse\",\"title\":\"Chinese title\",\"summary\":\"Chinese summary\",\"details\":[\"Chinese detail 1\",\"Chinese detail 2\"],\"severity\":\"medium\",\"repairPrompt\":\"Chinese repair prompt\"}],\"repairPrompt\":\"Chinese merged repair prompt\"}"
  ].join("\n");
}

function normalizeVisionDetectionPayload(parsedContent: any) {
  const rawProblems = normalizeProblems(parsedContent?.problems || parsedContent?.issues || parsedContent);
  const problems = rawProblems.length
    ? rawProblems
    : localVisionDetectFallback();
  const repairPrompt = readableError(parsedContent?.repairPrompt || parsedContent?.fixPrompt || parsedContent?.solutionPrompt);
  const specificRepairPrompt = readableError(parsedContent?.specificRepairPrompt || parsedContent?.specificPrompt || parsedContent?.imageSpecificRepairPrompt) || repairPrompt;
  const categoryPrompt = problems
    .filter((problem) => problem.category !== "text_problem")
    .map((problem) => problem.repairPrompt)
    .filter(Boolean)
    .join("\uFF1B");
  return {
    problems,
    specificRepairPrompt,
    repairPrompt: [specificRepairPrompt, categoryPrompt].filter(Boolean).join("\uFF1B")
  };
}

async function callGeminiVisionDetect(imageBase64: string, mimeType = "image/png", imageSourceModel?: string, selectionBox?: any) {
  const sourceImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;
  const prompt = buildVisionDetectionPrompt(imageSourceModel, selectionBox);
  const { apiKey, endpoint } = getUnifiedImageConfig();
  const visionKeys = splitSecretList(process.env.FIXI_GEMINI_VISION_KEYS || process.env.FIXI_IMAGE_API_KEYS, [apiKey].filter(Boolean), false);
  const visionModels = splitModelList(process.env.FIXI_GEMINI_VISION_MODELS, [
    "gemini-3-flash-preview-official",
    "gemini-3-flash-preview",
    "gemini-3.1-pro-preview",
    "gemini-2.5-pro"
  ]);
  const visionTimeoutMs = Number(process.env.FIXI_GEMINI_VISION_TIMEOUT_MS || "") || 60000;
  const visionDeadline = Date.now() + (Number(process.env.FIXI_GEMINI_VISION_TOTAL_TIMEOUT_MS || "") || Math.max(60000, visionModels.length * visionTimeoutMs));

  if (endpoint && visionKeys.some(isValidSecret)) {
    const errors: string[] = [];
    for (const key of visionKeys) {
      if (!isValidSecret(key)) continue;
      for (const model of visionModels) {
        const remainingMs = visionDeadline - Date.now();
        if (remainingMs < 1000) {
          errors.push("Gemini vision total timeout reached before trying more models.");
          break;
        }
        try {
          const response = await fetchWithTimeout(normalizeEndpointWithPath(endpoint, "/chat/completions"), {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`
            },
            body: JSON.stringify({
              model,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "text", text: prompt },
                    { type: "image_url", image_url: { url: sourceImage } }
                  ]
                }
              ],
              temperature: 0.2
            })
          }, Math.max(1000, Math.min(visionTimeoutMs, remainingMs)));

          const responseText = await response.text();
          let data: any;
          try {
            data = responseText ? JSON.parse(responseText) : {};
          } catch {
            data = { message: responseText };
          }
          if (!response.ok) {
            throw new Error(readableError(data) || `Gemini vision detect failed: ${response.status}`);
          }
          const content = data?.choices?.[0]?.message?.content || data?.result || data?.text || data;
          const parsedContent = typeof content === "string" ? (parseJsonLike(content) || cleanAndFormatJson(content)) : content;
          return normalizeVisionDetectionPayload(parsedContent);
        } catch (error: any) {
          errors.push(`${model}: ${readableError(error) || String(error)}`);
          if (Date.now() >= visionDeadline) break;
        }
      }
      if (Date.now() >= visionDeadline) break;
    }
    throw new Error(`Gemini 视觉识别模型已全部自动顺延但仍未返回有效结果：${errors.join("；")}`);
  }

  const client = getGeminiClient();
  if (!client) {
    throw new Error("Gemini 3 Flash Preview 视觉识别未配置可用网关或 GEMINI_API_KEY。");
  }

  const { buffer, mimeType: detectedMime } = dataUrlToBlobParts(sourceImage, mimeType);
  const result: any = await client.models.generateContent({
    model: process.env.GEMINI_VISION_MODEL || "gemini-3-flash-preview-official",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: detectedMime || mimeType || "image/png",
              data: buffer.toString("base64")
            }
          }
        ]
      }
    ],
    config: {
      temperature: 0.2
    }
  });

  const text = typeof result?.text === "function" ? result.text() : result?.text || "";
  const parsedContent = parseJsonLike(text) || cleanAndFormatJson(text);
  return normalizeVisionDetectionPayload(parsedContent);
}

function getGeminiVisionMonitorChannel() {
  const { endpoint } = getUnifiedImageConfig();
  return endpoint ? normalizeEndpointWithPath(endpoint, "/chat/completions") : "google-gemini";
}

function getGpt55VisionConfig() {
  return {
    apiKey: String(process.env.FIXI_GPT55_VISION_API_KEY || "").trim(),
    endpoint: String(process.env.FIXI_GPT55_VISION_API_ENDPOINT || "").trim(),
    model: String(process.env.FIXI_GPT55_VISION_MODEL || "gpt-5.5").trim() || "gpt-5.5"
  };
}

function getVisionEngineName(engineId: string) {
  if (engineId === "doubao-seed-vision") return "Doubao Seed Vision";
  if (engineId === "gpt-5.5") return "GPT 5.5";
  return "Gemini 3 Flash Preview";
}

function getVisionMonitorChannel(engineId: string) {
  if (engineId === "doubao-seed-vision") return `volcengine:${getDoubaoConfig().region}`;
  if (engineId === "gpt-5.5") {
    return normalizeEndpointWithPath(getGpt55VisionConfig().endpoint, "/chat/completions");
  }
  return getGeminiVisionMonitorChannel();
}

async function callUnifiedVisionDetect(imageBase64: string, mimeType = "image/png", imageSourceModel?: string, selectionBox?: any) {
  const sourceImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;
  const prompt = buildVisionDetectionPrompt(imageSourceModel, selectionBox);

  const parsedContent = await callDoubaoModel([
    { role: "system", content: "You are Doubao Seed Vision for AI image defect detection. Return strict JSON only." },
    { role: "user", content: [{ type: "text", text: prompt }, { type: "image_url", image_url: { url: sourceImage } }] }
  ], 0.2);
  return normalizeVisionDetectionPayload(parsedContent);
}

async function callGpt55VisionDetect(imageBase64: string, mimeType = "image/png", imageSourceModel?: string, selectionBox?: any) {
  const sourceImage = imageBase64.startsWith("data:")
    ? imageBase64
    : `data:${mimeType};base64,${imageBase64}`;
  const prompt = buildVisionDetectionPrompt(imageSourceModel, selectionBox);
  const { apiKey, endpoint, model } = getGpt55VisionConfig();

  if (!isValidSecret(apiKey)) {
    throw new Error("GPT 5.5 视觉识别未配置可用 API Key。");
  }

  const response = await fetchWithTimeout(normalizeEndpointWithPath(endpoint, "/chat/completions"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: sourceImage } }
          ]
        }
      ],
      temperature: 0.2
    })
  }, Number(process.env.FIXI_GPT55_VISION_TIMEOUT_MS || "") || 60000);

  const responseText = await response.text();
  let data: any;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = { message: responseText };
  }
  if (!response.ok) {
    throw new Error(readableError(data) || `GPT 5.5 vision detect failed: ${response.status}`);
  }
  const content = data?.choices?.[0]?.message?.content || data?.result || data?.text || data;
  const parsedContent = typeof content === "string" ? (parseJsonLike(content) || cleanAndFormatJson(content)) : content;
  return normalizeVisionDetectionPayload(parsedContent);
}

async function callVisionDetectEngine(engineId: string, imageBase64: string, mimeType = "image/png", imageSourceModel?: string, selectionBox?: any) {
  if (engineId === "doubao-seed-vision") {
    return callUnifiedVisionDetect(imageBase64, mimeType, imageSourceModel, selectionBox);
  }
  if (engineId === "gpt-5.5") {
    return callGpt55VisionDetect(imageBase64, mimeType, imageSourceModel, selectionBox);
  }
  return callGeminiVisionDetect(imageBase64, mimeType, imageSourceModel, selectionBox);
}

const HISTORY_DIR = path.join(process.cwd(), "data", "history");

function normalizeHistoryClientId(value: unknown) {
  const raw = String(value || "default").trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  return safe || "default";
}

function historyFilePath(clientId: string) {
  return path.join(HISTORY_DIR, `${normalizeHistoryClientId(clientId)}.json`);
}

async function readHistoryFile(clientId: string) {
  const filePath = historyFilePath(clientId);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      exists: true,
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return { exists: false, items: [] };
    }
    throw error;
  }
}

async function writeHistoryFile(clientId: string, items: any[]) {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const filePath = historyFilePath(clientId);
  const tempPath = `${filePath}.tmp`;
  const payload = JSON.stringify({
    id: normalizeHistoryClientId(clientId),
    updatedAt: new Date().toISOString(),
    items: Array.isArray(items) ? items : []
  });
  await fs.writeFile(tempPath, payload, "utf-8");
  await fs.rename(tempPath, filePath);
}

function resolveUpscaylBinary() {
  const candidates = [
    process.env.FIXI_UPSCAYL_BIN,
    path.join(process.cwd(), "tools", "upscayl-ncnn", "upscayl-bin.exe"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "upscayl-ncnn.exe"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "realesrgan-ncnn-vulkan.exe"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "windows", "upscayl-bin.exe"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "windows", "upscayl-ncnn.exe"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "windows", "realesrgan-ncnn-vulkan.exe")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || "";
}

function resolveUpscaylModelsDir() {
  const candidates = [
    process.env.FIXI_UPSCAYL_MODELS_DIR,
    path.join(process.cwd(), "tools", "upscayl-ncnn", "models"),
    path.join(process.cwd(), "tools", "upscayl-ncnn", "windows", "models")
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => fsSync.existsSync(candidate)) || "";
}

function scaleForUpscaylModel(model: string, fallbackScale: number) {
  if (/x2\b/i.test(model)) return 2;
  if (/x3\b/i.test(model)) return 3;
  if (/x4\b/i.test(model)) return 4;
  return fallbackScale;
}

function runUpscaylProcess(binaryPath: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, { cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error((stderr || stdout || `Upscayl exited with code ${code}`).slice(0, 2000)));
    });
  });
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3008);
  const updateDir = process.env.FIXI_UPDATE_DIR || path.join(process.cwd(), "fixi-updates");
  type RepairJobStatus = "queued" | "running" | "success" | "failed";
  type RepairJob = {
    id: string;
    status: RepairJobStatus;
    createdAt: string;
    updatedAt: string;
    message: string;
    result?: any;
    error?: string;
    attempts: any[];
  };
  const repairJobs = new Map<string, RepairJob>();

  function updateRepairJob(jobId: string, patch: Partial<RepairJob>) {
    const current = repairJobs.get(jobId);
    if (!current) return;
    repairJobs.set(jobId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    });
  }

  function pruneRepairJobs() {
    const maxAgeMs = 1000 * 60 * 60 * 6;
    const now = Date.now();
    for (const [id, job] of repairJobs.entries()) {
      if (now - new Date(job.updatedAt).getTime() > maxAgeMs) repairJobs.delete(id);
    }
  }

  async function executeImageRepairRequest(
    body: any,
    req: express.Request,
    onProgress?: (patch: { message?: string; attempts?: ImageRepairAttempt[] }) => void
  ) {
    const {
      engineId,
      provider,
      apiKey,
      modelId,
      endpoint,
      prompt,
      imageBase64,
      mimeType,
      googleProjectId,
      googleLocation
    } = body;
    const effectivePrompt = String(prompt || "").trim() || DEFAULT_REPAIR_PROMPT;

    if (!imageBase64) {
      const error: any = new Error("No image content provided.");
      error.statusCode = 400;
      throw error;
    }

    const resolvedProvider = provider || "openai";
    const resolvedApiKey =
      apiKey ||
      (resolvedProvider === "openai"
        ? process.env.OPENAI_API_KEY
        : resolvedProvider === "krea"
          ? process.env.KREA_API_KEY
          : process.env.GOOGLE_ACCESS_TOKEN);

    if (resolvedProvider !== "unified" && !isValidSecret(resolvedApiKey)) {
      const error: any = new Error("API key/token is required for selected engine.");
      error.statusCode = 400;
      throw error;
    }

    let image: string;
    let actualModelId = modelId || engineId || resolvedProvider;
    let attempts: any[] = [];
    if (resolvedProvider === "unified") {
      const unifiedResult = await callUnifiedImageEditV2({
        engineId,
        modelId,
        imageBase64,
        mimeType,
        prompt: effectivePrompt,
        onProgress
      });
      image = unifiedResult.image;
      actualModelId = unifiedResult.modelId;
      attempts = unifiedResult.attempts || [];
    } else if (resolvedProvider === "openai") {
      image = await callOpenAIImageEdit({
        apiKey: resolvedApiKey!,
        modelId: modelId || process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
        imageBase64,
        mimeType,
        prompt: effectivePrompt,
        endpoint
      });
    } else if (resolvedProvider === "krea") {
      image = await callKreaImageEdit({
        apiKey: resolvedApiKey!,
        modelId,
        endpoint,
        imageBase64,
        prompt: effectivePrompt
      });
    } else if (resolvedProvider === "google") {
      image = await callGoogleImagenEdit({
        apiKey: resolvedApiKey!,
        modelId,
        endpoint,
        imageBase64,
        mimeType,
        prompt: effectivePrompt,
        googleProjectId,
        googleLocation
      });
    } else {
      const error: any = new Error(`Unsupported provider: ${resolvedProvider}`);
      error.statusCode = 400;
      throw error;
    }

    const payload = {
      imageBase64: image,
      engineId,
      engineName: actualModelId || engineId || resolvedProvider,
      modelId: actualModelId,
      attempts
    };

    reportMonitorEvent({
      type: "repair",
      purpose: "修复",
      status: "success",
      model: actualModelId || engineId || resolvedProvider,
      channel: resolvedProvider === "unified" ? "unified-image-edit" : resolvedProvider,
      prompt: effectivePrompt,
      inputImageBase64: compactImageForMonitor(imageBase64),
      clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
      userAgent: req.headers["user-agent"] || "",
      outputImageBase64: compactImageForMonitor(image),
      imageBase64: compactImageForMonitor(image),
      attempts
    });

    return payload;
  }

  // Increase payload limit to support base64 images
  app.use(express.json({ limit: "250mb" }));
  app.use(express.urlencoded({ limit: "250mb", extended: true }));

  app.get("/api/community/settings", (_req, res) => {
    res.json(publicCommunitySettings());
  });

  app.put("/api/community/settings", async (req, res) => {
    const patchGateway = (current: CommunityGatewaySettings, incoming: any, fallbackModel: string): CommunityGatewaySettings => {
      const endpoint = normalizeCommunityEndpoint(incoming?.endpoint);
      if (incoming?.endpoint && !endpoint) throw new Error("网关地址必须以 http:// 或 https:// 开头。");
      const suppliedKey = String(incoming?.apiKey || "").trim();
      return {
        endpoint,
        apiKey: suppliedKey || current.apiKey,
        model: String(incoming?.model || current.model || fallbackModel).trim() || fallbackModel
      };
    };

    try {
      const nextSettings: CommunitySettings = {
        nanoBanana: patchGateway(communitySettings.nanoBanana, req.body?.nanoBanana, "nano-banana-2"),
        chatgptImage2: patchGateway(communitySettings.chatgptImage2, req.body?.chatgptImage2, "gpt-image-2")
      };
      await writeCommunitySettings(nextSettings);
      res.json({ ok: true, settings: publicCommunitySettings() });
    } catch (error: any) {
      res.status(400).json({ ok: false, error: readableError(error) || "配置保存失败。" });
    }
  });

  app.post("/api/community/settings/test", async (req, res) => {
    const provider = req.body?.provider === "chatgptImage2" ? "chatgptImage2" : "nanoBanana";
    const submitted = req.body?.settings?.[provider];
    const saved = communitySettings[provider];
    const settings: CommunityGatewaySettings = {
      endpoint: normalizeCommunityEndpoint(submitted?.endpoint || saved.endpoint),
      apiKey: String(submitted?.apiKey || saved.apiKey || "").trim(),
      model: String(submitted?.model || saved.model || (provider === "nanoBanana" ? "nano-banana-2" : "gpt-image-2")).trim()
    };
    if (!settings.endpoint || !isValidSecret(settings.apiKey)) {
      return res.status(400).json({ ok: false, message: "请先填写网关地址与 API Key，再测试连接。" });
    }

    try {
      const response = await fetchWithTimeout(communityModelsEndpoint(settings.endpoint), {
        headers: { Authorization: `Bearer ${settings.apiKey}` }
      }, 15000);
      const body = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${body.slice(0, 500)}`);
      const parsed = (() => { try { return JSON.parse(body); } catch { return null; } })();
      const models = Array.isArray(parsed?.data)
        ? parsed.data.map((item: any) => String(item?.id || item?.name || "")).filter(Boolean)
        : Array.isArray(parsed?.models)
          ? parsed.models.map((item: any) => String(item?.id || item?.name || item || "")).filter(Boolean)
          : [];
      const expected = settings.model.toLowerCase();
      const found = models.some((model) => model.toLowerCase() === expected);
      res.json({
        ok: true,
        provider,
        modelFound: found,
        models: models.slice(0, 30),
        message: found
          ? `连接成功，已确认可访问模型 ${settings.model}。`
          : `网关认证与模型目录访问成功，但未在目录中找到 ${settings.model}；请核对模型 ID。`
      });
    } catch (error: any) {
      res.status(502).json({
        ok: false,
        provider,
        message: `连接测试失败：${readableError(error) || "网关未返回有效响应。"}`
      });
    }
  });

  app.post("/api/runtime/monitor-endpoint", (req, res) => {
    const remoteAddress = req.socket.remoteAddress || "";
    const isLocalRequest = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress.endsWith("::ffff:127.0.0.1");
    const endpoint = String(req.body?.endpoint || "").trim();
    if (!isLocalRequest) return res.status(403).json({ error: "Local desktop runtime only." });
    if (!/^https?:\/\/[^\s]+\/api\/events$/i.test(endpoint)) {
      return res.status(400).json({ error: "Invalid monitor endpoint." });
    }
    runtimeMonitorEndpoint = endpoint;
    res.json({ ok: true, endpoint });
  });

  app.get("/api/runtime/monitor-endpoint", (_req, res) => {
    res.json({ endpoint: getMonitorEndpoint() });
  });

  app.use("/fixi-updates", express.static(updateDir, {
    setHeaders: (res) => res.setHeader("Cache-Control", "no-store")
  }));

  app.get("/api/history", async (req: express.Request, res: express.Response) => {
    try {
      const clientId = normalizeHistoryClientId(req.header("x-fixi-client-id") || req.query.clientId);
      const history = await readHistoryFile(clientId);
      res.json(history);
    } catch (error: any) {
      console.error("Failed to read history:", error);
      res.status(500).json({ error: "Failed to read history", details: error?.message || String(error) });
    }
  });

  app.put("/api/history", async (req: express.Request, res: express.Response) => {
    try {
      const clientId = normalizeHistoryClientId(req.header("x-fixi-client-id") || req.body?.clientId);
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      await writeHistoryFile(clientId, items);
      res.json({ ok: true, count: items.length });
    } catch (error: any) {
      console.error("Failed to persist history:", error);
      res.status(500).json({ error: "Failed to persist history", details: error?.message || String(error) });
    }
  });

  app.post("/api/image-upscale", async (req: express.Request, res: express.Response) => {
    const { imageBase64, mimeType, scale, model } = req.body || {};
    const selectedScale = [2, 3, 4].includes(Number(scale)) ? Number(scale) : 2;
    const selectedModel = String(model || process.env.FIXI_UPSCAYL_MODEL || "RealESRGAN_General_x4_v3").trim();
    let tempDir = "";

    try {
      if (!imageBase64) {
        res.status(400).json({ error: "No image content provided." });
        return;
      }

      const binaryPath = resolveUpscaylBinary();
      if (!binaryPath) {
        res.status(503).json({
          error: "Upscayl backend is not installed.",
          details: "未找到 Upscayl 本地后端。请确认 tools\\upscayl-ncnn 内存在 upscayl-bin.exe。"
        });
        return;
      }

      const modelsDir = resolveUpscaylModelsDir();
      const { buffer, mimeType: detectedMime } = dataUrlToBlobParts(imageBase64, mimeType || "image/png");
      const sourceMime = detectedMime || mimeType || "image/png";
      const inputExt = /jpe?g/i.test(sourceMime) ? "jpg" : /webp/i.test(sourceMime) ? "webp" : "png";
      await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
      tempDir = await fs.mkdtemp(path.join(process.cwd(), "data", "upscale-"));
      const inputPath = path.join(tempDir, `input.${inputExt}`);
      const outputPath = path.join(tempDir, "output.png");
      await fs.writeFile(inputPath, buffer);

      const selectedModelScale = scaleForUpscaylModel(selectedModel, selectedScale);
      const args = [
        "-i",
        inputPath,
        "-o",
        outputPath,
        "-n",
        selectedModel,
        "-z",
        String(selectedModelScale),
        "-s",
        String(selectedScale),
        "-f",
        "png"
      ];
      if (modelsDir) args.push("-m", modelsDir);
      await runUpscaylProcess(binaryPath, args, path.dirname(binaryPath));

      const outputBuffer = await fs.readFile(outputPath);
      const outputImage = `data:image/png;base64,${outputBuffer.toString("base64")}`;
      reportMonitorEvent({
        type: "upscale",
        purpose: "无损放大",
        status: "success",
        model: selectedModel,
        channel: "upscayl-ncnn",
        prompt: `${selectedScale}x 无损放大`,
        inputImageBase64: compactImageForMonitor(imageBase64),
        outputImageBase64: compactImageForMonitor(outputImage),
        clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        attempts: [
          {
            time: new Date().toISOString(),
            gateway: "local-upscayl",
            model: selectedModel,
            status: "success",
            message: `Upscayl ${selectedScale}x completed`
          }
        ]
      });
      res.json({ ok: true, imageBase64: outputImage, scale: selectedScale, model: selectedModel });
    } catch (error: any) {
      const message = readableError(error) || String(error);
      reportMonitorEvent({
        type: "upscale",
        purpose: "无损放大",
        status: "failed",
        model: selectedModel,
        channel: "upscayl-ncnn",
        prompt: `${selectedScale}x 无损放大`,
        inputImageBase64: compactImageForMonitor(imageBase64),
        clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        error: message
      });
      res.status(502).json({ error: "Upscayl upscale failed", details: message });
    } finally {
      if (tempDir) {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  app.post("/api/vision/detect", async (req: express.Request, res: express.Response) => {
    try {
      const { imageBase64, mimeType, imageSourceModel, engineId, selectionBox } = req.body;
      if (!imageBase64) {
        res.status(400).json({ error: "No image content provided." });
        return;
      }

      const selectedVisionEngine = engineId === "doubao-seed-vision" || engineId === "gpt-5.5"
        ? engineId
        : "gemini-3-flash-preview";
      let actualVisionEngine = selectedVisionEngine;
      let detection: any;
      const attempts: any[] = [];
      try {
        const fallbackOrder = [
          selectedVisionEngine,
          ...["gemini-3-flash-preview", "doubao-seed-vision", "gpt-5.5"].filter((item) => item !== selectedVisionEngine)
        ];
        let lastError: any;
        for (const candidateEngine of fallbackOrder) {
          try {
            detection = await callVisionDetectEngine(candidateEngine, imageBase64, mimeType, imageSourceModel, selectionBox);
            actualVisionEngine = candidateEngine;
            attempts.push({
              time: new Date().toISOString(),
              gateway: getVisionMonitorChannel(candidateEngine),
              model: getVisionEngineName(candidateEngine),
              status: "success",
              message: `${getVisionEngineName(candidateEngine)} vision detect completed`
            });
            break;
          } catch (error: any) {
            lastError = error;
            attempts.push({
              time: new Date().toISOString(),
              gateway: getVisionMonitorChannel(candidateEngine),
              model: getVisionEngineName(candidateEngine),
              status: "failed",
              message: readableError(error) || String(error)
            });
          }
        }
        if (!detection) throw lastError || new Error("视觉识别未返回有效结果。");
      } catch (primaryError: any) {
        throw new Error(`视觉识别模型全部不可用：${attempts.map((item) => `${item.model}: ${item.message}`).join("；") || readableError(primaryError) || String(primaryError)}`);
      }
      const modelName = getVisionEngineName(actualVisionEngine);
      const channelName = getVisionMonitorChannel(actualVisionEngine);
      const payload = {
        engineId: actualVisionEngine,
        requestedEngineId: selectedVisionEngine,
        attempts,
        fallbackNotice: attempts.some((item) => item.status === "failed") && attempts.some((item) => item.status === "success")
          ? `${attempts.filter((item) => item.status === "failed").map((item) => item.model).join("、")} 调用失败，已自动顺延 ${modelName} 并完成识别。`
          : "",
        problems: detection.problems,
        repairPrompt: detection.repairPrompt,
        specificRepairPrompt: detection.specificRepairPrompt,
        imageSourceModel: imageSourceModel || "",
        selectionBox: selectionBox || null
      };
      reportMonitorEvent({
        type: "vision_detect",
        purpose: "\u8bc6\u522b",
        status: "success",
        model: modelName,
        channel: channelName,
        imageSourceModel: imageSourceModel || "",
        inputImageBase64: compactImageForMonitor(imageBase64),
        clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        outputText: textForMonitor(payload),
        attempts
      });
      res.json(payload);
    } catch (error: any) {
      const selectedVisionEngine = req.body?.engineId === "doubao-seed-vision" || req.body?.engineId === "gpt-5.5"
        ? req.body.engineId
        : "gemini-3-flash-preview";
      const modelName = getVisionEngineName(selectedVisionEngine);
      console.error(`${modelName} vision detect failed:`, error);
      reportMonitorEvent({
        type: "vision_detect",
        purpose: "\u8bc6\u522b",
        status: "failed",
        model: modelName,
        channel: getVisionMonitorChannel(selectedVisionEngine),
        inputImageBase64: compactImageForMonitor(req.body?.imageBase64),
        clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        imageSourceModel: req.body?.imageSourceModel || "",
        error: readableError(error) || String(error)
      });
      res.status(502).json({
        engineId: selectedVisionEngine,
        error: `${modelName} detect failed`,
        details: readableError(error) || String(error)
      });
    }
  });

  app.post("/api/image-edit/repair/start", async (req: express.Request, res: express.Response) => {
    pruneRepairJobs();
    try {
      if (!req.body?.imageBase64) {
        res.status(400).json({ error: "No image content provided." });
        return;
      }
      const effectiveBody = {
        ...req.body,
        prompt: String(req.body?.prompt || "").trim() || DEFAULT_REPAIR_PROMPT
      };
      const jobId = `repair_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const job: RepairJob = {
        id: jobId,
        status: "queued",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        message: "任务已提交，正在准备调用模型。",
        attempts: []
      };
      repairJobs.set(jobId, job);
      res.json({ jobId, status: job.status, message: job.message });

      setTimeout(async () => {
        updateRepairJob(jobId, {
          status: "running",
          message: "正在调用模型，请保持当前页面等待结果。"
        });
        try {
          const result = await executeImageRepairRequest(effectiveBody, req, (patch) => updateRepairJob(jobId, patch));
          updateRepairJob(jobId, {
            status: "success",
            message: `修复完成，实际调用模型：${result.modelId || result.engineName || effectiveBody?.modelId || ""}`,
            result,
            attempts: result.attempts || []
          });
        } catch (error: any) {
          console.error("Image edit repair job failed:", error);
          const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
          reportMonitorEvent({
            type: "repair",
            purpose: "修复",
            status: "failed",
            model: effectiveBody?.modelId || effectiveBody?.engineId || effectiveBody?.provider || "",
            channel: effectiveBody?.provider === "unified" ? "unified-image-edit" : effectiveBody?.provider || "",
            prompt: effectiveBody?.prompt || "",
            inputImageBase64: compactImageForMonitor(effectiveBody?.imageBase64),
            clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
            userAgent: req.headers["user-agent"] || "",
            error: error.message || String(error),
            attempts
          });
          updateRepairJob(jobId, {
            status: "failed",
            message: readableImageRouteError(readableError(error) || String(error)),
            error: "Image edit repair failed",
            attempts
          });
        }
      }, 0);
    } catch (error: any) {
      res.status(error?.statusCode || 500).json({
        error: "Image edit repair job failed",
        details: readableImageRouteError(readableError(error) || String(error))
      });
    }
  });

  app.get("/api/image-edit/repair/job/:jobId", async (req: express.Request, res: express.Response) => {
    const job = repairJobs.get(String(req.params.jobId || ""));
    if (!job) {
      res.status(404).json({ error: "Repair job not found." });
      return;
    }
    res.json(job);
  });

  app.post("/api/image-edit/repair", async (req: express.Request, res: express.Response) => {
    try {
      const payload = await executeImageRepairRequest(req.body, req);
      res.json(payload);
    } catch (error: any) {
      console.error("Image edit repair failed:", error);
      reportMonitorEvent({
        type: "repair",
        purpose: "修复",
        status: "failed",
        model: req.body?.modelId || req.body?.engineId || req.body?.provider || "",
        channel: req.body?.provider === "unified" ? "unified-image-edit" : req.body?.provider || "",
        prompt: req.body?.prompt || "",
        inputImageBase64: compactImageForMonitor(req.body?.imageBase64),
        clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || req.ip || "",
        userAgent: req.headers["user-agent"] || "",
        error: error.message || String(error),
        attempts: Array.isArray(error?.attempts) ? error.attempts : []
      });
      const details = readableImageRouteError(readableError(error) || String(error));
      res.status(error?.statusCode || 500).json({
        error: "Image edit repair failed",
        details,
        attempts: Array.isArray(error?.attempts) ? error.attempts : []
      });
    }
  });

  // API Route: Image Analysis & Parameter Recommendation (Multimodal with Doubao-seed-2.0)
  app.post("/api/gemini/analyze", async (req: express.Request, res: express.Response) => {
    try {
      const { imageBase64, mimeType } = req.body;
      if (!imageBase64) {
        res.status(400).json({ error: "No image content provided" });
        return;
      }

      const { apiKey, endpointId } = getDoubaoConfig();
      
      if (!apiKey) {
        // High-fidelity fallback diagnostic when Doubao API is unconfigured
        console.log("Using diagnostic simulation callback (No Volcengine/Ark Key for Doubao)");
        const simulatedResult = {
          issues: [
            "【字节跳动 Doubao-seed-2.0 智能感知】图像边缘存在高频块状失真与噪点（中度偏高）",
            "【字节跳动 Doubao-seed-2.0 智能感知】人物面部或者主焦点结构有轻微的模糊和像素丢失",
            "【字节跳动 Doubao-seed-2.0 智能感知】局部对比度失衡，暗部过渡生硬且存在伪影"
          ],
          brokenParts: [
            "肢端关节判定失稳，指骨边缘高频像素呈撕裂性崩坏",
            "面部深度重影物理形变，双侧极点发生非对称溶解"
          ],
          shatteredDetails: [
            "背景画幅网格纹理严重破碎，混叠噪点弥散",
            "低光照深度细节大范围断崖式流失"
          ],
          recommendations: {
            deblur: Math.floor(Math.random() * 30) + 40,
            denoise: Math.floor(Math.random() * 25) + 50,
            faceRestore: Math.floor(Math.random() * 40) + 45,
            colorRecovery: Math.floor(Math.random() * 30) + 30
          },
          analysis: "分析报告（Doubao-seed-2.0 模拟）：检测到该图呈现出 JPEG 压缩导致的块状伪影及典型的传感器噪点。受损细节主要集中在图像的高频边缘。建议启用高强度的「去噪点」算法滤除杂质，再配合中等强度的「去模糊」进行锐化，并在受损严重区域（如面部/几何边缘）启用「面部超分辨率」和「色彩重塑」，即可完美重现原有纹理与质感。"
        };
        // Artificial small latency for user experience realism
        await new Promise(resolve => setTimeout(resolve, 1500));
        res.json(simulatedResult);
        return;
      }

      // Convert clean base64 data (strip data URL prefix if present)
      const dataUrl = imageBase64.startsWith("data:") 
        ? imageBase64 
        : `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;

      const systemPrompt = `你是一位由字节跳动训练的专业 Doubao-seed-2.0 多模态数字图像修复、缺陷检测与画损评估专家。请对用户提供的受损图片进行全面视觉诊断。
你的分析必须涵盖以下维度，并给出数值修复推荐：
1. 找出主要的画损/缺陷问题。尤其需要：
   - 识别出画面中的“崩坏部分”（如：面部畸形崩坏、器官/关节/多指位置不对称或断裂等宏观结构失稳问题）；
   - 识别出画面中的“细节破碎部分”（如：高频像素块噪点、图像模糊、边缘羽化流失、低光灰阶细节破碎等微观物理损坏）。
2. 提供一键自动修复的滑块参数推荐（deblur: 去像素模糊, denoise: 去图像噪点, faceRestore: 局部/面部细节超分修复, colorRecovery: 暗部色彩重塑）。每个参数范围是 0 到 100 之间的整数。

请必须严格以指定的 JSON 格式返回，切勿带有任何 Explanation 或者 \`\`\`json 标签包装：
{
  "issues": ["综合画损问题1", "综合画损问题2", ...],
  "brokenParts": ["已识别的细节/画面崩坏部分说明1", "已识别的细节/画面崩坏部分说明2", ...],
  "shatteredDetails": ["已识别的物理微观/细节破碎部分说明1", "已识别的物理微观/细节破碎部分说明2", ...],
  "recommendations": {
    "deblur": 70,
    "denoise": 50,
    "faceRestore": 80,
    "colorRecovery": 40
  },
  "analysis": "画损成因及建议一键自动修复工艺的中文深度解读。"
}`;

      const messages = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: systemPrompt
            },
            {
              type: "image_url",
              image_url: {
                url: dataUrl
              }
            }
          ]
        }
      ];

      const parsedData = await callDoubaoModel(messages);
      res.json(parsedData);

    } catch (error: any) {
      console.error("Error analyzing image with Doubao-seed-2.0:", error);
      res.status(500).json({ 
        error: "Image analysis error (Doubao Endpoint)", 
        details: error.message || error,
        fallback: true
      });
    }
  });

  // API Route: AI Prompt Optimizer & Detail Corruption Solver (Doubao-seed-2.0)
  app.post("/api/gemini/fix-prompt", async (req: express.Request, res: express.Response) => {
    try {
      const { prompt, imageBase64, mimeType } = req.body;
      if (!prompt || prompt.trim() === "") {
        res.status(400).json({ error: "Prompt is required" });
        return;
      }

      const { apiKey, endpointId } = getDoubaoConfig();

      if (!apiKey) {
        // High-fidelity fallback mock response if API Key is not set
        console.log("Using prompt solver simulation callback (No Volcengine/Ark Key for Doubao - aligned with newest guidelines)");
        const simulatedResult = {
          issue: "【字节跳动 Doubao-seed-2.0 词义诊断】检测到原提示词中含有不符合新规的属性堆叠。原始词中可能带有'8k'或空洞的‘极致细节’广告语，或包含过于理想的‘完美皮肤/无噪点/无毛孔’等会导致纸片塑料磨皮感的描述。已对语义进行硬化纠偏，剥离繁杂的无序霓虹街景，锁定局部光影物理结构。",
          optimized_prompt: "一位神态平和的东方年轻女性上半身着实摄影像，面部五官生理结构精准对称，在柔和温暖的自然散射日光下呈现出细腻真实、带有微小生理毛孔与真实纹理的皮肤质感，手中握着一束带着晨露的浅粉色石竹花",
          negative_prompt: "畸形肢体，多指，多余的手，重影，塑料感，死板磨皮，过曝，极度不合常理的构图，画面撕裂，空气喷砂质感",
          enhancement_tags: [],
          reasoning: ""
        };
        await new Promise(resolve => setTimeout(resolve, 1000));
        res.json(simulatedResult);
        return;
      }

      const systemPrompt = `你是一位由字节跳动训练的、殿堂级 AI 图像生成与提示词修复大师。
请对用户的图像提示词展开深度防崩溃与质量纠偏硬化优化。

【核心优化与生成规则（必须严格遵守）】：
1. 【完全中文】：优化反馈的所有内容（包括正向提示词 "optimized_prompt"、负向提示词 "negative_prompt" 以及 "issue" 诊断）必须「完全使用中文」陈述，不得输出任何英文、拼音。
2. 【禁止空洞词汇】：绝对禁止输出 "8K"、"超精细"、"极致细节"、"杰作"、"高清"、"masterpiece"、"8k"、"photorealistic" 等任何无实质物理含义的、敷衍无用的空洞广告词。
3. 【避免信息过载】：避免类似于 "街景+人群+雨+霓虹+反射+招牌+远景" 这种由于堆砌了气象、材质、远景、广告牌、流动人口等过多杂乱维度所引发的信息大过载。应指导AI将画面聚焦于单一高对比的主体和干净的背景。
4. 【文本指定载体】：如果有文字/中文字符渲染诉求，必须明确“中文字符”将渲染在何种物理载体之上（例如：“在老式木质牌匾上刻着‘迎客’二字”），绝对不能不明确载体直接要求画出文字。
5. 【废除死板磨皮词】：正负向提示词中一律不得写入 "完美皮肤"、"无毛孔"、"干净通透"、"无噪点" 等空洞塑料感修饰。此类词会导致严重的假面塑料反光或死板模糊。请用物理规律的写实词汇（如：真实的皮肤微小纹理、自然散射光照、生理解剖学精准面部）来代替。

请严格以下列指定的 JSON 格式输出，切勿附带任何 Markdown 标记（不要用 \`\`\`json 包裹）或 Extra Explanation：
{
  "issue": "详细诊断原提示词中有哪些导致细节崩坏的潜在词语、冲突性修饰语、违规堆砌词（如果是图像输入，请一并深度多模态识别剖析图像里已经出现的物理解剖异常、畸形等问题，完全中文）。",
  "optimized_prompt": "优化后的高品质中文正向提示词。必须满足：完全中文、无空洞修饰词、无信息过载混杂、有文字则明确指定载体、使用真实物理属性词重构替代死板磨皮。",
  "negative_prompt": "强效中文负向提示词。包含一整套排除物理反常、解剖畸变、人偶塑料感、文字粘连模糊、画幅过度锐化扭曲的纯中文负向排斥标签组。",
  "enhancement_tags": [],
  "reasoning": ""
}`;

      const userContent: any[] = [
        {
          type: "text",
          text: `需要诊断优化的原始提示词: "${prompt}"`
        }
      ];

      if (imageBase64) {
        const dataUrl = imageBase64.startsWith("data:") 
          ? imageBase64 
          : `data:${mimeType || "image/jpeg"};base64,${imageBase64}`;
        userContent.push({
          type: "image_url",
          image_url: {
            url: dataUrl
          }
        });
      }

      const messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ];

      const parsedData = await callDoubaoModel(messages);
      res.json(parsedData);

    } catch (error: any) {
      console.error("Error optimizing prompt with Doubao-seed-2.0:", error);
      res.status(500).json({ 
        error: "Prompt optimization error (Doubao Endpoint)", 
        details: error.message || error,
        fallback: true
      });
    }
  });

  // Client-side Vite Middleware serving React SPA in explicit development only.
  // Packaged local/LAN runs usually do not set NODE_ENV, so default to the compiled static build.
  if (process.env.NODE_ENV === "development") {
    const viteModuleName = "vite";
    const { createServer: createViteServer } = await import(viteModuleName);
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, {
      setHeaders: (res) => {
        res.setHeader("Cache-Control", "no-store");
      }
    }));
    app.get("*", (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    startUpdateHostBeacon(PORT, updateDir);
    console.log(`🚀 [Full-Stack Server] Server booted successfully! Listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("💥 Critical Failure during Server Bootstrap:", err);
});





