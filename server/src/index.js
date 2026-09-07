import { createApplication } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const runtime = createApplication({ config });

runtime.httpServer.listen(config.port, () => {
  console.log(`Isabel pronta na porta ${config.port}`);
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`Encerrando com ${signal}`);
  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();
  await runtime.close();
  clearTimeout(forceTimer);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
