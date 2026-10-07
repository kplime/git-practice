const { pool, initializeDatabase } = require('../src/db');
const { seedDemo, gatewayId } = require('../src/demo-data');

async function main() {
  const args = process.argv.slice(2);
  const seedOnly = args.includes('--seed-only') || !args.includes('--heartbeat');
  const scenario = args.find((arg) => arg.startsWith('--scenario='))?.split('=')[1] || 'out-of-bed';
  if (!['healthy', 'out-of-bed', 'sensor-offline', 'gateway-offline'].includes(scenario)) throw new Error('Invalid scenario.');
  await initializeDatabase();
  const count = await seedDemo();
  console.log(`Sample events: inserted ${count}; 24 fixtures available. Existing handling records were kept.`);
  if (seedOnly) console.log('Live observation requires a real gateway heartbeat. Sample events do not establish a connection.');
  if (seedOnly) return;

  const apiBase = process.env.API_BASE_URL || `http://127.0.0.1:${process.env.PORT || 3002}`;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(apiBase).hostname)) throw new Error('Run the demo against a local Node server.');
  const token = process.env.GATEWAY_TOKEN;
  if (!token || token.startsWith('replace-with-')) throw new Error('Set GATEWAY_TOKEN first.');
  const { rows: [previous] } = await pool.query('SELECT generation FROM gateways WHERE gateway_id=$1', [gatewayId]);
  const generation = previous.generation + 1;
  const bedExitedAt = new Date(Date.now() - 14 * 60000).toISOString();
  let sequence = 0;
  let stopped = false;
  let timer;
  let wake;
  async function request(route, method = 'GET', payload) {
    const response = await fetch(`${apiBase}/api${route}`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`Demo API response ${response.status}.`);
    return response.json();
  }
  async function heartbeat() {
    const settings = await request('/gateway/settings');
    await request('/ingest/status', 'POST', {
      gatewayId, generation, sequence: sequence++, isDemo: true,
      sensorAvailable: scenario !== 'sensor-offline',
      qualityStatus: scenario === 'sensor-offline' ? 'UNAVAILABLE' : 'AVAILABLE',
      measuredAt: scenario === 'sensor-offline' ? null : new Date().toISOString(),
      bedState: scenario === 'out-of-bed' ? 'OUT_OF_BED' : scenario === 'sensor-offline' ? 'UNKNOWN' : 'IN_BED',
      bedExitedAt: scenario === 'out-of-bed' ? bedExitedAt : null,
      appliedSettingsVersion: settings.version,
    });
  }
  const stop = () => { stopped = true; clearTimeout(timer); wake?.(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  await heartbeat();
  console.log(`Demo heartbeat started (${scenario}). Ctrl+C stops it; connection ages out after 15 seconds.`);
  if (scenario === 'gateway-offline') return;
  while (!stopped) {
    await new Promise((resolve) => { wake = resolve; timer = setTimeout(resolve, 5000); });
    wake = null;
    if (stopped) break;
    try { await heartbeat(); } catch (error) { console.error(error.message); }
  }
  stop();
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
