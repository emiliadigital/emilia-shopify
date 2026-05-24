// GDPR compliance webhook — required for Shopify App Store.
// Fires 48 hours after a shop uninstalls the app, instructing us to delete
// any shop-level data we retained. Wipe the Session row (defensive — the
// app/uninstalled handler should have done it) AND the EmiliaShopSettings
// row (the only persistent shop-scoped record we own).

import type { ActionFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[Emilia] ${topic} webhook for ${shop} — wiping shop data`);

  // Delete all rows scoped to this shop.
  await db.session.deleteMany({ where: { shop } });
  await db.emiliaShopSettings.deleteMany({ where: { shop } });

  return new Response("OK", { status: 200 });
};
