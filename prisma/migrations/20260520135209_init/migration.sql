-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmiliaShopSettings" (
    "shop" TEXT NOT NULL,
    "apiKey" TEXT,
    "defaultStyle" TEXT NOT NULL DEFAULT 'pure_white',
    "defaultPresenter" TEXT,
    "defaultAspectRatio" TEXT NOT NULL DEFAULT '1:1',
    "defaultResolution" TEXT NOT NULL DEFAULT '2K',
    "backdropColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "helpers" TEXT NOT NULL DEFAULT '{}',
    "configCache" TEXT,
    "configSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmiliaShopSettings_pkey" PRIMARY KEY ("shop")
);
