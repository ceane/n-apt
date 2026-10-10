import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { ZipArchive } from 'archiver';
import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import fileUpload from 'express-fileupload';
import rateLimit from 'express-rate-limit';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const archivesDir = path.join(rootDir, 'archives');
const exportedDir = path.join(rootDir, 'exported-archives');

const app = express();
const port = process.env.PORT || 3000;

function byteLimit(name, fallback, ceiling) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error(`Invalid ${name}`);
  return value;
}
const maxUploadBytes = byteLimit('NAPT_ARCHIVE_MAX_UPLOAD_BYTES', 256 * 1024 * 1024, 1024 * 1024 * 1024);
const maxExpandedBytes = byteLimit('NAPT_ARCHIVE_MAX_EXPANDED_BYTES', 1024 * 1024 * 1024, 4 * 1024 * 1024 * 1024);
const maxEntries = byteLimit('NAPT_ARCHIVE_MAX_ENTRIES', 10000, 100000);
const backendUrl = process.env.NAPT_BACKEND_PROXY_URL ?? process.env.WEBSOCKETS_URL ?? 'http://127.0.0.1:8765';
const apiRateLimit = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api', apiRateLimit);
// Authenticate before body parsing, disk writes or ZIP processing. This
// process shares the Rust backend's session authority rather than its password.
app.use('/api', async (req, res, next) => {
  const authorization = req.get('Authorization');
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) :
    typeof req.query.token === 'string' ? req.query.token : null;
  if (!token || token.length > 128) return res.status(401).json({ error: 'Authentication required' });
  try {
    const response = await fetch(new URL('/auth/session', backendUrl), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }), signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    if (response.status === 401) return res.status(401).json({ error: 'Invalid or expired session' });
    if (!response.ok || !(await response.json()).valid) return res.status(503).json({ error: 'Authentication unavailable' });
    next();
  } catch { return res.status(503).json({ error: 'Authentication unavailable' }); }
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

await fs.ensureDir(archivesDir);
await fs.ensureDir(exportedDir);

const filteredPages = ['account', 'like', 'safety', 'personalization', 'ad-', 'ads-', 'lists-', 'moment'];

function parseTwitterJs(content) {
  const match = content.match(/^window\.YTD\.[^=]+=\s*/);
  if (match) {
    return JSON.parse(content.slice(match[0].length));
  }
  const configMatch = content.match(/^window\.__THAR_CONFIG\s*=\s*/);
  if (configMatch) {
    return JSON.parse(content.slice(configMatch[0].length));
  }
  return null;
}

function toTwitterJs(globalName, data) {
  return `window.${globalName} = ${JSON.stringify(data, null, 2)}`;
}

function resolveArchivePath(root, name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('Archive name is required');
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, name);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid archive path');
  }
  return resolvedPath;
}

const uploadsDir = path.join(rootDir, '.archive-uploads');
await fs.ensureDir(uploadsDir, { mode: 0o700 });
const multipart = fileUpload({
  useTempFiles: true, tempFileDir: uploadsDir, tempFilePermissions: 0o600,
  limits: { fileSize: maxUploadBytes, files: 1, fields: 0, parts: 1 },
  abortOnLimit: true, uploadTimeout: 15000, createParentPath: false,
});
// Bound concurrent parsers as well as individual requests.
let activeUploads = 0;
app.use('/api/archives/upload', (req, res, next) => {
  if (activeUploads >= 2) return res.status(429).json({ error: 'Upload service busy' });
  activeUploads++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeUploads--;
    const files = Object.values(req.files ?? {}).flat();
    for (const file of files) if (file.tempFilePath) void fs.remove(file.tempFilePath);
  };
  res.once('finish', release); res.once('close', release);
  multipart(req, res, next);
});

