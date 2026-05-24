// Emilia AI Studio block — sits as a card on every product detail page.
// Shows the product's images as thumbnails with an Enhance button under
// each. Calls /api/enhance on the app backend (Render) with a session token.

import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// Same Render URL the embedded app is hosted at.
const BACKEND_URL = "https://emilia-shopify.onrender.com";

export default async () => {
  render(<Extension />, document.body);
};

function Extension() {
  const { i18n, data } = shopify;
  const productId = data?.selected?.[0]?.id;

  const [mediaList, setMediaList] = useState(null);
  // mediaId -> { state: 'idle'|'busy'|'done'|'error', newUrl?, error? }
  const [statusByMedia, setStatusByMedia] = useState({});

  // Load product media
  useEffect(() => {
    if (!productId) return;
    (async () => {
      const query = {
        query: `
          query Product($id: ID!) {
            product(id: $id) {
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

      try {
        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify(query),
        });
        const json = await res.json();
        // Show every media that has a renderable URL. Don't gate on status —
        // we'd rather render the thumbnail and let /api/enhance return a
        // proper error if the bytes aren't fetchable yet.
        const nodes = (json?.data?.product?.media?.nodes || []).filter(
          (n) => n.image?.url,
        );
        setMediaList(nodes);
      } catch {
        setMediaList([]);
      }
    })();
  }, [productId]);

  const updateStatus = (mediaId, patch) => {
    setStatusByMedia((prev) => ({ ...prev, [mediaId]: { ...prev[mediaId], ...patch } }));
  };

  const handleEnhance = async (mediaId) => {
    updateStatus(mediaId, { state: "busy", error: null });

    try {
      const token = await shopify.auth.idToken();
      const formData = new FormData();
      formData.append("productId", productId);
      formData.append("mediaId", mediaId);

      const res = await fetch(`${BACKEND_URL}/api/enhance`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      let json = null;
      try { json = await res.json(); } catch { json = null; }

      if (!res.ok || !json?.ok) {
        updateStatus(mediaId, { state: "error", error: json?.error || `HTTP ${res.status}` });
        return;
      }

      updateStatus(mediaId, { state: "done", newUrl: json.newImageUrl });
    } catch (err) {
      updateStatus(mediaId, { state: "error", error: err?.message || String(err) });
    }
  };

  if (!mediaList) {
    return (
      <s-admin-block heading={i18n.translate("heading")}>
        <s-text>{i18n.translate("loading")}</s-text>
      </s-admin-block>
    );
  }

  if (mediaList.length === 0) {
    return (
      <s-admin-block heading={i18n.translate("heading")}>
        <s-text tone="subdued">{i18n.translate("no_images")}</s-text>
      </s-admin-block>
    );
  }

  return (
    <s-admin-block heading={i18n.translate("heading")}>
      <s-stack direction="block" gap="loose">
        <s-text tone="subdued">{i18n.translate("subhead")}</s-text>

        <s-grid
          gridTemplateColumns="repeat(auto-fill, minmax(120px, 1fr))"
          gap="base"
        >
          {mediaList.map((node) => {
            const st = statusByMedia[node.id] || { state: "idle" };
            const displayUrl = st.newUrl || node.image.url;
            const isBusy = st.state === "busy";
            const isDone = st.state === "done";
            const isError = st.state === "error";

            return (
              <s-stack
                key={node.id}
                direction="block"
                gap="small-200"
                alignItems="center"
                justifyContent="center"
              >
                <s-thumbnail
                  src={displayUrl}
                  alt={node.image.altText || ""}
                  size="base"
                />

                {isDone && <s-badge tone="success">{i18n.translate("replaced")}</s-badge>}

                <s-button
                  disabled={isBusy || isDone}
                  onClick={() => handleEnhance(node.id)}
                >
                  {isBusy
                    ? i18n.translate("enhancing")
                    : isDone
                      ? i18n.translate("replaced")
                      : i18n.translate("enhance")}
                </s-button>

                {isError && (
                  <s-text tone="critical">
                    {i18n.translate("failed")} {st.error}
                  </s-text>
                )}
              </s-stack>
            );
          })}
        </s-grid>
      </s-stack>
    </s-admin-block>
  );
}
