const express = require('express');
const pm2 = require('pm2');
const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));

function pm2Connect() {
  return new Promise((resolve, reject) => {
    pm2.connect(err => (err ? reject(err) : resolve()));
  });
}

function pm2Disconnect() {
  pm2.disconnect();
}

function listProcesses() {
  return new Promise((resolve, reject) => {
    pm2.list((err, list) => (err ? reject(err) : resolve(list)));
  });
}

function stopProcess(id) {
  return new Promise((resolve, reject) => {
    pm2.stop(id, err => (err ? reject(err) : resolve()));
  });
}

function restartProcess(id) {
  return new Promise((resolve, reject) => {
    pm2.restart(id, err => (err ? reject(err) : resolve()));
  });
}

app.get('/', async (req, res) => {
  try {
    await pm2Connect();
    let processes = await listProcesses();
    const processNames = processes.map(p => p.name);
    console.log('?? Detected PM2 processes:', processNames);
    
    // Added "media-player" here
    const allowedNames = ['dual-message-board', 'message-board', 'time-viewer', 'media-player-single', 'media-player-dual'];
    processes = processes.filter(p => allowedNames.includes(p.name));
    pm2Disconnect();

    const now = new Date().toLocaleTimeString();

    // Added media-player URL here
    const urlMap = {
      'dual-message-board': 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3003/index.html',
      'message-board': 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3001/viewer.html',
      'time-viewer': 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3002/time.html',
      'media-player-single': 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3004/viewer.html',
      'media-player-dual': 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3005/viewer.html'
    };

    let html = `
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Monitoring Dashboard</title>
      <style>
        body {
          font-family: 'Segoe UI', sans-serif;
          background: #ecf0f1;
          margin: 0;
          padding: 20px;
        }
        h1 {
          text-align: center;
          color: #2c3e50;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          background: #fff;
          box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          border-radius: 8px;
          overflow: hidden;
        }
        th {
          background-color: #34495e;
          color: #ecf0f1;
          padding: 12px;
        }
        td {
          text-align: center;
          padding: 12px;
          border-bottom: 1px solid #ccc;
        }
        .status-online {
          color: green;
          font-weight: bold;
        }
        .status-stopped {
          color: red;
          font-weight: bold;
        }
        button {
          padding: 6px 12px;
          margin: 2px;
          background: #3498db;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:hover {
          background: #2980b9;
        }
        .footer {
          text-align: center;
          margin-top: 20px;
          color: #7f8c8d;
        }
      </style>
    </head>
    <body>
      <h1>Monitoring Dashboard</h1>
      <table>
        <tr>
          <th>ID</th>
          <th>Name</th>
          <th>Status</th>
          <th>CPU %</th>
          <th>Memory (MB)</th>
          <th>Actions</th>
        </tr>`;

    processes.forEach(p => {
      const statusClass = p.pm2_env.status === 'online' ? 'status-online' : 'status-stopped';
      const link = urlMap[p.name] ? `<a href="${urlMap[p.name]}" target="_blank" rel="noopener noreferrer">${p.name}</a>` : p.name;

      html += `
        <tr>
          <td>${p.pm_id}</td>
          <td>${link}</td>
          <td class="${statusClass}">${p.pm2_env.status.toUpperCase()}</td>
          <td>${p.monit.cpu.toFixed(1)}</td>
          <td>${(p.monit.memory / 1024 / 1024).toFixed(1)}</td>
          <td>
            <form method="POST" action="/stop" style="display:inline;">
              <input type="hidden" name="id" value="${p.pm_id}">
              <button>Stop</button>
            </form>
            <form method="POST" action="/restart" style="display:inline;">
              <input type="hidden" name="id" value="${p.pm_id}">
              <button>Restart</button>
            </form>
          </td>
        </tr>`;
    });

    html += `
      </table>
      <div class="footer">
        Refreshed: ${now} | Auto-refreshes every 5 seconds
      </div>
      <script>
        setTimeout(() => { window.location.reload(); }, 5000);
      </script>
    </body>
    </html>`;

    res.setHeader('Cache-Control', 'no-store');
    res.send(html);

  } catch (error) {
    console.error('? Error in GET /:', error);
    res.status(500).send('Error: ' + error.message);
  }
});

app.post('/stop', async (req, res) => {
  const id = req.body.id;
  try {
    await pm2Connect();
    await stopProcess(id);
    pm2Disconnect();
    res.redirect('/');
  } catch (error) {
    console.error('? Error stopping process:', error);
    res.status(500).send('Stop Error: ' + error.message);
  }
});

app.post('/restart', async (req, res) => {
  const id = req.body.id;
  try {
    await pm2Connect();
    await restartProcess(id);
    pm2Disconnect();
    res.redirect('/');
  } catch (error) {
    console.error('? Error restarting process:', error);
    res.status(500).send('Restart Error: ' + error.message);
  }
});

app.listen(port, () => {
  console.log(`?? PM2 Dashboard running at http://messageboard-svr-dgt1-1.prod.letsdowonders.io:${port}`);
});
