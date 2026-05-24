// GDPR compliance webhook — required for Shopify App Store.
// Fires when a customer requests their data be deleted.
//
// We store no customer-level data. Acknowledge with 200.

import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Emilia] ${topic} webhook for ${shop}`);

  // No-op: no customer-level data is stored in our database.
  return new Response("OK", { status: 200 });
};
