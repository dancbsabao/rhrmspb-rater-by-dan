// =====================================
// COMBINED JAVASCRIPT CODE
// =====================================

// =====================================
// BulletproofAPIManager (from 3.js)
// =====================================

class BulletproofAPIManager {
  constructor() {
    this.cache = new Map();
  }

  async bulletproofFetch(cacheKey, fetchFunction, options = {}) {
    const {
      forceRefresh = false,
      cacheDuration = 600000
    } = options;

    if (!forceRefresh && this.cache.has(cacheKey)) {
      const cachedData = this.cache.get(cacheKey);
      if (Date.now() - cachedData.timestamp < cacheDuration) {
        console.log(`Cache hit for ${cacheKey}.`);
        return cachedData.data;
      }
    }

    try {
      const response = await fetchFunction();
      if (!response.result) {
        throw new Error("Invalid API response format");
      }
      this.cache.set(cacheKey, {
        data: response,
        timestamp: Date.now()
      });
      return response;
    } catch (error) {
      console.error(`Error fetching ${cacheKey}:`, error);
      if (this.cache.has(cacheKey)) {
        console.log(`Failed to fetch, returning stale data for ${cacheKey}.`);
        return this.cache.get(cacheKey).data;
      }
      throw error;
    }
  }

  async batchFetch(requests, options = {}) {
    const results = [];
    const promises = requests.map(request =>
      this.bulletproofFetch(request.key, request.fetchFunction, request.options)
      .then(data => results.push({
        key: request.key,
        data
      }))
      .catch(error => {
        console.error(`Batch fetch error for ${request.key}:`, error);
        results.push({
          key: request.key,
          error
        });
      })
    );

    await Promise.allSettled(promises);
    return {
      results
    };
  }

  getCachedData(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 600000) {
      return cached.data;
    }
    return null;
  }

  setCachedData(cacheKey, data) {
    this.cache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
  }

  clearCache() {
    this.cache.clear();
  }
}

// =====================================
// CONFIGURATION (from 3.js)
// =====================================

const SUBMISSION_CONFIG = {
  MAX_RETRIES: 3,
  BASE_DELAY: 500,
  MAX_DELAY: 3000,
  LOCK_TIMEOUT: 8000,
  BATCH_SIZE: 10
};

// Cache for existing ratings to avoid repeated API calls
const ratingsCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

// =====================================
// GLOBAL VARIABLES (from 1.js, with additions from 3.js)
// =====================================

let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;
let fetchTimeout = null;
let isSubmitting = false;
let refreshTimer = null;
let sessionId = null; // To track server session
//let submissionQueue = []; // Queue for pending submissions
let currentTab = 'rater'; // Track current tab ('rater' or 'secretariat')
let generalList = [];
let disqualified = [];
let rateLog = [];
let SECRETARIAT_PASSWORD = '';
let secretariatMemberId = null; // Initialize secretariat member ID
let activeCommentModalOperations = new Set();
let minimizedModals = new Map(); // Store minimized comment modal states
let ballPositions = []; // Track positions of floating balls
let vacanciesData = [];
const loadingState = {
  gapi: false,
  dom: false,
  uiReady: false,
  apiDone: false // ✅ Track API completion
};
let uiObserver;
let uiCheckTimeout;
let CLIENT_ID;
let API_KEY;
let SHEET_ID;
let SCOPES;
let EVALUATOR_PASSWORDS;
let SHEET_RANGES;
let SECRETARIAT_MEMBERS = [];
let SIGNATORIES = []; // To store signatories

