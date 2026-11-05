'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { getInventory, getLabels, saveLabels, LOGS_DIR } = require('./captcha_inventory');
const { runOfflineTests } = require('./captcha_runner');

const PORT = parseInt(process.env.PORT || process.argv.find((_, i, arr) => arr[i - 1] === '--port') || '3333', 10);
const HTML_FILE = path.join(__dirname, 'captcha_gallery.html');

const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url, true);
    const pathname = parsed.pathname;

    // CORS headers for local review
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (pathname === '/' || pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(HTML_FILE).pipe(res);
    }

    if (pathname === '/api/inventory' && req.method === 'GET') {
        try {
            const inventory = getInventory();
            const labels = getLabels();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ inventory, labels }));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    if (pathname === '/api/save' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const labels = JSON.parse(body);
                saveLabels(labels);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, count: Object.keys(labels).length }));
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: err.message }));
            }
        });
        return;
    }

    if (pathname === '/api/test' && req.method === 'GET') {
        try {
            const report = runOfflineTests();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify(report));
        } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    if (pathname.startsWith('/images/')) {
        const imgName = path.basename(pathname);
        const imgPath = path.join(LOGS_DIR, imgName);
        if (fs.existsSync(imgPath)) {
            const ext = path.extname(imgName).toLowerCase();
            const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
            res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' });
            return fs.createReadStream(imgPath).pipe(res);
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Image not found');
        }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
});

if (require.main === module) {
    server.listen(PORT, '127.0.0.1', () => {
        console.log('========================================================');
        console.log(` Ninja Saga Captcha Offline Review Server`);
        console.log(` Open URL: http://127.0.0.1:${PORT}`);
        console.log(` Logs directory: ${LOGS_DIR}`);
        console.log('========================================================');
    });
}

module.exports = { server, PORT };

