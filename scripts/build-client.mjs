import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const hasClient = existsSync('client/package.json');

if (hasClient) {
  for (const args of [['install'], ['run', 'build']]) {
    const result = spawnSync('npm', args, { cwd: 'client', stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  if (!existsSync('client/dist/index.html')) {
    console.error('The client build did not produce client/dist/index.html. Check the Vite config (outDir should be "dist").');
    process.exit(1);
  }
} else {
  mkdirSync('client/dist', { recursive: true });
  writeFileSync(
    'client/dist/index.html',
    `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Market Platform API</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 40rem; margin: 4rem auto; padding: 0 1rem; line-height: 1.5">
  <h1>The API is running</h1>
  <p>The Vue frontend has not been added to this deployment yet.</p>
  <ul>
    <li><a href="/api/docs">API documentation</a></li>
    <li><a href="/api/health">Health check</a></li>
    <li><a href="/api/market">Market details (JSON)</a></li>
  </ul>
</body>
</html>
`,
  );
  console.log('No client/package.json found: wrote a placeholder page to client/dist/index.html');
}
