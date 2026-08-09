// @ts-nocheck
async function parseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

export const transcriptApi = {
  listArchives() {
    return fetch('/api/archives').then(parseJson);
  },
  uploadArchive(formData) {
    return fetch('/api/archives/upload', {
      method: 'POST',
      body: formData,
    }).then(parseJson);
  },
  extractArchive(archiveName) {
    return fetch('/api/archives/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveName }),
    }).then(parseJson);
  },
  loadTweets(archiveName) {
    return fetch(`/api/archives/${encodeURIComponent(archiveName)}/tweets`).then(parseJson);
  },
  exportArchive(body) {
    return fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parseJson);
  },
};
