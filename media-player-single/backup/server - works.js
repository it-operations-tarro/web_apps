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
    const playlist = req.body.playlist;
    const dest = path.join(MEDIA_DIR, playlist);
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    cb(null, dest);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// ✅ Create playlist (restored version)
app.post('/api/playlist/create', (req, res) => {
  const playlist = req.body.playlist;
  if (!playlist || playlist.trim() === '') {
    return res.status(400).json({ error: 'Playlist name required' });
  }

  const playlistPath = path.join(MEDIA_DIR, playlist);
  if (fs.existsSync(playlistPath)) {
    return res.status(400).json({ error: 'Playlist already exists' });
  }

  try {
    fs.mkdirSync(playlistPath, { recursive: true });
    return res.json({ success: true, message: 'Playlist created' });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create playlist', detail: err.message });
  }
});

// Rename playlist
app.post('/api/playlist/rename', (req, res) => {
  const { oldName, newName } = req.body;
  if (!oldName || !newName) return res.status(400).json({ error: 'Both old and new names required' });

  const oldPath = path.join(MEDIA_DIR, oldName);
  const newPath = path.join(MEDIA_DIR, newName);

  if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Old playlist not found' });
  if (fs.existsSync(newPath)) return res.status(400).json({ error: 'New playlist already exists' });

  fs.renameSync(oldPath, newPath);
  res.json({ success: true });
});

// Delete playlist
app.post('/api/playlist/delete', (req, res) => {
  const { playlist } = req.body;
  if (!playlist) return res.status(400).json({ error: 'Playlist name required' });

  const playlistDir = path.join(MEDIA_DIR, playlist);
  if (!fs.existsSync(playlistDir)) return res.status(404).json({ error: 'Playlist not found' });

  fs.rmSync(playlistDir, { recursive: true, force: true });
  res.json({ success: true });
});

// Upload to playlist
app.post('/api/playlist/upload', upload.array('files'), (req, res) => {
  res.json({ success: true, files: req.files.map(f => f.originalname) });
});

// List playlists
app.get('/api/playlists', (req, res) => {
  if (!fs.existsSync(MEDIA_DIR)) return res.json([]);
  const playlists = fs.readdirSync(MEDIA_DIR).filter(name =>
    fs.statSync(path.join(MEDIA_DIR, name)).isDirectory()
  );
  res.json(playlists);
});

// List media in playlist
app.get('/api/media/:playlist', (req, res) => {
  const playlist = req.params.playlist;
  const playlistDir = path.join(MEDIA_DIR, playlist);

  if (!fs.existsSync(playlistDir)) return res.status(404).json({ error: 'Playlist not found' });

  const files = fs.readdirSync(playlistDir).filter(f =>
    ['.mp4', '.mp3', '.ogg', '.webm', '.wav'].includes(path.extname(f).toLowerCase())
  );

  res.json(files);
});

// Trigger play on viewer
app.post('/api/playlists/play', (req, res) => {
  const { playlist } = req.body;
  if (!playlist) return res.status(400).json({ error: 'Playlist required' });

  io.emit('play', playlist);
  res.json({ success: true });
});

// Viewer socket
io.on('connection', (socket) => {
  console.log('Viewer connected');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
