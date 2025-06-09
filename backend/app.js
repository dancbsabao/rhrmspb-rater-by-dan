require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const cookieParser = require('cookie-parser');
const crypto = require('crypto'); // Still needed for password verification

const app = express();
app.set('trust proxy', true);

// In-memory store for session data and a temporary place for the sheets API access token
// In a production app, this would be a persistent database.
const sessionStore = new Map();
let sheetsApiAccessToken = null; // Store the access token for Google Sheets API calls
let sheetsApiAccessTokenExpiry = 0; // Expiry time in milliseconds since epoch

// Global variable to hold secretariat member data (loaded from sheet)
const secretariatMembers = new Map();

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
            callback(null, origin || 'https://dancbsabao.github.io'); // Explicit origin
        } else {
            console.error('CORS rejected origin:', origin);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Handle OPTIONS preflight for /refresh-token and all secretariat routes
app.options('/refresh-token', cors());
app.options('/secretariat/*', cors());

/**
 * Loads secretariat members from the Google Sheet.
 * This function requires a valid access token for Google Sheets API.
 */
async function loadSecretariatMembersFromSheet() {
    if (!sheetsApiAccessToken || Date.now() >= sheetsApiAccessTokenExpiry) {
        console.warn('Google Sheets API access token is missing or expired. Attempting to refresh...');
        // In a real application, you'd have a dedicated mechanism to refresh
        // the server's Google Sheets API token, potentially using a stored refresh token
        // associated with your service account or a specific user authorized for Sheets.
        // For this example, we'll assume the /refresh-token endpoint keeps it updated
        // or a manual re-auth is done if it's completely gone.
        // You might want to call a function here that tries to refresh using a persistent refresh token.
        // For now, if it's missing, we'll just log a warning and return empty.
        // A more robust solution involves a dedicated server-side refresh token management.
        return false;
    }

    try {
        const SHEET_ID = process.env.SHEET_ID;
        const SECRETARIAT_MEMBERS_RANGE = process.env.SHEET_RANGES
            ? JSON.parse(process.env.SHEET_RANGES).SECRETARIAT_MEMBERS
            : 'SECRETARIAT_MEMBERS!A:D'; // Default if not in env

        if (!SHEET_ID || !SECRETARIAT_MEMBERS_RANGE) {
            console.error('SHEET_ID or SECRETARIAT_MEMBERS_RANGE is not configured.');
            return false;
        }

        const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SECRETARIAT_MEMBERS_RANGE)}`;
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch sheet data: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const values = data.values;

        if (!values || values.length === 0) {
            console.log('No data found in SECRETARIAT_MEMBERS sheet.');
            secretariatMembers.clear();
            return true;
        }

        // Assuming the first row is headers: id, name, passwordHash, vacancies
        const headers = values[0].map(h => h.trim());
        const memberData = values.slice(1);

        secretariatMembers.clear(); // Clear existing data before loading new
        memberData.forEach(row => {
            const member = {};
            headers.forEach((header, index) => {
                let value = row[index];
                if (header === 'vacancies' && value) {
                    member[header] = value.split(',').map(v => v.trim()); // Parse comma-separated string to array
                } else {
                    member[header] = value;
                }
            });
            if (member.id) {
                secretariatMembers.set(member.id, member);
            }
        });
        console.log(`Loaded ${secretariatMembers.size} secretariat members from Google Sheet.`);
        return true;
    } catch (error) {
        console.error('Error loading secretariat members from Google Sheet:', error);
        return false;
    }
}

/**
 * Updates a specific row in the Google Sheet for a secretariat member.
 * This function assumes 'id' is in column A.
 * @param {object} memberData - The member data to update.
 */
async function updateSecretariatMemberInSheet(memberData) {
    if (!sheetsApiAccessToken || Date.now() >= sheetsApiAccessTokenExpiry) {
        console.error('Cannot update sheet: Google Sheets API access token is missing or expired.');
        return false;
    }

    try {
        const SHEET_ID = process.env.SHEET_ID;
        const SECRETARIAT_MEMBERS_SHEET_NAME = process.env.SHEET_RANGES
            ? JSON.parse(process.env.SHEET_RANGES).SECRETARIAT_MEMBERS.split('!')[0]
            : 'SECRETARIAT_MEMBERS';

        if (!SHEET_ID || !SECRETARIAT_MEMBERS_SHEET_NAME) {
            console.error('SHEET_ID or SECRETARIAT_MEMBERS_SHEET_NAME is not configured.');
            return false;
        }

        // First, get all data to find the row index of the member
        const currentDataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SECRETARIAT_MEMBERS_SHEET_NAME)}!A:Z`, {
            headers: {
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
        });
        if (!currentDataResponse.ok) {
            const errorText = await currentDataResponse.text();
            throw new Error(`Failed to fetch current sheet data for update: ${currentDataResponse.status} - ${errorText}`);
        }
        const currentData = await currentDataResponse.json();
        const values = currentData.values || [];

        const headers = values.length > 0 ? values[0].map(h => h.trim()) : [];
        const memberRowIndex = values.findIndex((row, idx) => idx > 0 && row[headers.indexOf('id')] === memberData.id);

        if (memberRowIndex === -1) {
            console.error(`Member with ID ${memberData.id} not found in sheet for update.`);
            return false;
        }

        // Construct the row to update
        const newRow = [];
        headers.forEach(header => {
            if (header === 'vacancies') {
                newRow.push(Array.isArray(memberData.vacancies) ? memberData.vacancies.join(',') : '');
            } else {
                newRow.push(memberData[header] || '');
            }
        });

        const range = `${SECRETARIAT_MEMBERS_SHEET_NAME}!A${memberRowIndex + 1}`; // +1 because sheet is 1-indexed

        const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
        const updateResponse = await fetch(updateUrl, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
            body: JSON.stringify({ values: [newRow] }),
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            throw new Error(`Failed to update sheet row: ${updateResponse.status} - ${errorText}`);
        }
        console.log(`Successfully updated member ${memberData.id} in Google Sheet.`);
        return true;
    } catch (error) {
        console.error('Error updating secretariat member in Google Sheet:', error);
        return false;
    }
}

