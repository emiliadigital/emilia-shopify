import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  InlineStack,
  Layout,
  Page,
  Text,
  Thumbnail,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect } from "react";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/emilia-settings.server";

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  media: {
    nodes: {
      id: string;
      status: string;
      image?: { url: string; altText?: string | null };
    }[];
  };
}

const PRODUCTS_QUERY = `#graphql
  query EmiliaProducts {
    products(first: 25, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        media(first: 10) {
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
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  if (!settings.apiKey) {
    return { needsSetup: true as const, products: [], settings };
  }

  const response = await admin.graphql(PRODUCTS_QUERY);
  const body = (await response.json()) as {
    data: { products: { nodes: ProductNode[] } };
  };

  return {
    needsSetup: false as const,
    products: body.data.products.nodes,
    settings: {
      defaultStyle: settings.defaultStyle,
      defaultPresenter: settings.defaultPresenter,
      defaultAspectRatio: settings.defaultAspectRatio,
      defaultResolution: settings.defaultResolution,
      hasConfig: !!settings.config,
    },
  };
};

export default function Index() {
  const navigate = useNavigate();
  return (
    <Page>
      <TitleBar title="Emilia AI Studio">
        <button onClick={() => navigate("/app/settings")}>Settings</button>
      </TitleBar>
      <Body />
    </Page>
  );
}

function Body() {
  const data = useLoaderData<typeof loader>();

  if (data.needsSetup) {
    return (
      <Layout>
        <Layout.Section>
          <Card>
            <EmptyState
              heading="Connect your Emilia AI Studio account"
              action={{ content: "Open settings", url: "/app/settings" }}
              image=""
            >
              <p>
                Paste your <code>eak_…</code> API key to start enhancing product
                images.
              </p>
            </EmptyState>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }

  return (
    <Layout>
      <Layout.Section>
        <BlockStack gap="400">
          {!data.settings.hasConfig && (
            <Banner tone="warning" title="Styles & presenters not synced">
              <p>
                Open <Link to="/app/settings">settings</Link> and click "Sync
                styles & presenters" to fetch the latest catalogue.
              </p>
            </Banner>
          )}
          {data.products.length === 0 ? (
            <Card>
              <EmptyState
                heading="No products yet"
                action={{
                  content: "Create a product",
                  url: "shopify:admin/products/new",
                }}
                image=""
              >
                <p>Create a product with images, then come back to enhance them.</p>
              </EmptyState>
            </Card>
          ) : (
            data.products.map((p) => (
              <ProductRow
                key={p.id}
                product={p}
                defaults={data.settings}
              />
            ))
          )}
        </BlockStack>
      </Layout.Section>
    </Layout>
  );
}

function ProductRow({
  product,
  defaults,
}: {
  product: ProductNode;
  defaults: {
    defaultStyle: string;
    defaultPresenter: string | null;
    defaultAspectRatio: string;
    defaultResolution: string;
  };
}) {
  const images = product.media.nodes.filter(
    (n) => n.image?.url && n.status === "READY",
  );

  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h3" variant="headingMd">
            {product.title}
          </Text>
          <Button
            url={`shopify:admin/products/${product.id.replace(
              "gid://shopify/Product/",
              "",
            )}`}
            target="_blank"
            variant="plain"
          >
            View in admin
          </Button>
        </InlineStack>
        {images.length === 0 ? (
          <Text as="p" tone="subdued">
            No images on this product.
          </Text>
        ) : (
          <InlineStack gap="300" wrap>
            {images.map((media) => (
              <ImageTile
                key={media.id}
                productId={product.id}
                mediaId={media.id}
                imageUrl={media.image!.url}
                altText={media.image?.altText ?? null}
                defaults={defaults}
              />
            ))}
          </InlineStack>
        )}
      </BlockStack>
    </Card>
  );
}

function ImageTile({
  productId,
  mediaId,
  imageUrl,
  altText,
  defaults,
}: {
  productId: string;
  mediaId: string;
  imageUrl: string;
  altText: string | null;
  defaults: {
    defaultStyle: string;
    defaultPresenter: string | null;
    defaultAspectRatio: string;
    defaultResolution: string;
  };
}) {
  const fetcher = useFetcher<{
    ok: boolean;
    error?: string;
    newImageUrl?: string;
    newMediaId?: string;
  }>();
  const shopify = useAppBridge();
  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Image replaced");
    } else if (fetcher.state === "idle" && fetcher.data && !fetcher.data.ok) {
      shopify.toast.show(fetcher.data.error ?? "Generation failed", {
        isError: true,
      });
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const displayUrl = fetcher.data?.ok && fetcher.data.newImageUrl
    ? fetcher.data.newImageUrl
    : imageUrl;

  return (
    <Box width="220px">
      <BlockStack gap="200">
        <Thumbnail source={displayUrl} alt={altText ?? "Product image"} size="large" />
        <Button
          loading={isBusy}
          disabled={isBusy}
          variant="primary"
          onClick={() =>
            fetcher.submit(
              {
                productId,
                mediaId,
                style: defaults.defaultStyle,
                aspect: defaults.defaultAspectRatio,
                resolution: defaults.defaultResolution,
                presenterId: defaults.defaultPresenter ?? "",
              },
              { method: "POST", action: "/api/enhance" },
            )
          }
        >
          {isBusy ? "Enhancing…" : "Enhance"}
        </Button>
        {fetcher.data?.ok && fetcher.data.newMediaId && (
          <Badge tone="success">Replaced</Badge>
        )}
      </BlockStack>
    </Box>
  );
}