app.post('/api/archives/upload', async (req, res) => {
  try {
    if (!req.files?.archive) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const archiveFile = req.files.archive;
    if (Array.isArray(archiveFile) || archiveFile.truncated) return res.status(413).json({ error: 'Archive upload exceeds its limit' });
    if (!/^[^/\\\x00-\x1f]{1,160}\.zip$/i.test(archiveFile.name)) return res.status(400).json({ error: 'Upload a ZIP archive with a valid filename' });
    const safeName = `${randomUUID()}-${path.basename(archiveFile.name)}`;
    const targetPath = path.join(archivesDir, safeName);
    await archiveFile.mv(targetPath);
    return res.json({ success: true, name: safeName });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/archives', async (_req, res) => {
  try {
    const files = await fs.readdir(archivesDir);
    const archives = [];

    for (const file of files) {
      const filePath = path.join(archivesDir, file);
      const stat = await fs.stat(filePath);

      if (stat.isDirectory() && !file.startsWith('.')) {
        const manifestPath = path.join(filePath, 'data', 'manifest.js');
        if (await fs.pathExists(manifestPath)) {
          const manifestContent = await fs.readFile(manifestPath, 'utf-8');
          const manifest = parseTwitterJs(manifestContent);
          archives.push({
            name: file,
            type: 'directory',
            userInfo: manifest?.userInfo || {},
            archiveInfo: manifest?.archiveInfo || {},
          });
        }
      } else if (file.endsWith('.zip')) {
        archives.push({ name: file, type: 'zip' });
      }
    }

    res.json(archives);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

let extractionActive = false;
function extractBounded(zipPath, destination) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./archive-extraction-worker.mjs', import.meta.url), {
      workerData: { zipPath, destination, maxBytes: maxExpandedBytes, maxEntries },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(Object.assign(new Error('Archive extraction timed out'), { status: 413 }));
    }, 60000);
    worker.once('message', result => {
      clearTimeout(timer);
      if (result.ok) resolve(); else reject(Object.assign(new Error(result.error), { status: result.status }));
    });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('Archive extraction failed'));
    });
  });
}
app.post('/api/archives/extract', async (req, res) => {
  if (extractionActive) return res.status(429).json({ error: 'Extraction service busy' });
  extractionActive = true;
  let temporaryPath;
  try {
    const { archiveName } = req.body;
    if (typeof archiveName !== 'string' || !archiveName.toLowerCase().endsWith('.zip')) return res.status(400).json({ error: 'A ZIP archive is required' });
    const zipPath = resolveArchivePath(archivesDir, archiveName);
    const extractPath = resolveArchivePath(
      archivesDir,
      archiveName.replace(/\.zip$/i, ''),
    );

    if (!await fs.pathExists(zipPath)) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    if (await fs.pathExists(extractPath)) return res.status(409).json({ error: 'Archive is already extracted' });
    temporaryPath = await fs.mkdtemp(path.join(archivesDir, '.extract-'));
    await extractBounded(zipPath, temporaryPath);
    await fs.rename(temporaryPath, extractPath);
    return res.json({ success: true, extractedPath: extractPath });
  } catch (error) {
    return res.status(error.status ?? 400).json({ error: error.message });
  } finally {
    if (temporaryPath) await fs.remove(temporaryPath);
    extractionActive = false;
  }
});

