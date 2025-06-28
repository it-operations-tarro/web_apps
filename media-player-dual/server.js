const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs/promises');
const http = require('http');
const compression = require('compression');
const cors = require('cors');
const crypto = require('crypto');
const config = require('./server_endpoints');
const app = express();
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server);

const PORT = 3005;
const MEDIA_DIR = path.join(__dirname, 'Media');
const PUBLIC_DIR = path.join(__dirname, 'public');

// Ensure Media directory exists on server startup
fsPromises.mkdir(MEDIA_DIR, { recursive: true }).catch(console.error);
fsPromises.mkdir(PUBLIC_DIR, { recursive: true }).catch(console.error);

// --- NEW LOGGING: Before any middleware ---
app.use((req, res, next) => {
    console.log(`[REQUEST START] ${req.method} ${req.url} | Content-Type: ${req.headers['content-type']}`);
    next();
});

// Serve admin.html for the root path
app.get('/', (req, res) => {
    console.log(`[ROUTE] Serving admin.html for /`);
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Middleware
app.use(compression());
app.use(cors());
app.use(express.json()); // Parses incoming JSON requests (for non-form-data)
app.use(express.urlencoded({ extended: true })); // Parses URL-encoded data (for non-form-data)
app.use(express.static(PUBLIC_DIR)); // Serves static files from the 'public' directory
app.use('/Media', express.static(MEDIA_DIR)); // Serves media files from the 'Media' directory


// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // --- NEW LOGGING: Inside Multer destination ---
        console.log(`[MULTER DEST] Processing destination for file: ${file.originalname}`);
        console.log(`[MULTER DEST] req.body at destination (should have playlistName):`, req.body);

        const playlist = req.body.playlistName;

        if (!playlist) {
            // This error will be caught by Multer's error handling if not explicitly caught by the route handler.
            console.error(`[MULTER DEST ERROR] Playlist name is missing for ${file.originalname}`);
            return cb(new Error('Playlist name is missing in the request. Please ensure it is selected and sent.'));
        }

        try {
            const dest = path.join(MEDIA_DIR, playlist);
            fsPromises.mkdir(dest, { recursive: true })
                .then(() => {
                    console.log(`[MULTER DEST] Destination set to: ${dest}`);
                    cb(null, dest);
                })
                .catch(err => {
                    console.error(`[MULTER DEST ERROR] Failed to create directory ${dest}:`, err);
                    cb(err);
                });
        } catch (err) {
            console.error(`[MULTER DEST ERROR] Caught error during path creation:`, err);
            cb(err);
        }
    },
    filename: (req, file, cb) => {
        // --- NEW LOGGING: Inside Multer filename ---
        console.log(`[MULTER FILENAME] Generating filename for: ${file.originalname}`);
        const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        console.log(`[MULTER FILENAME] Sanityzed filename: ${sanitizedFilename}`);
        cb(null, sanitizedFilename);
    }
});

const upload = multer({ storage: storage }).fields([
    { name: 'uploadedFile', maxCount: 1 },
    { name: 'title', maxCount: 1 },
    { name: 'description', maxCount: 1 },
    { name: 'playlistName', maxCount: 1 }
]);

// --- API Endpoints ---

// Create playlist
app.post('/api/playlists', async (req, res) => {
    console.log(`[ROUTE] POST /api/playlists`);
    const name = req.body.name?.trim();
    if (!name) return res.status(400).json({ error: 'Playlist name required' });

    const playlistPath = path.join(MEDIA_DIR, name);
    try {
        if (fs.existsSync(playlistPath)) {
            return res.status(400).json({ error: 'Playlist already exists' });
        }

        await fsPromises.mkdir(playlistPath, { recursive: true });
        const jsonPath = path.join(playlistPath, 'playlist.json');
        await fsPromises.writeFile(jsonPath, JSON.stringify({ name, files: [] }, null, 2));
        res.status(201).json({ success: true, message: `Playlist '${name}' created successfully.` });
    } catch (err) {
        console.error('Create playlist error:', err);
        res.status(500).json({ error: 'Failed to create playlist' });
    }
});

