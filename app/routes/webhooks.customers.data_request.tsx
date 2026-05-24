// GDPR compliance webhook — required for Shopify App Store.
// Fires when a customer requests a copy of their data.
//
// We store NO customer-level data (we only know the shop domain, the
// merchant's eak_ API key, and cached configuration). Acknowledge the
// request with 200 and a note for the merchant.

import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(
    `[Emilia] ${topic} webhook for ${shop}`,
    JSON.stringify(payload).slice(0, 200),
  );

  // Emilia AI Studio doesn't store customer-level data. The only per-shop
  // record (EmiliaShopSettings) contains: API key, default style/aspect/
  // resolution/presenter, helper overrides, cached platform config.
  // None of that is customer-personal-data. Acknowledge with 200.
  return new Response("OK", { status: 200 });
};
