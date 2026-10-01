const { server, PORT } = require('./backend/src/createBackend');

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
