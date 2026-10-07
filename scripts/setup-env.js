const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const target = path.join(root, '.env');
if (fs.existsSync(target)) {
  console.log('.env already exists; kept existing settings.');
} else {
  const content = fs.readFileSync(path.join(root, '.env.example'), 'utf8')
    .replace('replace-with-a-local-database-password', crypto.randomBytes(24).toString('hex'))
    .replace('replace-with-a-long-random-secret', crypto.randomBytes(32).toString('hex'));
  fs.writeFileSync(target, content, { flag: 'wx', mode: 0o600 });
  console.log('Created .env with new project credentials. Run npm.cmd run db:setup next.');
}
