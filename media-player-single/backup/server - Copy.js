const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = 3004;
const MEDIA_DIR = path.join(__dirname, 'Media');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/Media', express.static(MEDIA_DIR));

// Multer upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const playlist = req.params.playlist || req.body.playlist;
    const dest = path.join(MEDIA_DIR, playlist);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ✅ Create playlist
app.post('/api/playlists', (req, res) => {
  const name = req.body.name;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Playlist name required' });
  }

  const playlistPath = path.join(MEDIA_DIR, name);
  if (fs.existsSync(playlistPath)) {
    return res.status(400).json({ error: 'Playlist already exists' });
  }

  fs.mkdirSync(playlistPath, { recursive: true });

  // Write empty playlist.json
  const jsonPath = path.join(playlistPath, 'playlist.json');
  fs.writeFileSync(jsonPath, JSON.stringify({ name, files: [] }, null, 2));

  res.json({ success: true });
});

// ✅ Delete playlist
app.delete('/api/playlists/:name', (req, res) => {
  const playlist = req.params.name;
  if (!playlist) return res.status(400).json({ error: 'Playlist name required' });

  const playlistDir = path.join(MEDIA_DIR, playlist);
  if (!fs.existsSync(playlistDir)) return res.status(404).json({ error: 'Playlist not found' });

  fs.rmSync(playlistDir, { recursive: true, force: true });
  res.json({ success: true });
});

// ✅ Rename playlist
app.put('/api/playlists/:oldName', (req, res) => {
  const oldName = req.params.oldName;
  const newName = req.body.newName;

  if (!oldName || !newName) {
    return res.status(400).json({ error: 'Old and new names required' });
  }

  const oldPath = path.join(MEDIA_DIR, oldName);
  const newPath = path.join(MEDIA_DIR, newName);

  if (!fs.existsSync(oldPath)) {
    return res.status(404).json({ error: 'Old playlist not found' });
  }
  if (fs.existsSync(newPath)) {
    return res.status(400).json({ error: 'New playlist already exists' });
  }

  fs.renameSync(oldPath, newPath);

  // Update name inside playlist.json
  const jsonPath = path.join(newPath, 'playlist.json');
  if (fs.existsSync(jsonPath)) {
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    data.name = newName;
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  res.json({ success: true });
});

// ✅ Upload files + auto-update playlist.json
app.post('/api/playlists/:playlist/upload', upload.array('files'), (req, res) => {
  const playlist = req.params.playlist;
  const playlistDir = path.join(MEDIA_DIR, playlist);
  const jsonPath = path.join(playlistDir, 'playlist.json');

  // Get all media files in folder (after upload)
  const allFiles = fs.readdirSync(playlistDir).filter(f =>
    ['.mp4', '.mp3', '.ogg', '.webm', '.wav'].includes(path.extname(f).toLowerCase())
  );

  let jsonData = { name: playlist, files: [] };
  if (fs.existsSync(jsonPath)) {
    jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  }
  jsonData.files = allFiles;
  fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));

  res.json({ success: true, files: allFiles });
});

// ✅ List all playlists
app.get('/api/playlists', (req, res) => {
  if (!fs.existsSync(MEDIA_DIR)) return res.json([]);
  const playlists = fs.readdirSync(MEDIA_DIR).filter(name =>
    fs.statSync(path.join(MEDIA_DIR, name)).isDirectory()
  );
  res.json(playlists.map(name => ({ name })));
});

// ✅ Trigger viewer
app.post('/api/playlists/:playlist/trigger', (req, res) => {
  const playlist = req.params.playlist;
  io.emit('play', playlist);
  res.json({ success: true });
});

// ✅ Viewer socket
io.on('connection', (socket) => {
  console.log('Viewer connected');
});

// ✅ Start server
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
