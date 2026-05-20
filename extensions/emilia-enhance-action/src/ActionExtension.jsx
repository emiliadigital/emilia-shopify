// "Enhance with Emilia AI" admin action — renders inside the More actions
// menu on product detail pages. Lists the product's images, lets the
// merchant pick one, and POSTs to /api/enhance on the app backend with the
// session token. The backend does the actual Emilia + Shopify Files dance.

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Same Render URL the embedded app is hosted at. The extension lives on
// Shopify's CDN and must call the backend by its absolute URL.
const BACKEND_URL = "https://emilia-shopify.onrender.com";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, close, data } = shopify;
  const productId = data?.selected?.[0]?.id;

  const [product, setProduct] = useState(null);
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Fetch the product's images via Shopify's Admin API.
  useEffect(() => {
    if (!productId) return;
    (async () => {
      const query = {
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
      };

      const res = await fetch("shopify:admin/api/graphql.json", {
        method: "POST",
        body: JSON.stringify(query),
      });
      if (!res.ok) {
        setError("Failed to load product images.");
        return;
      }

      const json = await res.json();
      const p = json?.data?.product;
      if (!p) {
        setError("Product not found.");
        return;
      }

      // Keep only ready image media
      p.media.nodes = p.media.nodes.filter(
        (n) => n.image?.url && n.status === "READY",
      );
      setProduct(p);
      if (p.media.nodes[0]) setSelectedMediaId(p.media.nodes[0].id);
    })();
  }, [productId]);

  const handleEnhance = async () => {
    if (!selectedMediaId) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    try {
      // Session token authenticates against authenticate.admin() on the backend.
      const token = await shopify.idToken();

      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("mediaId", selectedMediaId);

      const res = await fetch(`${BACKEND_URL}/api/enhance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

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

  if (!product && !error) {
    return (
      <s-admin-action heading={i18n.translate("heading")}>
        <s-text>Loading…</s-text>
      </s-admin-action>
    );
  }

  const hasImages = product?.media?.nodes?.length > 0;

  return (
    <s-admin-action heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="loose">
        {product && (
          <s-text type="strong">{product.title}</s-text>
        )}

        {!hasImages ? (
          <s-text>{i18n.translate("no_images")}</s-text>
        ) : (
          <>
            <s-text>{i18n.translate("select_image")}</s-text>
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
                      border: isSelected
                        ? "3px solid #007ace"
                        : "3px solid transparent",
                      borderRadius: 8,
                      background: "transparent",
                      cursor: "pointer",
                      lineHeight: 0,
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
                      }}
                    />
                  </button>
                );
              })}
            </s-stack>
          </>
        )}

        {error && <s-text tone="critical">{i18n.translate("failed")} {error}</s-text>}
        {success && <s-text tone="success">{i18n.translate("success")}</s-text>}
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
