const express = require('express');
const path = require('path');

const app = express();
const port = 3000;

// Serve static files from the exact path where your viewer.html is
app.use(express.static(path.join('/home/itops/message-board/public')));

app.listen(port, () => {
  console.log(`Server running at http://messageboard-svr-dgt1-1.prod.letsdowonders.io:${port}/`);
});
