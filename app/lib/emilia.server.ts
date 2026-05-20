// Emilia AI Studio platform API client.
//
// Mirrors the WooCommerce plugin's class-api-client.php contract so the same
// `eak_` API keys, endpoints, and request shapes work unchanged.

const DEFAULT_BASE_URL = "https://ai.emilia.digital/wp-json/emai/v1/";

export const EMILIA_API_BASE_URL =
  process.env.EMILIA_API_BASE_URL || DEFAULT_BASE_URL;

// Matches the WP plugin's 10MB cap on image payloads (class-api-client.php:104).
export const EMILIA_MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export interface EmiliaStyle {
  id: string;
  name: string;
  mode?: string;
  thumbnail?: string;
  description?: string;
  has_presenter?: boolean;
}

export interface EmiliaPresenter {
  id: string | number;
  name: string;
  thumbnail?: string;
  is_custom?: boolean;
}

export interface EmiliaHelper {
  name: string;
  label?: string;
  type?: "select" | "color";
  default?: string;
  styles?: string[];
  options?: Record<string, string>;
}

export interface EmiliaConfig {
  styles?: EmiliaStyle[];
  presenters?: EmiliaPresenter[];
  modes?: Record<string, { title: string }>;
  aspect_ratios?: Record<string, { title: string; description: string }>;
  resolutions?: Record<
    string,
    { title: string; pixels: string; credits?: number }
  >;
  helpers?: Record<string, EmiliaHelper[]>;
}

export interface RenderImagePayload {
  imageDataUrl: string;
  preset: string;
  mode?: string;
  model?: string;
  aspect?: string;
  resolution?: string;
  presenterId?: string;
  bgColor?: string;
  helpers?: Record<string, string>;
}

export interface EmiliaRenderResponse {
  data_url?: string;
  [key: string]: unknown;
}

export class EmiliaApiError extends Error {
  statusCode: number;
  body: unknown;

  constructor(message: string, statusCode: number, body: unknown) {
    super(message);
    this.name = "EmiliaApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

function isValidKeyShape(key: string | null | undefined): key is string {
  return !!key && key.startsWith("eak_");
}

async function postJson<T = unknown>(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(EMILIA_API_BASE_URL + endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const message = friendlyMessage(res.status, parsed);
    throw new EmiliaApiError(message, res.status, parsed);
  }

  return parsed as T;
}

function friendlyMessage(status: number, body: unknown): string {
  const apiMessage =
    body && typeof body === "object" && "message" in body
      ? String((body as { message?: unknown }).message ?? "")
      : "";

  switch (status) {
    case 401:
      return "Authentication failed. Please check your API key.";
    case 402:
      return "No remaining credits. Upgrade your plan at https://ai.emilia.digital/product/emilia-ai-subscription";
    case 403:
      return "Invalid API key. Please check your settings.";
    case 503:
      return "Service temporarily unavailable. Please try again later.";
    default:
      return apiMessage || `API request failed (status ${status})`;
  }
}

// --- public API ----------------------------------------------------------

export async function validateApiKey(
  apiKey: string,
): Promise<true | Record<string, unknown> | false> {
  if (!isValidKeyShape(apiKey)) return false;

  try {
    const data = await postJson<{
      success?: boolean;
      data?: Record<string, unknown> | true;
    }>("validate-key", apiKey, { action: "validate_key" }, 30_000);

    if (data?.success) {
      return data.data ?? true;
    }
    return false;
  } catch (err) {
    if (err instanceof EmiliaApiError) {
      console.warn(
        `[Emilia] validate_api_key failed status=${err.statusCode}`,
      );
    } else {
      console.warn("[Emilia] validate_api_key transport error", err);
    }
    return false;
  }
}

export async function fetchPluginConfig(apiKey: string): Promise<EmiliaConfig> {
  if (!isValidKeyShape(apiKey)) {
    throw new EmiliaApiError("API key not configured", 401, null);
  }

  const data = await postJson<{
    success?: boolean;
    data?: EmiliaConfig;
    message?: string;
  }>("get-plugin-config", apiKey, { action: "get_plugin_config" }, 30_000);

  if (!data?.success || !data?.data) {
    throw new EmiliaApiError(
      data?.message || "Failed to fetch configuration",
      0,
      data,
    );
  }
  return data.data;
}

// Calls /ai-image-render with the canonical payload shape from the WP plugin
// (image_data_url, preset, mode, aspect, resolution, optional bg_color,
// presenter_id, and helper fields).
export async function renderImage(
  apiKey: string,
  payload: RenderImagePayload,
): Promise<EmiliaRenderResponse> {
  if (!isValidKeyShape(apiKey)) {
    throw new EmiliaApiError("API key not configured", 401, null);
  }

  const body: Record<string, unknown> = {
    image_data_url: payload.imageDataUrl,
    preset: payload.preset,
    mode: payload.mode || "product",
    model: payload.model || "gemini",
    aspect: payload.aspect || "1:1",
    resolution: payload.resolution || "2K",
  };
  if (payload.presenterId) body.presenter_id = payload.presenterId;
  if (payload.bgColor) body.bg_color = payload.bgColor;
  if (payload.helpers) {
    for (const [k, v] of Object.entries(payload.helpers)) {
      if (v && body[k] === undefined) body[k] = v;
    }
  }

  return postJson<EmiliaRenderResponse>("ai-image-render", apiKey, body);
}

// --- helpers -------------------------------------------------------------

// Fetch the original image from Shopify's CDN, enforce the 10MB cap from the
// WP plugin, and return a base64 data URL ready for /ai-image-render.
export async function imageUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch source image (status ${res.status})`);
  }

  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.byteLength > EMILIA_MAX_IMAGE_BYTES) {
    throw new Error(
      `Source image is ${Math.round(buf.byteLength / 1024 / 1024)}MB; max is 10MB`,
    );
  }

  return `data:${contentType};base64,${buf.toString("base64")}`;
}

// /ai-image-render returns either a base64 data URL or a regular HTTP URL.
// Normalize both into a Buffer so callers can hand it to Shopify staged uploads.
export async function downloadRenderedImage(
  dataOrUrl: string,
): Promise<{ buffer: Buffer; mimeType: string; extension: string }> {
  if (dataOrUrl.startsWith("data:")) {
    const match = dataOrUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!match) throw new Error("Invalid image data URL from Emilia");
    const ext = match[1].toLowerCase();
    return {
      buffer: Buffer.from(match[2], "base64"),
      mimeType: `image/${ext === "jpg" ? "jpeg" : ext}`,
      extension: ext === "jpeg" ? "jpg" : ext,
    };
  }

  if (dataOrUrl.startsWith("http")) {
    const res = await fetch(dataOrUrl);
    if (!res.ok) {
      throw new Error(`Failed to download rendered image (status ${res.status})`);
    }
    const contentType = res.headers.get("content-type") || "image/jpeg";
    let extension = "jpg";
    if (contentType.includes("png")) extension = "png";
    else if (contentType.includes("webp")) extension = "webp";
    return {
      buffer: Buffer.from(await res.arrayBuffer()),
      mimeType: contentType,
      extension,
    };
  }

  throw new Error("Unexpected image format returned by Emilia API");
}
