const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../scripts/rename-db.js'), 'utf8');

function harness(options = {}) {
  const state = {
    names: [...(options.names || ['wifi_csi_safety'])],
    env: 'PGDATABASE=wifi_csi_safety\r\nPGPASSWORD=local-secret\r\nPORT=3002\r\n',
    renamed: false,
    writes: 0,
  };
  class Client {
    constructor(config) { this.database = config.database; }
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes('FROM pg_database')) return { rows: state.names.map(datname => ({ datname, owner: options.owner || 'wifi_csi_app' })) };
      if (sql.includes('FROM pg_stat_activity')) return { rowCount: options.busy ? 1 : 0 };
      if (sql.startsWith('ALTER DATABASE')) {
        if (options.denied) throw Object.assign(new Error('permission denied'), { code: '42501' });
        state.names = ['onguard']; state.renamed = true; return {};
      }
      if (sql.includes('current_database()')) {
        assert.ok(state.names.includes(this.database), 'verification must connect to an existing database');
        return { rows: [{ database: this.database, gateways: '1', events: '24', event_actions: '30', settings: [{ version: 5, non_return_minutes: 10 }] }] };
      }
      throw new Error('Unexpected query');
    }
  }
  const loaded = { exports: {} };
  const requireMock = name => name === 'pg' ? { Client } : name === 'node:fs' ? {
    readFileSync: () => state.env,
    writeFileSync: (_, value) => {
      if (state.failWrite) throw Object.assign(new Error('write denied'), { code: 'EACCES' });
      state.env = value; ++state.writes;
    },
  } : require(name);
  vm.runInNewContext(source, {
    require: requireMock, module: loaded, __dirname: path.join(__dirname, '../scripts'),
    process: { env: { PGDATABASE: 'wifi_csi_safety', PGUSER: 'wifi_csi_app', PGPASSWORD: 'local-secret' } },
    console: { log() {}, error() {} },
  });
  return { state, run: loaded.exports.renameDatabase };
}

test('database rename preserves local credentials and only updates configuration after verification', async () => {
  const { state, run } = harness();
  await run();
  assert.equal(state.renamed, true);
  assert.equal(state.env, 'PGDATABASE=onguard\r\nPGPASSWORD=local-secret\r\nPORT=3002\r\n');
  assert.equal(state.writes, 1);
});

for (const [name, options, expected] of [
  ['both database names exist', { names: ['wifi_csi_safety', 'onguard'] }, /Both database names/],
  ['another client is connected', { busy: true }, /Close the Node server/],
  ['database belongs to another role', { owner: 'another_app' }, /Unexpected database owner/],
  ['administrator lacks rename permission', { denied: true }, /permission denied/],
]) test(`rename leaves database and configuration intact when ${name}`, async () => {
  const { state, run } = harness(options);
  await assert.rejects(run, expected);
  assert.equal(state.renamed, false);
  assert.equal(state.writes, 0);
  assert.match(state.env, /PGDATABASE=wifi_csi_safety/);
});

test('rerun recovers a renamed database after configuration write failure', async () => {
  const { state, run } = harness();
  state.failWrite = true;
  await assert.rejects(run, /write denied/);
  assert.equal(state.renamed, true);
  assert.match(state.env, /PGDATABASE=wifi_csi_safety/);
  state.failWrite = false;
  await run();
  assert.equal(state.writes, 1);
  assert.match(state.env, /PGDATABASE=onguard/);
});
