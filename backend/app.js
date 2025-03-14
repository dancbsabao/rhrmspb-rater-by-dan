require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true); // Add this line to trust Render/Cloudflare proxy headers

// Configure CORS
const allowedOrigins = [
  'https://dancbsabao.github.io', // GitHub Pages
  'http://127.0.0.1:5500',        // Local development
  'http://localhost:3000',        // Localhost (adjust if needed)
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.use(express.json());

// In-memory storage for refresh tokens (use a database in production)
const refreshTokens = new Map();

// Config endpoint
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
      CLIENT_SECRET: process.env.CLIENT_SECRET || '', // Included for client-side fallback (optional)
    });
  } catch (error) {
    console.error('Error parsing environment variables:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// OAuth2 authorization endpoint
app.get('/auth/google', (req, res) => {
  // Trust proxy to get correct protocol (https) from Render/Cloudflare
  app.set('trust proxy', true);
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  console.log('Generated redirect_uri:', redirectUri); // Debug
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent(process.env.SCOPES)}&` +
    `access_type=offline&` +
    `prompt=consent`;
  res.redirect(authUrl);
});

// OAuth2 callback endpoint
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: 'No authorization code provided' });
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenResponse.json();
    if (tokenData.error) {
      throw new Error(tokenData.error_description || 'Token exchange failed');
    }

    const sessionId = Date.now().toString(); // Simple session ID (use UUID in production)
    refreshTokens.set(sessionId, tokenData.refresh_token);

    // Redirect back to client
    const clientRedirect = `https://dancbsabao.github.io/?` +
      `access_token=${tokenData.access_token}&` +
      `expires_in=${tokenData.expires_in}&` +
      `session_id=${sessionId}`;
    res.redirect(clientRedirect);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send('Authentication failed');
  }
});

// Token refresh endpoint
app.post('/refresh-token', async (req, res) => {
  const { session_id } = req.body;
  const refreshToken = refreshTokens.get(session_id);

  if (!refreshToken) {
    return res.status(401).json({ error: 'Invalid or missing session ID' });
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const newToken = await response.json();
    if (newToken.error) {
      throw new Error(newToken.error_description || 'Token refresh failed');
    }

    res.json({
      access_token: newToken.access_token,
      expires_in: newToken.expires_in,
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
