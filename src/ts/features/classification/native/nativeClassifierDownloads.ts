import { buildSafeDownloadUrl } from '@n-apt/ui/downloadUrl';

export const NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY = 'napt.native-classifier-downloads.v1';
const NATIVE_CLASSIFIER_DOWNLOAD_RETENTION_MS = 48 * 60 * 60 * 1000;

export interface PersistedNativeClassifierDownload {
  captureId: string;
  jobId: string;
  packageFileName: string;
  timestamp: number;
}

export interface NativeClassifierDownloadLinks {
  jobId: string;
  packageHref: string;
  packageFileName: string;
}

export interface NativeClassifierCaptureUploadResponse {
  captureId: string;
  jobId: string;
  downloadUrl: string;
  filename: string;
  fileSize: number;
  checksum: string;
  timestamp: number;
}

function isSafePackageFilename(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && value.endsWith('.zip');
}

function hasValidIdentity(value: unknown, now: number): value is { captureId: string; jobId: string; timestamp: number } {
  if (!value || typeof value !== 'object') return false;
  const record = value as { captureId?: unknown; jobId?: unknown; timestamp?: unknown };
  if (typeof record.captureId !== 'string' || !/^[0-9a-f]{64}$/.test(record.captureId) ||
      record.jobId !== `classifier_${record.captureId}` || typeof record.timestamp !== 'number' || !Number.isFinite(record.timestamp) ||
      record.timestamp > now + 5 * 60 * 1000 || now - record.timestamp >= NATIVE_CLASSIFIER_DOWNLOAD_RETENTION_MS) return false;
  return true;
}

function isDownloadRecord(value: unknown, now: number): value is PersistedNativeClassifierDownload {
  if (!hasValidIdentity(value, now)) return false;
  const record = value as Partial<PersistedNativeClassifierDownload>;
  return isSafePackageFilename(record.packageFileName) && record.packageFileName === packageFileName(value.captureId);
}

function isLegacyArtifactRecord(value: unknown, now: number): value is {
  captureId: string; jobId: string; iqDownloadUrl: string; iqFileName: string;
  annotationDownloadUrl: string; annotationFileName: string; timestamp: number;
} {
  if (!hasValidIdentity(value, now)) return false;
  const record = value as Record<string, unknown>;
  if (typeof record.iqDownloadUrl !== 'string' || typeof record.annotationDownloadUrl !== 'string' ||
      typeof record.iqFileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.iq$/.test(record.iqFileName) ||
      typeof record.annotationFileName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(record.annotationFileName)) return false;
  try {
    const iqUrl = new URL(record.iqDownloadUrl, window.location.origin);
    const annotationUrl = new URL(record.annotationDownloadUrl, window.location.origin);
    return iqUrl.origin === window.location.origin && annotationUrl.origin === window.location.origin &&
      iqUrl.pathname === '/api/capture/download' && annotationUrl.pathname === '/api/capture/download' &&
      iqUrl.searchParams.get('jobId') === record.jobId && annotationUrl.searchParams.get('jobId') === record.jobId &&
      iqUrl.searchParams.get('artifact') === record.iqFileName && annotationUrl.searchParams.get('artifact') === record.annotationFileName &&
      !iqUrl.searchParams.has('token') && !annotationUrl.searchParams.has('token');
  } catch {
    return false;
  }
}

function packageFileName(captureId: string): string {
  return `n-apt-classifier-${captureId.slice(0, 12)}.zip`;
}

export function loadPersistedNativeClassifierDownloads(now = Date.now()): PersistedNativeClassifierDownload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY);
    if (!raw) return [];
    const records: unknown = JSON.parse(raw);
    if (!Array.isArray(records)) return [];
    return records.flatMap((record): PersistedNativeClassifierDownload[] => {
      if (isDownloadRecord(record, now)) return [record];
      if (isLegacyArtifactRecord(record, now)) {
        return [{ captureId: record.captureId, jobId: record.jobId, packageFileName: packageFileName(record.captureId), timestamp: record.timestamp }];
      }
      return [];
    }).sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
  } catch {
    return [];
  }
}

export function persistNativeClassifierDownloads(records: PersistedNativeClassifierDownload[]): void {
  if (typeof window === 'undefined') return;
  try {
    const now = Date.now();
    const validRecords = records.filter((record) => isDownloadRecord(record, now)).sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
    window.localStorage.setItem(NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY, JSON.stringify(validRecords));
  } catch {
    // The backend artifact remains available even when browser storage is unavailable.
  }
}

export function buildNativeClassifierDownloadLinks(
  record: PersistedNativeClassifierDownload | null | undefined,
  sessionToken: string | null | undefined,
): NativeClassifierDownloadLinks | null {
  if (!record || !sessionToken) return null;
  const packageHref = buildSafeDownloadUrl(`/api/capture/download?jobId=${encodeURIComponent(record.jobId)}`, sessionToken);
  if (!packageHref) return null;
  return { jobId: record.jobId, packageHref, packageFileName: record.packageFileName };
}
