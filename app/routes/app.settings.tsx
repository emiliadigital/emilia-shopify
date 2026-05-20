import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  BlockStack,
  Banner,
  Button,
  Card,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";

import { authenticate } from "../shopify.server";
import {
  getSettings,
  saveConfigCache,
  updateSettings,
} from "../lib/emilia-settings.server";
import {
  fetchPluginConfig,
  validateApiKey,
  EmiliaApiError,
} from "../lib/emilia.server";

const REFERENCE_STYLE_IDS = new Set([
  "reference",
  "reference_food",
  "reference_jewelry",
  "reference_clothing",
  "reference_furniture",
  "reference_cosmetics",
]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getSettings(session.shop);

  let keyStatus: "missing" | "valid" | "invalid" = "missing";
  if (settings.apiKey) {
    const ok = await validateApiKey(settings.apiKey);
    keyStatus = ok ? "valid" : "invalid";
  }

  return {
    settings: {
      ...settings,
      configSyncedAt: settings.configSyncedAt?.toISOString() ?? null,
    },
    keyStatus,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "test-key") {
    const apiKey = String(formData.get("apiKey") ?? "");
    if (!apiKey) {
      return result(false, undefined, "Please enter an API key");
    }
    const valid = await validateApiKey(apiKey);
    if (!valid) {
      return result(false, undefined, "API key is invalid or expired.");
    }
    return result(true, "API key is valid and working.");
  }

  if (intent === "sync-config") {
    const apiKey = String(formData.get("apiKey") ?? "");
    if (!apiKey) return result(false, undefined, "Save an API key first.");
    try {
      const config = await fetchPluginConfig(apiKey);
      await saveConfigCache(session.shop, config);
      return result(
        true,
        `Synced ${config.styles?.length ?? 0} styles and ${
          config.presenters?.length ?? 0
        } presenters.`,
      );
    } catch (err) {
      const message =
        err instanceof EmiliaApiError ? err.message : "Failed to sync.";
      return result(false, undefined, message);
    }
  }

  if (intent === "save") {
    const apiKey = String(formData.get("apiKey") ?? "").trim() || null;
    const defaultStyle = String(formData.get("defaultStyle") ?? "pure_white");
    const defaultPresenter =
      String(formData.get("defaultPresenter") ?? "").trim() || null;
    const defaultAspectRatio = String(formData.get("defaultAspectRatio") ?? "1:1");
    const defaultResolution = String(formData.get("defaultResolution") ?? "2K");
    const backdropColor = String(formData.get("backdropColor") ?? "#FFFFFF");

    await updateSettings(session.shop, {
      apiKey,
      defaultStyle,
      defaultPresenter,
      defaultAspectRatio,
      defaultResolution,
      backdropColor,
    });

    // Auto-sync config when a fresh API key was just saved.
    if (apiKey) {
      try {
        const config = await fetchPluginConfig(apiKey);
        await saveConfigCache(session.shop, config);
      } catch {
        // Ignore — the user can hit "Sync Now" manually
      }
    }

    return result(true, "Settings saved.");
  }

  return result(false, undefined, "Unknown intent");
};

interface ActionResult {
  ok: boolean;
  message?: string;
  error?: string;
}

function result(ok: boolean, message?: string, error?: string): ActionResult {
  return { ok, message, error };
}

