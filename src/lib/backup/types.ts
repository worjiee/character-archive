export interface BackupArtworkObject {
  sha256: string;
  storageKey: string;
  fileName: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
}

export interface BackupManifest {
  format: "character-archive-backup";
  formatVersion: 1;
  createdAt: string;
  applicationVersion: string;
  gitCommitSha: string;
  environment: string;
  tooling: {
    pgDumpVersion: string;
    nodeVersion: string;
  };
  schema: {
    generator: string;
    lastMigration: string;
    migrationCount: number;
    migrations: string[];
  };
  database: {
    format: "postgres-custom" | "postgres-sql";
    fileName: string;
    sha256: string;
    bytes: number;
    tableCounts: Record<string, number>;
    excludedTableData: string[];
  };
  artwork: {
    objectCount: number;
    totalBytes: number;
    objects: BackupArtworkObject[];
  };
  packageDigest: string;
}

export interface ArchiveHealthStatus {
  database: {
    status: "healthy" | "unhealthy";
    totalCharacters: number;
    totalSources: number;
    totalVersions: number;
    totalGreetings: number;
    totalTags: number;
    totalLorebooks: number;
  };
  artwork: {
    totalAssets: number;
    totalBytes: number;
    storageObjects: number;
    missingCurrentArtwork: string[];
    brokenHistoricalArtwork: string[];
    orphanArtwork: string[];
    storageMismatch: string[];
  };
  migrations: {
    isUpToDate: boolean;
    appliedCount: number;
    latestMigration: string;
  };
  operational: {
    sessionCount: number;
    notificationCount: number;
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary?: {
    formatVersion: number;
    createdAt: string;
    applicationVersion: string;
    gitCommitSha: string;
    pgDumpVersion: string;
    lastMigration: string;
    dbSha256: string;
    dbBytes: number;
    artworkObjectCount: number;
    totalArtworkBytes: number;
    packageDigest: string;
    tables: Record<string, number>;
  };
}
