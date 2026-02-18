#!/usr/bin/env node
/**
 * Simple file server for transferring files over the network
 * 
 * Usage:
 *   node scripts/file-server.js <file_path> [port]
 * 
 * Example:
 *   node scripts/file-server.js output/af4_pathologie_labeled_images.zip 3333
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const filePath = process.argv[2];
const port = parseInt(process.argv[3]) || 3333;

if (!filePath) {
  console.error('Usage: node file-server.js <file_path> [port]');
  process.exit(1);
}

const absolutePath = path.resolve(filePath);

if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

const stats = fs.statSync(absolutePath);
const fileName = path.basename(absolutePath);
const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(1);

// Get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === `/${fileName}`) {
    console.log(`[${new Date().toISOString()}] Download started from ${req.socket.remoteAddress}`);
    
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stats.size);
    
    const stream = fs.createReadStream(absolutePath);
    let downloaded = 0;
    
    stream.on('data', (chunk) => {
      downloaded += chunk.length;
      const percent = ((downloaded / stats.size) * 100).toFixed(1);
      process.stdout.write(`\r  Progress: ${percent}% (${(downloaded / 1024 / 1024).toFixed(1)} MB / ${fileSizeMB} MB)`);
    });
    
    stream.on('end', () => {
      console.log('\n  Download complete!');
    });
    
    stream.pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found. Use / or /' + fileName);
  }
});

server.listen(port, '0.0.0.0', () => {
  const ips = getLocalIPs();
  
  console.log('');
  console.log('===========================================');
  console.log('  FILE SERVER READY');
  console.log('===========================================');
  console.log(`  File: ${fileName}`);
  console.log(`  Size: ${fileSizeMB} MB`);
  console.log(`  Port: ${port}`);
  console.log('');
  console.log('  Download URLs:');
  ips.forEach(ip => {
    console.log(`    http://${ip}:${port}/${fileName}`);
  });
  console.log('');
  console.log('  Press Ctrl+C to stop the server');
  console.log('===========================================');
  console.log('');
});





