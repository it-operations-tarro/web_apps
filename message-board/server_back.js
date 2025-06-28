const express = require('express');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const fs = require('fs'); // Added fs module to read file
const config = require('./server_endpoints');
const app = express();
const port = 3001;

let users = []; // This array will be populated from credentials.json

// Load user data from credentials.json when the server starts
fs.readFile(path.join(__dirname, 'credentials.json'), 'utf8', (err, data) => {
    if (err) {
        console.error('Error loading user data from credentials.json:', err);
        // In a production environment, you might want to exit the process
        // or prevent the server from starting if credentials are vital.
        process.exit(1); // Exit if critical data cannot be loaded
        return;
    }
    try {
        users = JSON.parse(data);
        console.log('User data loaded successfully from credentials.json.');
        // For debugging, you can log the loaded users (be careful with sensitive data in production)
        // console.log('Loaded users:', users);
    } catch (parseErr) {
        console.error('Error parsing user data JSON from credentials.json:', parseErr);
        process.exit(1); // Exit if JSON is malformed
    }
});

// --- CORS Configuration for Port 3001 Server ---
const corsOptions = {
    origin: WebApps.message_board, // Allow calls from this server's own origin
    credentials: true, // Crucial for allowing cookies (session ID) to be sent across origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions)); // Apply CORS middleware for this server

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Session Middleware for Port 3001 Server (Unique name: 'messenger.sid') ---
app.use(session({
    secret: 'secretForMessengerApp123', // <--- VERY IMPORTANT: Use a UNIQUE, strong secret key for THIS server
    name: 'messenger.sid', // <--- VERY IMPORTANT: Use a UNIQUE name for THIS session cookie (different from connect.sid)
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if you are using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use((req, res, next) => {
    console.log('[Port 3001] Session data:', req.session);
    next();
});

let lastMessage = "";

// --- Modified: API Endpoint for Messenger App Login (with validation) ---
app.post('/api/messenger_login', (req, res) => {
    const { username, password } = req.body;

    // Find the user in the loaded 'users' array
    const user = users.find(u => u.username === username && u.password === password);

    if (user) {
        req.session.user = user.username;
        req.session.loggedIn = true;
        req.session.role = user.role; // Assign the role found in the 'users' array
        console.log(`[Port 3001] User ${user.username} (Role: ${user.role}) logged into Messenger app. Session created.`);
        res.json({ success: true, message: 'Login successful!', role: user.role });
    } else {
        // If username/password don't match any user, return an error
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

// --- Middleware to Protect Messenger Pages/APIs ---
const requireMessengerAuth = (req, res, next) => {
    // Check if user is authenticated and has the correct role for API access (Role 2 or 3)
    if (req.path.startsWith('/api/message') && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized API access attempt to ${req.path}. Current Role: ${req.session.role}`);
        return res.status(401).json({ message: 'Unauthorized access to Messenger API.' });
    }
    // Check if user is authenticated and has the correct role for messenger.html access (Role 2 or 3)
    if (req.path === '/messenger.html' && (!req.session.user || !req.session.loggedIn || (req.session.role !== '2' && req.session.role !== '3'))) {
        console.log(`[Port 3001] Unauthorized access attempt to ${req.path}. Current Role: ${req.session.role}. Redirecting.`);
        // Redirect to the login page now served by the same server (port 3001)
        return res.redirect('/login.html?error=Unauthorized access to Messenger.');
    }
    next();
};

app.use('/messenger.html', requireMessengerAuth);
app.use('/api/message', requireMessengerAuth);

// --- Existing API Endpoints for message handling ---
app.get('/api/message', (req, res) => {
    res.json({ message: lastMessage });
});

app.post('/api/message', (req, res) => {
    lastMessage = req.body.message || "";
    res.json({ success: true });
});

// Serve static files (like login.html and messenger.html) from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Route to serve the login page as the default page when accessing the root URL
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.listen(port, () => {
    console.log(`[Port 3001] Messenger Server running on WebApps.message_board`);
    console.log(`[Port 3001] Access Login at WebApps.message_board/`);
    console.log(`[Port 3001] Access Messenger at WebApps.message_board/messenger.html`);
    console.log(`[Port 3001] Please ensure 'credentials.json' is in the same directory as 'server.js'.`);
});
