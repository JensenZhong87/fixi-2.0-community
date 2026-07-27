export type RepairTab = "auto" | "local" | "upscale" | "prompt" | "history";

export type RepairEngineId =
  | "nano-banana-2"
  | "gpt-image-2";

export interface RepairEngine {
  id: RepairEngineId;
  name: string;
  provider: "unified" | "openai" | "google";
  model: string;
  endpoint: string;
  description: string;
}

export type VisionProblemCategory =
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

export interface VisionProblem {
  category: VisionProblemCategory;
  title: string;
  summary: string;
  details: string[];
  severity?: "low" | "medium" | "high";
  repairPrompt?: string;
}

export interface RepairSliders {
  deblur: number;
  denoise: number;
  faceRestore: number;
  colorRecovery: number;
}

export interface PromptResult {
  original: string;
  issue: string;
  optimized: string;
  negative: string;
  enhancementTags: string[];
  reasoning: string;
}

export interface HistoryItem {
  id: string;
  title: string;
  timestamp: string;
  originalImage: string;
  repairedImage: string;
  engineName: string;
  prompt: string;
  notes?: string;
}