app.get('/api/archives/:archiveName/tweets', async (req, res) => {
  try {
    const archivePath = resolveArchivePath(archivesDir, req.params.archiveName);
    const dataPath = path.join(archivePath, 'data');

    if (!await fs.pathExists(dataPath)) {
      return res.status(404).json({ error: 'Archive data not found' });
    }

    const files = await fs.readdir(dataPath);
    const allTweets = [];

    for (const file of files) {
      if (file.startsWith('tweets') && file.endsWith('.js')) {
        const content = await fs.readFile(path.join(dataPath, file), 'utf-8');
        const tweets = parseTwitterJs(content);
        if (tweets) {
          allTweets.push(...tweets);
        }
      }
    }

    allTweets.sort((a, b) => new Date(b.tweet.created_at) - new Date(a.tweet.created_at));
    return res.json(allTweets);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/export', async (req, res) => {
  try {
    const { archiveName, filteredTweetIds, exportName } = req.body;
    const sourcePath = resolveArchivePath(archivesDir, archiveName);
    const timestamp = Date.now();
    const exportFolderName = exportName || `filtered-${archiveName}-${timestamp}`;
    const exportPath = resolveArchivePath(exportedDir, exportFolderName);

    await fs.ensureDir(exportPath);
    await fs.copy(sourcePath, exportPath);

    const dataPath = path.join(exportPath, 'data');
    const files = await fs.readdir(dataPath);
    const filteredTweetIdSet = new Set(filteredTweetIds);

    for (const file of files) {
      const shouldFilter = filteredPages.some((page) => file.toLowerCase().includes(page));
      if (shouldFilter && file.endsWith('.js')) {
        const filePath = path.join(dataPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const match = content.match(/^window\.(YTD\.[^=]+)\s*=/);
        if (match) {
          await fs.writeFile(filePath, `window.${match[1]} = []`);
        }
      }
    }

    for (const file of files) {
      if (file.startsWith('tweets') && file.endsWith('.js')) {
        const filePath = path.join(dataPath, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const match = content.match(/^window\.(YTD\.[^=]+)\s*=/);
        if (!match) {
          continue;
        }
        const tweets = parseTwitterJs(content);
        if (!tweets) {
          continue;
        }
        const filteredTweets = tweets.filter((tweet) => filteredTweetIdSet.has(tweet.tweet.id_str));
        await fs.writeFile(filePath, toTwitterJs(match[1], filteredTweets));
      }
    }

    const headersPath = path.join(dataPath, 'tweet-headers.js');
    if (await fs.pathExists(headersPath)) {
      const content = await fs.readFile(headersPath, 'utf-8');
      const match = content.match(/^window\.(YTD\.[^=]+)\s*=/);
      if (match) {
        const headers = parseTwitterJs(content) || [];
        const filteredHeaders = headers.filter((header) => filteredTweetIdSet.has(header.tweet.tweet_id));
        await fs.writeFile(headersPath, toTwitterJs(match[1], filteredHeaders));
      }
    }

    const manifestPath = path.join(dataPath, 'manifest.js');
    if (await fs.pathExists(manifestPath)) {
      const content = await fs.readFile(manifestPath, 'utf-8');
      const manifest = parseTwitterJs(content);
      if (manifest?.dataTypes) {
        if (manifest.dataTypes.tweet?.files) {
          manifest.dataTypes.tweet.files.forEach((file) => {
            file.count = String(filteredTweetIds.length);
          });
        }
        if (manifest.dataTypes.tweetHeaders?.files) {
          manifest.dataTypes.tweetHeaders.files.forEach((file) => {
            file.count = String(filteredTweetIds.length);
          });
        }
        filteredPages.forEach((page) => {
          Object.keys(manifest.dataTypes).forEach((key) => {
            if (key.toLowerCase().includes(page) && manifest.dataTypes[key]?.files) {
              manifest.dataTypes[key].files.forEach((file) => {
                file.count = '0';
              });
            }
          });
        });
        await fs.writeFile(manifestPath, `window.__THAR_CONFIG = ${JSON.stringify(manifest, null, 2)}`);
      }
    }

    const zipPath = resolveArchivePath(
      exportedDir,
      `${exportFolderName}.zip`,
    );
    const output = fs.createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.pipe(output);
    archive.directory(exportPath, false);
    await archive.finalize();

    return res.json({
      success: true,
      exportPath: exportFolderName,
      zipPath: `${exportFolderName}.zip`,
      tweetCount: filteredTweetIds.length,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/download/:filename', async (req, res) => {
  try {
    const filePath = resolveArchivePath(exportedDir, req.params.filename);
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.download(filePath);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, process.env.NAPT_ARCHIVE_HOST ?? '127.0.0.1', () => {
  console.log(`Transcript API running at http://localhost:${port}`);
});
