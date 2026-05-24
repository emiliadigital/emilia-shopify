// Explicit /auth/session-token bouncer. App Bridge JS gets a fresh session
// token from the parent (Shopify Admin) via postMessage, then reloads to the
// `shopify-reload` URL with the token attached. The Shopify Remix package
// usually ships this automatically, but our PHP-proxy setup ends up with an
// empty response — so we render the bouncer ourselves.

import type { LoaderFunctionArgs } from "@remix-run/node";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const reload = url.searchParams.get("shopify-reload") || "/app";
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Authenticating…</title>
<meta name="shopify-api-key" content="${apiKey}">
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script>
(async () => {
  try {
    if (!window.shopify || !window.shopify.idToken) {
      window.location.replace(${JSON.stringify(reload)});
      return;
    }
    const token = await window.shopify.idToken();
    const u = new URL(${JSON.stringify(reload)}, window.location.origin);
    if (token) u.searchParams.set("id_token", token);
    window.location.replace(u.toString());
  } catch (err) {
    window.location.replace(${JSON.stringify(reload)});
  }
})();
</script>
</head>
<body></body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