// DOM elements
const elements = {
  authStatus: document.getElementById('authStatus'),
  signInBtn: document.getElementById('signInBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  logoutAllBtn: document.getElementById('logoutAllBtn'),
  assignmentDropdown: document.getElementById('assignmentDropdown'),
  positionDropdown: document.getElementById('positionDropdown'),
  itemDropdown: document.getElementById('itemDropdown'),
  nameDropdown: document.getElementById('nameDropdown'),
  competencyContainer: document.getElementById('competencyContainer'),
  submitRatings: document.getElementById('submitRatings'),
  ratingForm: document.querySelector('.rating-form'),
  generatePdfBtn: document.getElementById('generatePdfBtn'),
  manageSignatoriesBtn: document.getElementById('manageSignatoriesBtn'),
  signatoriesModal: document.getElementById('signatoriesModal'),
  addSignatoryBtn: document.getElementById('addSignatoryBtn'),
  newSignatoryName: document.getElementById('newSignatoryName'),
  newSignatoryPosition: document.getElementById('newSignatoryPosition'),
  newSignatoryAssignment: document.getElementById('newSignatoryAssignment'),
  signatoriesUl: document.getElementById('signatoriesUl'),
  closeSignatoriesModalBtns: document.querySelectorAll('.modal-close-signatories'),
  logoutAllModal: document.getElementById('logoutAllModal'),
  logoutAllPassword: document.getElementById('logoutAllPassword'),
  confirmLogoutAllBtn: document.getElementById('confirmLogoutAllBtn'),
  closeLogoutAllModal: document.querySelectorAll('.modal-close'),
  tabsContainer: document.getElementById('tabsContainer'),
  raterTab: document.getElementById('raterTab'),
  secretariatTab: document.getElementById('secretariatTab'),
  raterContent: document.getElementById('raterContent'),
  secretariatContent: document.getElementById('secretariatContent')
};

let vacancies = [];
let candidates = [];
let compeCodes = [];
let competencies = [];

const API_BASE_URL = "https://rhrmspb-rater-by-dan.onrender.com";
let dropdownStateRestoring = false;

// =====================================
// OPTIMIZED SUBMISSION QUEUE (from 3.js)
// =====================================

class SubmissionQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.retryQueue = [];
  }

  add(ratings, priority = 'normal') {
    const submission = {
      id: Date.now() + Math.random(),
      ratings,
      priority,
      attempts: 0,
      timestamp: Date.now()
    };

    if (priority === 'high') {
      this.queue.unshift(submission);
    } else {
      this.queue.push(submission);
    }

    this.process();
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 || this.retryQueue.length > 0) {
      if (this.queue.length === 0) {
        // No high-priority items, process retries
        this.queue = this.retryQueue;
        this.retryQueue = [];
      }

      const submission = this.queue.shift();
      console.log(`⏳ Processing submission ${submission.id}...`);

      try {
        await this._submitSingle(submission);
        console.log(`✅ Submission ${submission.id} successful.`);
      } catch (error) {
        console.error(`❌ Submission ${submission.id} failed:`, error);
        submission.attempts++;
        if (submission.attempts <= SUBMISSION_CONFIG.MAX_RETRIES) {
          console.log(`🔄 Re-queuing submission ${submission.id} for retry.`);
          // Backoff before re-queuing
          await new Promise(resolve => setTimeout(resolve, SUBMISSION_CONFIG.BASE_DELAY * submission.attempts));
          this.retryQueue.push(submission);
        } else {
          console.error(`🔴 Submission ${submission.id} failed after ${submission.attempts} attempts. Abandoning.`);
          showToast('error', 'Submission Failed', 'An error occurred while saving your ratings. Please check your connection and try again.');
        }
      }
    }
    this.processing = false;
  }

  async _submitSingle(submission) {
    const {
      assignment,
      position,
      item,
      name,
      ratings
    } = submission.ratings;
    const evaluator = currentEvaluator;

    if (!evaluator) {
      throw new Error('No evaluator selected.');
    }

    const payload = {
      assignment,
      position,
      item,
      name,
      evaluator,
      ratings,
    };

    const token = gapi.client.getToken();
    if (!token || !token.access_token) {
      throw new Error('No access token available.');
    }

    try {
      const response = await fetch(`${API_BASE_URL}/submit-ratings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.status} - ${errorText}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error in _submitSingle:', error);
      throw error;
    }
  }

  isEmpty() {
    return this.queue.length === 0 && this.retryQueue.length === 0;
  }
}
const submissionQueue = new SubmissionQueue();

// =====================================
// UTILITY FUNCTIONS (from 1.js, 2.js, 3.js)
// =====================================

function showToast(type, title, message) {
  Toastify({
    text: `${title}: ${message}`,
    duration: 3000,
    gravity: "top",
    position: "center",
    backgroundColor: type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#FF9800',
    stopOnFocus: true,
  }).showToast();
}

function updateUI(isAuthenticated) {
  const authSection = document.querySelector('.auth-section');
  const appSection = document.querySelector('.app-section');
  const evaluatorSelect = document.getElementById('evaluatorSelect');
  const tabsContainer = document.getElementById('tabsContainer');

  if (isAuthenticated) {
    authSection.classList.remove('signed-out');
    authSection.classList.add('signed-in');
    elements.signInBtn.style.display = 'none';
    elements.signOutBtn.style.display = 'block';
    elements.logoutAllBtn.style.display = 'block';
    appSection.classList.remove('hidden');
    tabsContainer.classList.remove('hidden');
  } else {
    authSection.classList.remove('signed-in');
    authSection.classList.add('signed-out');
    elements.signInBtn.style.display = 'block';
    elements.signOutBtn.style.display = 'none';
    elements.logoutAllBtn.style.display = 'none';
    appSection.classList.add('hidden');
    tabsContainer.classList.add('hidden');
  }
}

function updateDropdown(dropdownElement, items, defaultText) {
  if (!dropdownElement) {
    console.error('Dropdown element not found!');
    return;
  }
  dropdownElement.innerHTML = '';
  const defaultOption = document.createElement('option');
  defaultOption.textContent = defaultText;
  defaultOption.value = '';
  dropdownElement.appendChild(defaultOption);

  items.sort().forEach(item => {
    if (item) {
      const option = document.createElement('option');
      option.value = item;
      option.textContent = item;
      dropdownElement.appendChild(option);
    }
  });

  // Re-enable and reset state
  dropdownElement.disabled = false;
  dropdownElement.value = '';
}

function resetDropdowns(dropdowns) {
  dropdowns.forEach(dropdown => {
    if (dropdown) {
      dropdown.innerHTML = '<option value="">Select...</option>';
      dropdown.disabled = true;
    }
  });
}

function parseSecretariatMembers(values) {
  if (!values || values.length <= 1) return [];

  const members = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (row && row[0]) {
      members.push({
        id: row[0],
        name: row[1] || '',
        position: row[2] || '',
        vacancies: (row[3] || '').split(',').map(v => v.trim()).filter(Boolean)
      });
    }
  }
  return members;
}

function parseVacanciesData(values) {
  return values || [];
}

function matchesRatingRow(row, item, name, evaluator) {
  if (!row || row.length < 4) return false;

  const rowEvaluator = row[3]?.trim().toUpperCase();
  const rowItem = row[1]?.trim().toUpperCase();
  const rowName = row[0]?.trim().toUpperCase();

  const isMatch = rowEvaluator === evaluator.toUpperCase() &&
    rowItem === item.toUpperCase() &&
    rowName === name.toUpperCase();

  return isMatch;
}

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
  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
  }

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
  try {
    const raw = localStorage.getItem('dropdownState');
    const dropdownState = raw ? JSON.parse(raw) : {};
    console.log('Loaded dropdown state:', dropdownState);
    return dropdownState || {};
  } catch (e) {
    console.warn('Failed to parse dropdownState from localStorage:', e);
    return {};
  }
}

function loadAuthState() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState || !authState.access_token) {
    console.log('No auth state found');
    return null;
  }
  const sanitizedAuthState = {
    session_id: authState.session_id,
    expires_at: authState.expires_at,
    evaluator: authState.evaluator,
    secretariatMemberId: authState.secretariatMemberId
  };
  console.log('Loaded auth state:', sanitizedAuthState);
  return authState;
}

async function restoreState() {
  dropdownStateRestoring = true;
  const authState = loadAuthState();
  const dropdownState = loadDropdownState();
  const authSection = document.querySelector('.auth-section');
  const container = document.querySelector('.container');

  try {
    if (authState) {
      gapi.client.setToken({
        access_token: authState.access_token
      });
      sessionId = authState.session_id;
      secretariatMemberId = authState.secretariatMemberId;
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (!await isTokenValid()) await refreshAccessToken();
      currentEvaluator = authState.evaluator;
      updateUI(true);
      authSection.classList.remove('signed-out');

      await loadSheetData();
      console.log('Sheet data loaded, initializing dropdowns');

      initializeDropdowns(vacancies);
      await initializeSecretariatDropdowns();

      const evaluatorSelect = document.getElementById('evaluatorSelect');
      if (evaluatorSelect && dropdownState.evaluator) {
        evaluatorSelect.value = dropdownState.evaluator;
        currentEvaluator = dropdownState.evaluator;
      }

      const changePromises = [];
      if (dropdownState.assignment && elements.assignmentDropdown) {
        const options = Array.from(elements.assignmentDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.assignment)) {
          elements.assignmentDropdown.value = dropdownState.assignment;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              elements.assignmentDropdown.removeEventListener('change', handler);
            };
            elements.assignmentDropdown.addEventListener('change', handler, {
              once: true
            });
            elements.assignmentDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.position && elements.positionDropdown) {
        const options = Array.from(elements.positionDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.position)) {
          elements.positionDropdown.value = dropdownState.position;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              elements.positionDropdown.removeEventListener('change', handler);
            };
            elements.positionDropdown.addEventListener('change', handler, {
              once: true
            });
            elements.positionDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.item && elements.itemDropdown) {
        const options = Array.from(elements.itemDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.item)) {
          elements.itemDropdown.value = dropdownState.item;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              elements.itemDropdown.removeEventListener('change', handler);
            };
            elements.itemDropdown.addEventListener('change', handler, {
              once: true
            });
            elements.itemDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.name && elements.nameDropdown) {
        const options = Array.from(elements.nameDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.name)) {
          elements.nameDropdown.value = dropdownState.name;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              elements.nameDropdown.removeEventListener('change', handler);
            };
            elements.nameDropdown.addEventListener('change', handler, {
              once: true
            });
            elements.nameDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }

      const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
      const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');
      const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');

      if (dropdownState.secretariatAssignment && secretariatAssignmentDropdown) {
        const options = Array.from(secretariatAssignmentDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatAssignment)) {
          secretariatAssignmentDropdown.value = dropdownState.secretariatAssignment;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              secretariatAssignmentDropdown.removeEventListener('change', handler);
            };
            secretariatAssignmentDropdown.addEventListener('change', handler, {
              once: true
            });
            secretariatAssignmentDropdown.dispatchEvent(new Event('change'));
          }));
        } else {
          showToast('warning', 'Warning', `Assignment "${dropdownState.secretariatAssignment}" not available`);
        }
      }
      if (dropdownState.secretariatPosition && secretariatPositionDropdown) {
        const options = Array.from(secretariatPositionDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatPosition)) {
          secretariatPositionDropdown.value = dropdownState.secretariatPosition;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              secretariatPositionDropdown.removeEventListener('change', handler);
            };
            secretariatPositionDropdown.addEventListener('change', handler, {
              once: true
            });
            secretariatPositionDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }
      if (dropdownState.secretariatItem && secretariatItemDropdown) {
        const options = Array.from(secretariatItemDropdown.options).map(opt => opt.value);
        if (options.includes(dropdownState.secretariatItem)) {
          secretariatItemDropdown.value = dropdownState.secretariatItem;
          changePromises.push(new Promise(resolve => {
            const handler = () => {
              resolve();
              secretariatItemDropdown.removeEventListener('change', handler);
            };
            secretariatItemDropdown.addEventListener('change', handler, {
              once: true
            });
            secretariatItemDropdown.dispatchEvent(new Event('change'));
          }));
        }
      }

      await Promise.all(changePromises);

      if (currentTab === 'secretariat' && secretariatAssignmentDropdown) {
        await new Promise(resolve => setTimeout(resolve, 100));
        secretariatAssignmentDropdown.value = dropdownState.secretariatAssignment || '';
        secretariatAssignmentDropdown.dispatchEvent(new Event('change'));
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
    dropdownStateRestoring = false;
  }
}

async function initializeSecretariatDropdowns() {
  const assignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
  const positionDropdown = document.getElementById('secretariatPositionDropdown');
  const itemDropdown = document.getElementById('secretariatItemDropdown');

  if (!vacancies || vacancies.length <= 1) {
    showToast('error', 'Error', 'No vacancies available to populate dropdowns');
    return;
  }

  const member = SECRETARIAT_MEMBERS.find(m => m.id === secretariatMemberId);
  if (!member) {
    return;
  }

  const allowedItems = member.vacancies.map(item => item.toUpperCase());

  const filteredVacancies = vacancies.slice(1).filter(row => {
    const itemNumber = row[0]?.trim().toUpperCase();
    const isAllowed = allowedItems.includes(itemNumber);
    return isAllowed;
  });

  if (filteredVacancies.length === 0) {
    showToast('warning', 'Warning', 'No assigned vacancies available for this member');
    updateDropdown(assignmentDropdown, [], 'Select Assignment');
    updateDropdown(positionDropdown, [], 'Select Position');
    updateDropdown(itemDropdown, [], 'Select Item');
    return;
  }

  const uniqueAssignments = [...new Set(filteredVacancies.map(row => row[2]?.trim()))].filter(Boolean);
  updateDropdown(assignmentDropdown, uniqueAssignments, 'Select Assignment');

  assignmentDropdown.removeEventListener('change', assignmentDropdown._changeHandler);
  assignmentDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    const filteredPositions = [...new Set(
      filteredVacancies.filter(row => row[2]?.trim() === selectedAssignment).map(row => row[1]?.trim())
    )].filter(Boolean);
    updateDropdown(positionDropdown, filteredPositions, 'Select Position');
    updateDropdown(itemDropdown, [], 'Select Item');
    saveDropdownState();
  };
  assignmentDropdown.addEventListener('change', assignmentDropdown._changeHandler);

  positionDropdown.removeEventListener('change', positionDropdown._changeHandler);
  positionDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    const selectedPosition = positionDropdown.value;
    const filteredItems = filteredVacancies
      .filter(row => row[2]?.trim() === selectedAssignment && row[1]?.trim() === selectedPosition)
      .map(row => row[0]?.trim())
      .filter(Boolean);
    updateDropdown(itemDropdown, filteredItems, 'Select Item');
    saveDropdownState();
  };
  positionDropdown.addEventListener('change', positionDropdown._changeHandler);

  itemDropdown.removeEventListener('change', itemDropdown._changeHandler);
  itemDropdown._changeHandler = () => {
    saveDropdownState();
    if (itemDropdown.value) {
      fetchSecretariatCandidates(itemDropdown.value);
    }
  };
  itemDropdown.addEventListener('change', itemDropdown._changeHandler);


  if (assignmentDropdown.value && !dropdownStateRestoring) {
    assignmentDropdown.dispatchEvent(new Event('change'));
  }
}

// =====================================
// AUTHENTICATION & API MANAGEMENT (from 2.js, 1.js, 3.js)
// =====================================

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
    return await refreshAccessToken();
  }

  try {
    await gapi.client.sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID
    });
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
    showToast('error', 'Session Expired', 'Please sign in again.');
    signOut();
    return false;
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`Attempting token refresh (Attempt ${attempt + 1}/${maxRetries})`);
      const response = await fetch(`${API_BASE_URL}/refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: authState.session_id
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const newTokenResponse = await response.json();
      if (!newTokenResponse.access_token) {
        throw new Error('Refresh token response missing access token');
      }

      gapi.client.setToken({
        access_token: newTokenResponse.access_token,
        expires_in: newTokenResponse.expires_in
      });

      const newExpiresAt = Date.now() + (newTokenResponse.expires_in * 1000);
      const newAuthState = { ...authState,
        access_token: newTokenResponse.access_token,
        expires_at: newExpiresAt
      };
      localStorage.setItem('authState', JSON.stringify(newAuthState));
      scheduleTokenRefresh(newExpiresAt);
      console.log('Token refreshed successfully');
      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      if (attempt < maxRetries - 1) {
        await new Promise(res => setTimeout(res, retryDelay));
      }
    }
  }

  console.error('Failed to refresh token after multiple attempts.');
  showToast('error', 'Session Expired', 'Unable to refresh session. Please sign in again.');
  signOut();
  return false;
}

