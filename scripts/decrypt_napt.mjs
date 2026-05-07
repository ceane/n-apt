import fs from 'fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

// Load .env.local
let password = process.env.UNSAFE_LOCAL_USER_PASSWORD;
try {
  if (fs.existsSync('.env.local')) {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    const config = dotenv.parse(envContent);
    
    let rawPass = config.VITE_UNSAFE_LOCAL_USER_PASSWORD || config.UNSAFE_LOCAL_USER_PASSWORD;
    if (rawPass) {
      if (rawPass.startsWith('$')) {
        const varName = rawPass.substring(1);
        rawPass = config[varName] || process.env[varName] || rawPass;
      }
      password = rawPass;
    }
  }
} catch (e) {
  console.warn('Could not read or parse .env.local, using process.env');
}

if (!password) {
  console.error('Error: Missing UNSAFE_LOCAL_USER_PASSWORD in .env.local or environment');
  process.exit(1);
}

const SALT = Buffer.from("n-apt-aes-salt-v1");
const ITERATIONS = 600_000;
const IV_LENGTH = 12;

// Derive vault key using PBKDF2
const vaultKey = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');
const vaultKeyHash = vaultKey.toString('hex').substring(0, 8);
console.log(`Initialized with Vault Key (hash: ${vaultKeyHash})`);

async function decryptFile(filePath) {
  console.log(`Processing: ${filePath}`);
  const fileData = fs.readFileSync(filePath);
  
  // Find JSON header boundary
  const maxProbe = Math.min(16384, fileData.length);
  const probeBuffer = fileData.subarray(0, maxProbe);
  const newlineIdx = probeBuffer.indexOf(10);
  
  let jsonStr = "";
  let headerSize = 4096; // Default fallback

  if (newlineIdx > 0) {
    jsonStr = probeBuffer.subarray(0, newlineIdx).toString();
    headerSize = 4096; // Most common
  } else {
    // Fallback: search for first payload byte (likely after 2048 or 4096)
    // For simplicity, we try common offsets
    jsonStr = probeBuffer.toString().split('}')[0] + '}';
  }

  const metaObj = JSON.parse(jsonStr);
  const metadata = metaObj.metadata || metaObj;
  
  // Probe common header sizes until decryption works
  const candidates = [4096, 2048, 8192, 1024];
  let decrypted = null;

  for (const hSize of candidates) {
    if (fileData.length <= hSize + 12) continue;
    
    const iv = fileData.subarray(hSize, hSize + 12);
    const ciphertextWithTag = fileData.subarray(hSize + 12);
    
    // Tag is last 16 bytes
    const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
    const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

    try {
      let targetKey = vaultKey;
      
      const wrappedDekB64 = metaObj.wrapped_dek || metaObj.encrypted_dek || 
                            (metadata && (metadata.wrapped_dek || metadata.encrypted_dek));

      if (wrappedDekB64) {
        const wrappedBytes = Buffer.from(wrappedDekB64, 'base64');
        const ivDek = wrappedBytes.subarray(0, 12);
        const cipherDekWithTag = wrappedBytes.subarray(12);
        const tagDek = cipherDekWithTag.subarray(cipherDekWithTag.length - 16);
        const cipherDek = cipherDekWithTag.subarray(0, cipherDekWithTag.length - 16);

        const decipherDek = crypto.createDecipheriv('aes-256-gcm', vaultKey, ivDek);
        decipherDek.setAuthTag(tagDek);
        targetKey = Buffer.concat([decipherDek.update(cipherDek), decipherDek.final()]);
      }

      const decipher = crypto.createDecipheriv('aes-256-gcm', targetKey, iv);
      decipher.setAuthTag(tag);
      decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      
      if (decrypted) {
        console.log(`Successfully decrypted with headerSize: ${hSize}`);
        break;
      }
    } catch (e) {
      // Continue probing
    }
  }

  if (!decrypted) {
    throw new Error('Decryption failed for all header sizes. Check your password.');
  }

  const outPath = filePath + '.decrypted.bin';
  fs.writeFileSync(outPath, decrypted);
  console.log(`Saved decrypted payload to: ${outPath}`);
}

const target = process.argv[2] || 'iq-samples-snapshots/mock/mock_capture_cap_1774749285201_20260329_015446.napt';

if (fs.existsSync(target)) {
  decryptFile(target).catch(err => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
} else {
  console.error(`File not found: ${target}`);
}
