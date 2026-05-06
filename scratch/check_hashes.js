const crypto = require('crypto');
const SALT = Buffer.from("n-apt-aes-salt-v1");
const ITERATIONS = 100_000;

function getHash(password) {
  const vaultKey = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');
  return crypto.createHash('sha256').update(vaultKey).digest('hex').substring(0, 8);
}

console.log('n-apt-dev-key:', getHash('n-apt-dev-key'));
console.log('$UNSAFE_LOCAL_USER_PASSWORD:', getHash('$UNSAFE_LOCAL_USER_PASSWORD'));
console.log('empty string:', getHash(''));
console.log('space:', getHash(' '));