function scheduleTokenRefresh(expiresAt = null) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState) {
    return;
  }

  const expiryTime = expiresAt || authState.expires_at;
  const refreshIn = expiryTime - Date.now() - 60000; // Refresh 1 minute before expiry

  if (refreshIn > 0) {
    console.log(`Scheduling token refresh in ${Math.round(refreshIn / 1000)} seconds.`);
    refreshTimer = setTimeout(refreshAccessToken, refreshIn);
  } else {
    console.log('Token already expired or close to expiry, refreshing immediately.');
    refreshAccessToken();
  }
}

function signOut() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (authState && authState.session_id) {
    fetch(`${API_BASE_URL}/sign-out`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: authState.session_id
        }),
      })
      .then(response => {
        if (!response.ok) {
          throw new Error(`Sign-out failed on server: ${response.status}`);
        }
        console.log('Server-side session cleared.');
      })
      .catch(error => {
        console.error('Error during server-side sign-out:', error);
      });
  }

  gapi.client.setToken(null);
  localStorage.removeItem('authState');
  localStorage.removeItem('dropdownState');
  localStorage.removeItem('secretariatAuthenticated');
  localStorage.removeItem('currentTab');
  localStorage.removeItem('activeSignatory');
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  updateUI(false);
  window.location.reload();
}

