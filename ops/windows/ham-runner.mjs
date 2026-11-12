// Baesong-doumi (ham) main server runner for Windows: same job as the Mac LaunchAgent com.nusolvere.ham (KeepAlive).
// Runs C:\srv\ham\server.js as the one main server (HAM_CLOUD_WRITER=1), restarts it when it exits
// or when C:\srv\ham-ops\restart.request is touched (the updater does that).
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const APP = 'C:\\srv\\ham', OPS = 'C:\\srv\\ham-ops', TRIG = path.join(OPS, 'restart.request'), LOGF = 'C:\\srv\\logs\\ham.log';
const out = fs.createWriteStream(LOGF, { flags: 'a' });
const log = (s) => out.write(s + '\n');
const ts = () => new Date().toLocaleString('sv-SE');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mtime = () => { try { return fs.statSync(TRIG).mtimeMs; } catch { return 0; } };
if (!fs.existsSync(TRIG)) fs.writeFileSync(TRIG, '');
const env = { ...process.env, NODE_ENV: 'production', HAM_CLOUD_WRITER: '1', HAM_PORT: '8899' };
let child = null; const alive = (c) => c && c.exitCode === null && c.signalCode === null;
for (;;) {
  log(`=== start ${ts()}`);
  const started = Date.now();
  child = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
  const exited = new Promise((r) => child.once('exit', (code) => r(code)));
  const lastm = mtime(); let asked = false;
  while (alive(child)) {
    await Promise.race([sleep(3000), exited]);
    if (alive(child) && mtime() !== lastm) { log(`=== restart requested ${ts()}`); asked = true; spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']); break; }
  }
  const code = await exited; child = null; log(`=== exit ${ts()} code ${code}`);
  await sleep(!asked && Date.now() - started < 15000 ? 10000 : 1000);
}
