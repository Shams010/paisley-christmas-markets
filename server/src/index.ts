// Local dev server (npm run dev). Vercel doesn't use this file, it uses api/index.ts.
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`API running at http://localhost:${config.port}/api  (docs: http://localhost:${config.port}/api/docs)`);
});
