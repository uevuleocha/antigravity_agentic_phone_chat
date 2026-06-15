import http from 'http';

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}

async function run() {
  const ports = [9000, 9001, 9002, 9003];
  for (const port of ports) {
    try {
      const list = await getJson('http://127.0.0.1:' + port + '/json/list');
      console.log(`\n=== PORT ${port} — ${list.length} targets ===`);
      list.forEach((t, i) => {
        console.log(`[${i}] type=${t.type} | title="${t.title}" | url="${(t.url || '').substring(0, 80)}" | wsUrl="${t.webSocketDebuggerUrl ? 'YES' : 'NO'}"`);
      });
    } catch(e) {
      console.log(`Port ${port}: ${e.message}`);
    }
  }
}

run();
