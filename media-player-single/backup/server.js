const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = 3004;
const MEDIA_DIR = path.join(__dirname, 'Media');

// Middleware
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Media', express.static(MEDIA_DIR));

// Multer storage config
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const playlist = req.params.playlist || req.body.playlist;
      if (!playlist) return cb(new Error('Playlist name is required'));

      const dest = path.join(MEDIA_DIR, playlist);
      await fs.promises.mkdir(dest, { recursive: true });
      cb(null, dest);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// Create playlist
app.post('/api/playlists', async (req, res) => {
  const name = req.body.name;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Playlist name required' });
  }

  const playlistPath = path.join(MEDIA_DIR, name);
  try {
    if (fs.existsSync(playlistPath)) {
      return res.status(400).json({ error: 'Playlist already exists' });
    }

    await fs.promises.mkdir(playlistPath, { recursive: true });
    const jsonPath = path.join(playlistPath, 'playlist.json');
    await fs.promises.writeFile(jsonPath, JSON.stringify({ name, files: [] }, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create playlist' });
  }
});

// Delete playlist
app.delete('/api/playlists/:name', async (req, res) => {
  const playlist = req.params.name;
  const playlistDir = path.join(MEDIA_DIR, playlist);

  try {
    if (!fs.existsSync(playlistDir)) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    await fs.promises.rm(playlistDir, { recursive: true, force: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete playlist' });
  }
});

// Rename playlist
app.put('/api/playlists/:oldName', async (req, res) => {
  const { oldName } = req.params;
  const { newName } = req.body;

  const oldPath = path.join(MEDIA_DIR, oldName);
  const newPath = path.join(MEDIA_DIR, newName);

  try {
    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: 'Old playlist not found' });
    }
    if (fs.existsSync(newPath)) {
      return res.status(400).json({ error: 'New playlist already exists' });
    }

    await fs.promises.rename(oldPath, newPath);

    const jsonPath = path.join(newPath, 'playlist.json');
    if (fs.existsSync(jsonPath)) {
      const data = JSON.parse(await fs.promises.readFile(jsonPath, 'utf-8'));
      data.name = newName;
      await fs.promises.writeFile(jsonPath, JSON.stringify(data, null, 2));
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Rename failed' });
  }
});

// Upload files + async playlist.json update
app.post('/api/playlists/:playlist/upload', upload.array('files'), async (req, res) => {
  const playlist = req.params.playlist;
  const playlistDir = path.join(MEDIA_DIR, playlist);
  const jsonPath = path.join(playlistDir, 'playlist.json');

  if (!fs.existsSync(playlistDir)) {
    return res.status(404).json({ error: 'Playlist folder not found' });
  }

  res.json({ success: true }); // Respond early

  // Async update of playlist.json
  try {
    const allFiles = await fs.promises.readdir(playlistDir);
    const files = [];

    for (const file of allFiles) {
      if (file === 'playlist.json') continue;
      const stat = await fs.promises.stat(path.join(playlistDir, file));
      if (stat.isFile()) files.push(file);
    }

    const data = { name: playlist, files };
    await fs.promises.writeFile(jsonPath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error updating playlist.json for ${playlist}:`, err);
  }
});

// List playlists
app.get('/api/playlists', async (req, res) => {
  try {
    if (!fs.existsSync(MEDIA_DIR)) return res.json([]);

    const names = await fs.promises.readdir(MEDIA_DIR);
    const playlists = [];

    for (const name of names) {
      const fullPath = path.join(MEDIA_DIR, name);
      const stat = await fs.promises.stat(fullPath);
      if (stat.isDirectory()) playlists.push({ name });
    }

    res.json(playlists);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list playlists' });
  }
});

// Trigger socket viewer play
app.post('/api/playlists/:playlist/trigger', (req, res) => {
  const playlist = req.params.playlist;
  io.emit('play', playlist);
  res.json({ success: true });
});

// Preview playlist.json
app.get('/api/playlists/:playlist/preview', async (req, res) => {
  const playlist = req.params.playlist;
  const jsonPath = path.join(MEDIA_DIR, playlist, 'playlist.json');

  try {
    if (!fs.existsSync(jsonPath)) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const data = await fs.promises.readFile(jsonPath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read playlist data' });
  }
});

// Socket.io connection log
io.on('connection', (socket) => {
  console.log('Viewer connected');
});

// Start server
server.listen(PORT, () => {
  console.log(`? Server running at http://localhost:${PORT}`);
});