function handleAuthClick() {
  const evaluatorSelect = document.getElementById('evaluatorSelect');
  const passwordInput = document.getElementById('passwordInput');
  const selectedEvaluator = evaluatorSelect.value;
  const password = passwordInput.value;

  if (!selectedEvaluator || !password) {
    showToast('error', 'Error', 'Please select an evaluator and enter a password.');
    return;
  }

  if (EVALUATOR_PASSWORDS.find(p => p.evaluator === selectedEvaluator)?.password !== password) {
    showToast('error', 'Authentication Failed', 'Incorrect password. Please try again.');
    return;
  }

  const authState = {
    evaluator: selectedEvaluator,
  };
  localStorage.setItem('authState', JSON.stringify(authState));

  showToast('success', 'Success', `Welcome, ${selectedEvaluator}!`);

  const authUrl = `${API_BASE_URL}/auth?evaluator=${encodeURIComponent(selectedEvaluator)}`;
  window.location.href = authUrl;
}

function handleTokenCallback(tokenResponse) {
  gapi.client.setToken(tokenResponse);
  sessionId = tokenResponse.session_id;
  const evaluatorSelect = document.getElementById('evaluatorSelect');
  currentEvaluator = evaluatorSelect.value;
  saveAuthState(tokenResponse, currentEvaluator);
  updateUI(true);
  window.location.href = '#'; // Clear URL hash if present
  loadSheetData();
}

// =====================================
// DATA FETCHING & PROCESSING (from 2.js, 1.js, 3.js)
// =====================================

const apiManager = new BulletproofAPIManager();

async function loadSheetData() {
  const sheetsToFetch = [{
    key: 'vacancies',
    range: SHEET_RANGES.VACANCIES
  }, {
    key: 'candidates',
    range: SHEET_RANGES.CANDIDATES
  }, {
    key: 'compeCodes',
    range: SHEET_RANGES.COMPECODE
  }, {
    key: 'competencies',
    range: SHEET_RANGES.COMPETENCY
  }, {
    key: 'secretariatMembers',
    range: SHEET_RANGES.SECRETARIAT
  }, {
    key: 'signatories',
    range: SHEET_RANGES.SIGNATORIES
  }, {
    key: 'rateLog',
    range: SHEET_RANGES.RATELOG
  }, {
    key: 'generalList',
    range: SHEET_RANGES.GENERAL_LIST
  }, {
    key: 'disqualified',
    range: SHEET_RANGES.DISQUALIFIED
  }, ];

  try {
    const results = await apiManager.batchFetch(
      sheetsToFetch.map(sheet => ({
        key: sheet.key,
        fetchFunction: () => gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: sheet.range,
        }),
        options: {
          forceRefresh: false,
        },
      }))
    );

    const vacanciesResult = results.results.find(r => r.key === 'vacancies')?.data?.result?.values || [];
    const candidatesResult = results.results.find(r => r.key === 'candidates')?.data?.result?.values || [];
    const compeCodesResult = results.results.find(r => r.key === 'compeCodes')?.data?.result?.values || [];
    const competenciesResult = results.results.find(r => r.key === 'competencies')?.data?.result?.values || [];
    const secretariatResult = results.results.find(r => r.key === 'secretariatMembers')?.data?.result?.values || [];
    const signatoriesResult = results.results.find(r => r.key === 'signatories')?.data?.result?.values || [];
    const rateLogResult = results.results.find(r => r.key === 'rateLog')?.data?.result?.values || [];
    const generalListResult = results.results.find(r => r.key === 'generalList')?.data?.result?.values || [];
    const disqualifiedResult = results.results.find(r => r.key === 'disqualified')?.data?.result?.values || [];

    vacancies = parseVacanciesData(vacanciesResult);
    candidates = parseCandidates(candidatesResult);
    compeCodes = compeCodesResult;
    competencies = competenciesResult;
    SECRETARIAT_MEMBERS = parseSecretariatMembers(secretariatResult);
    SIGNATORIES = parseSignatories(signatoriesResult);
    rateLog = rateLogResult;
    generalList = generalListResult;
    disqualified = disqualifiedResult;
    vacanciesData = vacancies;

    console.log('API fetch complete.');
    loadingState.apiDone = true;
    checkAndHideSpinner();
  } catch (error) {
    console.error('Error fetching sheet data:', error);
    loadingState.apiDone = true;
    checkAndHideSpinner();
    showToast('error', 'Error', 'Failed to load data from the Google Sheet.');
  }
}

async function fetchSubmittedRatings() {
  const {
    item,
    name
  } = elements;
  const candidateName = name.value;
  const selectedItem = item.value;

  if (!candidateName || !selectedItem || !currentEvaluator) {
    console.log('Not enough info to fetch ratings.');
    return;
  }

  const cachedKey = `ratings_${selectedItem}_${candidateName}_${currentEvaluator}`;
  const cachedData = apiManager.getCachedData(cachedKey);
  if (cachedData) {
    console.log('Using cached ratings.');
    displayRatingsForm(cachedData);
    return;
  }

  try {
    const range = SHEET_RANGES.RATELOG;
    const response = await apiManager.bulletproofFetch(
      cachedKey,
      () => gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range,
      })
    );
    const values = response.result.values;
    const ratings = parseRatings(values, selectedItem, candidateName, currentEvaluator);
    apiManager.setCachedData(cachedKey, ratings);
    displayRatingsForm(ratings);
  } catch (error) {
    console.error('Error fetching submitted ratings:', error);
    showToast('error', 'Error', 'Failed to fetch existing ratings.');
  }
}

