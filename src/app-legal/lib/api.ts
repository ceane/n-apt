// @ts-nocheck
import { getStoredSession } from '@n-apt/app/infrastructure/services/auth';

async function authenticatedFetch(url, options = {}) {
  const token = getStoredSession();
  if (!token) throw new Error('Sign in to access archives');
  return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
}
async function parseJson(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed');
  }
  return payload;
}

export const transcriptApi = {
  listArchives() {
    return authenticatedFetch('/api/archives').then(parseJson);
  },
  uploadArchive(formData) {
    return authenticatedFetch('/api/archives/upload', {
      method: 'POST',
      body: formData,
    }).then(parseJson);
  },
  extractArchive(archiveName) {
    return authenticatedFetch('/api/archives/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archiveName }),
    }).then(parseJson);
  },
  loadTweets(archiveName) {
    return authenticatedFetch(`/api/archives/${encodeURIComponent(archiveName)}/tweets`).then(parseJson);
  },
  exportArchive(body) {
    return authenticatedFetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(parseJson);
  },
  async downloadArchive(filename) {
    const response = await authenticatedFetch(`/api/download/${encodeURIComponent(filename)}`);
    if (!response.ok) { await parseJson(response); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
