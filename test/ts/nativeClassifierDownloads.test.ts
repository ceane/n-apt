import {
  NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY,
  buildNativeClassifierDownloadLinks,
  loadPersistedNativeClassifierDownloads,
  persistNativeClassifierDownloads,
  type PersistedNativeClassifierDownload,
} from '@n-apt/classification/native/nativeClassifierDownloads';

const record: PersistedNativeClassifierDownload = {
  captureId: 'a'.repeat(64),
  jobId: `classifier_${'a'.repeat(64)}`,
  packageFileName: `n-apt-classifier-${'a'.repeat(12)}.zip`,
  timestamp: Date.now(),
};

describe('native classifier capture download persistence', () => {
  beforeEach(() => localStorage.clear());

  it('hydrates one server-backed Data Package download with the current session token', () => {
    persistNativeClassifierDownloads([record]);

    const hydrated = loadPersistedNativeClassifierDownloads(record.timestamp + 1000);
    expect(hydrated).toEqual([record]);
    const links = buildNativeClassifierDownloadLinks(hydrated[0], 'session-token');

    expect(links).toEqual({
      jobId: record.jobId,
      packageHref: expect.stringContaining('/api/capture/download?'),
      packageFileName: record.packageFileName,
    });
    expect(new URL(links!.packageHref).searchParams.get('token')).toBe('session-token');
    expect(new URL(links!.packageHref).searchParams.get('jobId')).toBe(record.jobId);
    expect(new URL(links!.packageHref).searchParams.has('artifact')).toBe(false);
  });

  it('migrates an older pair of artifact links into one package download', () => {
    localStorage.setItem(NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY, JSON.stringify([{
      captureId: record.captureId,
      jobId: record.jobId,
      iqDownloadUrl: `/api/capture/download?jobId=${record.jobId}&artifact=capture.iq`,
      iqFileName: 'capture.iq',
      annotationDownloadUrl: `/api/capture/download?jobId=${record.jobId}&artifact=labels.json`,
      annotationFileName: 'labels.json',
      timestamp: record.timestamp,
    }]));

    expect(loadPersistedNativeClassifierDownloads(record.timestamp + 1000)).toEqual([record]);
  });

  it('drops malformed and expired download records during hydration', () => {
    localStorage.setItem(NATIVE_CLASSIFIER_DOWNLOADS_STORAGE_KEY, JSON.stringify([
      record,
      { ...record, captureId: 'not-a-digest' },
      { ...record, timestamp: 1 },
    ]));

    expect(loadPersistedNativeClassifierDownloads(record.timestamp + 48 * 60 * 60 * 1000)).toEqual([]);
  });
});
