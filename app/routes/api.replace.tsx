// POST /api/replace — given a productId, mediaId, and a pre-rendered data URL,
// uploads the new image to Shopify, attaches it to the product at the
// original's slot, and deletes the original media. The Emilia render is
// done separately by /api/render so the merchant can preview first.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { downloadRenderedImage } from "../lib/emilia.server";
import {
  deleteProductMedia,
  reorderMediaToIndex,
  uploadAndAttachImage,
} from "../lib/shopify-media.server";

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

  const { admin } = await authenticate.admin(request);

  const formData = await request.formData();
  const productId = String(formData.get("productId") ?? "");
  const mediaId = String(formData.get("mediaId") ?? "");
  const renderedDataUrl = String(formData.get("renderedDataUrl") ?? "");

  if (!productId || !mediaId || !renderedDataUrl) {
    return json(
      { ok: false, error: "Missing productId, mediaId, or renderedDataUrl" },
      400,
    );
  }

  // Locate the original media to find its position + alt text.
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

  // Decode the rendered data URL.
  let rendered;
  try {
    rendered = await downloadRenderedImage(renderedDataUrl);
  } catch (err) {
    return json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to decode rendered image",
      },
      400,
    );
  }

  // Stage upload + attach as new media.
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

  // Move into original's slot.
  try {
    await reorderMediaToIndex(admin, productId, uploaded.mediaId, originalIndex);
  } catch (err) {
    console.warn(
      "[Emilia] reorder failed:",
      err instanceof Error ? err.message : err,
    );
  }

  // Delete the original.
  try {
    await deleteProductMedia(admin, productId, [mediaId]);
  } catch (err) {
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
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
