#!/usr/bin/env node
/**
 * Simple HTTP file server to transfer a file over local WiFi.
 * Usage: node serve-file.js [file_path] [port]
 * 
 * Defaults:
 *   file_path: ~/Desktop/Updated images.zip
 *   port: 8899
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_FILE = path.join(os.homedir(), 'Desktop', 'Updated images.zip');
const DEFAULT_PORT = 8899;

const filePath = process.argv[2] || DEFAULT_FILE;
const port = parseInt(process.argv[3], 10) || DEFAULT_PORT;

// Get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push({ name, address: iface.address });
      }
    }
  }
  return ips;
}

// Verify file exists
if (!fs.existsSync(filePath)) {
  console.error(`\n❌ File not found: ${filePath}\n`);
  process.exit(1);
}

const stats = fs.statSync(filePath);
const fileName = path.basename(filePath);
const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(1);

const server = http.createServer((req, res) => {
  // Handle download request
  if (req.url === '/download' || req.url === `/${encodeURIComponent(fileName)}`) {
    console.log(`\n📥 Download started: ${req.socket.remoteAddress}`);
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', stats.size);
    
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    
    stream.on('end', () => {
      console.log(`✅ Download complete: ${fileName}`);
    });
    
    stream.on('error', (err) => {
      console.error(`❌ Stream error: ${err.message}`);
      res.end();
    });
    
    return;
  }
  
  // Landing page with download link
  const localIPs = getLocalIPs();
  const downloadUrl = `http://${localIPs[0]?.address || 'localhost'}:${port}/download`;
  
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`
<!DOCTYPE html>
<html>
<head>
  <title>File Transfer</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    .file-info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .download-btn { display: inline-block; background: #007AFF; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-size: 18px; }
    .download-btn:hover { background: #0056b3; }
    code { background: #e8e8e8; padding: 2px 6px; border-radius: 4px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 15px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>📦 File Transfer</h1>
  <div class="file-info">
    <strong>File:</strong> ${fileName}<br>
    <strong>Size:</strong> ${fileSizeMB} MB
  </div>
  <p><a href="/download" class="download-btn">⬇️ Download File</a></p>
  
  <h2>For AI Agent (curl)</h2>
  <pre>curl -o "${fileName}" "${downloadUrl}"</pre>
  
  <h2>For wget</h2>
  <pre>wget -O "${fileName}" "${downloadUrl}"</pre>
</body>
</html>
  `);
});

server.listen(port, '0.0.0.0', () => {
  const localIPs = getLocalIPs();
  
  console.log('\n' + '='.repeat(60));
  console.log('📡 FILE TRANSFER SERVER RUNNING');
  console.log('='.repeat(60));
  console.log(`\n📄 File: ${filePath}`);
  console.log(`📦 Size: ${fileSizeMB} MB`);
  console.log(`\n🌐 Available at:\n`);
  
  for (const ip of localIPs) {
    console.log(`   http://${ip.address}:${port}/download  (${ip.name})`);
  }
  console.log(`   http://localhost:${port}/download  (this machine)`);
  
  console.log('\n' + '-'.repeat(60));
  console.log('📋 INSTRUCTIONS FOR AI AGENT ON OTHER COMPUTER:');
  console.log('-'.repeat(60));
  
  const primaryIP = localIPs[0]?.address || 'localhost';
  console.log(`
Run this command to download the file:

  curl -o "Updated images.zip" "http://${primaryIP}:${port}/download"

Or with wget:

  wget -O "Updated images.zip" "http://${primaryIP}:${port}/download"

After download, unzip with:

  unzip "Updated images.zip" -d "Updated images"
`);
  console.log('='.repeat(60));
  console.log('Press Ctrl+C to stop the server when transfer is complete.\n');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${port} is already in use. Try a different port:\n   node serve-file.js "${filePath}" ${port + 1}\n`);
  } else {
    console.error(`\n❌ Server error: ${err.message}\n`);
  }
  process.exit(1);
});






