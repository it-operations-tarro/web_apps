const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs');
const http = require('http'); // Import the 'http' module
const WebSocket = require('ws'); // Import the 'ws' module
const config = require('./server_endpoints');

const BASE_IP = "http://messageboard-svr-dgt1-1.prod.letsdowonders.io";
const WebApps = {
    monitoring_dashboard: `${BASE_IP}:3000/`,
    message_board: `${BASE_IP}:3001/`,
    time: `${BASE_IP}:3002/`,
    dual_dashboard: `${BASE_IP}:3003/`,
    media_single: `${BASE_IP}:3004/`,
    media_dual: `${BASE_IP}:3005/`
};

const app = express();
const port = 3001;

let users = [];

// Load users from credentials.json on server start
fs.readFile(path.join(__dirname, 'credentials.json'), 'utf8', (err, data) => {
    if (err) {
        console.error('Error loading user data from credentials.json:', err);
        process.exit(1);
    }
    try {
        users = JSON.parse(data);
        console.log('User data loaded successfully from credentials.json.');
    } catch (parseErr) {
        console.error('Error parsing JSON from credentials.json:', parseErr);
        process.exit(1);
    }
});

// CORS config for this server
app.use(cors({
    origin: WebApps.message_board,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
    secret: 'secretForMessengerApp123',
    name: 'messenger.sid',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
});

app.use(sessionMiddleware);

// Logging sessions for debug
app.use((req, res, next) => {
    console.log('[Port 3001] Session data:', req.session);
    next();
});

let lastMessage = "";

// Login API endpoint remains the same
app.post('/api/messenger_login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.user = user.username;
        req.session.loggedIn = true;
        req.session.role = user.role;
        console.log(`[Port 3001] User ${user.username} (Role: ${user.role}) logged in.`);
        res.json({ success: true, message: 'Login successful!', role: user.role });
    } else {
        console.log(`[Port 3001] Login failed for username: ${username}`);
        res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }
});

// Session check and logout endpoints remain the same
app.get('/api/messenger_check_session', (req, res) => {
    if (req.session.user && req.session.loggedIn) {
        res.json({ loggedIn: true, user: req.session.user, role: req.session.role });
    } else {
        res.json({ loggedIn: false, role: null });
    }
});

app.post('/api/messenger_logout', (req, res) => {
    console.log('[Port 3001] Received messenger logout request.');
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                console.error('[Port 3001] Session destroy error:', err);
                return res.status(500).json({ success: false, message: 'Failed to destroy messenger session.' });
            }
            console.log('[Port 3001] Messenger session destroyed.');
            res.json({ success: true, message: 'Logged out from Messenger service.' });
        });
    } else {
        res.json({ success: true, message: 'No active messenger session.' });
    }
});


// Auth middleware remains the same
const requireMessengerAuth = (req, res, next) => {
    if (req.path.startsWith('/api/message') && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized API access to ${req.path} by role ${req.session.role}`);
        return res.status(401).json({ message: 'Unauthorized access to Messenger API.' });
    }
    if (req.path === '/messenger.html' && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized page access to ${req.path} by role ${req.session.role}, redirecting to login.`);
        return res.redirect('/login.html?error=Unauthorized access to Messenger.');
    }
    next();
};

app.use('/messenger.html', requireMessengerAuth);
app.use('/api/message', requireMessengerAuth);


// === WebSocket Implementation START ===

// 1. Create an HTTP server from the Express app
const server = http.createServer(app);

// 2. Create a WebSocket server and attach it to the HTTP server
const wss = new WebSocket.Server({ server });

// Function to broadcast a message to all connected clients
wss.broadcast = function broadcast(data) {
    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data, (error) => {
                if (error) {
                    console.error('Broadcast error:', error);
                }
            });
        }
    });
};

// 3. Handle new WebSocket connections
wss.on('connection', (ws, req) => {
    console.log('[WebSocket] Client connected.');

    // When a new client connects, send them the current message
    if (lastMessage) {
        ws.send(JSON.stringify({ message: lastMessage }));
    }

    ws.on('close', () => {
        console.log('[WebSocket] Client disconnected.');
    });

    ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
    });
});

console.log('[WebSocket] Server initialized.');

// === WebSocket Implementation END ===


// The GET endpoint for messages is no longer needed for the viewer,
// as data is now pushed via WebSockets.
/*
app.get('/api/message', (req, res) => {
    res.json({ message: lastMessage });
});
*/

// MODIFIED: This endpoint now also broadcasts the message via WebSocket
app.post('/api/message', (req, res) => {
    lastMessage = req.body.message || "";
    console.log(`[API] New message set: "${lastMessage}"`);

    // Broadcast the new message to all connected clients
    wss.broadcast(JSON.stringify({ message: lastMessage }));

    res.json({ success: true });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// MODIFIED: Use the 'server' object to listen, not 'app'
server.listen(port, '0.0.0.0', () => {
    console.log(`[Port 3001] Messenger Server running at ${WebApps.message_board}`);
});