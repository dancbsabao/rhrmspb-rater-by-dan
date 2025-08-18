require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const sessionStore = new Map();
const userManagers = new Map(); // New: Per-user BulletproofAPIManager instances

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
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Handle OPTIONS preflight for all routes
app.options('*', cors());

// BulletproofAPIManager class (ported and adapted for backend; removed client-specific features like localStorage and device staggering)
class BulletproofAPIManager {
  constructor(options = {}) {
    // Configuration
    this.baseDelay = options.baseDelay || 3000; // 3 second base delay
    this.maxDelay = options.maxDelay || 300000; // 5 minute max delay
    this.maxRetries = options.maxRetries || 8;
    this.quotaResetTime = options.quotaResetTime || 24 * 60 * 60 * 1000; // 24 hours
    
    // State management
    this.cache = new Map();
    this.requestQueue = new Map();
    this.rateLimitInfo = new Map();
    this.circuitBreaker = new Map();
    
    // Global quota tracking (in-memory only)
    this.globalQuotaState = this.resetGlobalQuotaState();
    
    // Metrics
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      quotaExceeded: 0
    };
  }

  resetGlobalQuotaState() {
    return {
      requestsToday: 0,
      quotaExceededAt: null,
      lastReset: Date.now(),
      lastQuotaError: null
    };
  }

  // Check if we're in quota exceeded state globally
  isGlobalQuotaExceeded() {
    if (!this.globalQuotaState.quotaExceededAt) return false;
    
    const timeSinceQuotaError = Date.now() - this.globalQuotaState.quotaExceededAt;
    const cooldownTime = Math.min(300000 + (timeSinceQuotaError * 0.1), 3600000); // 5min to 1hour
    
    if (timeSinceQuotaError < cooldownTime) {
      console.log(`🛑 Global quota exceeded. Cooling down for ${Math.round((cooldownTime - timeSinceQuotaError)/1000)}s more`);
      return true;
    }
    
    // Reset quota exceeded state
    this.globalQuotaState.quotaExceededAt = null;
    return false;
  }

  // Enhanced cache with TTL and versioning
  getCachedData(key, maxAge = 5 * 60 * 1000) { // 5 minutes default
    const cached = this.cache.get(key);
    if (!cached) return null;
    
    const age = Date.now() - cached.timestamp;
    if (age > maxAge) {
      this.cache.delete(key);
      return null;
    }
    
    this.metrics.cacheHits++;
    console.log(`📦 Cache hit for ${key} (age: ${Math.round(age/1000)}s)`);
    return cached.data;
  }

  setCachedData(key, data, customTTL = null) {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: customTTL
    });
  }

  // Exponential backoff with jitter
  calculateBackoffDelay(attempt, baseDelay = this.baseDelay) {
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
    return Math.min(exponentialDelay + jitter, this.maxDelay);
  }

  // Circuit breaker pattern
  isCircuitOpen(key) {
    const breaker = this.circuitBreaker.get(key);
    if (!breaker) return false;
    
    const now = Date.now();
    if (now - breaker.lastFailure < breaker.cooldownTime) {
      console.log(`🚫 Circuit breaker OPEN for ${key}. Cooling down...`);
      return true;
    }
    
    // Reset circuit breaker
    this.circuitBreaker.delete(key);
    return false;
  }

  recordFailure(key, isQuotaError = false) {
    const now = Date.now();
    const current = this.circuitBreaker.get(key) || { failures: 0, lastFailure: 0 };
    
    current.failures++;
    current.lastFailure = now;
    
    if (isQuotaError) {
      current.cooldownTime = Math.min(30000 * current.failures, 300000); // 30s to 5min
      this.metrics.quotaExceeded++;
    } else {
      current.cooldownTime = Math.min(5000 * current.failures, 60000); // 5s to 1min
    }
    
    this.circuitBreaker.set(key, current);
    console.log(`🔥 Circuit breaker recorded failure for ${key}. Failures: ${current.failures}, Cooldown: ${current.cooldownTime}ms`);
  }

  recordSuccess(key) {
    this.circuitBreaker.delete(key);
    this.metrics.successfulRequests++;
  }

  // Advanced error classification with quota awareness
  classifyError(error) {
    const errorMessage = error.message || error.toString();
    const errorCode = error.code || error.status;
    
    if (errorCode === 403 || errorMessage.includes('quotaExceeded') || 
        errorMessage.includes('userRateLimitExceeded') ||
        errorMessage.includes('dailyLimitExceeded') ||
        errorMessage.includes('Quota exceeded')) {
      
      this.globalQuotaState.quotaExceededAt = Date.now();
      this.globalQuotaState.lastQuotaError = errorMessage;
      
      return { 
        type: 'quota', 
        retryable: true, 
        backoffMultiplier: 5,
        isGlobal: true 
      };
    }
    
    if (errorCode === 429 || errorMessage.includes('rateLimitExceeded')) {
      return { type: 'rateLimit', retryable: true, backoffMultiplier: 3 };
    }
    
    if (errorMessage.includes('network') || errorMessage.includes('timeout') ||
        errorCode >= 500) {
      return { type: 'network', retryable: true, backoffMultiplier: 2 };
    }
    
    if (errorCode === 401 || errorMessage.includes('unauthorized')) {
      return { type: 'auth', retryable: false, backoffMultiplier: 1 };
    }
    
    return { type: 'unknown', retryable: false, backoffMultiplier: 1 };
  }

  // Main fetch method (adapted for backend)
  async bulletproofFetch(key, fetchFunction, options = {}) {
    this.metrics.totalRequests++;
    
    if (this.isGlobalQuotaExceeded()) {
      const staleData = this.cache.get(key);
      if (staleData) {
        console.log(`🗃️  Using stale cache for ${key} due to global quota exceeded`);
        return staleData.data;
      }
      throw new Error(`Global quota exceeded for ${key}. Try again later.`);
    }
    
    const maxCacheAge = options.maxCacheAge || 5 * 60 * 1000;
    const cachedData = this.getCachedData(key, maxCacheAge);
    if (cachedData && !options.forceRefresh) {
      return cachedData;
    }

    if (this.isCircuitOpen(key)) {
      const staleData = this.cache.get(key);
      if (staleData) {
        console.log(`⚡ Using stale cache for ${key} due to circuit breaker`);
        return staleData.data;
      }
      throw new Error(`Circuit breaker is open for ${key}. No cached data available.`);
    }

    if (this.requestQueue.has(key)) {
      console.log(`⏳ Waiting for existing request: ${key}`);
      return await this.requestQueue.get(key);
    }

    const requestPromise = this.executeWithRetry(key, fetchFunction, options);
    this.requestQueue.set(key, requestPromise);

    try {
      const result = await requestPromise;
      return result;
    } finally {
      this.requestQueue.delete(key);
    }
  }

  async executeWithRetry(key, fetchFunction, options) {
    let lastError = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.isGlobalQuotaExceeded()) {
          throw new Error('Global quota exceeded - using cache fallback');
        }
        
        console.log(`🚀 Attempt ${attempt + 1}/${this.maxRetries + 1} for ${key}`);
        
        if (attempt > 0) {
          const extraDelay = attempt * 1000;
          await this.wait(extraDelay);
        }
        
        const result = await fetchFunction();
        
        this.recordGlobalSuccess(key);
        this.recordSuccess(key);
        this.setCachedData(key, result, options.cacheTTL);
        
        console.log(`✅ Successfully fetched ${key}`);
        return result;
        
      } catch (error) {
        lastError = error;
        this.metrics.failedRequests++;
        
        const errorInfo = this.classifyError(error);
        console.log(`❌ Attempt ${attempt + 1} failed for ${key}:`, {
          type: errorInfo.type,
          retryable: errorInfo.retryable,
          message: error.message
        });
        
        this.recordFailure(key, errorInfo.type === 'quota');
        
        if (errorInfo.isGlobal) {
          this.recordGlobalQuotaFailure(error);
        }
        
        if (!errorInfo.retryable || attempt === this.maxRetries) {
          break;
        }
        
        const baseDelay = this.baseDelay * errorInfo.backoffMultiplier;
        const delay = this.calculateBackoffDelay(attempt, baseDelay);
        
        console.log(`⏱️  Waiting ${Math.round(delay/1000)}s before retry...`);
        await this.wait(delay);
      }
    }
    
    const staleData = this.cache.get(key);
    if (staleData) {
      console.log(`🗃️  All retries failed for ${key}. Using stale cache (age: ${Math.round((Date.now() - staleData.timestamp)/1000)}s)`);
      return staleData.data;
    }
    
    throw new Error(`All retry attempts failed for ${key}. Last error: ${lastError.message}`);
  }

  recordGlobalSuccess(key) {
    this.globalQuotaState.requestsToday++;
  }

  recordGlobalQuotaFailure(error) {
    this.globalQuotaState.quotaExceededAt = Date.now();
    this.globalQuotaState.lastQuotaError = error.message;
    
    console.log(`🚨 GLOBAL QUOTA EXCEEDED`);
  }

  // Utility methods
  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getMetrics() {
    const cacheSize = this.cache.size;
    const queueSize = this.requestQueue.size;
    const circuitBreakers = this.circuitBreaker.size;
    
    return {
      ...this.metrics,
      cacheSize,
      queueSize,
      circuitBreakers,
      successRate: this.metrics.totalRequests > 0 ? 
        (this.metrics.successfulRequests / this.metrics.totalRequests) * 100 : 0,
      globalQuotaState: {
        requestsToday: this.globalQuotaState.requestsToday,
        quotaExceeded: !!this.globalQuotaState.quotaExceededAt
      }
    };
  }

  clearCache() {
    this.cache.clear();
    console.log('🗑️  Cache cleared');
  }

  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      quotaExceeded: 0
    };
    console.log('📊 Metrics reset');
  }
}

