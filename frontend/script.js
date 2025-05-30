// Global variables
let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;
let fetchTimeout;
let isSubmitting = false;
let refreshTimer = null;
let sessionId = null; // To track server session
let submissionQueue = []; // Queue for pending submissions
let currentTab = 'rater'; // Track current tab ('rater' or 'secretariat')
let generalList = [];
let disqualified = [];
let rateLog = [];
let SECRETARIAT_PASSWORD = '';
let secretariatMemberId = null; // Initialize secretariat member ID
let activeCommentModalOperations = new Set();
let minimizedModals = new Map(); // Store minimized comment modal states
let ballPositions = []; // Track positions of floating balls

let CLIENT_ID;
let API_KEY;
let SHEET_ID;
let SCOPES;
let EVALUATOR_PASSWORDS;
let SHEET_RANGES;

const elements = {
  authStatus: document.getElementById('authStatus'),
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  assignmentDropdown: document.getElementById('assignmentDropdown'),
  positionDropdown: document.getElementById('positionDropdown'),
  itemDropdown: document.getElementById('itemDropdown'),
  nameDropdown: document.getElementById('nameDropdown'),
  competencyContainer: document.getElementById('competencyContainer'),
  submitRatings: document.getElementById('submitRatings'),
  ratingForm: document.querySelector('.rating-form'),
};

let vacancies = [];
let candidates = [];
let compeCodes = [];
let competencies = [];

const API_BASE_URL = "https://rhrmspb-rater-by-dan.onrender.com";

function saveAuthState(tokenResponse, evaluator) {
  const authState = {
    access_token: tokenResponse.access_token,
    session_id: tokenResponse.session_id || sessionId,
    expires_at: Date.now() + ((tokenResponse.expires_in || 3600) * 1000),
    evaluator: evaluator || null,
    secretariatMemberId: typeof secretariatMemberId !== 'undefined' ? secretariatMemberId : null,
  };
  localStorage.setItem('authState', JSON.stringify(authState));
  console.log('Auth state saved:', authState);
  scheduleTokenRefresh();
}




let debounceTimeout = null;
function saveDropdownState() {
  // Clear any existing debounce timeout
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

  // Debounce state saving by 100ms to ensure DOM updates are complete
  debounceTimeout = setTimeout(() => {
    const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
    const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');
    const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');

    const dropdownState = {
      evaluator: document.getElementById('evaluatorSelect')?.value || '',
      assignment: elements.assignmentDropdown.value || '',
      position: elements.positionDropdown.value || '',
      item: elements.itemDropdown.value || '',
      name: elements.nameDropdown.value || '',
      secretariatAssignment: secretariatAssignmentDropdown?.value || '',
      secretariatPosition: secretariatPositionDropdown?.value || '',
      secretariatItem: secretariatItemDropdown?.value || '',
    };

    localStorage.setItem('dropdownState', JSON.stringify(dropdownState));
    console.log('Dropdown state saved:', dropdownState);
  }, 100);
}
function loadDropdownState() {
  const dropdownState = JSON.parse(localStorage.getItem('dropdownState')) || {};
  console.log('Loaded dropdown state:', dropdownState);
  return dropdownState;
}

function loadAuthState() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState || !authState.access_token) {
    console.log('No auth state found');
    return null;
  }
  // Define sanitizedAuthState to exclude access_token
  const sanitizedAuthState = {
    session_id: authState.session_id,
    expires_at: authState.expires_at,
    evaluator: authState.evaluator,
    secretariatMemberId: authState.secretariatMemberId
  };
  console.log('Loaded auth state:', sanitizedAuthState);
  return authState;
}

function loadDropdownState() {
  const dropdownState = JSON.parse(localStorage.getItem('dropdownState'));
  console.log('Loaded dropdown state:', dropdownState);
  return dropdownState || {};
}

async function restoreState() {
  dropdownStateRestoring = true; // Set flag during restoration
  const authState = loadAuthState();
  const dropdownState = loadDropdownState();
  const authSection = document.querySelector('.auth-section');
  const container = document.querySelector('.container');

  try {
    if (authState) {
      gapi.client.setToken({ access_token: authState.access_token });
      sessionId = authState.session_id;
      secretariatMemberId = authState.secretariatMemberId;
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await isTokenValid()) await refreshAccessToken();
      currentEvaluator = authState.evaluator;
      updateUI(true);
      authSection.classList.remove('signed-out');

      // Load sheet data
      await loadSheetData();
      console.log('Sheet data loaded, initializing dropdowns');

      // Initialize dropdowns for both tabs
      initializeDropdowns(vacancies); // Rater tab
      await initializeSecretariatDropdowns(); // Secretariat tab

      const evaluatorSelect = document.getElementById('evaluatorSelect');
      if (evaluatorSelect && dropdownState.evaluator) {
        evaluatorSelect.value = dropdownState.evaluator;
        currentEvaluator = dropdownState.evaluator;
      }

      const changePromises = [];
      // Restore Rater dropdowns
      if (dropdownState.assignment && elements.assignmentDropdown) {
        const options = Array.from(elements.assignmentDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.assignment)) {
          elements.assignmentDropdown.value = dropdownState.assignment;
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); elements.assignmentDropdown.removeEventListener('change', handler); };
            elements.assignmentDropdown.addEventListener('change', handler, { once: true });
            elements.assignmentDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.position && elements.positionDropdown) {
        const options = Array.from(elements.positionDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.position)) {
          elements.positionDropdown.value = dropdownState.position;
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); elements.positionDropdown.removeEventListener('change', handler); };
            elements.positionDropdown.addEventListener('change', handler, { once: true });
            elements.positionDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.item && elements.itemDropdown) {
        const options = Array.from(elements.itemDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.item)) {
          elements.itemDropdown.value = dropdownState.item;
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); elements.itemDropdown.removeEventListener('change', handler); };
            elements.itemDropdown.addEventListener('change', handler, { once: true });
            elements.itemDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.name && elements.nameDropdown) {
        const options = Array.from(elements.nameDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.name)) {
          elements.nameDropdown.value = dropdownState.name;
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); elements.nameDropdown.removeEventListener('change', handler); };
            elements.nameDropdown.addEventListener('change', handler, { once: true });
            elements.nameDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }

      // Restore Secretariat dropdowns
      const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
      const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');
      const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');

      if (dropdownState.secretariatAssignment && secretariatAssignmentDropdown) {
        const options = Array.from(secretariatAssignmentDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatAssignment)) {
          secretariatAssignmentDropdown.value = dropdownState.secretariatAssignment;
          console.log(`Restored secretariatAssignmentDropdown to: ${dropdownState.secretariatAssignment}`);
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); secretariatAssignmentDropdown.removeEventListener('change', handler); };
            secretariatAssignmentDropdown.addEventListener('change', handler, { once: true });
            secretariatAssignmentDropdown.dispatchEvent(new Event('change'));
          }));
        } else {
          console.error(`Saved assignment value ${dropdownState.secretariatAssignment} not found in options:`, options);
          showToast('warning', 'Warning', `Assignment "${dropdownState.secretariatAssignment}" not available`);
        }
      }
      if (dropdownState.secretariatPosition && secretariatPositionDropdown) {
        const options = Array.from(secretariatPositionDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatPosition)) {
          secretariatPositionDropdown.value = dropdownState.secretariatPosition;
          console.log(`Restored secretariatPositionDropdown to: ${dropdownState.secretariatPosition}`);
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); secretariatPositionDropdown.removeEventListener('change', handler); };
            secretariatPositionDropdown.addEventListener('change', handler, { once: true });
            secretariatPositionDropdown.dispatchEvent(new Event('change'));
          }));
        } else {
          console.warn(`Saved position value ${dropdownState.secretariatPosition} not found in options:`, options);
        }
      }
      if (dropdownState.secretariatItem && secretariatItemDropdown) {
        const options = Array.from(secretariatItemDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatItem)) {
          secretariatItemDropdown.value = dropdownState.secretariatItem;
          console.log(`Restored secretariatItemDropdown to: ${dropdownState.secretariatItem}`);
          changePromises.push(new Promise(resolve => {
            const handler = () => { resolve(); secretariatItemDropdown.removeEventListener('change', handler); };
            secretariatItemDropdown.addEventListener('change', handler, { once: true });
            secretariatItemDropdown.dispatchEvent(new Event('change'));
          }));
        } else {
          console.warn(`Saved item value ${dropdownState.secretariatItem} not found in options:`, options);
        }
      }

      await Promise.all(changePromises);

      // Ensure UI reflects restored values with a slight delay
      if (currentTab === 'secretariat' && secretariatAssignmentDropdown) {
        await new Promise(resolve => setTimeout(resolve, 100));
        secretariatAssignmentDropdown.value = dropdownState.secretariatAssignment || '';
        secretariatAssignmentDropdown.dispatchEvent(new Event('change'));
        console.log('Re-applied secretariatAssignmentDropdown value for UI consistency');
      }

      if (currentEvaluator && elements.nameDropdown.value && elements.itemDropdown.value && currentTab === 'rater') {
        fetchSubmittedRatings();
      }
      if (localStorage.getItem('secretariatAuthenticated') && localStorage.getItem('currentTab') === 'secretariat') {
        switchTab('secretariat');
        if (secretariatItemDropdown.value) {
          fetchSecretariatCandidates(secretariatItemDropdown.value);
        }
      }
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      const accessToken = urlParams.get('access_token');
      const expiresIn = urlParams.get('expires_in');
      sessionId = urlParams.get('session_id');
      if (accessToken && sessionId) {
        handleTokenCallback({
          access_token: accessToken,
          expires_in: parseInt(expiresIn, 10),
          session_id: sessionId,
        });
        window.history.replaceState({}, document.title, '/rhrmspb-rater-by-dan/');
      } else {
        updateUI(false);
        currentEvaluator = null;
        vacancies = [];
        candidates = [];
        compeCodes = [];
        competencies = [];
        resetDropdowns([]);
        container.style.marginTop = '20px';
        authSection.classList.add('signed-out');
        const resultsArea = document.querySelector('.results-area');
        if (resultsArea) resultsArea.remove();
      }
    }
  } finally {
    dropdownStateRestoring = false; // Reset flag after restoration
  }
}


// Ensure initializeSecretariatDropdowns is called with proper vacancy data
async function initializeSecretariatDropdowns() {
  console.log('Initializing Secretariat dropdowns with vacancies:', vacancies);
  const assignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
  const positionDropdown = document.getElementById('secretariatPositionDropdown');
  const itemDropdown = document.getElementById('secretariatItemDropdown');

  if (!vacancies || vacancies.length <= 1) {
    console.warn('No valid vacancies data available');
    showToast('error', 'Error', 'No vacancies available to populate dropdowns');
    return;
  }

  const uniqueAssignments = [...new Set(vacancies.slice(1).map(row => row[2]?.trim()))].filter(Boolean);
  console.log('Unique assignments:', uniqueAssignments);
  updateDropdown(assignmentDropdown, uniqueAssignments, 'Select Assignment');

  // Remove existing event listeners using a single reference
  assignmentDropdown.removeEventListener('change', assignmentDropdown._changeHandler);
  assignmentDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    console.log('Assignment changed to:', selectedAssignment);
    const filteredPositions = [...new Set(
      vacancies.slice(1).filter(row => row[2]?.trim() === selectedAssignment).map(row => row[1]?.trim())
    )].filter(Boolean);
    console.log('Filtered positions:', filteredPositions);
    updateDropdown(positionDropdown, filteredPositions, 'Select Position');
    updateDropdown(itemDropdown, [], 'Select Item'); // Reset item dropdown
    saveDropdownState();
  };
  assignmentDropdown.addEventListener('change', assignmentDropdown._changeHandler);

  // Remove existing event listeners for positionDropdown
  positionDropdown.removeEventListener('change', positionDropdown._changeHandler);
  positionDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    const selectedPosition = positionDropdown.value;
    console.log('Position changed to:', selectedPosition);
    const filteredItems = vacancies.slice(1)
      .filter(row => row[2]?.trim() === selectedAssignment && row[1]?.trim() === selectedPosition)
      .map(row => row[0]?.trim())
      .filter(Boolean);
    console.log('Filtered items:', filteredItems);
    updateDropdown(itemDropdown, filteredItems, 'Select Item');
    saveDropdownState();
  };
  positionDropdown.addEventListener('change', positionDropdown._changeHandler);

  // Remove existing event listeners for itemDropdown
  itemDropdown.removeEventListener('change', itemDropdown._changeHandler);
  itemDropdown._changeHandler = () => {
    console.log('Item changed to:', itemDropdown.value);
    saveDropdownState();
    if (itemDropdown.value) {
      fetchSecretariatCandidates(itemDropdown.value);
    }
  };
  itemDropdown.addEventListener('change', itemDropdown._changeHandler);

  // Trigger change only if a value is set and not during restoration
  if (assignmentDropdown.value && !dropdownStateRestoring) {
    console.log('Triggering initial assignment change');
    assignmentDropdown.dispatchEvent(new Event('change'));
  }
}

// Flag to indicate restoration is in progress
let dropdownStateRestoring = false;



// Config fetch logic (around line 331)
fetch(`${API_BASE_URL}/config`)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  })
  .then((config) => {
    // Define sanitizedConfig to exclude sensitive fields
    const sanitizedConfig = {
      SCOPES: config.SCOPES || '',
      SHEET_RANGES: Object.keys(config.SHEET_RANGES || {}), // Log only range keys
      // Exclude CLIENT_ID, API_KEY, SHEET_ID, EVALUATOR_PASSWORDS, SECRETARIAT_PASSWORD
    };
    console.log('Config loaded:', sanitizedConfig); // Debug log
    CLIENT_ID = config.CLIENT_ID || '';
    API_KEY = config.API_KEY || '';
    SHEET_ID = config.SHEET_ID || '';
    SCOPES = config.SCOPES || '';
    EVALUATOR_PASSWORDS = config.EVALUATOR_PASSWORDS || [];
    SHEET_RANGES = config.SHEET_RANGES || {
      VACANCIES: 'VACANCIES!A:D',
      CANDIDATES: 'CANDIDATES!A:P',
      COMPECODE: 'COMPECODE!A:B',
      COMPETENCY: 'COMPETENCY!A:B',
      RATELOG: 'RATELOG!A:H',
      GENERAL_LIST: 'GENERAL_LIST!A:P',
      DISQUALIFIED: 'DISQUALIFIED!A:D'
    };
    SECRETARIAT_PASSWORD = config.SECRETARIAT_PASSWORD || '';
    if (!SHEET_RANGES.VACANCIES || !SHEET_RANGES.CANDIDATES || !SHEET_RANGES.COMPECODE || !SHEET_RANGES.COMPETENCY) {
      throw new Error('Incomplete SHEET_RANGES configuration');
    }
    initializeApp();
  })
  .catch((error) => {
    console.error('Error fetching config:', error);
    elements.authStatus.textContent = 'Error loading configuration';
  });




function initializeApp() {
  gapi.load('client', async () => {
    await initializeGapiClient();
    gapiInitialized = true;
    console.log('GAPI client initialized');
    maybeEnableButtons();
    createEvaluatorSelector();
    setupTabNavigation(); // Add tab navigation
    restoreState();
  });
}

