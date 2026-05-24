// /app/debug — quick inspector for the raw platform /get-plugin-config
// response. Loads inside the embedded app so the existing Shopify session
// authenticates; no extra setup needed.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { BlockStack, Box, Card, Layout, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { getApiKey } from "../lib/emilia-settings.server";
import { EmiliaApiError, fetchPluginConfig } from "../lib/emilia.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const apiKey = await getApiKey(session.shop);

  if (!apiKey) {
    return { ok: false as const, error: "No API key saved for this shop" };
  }

  try {
    const raw = await fetchPluginConfig(apiKey);
    return {
      ok: true as const,
      topLevelKeys: Object.keys(raw || {}),
      stylesCount: Array.isArray(raw?.styles) ? raw.styles.length : 0,
      presentersCount: Array.isArray(raw?.presenters)
        ? raw.presenters.length
        : 0,
      hasHelpers: !!raw?.helpers && Object.keys(raw.helpers).length > 0,
      helpersKeys: raw?.helpers ? Object.keys(raw.helpers) : [],
      helpersSample: raw?.helpers
        ? Object.fromEntries(
            Object.entries(raw.helpers).map(([mode, list]) => [
              mode,
              Array.isArray(list) ? list[0] : list,
            ]),
          )
        : null,
      raw,
    };
  } catch (err) {
    const message =
      err instanceof EmiliaApiError ? err.message : String(err);
    return { ok: false as const, error: message };
  }
};

export default function Debug() {
  const data = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="Debug — Emilia platform response" />
      <Layout>
        <Layout.Section>
          {!data.ok ? (
            <Card>
              <Text as="p" tone="critical">
                {data.error}
              </Text>
            </Card>
          ) : (
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Summary
                  </Text>
                  <Text as="p">
                    Top-level keys: <code>{JSON.stringify(data.topLevelKeys)}</code>
                  </Text>
                  <Text as="p">Styles: {data.stylesCount}</Text>
                  <Text as="p">Presenters: {data.presentersCount}</Text>
                  <Text as="p">
                    Helpers present: {data.hasHelpers ? "YES" : "NO"}
                  </Text>
                  <Text as="p">
                    Helpers keys:{" "}
                    <code>{JSON.stringify(data.helpersKeys)}</code>
                  </Text>
                </BlockStack>
              </Card>

              {data.helpersSample && (
                <Card>
                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">
                      First helper per mode
                    </Text>
                    <Box
                      padding="400"
                      background="bg-surface-active"
                      borderWidth="025"
                      borderRadius="200"
                      borderColor="border"
                      overflowX="scroll"
                    >
                      <pre style={{ margin: 0, fontSize: 12 }}>
                        <code>{JSON.stringify(data.helpersSample, null, 2)}</code>
                      </pre>
                    </Box>
                  </BlockStack>
                </Card>
              )}

              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingMd">
                    Full raw response
                  </Text>
                  <Box
                    padding="400"
                    background="bg-surface-active"
                    borderWidth="025"
                    borderRadius="200"
                    borderColor="border"
                    overflowX="scroll"
                  >
                    <pre style={{ margin: 0, fontSize: 11 }}>
                      <code>{JSON.stringify(data.raw, null, 2)}</code>
                    </pre>
                  </Box>
                </BlockStack>
              </Card>
            </BlockStack>
          )}
        </Layout.Section>
      </Layout>
    </Page>
  );
}
