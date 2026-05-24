// /app — the app's index route just redirects to /app/settings so opening
// the app from Shopify Admin's sidebar lands on Settings by default.

import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Preserve the inbound query string (embedded, host, id_token, hmac, shop,
  // session, timestamp) so /app/settings can re-authenticate with the same
  // session token — otherwise authenticate.admin throws and we get bounced
  // to /auth/login.
  const url = new URL(request.url);
  return redirect(`/app/settings${url.search}`);
};

export default function Index() {
  return null;
}
