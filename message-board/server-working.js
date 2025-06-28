const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs'); // for reading credentials.json
const config = require('./server_endpoints');

const BASE_IP = "http://localhost"; 
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

app.use(session({
    secret: 'secretForMessengerApp123',
    name: 'messenger.sid',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// Logging sessions for debug
app.use((req, res, next) => {
    console.log('[Port 3001] Session data:', req.session);
    next();
});

let lastMessage = "";

// Login API endpoint
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

// Auth middleware protecting messenger APIs and page
const requireMessengerAuth = (req, res, next) => {
    // Protect APIs: role 2 or 3 only
    if (req.path.startsWith('/api/message') && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized API access to ${req.path} by role ${req.session.role}`);
        return res.status(401).json({ message: 'Unauthorized access to Messenger API.' });
    }
    // Protect messenger.html page: role 2 or 3 only
    if (req.path === '/messenger.html' && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized page access to ${req.path} by role ${req.session.role}, redirecting to login.`);
        return res.redirect('/login.html?error=Unauthorized access to Messenger.');
    }
    next();
};

app.use('/messenger.html', requireMessengerAuth);
app.use('/api/message', requireMessengerAuth);

// Messenger message APIs
app.get('/api/message', (req, res) => {
    res.json({ message: lastMessage });
});

app.post('/api/message', (req, res) => {
    lastMessage = req.body.message || "";
    res.json({ success: true });
});

// Serve static files like login.html, messenger.html, server_endpoints.js from /public
app.use(express.static(path.join(__dirname, 'public')));

// Serve login.html as default page at /
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Bind server explicitly to all interfaces so both localhost and LAN IP works
app.listen(port, '0.0.0.0', () => {
    console.log(`[Port 3001] Messenger Server running at ${WebApps.message_board}`);
    console.log(`[Port 3001] Access login at ${WebApps.message_board}`);
    console.log(`[Port 3001] Access messenger at ${WebApps.message_board}messenger.html`);
    console.log(`[Port 3001] Ensure 'credentials.json' is in the same folder as server.js`);
});