async function initializeGapiClient() {
  try {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    });
    const token = gapi.client.getToken();
    if (token && !await isTokenValid()) await refreshAccessToken();
    gapiInitialized = true;
    console.log('GAPI client initialized');
  } catch (error) {
    console.error('Error initializing GAPI client:', error);
  }
}

async function isTokenValid() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.access_token) return false;

  const timeLeft = authState.expires_at - Date.now();
  if (timeLeft <= 0) {
    console.log('Token expired, refreshing');
    return await refreshAccessToken();
  }

  try {
    await gapi.client.sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
    return true;
  } catch (error) {
    console.log('Token validation failed:', error);
    if (timeLeft < 300000) {
      return await refreshAccessToken();
    }
    return false;
  }
}

async function refreshAccessToken(maxRetries = 3, retryDelay = 2000) {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.session_id) {
    console.warn('No session ID available');
    return false;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to refresh token with session_id: ${authState.session_id}`);
      console.log('Request headers:', { 'Content-Type': 'application/json' });
      console.log('Request body:', JSON.stringify({ session_id: authState.session_id }));
      const response = await fetch(`${API_BASE_URL}/refresh-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ session_id: authState.session_id }),
      });
      const responseBody = await response.text();
      console.log('Full server response:', responseBody);
      const newToken = JSON.parse(responseBody);
      if (!response.ok || newToken.error) {
        if (newToken.error === 'No refresh token') {
          console.error('Non-retryable error: No refresh token');
          showToast('error', 'Session Expired', 'No refresh token found. Please sign in again.');
          authState.access_token = null;
          localStorage.setItem('authState', JSON.stringify(authState));
          handleAuthClick();
          return false;
        }
        throw new Error(newToken.error || `Refresh failed with status ${response.status}`);
      }
      authState.access_token = newToken.access_token;
      authState.expires_at = Date.now() + ((newToken.expires_in || 3600) * 1000);
      localStorage.setItem('authState', JSON.stringify(authState));
      gapi.client.setToken({ access_token: newToken.access_token });
      console.log('Token refreshed successfully');
      scheduleTokenRefresh();
      return true;
    } catch (error) {
      console.error(`Refresh attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        console.error('Max retries reached, prompting re-authentication');
        showToast('warning', 'Session Issue', 'Unable to refresh session, please sign in again.');
        authState.access_token = null;
        localStorage.setItem('authState', JSON.stringify(authState));
        handleAuthClick();
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1)));
    }
  }
  return false;
}

function scheduleTokenRefresh(maxRetries = 5) {
  if (refreshTimer) clearTimeout(refreshTimer);

  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.expires_at || !authState.session_id) {
    console.log('No valid auth state for scheduling refresh');
    return;
  }

  const timeToExpiry = authState.expires_at - Date.now();
  const refreshInterval = Math.max(300000, timeToExpiry - 900000);

  let retryCount = 0;

  refreshTimer = setTimeout(async function refresh() {
    console.log(`Scheduled token refresh triggered (retry ${retryCount + 1})`);
    const success = await refreshAccessToken();
    if (!success) {
      retryCount++;
      if (retryCount < maxRetries) {
        console.warn(`Refresh failed, retrying in 1 minute (attempt ${retryCount + 1}/${maxRetries})`);
        refreshTimer = setTimeout(refresh, 60000);
      } else {
        console.error('Max refresh retries reached, prompting re-authentication');
        showToast('error', 'Session Expired', 'Please sign in again.');
        handleAuthClick();
      }
    }
  }, refreshInterval);

  console.log(`Token refresh scheduled in ${refreshInterval / 60000} minutes`);
}

function handleTokenCallback(tokenResponse) {
  if (tokenResponse.error) {
    console.error('Token error:', tokenResponse.error);
    elements.authStatus.textContent = 'Error during sign-in';
  } else {
    saveAuthState(tokenResponse, currentEvaluator);
    gapi.client.setToken({ access_token: tokenResponse.access_token });
    updateUI(true);
    fetch(`${API_BASE_URL}/config`, { credentials: 'include' })
      .then(() => {
        createEvaluatorSelector();
        loadSheetData();
        showToast('success', 'Welcome!', 'Successfully signed in.');
        localStorage.setItem('hasWelcomed', 'true');
      });
  }
}

function maybeEnableButtons() {
  if (gapiInitialized) {
    elements.signInBtn.style.display = 'inline-block';
    elements.signOutBtn.style.display = 'inline-block';
  }
}


function setupTabNavigation() {
  const raterTab = document.getElementById('raterTab');
  const secretariatTab = document.getElementById('secretariatTab');

  raterTab.addEventListener('click', () => switchTab('rater'));
  secretariatTab.addEventListener('click', () => {
    // Always prompt for authentication when clicking Secretariat tab
    showModal(
      'Secretariat Authentication',
      `
        <p>Please enter the Secretariat password:</p>
        <input type="password" id="secretariatPassword" class="modal-input">
        <p>Select Member ID (1-5):</p>
        <select id="secretariatMemberId" class="modal-input">
          <option value="">Select Member</option>
          <option value="1">Member 1</option>
          <option value="2">Member 2</option>
          <option value="3">Member 3</option>
          <option value="4">Member 4</option>
          <option value="5">Member 5</option>
        </select>
      `,
      () => {
        const password = document.getElementById('secretariatPassword').value.trim();
        const memberId = document.getElementById('secretariatMemberId').value;
        if (password === SECRETARIAT_PASSWORD && memberId) {
          secretariatMemberId = memberId;
          localStorage.setItem('secretariatAuthenticated', 'true');
          saveAuthState(gapi.client.getToken(), currentEvaluator);
          switchTab('secretariat');
          showToast('success', 'Success', `Logged in as Secretariat Member ${memberId}`);
        } else {
          showToast('error', 'Error', 'Incorrect password or missing Member ID');
        }
      },
      () => {
        console.log('Secretariat authentication canceled');
      }
    );
  });
}


function switchTab(tab) {
  currentTab = tab;
  localStorage.setItem('currentTab', tab);

  if (tab === 'rater') {
    localStorage.removeItem('secretariatAuthenticated');
    secretariatMemberId = null;
    saveAuthState(gapi.client.getToken(), currentEvaluator);
    console.log('Secretariat authentication cleared');
  }

  document.getElementById('raterTab').classList.toggle('active', tab === 'rater');
  document.getElementById('secretariatTab').classList.toggle('active', tab === 'secretariat');

  document.getElementById('raterContent').style.display = tab === 'rater' ? 'block' : 'none';
  document.getElementById('secretariatContent').style.display = tab === 'secretariat' ? 'block' : 'none';

  const resultsArea = document.querySelector('.results-area');
  if (resultsArea) {
    resultsArea.style.display = tab === 'rater' ? 'block' : 'none';
    resultsArea.classList.toggle('active', tab === 'rater');
  }

  setDropdownState(elements.assignmentDropdown, tab === 'rater');
  setDropdownState(elements.positionDropdown, tab === 'rater');
  setDropdownState(elements.itemDropdown, tab === 'rater');
  setDropdownState(elements.nameDropdown, tab === 'rater');

  const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
  const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');
  const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');
  setDropdownState(secretariatAssignmentDropdown, tab === 'secretariat');
  setDropdownState(secretariatPositionDropdown, tab === 'secretariat');
  setDropdownState(secretariatItemDropdown, tab === 'secretariat');

  if (tab === 'rater') {
    initializeDropdowns(vacancies);
    if (elements.nameDropdown.value && elements.itemDropdown.value) {
      fetchSubmittedRatings();
      displayCandidatesTable(elements.nameDropdown.value, elements.itemDropdown.value);
    }
    updateUI(true);
  } else if (tab === 'secretariat') {
    // Only initialize if dropdowns are empty
    if (!secretariatAssignmentDropdown.options.length || secretariatAssignmentDropdown.options.length === 1) {
      initializeSecretariatDropdowns();
    }
    if (secretariatItemDropdown.value) {
      fetchSecretariatCandidates(secretariatItemDropdown.value);
    }
    updateUI(true);
  }

  const container = document.querySelector('.container');
  if (resultsArea && tab === 'rater') {
    const resultsHeight = resultsArea.offsetHeight + 20;
    container.style.marginTop = `${resultsHeight}px`;
  } else {
    container.style.marginTop = '20px';
  }
}




async function fetchSecretariatCandidates(itemNumber) {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const [generalResponse, candidatesResponse, disqualifiedResponse] = await Promise.all([
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'GENERAL_LIST!A:P',
      }),
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CANDIDATES!A:R', // Includes column R for comments
      }),
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'DISQUALIFIED!A:E',
      }),
    ]);

    const candidatesData = generalResponse.result.values || [];
    const candidatesSheet = candidatesResponse.result.values || [];
    const disqualifiedSheet = disqualifiedResponse.result.values || [];

    // Map submissions by name, item number, and member ID
    const submissions = new Map();
    candidatesSheet.forEach(row => {
      if (row[0] && row[1] && row[16]) {
        submissions.set(`${row[0]}|${row[1]}|${row[16]}`, { status: 'CANDIDATES', comment: row[17] || '' });
      }
    });
    disqualifiedSheet.forEach(row => {
      if (row[0] && row[1] && row[4]) {
        submissions.set(`${row[0]}|${row[1]}|${row[4]}`, { status: 'DISQUALIFIED', comment: row[3] || '' });
      }
    });

    const filteredCandidates = candidatesData
      .filter(row => row[1] === itemNumber)
      .map(row => ({
        data: row,
        submitted: submissions.has(`${row[0]}|${itemNumber}|${secretariatMemberId}`)
          ? submissions.get(`${row[0]}|${itemNumber}|${secretariatMemberId}`)
          : null,
      }));

    displaySecretariatCandidatesTable(filteredCandidates, itemNumber);
  } catch (error) {
    console.error('Error fetching secretariat candidates:', error);
    showToast('error', 'Error', 'Failed to fetch candidates');
    displaySecretariatCandidatesTable([], null);
  }
}


function displaySecretariatCandidatesTable(candidates, itemNumber) {
  const container = document.getElementById('secretariat-candidates-table');
  container.innerHTML = '';

  const filterDiv = document.createElement('div');
  filterDiv.innerHTML = `
    <label for="statusFilter">Filter by Status: </label>
    <select id="statusFilter" onchange="filterTableByStatus(this.value, '${itemNumber}')">
      <option value="">All Statuses</option>
      <option value="not-submitted">Not Submitted</option>
      <option value="CANDIDATES">Submitted (CANDIDATES)</option>
      <option value="DISQUALIFIED">Submitted (DISQUALIFIED)</option>
    </select>
  `;
  container.appendChild(filterDiv);

  if (candidates.length > 0) {
    const table = document.createElement('table');
    table.className = 'secretariat-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Name</th>
        <th>Documents</th>
        <th>Action</th>
        <th>Submit</th>
        <th>Status</th>
        <th>Comments</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    candidates.forEach(candidate => {
      const row = candidate.data;
      const name = row[0];
      const sex = row[2];
      const tr = document.createElement('tr');
      const documentLinks = [
        { label: 'Letter of Intent', url: row[7] },
        { label: 'Personal Data Sheet', url: row[8] },
        { label: 'Work Experience', url: row[9] },
        { label: 'Proof of Eligibility', url: row[10] },
        { label: 'Certificates', url: row[11] },
        { label: 'IPCR', url: row[12] },
        { label: 'Certificate of Employment', url: row[13] },
        { label: 'Diploma', url: row[14] },
        { label: 'Transcript of Records', url: row[15] },
      ];
      const linksHtml = documentLinks
        .map(link => {
          if (link.url) {
            return `<button class="open-link-button" onclick="window.open('${link.url}', '_blank')">${link.label}</button>`;
          }
          return `<button class="open-link-button" disabled>NONE (${link.label})</button>`;
        })
        .join('');
      const submittedStatus = candidate.submitted
        ? `<span class="submitted-indicator">Submitted (${candidate.submitted.status})</span>`
        : '';
      const comment = candidate.submitted?.comment || '';
      const escapedComment = comment.replace(/'/g, "\\'").replace(/`/g, "\\`").replace(/"/g, "\\\"");
      tr.innerHTML = `
        <td>${name}</td>
        <td class="document-links">${linksHtml}</td>
        <td>
          <select class="action-dropdown" data-name="${name}" data-sex="${sex}" data-item="${itemNumber}">
            <option value="">Select Action</option>
            <option value="FOR DISQUALIFICATION">FOR DISQUALIFICATION</option>
            <option value="FOR LONG LIST">FOR LONG LIST</option>
          </select>
        </td>
        <td>
          <button class="submit-candidate-button" onclick="handleActionSelection(this)">Submit</button>
        </td>
        <td>${submittedStatus}</td>
        <td>
          ${comment ? `
            <button class="view-comment-button" onclick="viewComments('${name}', '${itemNumber}', '${candidate.submitted.status}', '${escapedComment}')">View</button>
            <button class="edit-comment-button" onclick="editComments('${name}', '${itemNumber}', '${candidate.submitted.status}', '${escapedComment}')">Edit</button>
          ` : 'No comments'}
        </td>
      `;
      tr.dataset.status = candidate.submitted ? candidate.submitted.status : '';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    container.innerHTML = '<p>No candidates found.</p>';
  }
}

// Unchanged handleActionSelection
async function handleActionSelection(button) {
  const row = button.closest('tr');
  const select = row.querySelector('.action-dropdown');
  const action = select.value;
  const name = select.dataset.name;
  const itemNumber = select.dataset.item;
  const sex = select.dataset.sex;

  if (!action) {
    console.log('No action selected');
    showToast('error', 'Error', 'Please select an action');
    return;
  }

  console.log(`Checking for duplicate submission: ${name}, ${itemNumber}, ${action}`);
  const isDuplicate = await checkDuplicateSubmission(name, itemNumber, action);
  if (isDuplicate) {
    console.log(`Duplicate submission detected for ${name} as ${action}`);
    showToast('error', 'Error', `Candidate already submitted as ${action} by Member ${secretariatMemberId}.`);
    return;
  }

  const modalContent = `
    <div class="modal-body">
      <p>Please enter comments for ${action === 'FOR DISQUALIFICATION' ? 'disqualifying' : 'long-listing'} ${name}:</p>
      <label for="educationComment">Education:</label>
      <input type="text" id="educationComment" class="modal-input">
      <label for="trainingComment">Training:</label>
      <input type="text" id="trainingComment" class="modal-input">
      <label for="experienceComment">Experience:</label>
      <input type="text" id="experienceComment" class="modal-input">
      <label for="eligibilityComment">Eligibility:</label>
      <input type="text" id="eligibilityComment" class="modal-input">
    </div>
  `;

  console.log(`Opening handleActionSelection modal for ${name}, action: ${action}`);

  const modalResult = await showCommentModal(
    `${action === 'FOR DISQUALIFICATION' ? 'Disqualification' : 'Long List'} Comments`,
    modalContent,
    name,
    (commentData) => {
      console.log('handleActionSelection onConfirm received:', commentData);
      return commentData;
    },
    () => {
      console.log('handleActionSelection onCancel triggered');
      return false;
    },
    true,
    null
  );

  console.log('Waiting for modalResult.promise...');
  const commentEntered = await modalResult.promise;
  console.log('Comment entered:', commentEntered);

  // Exit if no valid comment data was entered
  if (!commentEntered || commentEntered === false) {
    console.log('No valid comment entered, exiting handleActionSelection');
    showToast('info', 'Info', 'Candidate action cancelled');
    return;
  }

  // Format the comment for submission
  const comment = `${commentEntered.education},${commentEntered.training},${commentEntered.experience},${commentEntered.eligibility}`;
  console.log('Submitting candidate action with comment:', comment);

  try {
    await submitCandidateAction(button, name, itemNumber, sex, action, comment);
    showToast('success', 'Success', 'Candidate action submitted successfully');
    console.log('Showing success toast for handleActionSelection');
  } catch (error) {
    console.error('Error submitting candidate action in handleActionSelection:', error);
    showToast('error', 'Error', `Failed to submit candidate action: ${error.message}`);
    throw error;
  }
}