// Delete playlist
app.delete('/api/playlists/:name', async (req, res) => {
    console.log(`[ROUTE] DELETE /api/playlists/${req.params.name}`);
    const playlistName = req.params.name;
    const playlistDir = path.join(MEDIA_DIR, playlistName);

    try {
        if (!fs.existsSync(playlistDir)) {
            return res.status(404).json({ error: 'Playlist not found' });
        }

        await fsPromises.rm(playlistDir, { recursive: true, force: true });
        res.json({ success: true, message: `Playlist '${playlistName}' deleted successfully.` });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: `Failed to delete playlist '${playlistName}'.` });
    }
});

// Rename playlist
app.put('/api/playlists/:oldName', async (req, res) => {
    console.log(`[ROUTE] PUT /api/playlists/${req.params.oldName}`);
    const oldName = req.params.oldName;
    const newName = req.body.newName?.trim();
    const oldPath = path.join(MEDIA_DIR, oldName);
    const newPath = path.join(MEDIA_DIR, newName);

    if (!newName) return res.status(400).json({ error: 'New name is required' });
    if (oldName === newName) return res.status(400).json({ error: 'New name is same as old name.' });

    try {
        if (!fs.existsSync(oldPath)) {
            return res.status(404).json({ error: 'Old playlist not found' });
        }
        if (fs.existsSync(newPath)) {
            return res.status(400).json({ error: `Playlist '${newName}' already exists.` });
        }

        await fsPromises.rename(oldPath, newPath);

        const jsonPath = path.join(newPath, 'playlist.json');
        if (fs.existsSync(jsonPath)) {
            const data = JSON.parse(await fsPromises.readFile(jsonPath, 'utf-8'));
            data.name = newName;
            await fsPromises.writeFile(jsonPath, JSON.stringify(data, null, 2));
        }

        res.json({ success: true, message: `Playlist '${oldName}' renamed to '${newName}'.` });
    } catch (err) {
        console.error('Rename error:', err);
        res.status(500).json({ error: 'Rename failed' });
    }
});

