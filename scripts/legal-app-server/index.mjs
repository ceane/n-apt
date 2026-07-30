import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import archiver from 'archiver';
import extractZip from 'extract-zip';
import fileUpload from 'express-fileupload';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const archivesDir = path.join(rootDir, 'archives');
const exportedDir = path.join(rootDir, 'exported-archives');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '500mb' }));
app.use(express.urlencoded({ extended: true, limit: '500mb' }));

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

app.use(fileUpload({ createParentPath: true }));

app.post('/api/archives/upload', async (req, res) => {
  try {
    if (!req.files?.archive) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const archiveFile = req.files.archive;
    const safeName = path.basename(archiveFile.name);
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

app.post('/api/archives/extract', async (req, res) => {
  try {
    const { archiveName } = req.body;
    const zipPath = path.join(archivesDir, archiveName);
    const extractPath = path.join(archivesDir, archiveName.replace(/\.zip$/i, ''));

    if (!await fs.pathExists(zipPath)) {
      return res.status(404).json({ error: 'Archive not found' });
    }

    await extractZip(zipPath, { dir: extractPath });
    return res.json({ success: true, extractedPath: extractPath });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/archives/:archiveName/tweets', async (req, res) => {
  try {
    const archivePath = path.join(archivesDir, req.params.archiveName);
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
    const sourcePath = path.join(archivesDir, archiveName);
    const timestamp = Date.now();
    const exportFolderName = exportName || `filtered-${archiveName}-${timestamp}`;
    const exportPath = path.join(exportedDir, exportFolderName);

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

    const zipPath = path.join(exportedDir, `${exportFolderName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
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
    const filePath = path.join(exportedDir, req.params.filename);
    if (!await fs.pathExists(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    return res.download(filePath);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Transcript API running at http://localhost:${port}`);
});
