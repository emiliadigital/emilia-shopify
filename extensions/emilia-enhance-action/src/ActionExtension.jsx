// "Enhance with Emilia AI" admin action — modal on product detail pages.
//
// Flow:
//   1. Fetch the product's images (Shopify Admin GraphQL) + the merchant's
//      Emilia config (our backend) in parallel.
//   2. Merchant multi-selects images via thumbnail tiles.
//   3. Style / aspect / resolution / presenter selects are pre-filled with
//      the merchant's saved defaults — they can override any of them.
//   4. On Enhance: iterates selected images sequentially, calling /api/enhance
//      for each. Shows per-image status and an overall result line.

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Backend URL — same host the embedded app is served from.
const BACKEND_URL = "https://shopify.emilia.digital";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data?.selected?.[0]?.id;

  const [product, setProduct] = useState(null);
  const [config, setConfig] = useState(null);
  const [loadError, setLoadError] = useState(null);

  // Multi-select: Set of media IDs
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // Setting overrides — empty = use saved default
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [resolution, setResolution] = useState("");
  const [presenter, setPresenter] = useState("");

  // Helper overrides — keyed by helper name (e.g. shadow, angle, bg_color).
  // The set of visible helpers depends on the currently selected style.
  const [helperValues, setHelperValues] = useState({});

  // Active category tab.
  const [activeMode, setActiveMode] = useState(null);

  // Flow phase: 'select' (pick image + options) → 'rendering' (loading
  // overlay while Emilia generates) → 'review' (show before/after, user
  // confirms each replace).
  const [phase, setPhase] = useState("select");

  // Per-media render result during 'review' phase.
  // { [mediaId]: { renderedDataUrl, originalUrl, error? } }
  const [renderResults, setRenderResults] = useState({});

  // Per-media replace status during 'review'.
  // { [mediaId]: { state: 'idle'|'busy'|'done'|'error', newImageUrl?, error? } }
  const [replaceStatus, setReplaceStatus] = useState({});

  // When set, shows a fullscreen image viewer inside the modal.
  // { src: string, label?: string } | null
  const [viewer, setViewer] = useState(null);

  // (no manual spinner state — using the built-in <s-spinner> component now)

  // Load product + config in parallel
  useEffect(() => {
    if (!productId) return;
    (async () => {
      try {
        const productFetch = fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({
            query: `
              query Product($id: ID!) {
                product(id: $id) {
                  title
                  media(first: 20) {
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
            `,
            variables: { id: productId },
          }),
        });

        const token = await shopify.auth.idToken();
        const configFetch = fetch(`${BACKEND_URL}/api/extension-config`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const [productRes, configRes] = await Promise.all([
          productFetch,
          configFetch,
        ]);

        const productJson = await productRes.json();
        const p = productJson?.data?.product;
        if (!p) {
          setLoadError("Product not found.");
          return;
        }
        p.media.nodes = p.media.nodes.filter((n) => n.image?.url);
        setProduct(p);
        // Pre-select the first image so the merchant doesn't have to click
        // before enhancing one. They can deselect by clicking it again.
        if (p.media.nodes[0]) {
          setSelectedIds(new Set([p.media.nodes[0].id]));
        }

        const cfg = await configRes.json();
        setConfig(cfg);
      } catch (err) {
        setLoadError(err?.message || String(err));
      }
    })();
  }, [productId]);

  const toggleSelect = (mediaId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(mediaId)) next.delete(mediaId);
      else next.add(mediaId);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(product.media.nodes.map((n) => n.id)));
  };

  const selectNone = () => {
    setSelectedIds(new Set());
  };

  // Phase 1: render every selected image via /api/render, then move to review.
  const handleRender = async () => {
    if (selectedIds.size === 0) return;
    setPhase("rendering");
    setRenderResults({});
    setReplaceStatus({});

    const token = await shopify.auth.idToken();
    const ids = Array.from(selectedIds);
    const results = {};

    for (const mediaId of ids) {
      const node = product.media.nodes.find((n) => n.id === mediaId);
      const originalUrl = node?.image?.url ?? null;

      try {
        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("mediaId", mediaId);
        if (style) formData.append("style", style);
        if (aspectRatio) formData.append("aspect", aspectRatio);
        if (resolution) formData.append("resolution", resolution);
        if (presenter) formData.append("presenterId", presenter);
        for (const [name, val] of Object.entries(helperValues)) {
          if (val) formData.append(name, val);
        }

        const res = await fetch(`${BACKEND_URL}/api/render`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        let json = null;
        try { json = await res.json(); } catch { json = null; }

        if (!res.ok || !json?.ok) {
          results[mediaId] = {
            originalUrl,
            error: json?.error || `HTTP ${res.status}`,
          };
        } else {
          results[mediaId] = {
            originalUrl,
            renderedDataUrl: json.renderedDataUrl,
          };
        }
      } catch (err) {
        results[mediaId] = {
          originalUrl,
          error: err?.message || String(err),
        };
      }

      // Update state incrementally so the user sees progress.
      setRenderResults({ ...results });
    }

    setPhase("review");
  };

  // Phase 2: commit the render to Shopify.
  // mode: 'replace' deletes the original; 'add' keeps it (just adds to gallery).
  const handleCommit = async (mediaId, mode) => {
    const result = renderResults[mediaId];
    if (!result?.renderedDataUrl) return;

    setReplaceStatus((prev) => ({
      ...prev,
      [mediaId]: { state: "busy", mode },
    }));

    try {
      const token = await shopify.auth.idToken();
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("mediaId", mediaId);
      formData.append("renderedDataUrl", result.renderedDataUrl);
      formData.append("mode", mode); // 'replace' or 'add'

      const res = await fetch(`${BACKEND_URL}/api/replace`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });
      let json = null;
      try { json = await res.json(); } catch { json = null; }

      if (!res.ok || !json?.ok) {
        setReplaceStatus((prev) => ({
          ...prev,
          [mediaId]: {
            state: "error",
            mode,
            error: json?.error || `HTTP ${res.status}`,
          },
        }));
      } else {
        setReplaceStatus((prev) => ({
          ...prev,
          [mediaId]: {
            state: "done",
            mode,
            newImageUrl: json.newImageUrl,
          },
        }));
        // Toast + auto-close so Shopify Admin re-fetches the product's media.
        if (shopify.toast?.show) {
          shopify.toast.show(
            mode === "add"
              ? i18n.translate("added")
              : i18n.translate("replaced"),
          );
        }
        // Give the user a moment to see the success badge before closing.
        setTimeout(() => shopify.close(), 1500);
      }
    } catch (err) {
      setReplaceStatus((prev) => ({
        ...prev,
        [mediaId]: {
          state: "error",
          mode,
          error: err?.message || String(err),
        },
      }));
    }
  };

  // Backward-compat aliases for the JSX call sites.
  const handleReplace = (id) => handleCommit(id, "replace");
  const handleAddToGallery = (id) => handleCommit(id, "add");

  const handleReplaceAll = async () => {
    const ids = Object.keys(renderResults).filter(
      (id) => renderResults[id].renderedDataUrl && replaceStatus[id]?.state !== "done",
    );
    for (const id of ids) {
      await handleReplace(id);
    }
  };

  const handleBackToSelect = () => {
    setPhase("select");
    setRenderResults({});
    setReplaceStatus({});
  };

  if (!productId) {
    return (
      <s-admin-action>
        <s-text>No product selected.</s-text>
        <s-button slot="primary-action" onClick={close}>OK</s-button>
      </s-admin-action>
    );
  }

  if (loadError) {
    return (
      <s-admin-action heading={i18n.translate("heading")}>
        <s-text tone="critical">{loadError}</s-text>
        <s-button slot="primary-action" onClick={close}>Close</s-button>
      </s-admin-action>
    );
  }

  if (!product || !config) {
    return (
      <s-admin-action heading={i18n.translate("heading")}>
        <s-text>Loading…</s-text>
      </s-admin-action>
    );
  }

  if (config.hasApiKey === false) {
    return (
      <s-admin-action heading={i18n.translate("heading")}>
        <s-text>{i18n.translate("missing_key")}</s-text>
        <s-button slot="primary-action" onClick={close}>OK</s-button>
      </s-admin-action>
    );
  }

  const hasImages = product.media.nodes.length > 0;
  const hasSyncedConfig = !!config.config;

  const styles = hasSyncedConfig ? config.config.styles : [];
  const aspects = hasSyncedConfig
    ? Object.entries(config.config.aspect_ratios)
    : [];
  const resolutions = hasSyncedConfig
    ? Object.entries(config.config.resolutions)
    : [];
  const presenters = hasSyncedConfig ? config.config.presenters : [];

  const defaultStyleName =
    styles.find((s) => s.id === config.defaults.style)?.name ||
    config.defaults.style;

  // Effective style = explicit override OR saved default. Used to figure out
  // which helpers (style-specific options like shadow / angle / bg_color)
  // apply right now. Mirrors the WP plugin's data-helper-styles logic.
  const effectiveStyle = style || config.defaults.style;
  const effectiveStyleObj = styles.find((s) => s.id === effectiveStyle);
  const effectiveMode = effectiveStyleObj?.mode || "product";
  const allModeHelpers = hasSyncedConfig
    ? config.config.helpers?.[effectiveMode] || []
    : [];
  const applicableHelpers = allModeHelpers.filter((h) => {
    if (!h || !h.name) return false;
    // Normalize styles: API may return array OR comma-separated string.
    let helperStyles = h.styles;
    if (typeof helperStyles === "string") {
      helperStyles = helperStyles.split(",").map((s) => s.trim()).filter(Boolean);
    }
    // No styles, empty array => helper applies to every style in the mode.
    if (!Array.isArray(helperStyles) || helperStyles.length === 0) return true;
    return helperStyles.includes(effectiveStyle);
  });

  // Group styles by mode + resolve the visible tab.
  const stylesByMode = {};
  for (const s of styles) {
    const mode = s.mode || "product";
    if (!stylesByMode[mode]) stylesByMode[mode] = [];
    stylesByMode[mode].push(s);
  }
  const modeKeys = Object.keys(stylesByMode);
  const resolvedActiveMode =
    activeMode && modeKeys.includes(activeMode)
      ? activeMode
      : modeKeys.includes(effectiveMode)
        ? effectiveMode
        : modeKeys[0];

  const selectedCount = selectedIds.size;
  const totalCount = product.media.nodes.length;
  const allSelected = selectedCount === totalCount && totalCount > 0;

  const renderingBusy = phase === "rendering";
  const renderedCount = Object.values(renderResults).filter(
    (r) => r.renderedDataUrl,
  ).length;
  const reviewIds = Object.keys(renderResults);
  const anyReplaceBusy = Object.values(replaceStatus).some(
    (s) => s.state === "busy",
  );

  const enhanceLabel = renderingBusy
    ? `${i18n.translate("enhancing")} (${
        Object.keys(renderResults).length
      }/${selectedCount})`
    : selectedCount > 1
      ? `${i18n.translate("enhance")} ${selectedCount}`
      : i18n.translate("enhance");

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      {/* IN-MODAL IMAGE VIEWER — swaps the modal body when a thumbnail
          is clicked. Open the image in a fresh tab if the user wants
          a true fullscreen view (browser handles native scaling). */}
      {viewer ? (
        <s-stack
          direction="block"
          gap="base"
          alignItems="center"
          justifyContent="center"
          padding="base"
        >
          <s-stack
            direction="inline"
            gap="base"
            alignItems="center"
            justifyContent="space-between"
          >
            <s-text type="strong">
              {viewer.label || i18n.translate("preview")}
            </s-text>
            <s-stack direction="inline" gap="small-200">
              <s-button
                onClick={() => window.open(viewer.src, "_blank")}
              >
                {i18n.translate("open_in_tab")}
              </s-button>
              <s-button onClick={() => setViewer(null)} variant="primary">
                {i18n.translate("close_preview")}
              </s-button>
            </s-stack>
          </s-stack>
          <s-image
            src={viewer.src}
            alt={viewer.label || ""}
            inlineSize="500px"
            aspectRatio="1"
            objectFit="contain"
            borderRadius="base"
          />
          <s-text tone="subdued">
            {i18n.translate("preview_hint")}
          </s-text>
        </s-stack>
      ) : (
      <s-stack direction="block" gap="large-100">
        <s-heading>{product.title}</s-heading>

        {/* RENDERING OVERLAY. The sandbox sometimes strips raw <img>/<div>
            with absolute positioning, so we use s-thumbnail (proven to
            render) for the logo and a small SVG spinner below it. SVG
            attributes (no @keyframes) are driven from React state. */}
        {phase === "rendering" && (
          <s-stack
            direction="block"
            gap="base"
            alignItems="center"
            justifyContent="center"
            padding="large-100"
          >
            <s-thumbnail
              src={`${BACKEND_URL}/emilia-logo.png`}
              alt="Emilia AI Studio"
              size="large-100"
            />
            <s-spinner
              accessibilityLabel={i18n.translate("rendering_heading")}
              size="large"
            />
            <s-heading>{i18n.translate("rendering_heading")}</s-heading>
            <s-text tone="subdued">
              {i18n.translate("rendering_progress")
                .replace("{done}", Object.keys(renderResults).length)
                .replace("{total}", selectedCount)}
            </s-text>
            <s-text tone="subdued">{i18n.translate("rendering_wait")}</s-text>
          </s-stack>
        )}

        {/* REVIEW PHASE — show original vs new, per image, with Replace btn. */}
        {phase === "review" && (
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text type="strong">{i18n.translate("review_heading")}</s-text>
              {reviewIds.filter(
                (id) =>
                  renderResults[id].renderedDataUrl &&
                  replaceStatus[id]?.state !== "done",
              ).length > 1 && (
                <s-button
                  onClick={handleReplaceAll}
                  disabled={anyReplaceBusy}
                >
                  {i18n.translate("replace_all")}
                </s-button>
              )}
            </s-stack>

            <s-stack direction="block" gap="base">
              {reviewIds.map((id) => {
                const r = renderResults[id];
                const rs = replaceStatus[id] || { state: "idle" };
                return (
                  <s-stack
                    key={id}
                    direction="block"
                    gap="small-200"
                    padding="small-200"
                    border="base"
                    borderRadius="base"
                    borderColor="subdued"
                  >
                    {r.error ? (
                      <s-text tone="critical">
                        {i18n.translate("failed")} {r.error}
                      </s-text>
                    ) : (
                      <s-stack direction="block" gap="base">
                        {/* Big before/after row. Click any image to zoom in
                            via the inline viewer (which swaps the modal body). */}
                        <s-grid
                          gridTemplateColumns="1fr auto 1fr"
                          gap="base"
                          alignItems="center"
                        >
                          <PreviewImage
                            src={r.originalUrl}
                            label={i18n.translate("before")}
                            onZoom={() =>
                              setViewer({
                                src: r.originalUrl,
                                label: i18n.translate("before"),
                              })
                            }
                          />
                          <s-text>→</s-text>
                          <PreviewImage
                            src={rs.newImageUrl || r.renderedDataUrl}
                            label={i18n.translate("after")}
                            onZoom={() =>
                              setViewer({
                                src: rs.newImageUrl || r.renderedDataUrl,
                                label: i18n.translate("after"),
                              })
                            }
                          />
                        </s-grid>

                        {/* Action row: either committed status, or a pair of
                            commit buttons (Replace original / Add to gallery). */}
                        {rs.state === "done" ? (
                          <s-badge tone="success">
                            ✓{" "}
                            {rs.mode === "add"
                              ? i18n.translate("added")
                              : i18n.translate("replaced")}
                          </s-badge>
                        ) : (
                          <s-stack direction="inline" gap="small-200">
                            <s-button
                              onClick={() => handleReplace(id)}
                              disabled={rs.state === "busy"}
                              variant="primary"
                            >
                              {rs.state === "busy" && rs.mode === "replace"
                                ? i18n.translate("replacing")
                                : i18n.translate("replace_btn")}
                            </s-button>
                            <s-button
                              onClick={() => handleAddToGallery(id)}
                              disabled={rs.state === "busy"}
                            >
                              {rs.state === "busy" && rs.mode === "add"
                                ? i18n.translate("adding")
                                : i18n.translate("add_to_gallery")}
                            </s-button>
                          </s-stack>
                        )}
                        {rs.state === "error" && (
                          <s-text tone="critical">{rs.error}</s-text>
                        )}
                      </s-stack>
                    )}
                  </s-stack>
                );
              })}
            </s-stack>
          </s-stack>
        )}

        {/* SELECT PHASE — original picker + options. */}
        {phase === "select" && !hasImages && (
          <s-text tone="subdued">{i18n.translate("no_images")}</s-text>
        )}

        {phase === "select" && hasImages && (
          <s-stack direction="block" gap="small-200">
            <s-stack
              direction="inline"
              gap="base"
              alignItems="center"
              justifyContent="space-between"
            >
              <s-text type="strong">
                {i18n.translate("select_images")} ({selectedCount}/{totalCount})
              </s-text>
              <s-button
                variant="tertiary"
                onClick={allSelected ? selectNone : selectAll}
              >
                {allSelected
                  ? i18n.translate("select_none")
                  : i18n.translate("select_all")}
              </s-button>
            </s-stack>

            <s-grid
              gridTemplateColumns="repeat(auto-fill, minmax(120px, 1fr))"
              gap="small-200"
            >
              {product.media.nodes.map((node) => {
                const isSelected = selectedIds.has(node.id);
                return (
                  <s-clickable
                    key={node.id}
                    onClick={() => toggleSelect(node.id)}
                    borderRadius="base"
                    borderColor={isSelected ? "strong" : "subdued"}
                    borderWidth={isSelected ? "large-100" : "small-100"}
                    background={isSelected ? "subdued" : "transparent"}
                    padding="small-100"
                  >
                    <s-stack
                      direction="block"
                      gap="small-200"
                      alignItems="center"
                      justifyContent="center"
                    >
                      <s-thumbnail
                        src={node.image.url}
                        alt={node.image.altText || ""}
                        size="base"
                      />
                      {isSelected && (
                        <s-badge tone="info">✓ {i18n.translate("selected")}</s-badge>
                      )}
                    </s-stack>
                  </s-clickable>
                );
              })}
            </s-grid>
          </s-stack>
        )}

        {/* SETTINGS OVERRIDES (only shown during select) */}
        {phase === "select" && hasSyncedConfig && hasImages && (
          <s-stack direction="block" gap="small-300" paddingBlockStart="large-100">
            <s-stack direction="block" gap="small-100">
              <s-heading>{i18n.translate("options_heading")}</s-heading>
              <s-text tone="subdued">{i18n.translate("options_hint")}</s-text>
            </s-stack>

            <StylePicker
              label={i18n.translate("style_label")}
              stylesByMode={stylesByMode}
              modes={config.config.modes || {}}
              activeMode={resolvedActiveMode}
              onModeChange={setActiveMode}
              selectedStyle={style || config.defaults.style}
              onSelectStyle={setStyle}
            />

            {/* DYNAMIC HELPERS — appear based on the currently selected style. */}
            {applicableHelpers.map((helper) =>
              helper.type === "color" ? (
                <s-color-field
                  key={helper.name}
                  label={helper.label || helper.name}
                  value={helperValues[helper.name] || helper.default || "#FFFFFF"}
                  onChange={(e) =>
                    setHelperValues((prev) => ({
                      ...prev,
                      [helper.name]: e.currentTarget.value,
                    }))
                  }
                />
              ) : (
                <SelectRow
                  key={helper.name}
                  label={helper.label || helper.name}
                  value={helperValues[helper.name] || ""}
                  onChange={(v) =>
                    setHelperValues((prev) => ({
                      ...prev,
                      [helper.name]: v,
                    }))
                  }
                  defaultLabel={`${i18n.translate("default")}: ${
                    Object.entries(helper.options || {}).find(
                      ([k]) => k === helper.default,
                    )?.[1] || helper.default || i18n.translate("none")
                  }`}
                  options={Object.entries(helper.options || {}).map(
                    ([k, label]) => ({ value: k, label }),
                  )}
                />
              ),
            )}

            <SelectRow
              label={i18n.translate("aspect_label")}
              value={aspectRatio}
              onChange={setAspectRatio}
              defaultLabel={`${i18n.translate("default")}: ${config.defaults.aspectRatio}`}
              options={aspects.map(([k, v]) => ({
                value: k,
                label: `${v.title} — ${v.description}`,
              }))}
            />

            <SelectRow
              label={i18n.translate("resolution_label")}
              value={resolution}
              onChange={setResolution}
              defaultLabel={`${i18n.translate("default")}: ${config.defaults.resolution}`}
              options={resolutions.map(([k, v]) => ({
                value: k,
                label: `${v.title} (${v.pixels})${v.credits ? ` — ${v.credits} credits` : ""}`,
              }))}
            />

            {/* Only show Presenter when the *currently selected style*
                supports presenters. has_presenter is a flag on each style. */}
            {presenters.length > 0 && effectiveStyleObj?.has_presenter && (
              <SelectRow
                label={i18n.translate("presenter_label")}
                value={presenter}
                onChange={setPresenter}
                defaultLabel={
                  config.defaults.presenter
                    ? `${i18n.translate("default")}: ${
                        presenters.find(
                          (p) => String(p.id) === config.defaults.presenter,
                        )?.name || config.defaults.presenter
                      }`
                    : `${i18n.translate("default")}: ${i18n.translate("none")}`
                }
                options={[
                  { value: "__none__", label: i18n.translate("none") },
                  ...presenters.map((p) => ({
                    value: String(p.id),
                    label: p.name,
                  })),
                ]}
              />
            )}
          </s-stack>
        )}

        {phase === "select" && !hasSyncedConfig && (
          <s-text tone="subdued">{i18n.translate("not_synced")}</s-text>
        )}
      </s-stack>
      )}

      {/* PRIMARY action varies by phase. Hidden while the viewer is open. */}
      {!viewer && phase === "select" && (
        <s-button
          slot="primary-action"
          disabled={!hasImages || selectedCount === 0}
          onClick={handleRender}
          variant="primary"
        >
          {enhanceLabel}
        </s-button>
      )}

      {!viewer && phase === "review" && (
        <s-button slot="primary-action" onClick={handleBackToSelect}>
          {i18n.translate("back_to_select")}
        </s-button>
      )}

      <s-button slot="secondary-actions" onClick={() => shopify.close()}>
        {phase === "review"
          ? i18n.translate("close")
          : i18n.translate("cancel")}
      </s-button>
    </s-admin-action>
  );
}

