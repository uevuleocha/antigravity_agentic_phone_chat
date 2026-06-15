import WebSocket from 'ws';
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
  const list = await getJson('http://127.0.0.1:9000/json/list');
  const target = list.find(t => t.title && t.title.includes('Testing Question Dialog'));
  if (!target) { console.log('Not found'); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));
  let id = 1;
  const pending = new Map();
  ws.on('message', (msg) => {
    const d = JSON.parse(msg.toString());
    if (d.id !== undefined && pending.has(d.id)) {
      const { resolve, reject, tid } = pending.get(d.id);
      clearTimeout(tid);
      pending.delete(d.id);
      if (d.error) reject(new Error(JSON.stringify(d.error)));
      else resolve(d.result);
    }
  });
  const call = (method, params) => new Promise((resolve, reject) => {
    const mid = id++;
    const tid = setTimeout(() => { pending.delete(mid); reject(new Error('timeout')); }, 15000);
    pending.set(mid, { resolve, reject, tid });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await call('Runtime.enable', {});
  await new Promise(r => setTimeout(r, 1000));

  // Get the outerHTML of the "Waiting for user input" container and its parents
  // Also capture the input section structure for when dialog IS active
  const SCRIPT = `(() => {
    const res = {};

    // The "Waiting for user input..." element - capture its full parent chain
    const waitingEl = Array.from(document.querySelectorAll('*')).find(el => 
      (el.innerText || '').trim() === 'Waiting for user input...' && el.offsetHeight > 0
    );

    if (waitingEl) {
      res.waitingElement = {
        tag: waitingEl.tagName,
        className: waitingEl.className,
        text: waitingEl.innerText,
        outerHTML: waitingEl.outerHTML.substring(0, 300)
      };

      // Walk up 8 levels to understand the container chain
      let chain = [];
      let el = waitingEl;
      for (let i = 0; i < 10; i++) {
        if (!el) break;
        chain.push({
          level: i,
          tag: el.tagName,
          className: (el.className || '').toString().substring(0, 120),
          dataTestId: el.getAttribute('data-testid'),
          childCount: el.children.length,
          text_preview: (el.innerText || '').substring(0, 100)
        });
        el = el.parentElement;
      }
      res.parentChain = chain;
    } else {
      res.waitingElement = 'NOT FOUND - dialog may be answered already';
    }

    // Get the full input bottom section HTML
    // Look for the permission dialog container - walk from bottom of conversation-view parent
    const convView = document.querySelector('[data-testid="conversation-view"]');
    if (convView) {
      const convParent = convView.parentElement;
      res.convViewParentClass = convParent ? (convParent.className || '').toString() : null;
      
      // Get all siblings of conversation-view
      if (convParent) {
        res.convSiblings = Array.from(convParent.children).map(c => ({
          tag: c.tagName,
          className: (c.className || '').toString().substring(0, 150),
          dataTestId: c.getAttribute('data-testid'),
          text: (c.innerText || '').substring(0, 300),
          visible: c.offsetHeight > 0,
          height: c.offsetHeight
        }));
      }
    }

    // Full page innerText to see what's there now
    res.fullPageText = document.body.innerText.substring(0, 2000);

    // Find the skip/submit button area
    const skipBtns = Array.from(document.querySelectorAll('button')).filter(b => {
      const t = (b.innerText || '').trim();
      return t === 'Skip' || t === 'Submit';
    }).map(b => ({
      text: b.innerText.trim(),
      className: (b.className || '').toString().substring(0, 150),
      parentHTML: b.parentElement ? b.parentElement.outerHTML.substring(0, 600) : null
    }));
    res.skipSubmitButtons = skipBtns;

    return JSON.stringify(res, null, 2);
  })()`;

  const r = await call('Runtime.evaluate', { expression: SCRIPT, returnByValue: true });
  if (r && r.result && r.result.value) console.log(r.result.value);
  else console.log(JSON.stringify(r));
  ws.close();
}
run().catch(e => console.error(e.message));