// **ENHANCED**: Upload file to a playlist and update its JSON file
app.post('/api/files/upload', upload, async (req, res) => { // Multer 'upload' middleware runs first
    // --- NEW LOGGING: After Multer finishes ---
    console.log(`[ROUTE] POST /api/files/upload - Multer finished processing.`);
    console.log(`[ROUTE] req.body:`, req.body); // Should contain form fields
    console.log(`[ROUTE] req.files:`, req.files); // Should contain file details

    const uploadedFile = req.files && req.files['uploadedFile'] ? req.files['uploadedFile'][0] : undefined;

    const { title, description, playlistName } = req.body;

    if (!uploadedFile) {
        console.error(`[ERROR] No file provided for upload.`);
        return res.status(400).json({ error: 'No file provided.' });
    }
    if (!playlistName) {
        // If the upload was invalid, clean up the temporary file Multer saved
        if (uploadedFile && uploadedFile.path) {
            await fsPromises.unlink(uploadedFile.path).catch(err => console.error('Error deleting temp file:', err));
        }
        console.error(`[ERROR] Playlist name is required for upload.`);
        return res.status(400).json({ error: 'Playlist is required.' });
    }

    const finalTitle = title && title.trim() !== '' ? title.trim() : uploadedFile.originalname;
    const playlistDir = path.join(MEDIA_DIR, playlistName);
    const jsonPath = path.join(playlistDir, 'playlist.json');

    try {
        if (!fs.existsSync(playlistDir)) {
            // If the playlist directory doesn't exist, clean up the temp file
            if (uploadedFile && uploadedFile.path) {
                await fsPromises.unlink(uploadedFile.path).catch(err => console.error('Error deleting file for non-existent playlist:', err));
            }
            console.error(`[ERROR] Playlist directory '${playlistName}' not found on server.`);
            return res.status(404).json({ error: `Playlist '${playlistName}' not found on server.` });
        }

        let playlistData = { name: playlistName, files: [] };
        if (fs.existsSync(jsonPath)) {
            const existingData = await fsPromises.readFile(jsonPath, 'utf-8');
            try {
                playlistData = JSON.parse(existingData);
                console.log(`[INFO] Successfully parsed playlist.json for '${playlistName}'.`);
            } catch (parseError) {
                console.error(`[ERROR] Error parsing existing playlist.json for '${playlistName}':`, parseError);
                // If parsing fails, treat it as an empty file list for safety
                playlistData = { name: playlistName, files: [] };
            }
        } else {
            console.warn(`[WARN] playlist.json not found for '${playlistName}', creating a new one.`);
        }

        const existingFileIndex = playlistData.files.findIndex(
            f => f.name === finalTitle || f.originalname === uploadedFile.originalname
        );

        const newFileEntry = {
            name: finalTitle,
            filename: uploadedFile.filename,
            originalname: uploadedFile.originalname,
            description: description,
            size: uploadedFile.size,
            mimetype: uploadedFile.mimetype,
            uploadedAt: new Date().toISOString()
        };

        if (existingFileIndex !== -1) {
            playlistData.files[existingFileIndex] = {
                ...playlistData.files[existingFileIndex],
                ...newFileEntry
            };
            console.log(`[INFO] Updated metadata for existing file '${finalTitle}' in playlist '${playlistName}'.`);
        } else {
            playlistData.files.push(newFileEntry);
            console.log(`[INFO] Added new file '${finalTitle}' to playlist '${playlistName}'.`);
        }

        await fsPromises.writeFile(jsonPath, JSON.stringify(playlistData, null, 2));
        console.log(`[INFO] playlist.json for '${playlistName}' successfully written.`);

        res.status(200).json({
            success: true,
            message: `File '${finalTitle}' uploaded and playlist '${playlistName}' updated.`,
            file: newFileEntry
        });

    } catch (err) {
        console.error('[CRITICAL ERROR] File upload and playlist update error:', err);
        if (uploadedFile && uploadedFile.path) {
            await fsPromises.unlink(uploadedFile.path).catch(unlinkErr => console.error('Error deleting uploaded file after processing error:', unlinkErr));
        }
        res.status(500).json({ error: 'Failed to upload file and update playlist.' });
    }
});


// List all playlists (now also fetches their content for preview)
app.get('/api/playlists', async (req, res) => {
    console.log(`[ROUTE] GET /api/playlists`);
    try {
        if (!fs.existsSync(MEDIA_DIR)) {
            console.log(`[INFO] MEDIA_DIR does not exist. Returning empty playlists array.`);
            return res.json([]);
        }

        const names = await fsPromises.readdir(MEDIA_DIR);
        const playlists = [];

        for (const name of names) {
            const fullPath = path.join(MEDIA_DIR, name);
            const stat = await fsPromises.stat(fullPath);
            if (stat.isDirectory()) {
                const jsonPath = path.join(fullPath, 'playlist.json');
                let playlistData = { name, files: [] };
                if (fs.existsSync(jsonPath)) {
                    const data = await fsPromises.readFile(jsonPath, 'utf-8');
                    try {
                        playlistData = JSON.parse(data);
                    } catch (parseError) {
                        console.error(`[ERROR] Error parsing playlist.json for ${name}:`, parseError);
                        playlistData = { name, files: [], error: 'Malformed playlist.json' };
                    }
                }
                playlists.push(playlistData);
            }
        }
        console.log(`[INFO] Successfully listed ${playlists.length} playlists.`);
        res.json(playlists);
    } catch (err) {
        console.error('[ERROR] List playlists error:', err);
        res.status(500).json({ error: 'Failed to list playlists' });
    }
});

// Trigger viewer to play a playlist
app.post('/api/playlists/:playlist/trigger', (req, res) => {
    console.log(`[ROUTE] POST /api/playlists/${req.params.playlist}/trigger`);
    const playlist = req.params.playlist;
    io.emit('play', playlist);
    res.json({ success: true, message: `Triggered playlist: ${playlist}` });
});

