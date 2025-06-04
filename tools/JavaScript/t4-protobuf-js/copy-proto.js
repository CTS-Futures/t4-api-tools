const fs = require('fs');
const path = require('path');

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) return;

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        fs.readdirSync(src).forEach(item => {
            copyRecursive(path.join(src, item), path.join(dest, item));
        });
    } else {
        fs.copyFileSync(src, dest);
    }
}

const srcDir = path.resolve('../../../proto');
const destDir = 'src/proto';

fs.mkdirSync('src/generated', { recursive: true });
copyRecursive(srcDir, destDir);
console.log('Copied proto directory structure');