async function submitCandidateAction(button, name, itemNumber, sex, action, comment) {
  console.log('submitCandidateAction triggered:', { name, itemNumber, sex, action, comment });

  const modalContent = `
    <div class="modal-body">
      <p>Are you sure you want to submit the following action for ${name}?</p>
      <div class="modal-section">
        <h4>ACTION:</h4>
        <div class="modal-field">
          <span class="modal-label">Action:</span>
          <span class="modal-value">${action}</span>
        </div>
        <div class="modal-field">
          <span class="modal-label">Comments:</span>
          <span class="modal-value">${comment.split(',').join('; ')}</span>
        </div>
      </div>
    </div>
  `;

  const confirmResult = await showModal('CONFIRM SUBMISSION', modalContent);
  console.log('Confirmation modal result:', confirmResult);

  if (!confirmResult) {
    console.log('Submission cancelled by user');
    showToast('info', 'Info', 'Submission cancelled');
    return;
  }

  try {
    console.log('Submitting action:', { name, itemNumber, sex, action, comment });
    if (!await isTokenValid()) {
      console.log('Refreshing token');
      await refreshAccessToken();
      if (!await isTokenValid()) {
        throw new Error('Failed to validate token after refresh');
      }
    }

    const normalizedName = name.trim().toUpperCase().replace(/\s+/g, ' ');
    const normalizedItemNumber = itemNumber.trim();

    async function getSheetId(sheetName) {
      try {
        const response = await gapi.client.sheets.spreadsheets.get({
          spreadsheetId: SHEET_ID,
        });
        const sheet = response.result.sheets.find(s => s.properties.title === sheetName);
        if (!sheet) {
          throw new Error(`Sheet ${sheetName} not found in spreadsheet`);
        }
        console.log(`Fetched sheetId for ${sheetName}: ${sheet.properties.sheetId}`);
        return sheet.properties.sheetId;
      } catch (error) {
        console.error(`Failed to fetch sheetId for ${sheetName}:`, error);
        throw error;
      }
    }

    if (action === 'FOR LONG LIST') {
      console.log('Processing FOR LONG LIST action...');
      const disqualifiedResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'DISQUALIFIED!A:E',
      });
      let disqualifiedValues = disqualifiedResponse.result.values || [];
      console.log('DISQUALIFIED raw values:', disqualifiedValues);

      const disqualifiedDataRows = disqualifiedValues.slice(1);
      const disqualifiedIndex = disqualifiedDataRows.findIndex(row => {
        const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
        const rowItem = row[1]?.trim();
        const rowMemberId = row[4]?.toString();
        console.log('Comparing DISQUALIFIED row:', { rowName, rowItem, rowMemberId });
        return rowName === normalizedName && 
               rowItem === normalizedItemNumber && 
               rowMemberId === secretariatMemberId;
      });

      if (disqualifiedIndex !== -1) {
        const sheetRowIndex = disqualifiedIndex + 1;
        console.log(`Found match at data index ${disqualifiedIndex} (sheet row ${sheetRowIndex + 1}):`, disqualifiedDataRows[disqualifiedIndex]);

        const sheetId = await getSheetId('DISQUALIFIED');
        const batchUpdateRequest = {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1
              }
            }
          }]
        };
        console.log('batchUpdate request for DISQUALIFIED:', JSON.stringify(batchUpdateRequest, null, 2));
        const batchUpdateResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          resource: batchUpdateRequest
        });
        console.log('batchUpdate response for DISQUALIFIED:', batchUpdateResponse);

        const updatedDisqualifiedResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: 'DISQUALIFIED!A:E',
        });
        console.log('DISQUALIFIED values after deletion:', updatedDisqualifiedResponse.result.values);
      } else {
        console.log(`No matching record found for ${normalizedName}, ${normalizedItemNumber}, ${secretariatMemberId} in DISQUALIFIED`);
      }

      const generalResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'GENERAL_LIST!A:P',
      });
      let candidate = generalResponse.result.values.find(row => 
        row[0]?.trim().toUpperCase().replace(/\s+/g, ' ') === normalizedName && 
        row[1]?.trim() === normalizedItemNumber
      );
      if (!candidate) throw new Error('Candidate not found in GENERAL_LIST');
      candidate = [...candidate, secretariatMemberId, comment];
      console.log('Appending to CANDIDATES:', [candidate]);
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'CANDIDATES!A:R',
        valueInputOption: 'RAW',
        resource: { values: [candidate] },
      });
      console.log('Candidate appended to CANDIDATES successfully');
    } else if (action === 'FOR DISQUALIFICATION') {
      console.log('Processing FOR DISQUALIFICATION action...');
      const candidatesResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CANDIDATES!A:R',
      });
      let candidatesValues = candidatesResponse.result.values || [];
      console.log('CANDIDATES raw values:', candidatesValues);

      const candidatesDataRows = candidatesValues.slice(1);
      const candidatesIndex = candidatesDataRows.findIndex(row => {
        const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
        const rowItem = row[1]?.trim();
        const rowMemberId = row[16]?.toString();
        console.log('Comparing CANDIDATES row:', { rowName, rowItem, rowMemberId });
        return rowName === normalizedName && 
               rowItem === normalizedItemNumber && 
               rowMemberId === secretariatMemberId;
      });

      if (candidatesIndex !== -1) {
        const sheetRowIndex = candidatesIndex + 1;
        console.log(`Found match at data index ${candidatesIndex} (sheet row ${sheetRowIndex + 1}):`, candidatesDataRows[candidatesIndex]);

        const sheetId = await getSheetId('CANDIDATES');
        const batchUpdateRequest = {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetId,
                dimension: 'ROWS',
                startIndex: sheetRowIndex,
                endIndex: sheetRowIndex + 1
              }
            }
          }]
        };
        console.log('batchUpdate request for CANDIDATES:', JSON.stringify(batchUpdateRequest, null, 2));
        const batchUpdateResponse = await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          resource: batchUpdateRequest
        });
        console.log('batchUpdate response for CANDIDATES:', batchUpdateResponse);

        const updatedCandidatesResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: 'CANDIDATES!A:R',
        });
        console.log('CANDIDATES values after deletion:', updatedCandidatesResponse.result.values);
      } else {
        console.log(`No matching record found for ${normalizedName}, ${normalizedItemNumber}, ${secretariatMemberId} in CANDIDATES`);
      }

      const values = [[name, itemNumber, sex, comment, secretariatMemberId]];
      console.log('Appending to DISQUALIFIED:', values);
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: 'DISQUALIFIED!A:E',
        valueInputOption: 'RAW',
        resource: { values },
      });
      console.log('Candidate appended to DISQUALIFIED successfully');
    }

    showToast('success', 'Success', 'Action submitted successfully');
    console.log('Showing success toast for submitCandidateAction');
    await fetchSecretariatCandidates(itemNumber);
  } catch (error) {
    console.error('Error submitting action in submitCandidateAction:', error);
    showToast('error', 'Error', `Failed to submit action: ${error.message || JSON.stringify(error)}`);
    throw error;
  }
}








// Helper function to get sheet ID (replace with actual implementation)
async function getSheetId(sheetName) {
  const response = await gapi.client.sheets.spreadsheets.get({
    spreadsheetId: SHEET_ID,
  });
  const sheet = response.result.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);
  return sheet.properties.sheetId;
}


async function checkDuplicateSubmission(name, itemNumber, action) {
  try {
    const sheetName = action === 'FOR LONG LIST' ? 'CANDIDATES' : 'DISQUALIFIED';
    const range = sheetName === 'CANDIDATES' ? 'CANDIDATES!A:R' : 'DISQUALIFIED!A:E';
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: range,
    });
    const values = response.result.values || [];
    return values.some(row => row[0] === name && row[1] === itemNumber && row[row.length - 1] === secretariatMemberId);
  } catch (error) {
    console.error('Error checking duplicates:', error);
    showToast('error', 'Error', 'Failed to check for duplicates.');
    return false;
  }
}

async function viewComments(name, itemNumber, status, comment) {
  const [education, training, experience, eligibility] = comment ? comment.split(',') : ['', '', '', ''];
  const modalContent = `
    <div class="modal-body" style="font-size: 18px; line-height: 1.6; padding: 20px;">
      <h2 style="font-size: 28px; margin-bottom: 20px;">${name} (${status})</h2>
      <div class="modal-field" style="margin-bottom: 15px;">
        <span class="modal-label" style="font-weight: bold; display: inline-block; width: 120px;">Education:</span>
        <span class="modal-value">${education || 'None'}</span>
      </div>
      <div class="modal-field" style="margin-bottom: 15px;">
        <span class="modal-label" style="font-weight: bold; display: inline-block; width: 120px;">Training:</span>
        <span class="modal-value">${training || 'None'}</span>
      </div>
      <div class="modal-field" style="margin-bottom: 15px;">
        <span class="modal-label" style="font-weight: bold; display: inline-block; width: 120px;">Experience:</span>
        <span class="modal-value">${experience || 'None'}</span>
      </div>
      <div class="modal-field">
        <span class="modal-label" style="font-weight: bold; display: inline-block; width: 120px;">Eligibility:</span>
        <span class="modal-value">${eligibility || 'None'}</span>
      </div>
    </div>
  `;
  showModal('View Comments', modalContent, null, null, false);
}

// New function to handle status filtering
function filterTableByStatus(status, itemNumber) {
  const rows = document.querySelectorAll('#secretariat-candidates-table tbody tr');
  rows.forEach(row => {
    const rowStatus = row.dataset.status;
    if (!status || (status === 'not-submitted' && rowStatus === '') || rowStatus === status) {
      row.style.display = '';
    } else {
      row.style.display = 'none';
    }
  });
}

/**
 * Edits comments for a candidate, managing modal display and Google Sheets API updates.
 *
 * @param {string} name - The name of the candidate.
 * @param {string} itemNumber - The item number associated with the candidate.
 * @param {string} status - The current status of the candidate ('CANDIDATES' or 'DISQUALIFIED').
 * @param {string} comment - The existing comment string (e.g., "edu,train,exp,elig").
 */
