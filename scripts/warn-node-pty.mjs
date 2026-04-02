import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const userAgent = process.env.npm_config_user_agent ?? '';
const isPnpmInstall = userAgent.includes('pnpm/');

function hasNodePty() {
  try {
    require('node-pty');
    return true;
  } catch {
    return false;
  }
}

if (!hasNodePty()) {
  console.log('Note: node-pty is not available for this install.');
  if (isPnpmInstall) {
    console.log('  Run: pnpm approve-builds');
    console.log('  Then select: node-pty');
  }
  console.log('Alternative: npm install node-pty');
}
