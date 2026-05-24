import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  // Also remove the merchant's saved Emilia settings (API key, defaults, cached
  // platform config). Belt-and-suspenders — shop/redact also does this 48h
  // later, but we don't want stale API keys sitting around in the meantime.
  await db.emiliaShopSettings.deleteMany({ where: { shop } });

  return new Response();
};
