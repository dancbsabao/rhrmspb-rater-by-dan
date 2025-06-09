require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const sessionStore = new Map();

const app = express();
app.set('trust proxy', true);

// Middleware
app.use(cookieParser());
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://dancbsabao.github.io/rhrmspb-rater-by-dan',
      'https://dancbsabao.github.io',
      'http://127.0.0.1:5500',
      'http://localhost:3000',
    ];
    console.log('Request Origin:', origin);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, origin || 'https://dancbsabao.github.io');
    } else {
      console.error('CORS rejected origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));
app.use(express.json());

// Handle OPTIONS preflight for /refresh-token
app.options('/refresh-token', cors());

// Config endpoint
app.get('/config', (req, res) => {
  try {
    console.log('Config endpoint hit');
    console.log('Raw SHEET_RANGES:', process.env.SHEET_RANGES);
    const sheetRanges = process.env.SHEET_RANGES ? JSON.parse(process.env.SHEET_RANGES) : {};
    console.log('Parsed SHEET_RANGES:', sheetRanges);
    sheetRanges.SECRETARIAT_MEMBERS = 'SECRETARIAT_MEMBERS!A:D'; // Add new sheet range
    res.json({
      CLIENT_ID: process.env.CLIENT_ID || '',
      API_KEY: process.env.API_KEY || '',
      SHEET_ID: process.env.SHEET_ID || '',
      SCOPES: process.env.SCOPES || '',
      EVALUATOR_PASSWORDS: process.env.EVALUATOR_PASSWORDS
        ? JSON.parse(process.env.EVALUATOR_PASSWORDS)
        : [],
      SHEET_RANGES: sheetRanges,
      CLIENT_SECRET: process.env.CLIENT_SECRET || '',
      SECRETARIAT_PASSWORD: process.env.SECRETARIAT_PASSWORD || '',
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
    if (tokenData.refresh_token) {
      sessionStore.set(sessionId, tokenData.refresh_token);
      res.cookie('refresh_token', tokenData.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      console.log('Stored session_id:', sessionId, 'with refresh_token:', tokenData.refresh_token);
    } else {
      console.warn('No refresh_token in Google response');
    }

    const clientRedirect = `https://dancbsabao.github.io/rhrmspb-rater-by-dan/?` +
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
  console.log('Cookies received:', req.cookies);
  console.log('Request headers:', req.headers);
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
    if (newToken.error) throw new Error(newToken.error_description || 'Token refresh failed');
    console.log('Token refreshed:', newToken);
    res.json({
      access_token: newToken.access_token,
      expires_in: newToken.expires_in || 3600,
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