async function submitRatings() {
  const assignment = elements.assignmentDropdown.value;
  const position = elements.positionDropdown.value;
  const item = elements.itemDropdown.value;
  const name = elements.nameDropdown.value;
  const evaluator = currentEvaluator;

  if (!assignment || !position || !item || !name || !evaluator) {
    showToast('error', 'Incomplete Form', 'Please select all dropdown values.');
    return;
  }

  const ratings = {};
  const competencyItems = document.querySelectorAll('.competency-item');
  let allRated = true;
  competencyItems.forEach(itemEl => {
    const competencyName = itemEl.querySelector('label').textContent.split('. ')[1];
    const checkedRadio = itemEl.querySelector('input[type="radio"]:checked');
    if (!checkedRadio) {
      allRated = false;
    } else {
      ratings[competencyName] = checkedRadio.value;
    }
  });

  if (!allRated) {
    showToast('error', 'Incomplete Ratings', 'Please rate all competencies before submitting.');
    return;
  }

  if (isSubmitting) {
    showToast('info', 'Submitting...', 'Your ratings are already being submitted.');
    return;
  }

  isSubmitting = true;
  showToast('info', 'Submitting...', 'Your ratings are being saved.');
  elements.submitRatings.disabled = true;

  try {
    submissionQueue.add({
      assignment,
      position,
      item,
      name,
      ratings
    });
    showToast('success', 'Ratings Submitted', 'Your ratings have been added to the queue for submission.');
  } catch (error) {
    console.error('Error adding submission to queue:', error);
    showToast('error', 'Submission Failed', 'Failed to add ratings to the submission queue.');
  } finally {
    isSubmitting = false;
    elements.submitRatings.disabled = false;
  }
}


function parseRatings(values, selectedItem, candidateName, evaluator) {
  if (!values || values.length <= 1) return {};
  const header = values[0];
  const ratings = {};
  values.slice(1).forEach(row => {
    if (matchesRatingRow(row, selectedItem, candidateName, evaluator)) {
      ratings[row[2]] = row[4];
    }
  });
  return ratings;
}

