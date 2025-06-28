const express = require('express');
const path = require('path');

const app = express();
const PORT = 3002;

// Serve static files like Tarro.png
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'time.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Server running at http://messageboard-svr-dgt1-1.prod.letsdowonders.io:${PORT}`);
});