// Preview playlist.json (content of a specific playlist)
app.get('/api/playlists/:playlist/preview', async (req, res) => {
    console.log(`[ROUTE] GET /api/playlists/${req.params.playlist}/preview`);
    const playlist = req.params.playlist;
    const jsonPath = path.join(MEDIA_DIR, playlist, 'playlist.json');

    try {
        if (!fs.existsSync(jsonPath)) {
            console.warn(`[WARN] Playlist JSON data not found for preview: ${jsonPath}`);
            return res.status(404).json({ error: 'Playlist JSON data not found' });
        }

        const data = await fsPromises.readFile(jsonPath, 'utf-8');
        try {
            res.json(JSON.parse(data));
        } catch (parseError) {
            console.error(`[ERROR] Error parsing playlist.json for preview of ${playlist}:`, parseError);
            res.status(500).json({ error: 'Failed to parse playlist data.' });
        }
    } catch (err) {
        console.error('[ERROR] Preview error:', err);
        res.status(500).json({ error: 'Failed to read playlist data' });
    }
});

// Delete a single file from playlist and update .json
app.delete('/api/playlists/:playlist/files/:filename', async (req, res) => {
    console.log(`[ROUTE] DELETE /api/playlists/${req.params.playlist}/files/${req.params.filename}`);
    const { playlist, filename } = req.params;
    const filePath = path.join(MEDIA_DIR, playlist, filename);

    const jsonPath = path.join(MEDIA_DIR, playlist, 'playlist.json');
    let displayFileName = filename;

    try {
        let playlistData = { name: playlist, files: [] };
        if (fs.existsSync(jsonPath)) {
            const data = await fsPromises.readFile(jsonPath, 'utf-8');
            try {
                playlistData = JSON.parse(data);
                const fileToDelete = playlistData.files.find(f => f.filename === filename);
                if (fileToDelete && fileToDelete.name) {
                    displayFileName = fileToDelete.name;
                }
            } catch (parseError) {
                console.error(`[ERROR] Error parsing playlist.json during file delete for ${playlist}:`, parseError);
            }
        }

        await fsPromises.unlink(filePath);
        console.log(`[INFO] Physical file deleted: ${filePath}`);

        const initialFileCount = playlistData.files.length;
        playlistData.files = playlistData.files.filter(f => f.filename !== filename);

        if (playlistData.files.length === initialFileCount) {
            console.warn(`[WARN] File '${filename}' (disk name) not found in playlist.json for '${playlist}'. Physical file deleted, but JSON not updated based on filename matching.`);
        }

        await fsPromises.writeFile(jsonPath, JSON.stringify(playlistData, null, 2));
        console.log(`[INFO] playlist.json for '${playlist}' updated after file deletion.`);

        res.json({ success: true, message: `File '${displayFileName}' deleted from playlist '${playlist}'.` });
    } catch (err) {
        console.error('[ERROR] File delete error:', err);
        if (err.code === 'ENOENT') {
            res.status(404).json({ error: `File '${displayFileName}' not found on disk or in playlist '${playlist}'.` });
        } else {
            res.status(500).json({ error: `Failed to delete file '${displayFileName}'.` });
        }
    }
});


// Catch-all 404 handler for non-API routes
app.use((req, res, next) => {
    console.log(`[ROUTE] 404 CATCH-ALL for ${req.originalUrl}`);
    if (req.originalUrl.startsWith('/api')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        // This is the problematic part: it serves HTML for non-API 404s
        // If your upload is hitting this, it means the /api/files/upload route
        // is not matching for some reason.
        res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), (err) => {
            if (err) {
                console.error('Error serving 404.html:', err);
                res.status(404).send('Page not found'); // Fallback if 404.html itself is missing
            }
        });
    }
});


// Socket.io
io.on('connection', (socket) => {
    console.log('Viewer connected');
    socket.on('disconnect', () => {
        console.log('Viewer disconnected');
    });
});

// Start the server
server.listen(PORT, () => {
    console.log(`?? Server running at WebApps.media_dual`);
    console.log(`Open WebApps.media_dual in your browser to access the dashboard.`);
});