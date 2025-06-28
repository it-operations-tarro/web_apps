const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = 3003;

app.use(cors({
    origin: 'http://messageboard-svr-dgt1-1.prod.letsdowonders.io:3003', // Make sure this matches your client's origin
    credentials: true
}));

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'your_super_secret_key_node_js_for_session',
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000,
    }
}));

let users = [];
try {
    const data = fs.readFileSync(path.join(__dirname, 'credentials.json'), 'utf8');
    users = JSON.parse(data);
    console.log('Credentials loaded successfully.');
} catch (err) {
    console.error('Error loading credentials.json:', err);
    users = [];
}

function isAuthenticated(req, res, next) {
    if (req.session.username) {
        next();
    } else {
        if (req.accepts('html')) {
            console.warn('Attempted access to protected HTML page without authentication. Redirecting to login.');
            return res.redirect('/login.html?error=Please login to access this page.');
        }
        console.warn('Attempted access to protected API endpoint without authentication. Sending 401.');
        return res.status(401).json({ loggedIn: false, message: 'Not authenticated' });
    }
}

// --- ROUTES ---

// ... (existing routes) ...

// ROOT PATH (added for clarity)
app.get('/', (req, res) => {
    if (req.session.username) {
        res.redirect('/home.html');
    } else {
        res.redirect('/login.html');
    }
});

// Login Page (GET)
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Login (POST)
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);
    if (user) {
        req.session.username = user.username;
        req.session.role = user.role;
        console.log(`User '${username}' logged in successfully. Session created.`);
        res.redirect('/home.html');
    } else {
        console.warn(`Failed login attempt for username: '${username}'`);
        res.redirect('/login.html?error=Invalid credentials');
    }
});

// API Endpoint: Check Session Status
app.get('/api/check-session', isAuthenticated, (req, res) => {
    console.log('API /api/check-session called. User is authenticated.');
    res.json({
        loggedIn: true,
        user: {
            username: req.session.username,
            role: req.session.role
        }
    });
});

// API Endpoint: Logout (POST)
app.post('/api/logout', (req, res) => {
    console.log('API /api/logout called.');
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session via /api/logout:', err);
            return res.status(500).json({ success: false, message: 'Could not log out due to server error.' });
        }
        console.log('Session destroyed successfully.');
        res.json({ success: true, message: 'Logged out successfully.' });
    });
});

// Home Page (GET)
app.get('/home.html', isAuthenticated, (req, res) => {
    console.log('Accessing /home.html. User is authenticated.');
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Safety Net: Redirects any requests to just '/home'
app.get('/home', (req, res) => {
    console.warn('Redirecting /home to /home.html');
    res.redirect('/home.html');
});

// Traditional Logout (GET)
app.get('/logout', (req, res) => {
    console.log('Traditional /logout (GET) route called.');
    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session via /logout (GET):', err);
        }
        res.redirect('/login.html');
    });
});

// --- NEW API ENDPOINT FOR MESSAGES ---
// This is what your index.html is looking for.
//let currentDisplayMessage = "Welcome to the Dual Message Board!"; // Initial message
let currentDisplayMessage = ""; // No initial message
app.get('/api/message', (req, res) => {
    // You can implement logic here to fetch messages from a database, file, etc.
    // For now, let's return a static message or a dynamic one if you want.
    console.log('API /api/message called. Returning current message.');
    res.json({ message: currentDisplayMessage });
});

// Optional: An endpoint to update the message (e.g., for an admin panel)
app.post('/api/update-message', isAuthenticated, bodyParser.json(), (req, res) => {
    const { message } = req.body;
    if (message) {
        currentDisplayMessage = message;
        console.log(`Message updated to: "${currentDisplayMessage}" by ${req.session.username}`);
        res.json({ success: true, message: 'Message updated successfully.' });
    } else {
        res.status(400).json({ success: false, message: 'Message content is required.' });
    }
});
// ------------------------------------

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on http://messageboard-svr-dgt1-1.prod.letsdowonders.io:${PORT}`);
});