// Per-shop Emilia settings store. Wraps Prisma access so the rest of the app
// works with parsed `helpers` and `configCache` instead of JSON strings.

import prisma from "../db.server";
import type { EmiliaConfig } from "./emilia.server";

export interface EmiliaSettings {
  shop: string;
  apiKey: string | null;
  defaultStyle: string;
  defaultPresenter: string | null;
  defaultAspectRatio: string;
  defaultResolution: string;
  backdropColor: string;
  helpers: Record<string, string>;
  config: EmiliaConfig | null;
  configSyncedAt: Date | null;
}

const CONFIG_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours, matches WP plugin

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function getSettings(shop: string): Promise<EmiliaSettings> {
  const row = await prisma.emiliaShopSettings.upsert({
    where: { shop },
    create: { shop },
    update: {},
  });

  return {
    shop: row.shop,
    apiKey: row.apiKey,
    defaultStyle: row.defaultStyle,
    defaultPresenter: row.defaultPresenter,
    defaultAspectRatio: row.defaultAspectRatio,
    defaultResolution: row.defaultResolution,
    backdropColor: row.backdropColor,
    helpers: parseJson<Record<string, string>>(row.helpers, {}),
    config: parseJson<EmiliaConfig | null>(row.configCache, null),
    configSyncedAt: row.configSyncedAt,
  };
}

export async function getApiKey(shop: string): Promise<string | null> {
  const row = await prisma.emiliaShopSettings.findUnique({
    where: { shop },
    select: { apiKey: true },
  });
  return row?.apiKey ?? null;
}

export async function isConfigFresh(shop: string): Promise<boolean> {
  const row = await prisma.emiliaShopSettings.findUnique({
    where: { shop },
    select: { configSyncedAt: true, configCache: true },
  });
  if (!row?.configCache || !row.configSyncedAt) return false;
  return Date.now() - row.configSyncedAt.getTime() < CONFIG_TTL_MS;
}

export interface SettingsUpdate {
  apiKey?: string | null;
  defaultStyle?: string;
  defaultPresenter?: string | null;
  defaultAspectRatio?: string;
  defaultResolution?: string;
  backdropColor?: string;
  helpers?: Record<string, string>;
}

export async function updateSettings(
  shop: string,
  data: SettingsUpdate,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (data.apiKey !== undefined) update.apiKey = data.apiKey;
  if (data.defaultStyle !== undefined) update.defaultStyle = data.defaultStyle;
  if (data.defaultPresenter !== undefined)
    update.defaultPresenter = data.defaultPresenter;
  if (data.defaultAspectRatio !== undefined)
    update.defaultAspectRatio = data.defaultAspectRatio;
  if (data.defaultResolution !== undefined)
    update.defaultResolution = data.defaultResolution;
  if (data.backdropColor !== undefined)
    update.backdropColor = data.backdropColor;
  if (data.helpers !== undefined)
    update.helpers = JSON.stringify(data.helpers);

  await prisma.emiliaShopSettings.upsert({
    where: { shop },
    create: { shop, ...update },
    update,
  });
}

export async function saveConfigCache(
  shop: string,
  config: EmiliaConfig,
): Promise<void> {
  await prisma.emiliaShopSettings.upsert({
    where: { shop },
    create: {
      shop,
      configCache: JSON.stringify(config),
      configSyncedAt: new Date(),
    },
    update: {
      configCache: JSON.stringify(config),
      configSyncedAt: new Date(),
    },
  });
}
