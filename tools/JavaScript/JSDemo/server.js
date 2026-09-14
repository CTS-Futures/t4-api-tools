/**
 * Local HTTP dev server for JSDemo.
 * Usage: node server.js [port]   (default port: 8443)
 *
 * Serves the JSDemo static files over HTTP — nothing else.
 */

const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const PORT = parseInt(process.argv[2]) || 8443;
const ROOT = __dirname;

const MIME = {
    '.html' : 'text/html; charset=utf-8',
    '.js'   : 'application/javascript; charset=utf-8',
    '.mjs'  : 'application/javascript; charset=utf-8',
    '.css'  : 'text/css; charset=utf-8',
    '.json' : 'application/json; charset=utf-8',
    '.png'  : 'image/png',
    '.jpg'  : 'image/jpeg',
    '.svg'  : 'image/svg+xml',
    '.ico'  : 'image/x-icon',
    '.wasm' : 'application/wasm',
    '.txt'  : 'text/plain; charset=utf-8',
};

function handler(req, res) {
    let urlPath = req.url.split('?')[0];

    if (urlPath === '/') urlPath = '/index.html';

    const filePath = path.join(ROOT, urlPath);

    // Prevent path traversal
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + urlPath);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

function startServer() {
    const server = http.createServer(handler);
    server.listen(PORT, () => {
        console.log(`\n  HTTP server running at http://localhost:${PORT}\n`);
    });
}

startServer();
