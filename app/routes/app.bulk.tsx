// Bulk Enhancement dashboard. Searchable, paginated product list. Multi-select
// + a configuration modal (style picker / helpers / aspect / resolution),
// then a client-side sequential loop that enhances the featured image of
// each selected product so the merchant sees live "Enhancing N of M…" progress.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  EmptyState,
  IndexTable,
  InlineStack,
  Layout,
  Modal,
  Page,
  ProgressBar,
  Select,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  useIndexResourceState,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useMemo, useState } from "react";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/emilia-settings.server";
import type {
  EmiliaConfig,
  EmiliaHelper,
  EmiliaStyle,
} from "../lib/emilia.server";

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
  defaults: {
    style: string;
    aspectRatio: string;
    resolution: string;
    presenter: string | null;
    helpers: Record<string, string>;
    backdropColor: string;
  } | null;
  config: EmiliaConfig | null;
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
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
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
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
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
      defaults: null,
      config: null,
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
    defaults: {
      style: settings.defaultStyle,
      aspectRatio: settings.defaultAspectRatio,
      resolution: settings.defaultResolution,
      presenter: settings.defaultPresenter,
      helpers: settings.helpers,
      backdropColor: settings.backdropColor,
    },
    config: settings.config,
  } satisfies LoaderData;
};

