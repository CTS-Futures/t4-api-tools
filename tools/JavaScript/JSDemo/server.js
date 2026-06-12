/**
 * Local HTTPS dev server for JSDemo.
 * Generates a self-signed cert on the fly (no OpenSSL required).
 * Usage: node server.js [port]   (default port: 8443)
 */

const https = require('https');
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

// Try to load selfsigned; install it if missing
function startServer(key, cert) {
    https.createServer({ key, cert }, handler).listen(PORT, () => {
        console.log(`\n  HTTPS server running at https://localhost:${PORT}`);
        console.log('  (Your browser will show a security warning — click Advanced → Proceed)\n');
    });
}

try {
    const selfsigned = require('selfsigned');
    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems  = selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        // SHA-1 (selfsigned's default) is rejected by modern browsers with
        // ERR_SSL_VERSION_OR_CIPHER_MISMATCH. Force SHA-256 and add a
        // subjectAltName for localhost/127.0.0.1 so Chrome will negotiate.
        algorithm: 'sha256',
        extensions: [{
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' }
            ]
        }]
    });
    startServer(pems.private, pems.cert);
} catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
        console.log('Installing selfsigned package (one-time)...');
        const { execSync } = require('child_process');
        execSync('npm install selfsigned --no-save', { stdio: 'inherit', cwd: ROOT });
        const selfsigned = require('selfsigned');
        const attrs = [{ name: 'commonName', value: 'localhost' }];
        const pems  = selfsigned.generate(attrs, {
        days: 365,
        keySize: 2048,
        // SHA-1 (selfsigned's default) is rejected by modern browsers with
        // ERR_SSL_VERSION_OR_CIPHER_MISMATCH. Force SHA-256 and add a
        // subjectAltName for localhost/127.0.0.1 so Chrome will negotiate.
        algorithm: 'sha256',
        extensions: [{
            name: 'subjectAltName',
            altNames: [
                { type: 2, value: 'localhost' },
                { type: 7, ip: '127.0.0.1' }
            ]
        }]
    });
        startServer(pems.private, pems.cert);
    } else {
        throw e;
    }
}
