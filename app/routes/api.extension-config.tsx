// GET /api/extension-config — returns the merchant's saved defaults plus the
// cached platform config (styles, presenters, aspect ratios, resolutions) so
// admin extensions can render dropdowns without re-querying Emilia themselves.
//
// Auth: same Bearer session token pattern as /api/enhance.

import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import { getSettings } from "../lib/emilia-settings.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// Remix routes OPTIONS to the `action` export, not `loader`. We use this purely
// for CORS preflight — the real data fetch is GET via the loader below.
export const action = async ({ request }: ActionFunctionArgs) => {
  return new Response(null, {
    status: request.method === "OPTIONS" ? 204 : 405,
    headers: CORS_HEADERS,
  });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  const body = {
    hasApiKey: !!settings.apiKey,
    configSyncedAt: settings.configSyncedAt?.toISOString() ?? null,
    defaults: {
      style: settings.defaultStyle,
      aspectRatio: settings.defaultAspectRatio,
      resolution: settings.defaultResolution,
      presenter: settings.defaultPresenter,
    },
    // Pass through the platform config (filtered to drop reference styles).
    config: settings.config
      ? {
          styles: (settings.config.styles ?? []).filter(
            (s) =>
              ![
                "reference",
                "reference_food",
                "reference_jewelry",
                "reference_clothing",
                "reference_furniture",
                "reference_cosmetics",
              ].includes(s.id),
          ),
          presenters: settings.config.presenters ?? [],
          aspect_ratios: settings.config.aspect_ratios ?? {},
          resolutions: settings.config.resolutions ?? {},
          modes: settings.config.modes ?? {},
        }
      : null,
  };

  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
};