export default function Settings() {
  const { settings, keyStatus } = useLoaderData<typeof loader>();
  const saveFetcher = useFetcher<typeof action>();
  const testFetcher = useFetcher<typeof action>();
  const syncFetcher = useFetcher<typeof action>();

  const [apiKey, setApiKey] = useState(settings.apiKey ?? "");
  const [defaultStyle, setDefaultStyle] = useState(settings.defaultStyle);
  const [defaultPresenter, setDefaultPresenter] = useState(
    settings.defaultPresenter ?? "",
  );
  const [defaultAspectRatio, setDefaultAspectRatio] = useState(
    settings.defaultAspectRatio,
  );
  const [defaultResolution, setDefaultResolution] = useState(
    settings.defaultResolution,
  );

  // Re-hydrate when loader data refreshes (after save).
  useEffect(() => {
    setApiKey(settings.apiKey ?? "");
    setDefaultStyle(settings.defaultStyle);
    setDefaultPresenter(settings.defaultPresenter ?? "");
    setDefaultAspectRatio(settings.defaultAspectRatio);
    setDefaultResolution(settings.defaultResolution);
  }, [settings]);

  const styleOptions = (settings.config?.styles ?? [])
    .filter((s) => !REFERENCE_STYLE_IDS.has(s.id))
    .map((s) => ({
      label: `${s.name} (${s.mode ?? "product"})`,
      value: s.id,
    }));

  const presenterOptions = [
    { label: "— None —", value: "" },
    ...((settings.config?.presenters ?? []).map((p) => ({
      label: p.name,
      value: String(p.id),
    }))),
  ];

  const aspectOptions = Object.entries(settings.config?.aspect_ratios ?? {}).map(
    ([k, v]) => ({
      label: `${v.title} — ${v.description}`,
      value: k,
    }),
  );
  const resolutionOptions = Object.entries(settings.config?.resolutions ?? {}).map(
    ([k, v]) => ({
      label: `${v.title} (${v.pixels})${v.credits ? ` — ${v.credits} credits` : ""}`,
      value: k,
    }),
  );

  const testing = testFetcher.state !== "idle";
  const syncing = syncFetcher.state !== "idle";
  const saving = saveFetcher.state !== "idle";

  const hasConfig = !!settings.config;
  const syncedLabel = settings.configSyncedAt
    ? new Date(settings.configSyncedAt).toLocaleString()
    : "never";

  return (
    <Page>
      <TitleBar title="Emilia AI Studio — Settings" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {keyStatus === "invalid" && (
              <Banner tone="critical" title="API key is invalid or expired">
                <p>Get a fresh key from your Emilia AI Studio account.</p>
              </Banner>
            )}
            {testFetcher.data?.ok && (
              <Banner tone="success" title={testFetcher.data.message ?? "OK"} />
            )}
            {testFetcher.data && !testFetcher.data.ok && (
              <Banner tone="critical" title={testFetcher.data.error ?? "Error"} />
            )}
            {syncFetcher.data?.ok && (
              <Banner tone="success" title={syncFetcher.data.message ?? "Synced"} />
            )}
            {syncFetcher.data && !syncFetcher.data.ok && (
              <Banner tone="critical" title={syncFetcher.data.error ?? "Error"} />
            )}
            {saveFetcher.data?.ok && (
              <Banner tone="success" title={saveFetcher.data.message ?? "Saved"} />
            )}

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  API Configuration
                </Text>
                <Text as="p" variant="bodyMd">
                  Enter the Emilia AI Studio API key from your{" "}
                  <a
                    href="https://ai.emilia.digital/my-account/integrations"
                    target="_blank"
                    rel="noreferrer"
                  >
                    account
                  </a>
                  .
                </Text>
                <FormLayout>
                  <TextField
                    label="API Key"
                    type="password"
                    autoComplete="off"
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder="eak_..."
                  />
                  <InlineStack gap="200">
                    <Button
                      loading={testing}
                      onClick={() =>
                        testFetcher.submit(
                          { intent: "test-key", apiKey },
                          { method: "POST" },
                        )
                      }
                    >
                      Test connection
                    </Button>
                    <Button
                      disabled={!apiKey}
                      loading={syncing}
                      onClick={() =>
                        syncFetcher.submit(
                          { intent: "sync-config", apiKey },
                          { method: "POST" },
                        )
                      }
                    >
                      Sync styles & presenters
                    </Button>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Last sync: {syncedLabel}
                    {hasConfig
                      ? ` — ${settings.config?.styles?.length ?? 0} styles, ${
                          settings.config?.presenters?.length ?? 0
                        } presenters`
                      : ""}
                  </Text>
                </FormLayout>
              </BlockStack>
            </Card>

            {hasConfig && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Defaults
                  </Text>
                  <FormLayout>
                    {styleOptions.length > 0 && (
                      <Select
                        label="Default style"
                        options={styleOptions}
                        value={defaultStyle}
                        onChange={setDefaultStyle}
                      />
                    )}
                    {presenterOptions.length > 1 && (
                      <Select
                        label="Default presenter"
                        options={presenterOptions}
                        value={defaultPresenter}
                        onChange={setDefaultPresenter}
                      />
                    )}
                    <FormLayout.Group>
                      {aspectOptions.length > 0 && (
                        <Select
                          label="Aspect ratio"
                          options={aspectOptions}
                          value={defaultAspectRatio}
                          onChange={setDefaultAspectRatio}
                        />
                      )}
                      {resolutionOptions.length > 0 && (
                        <Select
                          label="Resolution"
                          options={resolutionOptions}
                          value={defaultResolution}
                          onChange={setDefaultResolution}
                        />
                      )}
                    </FormLayout.Group>
                  </FormLayout>
                </BlockStack>
              </Card>
            )}

            <InlineStack align="end">
              <Button
                variant="primary"
                loading={saving}
                onClick={() =>
                  saveFetcher.submit(
                    {
                      intent: "save",
                      apiKey,
                      defaultStyle,
                      defaultPresenter,
                      defaultAspectRatio,
                      defaultResolution,
                      backdropColor: settings.backdropColor,
                    },
                    { method: "POST" },
                  )
                }
              >
                Save settings
              </Button>
            </InlineStack>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
