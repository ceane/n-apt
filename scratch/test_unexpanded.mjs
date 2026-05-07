import crypto from 'node:crypto';

const password = "$UNSAFE_LOCAL_USER_PASSWORD";
const SALT = Buffer.from("n-apt-aes-salt-v1");
const ITERATIONS = 600_000;

const key = crypto.scryptSync(password, SALT, 32, { N: 131072, r: 8, p: 1 });
const hash = key.toString('hex');

// Script result (logs removed)

