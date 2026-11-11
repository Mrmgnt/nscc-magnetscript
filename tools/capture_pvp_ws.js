const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const out = path.join(__dirname, '..', 'logs', 'pvp_ws_capture.jsonl');
const meta = path.join(__dirname, '..', 'logs', 'pvp_ws_capture_meta.json');
const startedAt = new Date().toISOString();
const stream = fs.createWriteStream(out, { flags: 'w' });
const write = entry => stream.write(JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');

(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:8088');
  const context = browser.contexts()[0];
  const page = context.pages().find(p => p.url().includes('ninjasaga.cc/play'));
  if (!page) throw new Error('Ninja Saga WebView page tidak ditemukan.');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let frames = 0;
  cdp.on('Network.webSocketCreated', event => write({ kind: 'created', requestId: event.requestId, url: event.url }));
  cdp.on('Network.webSocketFrameSent', event => { frames++; write({ kind: 'sent', requestId: event.requestId, opcode: event.response.opcode, payload: event.response.payloadData }); });
  cdp.on('Network.webSocketFrameReceived', event => { frames++; write({ kind: 'received', requestId: event.requestId, opcode: event.response.opcode, payload: event.response.payloadData }); });
  cdp.on('Network.webSocketClosed', event => write({ kind: 'closed', requestId: event.requestId, timestamp: event.timestamp }));
  fs.writeFileSync(meta, JSON.stringify({ status: 'recording', startedAt, out }, null, 2));
  console.log('RECORDING ' + out);
  setTimeout(async () => {
    fs.writeFileSync(meta, JSON.stringify({ status: 'finished', startedAt, finishedAt: new Date().toISOString(), frames, out }, null, 2));
    stream.end();
    await browser.close();
  }, 180000);
})().catch(error => {
  fs.writeFileSync(meta, JSON.stringify({ status: 'error', startedAt, error: error.message, out }, null, 2));
  stream.end();
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
