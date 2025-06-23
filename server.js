const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Basic route for the homepage
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

const WebSocket = require('ws');

// Initialize WebSocket server
// We are attaching it to the existing HTTP server
const wss = new WebSocket.Server({ server }); // server is the http.createServer instance

console.log('WebSocket server created.');

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket server.');

  ws.on('message', (message) => {
    console.log('Received message from client:', message.toString());
    // Broadcast message to all clients (including sender for this basic example)
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log('Client disconnected from WebSocket server.');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });

  ws.send('Welcome to the WebSocket server!');
});

module.exports = server;
