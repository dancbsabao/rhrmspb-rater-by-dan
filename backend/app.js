require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');

const app = express();

// Configure CORS to allow requests from multiple origins
const allowedOrigins = [
  'https://dancbsabao.github.io', // GitHub Pages
  'http://127.0.0.1:5500',        // Local development (file server)
  'http://localhost:3000',        // Localhost (adjust port if needed)
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// Set up session management
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key', // Make sure to set this in your .env
  resave: false,
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production' } // Set to true for HTTPS
}));

// Endpoint to handle login (this is just an example, adjust based on your authentication method)
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  // Authenticate user (e.g., check credentials against a database)
  if (username === 'user' && password === 'password') {
    req.session.user = { username }; // Save user info in the session
    return res.json({ message: 'Logged in successfully' });
  }

  res.status(401).json({ error: 'Invalid credentials' });
});

// Endpoint to check if user is logged in
app.get('/check-session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Endpoint to log out the user
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to log out' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Endpoint to fetch environment variables
app.get('/config', (req, res) => {
  try {
    res.json({
      CLIENT_ID: process.env.CLIENT_ID || '',
      API_KEY: process.env.API_KEY || '',
      SHEET_ID: process.env.SHEET_ID || '',
      SCOPES: process.env.SCOPES || '',
      EVALUATOR_PASSWORDS: process.env.EVALUATOR_PASSWORDS
        ? JSON.parse(process.env.EVALUATOR_PASSWORDS)
        : [],
      SHEET_RANGES: process.env.SHEET_RANGES
        ? JSON.parse(process.env.SHEET_RANGES)
        : [],
    });
  } catch (error) {
    console.error('Error parsing environment variables:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// Handle 404 errors for undefined routes
app.use((req, res, next) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Use the port assigned by Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
