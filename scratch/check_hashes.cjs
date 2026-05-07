const crypto = require('crypto');
const SALT = Buffer.from("n-apt-aes-salt-v1");

function getHash(password, iterations) {
  const vaultKey = crypto.pbkdf2Sync(password, SALT, iterations, 32, 'sha256');
  return crypto.createHash('sha256').update(vaultKey).digest('hex').substring(0, 8);
}

const password = 'n-apt-dev-key';
console.log(`'${password}' with 1000 iterations -> ${getHash(password, 1000)}`);
console.log(`'${password}' with 10000 iterations -> ${getHash(password, 10000)}`);
