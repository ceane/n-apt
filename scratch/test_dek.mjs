import crypto from 'node:crypto';

function check(password, salt) {
    const SALT = Buffer.from(salt);
    const ITERATIONS = 100_000;
    const vaultKey = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');

    const wrappedDekB64 = "ynjA9yE07qUw0RzyP+U6fiu3Ugy/1bmNK4s4hKZ9VVQRTr3dWFGkHt5kg9EsHCPG4QYe9yOGi6jykkRQ";
    const wrappedDek = Buffer.from(wrappedDekB64, 'base64');

    const iv = wrappedDek.subarray(0, 12);
    const ciphertext = wrappedDek.subarray(12);

    try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', vaultKey, iv);
        const tag = ciphertext.subarray(ciphertext.length - 16);
        const actualCiphertext = ciphertext.subarray(0, ciphertext.length - 16);
        decipher.setAuthTag(tag);
        
        const decrypted = Buffer.concat([decipher.update(actualCiphertext), decipher.final()]);
        console.log(`Password "${password}" worked! DEK hex: ${decrypted.toString('hex')}`);
        return true;
    } catch (e) {
        return false;
    }
}

const passwords = [
    "n-apt-dev-key",
    "test-password-123",
    "test-password",
    "password",
    "n-apt",
    "your_password"
];

for (const p of passwords) {
    if (check(p, "n-apt-aes-salt-v1")) break;
}
