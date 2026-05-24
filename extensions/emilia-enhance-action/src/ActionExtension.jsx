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

// Same Render URL the embedded app is hosted at.
const BACKEND_URL = "https://emilia-shopify.onrender.com";

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

  // Per-media enhance status: { [mediaId]: 'busy' | 'done' | 'error' }
  const [statusByMedia, setStatusByMedia] = useState({});
  const [errorByMedia, setErrorByMedia] = useState({});
  const [overallBusy, setOverallBusy] = useState(false);
  const [overallDone, setOverallDone] = useState(false);

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

  const handleEnhance = async () => {
    if (selectedIds.size === 0) return;
    setOverallBusy(true);
    setOverallDone(false);
    setStatusByMedia({});
    setErrorByMedia({});

    const token = await shopify.auth.idToken();
    const ids = Array.from(selectedIds);

    // Process sequentially so the user sees per-image progress.
    for (const mediaId of ids) {
      setStatusByMedia((prev) => ({ ...prev, [mediaId]: "busy" }));

      try {
        const formData = new FormData();
        formData.append("productId", productId);
        formData.append("mediaId", mediaId);
        if (style) formData.append("style", style);
        if (aspectRatio) formData.append("aspect", aspectRatio);
        if (resolution) formData.append("resolution", resolution);
        if (presenter) formData.append("presenterId", presenter);
        // Helper overrides — backend treats any non-reserved field as a helper.
        for (const [name, val] of Object.entries(helperValues)) {
          if (val) formData.append(name, val);
        }

        const res = await fetch(`${BACKEND_URL}/api/enhance`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        let json = null;
        try { json = await res.json(); } catch { json = null; }

        if (!res.ok || !json?.ok) {
          setStatusByMedia((prev) => ({ ...prev, [mediaId]: "error" }));
          setErrorByMedia((prev) => ({
            ...prev,
            [mediaId]: json?.error || `HTTP ${res.status}`,
          }));
        } else {
          setStatusByMedia((prev) => ({ ...prev, [mediaId]: "done" }));
        }
      } catch (err) {
        setStatusByMedia((prev) => ({ ...prev, [mediaId]: "error" }));
        setErrorByMedia((prev) => ({
          ...prev,
          [mediaId]: err?.message || String(err),
        }));
      }
    }

    setOverallBusy(false);
    setOverallDone(true);
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

  // One-time debug print so we can see what the backend ships and why a style
  // produced 0 helpers. Visible in browser DevTools console.
  if (typeof window !== "undefined" && !window.__emiliaHelpersLogged) {
    window.__emiliaHelpersLogged = true;
    console.log("[Emilia] config.helpers keys:", Object.keys(config.config?.helpers || {}));
    console.log("[Emilia] effective style:", effectiveStyle, "mode:", effectiveMode);
    console.log("[Emilia] mode helpers raw:", allModeHelpers);
    console.log("[Emilia] applicable after filter:", applicableHelpers);
  }

  const selectedCount = selectedIds.size;
  const totalCount = product.media.nodes.length;
  const allSelected = selectedCount === totalCount && totalCount > 0;
  const doneCount = Object.values(statusByMedia).filter((s) => s === "done").length;
  const errorCount = Object.values(statusByMedia).filter((s) => s === "error").length;

  const enhanceLabel = overallBusy
    ? `${i18n.translate("enhancing")} (${doneCount + errorCount}/${selectedCount})`
    : selectedCount > 1
      ? `${i18n.translate("enhance")} ${selectedCount}`
      : i18n.translate("enhance");

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="large-100">
        <s-heading>{product.title}</s-heading>

        {/* IMAGE PICKER */}
        {!hasImages ? (
          <s-text tone="subdued">{i18n.translate("no_images")}</s-text>
        ) : (
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
                disabled={overallBusy}
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
                const st = statusByMedia[node.id];
                return (
                  <s-clickable
                    key={node.id}
                    onClick={() =>
                      !overallBusy && toggleSelect(node.id)
                    }
                    borderRadius="base"
                    borderColor={isSelected ? "strong" : "subdued"}
                    borderWidth={isSelected ? "large-100" : "small-100"}
                    background={isSelected ? "subdued" : "transparent"}
                    padding="small-100"
                    disabled={overallBusy}
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
                      {st === "busy" && <s-badge tone="info">…</s-badge>}
                      {st === "done" && <s-badge tone="success">✓ Done</s-badge>}
                      {st === "error" && <s-badge tone="critical">! Failed</s-badge>}
                      {!st && isSelected && (
                        <s-badge tone="info">✓ Selected</s-badge>
                      )}
                    </s-stack>
                  </s-clickable>
                );
              })}
            </s-grid>
          </s-stack>
        )}

        {/* SETTINGS OVERRIDES */}
        {hasSyncedConfig && hasImages && (
          <s-stack direction="block" gap="small-300" paddingBlockStart="large-100">
            <s-stack direction="block" gap="small-100">
              <s-heading>{i18n.translate("options_heading")}</s-heading>
              <s-text tone="subdued">{i18n.translate("options_hint")}</s-text>
            </s-stack>

            <StyleSelect
              label={i18n.translate("style_label")}
              defaultLabel={`${i18n.translate("default")}: ${defaultStyleName}`}
              value={style}
              onChange={setStyle}
              styles={styles}
              modes={config.config.modes || {}}
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

            {presenters.length > 0 && (
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

        {!hasSyncedConfig && (
          <s-text tone="subdued">{i18n.translate("not_synced")}</s-text>
        )}

        {/* Result line(s) */}
        {overallDone && doneCount > 0 && (
          <s-text tone="success">
            {doneCount === 1
              ? i18n.translate("success")
              : `${i18n.translate("success_n").replace("{count}", doneCount)}`}
          </s-text>
        )}
        {overallDone && errorCount > 0 && (
          <s-stack direction="block" gap="extra-tight">
            <s-text tone="critical">
              {`${i18n.translate("failed_n").replace("{count}", errorCount)}`}
            </s-text>
            {Object.entries(errorByMedia).map(([mid, msg]) => (
              <s-text key={mid} tone="critical">• {msg}</s-text>
            ))}
          </s-stack>
        )}
      </s-stack>

      <s-button
        slot="primary-action"
        disabled={
          !hasImages || selectedCount === 0 || overallBusy || overallDone
        }
        onClick={handleEnhance}
      >
        {enhanceLabel}
      </s-button>

      <s-button slot="secondary-actions" onClick={close}>
        {overallDone ? i18n.translate("close") : i18n.translate("cancel")}
      </s-button>
    </s-admin-action>
  );
}

// Style select grouped by mode (product / food / jewelry / clothing /
// furniture / cosmetics) via s-option-group.
function StyleSelect({ label, defaultLabel, value, onChange, styles, modes }) {
  const grouped = {};
  for (const s of styles) {
    const mode = s.mode || "product";
    if (!grouped[mode]) grouped[mode] = [];
    grouped[mode].push(s);
  }
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
        {Object.entries(grouped).map(([mode, modeStyles]) => (
          <s-option-group
            key={mode}
            label={
              modes[mode]?.title ||
              mode.charAt(0).toUpperCase() + mode.slice(1)
            }
          >
            {modeStyles.map((s) => (
              <s-option key={s.id} value={s.id}>
                {s.name}
              </s-option>
            ))}
          </s-option-group>
        ))}
      </s-select>
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