// Click-to-zoom preview tile used in the review phase.
// s-thumbnail caps at ~64px; for a real "big" preview we use s-image with
// an explicit inlineSize.
function PreviewImage({ src, label, onZoom }) {
  if (!src) return null;
  return (
    <s-stack direction="block" gap="extra-tight" alignItems="center">
      <s-text tone="subdued">{label}</s-text>
      <s-clickable onClick={onZoom} borderRadius="base" background="subdued">
        <s-image
          src={src}
          alt={label}
          inlineSize="220px"
          aspectRatio="1"
          objectFit="contain"
          borderRadius="base"
        />
      </s-clickable>
      <s-text tone="subdued" type="generic">
        click to view larger
      </s-text>
    </s-stack>
  );
}

// Tabbed style picker — tab row at the top (forced horizontal via s-grid
// with N columns), card grid below showing only the active tab's styles.
// 3 cards per row inside the modal because it's narrow.
function StylePicker({
  label,
  stylesByMode,
  modes,
  activeMode,
  onModeChange,
  selectedStyle,
  onSelectStyle,
}) {
  const modeKeys = Object.keys(stylesByMode);
  const visibleStyles = stylesByMode[activeMode] || [];

  return (
    <s-stack direction="block" gap="small-300">
      <s-text tone="subdued" type="generic">
        {label}
      </s-text>

      {/* Tab row — s-grid forces all tabs onto one row with equal widths,
          unlike s-stack inline which lets s-clickable stretch to full width. */}
      <s-grid
        gridTemplateColumns={`repeat(${modeKeys.length}, minmax(0, 1fr))`}
        gap="small-100"
      >
        {modeKeys.map((mode) => {
          const isActive = mode === activeMode;
          return (
            <s-clickable
              key={mode}
              onClick={() => onModeChange(mode)}
              padding="small-200"
              borderRadius="base"
              borderWidth={isActive ? "large-100" : "small-100"}
              borderColor={isActive ? "strong" : "subdued"}
              background={isActive ? "subdued" : "transparent"}
            >
              <s-stack
                direction="block"
                alignItems="center"
                justifyContent="center"
              >
                <s-text type={isActive ? "strong" : "generic"}>
                  {modes[mode]?.title ||
                    mode.charAt(0).toUpperCase() + mode.slice(1)}
                </s-text>
              </s-stack>
            </s-clickable>
          );
        })}
      </s-grid>

      {/* Card grid — exactly 3 columns in the modal */}
      <s-grid
        gridTemplateColumns="repeat(3, minmax(0, 1fr))"
        gap="small-200"
      >
        {visibleStyles.map((s) => {
          const isSelected = selectedStyle === s.id;
          return (
            <s-clickable
              key={s.id}
              onClick={() => onSelectStyle(s.id)}
              padding="small-100"
              borderRadius="base"
              borderWidth={isSelected ? "large-100" : "small-100"}
              borderColor={isSelected ? "strong" : "subdued"}
              background={isSelected ? "subdued" : "transparent"}
            >
              <s-stack
                direction="block"
                gap="small-200"
                alignItems="center"
                justifyContent="center"
              >
                {s.thumbnail ? (
                  <s-thumbnail src={s.thumbnail} alt={s.name} size="small" />
                ) : null}
                <s-text type={isSelected ? "strong" : "generic"}>
                  {s.name}
                </s-text>
              </s-stack>
            </s-clickable>
          );
        })}
      </s-grid>
    </s-stack>
  );
}

// Custom label above the select — smaller, subdued (opacity-like). The
// built-in select label is hidden from sight via `labelAccessibilityVisibility`
// but kept for screen readers.
function SelectRow({ label, value, onChange, defaultLabel, options }) {
  return (
    <s-stack direction="block" gap="small-500">
      <s-text tone="subdued" type="generic">
        {label}
      </s-text>
      <s-select
        label={label}
        labelAccessibilityVisibility="exclusive"
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      >
        <s-option value="">{defaultLabel}</s-option>
        {options.map((opt) => (
          <s-option key={opt.value} value={opt.value}>
            {opt.label}
          </s-option>
        ))}
      </s-select>
    </s-stack>
  );
}
