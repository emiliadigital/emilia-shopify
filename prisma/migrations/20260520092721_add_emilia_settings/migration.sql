-- CreateTable
CREATE TABLE "EmiliaShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "apiKey" TEXT,
    "defaultStyle" TEXT NOT NULL DEFAULT 'pure_white',
    "defaultPresenter" TEXT,
    "defaultAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "defaultResolution" TEXT NOT NULL DEFAULT '2K',
    "backdropColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "helpers" TEXT NOT NULL DEFAULT '{}',
    "configCache" TEXT,
    "configSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
