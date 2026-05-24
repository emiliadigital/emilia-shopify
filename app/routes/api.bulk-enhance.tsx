// POST /api/bulk-enhance — takes a list of productIds and runs the full
// render+replace pipeline against the FEATURED image of each one, using
// the merchant's saved defaults. Returns a summary { processed, failed }.
//
// This is intentionally a synchronous in-process loop for v1. For very
// large batches a job queue (e.g. Render's Cron Jobs, Cloudflare Queues,
// or BullMQ) would be the proper next step.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

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

const PRODUCT_QUERY = `#graphql
  query EmiliaBulkProduct($id: ID!) {
    product(id: $id) {
      id
      title
      featuredMedia {
        id
        mediaContentType
        status
        ... on MediaImage {
          image { url altText }
        }
      }
      media(first: 50) {
        nodes { id }
      }
    }
  }
`;

export const loader = async (_: LoaderFunctionArgs) => {
  return new Response("Method Not Allowed", { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  if (!settings.apiKey) {
    return json({ ok: false, error: "Emilia API key not configured" }, 400);
  }

  const formData = await request.formData();
  const productIds = formData.getAll("productIds").map(String).filter(Boolean);

  if (productIds.length === 0) {
    return json({ ok: false, error: "No products selected" }, 400);
  }

  let processed = 0;
  let failed = 0;
  const errors: { productId: string; message: string }[] = [];

  for (const productId of productIds) {
    try {
      const ok = await enhanceOneProduct(
        admin,
        productId,
        settings.apiKey,
        {
          style: settings.defaultStyle,
          aspect: settings.defaultAspectRatio,
          resolution: settings.defaultResolution,
          presenter: settings.defaultPresenter,
          backdropColor: settings.backdropColor,
          helpers: settings.helpers,
        },
      );
      if (ok) processed++;
      else failed++;
    } catch (err) {
      failed++;
      errors.push({
        productId,
        message: err instanceof Error ? err.message : String(err),
      });
      console.warn("[Emilia] bulk-enhance failed for", productId, err);
    }
  }

  return json({ ok: true, processed, failed, errors });
};

async function enhanceOneProduct(
  admin: Parameters<typeof authenticate.admin>[0] extends Request
    ? Awaited<ReturnType<typeof authenticate.admin>>["admin"]
    : never,
  productId: string,
  apiKey: string,
  defaults: {
    style: string;
    aspect: string;
    resolution: string;
    presenter: string | null;
    backdropColor: string;
    helpers: Record<string, string>;
  },
): Promise<boolean> {
  // 1. Get the featured media (the "main" product image).
  const res = await admin.graphql(PRODUCT_QUERY, {
    variables: { id: productId },
  });
  const body = (await res.json()) as {
    data: {
      product: {
        id: string;
        title: string;
        featuredMedia?: {
          id: string;
          image?: { url: string; altText: string | null };
        };
        media: { nodes: { id: string }[] };
      } | null;
    };
  };

  const product = body.data.product;
  if (!product?.featuredMedia?.image?.url) {
    throw new Error("No featured image on product");
  }
  const mediaId = product.featuredMedia.id;
  const originalUrl = product.featuredMedia.image.url;
  const altText = product.featuredMedia.image.altText ?? undefined;
  const originalIndex = product.media.nodes.findIndex((n) => n.id === mediaId);

  // 2. Download original + send to Emilia.
  const dataUrl = await imageUrlToDataUrl(originalUrl);
  const renderResponse = await renderImage(apiKey, {
    imageDataUrl: dataUrl,
    preset: defaults.style,
    mode: "product",
    aspect: defaults.aspect,
    resolution: defaults.resolution,
    presenterId: defaults.presenter || undefined,
    bgColor:
      defaults.style === "color_backdrop" || defaults.style === "studio_gradient"
        ? defaults.backdropColor
        : undefined,
    helpers: defaults.helpers,
  });
  if (!renderResponse.data_url) {
    throw new EmiliaApiError("Emilia API did not return an image", 502, null);
  }

  // 3. Decode + upload + reorder + delete old.
  const rendered = await downloadRenderedImage(renderResponse.data_url);
  const filename = `emilia-${Date.now()}.${rendered.extension}`;
  const uploaded = await uploadAndAttachImage(
    admin,
    productId,
    rendered.buffer,
    rendered.mimeType,
    filename,
    altText,
  );

  if (originalIndex >= 0) {
    try {
      await reorderMediaToIndex(admin, productId, uploaded.mediaId, originalIndex);
    } catch {
      /* non-fatal */
    }
  }
  try {
    await deleteProductMedia(admin, productId, [mediaId]);
  } catch {
    /* non-fatal */
  }
  return true;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