export default function BulkEnhancementPage() {
  return (
    <Page>
      <TitleBar title="Bulk Enhancement" />
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

interface BulkProgress {
  total: number;
  current: number;
  done: number;
  failed: number;
  errors: { productId: string; title: string; message: string }[];
  finished: boolean;
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

  useEffect(() => {
    setSearchValue(data.search);
  }, [data.search]);

  const handleSearchSubmit = () => {
    const params = new URLSearchParams();
    if (searchValue) params.set("q", searchValue);
    navigate(`/app/bulk?${params.toString()}`);
  };

  const resourceName = { singular: "product", plural: "products" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(
      data.products.map((p) => ({ id: p.id })) as { id: string }[],
    );

  const [configOpen, setConfigOpen] = useState(false);
  const [progress, setProgress] = useState<BulkProgress | null>(null);

  const openConfig = () => {
    if (selectedResources.length === 0) return;
    setConfigOpen(true);
  };

  // Run the enhance loop sequentially over the selected product IDs.
  // Each product's featured image is enhanced via /api/enhance with the
  // chosen settings. Progress state updates after each iteration.
  const runBulkEnhance = async (overrides: {
    style: string;
    aspect: string;
    resolution: string;
    presenter: string;
    helpers: Record<string, string>;
  }) => {
    const ids = [...selectedResources];
    const idToTitle = new Map(data.products.map((p) => [p.id, p.title]));
    setProgress({
      total: ids.length,
      current: 0,
      done: 0,
      failed: 0,
      errors: [],
      finished: false,
    });
    setConfigOpen(false);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      setProgress((prev) =>
        prev ? { ...prev, current: i + 1 } : prev,
      );

      try {
        const formData = new FormData();
        formData.append("productId", id);
        // Use the FEATURED media ID — backend will look it up if mediaId
        // matches the featured image. The backend's /api/enhance expects
        // both productId and mediaId so we pass null and let it fall back.
        const product = data.products.find((p) => p.id === id);
        if (!product?.firstMediaId) throw new Error("No featured image");
        formData.append("mediaId", product.firstMediaId);
        formData.append("style", overrides.style);
        formData.append("aspect", overrides.aspect);
        formData.append("resolution", overrides.resolution);
        if (overrides.presenter) {
          formData.append("presenterId", overrides.presenter);
        }
        for (const [k, v] of Object.entries(overrides.helpers)) {
          if (v) formData.append(k, v);
        }

        const res = await fetch("/api/enhance", {
          method: "POST",
          body: formData,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          setProgress((prev) =>
            prev
              ? {
                  ...prev,
                  failed: prev.failed + 1,
                  errors: [
                    ...prev.errors,
                    {
                      productId: id,
                      title: idToTitle.get(id) ?? id,
                      message: json?.error || `HTTP ${res.status}`,
                    },
                  ],
                }
              : prev,
          );
        } else {
          setProgress((prev) =>
            prev ? { ...prev, done: prev.done + 1 } : prev,
          );
        }
      } catch (err) {
        setProgress((prev) =>
          prev
            ? {
                ...prev,
                failed: prev.failed + 1,
                errors: [
                  ...prev.errors,
                  {
                    productId: id,
                    title: idToTitle.get(id) ?? id,
                    message: err instanceof Error ? err.message : String(err),
                  },
                ],
              }
            : prev,
        );
      }
    }

    setProgress((prev) => (prev ? { ...prev, finished: true } : prev));
    shopify.toast.show(
      `Enhanced ${ids.length} products. Failed: ${(progress?.failed ?? 0)}`,
    );
  };

  const promotedBulkActions = [
    {
      content: `Enhance ${selectedResources.length} ${selectedResources.length === 1 ? "product" : "products"}`,
      onAction: openConfig,
      disabled: !!progress && !progress.finished,
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
    navigate(`/app/bulk?${params.toString()}`);
  };

  const handlePrev = () => {
    const params = new URLSearchParams();
    if (data.search) params.set("q", data.search);
    if (data.pageInfo.startCursor) {
      params.set("cursor", data.pageInfo.startCursor);
      params.set("dir", "before");
    }
    navigate(`/app/bulk?${params.toString()}`);
  };

  return (
    <BlockStack gap="400">
      {progress && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingMd">
                {progress.finished
                  ? "Bulk enhancement complete"
                  : `Enhancing ${progress.current} of ${progress.total}…`}
              </Text>
              {progress.finished && (
                <Button onClick={() => setProgress(null)}>Dismiss</Button>
              )}
            </InlineStack>
            <ProgressBar
              progress={
                progress.total === 0
                  ? 0
                  : ((progress.done + progress.failed) / progress.total) * 100
              }
            />
            <InlineStack gap="400">
              <Text as="span" tone="success">
                ✓ {progress.done} done
              </Text>
              {progress.failed > 0 && (
                <Text as="span" tone="critical">
                  ✗ {progress.failed} failed
                </Text>
              )}
            </InlineStack>
            {progress.finished && progress.errors.length > 0 && (
              <Banner tone="warning" title="Some products failed">
                <BlockStack gap="100">
                  {progress.errors.slice(0, 10).map((e) => (
                    <Text key={e.productId} as="p" variant="bodySm">
                      • {e.title}: {e.message}
                    </Text>
                  ))}
                </BlockStack>
              </Banner>
            )}
            {!progress.finished && (
              <Text as="p" tone="subdued" variant="bodySm">
                Keep this tab open. Each product takes 30–60 seconds.
              </Text>
            )}
          </BlockStack>
        </Card>
      )}

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
                navigate("/app/bulk");
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

      {configOpen && data.config && data.defaults && (
        <BulkConfigModal
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          config={data.config}
          defaults={data.defaults}
          selectedCount={selectedResources.length}
          onStart={runBulkEnhance}
        />
      )}
    </BlockStack>
  );
}

// ---------------------------------------------------------------------------
// Config modal — mirrors the action extension's picker (tabs of styles +
// cards + dynamic helpers + aspect + resolution + presenter), but using
// Polaris components since we're inside the embedded app.
// ---------------------------------------------------------------------------

const REFERENCE_STYLE_IDS = new Set([
  "reference",
  "reference_food",
  "reference_jewelry",
  "reference_clothing",
  "reference_furniture",
  "reference_cosmetics",
]);

function BulkConfigModal({
  open,
  onClose,
  config,
  defaults,
  selectedCount,
  onStart,
}: {
  open: boolean;
  onClose: () => void;
  config: EmiliaConfig;
  defaults: {
    style: string;
    aspectRatio: string;
    resolution: string;
    presenter: string | null;
    helpers: Record<string, string>;
    backdropColor: string;
  };
  selectedCount: number;
  onStart: (overrides: {
    style: string;
    aspect: string;
    resolution: string;
    presenter: string;
    helpers: Record<string, string>;
  }) => void;
}) {
  const [style, setStyle] = useState(defaults.style);
  const [aspect, setAspect] = useState(defaults.aspectRatio);
  const [resolution, setResolution] = useState(defaults.resolution);
  const [presenter, setPresenter] = useState(defaults.presenter ?? "");
  const [helperValues, setHelperValues] = useState<Record<string, string>>(
    defaults.helpers,
  );

  // Group styles by mode and figure out which tab is active.
  const stylesByMode = useMemo(() => {
    const grouped: Record<string, EmiliaStyle[]> = {};
    for (const s of config.styles ?? []) {
      if (REFERENCE_STYLE_IDS.has(s.id)) continue;
      const m = s.mode ?? "product";
      if (!grouped[m]) grouped[m] = [];
      grouped[m].push(s);
    }
    return grouped;
  }, [config.styles]);

  const modeKeys = Object.keys(stylesByMode);
  const initialMode =
    (config.styles ?? []).find((s) => s.id === style)?.mode ??
    modeKeys[0] ??
    "product";
  const [activeMode, setActiveMode] = useState(initialMode);

  const selectedStyleObj = (config.styles ?? []).find((s) => s.id === style);
  const effectiveMode = selectedStyleObj?.mode ?? activeMode;

  // Compute applicable helpers for the currently selected style.
  const applicableHelpers: EmiliaHelper[] = useMemo(() => {
    const modeHelpers = config.helpers?.[effectiveMode] ?? [];
    return modeHelpers.filter((h) => {
      if (!h.name) return false;
      let helperStyles = h.styles;
      if (typeof helperStyles === "string") {
        helperStyles = (helperStyles as string)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      if (!Array.isArray(helperStyles) || helperStyles.length === 0) return true;
      return helperStyles.includes(style);
    });
  }, [config.helpers, effectiveMode, style]);

  const aspectOptions = Object.entries(config.aspect_ratios ?? {}).map(
    ([k, v]) => ({
      label: `${v.title} — ${v.description}`,
      value: k,
    }),
  );
  const resolutionOptions = Object.entries(config.resolutions ?? {}).map(
    ([k, v]) => ({
      label: `${v.title} (${v.pixels})${v.credits ? ` — ${v.credits} credits` : ""}`,
      value: k,
    }),
  );
  const presenterOptions = [
    { label: "— None —", value: "" },
    ...((config.presenters ?? []).map((p) => ({
      label: p.name,
      value: String(p.id),
    }))),
  ];
  const showPresenter =
    (config.presenters?.length ?? 0) > 0 && !!selectedStyleObj?.has_presenter;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Enhance ${selectedCount} ${selectedCount === 1 ? "product" : "products"}`}
      primaryAction={{
        content: "Start enhancement",
        onAction: () =>
          onStart({
            style,
            aspect,
            resolution,
            presenter: presenter && presenter !== "" ? presenter : "",
            helpers: helperValues,
          }),
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
      size="large"
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text as="p" tone="subdued">
            These settings apply to the featured image of each selected
            product. You can adjust per-product via the Enhance button on
            individual product pages.
          </Text>

          {/* Style tabs */}
          {modeKeys.length > 0 && (
            <Tabs
              tabs={modeKeys.map((mode) => ({
                id: `tab-${mode}`,
                content:
                  (config.modes?.[mode]?.title) ??
                  mode.charAt(0).toUpperCase() + mode.slice(1),
                panelID: `panel-${mode}`,
              }))}
              selected={Math.max(0, modeKeys.indexOf(activeMode))}
              onSelect={(idx) => setActiveMode(modeKeys[idx])}
              fitted
            />
          )}

          {/* Card grid for the active tab */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
              gap: 12,
            }}
          >
            {(stylesByMode[activeMode] ?? []).map((s) => {
              const isSelected = style === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStyle(s.id)}
                  style={{
                    padding: 8,
                    border: isSelected
                      ? "2px solid #2c6ecb"
                      : "1px solid #e1e3e5",
                    borderRadius: 12,
                    background: isSelected ? "#f3f8ff" : "white",
                    cursor: "pointer",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1",
                      borderRadius: 8,
                      overflow: "hidden",
                      background: "#f6f6f7",
                      marginBottom: 8,
                    }}
                  >
                    {s.thumbnail && (
                      <img
                        src={s.thumbnail}
                        alt={s.name}
                        loading="lazy"
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    )}
                  </div>
                  <Text
                    as="span"
                    variant="bodySm"
                    fontWeight={isSelected ? "bold" : "regular"}
                  >
                    {s.name}
                  </Text>
                </button>
              );
            })}
          </div>

          {/* Dynamic helpers */}
          {applicableHelpers.map((helper) => {
            const value = helperValues[helper.name] ?? helper.default ?? "";
            const setValue = (v: string) =>
              setHelperValues((prev) => ({ ...prev, [helper.name]: v }));

            if (helper.type === "color") {
              return (
                <div key={helper.name}>
                  <Text as="p" variant="bodySm" tone="subdued">
                    {helper.label || helper.name}
                  </Text>
                  <input
                    type="color"
                    value={value || "#FFFFFF"}
                    onChange={(e) => setValue(e.currentTarget.value)}
                    style={{
                      width: 60,
                      height: 36,
                      border: "1px solid #c9cccf",
                      borderRadius: 6,
                      cursor: "pointer",
                      padding: 2,
                      background: "white",
                    }}
                  />
                </div>
              );
            }

            const opts = Object.entries(helper.options || {}).map(
              ([k, label]) => ({ label, value: k }),
            );
            return (
              <Select
                key={helper.name}
                label={helper.label || helper.name}
                options={opts}
                value={value}
                onChange={setValue}
              />
            );
          })}

          {showPresenter && (
            <Select
              label="Presenter"
              options={presenterOptions}
              value={presenter}
              onChange={setPresenter}
            />
          )}

          <Select
            label="Aspect ratio"
            options={aspectOptions}
            value={aspect}
            onChange={setAspect}
          />
          <Select
            label="Resolution"
            options={resolutionOptions}
            value={resolution}
            onChange={setResolution}
          />
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
