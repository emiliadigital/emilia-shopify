// GET /api/debug-emilia — dumps the raw platform /get-plugin-config response.
// Useful for diagnosing missing fields (e.g. helpers) when the cache is empty.
// Auth: same Bearer session token as the other extension endpoints.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getApiKey } from "../lib/emilia-settings.server";
import { fetchPluginConfig, EmiliaApiError } from "../lib/emilia.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  return new Response(null, {
    status: request.method === "OPTIONS" ? 204 : 405,
    headers: CORS_HEADERS,
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const { session } = await authenticate.admin(request);
  const apiKey = await getApiKey(session.shop);

  if (!apiKey) {
    return json({ error: "No API key saved for this shop" }, 400);
  }

  try {
    const raw = await fetchPluginConfig(apiKey);
    return json({
      ok: true,
      // Top-level keys so you can see at a glance if helpers is there.
      topLevelKeys: Object.keys(raw || {}),
      stylesCount: Array.isArray(raw?.styles) ? raw.styles.length : 0,
      presentersCount: Array.isArray(raw?.presenters) ? raw.presenters.length : 0,
      hasHelpers: !!raw?.helpers && Object.keys(raw.helpers).length > 0,
      helpersKeys: raw?.helpers ? Object.keys(raw.helpers) : [],
      // First helper in each mode so we see its shape (name, type, styles, options).
      helpersSample: raw?.helpers
        ? Object.fromEntries(
            Object.entries(raw.helpers).map(([mode, list]) => [
              mode,
              Array.isArray(list) ? list[0] : list,
            ]),
          )
        : null,
      raw, // full response for inspection
    });
  } catch (err) {
    const message =
      err instanceof EmiliaApiError ? err.message : String(err);
    const status = err instanceof EmiliaApiError ? err.statusCode || 500 : 500;
    return json({ ok: false, error: message }, status);
  }
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