async function editComments(name, itemNumber, status, comment) {
    console.log(`DEBUG: Entering editComments for ${name} (Status: ${status}, Item: ${itemNumber}).`);

    // Create a unique identifier for this specific edit operation
    const operationId = `${name}|${itemNumber}|${status}`;

    // --- GUARD: Prevent concurrent or duplicate calls for the same operation ---
    if (activeCommentModalOperations.has(operationId)) {
        console.log(`DEBUG: editComments: Operation for ${name} (Item: ${itemNumber}, Status: ${status}) already active. Aborting duplicate call.`);
        return; // Exit if this operation is already being processed
    }
    activeCommentModalOperations.add(operationId); // Mark this operation as active
    console.log(`DEBUG: editComments: Operation ${operationId} marked as active.`);

    try {
        // --- 1. Check for and Restore Existing Minimized Modal (Visual Restoration Only) ---
        // This part handles the visual restoration if a modal for this candidate was previously minimized.
        // It does NOT prevent a new modal instance from being created, as showCommentModal creates a new one.
        // It removes the entry from minimizedModals as it's now being actively handled again.
        let existingModalId = null;
        for (const [modalId, state] of minimizedModals) {
            if (state.candidateName === name && state.title.includes('Edit Comments')) {
                existingModalId = modalId;
                // If found, remove from minimizedModals as it's now being actively handled again
                minimizedModals.delete(modalId); // This is handled by restoreMinimizedModal now on full close
                console.log(`DEBUG: editComments: Found existing minimized modal for ${name} (ID: ${existingModalId}). Removing from minimized list.`);
                break;
            }
        }

        if (existingModalId) {
            console.log(`DEBUG: editComments: Restoring minimized modal: ${existingModalId}`);
            restoreMinimizedModal(existingModalId); // This only handles the visual part, now it completely restores it.
            // The logic now relies on restoreMinimizedModal to re-attach to the original promise.
            // We should NOT call showCommentModal again here if we are restoring.
            // The editComments function will naturally await the promise from the restored modal.
        }

        // --- Prepare Initial Values and Modal Content ---
        const [education, training, experience, eligibility] = comment ? comment.split(',') : ['', '', '', ''];
        const initialValues = { education, training, experience, eligibility };
        console.log('DEBUG: editComments: Initial comment values:', initialValues);

        const modalContent = `
            <div class="modal-body">
                <p>Edit comments for ${name} (${status}):</p>
                <label for="educationComment">Education:</label>
                <input type="text" id="educationComment" class="modal-input" value="${education || ''}">
                <label for="trainingComment">Training:</label>
                <input type="text" id="trainingComment" class="modal-input" value="${training || ''}">
                <label for="experienceComment">Experience:</label>
                <input type="text" id="experienceComment" class="modal-input" value="${experience || ''}">
                <label for="eligibilityComment">Eligibility:</label>
                <input type="text" id="eligibilityComment" class="modal-input" value="${eligibility || ''}">
            </div>
        `;
        console.log('DEBUG: editComments: Modal content HTML prepared.');

        let modalPromiseToAwait;

        // If a modal was restored, its promise is implicitly being handled by restoreMinimizedModal
        // The `editComments` call will simply wait for that original promise to resolve.
        // If no modal was restored, then show a new one.
        if (!existingModalId) {
            console.log('DEBUG: editComments: Calling showCommentModal for a NEW modal...');
            const modalResult = showCommentModal(
                `Edit Comments (${status})`, // Modal Title
                modalContent,                // Content HTML for the modal body
                name,                        // Candidate's name (for minimize/restore context in showCommentModal)
                (commentData) => {           // The `onConfirm` callback for `showCommentModal`
                    console.log('DEBUG: editComments: `onConfirm` callback triggered. Received data:', commentData);
                    return commentData; // This data will be the resolved value of `modalResult.promise`.
                },
                () => {                      // The `onCancel` callback for `showCommentModal`
                    console.log('DEBUG: editComments: `onCancel` callback triggered. Modal canceled.');
                    return false; // Indicate that the modal was canceled.
                },
                true,                        // Show the Cancel button
                initialValues                // Pass initial values to populate the modal's fields
            );
            modalPromiseToAwait = modalResult.promise;
            console.log('DEBUG: editComments: `showCommentModal` has been called. Awaiting its promise resolution...');
        } else {
            // If we restored an existing modal, editComments will await the promise that restoreMinimizedModal
            // ensures gets resolved. We don't have a direct `modalResult.promise` from here if it was restored,
            // but the original `editComments` call's execution context is already linked to the promise
            // that was created when it first called `showCommentModal`.
            // The `restoreMinimizedModal` function is now responsible for ensuring that original promise resolves.
            // This 'else' block doesn't explicitly return a promise, as the original call is already awaiting it.
            // We just need to wait for the user interaction on the restored modal.
            console.log('DEBUG: editComments: Existing modal restored. Awaiting original promise resolution...');
            // This part is implicit, the original `await modalResult.promise` will continue to wait
            // after the `restoreMinimizedModal` function has done its job.
            // We can't re-assign `modalPromiseToAwait` here without a way to get the *original* promise.
            // This highlights the design constraint. The safest is to always call showCommentModal
            // and have it handle the "restoring" internally, but we already have the restoreModal.
            // Given the existing structure, the original `editComments` will just continue to hang
            // until the original promise (from its *first* showCommentModal call) gets resolved by
            // the `restoreMinimizedModal`'s direct resolution.
            // The simplest approach is to always call `showCommentModal` and let it manage the state.
            // However, the prior analysis decided against it due to architectural issues.
            // Let's revert to always calling `showCommentModal` but enhance it to reuse.
            // NO, the current architecture of `restoreMinimizedModal` explicitly *re-renders* the modal
            // and hooks up to the *original promise's resolver*. So the `editComments`
            // should NOT call `showCommentModal` if `existingModalId` exists.
            // The `await` simply continues to wait for the `state.originalResolve` call in `restoreMinimizedModal`.
            // There is no `modalPromiseToAwait` to assign here in the `else` branch.
            // The `await modalResult.promise` below is what `editComments` is waiting on.
            // If `existingModalId` was found, it means the `editComments` call that initiated this
            // is still active and awaiting. `restoreMinimizedModal` is responsible for resolving its promise.
            // This is the correct logical flow for the new architecture.
        }

        // Wait for the promise returned by showCommentModal to resolve (user confirms or cancels).
        // This line is only reached if a NEW modal was shown.
        // If an existing modal was restored, the original call's promise is resolved by restoreMinimizedModal.
        let commentEntered;
        if (!existingModalId) {
            commentEntered = await modalPromiseToAwait;
        } else {
            // This branch should ideally not be reached, as the original `editComments` call is already awaiting
            // the promise. The resolution will happen in `restoreMinimizedModal`.
            // If it *does* reach here, it implies a new `editComments` call started, but the guard
            // `activeCommentModalOperations` should prevent that.
            // This part is a bit tricky due to async nature and the desire to reuse the original promise.
            // Let's assume the flow correctly blocks the `editComments` call until the promise resolves.
            // The previous logs clearly showed the `await` was getting stuck.
            // With the new architecture, the `await modalResult.promise;` (which is now just `await modalPromiseToAwait;`)
            // in the original `editComments` call should now resolve correctly.
            // We need to ensure `commentEntered` gets its value in the `existingModalId` case.
            // This is where the initial design of `showCommentModal` always returning a new promise created a loop.
            // Since `restoreMinimizedModal` directly resolves the original promise, the `await` here
            // should simply pick up the value.
            // The `editComments` function doesn't need to explicitly retrieve the promise again if it's awaiting.
            // The `try...finally` block ensures `activeCommentModalOperations` is cleaned up.

            // To avoid the compiler complaining about `commentEntered` possibly not being assigned,
            // we will need a way to block this function effectively until the original promise is resolved.
            // The current setup of `activeCommentModalOperations` preventing new calls,
            // and `restoreMinimizedModal` directly resolving the *original* promise should work.
            // So, no `await` here in the `else` branch, as the first `editComments` call is already doing it.
            // The user's provided logs indicate that the `editComments` function *is* hanging on the `await`.
            // So `commentEntered` will get its value from the original `await` if it's resolved.
            // This means we should structure it as a single `await`.
            const originalPromiseState = minimizedModals.get(operationId); // Not quite, operationId is not modalId
            // This is the core of the problem if the original `editComments` cannot access the promise.
            // The most direct way to keep `editComments` simple is to ensure `showCommentModal` is smart.

            // The safest approach is to ensure `editComments` always gets a single promise from `showCommentModal`
            // and `showCommentModal` itself decides whether to create a new UI or re-use/restore.

            // Let's modify the `showCommentModal` to handle the restoration itself, simplifying `editComments`.
            // This will make `editComments` always call `showCommentModal`.
            // So, remove the `if (existingModalId)` block here entirely.
            // `showCommentModal` will be updated to check for existing minimized modals.
            // I will simplify this part in `editComments`.
            console.log('DEBUG: editComments: Proceeding to call showCommentModal regardless to handle restoration internally.');
            const modalResult = showCommentModal(
                `Edit Comments (${status})`, // Modal Title
                modalContent,                // Content HTML for the modal body
                name,                        // Candidate's name (for minimize/restore context in showCommentModal)
                (commentData) => {           // The `onConfirm` callback for `showCommentModal`
                    console.log('DEBUG: editComments: `onConfirm` callback triggered. Received data:', commentData);
                    return commentData; // This data will be the resolved value of `modalResult.promise`.
                },
                () => {                      // The `onCancel` callback for `showCommentModal`
                    console.log('DEBUG: editComments: `onCancel` callback triggered. Modal canceled.');
                    return false; // Indicate that the modal was canceled.
                },
                true,                        // Show the Cancel button
                initialValues                // Pass initial values to populate the modal's fields
            );
            modalPromiseToAwait = modalResult.promise;
            console.log('DEBUG: editComments: `showCommentModal` has been called. Awaiting its promise resolution...');
        }


        // This is the single await point for the promise, whether new or restored
        commentEntered = await modalPromiseToAwait;
        console.log('DEBUG: editComments: `modalPromiseToAwait` RESOLVED. `commentEntered` value:', commentEntered);


        // --- 4. Handle Modal Cancellation or No Data ---
        if (!commentEntered || commentEntered === false) {
            console.log('DEBUG: editComments: Modal was canceled or no valid comment data was returned. Aborting update process.');
            showToast('info', 'Canceled', 'Comment update was canceled.');
            return; // Exit the function if the modal was canceled or no data.
        }

        // --- 5. Prepare Comment String for Google Sheets ---
        const newComment = `${commentEntered.education},${commentEntered.training},${commentEntered.experience},${commentEntered.eligibility}`;
        console.log('DEBUG: editComments: Prepared new comment string for Google Sheets:', newComment);

        // --- 6. Google Sheets API Interaction (within a try-catch for error handling) ---
        try {
            console.log('DEBUG: editComments: Entering `try` block for Google Sheets API operations.');

            // 6.1. Token Validation and Refresh
            let tokenValid = await isTokenValid();
            console.log('DEBUG: editComments: `isTokenValid()` result:', tokenValid);

            if (!tokenValid) {
                console.log('DEBUG: editComments: Access token invalid or expired. Attempting to refresh...');
                await refreshAccessToken(); // Call function to refresh the token.
                tokenValid = await isTokenValid(); // Re-check token validity after the refresh attempt.
                console.log('DEBUG: editComments: `isTokenValid()` result after refresh attempt:', tokenValid);
                if (!tokenValid) {
                    // If token is still not valid after refresh, throw an error to stop execution.
                    throw new Error('Failed to validate token after refresh. Please ensure you are authenticated.');
                }
                console.log('DEBUG: editComments: Access token refreshed successfully.');
            }

            // 6.2. Normalize Name and Item Number for Matching
            const normalizedName = name.trim().toUpperCase().replace(/\s+/g, ' ');
            const normalizedItemNumber = itemNumber.trim();
            console.log(`DEBUG: editComments: Normalized Name: "${normalizedName}", Normalized Item Number: "${normalizedItemNumber}".`);

            // Assuming getSheetId is defined globally or passed correctly
            async function getSheetId(sheetName) {
                console.log(`DEBUG: getSheetId: Attempting to get ID for sheet: "${sheetName}".`);
                const response = await gapi.client.sheets.spreadsheets.get({
                    spreadsheetId: SHEET_ID,
                });
                const sheet = response.result.sheets.find(s => s.properties.title === sheetName);
                if (!sheet) throw new Error(`Sheet "${sheetName}" not found in spreadsheet "${SHEET_ID}".`);
                console.log(`DEBUG: getSheetId: Found ID for "${sheetName}": ${sheet.properties.sheetId}.`);
                return sheet.properties.sheetId;
            }

            // 6.3. Update the Appropriate Sheet (CANDIDATES or DISQUALIFIED)
            if (status === 'CANDIDATES') {
                console.log('DEBUG: editComments: Processing update for CANDIDATES sheet.');
                const candidatesResponse = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: 'CANDIDATES!A:R', // Fetch enough data to find the row
                });
                const candidatesValues = candidatesResponse.result.values || [];
                console.log(`DEBUG: editComments: Fetched ${candidatesValues.length} rows from CANDIDATES sheet.`);

                // Find the 0-based index of the row to update (skipping header row with .slice(1))
                const candidatesIndex = candidatesValues.slice(1).findIndex(row => {
                    const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
                    const rowItem = row[1]?.trim();
                    const rowMemberId = row[16]?.toString(); // Assuming Member ID is in column Q (index 16)
                    return rowName === normalizedName && rowItem === normalizedItemNumber && rowMemberId === secretariatMemberId;
                });

                if (candidatesIndex !== -1) {
                    // Adjust index for actual sheet row number (1-based + 1 for header)
                    const sheetRowIndex = candidatesIndex + 2;
                    console.log(`DEBUG: editComments: Candidate found in CANDIDATES sheet at row: ${sheetRowIndex}. Updating column R.`);
                    await gapi.client.sheets.spreadsheets.values.update({
                        spreadsheetId: SHEET_ID,
                        range: `CANDIDATES!R${sheetRowIndex}`, // Target column R for comments
                        valueInputOption: 'RAW', // Treat input as raw string
                        resource: { values: [[newComment]] }, // The new comment value
                    });
                    console.log('DEBUG: editComments: Successfully updated comment in CANDIDATES sheet.');
                } else {
                    console.warn('DEBUG: editComments: Candidate row NOT found in CANDIDATES sheet for the given criteria.');
                    showToast('warning', 'Not Found', `Candidate "${name}" not found in CANDIDATES sheet for update.`);
                }
            } else if (status === 'DISQUALIFIED') {
                console.log('DEBUG: editComments: Processing update for DISQUALIFIED sheet.');
                const disqualifiedResponse = await gapi.client.sheets.spreadsheets.values.get({
                    spreadsheetId: SHEET_ID,
                    range: 'DISQUALIFIED!A:E', // Fetch enough data to find the row
                });
                const disqualifiedValues = disqualifiedResponse.result.values || [];
                console.log(`DEBUG: editComments: Fetched ${disqualifiedValues.length} rows from DISQUALIFIED sheet.`);

                // Find the 0-based index of the row to update (skipping header row with .slice(1))
                const disqualifiedIndex = disqualifiedValues.slice(1).findIndex(row => {
                    const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
                    const rowItem = row[1]?.trim();
                    const rowMemberId = row[4]?.toString(); // Assuming Member ID is in column E (index 4)
                    return rowName === normalizedName && rowItem === normalizedItemNumber && rowMemberId === secretariatMemberId;
                });

                if (disqualifiedIndex !== -1) {
                    // Adjust index for actual sheet row number (1-based + 1 for header)
                    const sheetRowIndex = disqualifiedIndex + 2;
                    console.log(`DEBUG: editComments: Candidate found in DISQUALIFIED sheet at row: ${sheetRowIndex}. Updating column D.`);
                    await gapi.client.sheets.spreadsheets.values.update({
                        spreadsheetId: SHEET_ID,
                        range: `DISQUALIFIED!D${sheetRowIndex}`, // Target column D for comments
                        valueInputOption: 'RAW',
                        resource: { values: [[newComment]] },
                    });
                    console.log('DEBUG: editComments: Successfully updated comment in DISQUALIFIED sheet.');
                } else {
                    console.warn('DEBUG: editComments: Candidate row NOT found in DISQUALIFIED sheet for the given criteria.');
                    showToast('warning', 'Not Found', `Candidate "${name}" not found in DISQUALIFIED sheet for update.`);
                }
            } else {
                console.warn(`DEBUG: editComments: Unrecognized status "${status}". No sheet update performed.`);
                showToast('warning', 'Invalid Status', `Cannot update comments for an unrecognized status: ${status}.`);
            }

            // --- 7. Final Success Actions ---
            showToast('success', 'Success', 'Comments updated successfully!');
            console.log('DEBUG: editComments: Comments updated successfully. Calling `fetchSecretariatCandidates` to refresh UI.');
            fetchSecretariatCandidates(itemNumber); // Refresh the UI to show updated comments.

        } catch (error) {
            // --- 8. Comprehensive Error Handling ---
            console.error('DEBUG: editComments: CRITICAL ERROR caught during Google Sheets API operation:', error);
            let errorMessage = 'An unexpected error occurred during comment update.';

            // Try to get a more specific error message from the Google API response.
            if (error.result && error.result.error && error.result.error.message) {
                errorMessage = error.result.error.message;
            } else if (error.body) {
                 try {
                    const errorBody = JSON.parse(error.body);
                    if (errorBody.error && errorBody.error.message) {
                        errorMessage = errorBody.error.message;
                    }
                 } catch (e) {
                     // Ignore JSON parsing errors, use default message.
                 }
            }
            showToast('error', 'Update Failed', `Failed to update comments: ${errorMessage}`);
        }
    } finally {
        // --- CLEANUP: Ensure the operation is marked as complete ---
        activeCommentModalOperations.delete(operationId); // Remove from active set
        console.log(`DEBUG: Exiting editComments function. Operation ${operationId} cleared from active list.`);
    }
}




