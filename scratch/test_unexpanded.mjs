import crypto from 'node:crypto';

const password = "$UNSAFE_LOCAL_USER_PASSWORD";
const SALT = Buffer.from("n-apt-aes-salt-v1");
const ITERATIONS = 100_000;

const key = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');
const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 8);

// Script result (logs removed)

