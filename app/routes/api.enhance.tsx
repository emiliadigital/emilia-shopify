// POST /api/enhance — runs the full enhance-and-replace pipeline:
//
//   1. Look up the merchant's Emilia API key and product media
//   2. Fetch the original image bytes from Shopify's CDN, base64 it
//   3. Call /ai-image-render with the merchant's defaults + helpers
//   4. Stage-upload the result back to Shopify
//   5. productCreateMedia → wait READY → reorder into old position → delete old
//
// The new media has a different ID than the original — Shopify Files/Media
// objects are immutable. Documented in README.

import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import {
  downloadRenderedImage,
  imageUrlToDataUrl,
  renderImage,
  EmiliaApiError,
} from "../lib/emilia.server";
import { getSettings } from "../lib/emilia-settings.server";
import {
  deleteProductMedia,
  reorderMediaToIndex,
  uploadAndAttachImage,
} from "../lib/shopify-media.server";

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

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  if (!settings.apiKey) {
    return json({ ok: false, error: "Emilia API key not configured" }, 400);
  }

  const formData = await request.formData();
  const productId = String(formData.get("productId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const style =
    String(formData.get("style") ?? "") || settings.defaultStyle;
  const aspect =
    String(formData.get("aspect") ?? "") || settings.defaultAspectRatio;
  const resolution =
    String(formData.get("resolution") ?? "") || settings.defaultResolution;
  const presenterId =
    String(formData.get("presenterId") ?? "") || settings.defaultPresenter || "";

  if (!productId || !mediaId) {
    return json({ ok: false, error: "Missing productId or mediaId" }, 400);
  }

  // 1. Fetch the product's media list so we can locate the old image, its
  // position, and its alt text.
  const mediaListRes = await admin.graphql(PRODUCT_MEDIA_LIST, {
    variables: { id: productId },
  });
  const mediaListBody = (await mediaListRes.json()) as {
    data: { product: { media: { nodes: MediaNode[] } } | null };
  };

  if (!mediaListBody.data.product) {
    return json({ ok: false, error: "Product not found" }, 404);
  }

  const nodes = mediaListBody.data.product.media.nodes;
  const originalIndex = nodes.findIndex((n) => n.id === mediaId);
  const original = originalIndex >= 0 ? nodes[originalIndex] : null;

  if (!original || !original.image?.url) {
    return json(
      { ok: false, error: "Original image not found on product" },
      404,
    );
  }

  // 2. Download the original from Shopify's CDN and base64-encode it.
  let dataUrl: string;
  try {
    dataUrl = await imageUrlToDataUrl(original.image.url);
  } catch (err) {
    return json(
      { ok: false, error: err instanceof Error ? err.message : "Image fetch failed" },
      400,
    );
  }

  // 3. Render via Emilia
  let renderResponse;
  try {
    renderResponse = await renderImage(settings.apiKey, {
      imageDataUrl: dataUrl,
      preset: style,
      mode: "product",
      aspect,
      resolution,
      presenterId: presenterId || undefined,
      bgColor:
        style === "color_backdrop" || style === "studio_gradient"
          ? settings.backdropColor
          : undefined,
      helpers: settings.helpers,
    });
  } catch (err) {
    const message =
      err instanceof EmiliaApiError ? err.message : "Generation failed";
    const status = err instanceof EmiliaApiError ? err.statusCode || 500 : 500;
    return json({ ok: false, error: message }, status);
  }

  if (!renderResponse.data_url) {
    return json(
      { ok: false, error: "Emilia API did not return an image" },
      502,
    );
  }

  // 4. Normalize the response (data URL or HTTP URL) to bytes
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

  // 5. Upload to Shopify, attach to product, then reorder + delete old.
  const filename = `emilia-${Date.now()}.${rendered.extension}`;
  let uploaded;
  try {
    uploaded = await uploadAndAttachImage(
      admin,
      productId,
      rendered.buffer,
      rendered.mimeType,
      filename,
      original.image.altText ?? undefined,
    );
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Upload to Shopify failed",
      },
      502,
    );
  }

  // Move the new media into the original's slot so the product page layout is
  // preserved. (productCreateMedia always appends at the end.)
  try {
    await reorderMediaToIndex(admin, productId, uploaded.mediaId, originalIndex);
  } catch (err) {
    // Non-fatal — the new image still exists, just at the wrong position.
    console.warn(
      "[Emilia] reorder failed:",
      err instanceof Error ? err.message : err,
    );
  }

  try {
    await deleteProductMedia(admin, productId, [mediaId]);
  } catch (err) {
    // Non-fatal — surface the warning but keep the success response since the
    // new image is in place.
    console.warn(
      "[Emilia] delete-old failed:",
      err instanceof Error ? err.message : err,
    );
  }

  return json({
    ok: true,
    newMediaId: uploaded.mediaId,
    newImageUrl: uploaded.imageUrl,
  });
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