/**
 * Appends a new secretariat member to the Google Sheet.
 */
async function addSecretariatMemberToSheet(memberData) {
    if (!sheetsApiAccessToken || Date.now() >= sheetsApiAccessTokenExpiry) {
        console.error('Cannot add to sheet: Google Sheets API access token is missing or expired.');
        return false;
    }

    try {
        const SHEET_ID = process.env.SHEET_ID;
        const SECRETARIAT_MEMBERS_SHEET_NAME = process.env.SHEET_RANGES
            ? JSON.parse(process.env.SHEET_RANGES).SECRETARIAT_MEMBERS.split('!')[0]
            : 'SECRETARIAT_MEMBERS';

        if (!SHEET_ID || !SECRETARIAT_MEMBERS_SHEET_NAME) {
            console.error('SHEET_ID or SECRETARIAT_MEMBERS_SHEET_NAME is not configured.');
            return false;
        }

        // First, get headers to ensure correct column order
        const headersResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SECRETARIAT_MEMBERS_SHEET_NAME)}!1:1`, {
            headers: {
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
        });
        if (!headersResponse.ok) {
            const errorText = await headersResponse.text();
            throw new Error(`Failed to fetch sheet headers for append: ${headersResponse.status} - ${errorText}`);
        }
        const headersData = await headersResponse.json();
        const headers = (headersData.values && headersData.values.length > 0) ? headersData.values[0].map(h => h.trim()) : [];

        if (headers.length === 0) {
            console.error('Could not determine sheet headers for appending.');
            return false;
        }

        const newRow = [];
        headers.forEach(header => {
            if (header === 'vacancies') {
                newRow.push(Array.isArray(memberData.vacancies) ? memberData.vacancies.join(',') : '');
            } else {
                newRow.push(memberData[header] || '');
            }
        });

        const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SECRETARIAT_MEMBERS_SHEET_NAME)}!A1:append?valueInputOption=RAW`;
        const appendResponse = await fetch(appendUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
            body: JSON.stringify({ values: [newRow] }),
        });

        if (!appendResponse.ok) {
            const errorText = await appendResponse.text();
            throw new Error(`Failed to append row to sheet: ${appendResponse.status} - ${errorText}`);
        }
        console.log(`Successfully added member ${memberData.id} to Google Sheet.`);
        return true;
    } catch (error) {
        console.error('Error adding secretariat member to Google Sheet:', error);
        return false;
    }
}

/**
 * Deletes a specific row in the Google Sheet for a secretariat member.
 * This is more complex as Google Sheets API doesn't have a direct "delete row by ID" functionality.
 * The typical approach is to read all data, find the row index, and then use batchUpdate to delete.
 */
