import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
        const relativePath = path.relative(dir, fullPath);
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
    const fullPath = path.join(targetDir, file.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, Buffer.from(file.content, 'base64'));
  }
}

const mode = process.argv[2]; // 'encrypt' or 'decrypt'

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
  try {
    // Decrypt LaTeX
    if (latex && fs.existsSync('src/encrypted-modules/ts.bundle.enc')) {
      const buffer = fs.readFileSync('src/encrypted-modules/ts.bundle.enc');
      const decrypted = decrypt(buffer, latex);
      unbundle(JSON.parse(decrypted), 'src/encrypted-modules/tmp/ts');
    }

    // Decrypt Demod
    if (demod && fs.existsSync('src/encrypted-modules/rs.bundle.enc')) {
      const buffer = fs.readFileSync('src/encrypted-modules/rs.bundle.enc');
      const decrypted = decrypt(buffer, demod);
      unbundle(JSON.parse(decrypted), 'src/encrypted-modules/tmp/rs');
    }
    console.log('✔ [pass] Decrypting N-APT modules...');
  } catch (e) {
    console.error('✗ [fail] Decrypting N-APT modules:', e);
    // Don't exit with 1 because we want the build to continue as requested
  }
} else if (mode === 'decrypt-if-needed') {
  const fastMathPath = 'src/encrypted-modules/tmp/rs/simd/fast_math.rs';
  if (fs.existsSync(fastMathPath)) {
    // Already decrypted, exit silently
    process.exit(0);
  }
  // Not decrypted, run normal decrypt
  try {
    // Decrypt LaTeX
    if (latex && fs.existsSync('src/encrypted-modules/ts.bundle.enc')) {
      const buffer = fs.readFileSync('src/encrypted-modules/ts.bundle.enc');
      const decrypted = decrypt(buffer, latex);
      unbundle(JSON.parse(decrypted), 'src/encrypted-modules/tmp/ts');
    }

    // Decrypt Demod
    if (demod && fs.existsSync('src/encrypted-modules/rs.bundle.enc')) {
      const buffer = fs.readFileSync('src/encrypted-modules/rs.bundle.enc');
      const decrypted = decrypt(buffer, demod);
      unbundle(JSON.parse(decrypted), 'src/encrypted-modules/tmp/rs');
    }
    console.log('✔ [pass] Decrypting N-APT modules...');
  } catch (e) {
    console.error('✗ [fail] Decrypting N-APT modules:', e);
    // Don't exit with 1 because we want the build to continue as requested
  }
} else {
  console.log('Usage: tsx scripts/crypt.ts [encrypt|decrypt]');
}
