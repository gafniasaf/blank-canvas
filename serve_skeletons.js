const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3000;
const FILE_PATH = path.join(__dirname, 'tmp/skeletons_extended.zip');

// Get local IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const server = http.createServer((req, res) => {
  console.log(`Request received: ${req.url}`);
  
  if (req.url === '/skeletons_extended.zip') {
    fs.stat(FILE_PATH, (err, stats) => {
      if (err) {
        console.error('File not found:', err);
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/zip',
        'Content-Length': stats.size,
        'Content-Disposition': 'attachment; filename=skeletons_extended.zip'
      });

      const readStream = fs.createReadStream(FILE_PATH);
      readStream.pipe(res);
    });
  } else {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Server is running. Download at /skeletons_extended.zip');
  }
});

server.listen(PORT, () => {
  const ip = getLocalIp();
  console.log(`\nServer started!`);
  console.log(`File is ready for transfer.`);
  console.log(`Download URL: http://${ip}:${PORT}/skeletons_extended.zip`);
  console.log(`\nPress Ctrl+C to stop the server after the transfer is complete.`);
});




