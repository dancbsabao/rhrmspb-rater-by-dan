const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(cookieParser());
const allowedOrigins = [
  'https://dancbsabao.github.io/rhrmspb-rater-by-dan',
  'https://dancbsabao.github.io',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
];
app.use(cors({
  origin: function (origin, callback) {
    console.log('Request Origin:', origin, 'Method:', req.method, 'Path:', req.path);
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('CORS rejected origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true, // Allow cookies to be sent
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  `${process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:10000' : 'https://rhrmspb-rater-by-dan.onrender.com'}/auth/google/callback`
);

app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    scope: process.env.SCOPES.split(','),
    access_type: 'offline',
    prompt: 'consent',
  });
  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { tokens } = await oauth2Client.getToken(req.query.code);
    const sessionId = Date.now().toString();
    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
    const clientBaseUrl = process.env.NODE_ENV === 'development'
      ? 'http://127.0.0.1:5500'
      : 'https://dancbsabao.github.io/rhrmspb-rater-by-dan';
    res.redirect(`${clientBaseUrl}/?access_token=${tokens.access_token}&expires_in=${tokens.expires_in || 3600}&session_id=${sessionId}`);
  } catch (error) {
    console.error('Auth callback error:', error);
    res.status(500).send('Authentication failed');
  }
});

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

app.get('/config', (req, res) => {
  console.log('Config endpoint hit');
  res.json({
    CLIENT_ID: process.env.CLIENT_ID,
    API_KEY: process.env.API_KEY,
    SHEET_ID: process.env.SHEET_ID,
    SCOPES: process.env.SCOPES,
    EVALUATOR_PASSWORDS: JSON.parse(process.env.EVALUATOR_PASSWORDS),
    SHEET_RANGES: JSON.parse(process.env.SHEET_RANGES),
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
