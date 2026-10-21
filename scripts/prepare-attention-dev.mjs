// Offline one-time generation of development-only secrets.
// Uses the Node.js already installed on the owner's Windows PC; no remote API calls.
// Writes only to the project checkout. Never displays credentials or overwrites a file.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const compose = join(projectRoot, 'docker-compose.cc-dev.yml');
const target = join(projectRoot, '.env.cc-dev');

if (!existsSync(compose)) {
  console.error('Missing development Compose file; run from the Mail Command Centre checkout.');
  process.exitCode = 1;
} else if (existsSync(target)) {
  console.log('Development secrets already exist. Left them unchanged.');
} else {
  const secret = bytes => randomBytes(bytes).toString('hex');
  const config = [
    '# Local-only synthetic development. DO NOT commit or copy to your normal MailFlow.',
    'CC_DEV_SESSION_SECRET=' + secret(48),
    'CC_DEV_DB_PASSWORD=' + secret(24),
    'CC_DEV_ENCRYPTION_KEY=' + secret(32),
    '',
  ].join('\n');
  let fd;
  try {
    fd = openSync(target, 'wx', 0o600);
    writeSync(fd, config);
    console.log('Created .env.cc-dev with unique random development secrets (values hidden).');
    console.log('Only use with docker-compose.cc-dev.yml.');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      console.log('Development secrets already exist. Left them unchanged.');
    } else {
      console.error('Could not create the development environment file.');
      process.exitCode = 1;
    }
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