// Config endpoint
app.get('/config', (req, res) => {
  try {
    console.log('Config endpoint hit');
    console.log('Raw SHEET_RANGES:', process.env.SHEET_RANGES);
    const sheetRanges = process.env.SHEET_RANGES ? JSON.parse(process.env.SHEET_RANGES) : {};
    console.log('Parsed SHEET_RANGES:', sheetRanges);
    sheetRanges.SECRETARIAT_MEMBERS = 'SECRETARIAT_MEMBERS!A:D'; // Add new sheet range
    sheetRanges.SECRETARIAT_SIGNATORIES = 'SECRETARIAT_MEMBERS!E:G'; // New range for signatories
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

    // Fetch user ID from userinfo
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const user = await userResponse.json();
    if (user.error) {
      throw new Error(user.error_description || 'Failed to fetch user info');
    }
    const userId = user.sub;

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

      // Initialize per-user manager if not exists
      if (!userManagers.has(userId)) {
        userManagers.set(userId, new BulletproofAPIManager({
          baseDelay: 5000,
          maxDelay: 300000,
          maxRetries: 10
        }));
      }
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

// New: Proxy endpoint for Sheets API with per-user rate limiting
app.get('/api/sheets/values', async (req, res) => {
  const { range } = req.query;
  if (!range) {
    return res.status(400).json({ error: 'No range provided' });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No access token provided' });
  }

  try {
    // Fetch user ID from userinfo (cached via manager key, but fetch here for validation)
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const user = await userResponse.json();
    if (user.error) {
      return res.status(401).json({ error: 'Invalid access token' });
    }
    const userId = user.sub;

    let manager = userManagers.get(userId);
    if (!manager) {
      manager = new BulletproofAPIManager({
        baseDelay: 5000,
        maxDelay: 300000,
        maxRetries: 10
      });
      userManagers.set(userId, manager);
    }

    const data = await manager.bulletproofFetch(range, async () => {
      const sheetsUrl = `https://sheets.googleapis.com/v4/spreadsheets/${process.env.SHEET_ID}/values/${range}`;
      const response = await fetch(sheetsUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const json = await response.json();
      if (json.error) {
        throw new Error(json.error.message || 'Sheets API error');
      }
      return json;
    }, {
      maxCacheAge: 5 * 60 * 1000,
      cacheTTL: 15 * 60 * 1000,
      forceRefresh: req.query.forceRefresh === 'true'
    });

    res.json(data);
  } catch (error) {
    console.error('Error in /api/sheets/values:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/ping', (req, res) => {
  res.send('pong');
});

// Add clear-session endpoint
app.post('/clear-session', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  const { sessionId } = req.body;
  if (!token || !sessionId) {
    return res.status(401).json({ error: 'No access token or session ID provided' });
  }
  try {
    sessionStore.delete(sessionId);
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });
    res.json({ message: 'Session cleared' });
  } catch (error) {
    console.error('Error clearing session:', error);
    res.status(500).json({ error: 'Failed to clear session' });
  }
});

// Add logout-all endpoint
app.post('/logout-all', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No access token provided' });
  }
  try {
    await fetch('https://accounts.google.com/o/oauth2/revoke?token=' + token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    sessionStore.clear();
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'None'
    });
    res.json({ message: 'All sessions logged out' });
  } catch (error) {
    console.error('Error logging out all sessions:', error);
    res.status(500).json({ error: 'Failed to log out all sessions' });
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
