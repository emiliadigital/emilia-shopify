// POST /api/render — generates the enhanced image but does NOT touch Shopify.
// Returns the result as a base64 data URL so the extension can preview it and
// only commit (via /api/replace) when the merchant confirms.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import {
  downloadRenderedImage,
  imageUrlToDataUrl,
  renderImage,
  EmiliaApiError,
} from "../lib/emilia.server";
import { getSettings } from "../lib/emilia-settings.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

const PRODUCT_MEDIA_LIST = `#graphql
  query EmiliaProductMediaList($id: ID!) {
    product(id: $id) {
      id
      media(first: 50) {
        nodes {
          id
          mediaContentType
          status
          ... on MediaImage {
            image { url altText }
          }
        }
      }
    }
  }
`;

interface MediaNode {
  id: string;
  status: string;
  image?: { url: string; altText?: string | null };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  return new Response("Method Not Allowed", {
    status: 405,
    headers: CORS_HEADERS,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  if (!settings.apiKey) {
    return json({ ok: false, error: "Emilia API key not configured" }, 400);
  }

  const formData = await request.formData();
  const productId = String(formData.get("productId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const style = String(formData.get("style") ?? "") || settings.defaultStyle;
  const aspect =
    String(formData.get("aspect") ?? "") || settings.defaultAspectRatio;
  const resolution =
    String(formData.get("resolution") ?? "") || settings.defaultResolution;

  const presenterRaw = String(formData.get("presenterId") ?? "");
  const presenterId =
    presenterRaw === "__none__"
      ? ""
      : presenterRaw || settings.defaultPresenter || "";

  // Merge any non-reserved fields as helpers (shadow, angle, bg_color, etc.).
  const RESERVED = new Set([
    "productId",
    "mediaId",
    "style",
    "aspect",
    "resolution",
    "presenterId",
  ]);
  const helperOverrides: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (RESERVED.has(k)) continue;
    if (typeof v !== "string" || !v) continue;
    helperOverrides[k] = v;
  }
  const mergedHelpers = { ...settings.helpers, ...helperOverrides };

  if (!productId || !mediaId) {
    return json({ ok: false, error: "Missing productId or mediaId" }, 400);
  }

  // 1. Locate the original media on the product and grab its URL.
  const mediaListRes = await admin.graphql(PRODUCT_MEDIA_LIST, {
    variables: { id: productId },
  });
  const mediaListBody = (await mediaListRes.json()) as {
    data: { product: { media: { nodes: MediaNode[] } } | null };
  };
  if (!mediaListBody.data.product) {
    return json({ ok: false, error: "Product not found" }, 404);
  }
  const original = mediaListBody.data.product.media.nodes.find(
    (n) => n.id === mediaId,
  );
  if (!original?.image?.url) {
    return json(
      { ok: false, error: "Original image not found on product" },
      404,
    );
  }

  // 2. Pull the original image and base64-encode for the Emilia API.
  let originalDataUrl: string;
  try {
    originalDataUrl = await imageUrlToDataUrl(original.image.url);
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Image fetch failed",
      },
      400,
    );
  }

  // 3. Call Emilia.
  let renderResponse;
  try {
    renderResponse = await renderImage(settings.apiKey, {
      imageDataUrl: originalDataUrl,
      preset: style,
      mode: "product",
      aspect,
      resolution,
      presenterId: presenterId || undefined,
      bgColor:
        style === "color_backdrop" || style === "studio_gradient"
          ? settings.backdropColor
          : undefined,
      helpers: mergedHelpers,
    });
  } catch (err) {
    const message =
      err instanceof EmiliaApiError ? err.message : "Generation failed";
    const status = err instanceof EmiliaApiError ? err.statusCode || 500 : 500;
    return json({ ok: false, error: message }, status);
  }

  if (!renderResponse.data_url) {
    return json({ ok: false, error: "Emilia API did not return an image" }, 502);
  }

  // 4. Normalize to data URL (may come back as data: or http: URL).
  let rendered;
  try {
    rendered = await downloadRenderedImage(renderResponse.data_url);
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to read rendered image",
      },
      502,
    );
  }

  const renderedDataUrl = `data:${rendered.mimeType};base64,${rendered.buffer.toString("base64")}`;

  return json({
    ok: true,
    productId,
    mediaId,
    originalImageUrl: original.image.url,
    renderedDataUrl,
    renderedMimeType: rendered.mimeType,
    renderedExtension: rendered.extension,
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