async function deleteSecretariatMemberFromSheet(memberId) {
    if (!sheetsApiAccessToken || Date.now() >= sheetsApiAccessTokenExpiry) {
        console.error('Cannot delete from sheet: Google Sheets API access token is missing or expired.');
        return false;
    }

    try {
        const SHEET_ID = process.env.SHEET_ID;
        const SECRETARIAT_MEMBERS_SHEET_NAME = process.env.SHEET_RANGES
            ? JSON.parse(process.env.SHEET_RANGES).SECRETARIAT_MEMBERS.split('!')[0]
            : 'SECRETARIAT_MEMBERS';

        if (!SHEET_ID || !SECRETARIAT_MEMBERS_SHEET_NAME) {
            console.error('SHEET_ID or SECRETARIAT_MEMBERS_SHEET_NAME is not configured.');
            return false;
        }

        // Get all data to find the row index of the member
        const currentDataResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(SECRETARIAT_MEMBERS_SHEET_NAME)}!A:Z`, {
            headers: {
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
        });
        if (!currentDataResponse.ok) {
            const errorText = await currentDataResponse.text();
            throw new Error(`Failed to fetch current sheet data for delete: ${currentDataResponse.status} - ${errorText}`);
        }
        const currentData = await currentDataResponse.json();
        const values = currentData.values || [];

        const headers = values.length > 0 ? values[0].map(h => h.trim()) : [];
        const memberRowIndex = values.findIndex((row, idx) => idx > 0 && row[headers.indexOf('id')] === memberId);

        if (memberRowIndex === -1) {
            console.error(`Member with ID ${memberId} not found in sheet for deletion.`);
            return false;
        }

        // Use batchUpdate to delete the row
        const deleteRequest = {
            requests: [{
                deleteDimension: {
                    range: {
                        sheetId: 0, // Assuming first sheet, you might need to get actual sheetId if not
                        dimension: 'ROWS',
                        startIndex: memberRowIndex,
                        endIndex: memberRowIndex + 1
                    }
                }
            }]
        };

        const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}:batchUpdate`;
        const deleteResponse = await fetch(batchUpdateUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${sheetsApiAccessToken}`,
            },
            body: JSON.stringify(deleteRequest),
        });

        if (!deleteResponse.ok) {
            const errorText = await deleteResponse.text();
            throw new Error(`Failed to delete row from sheet: ${deleteResponse.status} - ${errorText}`);
        }
        console.log(`Successfully deleted member ${memberId} from Google Sheet.`);
        return true;
    } catch (error) {
        console.error('Error deleting secretariat member from Google Sheet:', error);
        return false;
    }
}


// Middleware to authenticate secretariat
// This will now check for a secretariat-specific token generated on login.
function authenticateSecretariat(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header missing' });
    }

    const token = authHeader.split(' ')[1]; // Assuming 'Bearer TOKEN'
    if (!token) {
        return res.status(401).json({ error: 'Auth token missing' });
    }

    const authenticatedSession = sessionStore.get(token);
    if (!authenticatedSession || !authenticatedSession.secretariatId) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.secretariat = { id: authenticatedSession.secretariatId }; // Attach secretariat info to request
    next();
}

// Config endpoint
app.get('/config', (req, res) => {
    try {
        console.log('Config endpoint hit');
        console.log('Raw SHEET_RANGES:', process.env.SHEET_RANGES);
        const sheetRanges = process.env.SHEET_RANGES ? JSON.parse(process.env.SHEET_RANGES) : {};
        console.log('Parsed SHEET_RANGES:', sheetRanges);
        res.json({
            CLIENT_ID: process.env.CLIENT_ID || '',
            API_KEY: process.env.API_KEY || '',
            SHEET_ID: process.env.SHEET_ID || '',
            SCOPES: process.env.SCOPES || '',
            EVALUATOR_PASSWORDS: process.env.EVALUATOR_PASSWORDS
                ? JSON.parse(process.env.EVALUATOR_PASSWORDS)
                : [],
            SHEET_RANGES: sheetRanges,
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
    // Ensure SCOPES includes 'https://www.googleapis.com/auth/spreadsheets'
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

        // Store the access token for server-side Google Sheets API calls
        sheetsApiAccessToken = tokenData.access_token;
        sheetsApiAccessTokenExpiry = Date.now() + (tokenData.expires_in * 1000) - 60000; // 1 minute buffer

        // After successful authentication, attempt to load secretariat members
        await loadSecretariatMembersFromSheet();

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

        // Update the server-side Sheets API access token
        sheetsApiAccessToken = newToken.access_token;
        sheetsApiAccessTokenExpiry = Date.now() + (newToken.expires_in * 1000) - 60000; // 1 minute buffer

        res.json({
            access_token: newToken.access_token,
            expires_in: newToken.expires_in || 3600,
        });
    } catch (error) {
        console.error('Error refreshing token:', error);
        res.status(500).json({ error: 'Failed to refresh token' });
    }
});

// New Secretariat Authentication and Management Endpoints

// Endpoint to log in a secretariat member
app.post('/secretariat/login', async (req, res) => {
    const { id, password } = req.body;
    if (!id || !password) {
        return res.status(400).json({ error: 'ID and password are required' });
    }

    // Ensure secretariat members are loaded before attempting login
    if (secretariatMembers.size === 0) {
        const loaded = await loadSecretariatMembersFromSheet();
        if (!loaded) {
            return res.status(500).json({ error: 'Failed to load secretariat members for login. Please ensure Google Sheets access is authorized.' });
        }
    }

    const member = secretariatMembers.get(id);
    if (!member) {
        return res.status(401).json({ error: 'Invalid ID or password' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    if (hashedPassword !== member.passwordHash) {
        return res.status(401).json({ error: 'Invalid ID or password' });
    }

    const secretariatSessionToken = crypto.randomBytes(32).toString('hex');
    sessionStore.set(secretariatSessionToken, { secretariatId: id, createdAt: Date.now() });

    res.json({ message: 'Login successful', token: secretariatSessionToken, memberId: id });
});

// Endpoint to create a new secretariat member (protected)
app.post('/secretariat/members', authenticateSecretariat, async (req, res) => {
    const { id, name, password, vacancies } = req.body;
    if (!id || !name || !password || !Array.isArray(vacancies)) {
        return res.status(400).json({ error: 'ID, name, password, and vacancies (array) are required' });
    }

    if (secretariatMembers.has(id)) {
        return res.status(409).json({ error: 'Secretariat member with this ID already exists' });
    }

    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const newMember = {
        id,
        name,
        passwordHash: hashedPassword,
        vacancies,
    };

    const success = await addSecretariatMemberToSheet(newMember);
    if (success) {
        secretariatMembers.set(id, newMember); // Update in-memory map
        const { passwordHash, ...safeMember } = newMember;
        res.status(201).json({ message: 'Secretariat member created successfully', member: safeMember });
    } else {
        res.status(500).json({ error: 'Failed to save secretariat member to Google Sheet' });
    }
});

// Endpoint to view all secretariat members (protected)
app.get('/secretariat/members', authenticateSecretariat, async (req, res) => {
    // Ensure secretariat members are refreshed from sheet on every request for the most up-to-date view
    const loaded = await loadSecretariatMembersFromSheet();
    if (!loaded) {
        return res.status(500).json({ error: 'Failed to load secretariat members from Google Sheet.' });
    }
    const members = Array.from(secretariatMembers.values()).map(member => {
        const { passwordHash, ...safeMember } = member;
        return safeMember;
    });
    res.json({ members });
});

// Endpoint to update a secretariat member (protected)
app.put('/secretariat/members/:id', authenticateSecretariat, async (req, res) => {
    const { id } = req.params;
    const { name, password, vacancies } = req.body;

    const member = secretariatMembers.get(id);
    if (!member) {
        return res.status(404).json({ error: 'Secretariat member not found' });
    }

    if (name) member.name = name;
    if (password) member.passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    if (Array.isArray(vacancies)) member.vacancies = vacancies;

    const success = await updateSecretariatMemberInSheet(member);
    if (success) {
        secretariatMembers.set(id, member); // Update in-memory map
        const { passwordHash, ...safeMember } = member;
        res.json({ message: 'Secretariat member updated successfully', member: safeMember });
    } else {
        res.status(500).json({ error: 'Failed to update secretariat member in Google Sheet' });
    }
});

// Endpoint to delete a secretariat member (protected)
app.delete('/secretariat/members/:id', authenticateSecretariat, async (req, res) => {
    const { id } = req.params;

    if (!secretariatMembers.has(id)) {
        return res.status(404).json({ error: 'Secretariat member not found' });
    }

    const success = await deleteSecretariatMemberFromSheet(id);
    if (success) {
        secretariatMembers.delete(id); // Delete from in-memory map
        res.status(204).send();
    } else {
        res.status(500).json({ error: 'Failed to delete secretariat member from Google Sheet' });
    }
});


// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    // Optionally load members on server start if an access token is already available
    // or if you have a service account setup for persistent access.
    // For this setup, it's safer to rely on the OAuth callback to populate sheetsApiAccessToken.
});
