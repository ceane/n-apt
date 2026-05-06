import crypto from 'node:crypto';

function check(password, salt) {
    const SALT = Buffer.from(salt);
    const ITERATIONS = 100_000;
    const key = crypto.pbkdf2Sync(password, SALT, ITERATIONS, 32, 'sha256');
    const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 8);
    console.log(`Password: "${password}", Salt: "${salt}" -> ${hash}`);
}

check("your_password", "n-apt-aes-salt-v1");
check("n-apt-dev-key", "n-apt-aes-salt-v1");
check("test-password-123", "n-apt-aes-salt-v1");
check("the_demod_password", "n-apt-aes-salt-v1");
check("the_latex_password", "n-apt-aes-salt-v1");
check("n-apt-dev-key", "n-apt-salt-v1");
check("n-apt-dev-key", "napt-aes-salt-v1");
