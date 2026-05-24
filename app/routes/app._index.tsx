// /app — the app's index route just redirects to /app/settings so opening
// the app from Shopify Admin's sidebar lands on Settings by default.

import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return redirect("/app/settings");
};

export default function Index() {
  return null;
}