async function displaySecretariatCandidateDetails(name, itemNumber) {
  const container = document.getElementById('secretariat-candidate-details');
  container.innerHTML = '';

  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'GENERAL_LIST!A:O',
    });

    const candidateRow = response.result.values?.find(row => row[0] === name && row[1] === itemNumber);
    if (candidateRow) {
      const tilesContainer = document.createElement('div');
      tilesContainer.classList.add('tiles-container');

      const headers = [
        'SEX', 'DATE OF BIRTH', 'AGE', 'ELIGIBILITY/PROFESSION', 'PROFESSIONAL LICENSE',
        'LETTER OF INTENT (PDF FILE)', 'PERSONAL DATA SHEET (SPREADSHEET FILE)',
        'WORK EXPERIENCE SHEET (WORD FILE)', 'PROOF OF ELIGIBILITY (PDF FILE)', 
        'CERTIFICATES (PDF FILE)', 'INDIVIDUAL PERFORMANCE COMMITMENT REVIEW (PDF FILE)',
        'CERTIFICATE OF EMPLOYMENT (PDF FILE)', 'DIPLOMA (PDF FILE)', 
        'TRANSCRIPT OF RECORDS (PDF FILE)'
      ];

      const columnsCtoP = candidateRow.slice(2, 16);
      columnsCtoP.forEach((value, index) => {
        const tile = document.createElement('div');
        tile.classList.add('tile');

        const header = document.createElement('h4');
        header.textContent = headers[index];
        tile.appendChild(header);

        const content = document.createElement('div');
        content.classList.add('tile-content');

        if (index < 4) {
          const textContent = document.createElement('p');
          textContent.textContent = value || 'No Data';
          if (!value) textContent.classList.add('no-data');
          content.appendChild(textContent);
        } else {
          const button = document.createElement('button');
          button.classList.add('open-link-button');
          button.textContent = value ? 'View Document' : 'NONE';
          if (value) {
            button.addEventListener('click', () => {
              window.open(value, '_blank');
            });
          } else {
            button.disabled = true;
          }
          content.appendChild(button);
        }
        tile.appendChild(content);
        tilesContainer.appendChild(tile);
      });

      container.appendChild(tilesContainer);
    } else {
      container.innerHTML = '<p>No matching data found.</p>';
    }
  } catch (error) {
    console.error('Error fetching candidate details:', error);
    container.innerHTML = '<p>Error loading candidate details.</p>';
  }
}

function createEvaluatorSelector() {
  if (!EVALUATOR_PASSWORDS || Object.keys(EVALUATOR_PASSWORDS).length === 0) return;
  if (document.getElementById('evaluatorSelect')) return;

  const formGroup = document.createElement('div');
  formGroup.className = 'form-group';

  const label = document.createElement('label');
  label.htmlFor = 'evaluatorSelect';
  label.textContent = 'Evaluator:';

  const select = document.createElement('select');
  select.id = 'evaluatorSelect';
  select.required = true;

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Select Evaluator';
  select.appendChild(defaultOption);

  Object.keys(EVALUATOR_PASSWORDS).forEach((evaluator) => {
    const option = document.createElement('option');
    option.value = evaluator;
    option.textContent = evaluator;
    select.appendChild(option);
  });

  select.addEventListener('change', handleEvaluatorSelection);
  formGroup.appendChild(label);
  formGroup.appendChild(select);

  const ratingForm = document.querySelector('.rating-form');
  if (ratingForm) ratingForm.insertBefore(formGroup, ratingForm.firstChild);
}

async function handleEvaluatorSelection(event) {
  const selectElement = event.target;
  const newSelection = selectElement.value;

  if (!newSelection) {
    currentEvaluator = null;
    saveAuthState(gapi.client.getToken(), null);
    saveDropdownState();
    resetDropdowns(vacancies);
    return;
  }

  const modalContent = `
    <p>Please enter the password for ${newSelection}:</p>
    <input type="password" id="evaluatorPassword" class="modal-input">
  `;

  showModal('Evaluator Authentication', modalContent, () => {
    const passwordInput = document.getElementById('evaluatorPassword');
    const password = passwordInput.value.trim();

    if (password === EVALUATOR_PASSWORDS[newSelection]) {
      currentEvaluator = newSelection;
      selectElement.value = newSelection;
      saveAuthState(gapi.client.getToken(), currentEvaluator);
      saveDropdownState();
      showToast('success', 'Success', `Logged in as ${newSelection}`);
      resetDropdowns(vacancies);
      fetchSubmittedRatings();
    } else {
      showToast('error', 'Error', 'Incorrect password');
      selectElement.value = currentEvaluator || '';
    }
  });
}

function handleAuthClick() {
  window.location.href = `${API_BASE_URL}/auth/google`;
}

function handleSignOutClick() {
  const modalContent = `<p>Are you sure you want to sign out?</p>`;
  showModal('Confirm Sign Out', modalContent, () => {
    gapi.client.setToken(null);
    localStorage.clear();
    console.log('All localStorage cleared');
    currentEvaluator = null;
    sessionId = null;
    vacancies = [];
    candidates = [];
    compeCodes = [];
    competencies = [];
    submissionQueue = [];
    console.log('Global variables reset');
    updateUI(false);
    resetDropdowns([]);
    elements.competencyContainer.innerHTML = '';
    clearRatings();
    const evaluatorSelect = document.getElementById('evaluatorSelect');
    if (evaluatorSelect) {
      evaluatorSelect.value = '';
      evaluatorSelect.parentElement.remove();
    }
    if (elements.submitRatings) {
      elements.submitRatings.disabled = true;
    }
    if (fetchTimeout) {
      clearTimeout(fetchTimeout);
      fetchTimeout = null;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    const resultsArea = document.querySelector('.results-area');
    if (resultsArea) {
      resultsArea.remove();
    }
    const container = document.querySelector('.container');
    container.style.marginTop = '20px';
    const authSection = document.querySelector('.auth-section');
    authSection.classList.add('signed-out');
    showToast('success', 'Signed Out', 'You have been successfully signed out.');
  }, () => {
    console.log('Sign out canceled');
  });
}

function updateUI(isSignedIn) {
  elements.authStatus.textContent = isSignedIn ? 'SIGNED IN' : 'You are not signed in';
  elements.signInBtn.style.display = isSignedIn ? 'none' : 'inline-block';
  elements.signOutBtn.style.display = isSignedIn ? 'inline-block' : 'none';
  if (elements.ratingForm) elements.ratingForm.style.display = isSignedIn ? 'block' : 'none';
  document.getElementById('tabsContainer').hidden = !isSignedIn; // Show/hide tabs
  if (!isSignedIn) {
    elements.competencyContainer.innerHTML = '';
    const resultsArea = document.querySelector('.results-area');
    if (resultsArea) resultsArea.classList.remove('active');
  }
}

async function loadSheetData(maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (!await isTokenValid()) {
        console.log('Token invalid, refreshed in attempt', attempt);
      }
      const ranges = Object.values(SHEET_RANGES).filter(range => range !== undefined);
      if (ranges.length === 0) {
        throw new Error('No valid ranges defined in SHEET_RANGES');
      }
      console.log('Fetching ranges:', ranges);
      const data = await Promise.all(
        ranges.map((range) =>
          gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range,
          })
        )
      );
      const rangeKeys = Object.keys(SHEET_RANGES);
      const dataMap = {};
      ranges.forEach((range, index) => {
        dataMap[rangeKeys[index]] = data[index]?.result?.values || [];
      });
      vacancies = dataMap.VACANCIES || [];
      candidates = dataMap.CANDIDATES || [];
      compeCodes = dataMap.COMPECODE || [];
      competencies = dataMap.COMPETENCY || [];
      rateLog = dataMap.RATELOG || [];
      generalList = dataMap.GENERAL_LIST || [];
      disqualified = dataMap.DISQUALIFIED || [];
      console.log('Sheet data loaded:', { vacancies, candidates, compeCodes, competencies, rateLog, generalList, disqualified });
      initializeDropdowns(vacancies);
      updateUI(true);
      return;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      if (attempt === maxRetries) {
        elements.authStatus.textContent = 'Error loading sheet data. Retrying soon...';
        showToast('error', 'Error', 'Failed to load sheet data, retrying in the background.');
        setTimeout(() => loadSheetData(), 300000);
      } else {
        await delay(Math.pow(2, attempt) * 1000);
      }
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function updateDropdown(dropdown, options, defaultOptionText = 'Select') {
  dropdown.innerHTML = `<option value="">${defaultOptionText}</option>`;
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    dropdown.appendChild(option);
  });
}

function setDropdownState(dropdown, enabled) {
  dropdown.disabled = !enabled;
  if (!enabled) {
    dropdown.value = '';
    dropdown.innerHTML = `<option value="">${dropdown.getAttribute('data-placeholder') || 'Select Option'}</option>`;
  }
}


function initializeDropdowns(vacancies) {
  function setDropdownState(dropdown, enabled) {
    dropdown.disabled = !enabled;
    if (!enabled) {
      dropdown.value = '';
      dropdown.innerHTML = `<option value="">${dropdown.getAttribute('data-placeholder') || 'Select Option'}</option>`;
    }
  }

  elements.assignmentDropdown.setAttribute('data-placeholder', 'Select Assignment');
  elements.positionDropdown.setAttribute('data-placeholder', 'Select Position');
  elements.itemDropdown.setAttribute('data-placeholder', 'Select Item');
  elements.nameDropdown.setAttribute('data-placeholder', 'Select Name');

  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(elements.assignmentDropdown, uniqueAssignments, 'Select Assignment');

  setDropdownState(elements.positionDropdown, false);
  setDropdownState(elements.itemDropdown, false);
  setDropdownState(elements.nameDropdown, false);

  elements.assignmentDropdown.addEventListener('change', async () => {
    const assignment = elements.assignmentDropdown.value;
    const requiresPassword = currentEvaluator === "In-charge, Administrative Division" || currentEvaluator === "End-User";
    let isAuthorized = true;

    if (currentTab !== 'rater') return; // Only process if Rater tab is active

    if (assignment && requiresPassword) {
      const authKey = `currentAssignmentAuth_${currentEvaluator}`;
      const storedAssignment = localStorage.getItem(authKey);

      if (storedAssignment !== assignment) {
        const modalContent = `
          <p>Please enter the password to access assignment "${assignment}":</p>
          <input type="password" id="assignmentPassword" class="modal-input">
        `;
        isAuthorized = await new Promise((resolve) => {
          showModal('Assignment Authentication', modalContent, () => {
            const passwordInput = document.getElementById('assignmentPassword');
            const password = passwordInput.value.trim();
            const isValid = password === "admindan";
            if (isValid) localStorage.setItem(authKey, assignment);
            resolve(isValid);
          });
        });

        if (!isAuthorized) {
          showToast('error', 'Error', 'Incorrect password for assignment');
          elements.assignmentDropdown.value = storedAssignment || '';
          setDropdownState(elements.positionDropdown, false);
          setDropdownState(elements.itemDropdown, false);
          setDropdownState(elements.nameDropdown, false);
          saveDropdownState();
          return;
        }
      }
    }

    if (assignment && isAuthorized) {
      const positions = vacancies
        .filter((row) => row[2] === assignment)
        .map((row) => row[1]);
      updateDropdown(elements.positionDropdown, [...new Set(positions)], 'Select Position');
      setDropdownState(elements.positionDropdown, true);
    } else {
      setDropdownState(elements.positionDropdown, false);
    }
    setDropdownState(elements.itemDropdown, false);
    setDropdownState(elements.nameDropdown, false);
    saveDropdownState();
  });

  elements.positionDropdown.addEventListener('change', () => {
    const assignment = elements.assignmentDropdown.value;
    const position = elements.positionDropdown.value;

    if (currentTab !== 'rater') return;
    if (assignment && position) {
      const items = vacancies
        .filter((row) => row[2] === assignment && row[1] === position)
        .map((row) => row[0]);
      updateDropdown(elements.itemDropdown, [...new Set(items)], 'Select Item');
      setDropdownState(elements.itemDropdown, true);
    } else {
      setDropdownState(elements.itemDropdown, false);
    }
    setDropdownState(elements.nameDropdown, false);
    saveDropdownState();
  });

  elements.itemDropdown.addEventListener('change', () => {
    const item = elements.itemDropdown.value;
    if (currentTab !== 'rater') return;
    if (item) {
      const names = candidates
        .filter((row) => row[1] === item)
        .map((row) => row[0]);
      updateDropdown(elements.nameDropdown, [...new Set(names)], 'Select Name');
      setDropdownState(elements.nameDropdown, true);
    } else {
      setDropdownState(elements.nameDropdown, false);
    }
    saveDropdownState();
  });

  elements.nameDropdown.addEventListener('change', async () => {
    const item = elements.itemDropdown.value;
    const name = elements.nameDropdown.value;
    const assignment = elements.assignmentDropdown.value;
    const position = elements.positionDropdown.value;

    if (currentTab !== 'rater') return;
    if (item && name) {
      displayCandidatesTable(name, item);

      const selectedCodes = compeCodes
        .filter((row) => row[0] === item)
        .flatMap((row) => row[1].split(','));

      const relatedCompetencies = competencies
        .filter((row) => row[0] && selectedCodes.includes(row[0]))
        .map((row) => row[1]);

      const vacancy = vacancies.find(row =>
        row[0] === item && row[2] === assignment && row[1] === position
      );

      const salaryGrade = vacancy && vacancy[3] ? parseInt(vacancy[3], 10) : 0;
      console.log("Salary Grade detected:", salaryGrade);

      await displayCompetencies(name, relatedCompetencies, salaryGrade);

      if (currentEvaluator && name && item) {
        clearRatings();
        fetchSubmittedRatings();
      }
    } else {
      clearRatings();
    }

    saveDropdownState();
  });

}

function resetDropdowns(vacancies) {
  const uniqueAssignments = vacancies.length ? [...new Set(vacancies.slice(1).map((row) => row[2]))] : [];
  updateDropdown(elements.assignmentDropdown, uniqueAssignments, 'Select Assignment');
  updateDropdown(elements.positionDropdown, [], 'Select Position');
  updateDropdown(elements.itemDropdown, [], 'Select Item');
  updateDropdown(elements.nameDropdown, [], 'Select Name');
  elements.assignmentDropdown.value = '';
  elements.positionDropdown.value = '';
  elements.itemDropdown.value = '';
  elements.nameDropdown.value = '';
  elements.assignmentDropdown.disabled = !vacancies.length;
  elements.positionDropdown.disabled = true;
  elements.itemDropdown.disabled = true;
  elements.nameDropdown.disabled = true;
}

async function fetchSubmittedRatings() {
  if (fetchTimeout) clearTimeout(fetchTimeout);

  fetchTimeout = setTimeout(async () => {
    const name = elements.nameDropdown.value;
    const item = elements.itemDropdown.value;

    if (!currentEvaluator || !name || !item) {
      console.warn('Missing evaluator, name, or item');
      elements.submitRatings.disabled = true;
      clearRatings();
      return;
    }

    try {
      if (!await isTokenValid()) await refreshAccessToken();
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG,
      });

      const data = response.result.values || [];
      const filteredRows = data.slice(1).filter(row =>
        row[2] === name && row[1] === item && row[5] === currentEvaluator
      );

      const competencyRatings = {};
      filteredRows.forEach(row => {
        const competencyName = row[3];
        if (!competencyRatings[competencyName]) competencyRatings[competencyName] = {};
        competencyRatings[competencyName][currentEvaluator] = row[4];
      });

      console.log(`Fetched ratings for ${name} (${item}):`, competencyRatings);
      prefillRatings(competencyRatings, filteredRows.length === 0, name, item);
    } catch (error) {
      console.error('Error fetching ratings:', error);
      showToast('error', 'Error', 'Failed to fetch ratings');
      clearRatings();
      prefillRatings({}, true, name, item);
    }
  }, 300);
}

function clearRatings() {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const radios = item.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => (radio.checked = false));
  });
  console.log('Radio buttons cleared');
}

