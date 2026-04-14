const { spawnSync } = require('node:child_process');

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const testArgs = process.argv.slice(2);

const testResult = spawnSync(npxCommand, ['playwright', 'test', ...testArgs], {
  stdio: 'inherit',
});

spawnSync(npxCommand, ['playwright', 'show-report'], {
  stdio: 'inherit',
});

if (typeof testResult.status === 'number') {
  process.exit(testResult.status);
}

process.exit(1);