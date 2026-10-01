const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

function createApp() {
  const rootPath = path.resolve(__dirname, '../..');
  const app = express();
  const server = http.createServer(app);

  app.use(express.json());
  app.use(express.static(path.join(rootPath, 'public')));
  app.use('/img', express.static(path.join(rootPath, 'img')));
  app.use('/shared', express.static(path.join(rootPath, 'shared')));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Game server is running' });
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(rootPath, 'public', 'index.html'));
  });

  const io = new Server(server, {
    cors: {
      origin: false,
      methods: ['GET', 'POST']
    }
  });

  return { app, server, io };
}

module.exports = { createApp };