function displayRatingsForm(ratings) {
  const competencyContainer = elements.competencyContainer;
  competencyContainer.innerHTML = '';
  let originalRatings = {};

  if (competencies.length <= 1) {
    competencyContainer.innerHTML = '<p class="text-red-500">Error: Competency data not available.</p>';
    return;
  }

  competencies.slice(1).forEach(row => {
    const [compeCode, competencyName] = row;
    if (!compeCode || !competencyName) return;

    const competencyItem = document.createElement('div');
    competencyItem.className = 'competency-item mb-4 p-4 border border-gray-200 rounded-lg';
    competencyItem.innerHTML = `
      <label class="block text-gray-700 text-sm font-bold mb-2">${compeCode}. ${competencyName}</label>
      <div class="rating-options flex flex-wrap gap-2">
        <input type="radio" name="rating-${compeCode}" value="1" class="form-radio text-indigo-600 h-4 w-4"> 1
        <input type="radio" name="rating-${compeCode}" value="2" class="form-radio text-indigo-600 h-4 w-4"> 2
        <input type="radio" name="rating-${compeCode}" value="3" class="form-radio text-indigo-600 h-4 w-4"> 3
        <input type="radio" name="rating-${compeCode}" value="4" class="form-radio text-indigo-600 h-4 w-4"> 4
        <input type="radio" name="rating-${compeCode}" value="5" class="form-radio text-indigo-600 h-4 w-4"> 5
        <input type="radio" name="rating-${compeCode}" value="N/A" class="form-radio text-indigo-600 h-4 w-4"> N/A
      </div>
    `;
    competencyContainer.appendChild(competencyItem);

    const rating = ratings[competencyName];
    if (rating) {
      originalRatings[competencyName] = rating;
      const radio = competencyItem.querySelector(`input[type="radio"][value="${rating}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    }
  });

  function checkAllRatingsSelected() {
    const allItems = Array.from(competencyContainer.querySelectorAll('.competency-item'));
    const allRated = allItems.every(item =>
      Array.from(item.getElementsByTagName('input')).some(input => input.checked)
    );
    elements.submitRatings.disabled = !allRated;
  }
  checkAllRatingsSelected();

  competencyContainer.querySelectorAll('input[type="radio"]').forEach(input => {
    input.addEventListener('change', checkAllRatingsSelected);
  });
}

function parseCandidates(values) {
  const candidateData = values.slice(1);
  return candidateData.map(row => ({
    vacancies: row[14]?.trim() || '',
    item: row[1]?.trim() || '',
    position: row[2]?.trim() || '',
    assignment: row[3]?.trim() || '',
    name: row[4]?.trim() || '',
    gender: row[5]?.trim() || '',
    dob: row[6]?.trim() || '',
    age: row[7]?.trim() || '',
    address: row[8]?.trim() || '',
    school: row[9]?.trim() || '',
    year: row[10]?.trim() || '',
    gpa: row[11]?.trim() || '',
    licensure: row[12]?.trim() || '',
    eligibility: row[13]?.trim() || '',
    isDisqualified: row[15]?.trim().toLowerCase() === 'x'
  }));
}

function parseSignatories(values) {
  if (!values || values.length <= 1) return [];
  const signatories = [];
  values.slice(1).forEach(row => {
    if (row[0]) {
      signatories.push({
        id: row[0],
        name: row[1] || '',
        position: row[2] || '',
        assignment: row[3] || ''
      });
    }
  });
  return signatories;
}

async function fetchSecretariatCandidates(item) {
  const key = `secretariat_candidates_${item}`;
  const cachedData = apiManager.getCachedData(key);
  if (cachedData) {
    renderSecretariatTable(cachedData);
    return;
  }

  const itemData = vacancies.find(v => v[0] === item);
  const assignment = itemData?.[2];
  const position = itemData?.[1];

  try {
    const results = await apiManager.batchFetch([{
      key: 'generalList',
      fetchFunction: () => gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.GENERAL_LIST
      })
    }, {
      key: 'disqualified',
      fetchFunction: () => gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.DISQUALIFIED
      })
    }, ]);

    const generalListValues = results.results.find(r => r.key === 'generalList')?.data?.result?.values || [];
    const disqualifiedValues = results.results.find(r => r.key === 'disqualified')?.data?.result?.values || [];

    generalList = generalListValues;
    disqualified = disqualifiedValues;

    const filteredCandidates = generalList.slice(1).filter(row => {
      const rowItem = row[1]?.trim();
      return rowItem === item;
    });

    const disqualifiedCandidates = new Set(disqualified.slice(1).map(row => `${row[0]?.trim()?.toUpperCase()}-${row[1]?.trim()?.toUpperCase()}`));

    const candidatesWithStatus = filteredCandidates.map(row => {
      const name = row[4]?.trim()?.toUpperCase();
      const position = row[2]?.trim()?.toUpperCase();
      const isDisqualified = disqualifiedCandidates.has(`${name}-${position}`);
      return {
        id: row[0],
        item: row[1],
        position: row[2],
        assignment: row[3],
        name: row[4],
        gender: row[5],
        dob: row[6],
        age: row[7],
        isDisqualified
      };
    });

    apiManager.setCachedData(key, candidatesWithStatus);
    renderSecretariatTable(candidatesWithStatus);
  } catch (error) {
    console.error('Error fetching secretariat data:', error);
    showToast('error', 'Error', 'Failed to load secretariat data.');
  }
}

function renderSecretariatTable(candidates) {
  const tableContainer = document.getElementById('secretariatTableContainer');
  if (!tableContainer) {
    console.error('Secretariat table container not found.');
    return;
  }

  let tableHtml = '<div class="table-container overflow-x-auto shadow-md sm:rounded-lg">';
  if (candidates.length === 0) {
    tableHtml += '<p class="p-4 text-center text-gray-500">No candidates found for this item.</p>';
  } else {
    tableHtml += `
      <table class="w-full text-sm text-left text-gray-500">
        <thead class="text-xs text-gray-700 uppercase bg-gray-50">
          <tr>
            <th scope="col" class="px-6 py-3">#</th>
            <th scope="col" class="px-6 py-3">Item #</th>
            <th scope="col" class="px-6 py-3">Assignment</th>
            <th scope="col" class="px-6 py-3">Position</th>
            <th scope="col" class="px-6 py-3">Candidate</th>
            <th scope="col" class="px-6 py-3">Gender</th>
            <th scope="col" class="px-6 py-3">DOB</th>
            <th scope="col" class="px-6 py-3">Age</th>
            <th scope="col" class="px-6 py-3">Status</th>
            <th scope="col" class="px-6 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>
    `;
    candidates.forEach((candidate, index) => {
      const rowClass = candidate.isDisqualified ? 'bg-red-100' : 'bg-white';
      const statusText = candidate.isDisqualified ? 'Disqualified' : 'Qualified';
      const statusColor = candidate.isDisqualified ? 'text-red-600 font-bold' : 'text-green-600';
      const buttonHtml = candidate.isDisqualified ?
        `<button type="button" class="font-medium text-blue-600 hover:underline restore-btn" data-candidate-name="${candidate.name}" data-candidate-position="${candidate.position}">Restore</button>` :
        `<button type="button" class="font-medium text-red-600 hover:underline disqualify-btn" data-candidate-name="${candidate.name}" data-candidate-position="${candidate.position}">Disqualify</button>`;
      tableHtml += `
        <tr class="${rowClass} border-b hover:bg-gray-50">
          <td class="px-6 py-4">${index + 1}</td>
          <td class="px-6 py-4">${candidate.item}</td>
          <td class="px-6 py-4">${candidate.assignment}</td>
          <td class="px-6 py-4">${candidate.position}</td>
          <td class="px-6 py-4 font-medium text-gray-900">${candidate.name}</td>
          <td class="px-6 py-4">${candidate.gender}</td>
          <td class="px-6 py-4">${candidate.dob}</td>
          <td class="px-6 py-4">${candidate.age}</td>
          <td class="px-6 py-4 ${statusColor}">${statusText}</td>
          <td class="px-6 py-4">${buttonHtml}</td>
        </tr>
      `;
    });
    tableHtml += '</tbody></table>';
  }
  tableHtml += '</div>';
  tableContainer.innerHTML = tableHtml;
  attachSecretariatTableListeners();
}


function attachSecretariatTableListeners() {
  document.querySelectorAll('.disqualify-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
      const name = event.target.dataset.candidateName;
      const position = event.target.dataset.candidatePosition;
      await toggleCandidateStatus('disqualify', name, position);
    });
  });

  document.querySelectorAll('.restore-btn').forEach(button => {
    button.addEventListener('click', async (event) => {
      const name = event.target.dataset.candidateName;
      const position = event.target.dataset.candidatePosition;
      await toggleCandidateStatus('restore', name, position);
    });
  });
}

async function toggleCandidateStatus(action, candidateName, candidatePosition) {
  const currentItem = document.getElementById('secretariatItemDropdown').value;
  if (!currentItem) {
    showToast('error', 'Error', 'Please select an Item first.');
    return;
  }

  const payload = {
    action,
    candidateName,
    candidatePosition,
    itemNumber: currentItem,
    secretariatMemberId: secretariatMemberId
  };

  const token = gapi.client.getToken();
  if (!token || !token.access_token) {
    showToast('error', 'Error', 'Authentication token missing. Please sign in again.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/toggle-status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    showToast('success', 'Success', result.message);

    apiManager.clearCache(); // Clear cache to force a fresh fetch
    fetchSecretariatCandidates(currentItem); // Re-fetch and re-render the table
  } catch (error) {
    console.error('Error toggling candidate status:', error);
    showToast('error', 'Error', 'Failed to update candidate status.');
  }
}

// =====================================
// UI LOGIC (from 2.js, 1.js, 3.js)
// =====================================

function initializeTabs() {
  const raterTab = document.getElementById('raterTab');
  const secretariatTab = document.getElementById('secretariatTab');

  if (raterTab) {
    raterTab.addEventListener('click', () => switchTab('rater'));
  }
  if (secretariatTab) {
    secretariatTab.addEventListener('click', () => switchTab('secretariat'));
  }
}

function switchTab(tabName) {
  const raterContent = document.getElementById('raterContent');
  const secretariatContent = document.getElementById('secretariatContent');

  if (tabName === 'secretariat') {
    const isAuthenticated = localStorage.getItem('secretariatAuthenticated') === 'true';
    if (!isAuthenticated) {
      openSecretariatLoginModal();
      return;
    }
  }

  currentTab = tabName;
  localStorage.setItem('currentTab', tabName);

  if (tabName === 'rater') {
    elements.raterTab.classList.add('active');
    elements.secretariatTab.classList.remove('active');
    raterContent.classList.remove('hidden');
    secretariatContent.classList.add('hidden');
  } else {
    elements.raterTab.classList.remove('active');
    elements.secretariatTab.classList.add('active');
    raterContent.classList.add('hidden');
    secretariatContent.classList.remove('hidden');
    initializeSecretariatDropdowns();
  }
}

function openSecretariatLoginModal() {
  const modal = document.getElementById('secretariatLoginModal');
  if (modal) modal.style.display = 'block';
}

function closeSecretariatLoginModal() {
  const modal = document.getElementById('secretariatLoginModal');
  if (modal) modal.style.display = 'none';
}

async function handleSecretariatLogin() {
  const passwordInput = document.getElementById('secretariatPassword');
  const memberSelect = document.getElementById('secretariatMemberId');
  const password = passwordInput.value;
  const memberId = memberSelect.value;

  if (!memberId || !password) {
    showToast('error', 'Login Failed', 'Please select a member and enter a password.');
    return;
  }

  if (password !== SECRETARIAT_PASSWORD) {
    showToast('error', 'Login Failed', 'Incorrect password.');
    return;
  }

  secretariatMemberId = memberId;
  localStorage.setItem('secretariatAuthenticated', 'true');
  localStorage.setItem('secretariatMemberId', memberId);

  const authState = loadAuthState();
  if (authState) {
    saveAuthState(authState, authState.evaluator);
  }

  closeSecretariatLoginModal();
  switchTab('secretariat');
  showToast('success', 'Login Successful', 'Welcome to the Secretariat portal.');
  initializeSecretariatDropdowns();
}

function openLogoutAllModal() {
  elements.logoutAllModal.style.display = 'block';
}

function closeLogoutAllModal() {
  elements.logoutAllModal.style.display = 'none';
}

function handleLogoutAll() {
  const password = elements.logoutAllPassword.value;
  if (password === SECRETARIAT_PASSWORD) {
    clearLocalStorageAndLogout();
  } else {
    showToast('error', 'Error', 'Incorrect password for global logout.');
  }
}

function clearLocalStorageAndLogout() {
  localStorage.clear();
  window.location.reload();
}

function openSignatoriesModal() {
  elements.signatoriesModal.style.display = 'block';
  renderSignatories();
}

function closeSignatoriesModal() {
  elements.signatoriesModal.style.display = 'none';
}

async function handleAddSignatory() {
  const name = elements.newSignatoryName.value.trim();
  const position = elements.newSignatoryPosition.value.trim();
  const assignment = elements.newSignatoryAssignment.value.trim();

  if (!name || !position || !assignment) {
    showToast('error', 'Error', 'All fields are required.');
    return;
  }

  const payload = {
    name,
    position,
    assignment,
  };

  const token = gapi.client.getToken();
  if (!token || !token.access_token) {
    showToast('error', 'Error', 'Authentication token missing. Please sign in again.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/add-signatory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    showToast('success', 'Success', 'Signatory added successfully!');

    // Refresh signatories data
    apiManager.clearCache();
    await loadSheetData();
    renderSignatories();
    elements.newSignatoryName.value = '';
    elements.newSignatoryPosition.value = '';
    elements.newSignatoryAssignment.value = '';
  } catch (error) {
    console.error('Error adding signatory:', error);
    showToast('error', 'Error', 'Failed to add signatory.');
  }
}

async function handleDeleteSignatory(signatoryId) {
  if (!confirm('Are you sure you want to delete this signatory?')) {
    return;
  }

  const payload = {
    id: signatoryId,
  };

  const token = gapi.client.getToken();
  if (!token || !token.access_token) {
    showToast('error', 'Error', 'Authentication token missing. Please sign in again.');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/delete-signatory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token.access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Server error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    showToast('success', 'Success', 'Signatory deleted successfully!');

    apiManager.clearCache();
    await loadSheetData();
    renderSignatories();
  } catch (error) {
    console.error('Error deleting signatory:', error);
    showToast('error', 'Error', 'Failed to delete signatory.');
  }
}

function renderSignatories() {
  elements.signatoriesUl.innerHTML = '';
  if (SIGNATORIES.length === 0) {
    elements.signatoriesUl.innerHTML = '<p class="text-gray-500">No signatories added yet.</p>';
    return;
  }

  SIGNATORIES.forEach(sig => {
    const li = document.createElement('li');
    li.className = 'border-b last:border-b-0 py-2 flex justify-between items-center';
    li.innerHTML = `
      <span>${sig.name} (${sig.position}) - ${sig.assignment}</span>
      <button type="button" class="text-red-600 hover:text-red-800" data-id="${sig.id}">
        <i class="fas fa-trash"></i>
      </button>
    `;
    elements.signatoriesUl.appendChild(li);

    li.querySelector('button').addEventListener('click', () => handleDeleteSignatory(sig.id));
  });
}

function checkAndHideSpinner() {
  if (loadingState.gapi && loadingState.dom && loadingState.uiReady && loadingState.apiDone) {
    const spinner = document.getElementById('loadingSpinner');
    const pageWrapper = document.querySelector('.page-wrapper');
    if (spinner) {
      spinner.style.transition = 'opacity 0.4s ease';
      spinner.style.opacity = '0';
      setTimeout(() => {
        spinner.style.display = 'none';
        if (pageWrapper) {
          pageWrapper.style.opacity = '1';
        }
      }, 400);
    }

    if (uiObserver) uiObserver.disconnect();
    if (uiCheckTimeout) clearTimeout(uiCheckTimeout);
  }
}

function startUIMonitoring() {
  function checkUIContent() {
    const assignmentDropdown = document.getElementById('assignmentDropdown');
    const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
    const hasRaterData = !!(assignmentDropdown && assignmentDropdown.options && assignmentDropdown.options.length > 1);
    const hasSecretariatData = !!(secretariatAssignmentDropdown && secretariatAssignmentDropdown.options && secretariatAssignmentDropdown.options.length > 0);

    if (hasRaterData && hasSecretariatData) {
      loadingState.uiReady = true;
      checkAndHideSpinner();
      return true;
    }
    return false;
  }

  if (checkUIContent()) return;

  uiObserver = new MutationObserver(() => {
    checkUIContent();
  });

  uiObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true
  });

  const periodicCheck = () => {
    if (!loadingState.uiReady && !checkUIContent()) {
      uiCheckTimeout = setTimeout(periodicCheck, 500);
    }
  };
  periodicCheck();

  setTimeout(() => {
    if (!loadingState.uiReady) {
      loadingState.uiReady = true;
      checkAndHideSpinner();
    }
  }, 20000);
}

// =====================================
// INITIALIZATION
// =====================================

function initializeApp() {
  console.log('Initializing app...');
  gapi.load('client', async () => {
    await initializeGapiClient();
    loadingState.gapi = true;
    checkAndHideSpinner();
  });

  elements.signInBtn.addEventListener('click', handleAuthClick);
  elements.signOutBtn.addEventListener('click', signOut);
  elements.logoutAllBtn.addEventListener('click', openLogoutAllModal);
  elements.confirmLogoutAllBtn.addEventListener('click', handleLogoutAll);
  elements.closeLogoutAllModal.forEach(btn => btn.addEventListener('click', closeLogoutAllModal));

  elements.submitRatings.addEventListener('click', submitRatings);
  elements.generatePdfBtn.addEventListener('click', generatePdf);
  elements.manageSignatoriesBtn.addEventListener('click', openSignatoriesModal);
  elements.addSignatoryBtn.addEventListener('click', handleAddSignatory);
  elements.closeSignatoriesModalBtns.forEach(btn => btn.addEventListener('click', closeSignatoriesModal));

  document.getElementById('secretariatLoginBtn')?.addEventListener('click', handleSecretariatLogin);
  document.getElementById('closeSecretariatLoginModal')?.addEventListener('click', closeSecretariatLoginModal);

  elements.assignmentDropdown.addEventListener('change', () => {
    const selectedAssignment = elements.assignmentDropdown.value;
    const filteredPositions = [...new Set(vacancies.filter(row => row[2] === selectedAssignment).map(row => row[1]))].filter(Boolean);
    updateDropdown(elements.positionDropdown, filteredPositions, 'Select Position');
    updateDropdown(elements.itemDropdown, [], 'Select Item');
    updateDropdown(elements.nameDropdown, [], 'Select Candidate');
    elements.competencyContainer.innerHTML = '';
    saveDropdownState();
  });

  elements.positionDropdown.addEventListener('change', () => {
    const selectedAssignment = elements.assignmentDropdown.value;
    const selectedPosition = elements.positionDropdown.value;
    const filteredItems = vacancies
      .filter(row => row[2] === selectedAssignment && row[1] === selectedPosition)
      .map(row => row[0])
      .filter(Boolean);
    updateDropdown(elements.itemDropdown, filteredItems, 'Select Item');
    updateDropdown(elements.nameDropdown, [], 'Select Candidate');
    elements.competencyContainer.innerHTML = '';
    saveDropdownState();
  });

  elements.itemDropdown.addEventListener('change', () => {
    const selectedItem = elements.itemDropdown.value;
    const filteredCandidates = candidates
      .filter(row => row.item === selectedItem)
      .map(row => row.name)
      .filter(Boolean);
    updateDropdown(elements.nameDropdown, filteredCandidates, 'Select Candidate');
    elements.competencyContainer.innerHTML = '';
    saveDropdownState();
  });

  elements.nameDropdown.addEventListener('change', () => {
    const selectedName = elements.nameDropdown.value;
    if (selectedName) {
      elements.competencyContainer.innerHTML = '<p>Loading ratings...</p>';
      fetchSubmittedRatings();
    } else {
      elements.competencyContainer.innerHTML = '';
    }
    saveDropdownState();
  });

  restoreState();
  initializeTabs();
  startUIMonitoring();
}

// =====================================
// PDF GENERATION (from 3.js)
// =====================================

function generatePdf() {
  const selectedName = elements.nameDropdown.value;
  const selectedItem = elements.itemDropdown.value;

  if (!selectedName || !selectedItem) {
    showToast('error', 'Error', 'Please select a candidate and item first.');
    return;
  }

  const ratingsTable = document.getElementById('ratingsTable');
  if (!ratingsTable) {
    showToast('error', 'Error', 'No ratings table found to generate PDF.');
    return;
  }

  const tableHtml = ratingsTable.outerHTML;
  const ratings = getRatingsFromTable();
  const summary = generateSummary(ratings);

  const payload = {
    ratings: ratings,
    summary: summary,
    candidateInfo: getCandidateInfo(selectedName),
    signatures: getSignatures()
  };

  fetch(`${API_BASE_URL}/generate-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    .then(response => response.blob())
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = `${selectedName}_${selectedItem}_Evaluation.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
    })
    .catch(error => {
      console.error('Error generating PDF:', error);
      showToast('error', 'Error', 'Failed to generate PDF.');
    });
}

function getRatingsFromTable() {
  const ratings = {};
  const rows = document.querySelectorAll('#ratingsTable tbody tr');
  rows.forEach(row => {
    const competency = row.cells[0].textContent;
    const score = row.cells[1].textContent;
    ratings[competency] = score;
  });
  return ratings;
}

function generateSummary(ratings) {
  const totalScore = Object.values(ratings).reduce((sum, score) => {
    const parsed = parseInt(score);
    return isNaN(parsed) ? sum : sum + parsed;
  }, 0);
  const totalCompetencies = Object.keys(ratings).filter(c => ratings[c] !== 'N/A').length;
  const average = totalCompetencies > 0 ? (totalScore / totalCompetencies).toFixed(2) : 0;
  return `Total Score: ${totalScore}, Average: ${average}`;
}

function getCandidateInfo(name) {
  const candidate = candidates.find(c => c.name === name);
  return {
    name: candidate?.name,
    position: candidate?.position,
    assignment: candidate?.assignment,
    item: candidate?.item,
    // Add other relevant info
  };
}

function getSignatures() {
  const activeSignatoryId = localStorage.getItem('activeSignatory');
  const activeSignatory = SIGNATORIES.find(s => s.id === activeSignatoryId);
  return activeSignatory ? [{
    name: activeSignatory.name,
    position: activeSignatory.position
  }] : [];
}

// =====================================
// MISSING FUNCTION STUBS (To prevent "not defined" errors) (from 1.js)
// =====================================
// These are stubs for functions that might not be defined in your existing code
if (typeof parseSecretariatMembers === 'undefined') {
  window.parseSecretariatMembers = function(values) {
    console.log('parseSecretariatMembers stub called');
    if (!values || values.length <= 1) return [];

    const members = [];
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      if (row && row[0]) {
        members.push({
          id: row[0],
          name: row[1] || '',
          position: row[2] || '',
          vacancies: (row[3] || '').split(',').map(v => v.trim()).filter(Boolean)
        });
      }
    }
    return members;
  };
}

if (typeof parseVacanciesData === 'undefined') {
  window.parseVacanciesData = function(values) {
    console.log('parseVacanciesData stub called');
    return values || [];
  };
}

if (typeof matchesRatingRow === 'undefined') {
  window.matchesRatingRow = function(row, item, name, evaluator) {
    if (!row || row.length < 4) return false;

    // Adjust these indices based on your actual sheet structure
    const rowEvaluator = row[3]?.trim().toUpperCase();
    const rowItem = row[1]?.trim().toUpperCase();
    const rowName = row[0]?.trim().toUpperCase();

    const isMatch = rowEvaluator === evaluator.toUpperCase() &&
      rowItem === item.toUpperCase() &&
      rowName === name.toUpperCase();

    return isMatch;
  };
}

function initializeDropdowns(vacancies) {
  const assignments = [...new Set(vacancies.slice(1).map(row => row[2]))].filter(Boolean);
  updateDropdown(elements.assignmentDropdown, assignments, 'Select Assignment');
}
