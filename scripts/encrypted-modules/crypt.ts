import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

interface FileBundle {
  files: {
    path: string;
    content: string; // base64
  }[];
}

function getPasswords() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error('✗ .env.local not found');
    process.exit(1);
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const latexMatch = envContent.match(/UNSAFE_LOCAL_LATEX_PASSWORD=(.*)/);
  const demodMatch = envContent.match(/UNSAFE_LOCAL_DEMOD_PASSWORD=(.*)/);
  
  return {
    latex: latexMatch ? latexMatch[1].trim() : null,
    demod: demodMatch ? demodMatch[1].trim() : null,
  };
}

function getCurrentBranch(): string | null {
  try {
    return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function shouldRunEncryptedModules(): boolean {
  return getCurrentBranch() === 'encrypted-modules';
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, 'sha256');
}

function encrypt(data: string, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  
  // Format: salt(16) | iv(12) | authTag(16) | encrypted
  return Buffer.concat([
    salt,
    iv,
    authTag,
    Buffer.from(encrypted, 'hex')
  ]);
}

function decrypt(buffer: Buffer, password: string): string {
  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + 16);
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + 16);
  
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(encrypted.toString('hex'), 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

function bundle(dir: string): FileBundle {
  const bundle: FileBundle = { files: [] };
  const getFiles = (currentDir: string) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.DS_Store' || entry.name === '.gitkeep') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        getFiles(fullPath);
      } else {
        const relativePath = path.relative(dir, fullPath).split(path.sep).join('/');
        const content = fs.readFileSync(fullPath).toString('base64');
        bundle.files.push({ path: relativePath, content });
      }
    }
  };
  if (fs.existsSync(dir)) getFiles(dir);
  return bundle;
}

function unbundle(bundle: FileBundle, targetDir: string) {
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  for (const file of bundle.files) {
    const normalizedPath = file.path.split('/').join(path.sep);
    const fullPath = path.join(targetDir, normalizedPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(file.content, 'base64'));
  }
}

/**
 * Recursively find the newest file modification time in a directory.
 * Returns 0 if the directory doesn't exist or is empty.
 */
function getNewestMtime(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let newest = 0;
  const walk = (currentDir: string) => {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store' || entry.name === '.gitkeep') continue;
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else {
        const mtime = fs.statSync(fullPath).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  };
  walk(dir);
  return newest;
}

/**
 * Check if local tmp/ files have been modified since the last decryption.
 * Returns true if local files are newer than the encrypted bundle (i.e. local edits exist).
 */
function hasLocalEdits(bundlePath: string, tmpDir: string): boolean {
  if (!fs.existsSync(bundlePath) || !fs.existsSync(tmpDir)) return false;
  const bundleMtime = fs.statSync(bundlePath).mtimeMs;
  const newestTmpMtime = getNewestMtime(tmpDir);
  return newestTmpMtime > bundleMtime;
}

/** Decrypt a single bundle into its target dir, with optional local-edit protection. */
function decryptBundle(
  password: string,
  bundlePath: string,
  tmpDir: string,
  opts: { protectLocalEdits: boolean; label: string },
): boolean {
  if (!fs.existsSync(bundlePath)) return false;

  if (opts.protectLocalEdits && hasLocalEdits(bundlePath, tmpDir)) {
    console.log(
      `⚠ [skip] ${opts.label}: local changes in ${tmpDir} are newer than ${bundlePath}. ` +
      `Run "npm run encrypt-modules" first to persist your edits, then decrypt again.`,
    );
    return false;
  }

  const buffer = fs.readFileSync(bundlePath);
  const decrypted = decrypt(buffer, password);
  unbundle(JSON.parse(decrypted), tmpDir);
  return true;
}

const mode = process.argv[2]; // 'encrypt', 'decrypt', or 'decrypt-if-needed'
const forceFlag = process.argv.includes('--force');

if (!shouldRunEncryptedModules()) {
  if (mode === 'decrypt-if-needed') {
    process.exit(0);
  }

  console.log('ℹ [skip] Encrypted module operations only run on the `encrypted-modules` branch.');
  process.exit(0);
}

const { latex, demod } = getPasswords();

if (mode === 'encrypt') {
  try {
    // Encrypt LaTeX
    if (latex) {
      const latexBundle = bundle('src/encrypted-modules/tmp/ts');
      if (latexBundle.files.length > 0) {
        const encrypted = encrypt(JSON.stringify(latexBundle), latex);
        fs.writeFileSync('src/encrypted-modules/ts.bundle.enc', encrypted);
      }
    }

    // Encrypt Demod
    if (demod) {
      const demodBundle = bundle('src/encrypted-modules/tmp/rs');
      if (demodBundle.files.length > 0) {
        const encrypted = encrypt(JSON.stringify(demodBundle), demod);
        fs.writeFileSync('src/encrypted-modules/rs.bundle.enc', encrypted);
      }
    }
    console.log('✔ [pass] Encrypting N-APT modules...');
  } catch (e) {
    console.error('✗ [fail] Encrypting N-APT modules:', e);
    process.exit(1);
  }
} else if (mode === 'decrypt') {
  // Explicit decrypt: protect local edits unless --force is passed
  const protect = !forceFlag;
  try {
    if (latex) {
      decryptBundle(latex, 'src/encrypted-modules/ts.bundle.enc', 'src/encrypted-modules/tmp/ts', {
        protectLocalEdits: protect,
        label: 'TS modules',
      });
    }

    if (demod) {
      decryptBundle(demod, 'src/encrypted-modules/rs.bundle.enc', 'src/encrypted-modules/tmp/rs', {
        protectLocalEdits: protect,
        label: 'RS modules',
      });
    }
    console.log('✔ [pass] Decrypting N-APT modules...');
  } catch (e) {
    console.error('✗ [fail] Decrypting N-APT modules:', e);
  }
} else if (mode === 'decrypt-if-needed') {
  // Check if tmp/ files exist at all (not just a single sentinel)
  const rsTmpExists = fs.existsSync('src/encrypted-modules/tmp/rs') &&
    getNewestMtime('src/encrypted-modules/tmp/rs') > 0;
  const tsTmpExists = fs.existsSync('src/encrypted-modules/tmp/ts') &&
    getNewestMtime('src/encrypted-modules/tmp/ts') > 0;

  if (rsTmpExists && tsTmpExists) {
    // Already decrypted, exit silently
    process.exit(0);
  }

  // Decrypt only the missing bundles, always protect existing local edits
  try {
    if (latex && !tsTmpExists) {
      decryptBundle(latex, 'src/encrypted-modules/ts.bundle.enc', 'src/encrypted-modules/tmp/ts', {
        protectLocalEdits: true,
        label: 'TS modules',
      });
    }

    if (demod && !rsTmpExists) {
      decryptBundle(demod, 'src/encrypted-modules/rs.bundle.enc', 'src/encrypted-modules/tmp/rs', {
        protectLocalEdits: true,
        label: 'RS modules',
      });
    }
    console.log('✔ [pass] Decrypting N-APT modules...');
  } catch (e) {
    console.error('✗ [fail] Decrypting N-APT modules:', e);
  }
} else {
  console.log('Usage: tsx scripts/crypt.ts [encrypt|decrypt|decrypt-if-needed] [--force]');
}
