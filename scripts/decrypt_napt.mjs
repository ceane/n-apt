import fs from 'fs';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

// Load .env.local
const env = dotenv.parse(fs.readFileSync('.env.local'));
const password = env.UNSAFE_LOCAL_USER_PASSWORD || 'n-apt-dev-key';

const SALT = Buffer.from("n-apt-aes-salt-v1");
const ITERATIONS = 100_000;
const IV_LENGTH = 12;

async function decrypt() {
  const filePath = 'iq-samples-snapshots/mock/mock_capture_cap_1774749285201_20260329_015446.napt';
  const fileData = fs.readFileSync(filePath);
  
  const MAX_HEADER_READ = Math.min(8192, fileData.byteLength);
  const maxHeaderBytes = fileData.subarray(0, MAX_HEADER_READ);
  const newlineIdx = maxHeaderBytes.indexOf(10);
  
  const jsonStr = maxHeaderBytes.subarray(0, newlineIdx).toString();
  const metaObj = JSON.parse(jsonStr);
  
  const headerSize = (metaObj.metadata?.channels || metaObj.channels) ? 4096 : 2048;
  const encryptedData = fileData.subarray(headerSize);
  
  const iv = encryptedData.subarray(0, IV_LENGTH);
  const ciphertextWithTag = encryptedData.subarray(IV_LENGTH);
  
  // Tag is last 16 bytes for AES-GCM in most implementations, 
  // but WebCrypto expects them combined. node:crypto needs them separate.
  const tag = ciphertextWithTag.subarray(ciphertextWithTag.length - 16);
  const ciphertext = ciphertextWithTag.subarray(0, ciphertextWithTag.length - 16);

  // Derive key using PBKDF2
  const key = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  
  // Save a chunk of the decrypted data for mocking
  // We'll take a chunk from the spectrum area if possible, or just the first 32KB
  const mockDecrypted = decrypted.subarray(0, 65536);
  
  const outputContent = `export const MOCK_NAPT_DATA_B64 = "${mockDecrypted.toString('base64')}";
export const getMockNaptBuffer = () => Uint8Array.from(Buffer.from(MOCK_NAPT_DATA_B64, "base64"));
`;

  fs.writeFileSync('test/ts/mockNaptData.ts', outputContent);
  console.log('Successfully decrypted and saved mock data to test/ts/mockNaptData.ts');
}

decrypt().catch(console.error);
