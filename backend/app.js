require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fetch = require('node-fetch');

const app = express();
app.set('trust proxy', true); // Keep this for Render

app.use(express.json());
app.use(cookieParser());

const allowedOrigins = [
  'https://dancbsabao.github.io/rhrmspb-rater-by-dan',
  'https://dancbsabao.github.io',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
];

// Log request details before CORS
app.use((req, res, next) => {
  console.log('Request Origin:', req.headers.origin, 'Method:', req.method, 'Path:', req.path);
  next();
});

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('CORS rejected origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Support cookies
}));

// Config endpoint
app.get('/config', (req, res) => {
  try {
    console.log('Config endpoint hit');
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
      CLIENT_SECRET: process.env.CLIENT_SECRET || '', // Optional, keep if needed
    });
  } catch (error) {
    console.error('Error in /config:', error);
    res.status(500).json({ error: 'Failed to load configuration' });
  }
});

// OAuth2 authorization endpoint
app.get('/auth/google', (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/auth/google/callback`;
  console.log('Generated redirect_uri:', redirectUri);
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
    console.log('Callback redirect_uri:', redirectUri);
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

    const sessionId = Date.now().toString();
    res.cookie('refresh_token', tokenData.refresh_token, {
      httpOnly: true,
      secure: true, // Requires HTTPS (Render provides this)
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    const clientBaseUrl = process.env.NODE_ENV === 'development'
      ? 'http://127.0.0.1:5500'
      : 'https://dancbsabao.github.io/rhrmspb-rater-by-dan';
    const clientRedirect = `${clientBaseUrl}/?` +
      `access_token=${tokenData.access_token}&` +
      `expires_in=${tokenData.expires_in || 3600}&` +
      `session_id=${sessionId}`;
    console.log('Redirecting to:', clientRedirect);
    res.redirect(clientRedirect);
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send('Authentication failed');
  }
});

// Token refresh endpoint
app.post('/refresh-token', async (req, res) => {
  const refreshToken = req.cookies.refresh_token;
  console.log('Refresh request, cookie refresh_token:', refreshToken);
  if (!refreshToken) {
    console.error('No refresh token in cookies');
    return res.status(401).json({ error: 'No refresh token' });
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
      console.error('Google refresh failed:', newToken);
      throw new Error(newToken.error_description || 'Token refresh failed');
    }
    console.log('Token refreshed:', newToken);
    res.json({
      access_token: newToken.access_token,
      expires_in: newToken.expires_in || 3600,
    });
  } catch (error) {
    console.error('Refresh error:', error.message);
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