let originalRatings = {};
function prefillRatings(competencyRatings, noFetchedData, name, item) {
  originalRatings = {};
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');

  clearRatings();

  if (Object.keys(competencyRatings).length > 0) {
    Array.from(competencyItems).forEach(item => {
      const competencyName = item.querySelector('label').textContent.split('. ')[1];
      const rating = competencyRatings[competencyName]?.[currentEvaluator];

      if (rating) {
        originalRatings[competencyName] = rating;
        const radio = item.querySelector(`input[type="radio"][value="${rating}"]`);
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change'));
          console.log(`Prefilled ${competencyName} with rating ${rating} for ${name} (${item})`);
        }
      }
    });
  } else if (noFetchedData) {
    loadRadioState(name, item);
  }

  function checkAllRatingsSelected() {
    const allItems = Array.from(competencyItems);
    const allRated = allItems.every(item =>
      Array.from(item.getElementsByTagName('input')).some(input => input.checked)
    );
    elements.submitRatings.disabled = !allRated;
  }

  Array.from(competencyItems).forEach(item => {
    const inputs = item.querySelectorAll('input[type="radio"]');
    inputs.forEach(input => {
      input.removeEventListener('change', input.onchange);
      input.onchange = () => {
        const competencyName = item.querySelector('label').textContent.split('. ')[1];
        originalRatings[competencyName] = input.value;
        checkAllRatingsSelected();
        saveRadioState(competencyName, input.value, name, item);
      };
      input.addEventListener('change', input.onchange);
    });
  });

  checkAllRatingsSelected();
}

async function submitRatings() {
  if (isSubmitting) {
    console.log('Submission already in progress');
    return;
  }

  try {
    const token = gapi.client.getToken();
    if (!token || !await isTokenValid()) {
      await refreshAccessToken();
      if (!gapi.client.getToken()) {
        showToast('error', 'Error', 'Authentication failed. Please sign in again.');
        handleAuthClick();
        return;
      }
    }

    if (!currentEvaluator) {
      showToast('warning', 'Warning', 'Please select an evaluator');
      return;
    }

    const item = elements.itemDropdown.value;
    const candidateName = elements.nameDropdown.value;

    if (!item || !candidateName) {
      showToast('error', 'Error', 'Please select both item and candidate');
      return;
    }

    const existingRatings = await checkExistingRatings(item, candidateName, currentEvaluator);
    const isUpdate = existingRatings.length > 0;

    let tempRatings = {};
    if (isUpdate) {
      const isVerified = await verifyEvaluatorPassword(existingRatings);
      if (!isVerified) {
        revertToExistingRatings(existingRatings);
        showToast('warning', 'Update Canceled', 'Ratings reverted to original values');
        return;
      }
      // Store current ratings before update
      const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
      Array.from(competencyItems).forEach(item => {
        const competencyName = item.querySelector('label').textContent.split('. ')[1];
        const rating = Array.from(item.querySelectorAll('input[type="radio"]')).find(r => r.checked)?.value;
        if (rating) tempRatings[competencyName] = rating;
      });
    }

    const { ratings, error } = prepareRatingsData(item, candidateName, currentEvaluator);
    if (error) {
      showToast('error', 'Error', error);
      return;
    }

    const psychoSocialRating = document.getElementById('psychosocial-rating-value')?.textContent || '0.00';
    const potentialRating = document.getElementById('potential-rating-value')?.textContent || '0.00';

    let modalContent = `
      <div class="modal-body">
        <p>Are you sure you want to ${isUpdate ? 'update' : 'submit'} the following ratings?</p>
        <div class="modal-field"><span class="modal-label">EVALUATOR:</span> <span class="modal-value">${currentEvaluator}</span></div>
        <div class="modal-field"><span class="modal-label">ASSIGNMENT:</span> <span class="modal-value">${elements.assignmentDropdown.value}</span></div>
        <div class="modal-field"><span class="modal-label">POSITION:</span> <span class="modal-value">${elements.positionDropdown.value}</span></div>
        <div class="modal-field"><span class="modal-label">ITEM:</span> <span class="modal-value">${item}</span></div>
        <div class="modal-field"><span class="modal-label">NAME:</span> <span class="modal-value">${candidateName}</span></div>
        <div class="modal-section">
          <h4>RATINGS TO ${isUpdate ? 'UPDATE' : 'SUBMIT'}:</h4>
          <div class="modal-field"><span class="modal-label">PSYCHO-SOCIAL:</span> <span class="modal-value rating-value">${psychoSocialRating}</span></div>
          <div class="modal-field"><span class="modal-label">POTENTIAL:</span> <span class="modal-value rating-value">${potentialRating}</span></div>
    `;

    if (isUpdate) {
      modalContent += '<h4>CHANGES:</h4>';
      ratings.forEach(row => {
        const competencyName = row[3];
        const newRating = row[4];
        const oldRating = existingRatings.find(r => r[3] === competencyName)?.[4] || 'N/A';
        if (oldRating !== newRating) {
          modalContent += `
            <div class="modal-field">
              <span class="modal-label">${competencyName}:</span>
              <span class="modal-value rating-value">${oldRating} → ${newRating}</span>
            </div>
          `;
        }
      });
    }

    modalContent += `
        </div>
      </div>
    `;

    showModal(
      `CONFIRM ${isUpdate ? 'UPDATE' : 'SUBMISSION'}`,
      modalContent,
      () => {
        submissionQueue.push(ratings);
        showSubmittingIndicator();
        processSubmissionQueue();
      },
      () => {
        if (isUpdate) {
          revertToExistingRatings(existingRatings);
          showToast('info', 'Canceled', 'Ratings reverted to original values');
        } else {
          console.log('Submission canceled');
          showToast('info', 'Canceled', 'Ratings submission aborted');
        }
      }
    );
  } catch (error) {
    console.error('Submission error:', error);
    showToast('error', 'Error', `Failed to submit: ${error.message}`);
    if (error.status === 401 || error.status === 403) handleAuthClick();
  }
}

function showSubmittingIndicator() {
  let indicator = document.getElementById('submittingIndicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'submittingIndicator';
    indicator.className = 'submitting-indicator';
    indicator.innerHTML = `
      <div class="submitting-content">
        <span class="spinner"></span>
        <span>SUBMITTING...</span>
      </div>
    `;
    document.body.appendChild(indicator);
  }
}

function hideSubmittingIndicator() {
  const indicator = document.getElementById('submittingIndicator');
  if (indicator) indicator.remove();
}

async function processSubmissionQueue() {
  if (isSubmitting || !submissionQueue.length) return;
  isSubmitting = true;

  const ratings = submissionQueue.shift();

  try {
    const result = await submitRatingsWithLock(ratings);
    if (result.success) {
      const candidateName = ratings[0][2];
      const item = ratings[0][1];
      localStorage.removeItem(`radioState_${candidateName}_${item}`);
      showModal(
        'Submission Successful',
        `<p>${result.message}</p>`,
        () => {
          console.log('Success modal closed');
          fetchSubmittedRatings();
        },
        null,
        false
      );
    }
  } catch (error) {
    console.error('Queue submission failed:', error);
    showToast('error', 'Error', error.message);
    submissionQueue.unshift(ratings);
    setTimeout(processSubmissionQueue, 5000);
  } finally {
    isSubmitting = false;
    hideSubmittingIndicator();
    processSubmissionQueue();
  }
}

async function checkExistingRatings(item, candidateName, evaluator) {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.RATELOG,
    });

    const existingData = response.result.values || [];
    const candidateInitials = getInitials(candidateName);
    return existingData.filter(row =>
      row[0].startsWith(`${item}-${candidateInitials}`) && row[5] === evaluator
    );
  } catch (error) {
    console.error('Error checking ratings:', error);
    return [];
  }
}

