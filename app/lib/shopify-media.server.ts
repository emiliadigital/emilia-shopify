// Shopify product-media helpers for the enhance-and-replace flow.
//
// Shopify Files/Media objects are immutable — you cannot overwrite the binary
// of an existing image. To "replace" an image we:
//   1. Stage an upload slot via stagedUploadsCreate
//   2. POST the new bytes to that slot
//   3. Attach it to the product via productCreateMedia (async — must poll
//      until status: READY)
//   4. Move the new media into the old image's position via productReorderMedia
//   5. Delete the old media via productDeleteMedia
//
// The new image will have a different media ID than the original — that's a
// fundamental Shopify constraint that callers must surface to merchants.

import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface UploadedMedia {
  mediaId: string;
  imageUrl: string | null;
}

interface StagedTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

const STAGED_UPLOAD_MUTATION = `#graphql
  mutation EmiliaStagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters { name value }
      }
      userErrors { field message }
    }
  }
`;

const PRODUCT_CREATE_MEDIA = `#graphql
  mutation EmiliaProductCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media {
        id
        mediaContentType
        status
        ... on MediaImage {
          image { url altText }
        }
      }
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_MEDIA_QUERY = `#graphql
  query EmiliaProductMedia($id: ID!) {
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

const PRODUCT_REORDER_MEDIA = `#graphql
  mutation EmiliaProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
    productReorderMedia(id: $id, moves: $moves) {
      job { id done }
      mediaUserErrors { field message }
    }
  }
`;

const PRODUCT_DELETE_MEDIA = `#graphql
  mutation EmiliaProductDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
    productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
      deletedMediaIds
      mediaUserErrors { field message }
    }
  }
`;

async function gql<T>(
  admin: AdminApiContext,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as { data?: T; errors?: unknown[] };
  if (body.errors?.length) {
    throw new Error(
      `Shopify GraphQL error: ${JSON.stringify(body.errors)}`,
    );
  }
  if (!body.data) {
    throw new Error("Shopify GraphQL returned no data");
  }
  return body.data;
}

// Upload bytes to Shopify and attach them as a new media object on the
// product. Returns the new media ID and image URL once it's READY.
export async function uploadAndAttachImage(
  admin: AdminApiContext,
  productId: string,
  buffer: Buffer,
  mimeType: string,
  filename: string,
  altText?: string,
): Promise<UploadedMedia> {
  // 1. Reserve a staged upload slot
  const staged = await gql<{
    stagedUploadsCreate: {
      stagedTargets: StagedTarget[];
      userErrors: { field: string; message: string }[];
    };
  }>(admin, STAGED_UPLOAD_MUTATION, {
    input: [
      {
        resource: "IMAGE",
        filename,
        mimeType,
        httpMethod: "POST",
        fileSize: String(buffer.byteLength),
      },
    ],
  });

  if (staged.stagedUploadsCreate.userErrors.length) {
    throw new Error(
      `stagedUploadsCreate: ${staged.stagedUploadsCreate.userErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }

  const target = staged.stagedUploadsCreate.stagedTargets[0];
  if (!target) throw new Error("No staged upload target returned");

  // 2. POST the bytes to the staged target as multipart/form-data.
  // Order matters — Google Cloud Storage requires the parameters to come
  // first, then the `file` field last.
  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  // Build a Blob from the buffer with the right mime type
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  form.append("file", blob, filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: form });
  if (!uploadRes.ok && uploadRes.status !== 201) {
    const text = await uploadRes.text().catch(() => "");
    throw new Error(
      `Staged upload failed: status ${uploadRes.status} ${text.slice(0, 200)}`,
    );
  }

  // 3. Attach the staged resource to the product
  const created = await gql<{
    productCreateMedia: {
      media: {
        id: string;
        status: string;
        image?: { url: string };
      }[];
      mediaUserErrors: { field: string; message: string }[];
    };
  }>(admin, PRODUCT_CREATE_MEDIA, {
    productId,
    media: [
      {
        originalSource: target.resourceUrl,
        mediaContentType: "IMAGE",
        alt: altText ?? null,
      },
    ],
  });

  if (created.productCreateMedia.mediaUserErrors.length) {
    throw new Error(
      `productCreateMedia: ${created.productCreateMedia.mediaUserErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }

  const newMedia = created.productCreateMedia.media[0];
  if (!newMedia) throw new Error("productCreateMedia returned no media");

  // 4. Poll until status: READY (Shopify processes media asynchronously)
  const ready = await waitForMediaReady(admin, productId, newMedia.id);

  return { mediaId: ready.id, imageUrl: ready.imageUrl };
}

interface MediaNode {
  id: string;
  status: string;
  image?: { url: string };
}

// Polls up to ~30s for the newly created media to reach READY status.
async function waitForMediaReady(
  admin: AdminApiContext,
  productId: string,
  mediaId: string,
): Promise<{ id: string; imageUrl: string | null }> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const { product } = await gql<{
      product: { media: { nodes: MediaNode[] } };
    }>(admin, PRODUCT_MEDIA_QUERY, { id: productId });

    const node = product.media.nodes.find((n) => n.id === mediaId);
    if (!node) {
      throw new Error("New media disappeared from product");
    }
    if (node.status === "READY") {
      return { id: node.id, imageUrl: node.image?.url ?? null };
    }
    if (node.status === "FAILED") {
      throw new Error("Shopify failed to process the uploaded image");
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  throw new Error("Timed out waiting for new media to become READY");
}

// Move `mediaId` into `targetIndex` (0-based) within the product's media list.
export async function reorderMediaToIndex(
  admin: AdminApiContext,
  productId: string,
  mediaId: string,
  targetIndex: number,
): Promise<void> {
  const result = await gql<{
    productReorderMedia: {
      mediaUserErrors: { field: string; message: string }[];
    };
  }>(admin, PRODUCT_REORDER_MEDIA, {
    id: productId,
    moves: [{ id: mediaId, newPosition: String(targetIndex) }],
  });

  if (result.productReorderMedia.mediaUserErrors.length) {
    throw new Error(
      `productReorderMedia: ${result.productReorderMedia.mediaUserErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
}

export async function deleteProductMedia(
  admin: AdminApiContext,
  productId: string,
  mediaIds: string[],
): Promise<void> {
  if (!mediaIds.length) return;
  const result = await gql<{
    productDeleteMedia: {
      deletedMediaIds: string[];
      mediaUserErrors: { field: string; message: string }[];
    };
  }>(admin, PRODUCT_DELETE_MEDIA, { productId, mediaIds });

  if (result.productDeleteMedia.mediaUserErrors.length) {
    throw new Error(
      `productDeleteMedia: ${result.productDeleteMedia.mediaUserErrors
        .map((e) => e.message)
        .join("; ")}`,
    );
  }
}
