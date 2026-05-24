// Bulk-enhance dashboard. Searchable, paginated list of products. Multi-select
// + bulk action that enhances the featured image of every selected product.
// For per-image control, the merchant opens a product in Shopify Admin where
// the Action and Block extensions handle individual enhancement.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  Layout,
  Page,
  Text,
  TextField,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/emilia-settings.server";

interface ProductRow {
  id: string;
  title: string;
  handle: string;
  status: string;
  imageCount: number;
  featuredImage: string | null;
  featuredImageAlt: string | null;
  firstMediaId: string | null;
}

interface LoaderData {
  needsSetup: boolean;
  products: ProductRow[];
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string | null;
    endCursor: string | null;
  };
  search: string;
  cursor: string | null;
  direction: "after" | "before";
  defaults: {
    style: string;
    aspectRatio: string;
    resolution: string;
    presenter: string | null;
  } | null;
}

const PRODUCTS_QUERY_AFTER = `#graphql
  query EmiliaProductsList($search: String, $after: String) {
    products(first: 50, after: $after, query: $search, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        mediaCount { count }
        featuredMedia {
          id
          ... on MediaImage {
            image { url altText }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

const PRODUCTS_QUERY_BEFORE = `#graphql
  query EmiliaProductsListBefore($search: String, $before: String) {
    products(last: 50, before: $before, query: $search, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        title
        handle
        status
        mediaCount { count }
        featuredMedia {
          id
          ... on MediaImage {
            image { url altText }
          }
        }
      }
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  if (!settings.apiKey) {
    return {
      needsSetup: true,
      products: [],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: null,
        endCursor: null,
      },
      search: "",
      cursor: null,
      direction: "after" as const,
      defaults: null,
    } satisfies LoaderData;
  }

  const url = new URL(request.url);
  const search = url.searchParams.get("q") ?? "";
  const cursor = url.searchParams.get("cursor");
  const direction = (url.searchParams.get("dir") ?? "after") === "before"
    ? "before"
    : "after";

  const query = direction === "before" ? PRODUCTS_QUERY_BEFORE : PRODUCTS_QUERY_AFTER;
  const variables: Record<string, string | null | undefined> = {
    search: search || undefined,
  };
  variables[direction] = cursor || undefined;

  const response = await admin.graphql(query, { variables });
  const body = (await response.json()) as {
    data: {
      products: {
        nodes: Array<{
          id: string;
          title: string;
          handle: string;
          status: string;
          mediaCount?: { count: number };
          featuredMedia?: {
            id: string;
            image?: { url: string; altText: string | null };
          };
        }>;
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
      };
    };
  };

  const products: ProductRow[] = body.data.products.nodes.map((n) => ({
    id: n.id,
    title: n.title,
    handle: n.handle,
    status: n.status,
    imageCount: n.mediaCount?.count ?? 0,
    featuredImage: n.featuredMedia?.image?.url ?? null,
    featuredImageAlt: n.featuredMedia?.image?.altText ?? null,
    firstMediaId: n.featuredMedia?.id ?? null,
  }));

  return {
    needsSetup: false,
    products,
    pageInfo: body.data.products.pageInfo,
    search,
    cursor,
    direction,
    defaults: {
      style: settings.defaultStyle,
      aspectRatio: settings.defaultAspectRatio,
      resolution: settings.defaultResolution,
      presenter: settings.defaultPresenter,
    },
  } satisfies LoaderData;
};

export default function ProductsDashboard() {
  return (
    <Page>
      <TitleBar title="Emilia AI Studio — Products" />
      <Body />
    </Page>
  );
}

function Body() {
  const data = useLoaderData<typeof loader>() as LoaderData;
  const navigate = useNavigate();

  if (data.needsSetup) {
    return (
      <Layout>
        <Layout.Section>
          <Card>
            <Box padding="800">
              <BlockStack gap="500" inlineAlign="center">
                <img
                  src="/emilia-logo.png"
                  alt="Emilia AI Studio"
                  style={{ width: 96, height: 96, borderRadius: 16 }}
                />
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="h2" variant="headingLg" alignment="center">
                    Connect your Emilia AI Studio account
                  </Text>
                  <Text as="p" tone="subdued" alignment="center">
                    Paste your <code>eak_…</code> API key in Settings to start
                    enhancing product images.
                  </Text>
                </BlockStack>
                <Button variant="primary" url="/app/settings">
                  Open settings
                </Button>
              </BlockStack>
            </Box>
          </Card>
        </Layout.Section>
      </Layout>
    );
  }

  return (
    <Layout>
      <Layout.Section>
        <ProductsList data={data} navigate={navigate} />
      </Layout.Section>
    </Layout>
  );
}

