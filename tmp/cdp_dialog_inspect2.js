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
  if (!target) { console.log('Target not found:', list.map(t=>t.title)); return; }
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

  // Get the full innerText of the whole page to understand what's visible
  const SCRIPT = `(() => {
    const results = {};

    // Full page text (trimmed)
    results.pageText = document.body.innerText.substring(0, 3000);

    // Every element that has "Submit" or numbered option text
    const all = Array.from(document.querySelectorAll('*'));
    
    // Find elements specifically containing "Submit" button
    const submitEls = all.filter(el => {
      const t = (el.innerText || '').trim();
      return (t === 'Submit' || t === 'Skip') && el.offsetHeight > 0;
    }).map(el => ({
      tag: el.tagName,
      text: el.innerText.trim(),
      className: (el.className || '').toString().substring(0, 150),
      dataTestId: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
      parentHTML: el.parentElement ? el.parentElement.outerHTML.substring(0, 500) : null
    }));
    results.submitElements = submitEls;

    // Find the ask_question container - look for numbered options
    const numberedOptions = all.filter(el => {
      const t = (el.innerText || '').trim();
      return /^[0-9]+\s/.test(t) && t.length < 200 && el.children.length < 5 && el.offsetHeight > 0;
    }).slice(0, 20).map(el => ({
      tag: el.tagName,
      text: el.innerText.trim().substring(0, 150),
      className: (el.className || '').toString().substring(0, 150),
      dataTestId: el.getAttribute('data-testid'),
      role: el.getAttribute('role'),
      parentTag: el.parentElement ? el.parentElement.tagName : null,
      parentClass: el.parentElement ? (el.parentElement.className || '').toString().substring(0,100) : null,
      rect: (() => { const r = el.getBoundingClientRect(); return {top:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height)}; })()
    }));
    results.numberedOptions = numberedOptions;

    // Find any element with 'ask_question' or 'ask-question' data attributes or class
    const askEls = all.filter(el => {
      const cls = (el.className || '').toString().toLowerCase();
      const tid = (el.getAttribute('data-testid') || '').toLowerCase();
      const t = (el.innerText || '').toLowerCase();
      return cls.includes('question') || tid.includes('question') || t.includes('allow?') || t.includes('option 1') || t.includes('1 yes');
    }).slice(0, 10).map(el => ({
      tag: el.tagName,
      className: (el.className || '').toString().substring(0, 150),
      dataTestId: el.getAttribute('data-testid'),
      text: (el.innerText || '').substring(0, 300),
      outerHTML: el.outerHTML.substring(0, 600)
    }));
    results.askElements = askEls;

    // Check if there's currently a waiting-for-input indicator
    const inputAreas = all.filter(el => {
      const t = (el.innerText || '').toLowerCase();
      return (t.includes('waiting for user input') || t.includes('waiting for input')) && el.offsetHeight > 0 && el.children.length < 10;
    }).map(el => ({
      tag: el.tagName,
      text: el.innerText.trim().substring(0, 200),
      className: (el.className || '').toString().substring(0, 120)
    }));
    results.waitingIndicators = inputAreas;

    // Get all currently visible text in the bottom input section
    const inputSection = document.querySelector('[data-testid="conversation-view"]');
    if (inputSection) {
      // Look for the input area below the conversation
      const parent = inputSection.parentElement;
      if (parent) {
        results.inputAreaSiblings = Array.from(parent.children).map(c => ({
          tag: c.tagName,
          className: (c.className || '').toString().substring(0, 100),
          text: (c.innerText || '').substring(0, 300),
          visible: c.offsetHeight > 0,
          dataTestId: c.getAttribute('data-testid')
        }));
      }
    }

    return JSON.stringify(results, null, 2);
  })()`;

  const res = await call('Runtime.evaluate', { expression: SCRIPT, returnByValue: true });
  if (res && res.result && res.result.value) {
    console.log(res.result.value);
  } else {
    console.log('No value:', JSON.stringify(res));
  }
  ws.close();
}

run().catch(e => console.error('ERROR:', e.message));
