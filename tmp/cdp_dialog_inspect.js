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
  // Directly target the "Testing Question Dialog Tool" conversation
  const list = await getJson('http://127.0.0.1:9000/json/list');
  const target = list.find(t => t.title && t.title.includes('Testing Question Dialog'));
  if (!target) {
    console.log('Target not found. Available:', list.map(t => t.title).join(', '));
    return;
  }
  console.log('Connecting to:', target.title);

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
    const tid = setTimeout(() => { pending.delete(mid); reject(new Error('timeout: ' + method)); }, 15000);
    pending.set(mid, { resolve, reject, tid });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await call('Runtime.enable', {});
  await new Promise(r => setTimeout(r, 1000));

  const SCRIPT = `(() => {
    const results = {};

    // 1. All role=dialog elements
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    results.roleDialogs = dialogs.map(d => ({
      tag: d.tagName,
      id: d.id || null,
      className: (d.className || '').toString().substring(0, 150),
      dataTestId: d.getAttribute('data-testid') || null,
      text: (d.innerText || '').substring(0, 600),
      visible: d.offsetHeight > 0,
      childCount: d.children.length
    }));

    // 2. Body direct children
    results.bodyChildren = Array.from(document.body.children).map(c => ({
      tag: c.tagName,
      id: c.id || null,
      className: (c.className || '').toString().substring(0, 100),
      visible: c.offsetHeight > 0,
      childCount: c.children.length
    }));

    // 3. Text scan for permission/ask-user keywords
    const all = Array.from(document.querySelectorAll('*'));
    const keywords = ['allow running', 'yes, allow', 'waiting for user', 'allow this time',
                      'no (tell the agent', 'submit', 'other', 'allow?', 'permission',
                      'option 1', 'option 2', '1 yes', '2 no'];
    const candidates = all.filter(el => {
      const t = (el.innerText || '').toLowerCase();
      return keywords.some(kw => t.includes(kw)) && el.children.length < 30 && el.offsetHeight > 0;
    });

    results.candidates = candidates.slice(0, 25).map(el => ({
      tag: el.tagName,
      id: el.id || null,
      dataTestId: el.getAttribute('data-testid') || null,
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      className: (el.className || '').toString().substring(0, 150),
      text: (el.innerText || '').substring(0, 400),
      parentTag: el.parentElement ? el.parentElement.tagName : null,
      parentClass: el.parentElement ? (el.parentElement.className || '').toString().substring(0, 100) : null,
      parentTestId: el.parentElement ? (el.parentElement.getAttribute('data-testid') || null) : null,
      rect: (() => {
        const r = el.getBoundingClientRect();
        return { top: Math.round(r.top), left: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height) };
      })()
    }));

    // 4. Submit / action buttons
    const btns = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => el.offsetHeight > 0)
      .slice(0, 30)
      .map(el => ({
        tag: el.tagName,
        type: el.getAttribute('type') || null,
        text: (el.innerText || '').substring(0, 80),
        className: (el.className || '').toString().substring(0, 120),
        dataTestId: el.getAttribute('data-testid') || null,
        ariaLabel: el.getAttribute('aria-label') || null
      }));
    results.buttons = btns;

    // 5. Any numbered list items (1, 2, 3 options)
    const listItems = Array.from(document.querySelectorAll('li, [role="option"], [role="listitem"]'))
      .filter(el => el.offsetHeight > 0)
      .map(el => ({
        tag: el.tagName,
        role: el.getAttribute('role') || null,
        text: (el.innerText || '').substring(0, 150),
        className: (el.className || '').toString().substring(0, 100),
        dataTestId: el.getAttribute('data-testid') || null
      }));
    results.listItems = listItems;

    return JSON.stringify(results, null, 2);
  })()`;

  const res = await call('Runtime.evaluate', { expression: SCRIPT, returnByValue: true });

  if (res && res.result && res.result.value) {
    console.log('--- DOM RESULT ---');
    console.log(res.result.value);
  } else {
    console.log('No result:', JSON.stringify(res));
  }

  ws.close();
}

run().catch(e => console.error('ERROR:', e.message));