function ProductsList({
  data,
  navigate,
}: {
  data: LoaderData;
  navigate: (to: string) => void;
}) {
  const [searchValue, setSearchValue] = useState(data.search);
  const shopify = useAppBridge();

  // Reset the search field when the loader's value changes (after navigation).
  useEffect(() => {
    setSearchValue(data.search);
  }, [data.search]);

  const handleSearchSubmit = () => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    navigate(`/app?${params.toString()}`);
  };

  const resourceName = { singular: "product", plural: "products" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(
      data.products.map((p) => ({ id: p.id })) as { id: string }[],
    );

  const bulkFetcher = useFetcher<{
    ok: boolean;
    processed?: number;
    failed?: number;
    error?: string;
  }>();
  const bulkBusy = bulkFetcher.state !== "idle";

  useEffect(() => {
    if (bulkFetcher.state === "idle" && bulkFetcher.data) {
      if (bulkFetcher.data.ok) {
        shopify.toast.show(
          `Enhanced ${bulkFetcher.data.processed ?? 0} products` +
            (bulkFetcher.data.failed
              ? ` (${bulkFetcher.data.failed} failed)`
              : ""),
        );
      } else {
        shopify.toast.show(bulkFetcher.data.error ?? "Bulk enhance failed", {
          isError: true,
        });
      }
    }
  }, [bulkFetcher.state, bulkFetcher.data, shopify]);

  const handleBulkEnhance = () => {
    if (selectedResources.length === 0) return;
    const formData = new FormData();
    selectedResources.forEach((id) => formData.append("productIds", id));
    bulkFetcher.submit(formData, { method: "POST", action: "/api/bulk-enhance" });
  };

  const promotedBulkActions = [
    {
      content: bulkBusy
        ? `Enhancing ${selectedResources.length}…`
        : `Enhance ${selectedResources.length} ${selectedResources.length === 1 ? "product" : "products"}`,
      onAction: handleBulkEnhance,
      disabled: bulkBusy,
    },
  ];

  const rows = data.products.map((p, index) => {
    const productNumericId = p.id.replace("gid://shopify/Product/", "");
    return (
      <IndexTable.Row
        id={p.id}
        key={p.id}
        position={index}
        selected={selectedResources.includes(p.id)}
      >
        <IndexTable.Cell>
          <Thumbnail
            source={p.featuredImage ?? ""}
            alt={p.featuredImageAlt ?? p.title}
            size="small"
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {p.title}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued">
            {p.imageCount} {p.imageCount === 1 ? "image" : "images"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {p.status === "ACTIVE" ? (
            <Badge tone="success">Active</Badge>
          ) : (
            <Badge>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Button
            variant="plain"
            url={`shopify:admin/products/${productNumericId}`}
            target="_top"
          >
            Open in admin
          </Button>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  const handleNext = () => {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (data.pageInfo.endCursor) {
      params.set("cursor", data.pageInfo.endCursor);
      params.set("dir", "after");
    }
    navigate(`/app?${params.toString()}`);
  };

  const handlePrev = () => {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (data.pageInfo.startCursor) {
      params.set("cursor", data.pageInfo.startCursor);
      params.set("dir", "before");
    }
    navigate(`/app?${params.toString()}`);
  };

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <Box paddingBlockEnd="200">
            <TextField
              label=""
              labelHidden
              placeholder="Search products by title…"
              value={searchValue}
              onChange={setSearchValue}
              onBlur={handleSearchSubmit}
              autoComplete="off"
              clearButton
              onClearButtonClick={() => {
                setSearchValue("");
                navigate("/app");
              }}
            />
          </Box>

          {data.products.length === 0 ? (
            <EmptyState
              heading={data.search ? "No matches" : "No products yet"}
              image="/emilia-logo.png"
              action={
                data.search
                  ? {
                      content: "Clear search",
                      onAction: () => navigate("/app"),
                    }
                  : {
                      content: "Add a product",
                      url: "shopify:admin/products/new",
                    }
              }
            >
              <p>
                {data.search
                  ? `No products match "${data.search}".`
                  : "Create products with images and come back to enhance them."}
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={data.products.length}
              selectedItemsCount={
                allResourcesSelected ? "All" : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={promotedBulkActions}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Images" },
                { title: "Status" },
                { title: "" },
              ]}
              pagination={{
                hasNext: data.pageInfo.hasNextPage,
                hasPrevious: data.pageInfo.hasPreviousPage,
                onNext: handleNext,
                onPrevious: handlePrev,
              }}
            >
              {rows}
            </IndexTable>
          )}
        </BlockStack>
      </Card>

      {bulkBusy && (
        <Banner tone="info" title="Bulk enhance running">
          <p>
            Enhancing the featured image of each selected product. This usually
            takes 30–60 seconds per product. Keep this tab open.
          </p>
        </Banner>
      )}
    </BlockStack>
  );
}
