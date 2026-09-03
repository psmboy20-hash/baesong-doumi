'use strict';

const fs = require('fs');
const path = require('path');

function writeJsonAtomic(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

function appendAudit(file, event) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file) && fs.statSync(file).size > 5 * 1024 * 1024) {
    const old = file.replace(/(\.[^.]+)?$/, '.1$1');
    if (fs.existsSync(old)) fs.unlinkSync(old);
    fs.renameSync(file, old);
  }
  const row = { ts: new Date().toISOString() };
  for (const key of ['action', 'ref', 'count', 'status', 'actor', 'rev', 'type']) {
    if (event[key] !== undefined && event[key] !== '') row[key] = event[key];
  }
  fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8');
}

function createMutationQueue() {
  let tail = Promise.resolve();
  let queued = 0;
  let running = false;
  let activeSince = 0;
  let lastCompletedAt = 0;
  return {
    run(work) {
      queued += 1;
      const execute = async () => {
        queued -= 1;
        running = true;
        activeSince = Date.now();
        try {
          return await work();
        } finally {
          running = false;
          activeSince = 0;
          lastCompletedAt = Date.now();
        }
      };
      const result = tail.then(execute, execute);
      tail = result.catch(() => {});
      return result;
    },
    status(now) {
      const at = Number(now) || Date.now();
      return {
        running,
        queued,
        activeSince: activeSince || null,
        activeForMs: running && activeSince ? Math.max(0, at - activeSince) : 0,
        lastCompletedAt: lastCompletedAt || null
      };
    }
  };
}

module.exports = { writeJsonAtomic, appendAudit, createMutationQueue };
