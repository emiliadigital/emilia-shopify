// "Enhance with Emilia AI" admin action — modal on product detail pages.
//
// Flow:
//   1. Fetch the product's images (Shopify Admin GraphQL) + the merchant's
//      Emilia config (our backend) in parallel.
//   2. Merchant picks ONE image (explicit highlight + checkmark badge).
//   3. Style / aspect / resolution / presenter selects are pre-filled with
//      the merchant's saved defaults — they can override any of them.
//   4. POST /api/enhance with the selected mediaId + override values.

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
  const [config, setConfig] = useState(null); // null = loading, {} = no key
  const [loadError, setLoadError] = useState(null);

  const [selectedMediaId, setSelectedMediaId] = useState(null);

  // Setting overrides — empty string means "use the saved default"
  const [style, setStyle] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [resolution, setResolution] = useState("");
  const [presenter, setPresenter] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Initial load: product images (Shopify) + config (our backend) in parallel.
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
        if (p.media.nodes[0]) setSelectedMediaId(p.media.nodes[0].id);

        const cfg = await configRes.json();
        setConfig(cfg);
      } catch (err) {
        setLoadError(err?.message || String(err));
      }
    })();
  }, [productId]);

  const handleEnhance = async () => {
    if (!selectedMediaId) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      const token = await shopify.auth.idToken();
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("mediaId", selectedMediaId);
      // Only send overrides the merchant explicitly chose; otherwise let the
      // backend fall back to the saved defaults.
      if (style) formData.append("style", style);
      if (aspectRatio) formData.append("aspect", aspectRatio);
      if (resolution) formData.append("resolution", resolution);
      if (presenter) formData.append("presenterId", presenter);

      const res = await fetch(`${BACKEND_URL}/api/enhance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      let json = null;
      try { json = await res.json(); } catch { json = null; }

      if (!res.ok || !json?.ok) {
        setError(json?.error || `Enhance failed (HTTP ${res.status})`);
        return;
      }
      setSuccess(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
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

  // Backend says no API key configured yet
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

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="loose">
        <s-text type="strong">{product.title}</s-text>

        {/* IMAGE PICKER */}
        {!hasImages ? (
          <s-text tone="subdued">{i18n.translate("no_images")}</s-text>
        ) : (
          <s-stack direction="block" gap="base">
            <s-text type="strong">{i18n.translate("select_image")}</s-text>
            <s-stack direction="inline" gap="base" inlineWrap>
              {product.media.nodes.map((node) => {
                const isSelected = selectedMediaId === node.id;
                return (
                  <button
                    key={node.id}
                    type="button"
                    onClick={() => setSelectedMediaId(node.id)}
                    style={{
                      padding: 0,
                      position: "relative",
                      border: isSelected
                        ? "3px solid #2c6ecb"
                        : "3px solid #e1e3e5",
                      borderRadius: 10,
                      background: "transparent",
                      cursor: "pointer",
                      lineHeight: 0,
                      boxShadow: isSelected
                        ? "0 0 0 4px rgba(44,110,203,0.18)"
                        : "none",
                      transition: "all 120ms ease",
                    }}
                  >
                    <img
                      src={node.image.url}
                      alt={node.image.altText || ""}
                      style={{
                        width: 80,
                        height: 80,
                        objectFit: "cover",
                        borderRadius: 6,
                        display: "block",
                        opacity: isSelected ? 1 : 0.7,
                      }}
                    />
                    {isSelected && (
                      <div
                        style={{
                          position: "absolute",
                          top: -8,
                          right: -8,
                          background: "#2c6ecb",
                          color: "white",
                          fontSize: 12,
                          fontWeight: 700,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "2px solid white",
                        }}
                      >
                        ✓
                      </div>
                    )}
                  </button>
                );
              })}
            </s-stack>
          </s-stack>
        )}

        {/* SETTINGS OVERRIDES */}
        {hasSyncedConfig && hasImages && (
          <s-stack direction="block" gap="base">
            <s-text type="strong">{i18n.translate("options_heading")}</s-text>
            <s-text tone="subdued">{i18n.translate("options_hint")}</s-text>

            <SelectRow
              label={i18n.translate("style_label")}
              value={style}
              onChange={setStyle}
              defaultLabel={`${i18n.translate("default")}: ${defaultStyleName}`}
              options={styles.map((s) => ({ value: s.id, label: s.name }))}
            />

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

        {error && (
          <s-text tone="critical">
            {i18n.translate("failed")} {error}
          </s-text>
        )}
        {success && (
          <s-text tone="success">{i18n.translate("success")}</s-text>
        )}
      </s-stack>

      <s-button
        slot="primary-action"
        disabled={!hasImages || !selectedMediaId || busy || success}
        onClick={handleEnhance}
      >
        {busy ? i18n.translate("enhancing") : i18n.translate("enhance")}
      </s-button>

      <s-button slot="secondary-actions" onClick={close}>
        {i18n.translate("cancel")}
      </s-button>
    </s-admin-action>
  );
}

// Native HTML select — the s-select API surface varies by API version and
// styling it in the modal context is fiddly. A native select is reliable.
function SelectRow({ label, value, onChange, defaultLabel, options }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 13, fontWeight: 500 }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{
          padding: "8px 10px",
          fontSize: 14,
          border: "1px solid #c9cccf",
          borderRadius: 6,
          background: "white",
          width: "100%",
        }}
      >
        <option value="">{defaultLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
