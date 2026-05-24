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
import { useState } from "react";

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
      // Surface the actual error message instead of a generic "Failed to sync."
      // so it's easier to debug platform/DB issues from the UI itself.
      const detail =
        err instanceof EmiliaApiError
          ? err.message
          : err instanceof Error
            ? `${err.name}: ${err.message}`
            : String(err);
      console.error("[Emilia] sync-config failed:", err);
      return result(false, undefined, `Failed to sync — ${detail}`);
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

    // Anything that isn't one of the reserved field names becomes a helper
    // (shadow, angle, product_surface, bg_color, food_style, etc.). Mirrors
    // how the action extension submits helpers.
    const RESERVED = new Set([
      "intent",
      "apiKey",
      "defaultStyle",
      "defaultPresenter",
      "defaultAspectRatio",
      "defaultResolution",
      "backdropColor",
    ]);
    const helpers: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      if (RESERVED.has(k)) continue;
      if (typeof v === "string" && v) helpers[k] = v;
    }

    await updateSettings(session.shop, {
      apiKey,
      defaultStyle,
      defaultPresenter,
      defaultAspectRatio,
      defaultResolution,
      backdropColor,
      helpers,
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

  // Initialize state from the loader once. Don't re-sync on every loader
  // revalidation — Remix re-runs the loader after each action submission,
  // and if the user has typed an API key but not yet saved it, syncing
  // would clobber the input back to empty (because DB still says null).
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
  const [helperValues, setHelperValues] = useState<Record<string, string>>(
    settings.helpers ?? {},
  );

  // Group styles by mode (product / food / jewelry / clothing / furniture /
  // cosmetics). Polaris's Select accepts a mixed array of options and
  // { title, options: [...] } group descriptors.
  const stylesByMode: Record<string, { label: string; value: string }[]> = {};
  for (const s of settings.config?.styles ?? []) {
    if (REFERENCE_STYLE_IDS.has(s.id)) continue;
    const mode = s.mode ?? "product";
    if (!stylesByMode[mode]) stylesByMode[mode] = [];
    stylesByMode[mode].push({ label: s.name, value: s.id });
  }
  const modeTitles = settings.config?.modes ?? {};
  const styleOptions = Object.entries(stylesByMode).map(([mode, opts]) => ({
    title: modeTitles[mode]?.title ?? mode.charAt(0).toUpperCase() + mode.slice(1),
    options: opts,
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

  // Resolve which helpers apply to the currently selected default style.
  // Same logic as the action extension: find style → mode → helpers in that
  // mode whose `styles[]` includes the selected style id (or empty = applies
  // to all in mode).
  const allStyles = settings.config?.styles ?? [];
  const effectiveStyleObj = allStyles.find((s) => s.id === defaultStyle);
  const effectiveMode = effectiveStyleObj?.mode ?? "product";
  const modeHelpers = settings.config?.helpers?.[effectiveMode] ?? [];
  const applicableHelpers = modeHelpers.filter((h) => {
    if (!h || !h.name) return false;
    // styles may arrive as either a string[] or a CSV string depending on
    // the platform — handle both.
    const raw = (h as { styles?: unknown }).styles;
    let helperStyles: string[];
    if (Array.isArray(raw)) {
      helperStyles = raw as string[];
    } else if (typeof raw === "string") {
      helperStyles = raw.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      helperStyles = [];
    }
    if (helperStyles.length === 0) return true;
    return helperStyles.includes(defaultStyle);
  });

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
                    {/* Visual style grid grouped by mode — mirrors the WP plugin. */}
                    {stylesByMode &&
                      Object.entries(stylesByMode).map(([mode, opts]) => (
                        <BlockStack gap="200" key={mode}>
                          <Text as="h3" variant="headingSm">
                            {modeTitles[mode]?.title ??
                              mode.charAt(0).toUpperCase() + mode.slice(1)}
                          </Text>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns:
                                "repeat(auto-fill, minmax(140px, 1fr))",
                              gap: 12,
                            }}
                          >
                            {opts.map((opt) => {
                              const styleObj = allStyles.find(
                                (s) => s.id === opt.value,
                              );
                              const isSelected = defaultStyle === opt.value;
                              return (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => setDefaultStyle(opt.value)}
                                  style={{
                                    padding: 8,
                                    border: isSelected
                                      ? "2px solid #2c6ecb"
                                      : "1px solid #e1e3e5",
                                    borderRadius: 12,
                                    background: isSelected
                                      ? "#f3f8ff"
                                      : "white",
                                    cursor: "pointer",
                                    textAlign: "center",
                                    transition: "all 120ms",
                                  }}
                                >
                                  <div
                                    style={{
                                      width: "100%",
                                      aspectRatio: "1",
                                      borderRadius: 8,
                                      overflow: "hidden",
                                      background: "#f6f6f7",
                                      marginBottom: 8,
                                    }}
                                  >
                                    {styleObj?.thumbnail ? (
                                      <img
                                        src={styleObj.thumbnail}
                                        alt={opt.label}
                                        loading="lazy"
                                        style={{
                                          width: "100%",
                                          height: "100%",
                                          objectFit: "cover",
                                          display: "block",
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                  <Text
                                    as="span"
                                    variant="bodySm"
                                    fontWeight={isSelected ? "bold" : "regular"}
                                  >
                                    {opt.label}
                                  </Text>
                                </button>
                              );
                            })}
                          </div>
                        </BlockStack>
                      ))}

                    {/* Style-specific helpers (shadow, angle, surface, etc.)
                        appear when the selected style declares them. Mirrors
                        the WP plugin's Style Options section. */}
                    {applicableHelpers.map((helper) => {
                      const value =
                        helperValues[helper.name] ?? helper.default ?? "";
                      const setValue = (v: string) =>
                        setHelperValues((prev) => ({ ...prev, [helper.name]: v }));

                      if (helper.type === "color") {
                        // Native HTML color input — Polaris TextField doesn't
                        // expose a color type. Wrapped with a label that
                        // matches Polaris's visual treatment.
                        return (
                          <div key={helper.name}>
                            <Text as="p" variant="bodySm" tone="subdued">
                              {helper.label || helper.name}
                            </Text>
                            <input
                              type="color"
                              value={value || "#FFFFFF"}
                              onChange={(e) => setValue(e.currentTarget.value)}
                              style={{
                                width: 60,
                                height: 36,
                                border: "1px solid #c9cccf",
                                borderRadius: 6,
                                cursor: "pointer",
                                padding: 2,
                                background: "white",
                              }}
                            />
                          </div>
                        );
                      }

                      const helperOptions = Object.entries(
                        helper.options || {},
                      ).map(([k, label]) => ({ label, value: k }));
                      return (
                        <Select
                          key={helper.name}
                          label={helper.label || helper.name}
                          options={helperOptions}
                          value={value}
                          onChange={setValue}
                        />
                      );
                    })}

                    {presenterOptions.length > 1 &&
                      effectiveStyleObj?.has_presenter && (
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
                      // Spread helpers as top-level fields — the action
                      // treats any non-reserved field as a helper override.
                      ...Object.fromEntries(
                        applicableHelpers
                          .map((h) => [
                            h.name,
                            helperValues[h.name] ?? h.default ?? "",
                          ])
                          .filter(([, v]) => v !== ""),
                      ),
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