function revertToExistingRatings(existingRatings) {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const existingRating = existingRatings.find(row => row[3] === competencyName)?.[4];
    if (existingRating) {
      const radio = item.querySelector(`input[type="radio"][value="${existingRating}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    } else {
      const radios = item.querySelectorAll('input[type="radio"]');
      radios.forEach(radio => radio.checked = false);
    }
  });
}

async function verifyEvaluatorPassword(existingRatings) {
  return new Promise((resolve) => {
    const modalContent = `
      <p>Please verify password for ${currentEvaluator} to update ratings:</p>
      <input type="password" id="verificationPassword" class="modal-input">
    `;
    showModal('Password Verification', modalContent, () => {
      const password = document.getElementById('verificationPassword').value;
      if (password === EVALUATOR_PASSWORDS[currentEvaluator]) {
        resolve(true);
      } else {
        resolve(false);
      }
    }, () => {
      revertToExistingRatings(existingRatings);
      resolve(false);
    });
  });
}

function prepareRatingsData(item, candidateName, currentEvaluator) {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  const ratings = [];

  for (let itemElement of competencyItems) {
    const competencyName = itemElement.querySelector('label').textContent.split('. ')[1];
    const rating = Array.from(itemElement.querySelectorAll('input[type="radio"]'))
      .find(radio => radio.checked)?.value;

    if (!rating) {
      return { error: 'Please rate all competencies' };
    }

    const competencyCode = getCompetencyCode(competencyName);
    const candidateInitials = getInitials(candidateName);
    const ratingCode = `${item}-${candidateInitials}-${competencyCode}-${currentEvaluator}`;
    
    ratings.push([
      ratingCode,
      item,
      candidateName,
      competencyName,
      rating,
      currentEvaluator,
      '',
      ''
    ]);
  }
  console.log('Ratings to submit:', ratings);
  return { ratings };
}

async function submitRatingsWithLock(ratings, maxRetries = 5) {
  const lockRange = "RATELOG!G1:I1";
  const LOCK_TIMEOUT = 15000;
  let retryCount = 0;
  let lockAcquired = false;

  while (retryCount < maxRetries) {
    try {
      if (!await isTokenValid()) await refreshAccessToken();
      const { acquired, owner } = await acquireLock(sessionId);
      if (!acquired) {
        showToast('info', 'Waiting', `Another user (${owner}) is submitting… Retrying in ${Math.pow(2, retryCount)}s`);
        await delay(Math.pow(2, retryCount) * 1000);
        retryCount++;
        continue;
      }
      lockAcquired = true;

      const result = await processRatings(ratings);
      await releaseLock(sessionId);
      return result;
    } catch (error) {
      console.error('Error in submitRatingsWithLock:', error);
      retryCount++;
      if (lockAcquired) await releaseLock(sessionId);
      if (retryCount === maxRetries) {
        throw new Error('Submission failed after retries—queued for later');
      }
      await delay(Math.pow(2, retryCount) * 1000);
    }
  }
}

async function acquireLock(sessionId) {
  const lockRange = "RATELOG!G1:I1";
  try {
    const lockStatusResponse = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: lockRange,
    });
    const [lockStatus, lockTimestamp, lockOwner] = lockStatusResponse.result.values?.[0] || ['', '', ''];
    
    if (lockStatus === 'locked' && (new Date().getTime() - new Date(lockTimestamp).getTime()) < 15000) {
      return { acquired: false, owner: lockOwner || 'unknown' };
    }

    const timestamp = new Date().toISOString();
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: lockRange,
      valueInputOption: 'RAW',
      resource: { values: [['locked', timestamp, sessionId]] },
    });
    return { acquired: true };
  } catch (error) {
    console.error('Lock acquisition failed:', error);
    return { acquired: false, owner: 'error' };
  }
}

async function releaseLock(sessionId) {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "RATELOG!G1:I1",
      valueInputOption: 'RAW',
      resource: { values: [['', '', '']] },
    });
  } catch (error) {
    console.error('Failed to release lock:', error);
    showToast('error', 'Lock Error', 'Lock release failed—may resolve in 15s');
  }
}

async function processRatings(ratings) {
  if (!await isTokenValid()) await refreshAccessToken();
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
  });

  let existingData = response.result.values || [];
  const newRatings = [];
  let isUpdated = false;

  const existingRatingsMap = new Map();
  existingData.forEach((row, index) => {
    if (row[0]) existingRatingsMap.set(row[0], { row, index });
  });

  ratings.forEach(newRating => {
    const ratingCode = newRating[0];
    if (existingRatingsMap.has(ratingCode)) {
      const { index } = existingRatingsMap.get(ratingCode);
      existingData[index] = newRating;
      isUpdated = true;
    } else {
      newRatings.push(newRating);
    }
  });

  const batchUpdates = [];
  if (isUpdated) {
    batchUpdates.push(
      gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG,
        valueInputOption: 'RAW',
        resource: { values: existingData },
      })
    );
  }
  if (newRatings.length > 0) {
    batchUpdates.push(
      gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG,
        valueInputOption: 'RAW',
        resource: { values: newRatings },
      })
    );
  }

  await Promise.all(batchUpdates);
  return {
    success: true,
    message: isUpdated ? 'Ratings updated successfully' : 'Ratings submitted successfully'
  };
}

function getInitials(name) {
  return name.split(' ').map(word => word.slice(0, 3)).join('');
}

function getCompetencyCode(competencyName) {
  return competencyName.split(' ').map(word => word.charAt(0).replace(/[^A-Za-z]/g, '')).join('');
}

async function displayCandidatesTable(name, itemNumber) {
  const container = document.getElementById('candidates-table');
  container.innerHTML = '';

  const candidateRow = candidates.find(row => row[0] === name && row[1] === itemNumber);
  if (candidateRow) {
    const tilesContainer = document.createElement('div');
    tilesContainer.classList.add('tiles-container');

    const headers = [
      'SEX', 'DATE OF BIRTH', 'AGE', 'ELIGIBILITY/PROFESSION', 'PROFESSIONAL LICENSE',
      'LETTER OF INTENT (PDF FILE)', 'PERSONAL DATA SHEET (SPREADSHEET FILE)',
      'WORK EXPERIENCE SHEET (WORD FILE)', 'PROOF OF ELIGIBILITY (PDF FILE)', 
      'CERTIFICATES (PDF FILE)', 'INDIVIDUAL PERFORMANCE COMMITMENT REVIEW (PDF FILE)',
      'CERTIFICATE OF EMPLOYMENT (PDF FILE)', 'DIPLOMA (PDF FILE)', 
      'TRANSCRIPT OF RECORDS (PDF FILE)'
    ];

    const columnsCtoP = candidateRow.slice(2, 16);
    columnsCtoP.forEach((value, index) => {
      const tile = document.createElement('div');
      tile.classList.add('tile');

      const header = document.createElement('h4');
      header.textContent = headers[index];
      tile.appendChild(header);

      const content = document.createElement('div');
      content.classList.add('tile-content');

      if (index < 4) {
        const textContent = document.createElement('p');
        textContent.textContent = value || 'No Data';
        if (!value) textContent.classList.add('no-data');
        content.appendChild(textContent);
      } else {
        const button = document.createElement('button');
        button.classList.add('open-link-button');
        button.textContent = value ? 'View Document' : 'NONE';
        if (value) {
          button.addEventListener('click', () => {
            window.open(value, '_blank'); // Open the original Google Drive link in a new tab
          });
        } else {
          button.disabled = true;
        }
        content.appendChild(button);
      }
      tile.appendChild(content);
      tilesContainer.appendChild(tile);
    });

    container.appendChild(tilesContainer);
  } else {
    container.innerHTML = '<p>No matching data found.</p>';
  }
}

async function fetchCompetenciesFromSheet() {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'ALLCOMPE!A:C',
    });

    const values = response.result.values || [];
    const competenciesColumn1 = values.map(row => row[0]).filter(value => value);
    const competenciesColumn2 = values.map(row => row[1]).filter(value => value);
    const competenciesColumn3 = values.map(row => row[2]).filter(value => value);

    return { competenciesColumn1, competenciesColumn2, competenciesColumn3 };
  } catch (error) {
    console.error('Error fetching competencies:', error);
    return { competenciesColumn1: [], competenciesColumn2: [], competenciesColumn3: [] };
  }
}


async function displayCompetencies(name, competencies, salaryGrade = 0) {
  const { competenciesColumn1, competenciesColumn2, competenciesColumn3 } = await fetchCompetenciesFromSheet();

  elements.competencyContainer.innerHTML = `
    <div class="competency-section" id="basic-competencies">
      <h3 class="section-title">PSYCHO-SOCIAL ATTRIBUTES AND PERSONALITY TRAITS</h3>
      <h3>BASIC COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    <div class="competency-section" id="organizational-competencies">
      <h3 class="section-title">POTENTIAL</h3>
      <h3>ORGANIZATIONAL COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    ${salaryGrade >= 24 ? `
      <div class="competency-section" id="leadership-competencies">
        <h3>LEADERSHIP COMPETENCIES</h3>
        <div class="competency-grid"></div>
      </div>
    ` : ''}
    <div class="competency-section" id="minimum-competencies">
      <h3>MINIMUM COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    <button id="reset-ratings" class="btn-reset">RESET RATINGS</button>
  `;

  let resultsArea = document.querySelector('.results-area');
  const pageWrapper = document.querySelector('.page-wrapper');
  if (!resultsArea) {
    resultsArea = document.createElement('div');
    resultsArea.className = 'results-area';
    pageWrapper.insertBefore(resultsArea, pageWrapper.firstChild);
  }
  resultsArea.classList.add('active');
  resultsArea.innerHTML = `
    <div class="ratings-title">CURRENT SELECTION & RATINGS</div>
    <div class="candidate-name">${elements.nameDropdown.value || 'N/A'}</div>
    <div class="grid-container">
      <div class="dropdown-info">
        <div class="data-row"><span class="data-label">EVALUATOR:</span> <span class="data-value">${currentEvaluator || 'N/A'}</span></div>
        <div class="data-row"><span class="data-label">ASSIGNMENT:</span> <span class="data-value">${elements.assignmentDropdown.value || 'N/A'}</span></div>
        <div class="data-row"><span class="data-label">POSITION:</span> <span class="data-value">${elements.positionDropdown.value || 'N/A'}</span></div>
        <div class="data-row"><span class="data-label">ITEM:</span> <span class="data-value">${elements.itemDropdown.value || 'N/A'}</span></div>
        <div class="data-row"><span class="data-label">BASIC:</span> <span class="data-value" id="basic-rating-value">0.00</span></div>
        <div class="data-row"><span class="data-label">ORGANIZATIONAL:</span> <span class="data-value" id="organizational-rating-value">0.00</span></div>
        ${salaryGrade >= 24 ? `<div class="data-row"><span class="data-label">LEADERSHIP:</span> <span class="data-value" id="leadership-rating-value">0.00</span></div>` : ''}
        <div class="data-row"><span class="data-label">MINIMUM:</span> <span class="data-value" id="minimum-rating-value">0.00</span></div>
      </div>
    </div>
    <div class="prominent-ratings">
      <div><span class="data-label">PSYCHO-SOCIAL:</span> <span class="data-value" id="psychosocial-rating-value">0.00</span></div>
      <div><span class="data-label">POTENTIAL:</span> <span class="data-value" id="potential-rating-value">0.00</span></div>
    </div>
  `;

  const container = document.querySelector('.container');
  const updateMarginTop = () => {
    const resultsHeight = resultsArea.offsetHeight + 20;
    container.style.marginTop = `${resultsHeight}px`;
  };
  
  updateMarginTop();
  window.addEventListener('resize', updateMarginTop);

  const basicRatings = Array(competenciesColumn1.length).fill(0);
  const orgRatings = Array(competenciesColumn2.length).fill(0);
  const leadershipRatings = Array(competenciesColumn3.length).fill(0);
  const minimumRatings = Array(competencies.length).fill(0);

  function createCompetencyItem(comp, idx, ratings, updateFunction) {
    const div = document.createElement("div");
    div.className = "competency-item";
    div.innerHTML = `
      <label>${idx + 1}. ${comp}</label>
      <div class="rating-container">
        ${[1, 2, 3, 4, 5].map(val => `
          <input type="radio" id="${comp}-${val}" name="${comp}" value="${val}">
          <label for="${comp}-${val}">${val}</label>
        `).join('')}
      </div>
    `;
    div.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        ratings[idx] = parseInt(radio.value, 10);
        updateFunction();
        computePsychosocial();
        computePotential();
        saveRadioState(comp, radio.value, name, elements.itemDropdown.value);
      });
    });
    return div;
  }

  const basicGrid = document.querySelector("#basic-competencies .competency-grid");
  competenciesColumn1.forEach((comp, idx) => {
    basicGrid.appendChild(createCompetencyItem(comp, idx, basicRatings, computeBasicRating));
  });

  const orgGrid = document.querySelector("#organizational-competencies .competency-grid");
  competenciesColumn2.forEach((comp, idx) => {
    orgGrid.appendChild(createCompetencyItem(comp, idx, orgRatings, computeOrgRating));
  });

  if (salaryGrade >= 24) {
    const leadGrid = document.querySelector("#leadership-competencies .competency-grid");
    competenciesColumn3.forEach((comp, idx) => {
      leadGrid.appendChild(createCompetencyItem(comp, idx, leadershipRatings, computeLeadershipRating));
    });
  }

  const minGrid = document.querySelector("#minimum-competencies .competency-grid");
  competencies.forEach((comp, idx) => {
    minGrid.appendChild(createCompetencyItem(comp, idx, minimumRatings, computeMinimumRating));
  });

  function computeBasicRating() {
    const total = basicRatings.filter(r => r).reduce((a, b) => a + (b / 5) * 2, 0);
    document.getElementById("basic-rating-value").textContent = total.toFixed(2);
  }

  function computeOrgRating() {
    const total = orgRatings.filter(r => r).reduce((a, b) => a + b / 5, 0);
    document.getElementById("organizational-rating-value").textContent = total.toFixed(2);
  }

  function computeLeadershipRating() {
    const leadTotal = leadershipRatings.filter(r => r).reduce((a, b) => a + b / 5, 0);
    const el = document.getElementById("leadership-rating-value");
    if (el) el.textContent = leadTotal.toFixed(2);
  }

  function computeMinimumRating() {
    const total = minimumRatings.filter(r => r).reduce((a, b) => a + (b / minimumRatings.length), 0);
    document.getElementById("minimum-rating-value").textContent = total.toFixed(2);
  }

  function computePsychosocial() {
    const basicTotal = parseFloat(document.getElementById("basic-rating-value").textContent) || 0;
    document.getElementById("psychosocial-rating-value").textContent = basicTotal.toFixed(2);
  }

  function computePotential() {
    const orgTotal = parseFloat(document.getElementById("organizational-rating-value").textContent) || 0;
    const minTotal = parseFloat(document.getElementById("minimum-rating-value").textContent) || 0;
    const leadTotal = salaryGrade >= 24 ? (parseFloat(document.getElementById("leadership-rating-value").textContent) || 0) : 0;
    const divisor = salaryGrade >= 24 ? 3 : 2;
    const potential = ((orgTotal + minTotal + leadTotal) / divisor) * 2;
    document.getElementById("potential-rating-value").textContent = potential.toFixed(2);
  }

  document.getElementById('reset-ratings').addEventListener('click', () => {
    showModal(
      'CONFIRM RESET',
      '<p>Are you sure you want to reset all ratings? This action cannot be undone.</p>',
      () => {
        clearRatings();
        computeBasicRating();
        computeOrgRating();
        computeLeadershipRating();
        computeMinimumRating();
        computePsychosocial();
        computePotential();
        localStorage.removeItem(`radioState_${name}_${elements.itemDropdown.value}`);
        elements.submitRatings.disabled = true;
        showToast('success', 'Reset Complete', 'All ratings have been cleared.');
      }
    );
  });

  loadRadioState(name, elements.itemDropdown.value);
}


function saveRadioState(competencyName, value, candidateName, item) {
  const key = `radioState_${candidateName}_${item}`;
  const state = JSON.parse(localStorage.getItem(key)) || {};
  state[competencyName] = value;
  localStorage.setItem(key, JSON.stringify(state));
}

function loadRadioState(candidateName, item) {
  const key = `radioState_${candidateName}_${item}`;
  const state = JSON.parse(localStorage.getItem(key)) || {};
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');

  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const savedValue = state[competencyName];
    if (savedValue) {
      const radio = item.querySelector(`input[type="radio"][value="${savedValue}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    }
  });
}



function showModal(title, contentHTML, onConfirm = null, onCancel = null, showCancel = true) {
  let modalOverlay = document.getElementById('modalOverlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'modalOverlay';
    modalOverlay.className = 'modal-overlay';
    document.body.appendChild(modalOverlay);
  }

  modalOverlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <span class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('active')">×</span>
      </div>
      <div class="modal-content">${contentHTML}</div>
      <div class="modal-actions">
        ${showCancel ? '<button class="modal-cancel">Cancel</button>' : ''}
        <button id="modalConfirm" class="modal-confirm">Confirm</button>
      </div>
    </div>
  `;

  return new Promise((resolve) => {
    modalOverlay.classList.add('active');
    const confirmBtn = modalOverlay.querySelector('#modalConfirm');
    const cancelBtn = modalOverlay.querySelector('.modal-cancel');

    const closeHandler = (result) => {
      modalOverlay.classList.remove('active');
      resolve(result);
      modalOverlay.removeEventListener('click', outsideClickHandler);
    };

    confirmBtn.onclick = () => {
      if (onConfirm) onConfirm();
      closeHandler(true);
    };

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        if (onCancel) onCancel();
        closeHandler(false);
      };
    };

    const outsideClickHandler = (event) => {
      if (event.target === modalOverlay) {
        if (onCancel) onCancel();
        closeHandler(false);
      }
    };
    modalOverlay.addEventListener('click', outsideClickHandler);
  });
}

// Unchanged showFullScreenModal
function showFullScreenModal(title, contentHTML) {
  let modalOverlay = document.getElementById('modalOverlay');
  if (!modalOverlay) {
    modalOverlay = document.createElement('div');
    modalOverlay.id = 'modalOverlay';
    modalOverlay.className = 'modal-overlay';
    document.body.appendChild(modalOverlay);
  }

  modalOverlay.innerHTML = `
    <div class="modal full-screen-modal">
      <div class="modal-header">
        <h3 class="modal-title">${title}</h3>
        <span class="modal-close" onclick="this.closest('.modal-overlay').classList.remove('active')">×</span>
      </div>
      <div class="modal-content full-screen-content">${contentHTML}</div>
    </div>
  `;

  modalOverlay.classList.add('active');
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) {
      modalOverlay.classList.remove('active');
    }
  });
}


/**
 * Displays a customizable modal for comments.
 *
 * @param {string} title - The title of the modal.
 * @param {string} contentHTML - The custom HTML content for the modal body.
 * @param {string} candidateName - The name of the candidate, used for display and minimization.
 * @param {function} onConfirm - Callback function executed when the "Confirm" button is clicked.
 * @param {function} onCancel - Callback function executed when the "Cancel" button is clicked.
 * @param {boolean} showCancel - Whether to show the "Cancel" button.
 * @param {object} initialValues - Object containing initial values for input fields (education, training, experience, eligibility).
 * @returns {object} An object containing the promise and a setter for the isRestoring flag.
 */
function showCommentModal(title = 'Comment Modal', contentHTML, candidateName, onConfirm = null, onCancel = null, showCancel = true, initialValues = {}) {
    let modalOverlay = document.getElementById('modalOverlay');

    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modalOverlay';
        modalOverlay.className = 'modal-overlay';
        document.body.appendChild(modalOverlay);
    }

    const modalId = `modal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Use provided contentHTML or generate with initialValues if provided
    let renderedContentHTML = contentHTML;
    if (initialValues && Object.keys(initialValues).length > 0 && !contentHTML) {
        const isEdit = title.toLowerCase().includes('edit');
        const isDisqualified = title.toLowerCase().includes('disqualified');
        const actionText = isEdit
            ? `Edit comments for ${candidateName}${isDisqualified ? ' (DISQUALIFIED)' : ''}`
            : `Please enter comments for ${title.toLowerCase().includes('disqualified') ? 'disqualifying' : 'long-listing'} ${candidateName}`;
        renderedContentHTML = `
            <div class="modal-body">
                <p>${actionText}</p>
                <label for="educationComment">Education:</label>
                <input type="text" id="educationComment" class="modal-input" value="${initialValues.education || ''}">
                <label for="trainingComment">Training:</label>
                <input type="text" id="trainingComment" class="modal-input" value="${initialValues.training || ''}">
                <label for="experienceComment">Experience:</label>
                <input type="text" id="experienceComment" class="modal-input" value="${initialValues.experience || ''}">
                <label for="eligibilityComment">Eligibility:</label>
                <input type="text" id="eligibilityComment" class="modal-input" value="${initialValues.eligibility || ''}">
            </div>
        `;
    }

    modalOverlay.innerHTML = `
        <div class="modal" id="${modalId}">
            <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
                <span class="modal-close" data-modal-id="${modalId}">×</span>
            </div>
            <div class="modal-content">${renderedContentHTML || ''}</div>
            <div class="modal-actions">
                ${showCancel ? '<button class="modal-cancel">Cancel</button>' : ''}
                <button id="modalConfirm" class="modal-confirm">Confirm</button>
                <button class="modal-minimize" data-modal-id="${modalId}">Minimize</button>
            </div>
        </div>
    `;
    console.log('Rendered modal HTML:', modalOverlay.querySelector('.modal-content').innerHTML);

    let isRestoring = false;
    let isConfirming = false;
    let isMinimizing = false;

    // Capture the resolve and reject functions for the promise
    let _resolve;
    let _reject;

    const promise = new Promise((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
        modalOverlay.classList.add('active');
        const confirmBtn = modalOverlay.querySelector('#modalConfirm');
        const cancelBtn = modalOverlay.querySelector('.modal-cancel');
        const closeBtn = modalOverlay.querySelector('.modal-close');
        const minimizeBtn = modalOverlay.querySelector('.modal-minimize');
        const modalContent = modalOverlay.querySelector('.modal');

        const closeHandler = (result) => {
            if (isRestoring) {
                console.log('closeHandler skipped due to isRestoring=true');
                return;
            }
            console.log('closeHandler called with result:', result);
            modalOverlay.classList.remove('active');
            // Only delete from minimizedModals if it's currently there and we're truly closing
            if (minimizedModals.has(modalId)) {
                minimizedModals.delete(modalId);
            }
            ballPositions = ballPositions.filter(pos => pos.modalId !== modalId);
            _resolve(result); // Use the captured resolve
        };

        confirmBtn.onclick = (event) => {
            event.stopPropagation();
            console.log('Confirm button clicked');
            isConfirming = true;
            const inputs = modalOverlay.querySelectorAll('.modal-input');
            const inputValues = Array.from(inputs).map(input => input.value.trim());
            const [education, training, experience, eligibility] = inputValues;

            if (!education || !training || !experience || !eligibility) {
                console.log('Validation failed: All comment fields are required');
                showToast('error', 'Error', 'All comment fields are required');
                isConfirming = false;
                return;
            }

            const commentData = { education, training, experience, eligibility };
            console.log('Confirming with values:', commentData);
            try {
                let result = commentData;
                if (onConfirm) {
                    result = onConfirm(commentData);
                    console.log('onConfirm executed with result:', result);
                } else {
                    console.log('No onConfirm callback provided, using commentData');
                }
                closeHandler(result || commentData); // Resolve the promise
            } catch (error) {
                console.error('Error in onConfirm callback:', error);
                showToast('error', 'Error', `Failed to process confirmation: ${error.message}`);
            } finally {
                isConfirming = false;
            }
        };

        if (cancelBtn) {
            cancelBtn.onclick = (event) => {
                event.stopPropagation();
                console.log('Cancel button clicked');
                if (onCancel) onCancel();
                closeHandler(false); // Resolve the promise as canceled
            };
        }

        closeBtn.onclick = (event) => {
            event.stopPropagation();
            console.log('Close button clicked');
            isMinimizing = true;
            minimizeModal(modalId, candidateName, title, renderedContentHTML, onConfirm, onCancel, _resolve, _reject);
            setTimeout(() => { isMinimizing = false; }, 100);
        };

        minimizeBtn.onclick = (event) => {
            event.stopPropagation();
            console.log('Minimize button clicked');
            isMinimizing = true;
            minimizeModal(modalId, candidateName, title, renderedContentHTML, onConfirm, onCancel, _resolve, _reject);
            setTimeout(() => { isMinimizing = false; }, 100);
        };

        modalContent.addEventListener('click', (event) => {
            event.stopPropagation();
        });
    });

    return {
        promise,
        setRestoring: (value) => {
            console.log('Setting isRestoring to:', value);
            isRestoring = value;
        }
    };
}


/**
 * Minimizes an active modal and creates a floating ball for restoration.
 *
 * @param {string} modalId - The ID of the modal to minimize.
 * @param {string} candidateName - The name of the candidate associated with the modal.
 * @param {string} title - The title of the modal.
 * @param {string} contentHTML - The HTML content of the modal body.
 * @param {function} onConfirm - The original onConfirm callback.
 * @param {function} onCancel - The original onCancel callback.
 * @param {function} originalResolve - The resolve function of the original promise.
 * @param {function} originalReject - The reject function of the original promise.
 */
function minimizeModal(modalId, candidateName, title = 'Comment Modal', contentHTML = null, onConfirm = null, onCancel = null, originalResolve = null, originalReject = null) {
    const modal = document.getElementById(modalId);
    if (!modal) {
        console.warn('Modal not found for ID:', modalId);
        return;
    }

    const modalOverlay = modal.closest('.modal-overlay');
    const inputs = modal.querySelectorAll('.modal-input');
    const inputValues = Array.from(inputs).map(input => input.value.trim());

    console.log('Minimizing modal:', modalId, 'Inputs:', inputValues, 'Candidate:', candidateName);

    // Clean up any existing modals and balls for the same candidate
    for (const [existingModalId, state] of minimizedModals) {
        if (state.candidateName === candidateName && existingModalId !== modalId) {
            console.log('Removing existing modal state for candidate:', candidateName, 'Modal ID:', existingModalId);
            const existingBall = document.querySelector(`.floating-ball[data-modal-id="${existingModalId}"]`);
            if (existingBall) {
                existingBall.remove();
                ballPositions = ballPositions.filter(pos => pos.modalId !== existingModalId);
            }
            minimizedModals.delete(existingModalId);
        }
    }

    // Hide the current modal
    modalOverlay.classList.remove('active');
    modalOverlay.innerHTML = ''; // Clear modal content

    // Store the modal state
    minimizedModals.set(modalId, {
        title,
        inputValues,
        contentHTML: contentHTML || modal.querySelector('.modal-content').innerHTML,
        candidateName,
        onConfirm,
        onCancel,
        originalResolve,
        originalReject
    });

    // Check if a floating ball already exists for this modalId
    const existingBall = document.querySelector(`.floating-ball[data-modal-id="${modalId}"]`);
    if (existingBall) {
        console.warn('Floating ball already exists for modal ID:', modalId);
        return;
    }

    // Create a new floating ball
    const floatingBall = document.createElement('div');
    floatingBall.className = 'floating-ball';
    floatingBall.dataset.modalId = modalId;
    floatingBall.innerHTML = `
        <span class="floating-ball-label">${candidateName.slice(0, 10)}...</span>
    `;
    floatingBall.onclick = () => restoreMinimizedModal(modalId);
    document.body.appendChild(floatingBall);

    if (typeof makeDraggable === 'function') {
        makeDraggable(floatingBall, modalId);
    } else {
        console.warn('makeDraggable function not found. Floating ball will not be draggable.');
    }
}



/**
 * Restores a minimized modal to its active state.
 *
 * @param {string} modalId - The ID of the modal to restore.
 */
function restoreMinimizedModal(modalId) {
    const state = minimizedModals.get(modalId);
    if (!state) {
        console.warn('No state found for modal ID:', modalId);
        return;
    }

    console.log('Restoring modal:', modalId, 'Saved inputs:', state.inputValues);

    // Get or create the modal overlay
    let modalOverlay = document.getElementById('modalOverlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modalOverlay';
        modalOverlay.className = 'modal-overlay';
        document.body.appendChild(modalOverlay);
    }

    // Clean up any existing modal content to prevent duplicates
    modalOverlay.innerHTML = '';

    // Re-generate contentHTML for consistent structure and values
    const initialValues = {
        education: state.inputValues[0] || '',
        training: state.inputValues[1] || '',
        experience: state.inputValues[2] || '',
        eligibility: state.inputValues[3] || '',
    };

    const isEdit = state.title.toLowerCase().includes('edit');
    const isDisqualified = state.title.toLowerCase().includes('disqualified');
    const actionText = isEdit
        ? `Edit comments for ${state.candidateName}${isDisqualified ? ' (DISQUALIFIED)' : ''}`
        : `Please enter comments for ${state.title.toLowerCase().includes('disqualified') ? 'disqualifying' : 'long-listing'} ${state.candidateName}`;
    const renderedContentHTML = `
        <div class="modal-body">
            <p>${actionText}</p>
            <label for="educationComment">Education:</label>
            <input type="text" id="educationComment" class="modal-input" value="${initialValues.education || ''}">
            <label for="trainingComment">Training:</label>
            <input type="text" id="trainingComment" class="modal-input" value="${initialValues.training || ''}">
            <label for="experienceComment">Experience:</label>
            <input type="text" id="experienceComment" class="modal-input" value="${initialValues.experience || ''}">
            <label for="eligibilityComment">Eligibility:</label>
            <input type="text" id="eligibilityComment" class="modal-input" value="${initialValues.eligibility || ''}">
        </div>
    `;

    // Render the modal HTML
    modalOverlay.innerHTML = `
        <div class="modal" id="${modalId}">
            <div class="modal-header">
                <h3 class="modal-title">${state.title}</h3>
                <span class="modal-close" data-modal-id="${modalId}">×</span>
            </div>
            <div class="modal-content">${renderedContentHTML || ''}</div>
            <div class="modal-actions">
                ${state.onCancel ? '<button class="modal-cancel">Cancel</button>' : ''}
                <button id="modalConfirm" class="modal-confirm">Confirm</button>
                <button class="modal-minimize" data-modal-id="${modalId}">Minimize</button>
            </div>
        </div>
    `;
    console.log('Rendered modal HTML on restore:', modalOverlay.querySelector('.modal-content').innerHTML);

    // Make the modal active
    modalOverlay.classList.add('active');

    // Get button elements
    const confirmBtn = modalOverlay.querySelector('#modalConfirm');
    const cancelBtn = modalOverlay.querySelector('.modal-cancel');
    const closeBtn = modalOverlay.querySelector('.modal-close');
    const minimizeBtn = modalOverlay.querySelector('.modal-minimize');
    const modalContent = modalOverlay.querySelector('.modal');

    let isRestoringFlag = true;
    let isConfirming = false;
    let isMinimizing = false;

    // Close handler to resolve the original promise
    const closeHandlerRestored = (result) => {
        if (isRestoringFlag) {
            console.log('closeHandlerRestored skipped due to isRestoringFlag=true');
            return;
        }
        console.log('closeHandlerRestored called with result:', result);
        modalOverlay.classList.remove('active');
        modalOverlay.innerHTML = ''; // Clear modal content
        minimizedModals.delete(modalId);
        ballPositions = ballPositions.filter(pos => pos.modalId !== modalId);
        state.originalResolve(result);
    };

    // Confirm button handler
    confirmBtn.onclick = (event) => {
        event.stopPropagation();
        console.log('Confirm button clicked on restored modal');
        isConfirming = true;
        const inputs = modalOverlay.querySelectorAll('.modal-input');
        const inputValues = Array.from(inputs).map(input => input.value.trim());
        const [education, training, experience, eligibility] = inputValues;

        if (!education || !training || !experience || !eligibility) {
            console.log('Validation failed: All comment fields are required on restored modal');
            showToast('error', 'Error', 'All comment fields are required');
            isConfirming = false;
            return;
        }

        const commentData = { education, training, experience, eligibility };
        console.log('Confirming restored modal with values:', commentData);
        try {
            let result = commentData;
            if (state.onConfirm) {
                result = state.onConfirm(commentData);
                console.log('onConfirm (restored) executed with result:', result);
            }
            closeHandlerRestored(result || commentData);
        } catch (error) {
            console.error('Error in onConfirm callback (restored modal):', error);
            showToast('error', 'Error', `Failed to process confirmation: ${error.message}`);
        } finally {
            isConfirming = false;
        }
    };

    // Cancel button handler
    if (cancelBtn) {
        cancelBtn.onclick = (event) => {
            event.stopPropagation();
            console.log('Cancel button clicked on restored modal');
            if (state.onCancel) state.onCancel();
            closeHandlerRestored(false);
        };
    }

    // Close and minimize button handlers
    closeBtn.onclick = (event) => {
        event.stopPropagation();
        console.log('Close button clicked on restored modal');
        isMinimizing = true;
        minimizeModal(modalId, state.candidateName, state.title, renderedContentHTML, state.onConfirm, state.onCancel, state.originalResolve, state.originalReject);
        setTimeout(() => { isMinimizing = false; }, 100);
    };

    minimizeBtn.onclick = (event) => {
        event.stopPropagation();
        console.log('Minimize button clicked on restored modal');
        isMinimizing = true;
        minimizeModal(modalId, state.candidateName, state.title, renderedContentHTML, state.onConfirm, state.onCancel, state.originalResolve, state.originalReject);
        setTimeout(() => { isMinimizing = false; }, 100);
    };

    // Prevent outside clicks from minimizing (to match initial modal behavior)
    modalContent.addEventListener('click', (event) => {
        event.stopPropagation();
    });

    // Apply input values
    const applyInputs = () => {
        let allInputsFound = true;
        Object.entries(initialValues).forEach(([key, value]) => {
            const input = document.getElementById(`${key}Comment`);
            if (input) {
                input.value = value;
                console.log(`Set #${key}Comment to:`, value);
            } else {
                console.error(`Input #${key}Comment not found`);
                allInputsFound = false;
            }
        });

        if (!allInputsFound) {
            console.error('Not all inputs found on restore, retrying...');
            requestAnimationFrame(applyInputs);
        } else {
            isRestoringFlag = false;
        }
    };
    requestAnimationFrame(applyInputs);

    // Remove floating ball
    const floatingBall = document.querySelector(`.floating-ball[data-modal-id="${modalId}"]`);
    if (floatingBall) {
        floatingBall.remove();
        ballPositions = ballPositions.filter(pos => pos.modalId !== modalId);
    }
}




// Updated makeDraggable to prevent ball overlap
function makeDraggable(element, modalId) {
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;

  // Find a unique position
  let baseX = 50;
  let baseY = 50;
  let offset = 70; // Ball size (60px) + 10px gap
  let positionFound = false;
  let attempt = 0;
  const maxAttempts = 100;

  while (!positionFound && attempt < maxAttempts) {
    const overlaps = ballPositions.some(pos => Math.abs(pos.x - baseX) < offset && Math.abs(pos.y - baseY) < offset);
    if (!overlaps) {
      positionFound = true;
      currentX = baseX;
      currentY = baseY;
      ballPositions.push({ modalId, x: currentX, y: currentY });
    } else {
      baseX += offset;
      if (baseX + 60 > window.innerWidth) {
        baseX = 50;
        baseY += offset;
      }
      if (baseY + 60 > window.innerHeight) {
        baseY = 50;
        attempt++;
      }
    }
    attempt++;
  }

  if (!positionFound) {
    currentX = 50;
    currentY = 50;
    ballPositions.push({ modalId, x: currentX, y: currentY });
  }

  element.style.position = 'fixed';
  element.style.left = `${currentX}px`;
  element.style.top = `${currentY}px`;

  element.addEventListener('mousedown', (e) => {
    initialX = e.clientX - currentX;
    initialY = e.clientY - currentY;
    isDragging = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      element.style.left = `${currentX}px`;
      element.style.top = `${currentY}px`;

      // Update position in ballPositions
      const posIndex = ballPositions.findIndex(pos => pos.modalId === modalId);
      if (posIndex !== -1) {
        ballPositions[posIndex].x = currentX;
        ballPositions[posIndex].y = currentY;
      }
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}








function showToast(type, title, message) {
  const toastContainer = document.createElement('div');
  toastContainer.className = 'toast-container';
  document.body.appendChild(toastContainer);

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <span class="toast-close">×</span>
  `;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => toastContainer.remove(), 300);
  }, 5000);

  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.style.animation = 'slideOut 0.3s ease-out forwards';
    setTimeout(() => toastContainer.remove(), 300);
  });
}

async function testRefreshNow() {
  console.log('Manually triggering token refresh');
  const success = await refreshAccessToken();
  console.log('Refresh result:', success ? 'Success' : 'Failed');
  if (success) {
    scheduleTokenRefresh(); // Reschedule next refresh if successful
  }
  return success;
}
window.testRefreshNow = testRefreshNow;

window.addEventListener('storage', (event) => {
  if (event.key === 'authState' && event.newValue) {
    const newAuthState = JSON.parse(event.newValue);
    if (newAuthState.access_token && newAuthState.expires_at) {
      gapi.client.setToken({ access_token: newAuthState.access_token });
      scheduleTokenRefresh();
      console.log('Token updated from another tab');
    }
  }
});



elements.signInBtn.addEventListener('click', handleAuthClick);
elements.signOutBtn.addEventListener('click', handleSignOutClick);
elements.submitRatings.addEventListener('click', submitRatings);

// Fix: Properly close DOMContentLoaded wrapper
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
});
