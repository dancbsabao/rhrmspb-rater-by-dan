// Global variables
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

// 🔧 You had loadDropdownState defined twice. Keep ONE version only:
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

  const member = SECRETARIAT_MEMBERS.find(m => m.id === secretariatMemberId);
  if (!member) {
    console.warn('No secretariat member found for ID:', secretariatMemberId);
    // showToast('error', 'Error', 'No secretariat member found');
    return;
  }

  const allowedItems = member.vacancies.map(item => item.toUpperCase()); // Normalize to uppercase
  console.log('Allowed items for member:', allowedItems);

  // Log all vacancies for debugging
  console.log('All vacancies:', vacancies.slice(1).map(row => row[0]?.trim().toUpperCase()));

  const filteredVacancies = vacancies.slice(1).filter(row => {
    const itemNumber = row[0]?.trim().toUpperCase();
    const isAllowed = allowedItems.includes(itemNumber);
    console.log(`Checking item ${itemNumber}: ${isAllowed ? 'Allowed' : 'Not allowed'}`);
    return isAllowed;
  });

  if (filteredVacancies.length === 0) {
    console.warn('No matching vacancies found for member:', member);
    showToast('warning', 'Warning', 'No assigned vacancies available for this member');
    updateDropdown(assignmentDropdown, [], 'Select Assignment');
    updateDropdown(positionDropdown, [], 'Select Position');
    updateDropdown(itemDropdown, [], 'Select Item');
    return;
  }

  const uniqueAssignments = [...new Set(filteredVacancies.map(row => row[2]?.trim()))].filter(Boolean);
  console.log('Unique assignments for member:', uniqueAssignments);
  updateDropdown(assignmentDropdown, uniqueAssignments, 'Select Assignment');

  assignmentDropdown.removeEventListener('change', assignmentDropdown._changeHandler);
  assignmentDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    console.log('Assignment changed to:', selectedAssignment);
    const filteredPositions = [...new Set(
      filteredVacancies.filter(row => row[2]?.trim() === selectedAssignment).map(row => row[1]?.trim())
    )].filter(Boolean);
    console.log('Filtered positions:', filteredPositions);
    updateDropdown(positionDropdown, filteredPositions, 'Select Position');
    updateDropdown(itemDropdown, [], 'Select Item');
    saveDropdownState();
  };
  assignmentDropdown.addEventListener('change', assignmentDropdown._changeHandler);

  positionDropdown.removeEventListener('change', positionDropdown._changeHandler);
  positionDropdown._changeHandler = () => {
    const selectedAssignment = assignmentDropdown.value;
    const selectedPosition = positionDropdown.value;
    console.log('Position changed to:', selectedPosition);
    const filteredItems = filteredVacancies
      .filter(row => row[2]?.trim() === selectedAssignment && row[1]?.trim() === selectedPosition)
      .map(row => row[0]?.trim())
      .filter(Boolean);
    console.log('Filtered items:', filteredItems);
    updateDropdown(itemDropdown, filteredItems, 'Select Item');
    saveDropdownState();
  };
  positionDropdown.addEventListener('change', positionDropdown._changeHandler);

  itemDropdown.removeEventListener('change', itemDropdown._changeHandler);
  itemDropdown._changeHandler = () => {
    console.log('Item changed to:', itemDropdown.value);
    saveDropdownState();
    if (itemDropdown.value) {
      fetchSecretariatCandidates(itemDropdown.value);
    }
  };
  itemDropdown.addEventListener('change', itemDropdown._changeHandler);

  
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
      VACANCIES: 'VACANCIES!A:H',
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

function checkAndHideSpinner() {
  if (loadingState.gapi && loadingState.dom && loadingState.uiReady && loadingState.apiDone) {
    const spinner = document.getElementById('loadingSpinner');
    const pageWrapper = document.querySelector('.page-wrapper');

    console.log('✅ All loading complete - hiding spinner');

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
  console.log('Starting UI monitoring...');

  function checkUIContent() {
    const assignmentDropdown = document.getElementById('assignmentDropdown');
    const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');

    const hasRaterData = !!(assignmentDropdown && assignmentDropdown.options && assignmentDropdown.options.length > 1);
    const hasSecretariatData = !!(secretariatAssignmentDropdown && secretariatAssignmentDropdown.options && secretariatAssignmentDropdown.options.length > 0);

    if (hasRaterData && hasSecretariatData) {
      console.log('✅ UI data ready');
      loadingState.uiReady = true;
      checkAndHideSpinner();
      return true;
    }
    return false;
  }

  // First check right away
  if (checkUIContent()) return;

  uiObserver = new MutationObserver(() => {
    checkUIContent();
  });

  // Observe the document for changes — catches late-rendered elements
  uiObserver.observe(document.body, { childList: true, subtree: true, attributes: true });

  const periodicCheck = () => {
    if (!loadingState.uiReady && !checkUIContent()) {
      uiCheckTimeout = setTimeout(periodicCheck, 500);
    }
  };
  periodicCheck();

  setTimeout(() => {
    if (!loadingState.uiReady) {
      console.warn('⚠ UI monitoring timeout - marking as ready (fallback)');
      loadingState.uiReady = true;
      checkAndHideSpinner();
    }
  }, 20000); // 20s fallback
}


// ===========================
// ENHANCED LIVE API NOTIFIER (Fully Dynamic, Backward Compatible)
// ===========================
let apiNotifierEl = null;
let updateInterval = null;
let isMinimized = true;
let lastUpdateTime = null;

// Create or get the notifier element
function createApiNotifier() {
  if (!apiNotifierEl) {
    apiNotifierEl = document.createElement("div");
    apiNotifierEl.id = "apiNotifier";
    apiNotifierEl.style.position = "fixed";
    apiNotifierEl.style.bottom = "10px";
    apiNotifierEl.style.right = "10px";
    apiNotifierEl.style.padding = "12px 16px";
    apiNotifierEl.style.background = "linear-gradient(135deg, #2d3748, #4a5568)";
    apiNotifierEl.style.color = "white";
    apiNotifierEl.style.borderRadius = "12px";
    apiNotifierEl.style.boxShadow = "0 6px 20px rgba(0,0,0,0.3)";
    apiNotifierEl.style.fontSize = "13px";
    apiNotifierEl.style.fontFamily = "system-ui, -apple-system, sans-serif";
    apiNotifierEl.style.zIndex = "9999";
    apiNotifierEl.style.cursor = "pointer";
    apiNotifierEl.style.transition = "all 0.3s ease";
    apiNotifierEl.style.border = "1px solid rgba(255,255,255,0.1)";
    apiNotifierEl.style.backdropFilter = "blur(10px)";
    apiNotifierEl.style.userSelect = "none";
    
    // Click handler for minimize/expand
    apiNotifierEl.addEventListener('click', toggleMinimize);
    
    // Hover effects
    apiNotifierEl.addEventListener('mouseenter', () => {
      apiNotifierEl.style.transform = "translateY(-2px)";
      apiNotifierEl.style.boxShadow = "0 8px 25px rgba(0,0,0,0.4)";
    });
    
    apiNotifierEl.addEventListener('mouseleave', () => {
      apiNotifierEl.style.transform = "translateY(0)";
      apiNotifierEl.style.boxShadow = "0 6px 20px rgba(0,0,0,0.3)";
    });
    
    document.body.appendChild(apiNotifierEl);
  }

  function update(status) {
    const quotaRemaining = status.quota ?? "?";
    const resetTimeFormatted = status.resetTime ? new Date(status.resetTime).toLocaleString() : "?";
    const lastRequestFormatted = status.lastRequest ? new Date(status.lastRequest).toLocaleTimeString() : "?";
    const connectionStatus = getConnectionStatus(status);
    const quotaDisplay = getQuotaDisplay(status);
    
    lastUpdateTime = new Date();
    
    if (isMinimized) {
      apiNotifierEl.innerHTML = `
        <div style="font-weight:bold; font-size:12px;">
          ${connectionStatus.icon} API ${connectionStatus.short}
          <span style="opacity:0.7; margin-left:8px;">↗️</span>
        </div>
      `;
      apiNotifierEl.style.padding = "8px 12px";
    } else {
      apiNotifierEl.innerHTML = `
        <div style="font-weight:bold; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
          <span>${connectionStatus.icon} API Status: ${connectionStatus.text}</span>
          <span style="opacity:0.6; font-size:11px; cursor:pointer;">↙️</span>
        </div>
        <div style="display:grid; grid-template-columns:auto 1fr; gap:8px 12px; font-size:12px;">
          <span style="opacity:0.8;"><strong>Device:</strong></span>
          <span>${status.deviceId || "N/A"}</span>
          
          <span style="opacity:0.8;"><strong>Quota:</strong></span>
          <span>${quotaDisplay}</span>
          
          <span style="opacity:0.8;"><strong>Reset:</strong></span>
          <span>${resetTimeFormatted}</span>
          
          <span style="opacity:0.8;"><strong>Last Request:</strong></span>
          <span>${lastRequestFormatted}</span>
        </div>
        ${status.message ? `<div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.2); border-radius:6px; font-size:11px; opacity:0.9;">${status.message}</div>` : ''}
        <div style="margin-top:6px; font-size:10px; opacity:0.5; text-align:center;">
          Updated: ${lastUpdateTime.toLocaleTimeString()}
        </div>
      `;
      apiNotifierEl.style.padding = "12px 16px";
    }
  }

  return { update };
}

// Helper functions for status display
function getConnectionStatus(status) {
  if (!status.ready) {
    return { icon: "🔴", text: "NOT READY ❌", short: "DOWN" };
  }
  
  if (status.isExceeded) {
    return { icon: "⚠️", text: "QUOTA EXCEEDED ⚠️", short: "LIMIT" };
  }
  
  if (status.hasError) {
    return { icon: "🟡", text: "WARNING ⚠️", short: "WARN" };
  }
  
  return { icon: "🟢", text: "READY ✅", short: "OK" };
}

function getQuotaDisplay(status) {
  if (status.isExceeded) {
    return "⚠️ EXCEEDED";
  }
  
  if (typeof status.requestsToday === 'number' && status.quotaLimit) {
    const remaining = status.quotaLimit - status.requestsToday;
    const percentage = Math.round((remaining / status.quotaLimit) * 100);
    return `${remaining} left (${percentage}%)`;
  }
  
  return status.quota || "Unknown";
}

// Toggle minimize/expand
function toggleMinimize() {
  isMinimized = !isMinimized;
  // Trigger immediate update to refresh display
  liveUpdateNotifier();
}

// ✅ Backward compatibility shim
function updateApiNotifier(status, message, extra = {}) {
  const apiNotifier = createApiNotifier();
  apiNotifier.update({
    ready: status === "ready",
    deviceId: extra.deviceId,
    quota: extra.quota ?? "?",
    quotaLimit: extra.quotaLimit,
    requestsToday: extra.requestsToday,
    resetTime: extra.resetTime ?? null,
    lastRequest: extra.lastRequest ?? null,
    isExceeded: extra.isExceeded ?? false,
    hasError: extra.hasError ?? false,
    message: message || "",
  });
}

// ===========================
// Fetch live device info from apiManager
// ===========================
async function fetchDeviceInfo() {
  try {
    // Check if apiManager exists
    if (typeof apiManager === 'undefined') {
      return {
        requestsToday: "?",
        isExceeded: false,
        activeDevices: "?",
        quotaResetTime: null,
        lastQuotaError: "API Manager not found",
        lastRequestTime: Date.now(),
        deviceId: "unknown_device",
        hasError: true
      };
    }

    const metrics = apiManager.getMetrics();
    const globalQuota = metrics.globalQuotaState || {};
    
    return {
      requestsToday: globalQuota.requestsToday ?? 0,
      quotaLimit: globalQuota.quotaLimit ?? 100, // Assume default limit
      isExceeded: !!globalQuota.quotaExceededAt,
      activeDevices: metrics.activeDevices ?? 1,
      quotaResetTime: globalQuota.quotaResetTime ?? (Date.now() + 3600000),
      lastQuotaError: globalQuota.lastQuotaError ?? null,
      lastRequestTime: Date.now(),
      deviceId: metrics.deviceId ?? "unknown_device",
      hasError: false
    };
  } catch (err) {
    console.error("❌ Failed to fetch device info:", err);
    return {
      requestsToday: "?",
      quotaLimit: null,
      isExceeded: false,
      activeDevices: "?",
      quotaResetTime: null,
      lastQuotaError: err.message,
      lastRequestTime: Date.now(),
      deviceId: "error_device",
      hasError: true
    };
  }
}

// ===========================
// Live auto-update with smart intervals
// ===========================
async function liveUpdateNotifier() {
  // Skip update if page is hidden (performance optimization)
  if (document.hidden) return;
  
  const info = await fetchDeviceInfo();
  const apiNotifier = createApiNotifier();
  
  let message = "";
  if (info.hasError && info.lastQuotaError) {
    message = `⚠️ ${info.lastQuotaError}`;
  } else if (info.isExceeded) {
    message = `🚫 Quota exceeded. Resets at ${new Date(info.quotaResetTime).toLocaleTimeString()}`;
  }
  
  apiNotifier.update({
    ready: !info.hasError && !info.isExceeded,
    deviceId: info.deviceId,
    quota: info.requestsToday >= 0 ? `${info.requestsToday}/${info.quotaLimit || '?'}` : "?",
    quotaLimit: info.quotaLimit,
    requestsToday: info.requestsToday,
    resetTime: info.quotaResetTime,
    lastRequest: info.lastRequestTime,
    isExceeded: info.isExceeded,
    hasError: info.hasError,
    message: message
  });
}

// ===========================
// Lifecycle management
// ===========================
function startLiveUpdates() {
  if (updateInterval) return; // Already running
  
  liveUpdateNotifier(); // Initial call
  updateInterval = setInterval(liveUpdateNotifier, 5000);
  
  // Pause updates when page is hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      liveUpdateNotifier(); // Immediate update when tab becomes visible
    }
  });
  
  console.log("🔔 API Notifier started");
}

function stopLiveUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
    console.log("🔔 API Notifier stopped");
  }
}

function removeNotifier() {
  stopLiveUpdates();
  if (apiNotifierEl) {
    apiNotifierEl.remove();
    apiNotifierEl = null;
  }
}

// ===========================
// Initialization integration
// ===========================
async function initializeApiNotifier() {
  try {
    console.log('🔔 Initializing API Notifier...');
    
    // Wait for apiManager to be available before starting
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds maximum wait
    
    while (typeof apiManager === 'undefined' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    if (typeof apiManager === 'undefined') {
      console.warn('⚠️ API Manager not found after 5s, starting notifier anyway...');
    }
    
    // Start the live updates
    startLiveUpdates();
    console.log('✅ API Notifier initialized successfully');
    
    return true;
  } catch (error) {
    console.error('❌ API Notifier initialization failed:', error);
    return false;
  }
}

// ===========================
// Auto-start and cleanup
// ===========================

// Cleanup on page unload
window.addEventListener('beforeunload', stopLiveUpdates);

// Export functions for manual control
window.apiNotifierControl = {
  init: initializeApiNotifier,
  start: startLiveUpdates,
  stop: stopLiveUpdates,
  remove: removeNotifier,
  toggle: toggleMinimize,
  update: liveUpdateNotifier,
  isRunning: () => updateInterval !== null
};











// ============================================================================
//
//      SIMPLIFIED SEQUENTIAL API MANAGER
//      Simplified version keeping original function names
//
// ============================================================================

class BulletproofAPIManager {
  constructor(options = {}) {
    this.config = {
      baseDelay: options.baseDelay || 3000,
      maxRetries: options.maxRetries || 3,
    };

    this.deviceId = this._generateDeviceId();
    this.cache = new Map();
    this.requestQueue = new Map();
    this.isLoading = false;
    this.retryQueue = [];
    this.retryTimer = null;
    
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      cacheHits: 0,
      deviceId: this.deviceId,
    };
  }

  async init() {
    updateApiNotifier("loading", "Starting up...");
    try {
      console.log(`BulletproofAPIManager Initialized. Device ID: ${this.deviceId}`);
      updateApiNotifier("ready", `Device ${this.deviceId}`);
    } catch (err) {
      console.error("Init failed:", err);
      updateApiNotifier("error", err.message);
    }
  }

  /**
   * Simplified bulletproof fetch - just cache and retry logic
   */
  async bulletproofFetch(key, fetchFunction, options = {}) {
    this.metrics.totalRequests++;

    // Check cache first
    const cachedData = this._getCachedData(key);
    if (cachedData && !options.forceRefresh) {
      this.metrics.cacheHits++;
      return cachedData;
    }

    // Coalesce concurrent requests
    if (this.requestQueue.has(key)) {
      console.log(`Waiting for existing request: "${key}"`);
      return this.requestQueue.get(key);
    }

    const requestPromise = this._executeWithRetry(key, fetchFunction, options);
    this.requestQueue.set(key, requestPromise);

    try {
      return await requestPromise;
    } finally {
      this.requestQueue.delete(key);
    }
  }

  /**
   * Sequential batch fetch - loads items one by one
   */
  async batchFetch(requests, options = {}) {
    console.log(`Starting sequential batch fetch for ${requests.length} items.`);
    
    const results = [];
    const errors = [];

    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];
      
      updateApiNotifier("loading", `Loading ${request.key}... (${i + 1}/${requests.length})`);
      console.log(`Loading ${request.key}...`);

      try {
        const result = await this.bulletproofFetch(request.key, request.fetchFunction, request.options);
        results.push({ key: request.key, data: result, success: true });
        console.log(`Successfully loaded ${request.key}`);
        
        // Small delay between requests
        if (i < requests.length - 1) {
          await this._wait(1000);
        }
      } catch (error) {
        console.error(`Failed to load ${request.key}:`, error.message);
        errors.push({ key: request.key, error: error.message, success: false });
        
        // Add to retry queue if no cache available
        const cachedData = this._getCachedData(request.key);
        if (!cachedData) {
          console.log(`Adding ${request.key} to retry queue`);
          this.retryQueue.push(request);
        }
      }
    }

    if (this.retryQueue.length > 0) {
      console.log(`${this.retryQueue.length} items will retry in 1 minute`);
      this._scheduleRetry();
    }

    console.log(`Sequential batch complete: ${results.length} successful, ${errors.length} failed.`);
    return { results, errors, metrics: this.getMetrics() };
  }

  getMetrics() {
    return {
      ...this.metrics,
      cacheSize: this.cache.size,
      activeRequests: this.requestQueue.size,
      retryQueueSize: this.retryQueue.length,
    };
  }

  clearCache() {
    this.cache.clear();
    this.retryQueue = [];
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    console.log('Cache cleared.');
  }

  cleanup() {
    this.clearCache();
    console.log(`Device ${this.deviceId} cleaned up.`);
  }

  // ========================================================================
  // PRIVATE METHODS
  // ========================================================================

  async _executeWithRetry(key, fetchFunction, options) {
    let lastError = null;
    const maxRetries = options.maxRetries ?? this.config.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt + 1}/${maxRetries + 1} for "${key}"`);
        const result = await fetchFunction();

        this.metrics.successfulRequests++;
        this._setCachedData(key, result);
        console.log(`Successfully fetched "${key}"`);
        return result;

      } catch (error) {
        lastError = error;
        this.metrics.failedRequests++;
        console.error(`Attempt ${attempt + 1} failed for "${key}": ${error.message}`);

        if (attempt === maxRetries) {
          break;
        }

        const delay = this.config.baseDelay * (attempt + 1);
        console.log(`Waiting ${Math.round(delay/1000)}s before retry for "${key}"...`);
        await this._wait(delay);
      }
    }

    // Try to return cached data if available
    const staleData = this._getCachedData(key);
    if (staleData) {
      console.warn(`All retries failed for "${key}". Returning cached data.`);
      return staleData;
    }

    throw new Error(`All retry attempts failed for "${key}". Last error: ${lastError?.message || 'Unknown error'}`);
  }

  _getCachedData(key) {
    const cached = this.cache.get(key);
    return cached ? cached.data : null;
  }

  _setCachedData(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    console.log(`Cached data for: ${key}`);
  }

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _generateDeviceId() {
    const storedId = localStorage.getItem('device_id');
    if (storedId) return storedId;
    const newId = `device_${Math.random().toString(36).substring(2, 11)}_${Date.now()}`;
    localStorage.setItem('device_id', newId);
    return newId;
  }

  _scheduleRetry() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }

    this.retryTimer = setTimeout(async () => {
      if (this.retryQueue.length === 0) return;

      console.log(`Retrying ${this.retryQueue.length} failed requests`);
      updateApiNotifier("loading", "Retrying failed requests...");

      const failedRequests = [...this.retryQueue];
      this.retryQueue = [];

      for (const request of failedRequests) {
        try {
          console.log(`Retrying ${request.key}...`);
          const result = await this.bulletproofFetch(request.key, request.fetchFunction, request.options);
          console.log(`Successfully retried ${request.key}`);
        } catch (error) {
          console.error(`Retry failed for ${request.key}:`, error.message);
          this.retryQueue.push(request);
        }
        
        await this._wait(2000);
      }

      if (this.retryQueue.length > 0) {
        console.log(`${this.retryQueue.length} items still failed, scheduling another retry`);
        this._scheduleRetry();
      } else {
        console.log("All retries completed successfully");
        updateApiNotifier("success", "All data loaded after retry");
      }
    }, 60000); // 1 minute retry delay
  }
}

// ============================================================================
// SINGLETON INSTANCE & EXISTING WRAPPERS
// ============================================================================

const apiManager = new BulletproofAPIManager({
  baseDelay: 3000,
  maxRetries: 3,
});

// Keep existing wrapper functions
async function safeFetchSecretariatMembers() {
  // Skip as requested - secretariat data is not a priority
  console.log('Skipping secretariat members (not priority)');
  return null;
}

async function safeFetchVacanciesData() {
  return apiManager.bulletproofFetch('vacanciesData', fetchVacanciesData, {
    cacheTTL: 30 * 60 * 1000,
  });
}

async function safeLoadSignatories() {
  // Skip as requested - signatory data is not a priority
  console.log('Skipping signatories (not priority)');
  return null;
}

async function safeFetchRatings({ name, item, evaluator, forceRefresh = false }) {
  if (!name || !item || !evaluator) {
    throw new Error('Missing required parameters: name, item, and evaluator are all required.');
  }

  const key = `rating:${evaluator}:${item}:${name}`;

  const fetchFunction = async () => {
    if (!await isTokenValid()) await refreshAccessToken();

    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.RATELOG,
    });

    const values = response?.result?.values || [];
    if (values.length === 0) return { values: [], ts: Date.now() };

    const header = values[0];
    const dataRows = values.slice(1);
    const matchingRows = dataRows.filter(row => matchesRatingRow(row, item, name, evaluator));

    console.log(`Found ${matchingRows.length} rating rows for:`, { evaluator, item, name });

    return { values: [header, ...matchingRows], ts: Date.now() };
  };

  return apiManager.bulletproofFetch(key, fetchFunction, {
    forceRefresh,
  });
}

// Keep existing pending ratings manager
const pendingRatingsManager = {
  _getKey: (evaluator, item, name) => `pending_rating:${apiManager.deviceId}:${evaluator}:${item}:${name}`,

  save(evaluator, item, name, ratingData) {
    const key = this._getKey(evaluator, item, name);
    const data = { ...ratingData, evaluator, item, name, timestamp: Date.now() };
    try {
      localStorage.setItem(key, JSON.stringify(data));
      console.log(`Saved pending rating for "${name}" on item "${item}".`);
    } catch (e) {
      console.warn('Failed to save pending rating to localStorage:', e);
    }
  },

  get(evaluator, item, name) {
    const key = this._getKey(evaluator, item, name);
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return null;

      const pending = JSON.parse(stored);
      if (Date.now() - pending.timestamp < 5 * 60 * 1000) {
        console.log(`Restored pending rating for "${name}" on item "${item}".`);
        return pending;
      } else {
        localStorage.removeItem(key);
        return null;
      }
    } catch (e) {
      console.warn('Failed to restore pending rating:', e);
      return null;
    }
  },

  clear(evaluator, item, name) {
    const key = this._getKey(evaluator, item, name);
    try {
      localStorage.removeItem(key);
      console.log(`Cleared pending rating for "${name}" on item "${item}".`);
    } catch (e) {
      console.warn('Failed to clear pending rating from localStorage:', e);
    }
  }
};

// ============================================================================
// SIMPLIFIED INITIALIZATION - KEEPING ORIGINAL FUNCTION NAMES
// ============================================================================

let appInitializationPromise = null;

async function initializeApp() {
  if (appInitializationPromise) {
    console.warn("Initialization already in progress. Waiting for it to complete...");
    return appInitializationPromise;
  }

  appInitializationPromise = (async () => {
    showSpinner(true);

    try {
      // 1. Initialize API Manager
      await apiManager.init();

      // 2. Initialize API Notifier
      await initializeApiNotifier();

      // 3. Load GAPI client
      await new Promise((resolve, reject) => {
        gapi.load('client', async () => {
          try {
            await initializeGapiClient();
            console.log('GAPI client initialized successfully.');
            resolve();
          } catch (gapiError) {
            reject(gapiError);
          }
        });
      });

      // 4. Setup UI
      setupUI();

      // 5. Load initial data sequentially (not immediately from cache)
      await loadInitialData();

      // 6. Finalize initialization
      finishInitialization();
      console.log("Application initialized successfully.");

      updateApiNotifier("success", "App initialized successfully.");

    } catch (error) {
      console.error('Application initialization failed:', error);
      updateApiNotifier("error", `Initialization failed: ${error.message}`);
      handleInitializationFailure(error);
      throw error;

    } finally {
      showSpinner(false);
      appInitializationPromise = null;
    }
  })();

  return appInitializationPromise;
}

/**
 * SIMPLIFIED - Load data sequentially, not from cache first
 */
async function loadInitialData() {
  console.log('Starting sequential initial data load...');

  const apiRequests = [
    { key: 'vacanciesData', fetchFunction: () => safeFetchVacanciesData(), priority: 2, required: true },
    // Secretariat and signatory data ignored as requested
  ];

  console.log(`Loading ${apiRequests.length} data sources sequentially`);

  const result = await apiManager.batchFetch(apiRequests);
  
  if (result.errors.length > 0) {
    const criticalErrors = result.errors.filter(err =>
      apiRequests.find(req => req.key === err.key)?.required
    );

    if (criticalErrors.length > 0) {
      console.error('Critical API failures detected:', criticalErrors);
      handleCriticalAPIFailure(criticalErrors);
    }
  } else {
    console.log('Initial data load complete.');
  }
}

function setupUI() {
  if (typeof createEvaluatorSelector === 'function') createEvaluatorSelector();
  if (typeof setupTabNavigation === 'function') setupTabNavigation();
}

function finishInitialization() {
  if (typeof startUIMonitoring === 'function') startUIMonitoring();
  if (typeof restoreState === 'function') restoreState();

  if (window.elements) {
    elements.generatePdfBtn?.addEventListener('click', generatePdfSummary);
    elements.manageSignatoriesBtn?.addEventListener('click', manageSignatories);
    elements.closeSignatoriesModalBtns?.forEach?.(button =>
      button.addEventListener('click', () => {
        elements.signatoriesModal?.classList?.remove('active');
      })
    );
    elements.addSignatoryBtn?.addEventListener('click', addSignatory);
  }

  showSpinner(false);
  console.log('App initialization complete.');
  console.log('Final Metrics:', apiManager.getMetrics());
}

function handleCriticalAPIFailure(errors) {
  console.warn('Handling critical API failures... App may be degraded.');
  for (const error of errors) {
    const staleData = apiManager._getCachedData(error.key);
    if (staleData) {
      console.log(`Using cached data for critical data: "${error.key}"`);
    }
  }
  showErrorNotification(
    'Some data is temporarily unavailable. The app is using cached data where possible.'
  );
}

function handleInitializationFailure(error) {
  console.error('Handling complete initialization failure...');
  showSpinner(false);
  showErrorNotification(
    `Unable to load data: ${error.message}. Please check your connection and refresh.`
  );
}

function showSpinner(show) {
  const spinner = document.getElementById('loadingSpinner');
  const pageWrapper = document.querySelector('.page-wrapper');
  if (spinner) spinner.style.opacity = show ? '1' : '0';
  if (pageWrapper) pageWrapper.style.opacity = show ? '0.3' : '1';
  if (!show && spinner) setTimeout(() => spinner.style.display = 'none', 300);
}

function showErrorNotification(message) {
  console.error('User Notification:', message);
  if (typeof alert === 'function') alert(message);
}

// Keep all existing auth/token functions unchanged
async function initializeGapiClient() {
  try {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    });

    const authState = JSON.parse(localStorage.getItem('authState'));

    if (authState?.access_token) {
      gapi.client.setToken({ access_token: authState.access_token });
      console.log('Loaded token from localStorage into GAPI client.');

      if (!await isTokenValid()) {
        console.log('Token validation failed after loading, will attempt refresh.');
      } else {
        console.log('Loaded token is valid.');
      }
    } else {
      console.log('No saved token found in localStorage.');
    }

    window.gapiInitialized = true;
    console.log('GAPI client initialization sequence complete.');

  } catch (error) {
    console.error('Error initializing GAPI client:', error);
  }
}

async function isTokenValid() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.access_token || !authState?.expires_at) {
    return false;
  }

  const timeLeft = authState.expires_at - Date.now();
  if (timeLeft <= 300000) {
    console.log('Token is expired or expiring soon, attempting refresh.');
    return await refreshAccessToken();
  }

  return true;
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
          if (typeof showToast === 'function') showToast('error', 'Session Expired', 'No refresh token found. Please sign in again.');
          authState.access_token = null;
          localStorage.setItem('authState', JSON.stringify(authState));
          if (typeof handleAuthClick === 'function') handleAuthClick();
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
        if (typeof showToast === 'function') showToast('warning', 'Session Issue', 'Unable to refresh session, please sign in again.');
        authState.access_token = null;
        localStorage.setItem('authState', JSON.stringify(authState));
        if (typeof handleAuthClick === 'function') handleAuthClick();
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1)));
    }
  }
  return false;
}

function scheduleTokenRefresh(maxRetries = 5) {
  if (window.refreshTimer) clearTimeout(window.refreshTimer);

  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.expires_at || !authState.session_id) {
    console.log('No valid auth state for scheduling refresh');
    return;
  }

  const timeToExpiry = authState.expires_at - Date.now();
  const refreshInterval = Math.max(300000, timeToExpiry - 900000);

  let retryCount = 0;

  window.refreshTimer = setTimeout(async function refresh() {
    console.log(`Scheduled token refresh triggered (retry ${retryCount + 1})`);
    const success = await refreshAccessToken();
    if (!success) {
      retryCount++;
      if (retryCount < maxRetries) {
        console.warn(`Refresh failed, retrying in 1 minute (attempt ${retryCount + 1}/${maxRetries})`);
        window.refreshTimer = setTimeout(refresh, 60000);
      } else {
        console.error('Max refresh retries reached, prompting re-authentication');
        if (typeof showToast === 'function') showToast('error', 'Session Expired', 'Please sign in again.');
        if (typeof handleAuthClick === 'function') handleAuthClick();
      }
    }
  }, refreshInterval);

  console.log(`Token refresh scheduled in ${Math.round(refreshInterval / 60000)} minutes`);
}

function handleTokenCallback(tokenResponse) {
  if (tokenResponse.error) {
    console.error('Token error:', tokenResponse.error);
    if (window.elements?.authStatus) elements.authStatus.textContent = 'Error during sign-in';
  } else {
    if (typeof saveAuthState === 'function') saveAuthState(tokenResponse, window.currentEvaluator);
    gapi.client.setToken({ access_token: tokenResponse.access_token });
    if (typeof updateUI === 'function') updateUI(true);
    fetch(`${API_BASE_URL}/config`, { credentials: 'include' })
      .then(() => {
        if (typeof createEvaluatorSelector === 'function') createEvaluatorSelector();
        if (typeof loadSheetData === 'function') loadSheetData();
        if (typeof showToast === 'function') showToast('success', 'Welcome!', 'Successfully signed in.');
        localStorage.setItem('hasWelcomed', 'true');
      });
  }
}

// Lifecycle hooks
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    console.log('Tab visible - checking state.');
  }
});

window.addEventListener('beforeunload', () => {
  apiManager.cleanup();
});












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
  secretariatTab.addEventListener('click', async () => {
    await fetchSecretariatMembers();
    showModal(
      'Secretariat Authentication',
      `
        <p>Select Secretariat Member:</p>
        <select id="secretariatMemberId" class="modal-input">
          <option value="">Select Member</option>
          ${SECRETARIAT_MEMBERS.map(member => `<option value="${member.id}">${member.name}</option>`).join('')}
        </select>
        <p>Enter Password:</p>
        <input type="password" id="secretariatPassword" class="modal-input">
        <button id="addMemberBtn" class="modal-btn">Add New Member</button>
      `,
      async () => {
        const memberId = document.getElementById('secretariatMemberId').value;
        const password = document.getElementById('secretariatPassword').value.trim();
        const member = SECRETARIAT_MEMBERS.find(m => m.id === memberId);
        if (member && password === member.password) {
            secretariatMemberId = memberId;
            localStorage.setItem('secretariatAuthenticated', 'true');
            localStorage.setItem('currentTab', 'secretariat');
            localStorage.setItem('secretariatMemberName', member.name); // Ensure member.name is stored
            saveAuthState(gapi.client.getToken(), currentEvaluator);
            switchTab('secretariat');
            showToast('success', 'Success', `Logged in as ${member.name}`);
            //setTimeout(() => location.reload(), 1000);
        } else {
          showToast('error', 'Error', 'Incorrect credentials');
        }
      },
      () => console.log('Secretariat authentication canceled')
    );

    document.getElementById('addMemberBtn').addEventListener('click', () => {
      showModal(
        'Add New Secretariat Member',
        `
          <p>Member Name:</p>
          <input type="text" id="newMemberName" class="modal-input">
          <p>Password:</p>
          <input type="password" id="newMemberPassword" class="modal-input">
          <p>Assigned Vacancies (Item Numbers, comma-separated):</p>
          <input type="text" id="newMemberVacancies" class="modal-input" placeholder="e.g., OSEC-DENRB-DMO5-72-2014,OSEC-DENRB-CENRO-130-1998">
        `,
        async () => {
          const name = document.getElementById('newMemberName').value.trim();
          const password = document.getElementById('newMemberPassword').value.trim();
          const memberVacancies = document.getElementById('newMemberVacancies').value.split(',').map(v => v.trim().toUpperCase()).filter(v => v);
          if (!name || !password || !vacancies.length) {
            showToast('error', 'Error', 'All fields are required');
            return;
          }
          const id = Date.now().toString();
          await saveSecretariatMember({ id, name, password, vacancies: memberVacancies }); // Use memberVacancies here
          showToast('success', 'Success', 'Member added successfully');
        }
      );
    });
  });
}


function switchTab(tab) {
  currentTab = tab;
  localStorage.setItem('currentTab', tab);

  if (tab === 'rater') {
    localStorage.removeItem('secretariatAuthenticated');
    secretariatMemberId = null;
  
    if (gapi?.client?.getToken) {
      saveAuthState(gapi.client.getToken(), currentEvaluator);
    } else {
      console.warn('GAPI not ready — skipping saveAuthState in switchTab');
    }
  
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
        range: 'CANDIDATES!A:S', // Includes column S for 'For Review' status
      }),
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'DISQUALIFIED!A:F', // Includes column F for 'For Review' status
      }),
    ]);

    const candidatesData = generalResponse.result.values || [];
    const candidatesSheet = candidatesResponse.result.values || [];
    const disqualifiedSheet = disqualifiedResponse.result.values || [];

    // Map submissions by name, item number, and member ID
    const submissions = new Map();
    candidatesSheet.forEach(row => {
      if (row[0] && row[1] && row[16]) {
        submissions.set(`${row[0]}|${row[1]}|${row[16]}`, { 
          status: 'CANDIDATES', 
          comment: row[17] || '',
          forReview: row[18] === 'TRUE' 
        });
      }
    });
    disqualifiedSheet.forEach(row => {
      if (row[0] && row[1] && row[4]) {
        submissions.set(`${row[0]}|${row[1]}|${row[4]}`, { 
          status: 'DISQUALIFIED', 
          comment: row[3] || '',
          forReview: row[5] === 'TRUE'
        });
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

  // ADD THIS: Create vacancy details container
const vacancyDiv = document.createElement('div');
vacancyDiv.className = 'vacancy-details';

const vacancyData = getVacancyDetails(itemNumber);

vacancyDiv.innerHTML = `
  <div class="vacancy-container">
    <h3>Vacancy Details</h3>
    <div class="vacancy-item">
      <span class="vacancy-label">Education:</span>
      <span class="vacancy-value">${vacancyData.education}</span>
    </div>
    <div class="vacancy-item">
      <span class="vacancy-label">Training:</span>
      <span class="vacancy-value">${vacancyData.training}</span>
    </div>
    <div class="vacancy-item">
      <span class="vacancy-label">Experience:</span>
      <span class="vacancy-value">${vacancyData.experience}</span>
    </div>
    <div class="vacancy-item">
      <span class="vacancy-label">Eligibility:</span>
      <span class="vacancy-value">${vacancyData.eligibility}</span>
    </div>
  </div>
`;
container.appendChild(vacancyDiv);

  

  // Calculate summary counts
  const longListCount = candidates.filter(c => c.submitted?.status === 'CANDIDATES').length;
  const disqualifiedCount = candidates.filter(c => c.submitted?.status === 'DISQUALIFIED').length;
  const forReviewCount = candidates.filter(c => c.submitted?.forReview).length;

  // Create professional summary div
  const summaryDiv = document.createElement('div');
  summaryDiv.className = 'candidate-summary';
  summaryDiv.innerHTML = `
    <div class="summary-container">
      <h3>Candidate Status Summary</h3>
      <div class="summary-item">
        <span class="summary-label">Candidates for Long List:</span>
        <span class="summary-value">${longListCount}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">Candidates for Disqualification:</span>
        <span class="summary-value">${disqualifiedCount}</span>
      </div>
      <div class="summary-item">
        <span class="summary-label">For Review of the Board:</span>
        <span class="summary-value">${forReviewCount}</span>
      </div>
    </div>
  `;
  container.appendChild(summaryDiv);

  // Create filter div
  const filterDiv = document.createElement('div');
  filterDiv.innerHTML = `
    <label for="statusFilter">Filter by Status: </label>
    <select id="statusFilter" onchange="filterTableByStatus(this.value, '${itemNumber}')">
      <option value="">All Statuses</option>
      <option value="not-submitted">Not Submitted</option>
      <option value="CANDIDATES">Submitted (CANDIDATES)</option>
      <option value="DISQUALIFIED">Submitted (DISQUALIFIED)</option>
      <option value="for-review">For Review of the Board</option>
    </select>
    <button id="viewAssignmentsBtn" class="modal-btn">View Member Assignments</button>
  `;
  container.appendChild(filterDiv);

  document.getElementById('viewAssignmentsBtn').addEventListener('click', () => {
    const assignmentsHTML = `
      <div class="modal-body">
        <h4>Secretariat Member Assignments</h4>
        ${SECRETARIAT_MEMBERS.map(member => `
          <div class="modal-field">
            <span class="modal-label">${member.name} (ID: ${member.id}):</span>
            <span class="modal-value">${member.vacancies.join(', ') || 'None'}</span>
          </div>
        `).join('')}
      </div>
    `;
    showModal('Member Assignments', assignmentsHTML, null, null, false);
  });

  if (candidates.length > 0) {
    const table = document.createElement('table');
    table.className = 'secretariat-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>#</th>
        <th>Name</th>
        <th>Documents</th>
        <th>Status</th>
        <th>Comments</th>
        <th>Action</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    candidates.forEach((candidate, index) => {
      const row = candidate.data;
      const name = row[0];
      const sex = row[2];
      const tr = document.createElement('tr');
      const documentLinks = [
        { label: 'Professional License', url: row[6] },
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
          return `<button type="button" class="open-link-button" onclick="event.preventDefault(); event.stopPropagation(); window.open('${link.url}', '_blank')">${link.label}</button>`;
        }
        return `<button type="button" class="open-link-button" disabled>${link.label}</button>`;
      })
      .join('');

      
      let submittedStatus = '';
      if (candidate.submitted) {
        submittedStatus = `<span class="submitted-indicator">Submitted (${candidate.submitted.status})</span>`;
        if (candidate.submitted.forReview) {
          submittedStatus += ` <span class="review-indicator">(For Review)</span>`;
        }
      }

      const comment = candidate.submitted?.comment || '';
      const escapedComment = comment.replace(/'/g, "\\'").replace(/`/g, "\\`").replace(/"/g, "\\\"");
      
      // <-- CORRECTED innerHTML (no nested <td> )
      tr.innerHTML = `
        <td>${index + 1}</td>
        <td>${name}</td>
        <td class="document-links">${linksHtml}</td>
        <td>${submittedStatus}</td>
        <td>
          ${comment ? `
            <div class="button-group-center">
              <button class="btn btn-view" onclick="viewComments('${name}', '${itemNumber}', '${candidate.submitted.status}', '${escapedComment}')">
                View
              </button>
              <button class="btn btn-edit" onclick="editComments('${name}', '${itemNumber}', '${candidate.submitted.status}', '${escapedComment}')">
                Edit
              </button>
            </div>
          ` : '<span class="no-comments">No comments yet</span>'}
        </td>
        <td>
          <div class="button-group-center">
            <button class="btn btn-post" onclick="handlePostComment(this)"
              data-name="${name}" data-sex="${sex}" data-item="${itemNumber}">
              Post Comment
            </button>
          </div>
        </td>
      `;

      tr.dataset.status = candidate.submitted ? candidate.submitted.status : 'not-submitted';
      tr.dataset.forReview = candidate.submitted ? candidate.submitted.forReview : 'false';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    container.innerHTML += '<p>No candidates found.</p>';
  }
}


// Modified handlePostComment function to use transferred data
async function handlePostComment(button) {
  const name = button.dataset.name;
  const itemNumber = button.dataset.item;
  const sex = button.dataset.sex;

  // Check if we have transferred comment data from editComments
  const transferredData = window.transferredCommentData;
  let defaultValues = { education: '', training: '', experience: '', eligibility: '', forReview: false };
  
  if (transferredData) {
    defaultValues = transferredData;
    // Clear the transferred data
    window.transferredCommentData = null;
  }

  const modalContent = `
    <div class="modal-body">
      <p>Please enter comments for ${name}:</p>
      <label for="educationComment">Education:</label>
      <input type="text" id="educationComment" class="modal-input" value="${defaultValues.education}">
      <label for="trainingComment">Training:</label>
      <input type="text" id="trainingComment" class="modal-input" value="${defaultValues.training}">
      <label for="experienceComment">Experience:</label>
      <input type="text" id="experienceComment" class="modal-input" value="${defaultValues.experience}">
      <label for="eligibilityComment">Eligibility:</label>
      <input type="text" id="eligibilityComment" class="modal-input" value="${defaultValues.eligibility}">
      <div class="modal-checkbox">
        <input type="checkbox" id="forReviewCheckbox" ${defaultValues.forReview ? 'checked' : ''}>
        <label for="forReviewCheckbox">For Review of the Board</label>
      </div>
    </div>
  `;

  // Use a modified showModal or a custom one that can return complex objects
  const commentResult = await showModalWithInputs(
    'Post a Comment',
    modalContent,
    () => { // onConfirm callback
      const education = document.getElementById('educationComment').value.trim();
      const training = document.getElementById('trainingComment').value.trim();
      const experience = document.getElementById('experienceComment').value.trim();
      const eligibility = document.getElementById('eligibilityComment').value.trim();
      const forReview = document.getElementById('forReviewCheckbox').checked;

      if (!education || !training || !experience || !eligibility) {
        showToast('error', 'Error', 'All comment fields are required.');
        return null; // Prevent modal from closing
      }
      return { education, training, experience, eligibility, forReview };
    }
  );

  if (!commentResult) {
    showToast('info', 'Info', 'Comment posting cancelled.');
    return;
  }

  // Step 2: Prompt for action (Long List or Disqualification)
  const action = await promptForSubmissionAction();
  if (!action) {
    showToast('info', 'Info', 'Submission cancelled.');
    return;
  }

  // Format the comment for submission
  const comment = `${commentResult.education},${commentResult.training},${commentResult.experience},${commentResult.eligibility}`;

  // Step 3: Final confirmation and submission
  try {
    await submitCandidateAction(name, itemNumber, sex, action, comment, commentResult.forReview);
    showToast('success', 'Success', 'Candidate action submitted successfully');
  } catch (error) {
    console.error('Error submitting candidate action:', error);
    showToast('error', 'Error', `Failed to submit candidate action: ${error.message}`);
  }
}

// Modified showModalWithInputs function to support multiple action buttons
function showModalWithInputs(title, contentHTML, onConfirmCallback, additionalActions = []) {
  return new Promise((resolve) => {
    let modalOverlay = document.getElementById('modalOverlay');
    if (!modalOverlay) {
      modalOverlay = document.createElement('div');
      modalOverlay.id = 'modalOverlay';
      modalOverlay.className = 'modal-overlay';
      document.body.appendChild(modalOverlay);
    }

    // Build additional action buttons HTML
    const additionalButtonsHTML = additionalActions.map(action => 
      `<button class="modal-cancel" data-action="${action.key}">${action.label}</button>`
    ).join('');

    modalOverlay.innerHTML = `
      <div class="modal">
        <div class="modal-header"><h3 class="modal-title">${title}</h3><span class="modal-close">×</span></div>
        <div class="modal-content">${contentHTML}</div>
        <div class="modal-actions">
          <button class="modal-cancel">Cancel</button>
          ${additionalButtonsHTML}
          <button class="modal-confirm">Confirm</button>
        </div>
      </div>
    `;
    modalOverlay.classList.add('active');

    const confirmBtn = modalOverlay.querySelector('.modal-confirm');
    const cancelBtn = modalOverlay.querySelector('.modal-cancel');
    const closeBtn = modalOverlay.querySelector('.modal-close');
    const actionBtns = modalOverlay.querySelectorAll('[data-action]');

    const closeHandler = (result) => {
      modalOverlay.classList.remove('active');
      resolve(result);
    };

    confirmBtn.onclick = () => {
      const result = onConfirmCallback();
      if (result !== null) { // Allow callback to prevent closing
        closeHandler(result);
      }
    };

    // Handle additional action buttons
    actionBtns.forEach(btn => {
      btn.onclick = () => {
        const actionKey = btn.dataset.action;
        const action = additionalActions.find(a => a.key === actionKey);
        if (action && action.callback) {
          const result = action.callback();
          if (result !== null) {
            closeHandler({ action: actionKey, data: result });
          }
        }
      };
    });

    cancelBtn.onclick = () => closeHandler(false);
    closeBtn.onclick = () => closeHandler(false);
  });
}


async function promptForSubmissionAction() {
    const modalContent = `
        <p>Please select the final action for this candidate:</p>
    `;

    // We need a way to have two confirm buttons or a selection mechanism.
    // Let's use showModal and add custom buttons.
    let modalOverlay = document.getElementById('modalOverlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.id = 'modalOverlay';
        modalOverlay.className = 'modal-overlay';
        document.body.appendChild(modalOverlay);
    }
    
    return new Promise(resolve => {
        modalOverlay.innerHTML = `
            <div class="modal">
              <div class="modal-header"><h3 class="modal-title">Select Action</h3></div>
              <div class="modal-content">${modalContent}</div>
              <div class="modal-actions">
                <button class="modal-cancel">Cancel</button>
                <button id="disqualifyBtn" class="modal-confirm danger">FOR DISQUALIFICATION</button>
                <button id="longlistBtn" class="modal-confirm">FOR LONG LIST</button>
              </div>
            </div>
        `;
        modalOverlay.classList.add('active');

        document.getElementById('longlistBtn').onclick = () => {
            modalOverlay.classList.remove('active');
            resolve('FOR LONG LIST');
        };
        document.getElementById('disqualifyBtn').onclick = () => {
            modalOverlay.classList.remove('active');
            resolve('FOR DISQUALIFICATION');
        };
        modalOverlay.querySelector('.modal-cancel').onclick = () => {
            modalOverlay.classList.remove('active');
            resolve(null);
        };
    });
}




async function submitCandidateAction(name, itemNumber, sex, action, comment, forReview) {
  console.log('submitCandidateAction triggered:', { name, itemNumber, sex, action, comment, forReview });

  // Step 1: Show the final confirmation modal to the user
  const modalContent = `
    <div class="modal-body">
      <p>Are you sure you want to submit the following action for ${name}?</p>
      <div class="modal-section">
        <h4>SUBMISSION DETAILS:</h4>
        <div class="modal-field"><span class="modal-label">Action:</span><span class="modal-value">${action}</span></div>
        <div class="modal-field"><span class="modal-label">For Review:</span><span class="modal-value">${forReview ? 'Yes' : 'No'}</span></div>
        <div class="modal-field"><span class="modal-label">Comments:</span><span class="modal-value">${comment.split(',').join('; ')}</span></div>
      </div>
    </div>
  `;

  const confirmResult = await showModal('CONFIRM SUBMISSION', modalContent);
  if (!confirmResult) {
    console.log('Submission cancelled by user');
    showToast('info', 'Info', 'Submission cancelled');
    return;
  }

  // Step 2: Proceed with the submission logic if confirmed
  try {
    if (!await isTokenValid()) {
      await refreshAccessToken();
      if (!await isTokenValid()) {
        throw new Error('Failed to validate token after refresh');
      }
    }

    const normalizedName = name.trim().toUpperCase().replace(/\s+/g, ' ');
    const normalizedItemNumber = itemNumber.trim();

    // Helper to get the internal sheet ID for batch updates
    async function getSheetId(sheetName) {
      const response = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: SHEET_ID,
      });
      const sheet = response.result.sheets.find(s => s.properties.title === sheetName);
      if (!sheet) {
        throw new Error(`Sheet ${sheetName} not found in spreadsheet`);
      }
      return sheet.properties.sheetId;
    }

    // Step 3: Handle the action. This includes deleting the old record if it exists in the opposite sheet.
    if (action === 'FOR LONG LIST') {
      // Before adding to CANDIDATES, check if an entry exists in DISQUALIFIED and remove it.
      const disqualifiedResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'DISQUALIFIED!A:F', // Use new range
      });
      const disqualifiedValues = disqualifiedResponse.result.values || [];
      const disqualifiedIndex = disqualifiedValues.slice(1).findIndex(row => 
        row[0]?.trim().toUpperCase().replace(/\s+/g, ' ') === normalizedName && 
        row[1]?.trim() === normalizedItemNumber && 
        row[4]?.toString() === secretariatMemberId
      );

      if (disqualifiedIndex !== -1) {
        const sheetRowIndex = disqualifiedIndex + 1; // Adjust for 0-based index and header
        const sheetId = await getSheetId('DISQUALIFIED');
        const batchUpdateRequest = {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: sheetRowIndex, endIndex: sheetRowIndex + 1 }
            }
          }]
        };
        await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID, resource: batchUpdateRequest
        });
        console.log(`Removed existing entry for ${name} from DISQUALIFIED sheet.`);
      }

      // Now, add the new record to the CANDIDATES sheet.
      const generalResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, range: 'GENERAL_LIST!A:P',
      });
      let candidate = generalResponse.result.values.find(row => 
        row[0]?.trim().toUpperCase().replace(/\s+/g, ' ') === normalizedName && 
        row[1]?.trim() === normalizedItemNumber
      );
      if (!candidate) throw new Error('Candidate not found in GENERAL_LIST');
      
      const valuesToAppend = [...candidate, secretariatMemberId, comment, forReview];
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: 'CANDIDATES!A:S', valueInputOption: 'RAW', // Use new range
        resource: { values: [valuesToAppend] },
      });

    } else if (action === 'FOR DISQUALIFICATION') {
      // Before adding to DISQUALIFIED, check if an entry exists in CANDIDATES and remove it.
      const candidatesResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: 'CANDIDATES!A:S', // Use new range
      });
      const candidatesValues = candidatesResponse.result.values || [];
      const candidatesIndex = candidatesValues.slice(1).findIndex(row =>
        row[0]?.trim().toUpperCase().replace(/\s+/g, ' ') === normalizedName &&
        row[1]?.trim() === normalizedItemNumber &&
        row[16]?.toString() === secretariatMemberId
      );

      if (candidatesIndex !== -1) {
        const sheetRowIndex = candidatesIndex + 1; // Adjust for 0-based index and header
        const sheetId = await getSheetId('CANDIDATES');
        const batchUpdateRequest = {
          requests: [{
            deleteDimension: {
              range: { sheetId, dimension: 'ROWS', startIndex: sheetRowIndex, endIndex: sheetRowIndex + 1 }
            }
          }]
        };
        await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID, resource: batchUpdateRequest
        });
        console.log(`Removed existing entry for ${name} from CANDIDATES sheet.`);
      }

      // Now, add the new record to the DISQUALIFIED sheet.
      const valuesToAppend = [[name, itemNumber, sex, comment, secretariatMemberId, forReview]];
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID, range: 'DISQUALIFIED!A:F', valueInputOption: 'RAW', // Use new range
        resource: { values: valuesToAppend },
      });
    }

    // Step 4: Refresh the table to show the latest state
    await fetchSecretariatCandidates(itemNumber);

  } catch (error) {
    console.error('Error submitting action in submitCandidateAction:', error);
    showToast('error', 'Error', `Failed to submit action: ${error.message || JSON.stringify(error)}`);
    throw error; // Re-throw to be handled by the calling function if needed
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
    const [education, training, experience, eligibility] = comment ? comment.split(',') : ['','','',''];

    // --- Fetch the 'forReview' status to determine the final color-coding ---
    let forReviewStatus = 'No';
    try {
        const sheetNameToFetch = status === 'CANDIDATES' ? 'CANDIDATES!A:S' : 'DISQUALIFIED!A:F';
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: sheetNameToFetch,
        });
        const values = response.result.values || [];
        const normalizedName = name.trim().toUpperCase().replace(/\s+/g, ' ');
        const normalizedItemNumber = itemNumber.trim();

        const candidateRow = values.slice(1).find(row => {
            const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
            const rowItem = row[1]?.trim();
            const memberIdCol = status === 'CANDIDATES' ? 16 : 4;
            return rowName === normalizedName && rowItem === normalizedItemNumber && row[memberIdCol]?.toString() === secretariatMemberId;
        });

        if (candidateRow) {
            const reviewStatusCol = status === 'CANDIDATES' ? 18 : 5;
            if (candidateRow[reviewStatusCol] === 'TRUE') {
                forReviewStatus = 'Yes';
            }
        }
    } catch (error) {
        console.error("Could not fetch 'for review' status:", error);
    }

    // --- Determine the final status text and inline styles for the header ---
    let headerStyle = '';
    let displayStatus = status.replace('_', ' '); // Start with the base status like "FOR LONG LIST"

    if (forReviewStatus === 'Yes') {
        // AMBER style for "For Review"
        headerStyle = 'background-color: #ffc107; color: #212529;';
        // Add the review status to the display text
        displayStatus += ' (For Review)'; 
    } else if (status === 'DISQUALIFIED') {
        // RED style for "Disqualified"
        headerStyle = 'background-color: #dc3545; color: white;';
    } else {
        // GREEN style for "Long Listed"
        headerStyle = 'background-color: #28a745; color: white;';
    }
    
    // --- Generate the improved modal content with inline styles ---
    const modalContent = `
    <div style="font-family: Arial, sans-serif; padding: 0; margin: 0;">
        
        <div style="${headerStyle} padding: 15px 20px; border-radius: 8px 8px 0 0; text-align: center;">
            <h2 style="margin: 0; font-size: 24px;">${name}</h2>
            <p style="margin: 5px 0 0; font-size: 16px; font-weight: bold; text-transform: uppercase;">${displayStatus}</p>
        </div>

        <div style="padding: 25px;">
            
            <div style="margin-bottom: 20px;">
                <h3 style="font-size: 15px; color: #555; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Education</h3>
                <p style="font-size: 17px; color: #222; line-height: 1.6; margin: 0;">${education || 'No comment provided.'}</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="font-size: 15px; color: #555; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Training</h3>
                <p style="font-size: 17px; color: #222; line-height: 1.6; margin: 0;">${training || 'No comment provided.'}</p>
            </div>
            
            <div style="margin-bottom: 20px;">
                <h3 style="font-size: 15px; color: #555; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Experience</h3>
                <p style="font-size: 17px; color: #222; line-height: 1.6; margin: 0;">${experience || 'No comment provided.'}</p>
            </div>
            
            <div>
                <h3 style="font-size: 15px; color: #555; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid #eee; padding-bottom: 5px;">Eligibility</h3>
                <p style="font-size: 17px; color: #222; line-height: 1.6; margin: 0;">${eligibility || 'No comment provided.'}</p>
            </div>

        </div>
    </div>
    `;
    
    showModal('View Candidate Comments', modalContent, null, null, false);
}

function filterTableByStatus(status, itemNumber) {
  const rows = document.querySelectorAll('#secretariat-candidates-table tbody tr');
  rows.forEach(row => {
    const rowStatus = row.dataset.status;
    const rowForReview = row.dataset.forReview === 'true';

    let show = false;
    if (!status) {
        show = true;
    } else if (status === 'for-review') {
        if (rowForReview) show = true;
    } else if (status === 'not-submitted') {
        if (rowStatus === 'not-submitted') show = true;
    } else {
        if (rowStatus === status) show = true;
    }

    row.style.display = show ? '' : 'none';
  });
}



// Modified editComments function with Change Action button
async function editComments(name, itemNumber, status, comment) {
    console.log(`DEBUG: Entering editComments for ${name} (Status: ${status}, Item: ${itemNumber}).`);

    const operationId = `${name}|${itemNumber}|${status}`;
    if (activeCommentModalOperations.has(operationId)) {
        console.log(`DEBUG: editComments: Operation for ${name} is already active. Aborting duplicate call.`);
        return;
    }
    activeCommentModalOperations.add(operationId);

    try {
        // --- 1. Fetch current 'forReview' status ---
        const sheetNameToFetch = status === 'CANDIDATES' ? 'CANDIDATES!A:S' : 'DISQUALIFIED!A:F';
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: sheetNameToFetch,
        });
        const values = response.result.values || [];
        const normalizedName = name.trim().toUpperCase().replace(/\s+/g, ' ');
        const normalizedItemNumber = itemNumber.trim();
        
        let existingForReview = false;
        const rowIndex = values.slice(1).findIndex(row => {
            const rowName = row[0]?.trim().toUpperCase().replace(/\s+/g, ' ');
            const rowItem = row[1]?.trim();
            const memberIdCol = status === 'CANDIDATES' ? 16 : 4;
            return rowName === normalizedName && rowItem === normalizedItemNumber && row[memberIdCol]?.toString() === secretariatMemberId;
        });

        if (rowIndex !== -1) {
            const reviewStatusCol = status === 'CANDIDATES' ? 18 : 5;
            existingForReview = values[rowIndex + 1][reviewStatusCol] === 'TRUE';
        }

        // --- 2. Prepare Modal Content with the Checkbox ---
        const [education, training, experience, eligibility] = comment ? comment.split(',') : ['', '', '', ''];
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
                <div class="modal-checkbox" style="margin-top: 15px;">
                  <input type="checkbox" id="forReviewCheckbox" ${existingForReview ? 'checked' : ''}>
                  <label for="forReviewCheckbox">For Review of the Board</label>
                </div>
            </div>
        `;

        // Define additional actions (Change Action button)
        const additionalActions = [{
            key: 'changeAction',
            label: 'Change Action',
            callback: () => {
                const education = document.getElementById('educationComment').value.trim();
                const training = document.getElementById('trainingComment').value.trim();
                const experience = document.getElementById('experienceComment').value.trim();
                const eligibility = document.getElementById('eligibilityComment').value.trim();
                const forReview = document.getElementById('forReviewCheckbox').checked;
                return { education, training, experience, eligibility, forReview };
            }
        }];

        // --- 3. Show Modal and Await User Input ---
        const commentResult = await showModalWithInputs(
            `Edit Comments (${status})`,
            modalContent,
            () => {
                const education = document.getElementById('educationComment').value.trim();
                const training = document.getElementById('trainingComment').value.trim();
                const experience = document.getElementById('experienceComment').value.trim();
                const eligibility = document.getElementById('eligibilityComment').value.trim();
                const forReview = document.getElementById('forReviewCheckbox').checked;
                return { education, training, experience, eligibility, forReview };
            },
            additionalActions
        );

        if (!commentResult) {
            showToast('info', 'Canceled', 'Comment update was canceled.');
            return;
        }

        // --- Handle Change Action ---
        if (commentResult.action === 'changeAction') {
            console.log('DEBUG: Change Action button clicked, transferring to handlePostComment');
            
            // Find the sex value from the original data
            let sex = '';
            if (rowIndex !== -1) {
                const sexCol = status === 'CANDIDATES' ? 2 : 2; // Assuming sex is in column C (index 2)
                sex = values[rowIndex + 1][sexCol] || '';
            }

            // Create a mock button with the necessary data attributes
            const mockButton = {
                dataset: {
                    name: name,
                    item: itemNumber,
                    sex: sex
                }
            };

            // Transfer the comment data to a global variable or use another method
            window.transferredCommentData = commentResult.data;
            
            // Call handlePostComment with the mock button
            await handlePostComment(mockButton);
            return;
        }
        
        const newComment = `${commentResult.education},${commentResult.training},${commentResult.experience},${commentResult.eligibility}`;

        // --- 4. Update Google Sheet ---
        if (rowIndex !== -1) {
            const sheetRowIndex = rowIndex + 2; // +1 for 0-based index, +1 for header row
            let rangeToUpdate, valuesToUpdate;

            if (status === 'CANDIDATES') {
                rangeToUpdate = `CANDIDATES!R${sheetRowIndex}:S${sheetRowIndex}`;
                valuesToUpdate = [[newComment, commentResult.forReview]];
            } else { // DISQUALIFIED
                rangeToUpdate = `DISQUALIFIED!D${sheetRowIndex}:F${sheetRowIndex}`;
                // Note the empty value for column E (Secretariat Member ID) which we are not changing
                valuesToUpdate = [[newComment, , commentResult.forReview]];
            }
            
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SHEET_ID,
                range: rangeToUpdate,
                valueInputOption: 'RAW',
                resource: { values: valuesToUpdate },
            });

            showToast('success', 'Success', 'Comments updated successfully!');
            fetchSecretariatCandidates(itemNumber); // Refresh UI
        } else {
            showToast('error', 'Error', 'Could not find the original record to update.');
        }

    } catch (error) {
        console.error('DEBUG: CRITICAL ERROR caught during editComments:', error);
        showToast('error', 'Update Failed', `Failed to update comments: ${error.message}`);
    } finally {
        activeCommentModalOperations.delete(operationId);
        console.log(`DEBUG: Exiting editComments. Operation ${operationId} cleared.`);
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
          button.setAttribute('type', 'button'); // ensure never submit

          if (value) {
            button.textContent = 'View Document';
          } else {
            button.textContent = 'NONE';
            button.disabled = true;
          }

          // Always attach a click listener to stop bubbling/submission
          button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (value) {
              window.open(value, '_blank');
            }
          });

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
    option.value = evaluator; // Keep original value for logic
    
    // Change display text only for "In-charge, Administrative Division"
    if (evaluator === "In-charge, Administrative Division") {
      option.textContent = "Chief, Administrative Division";
    } else {
      option.textContent = evaluator;
    }
    
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
  const displayName = newSelection === "In-charge, Administrative Division" ? "Chief, Administrative Division" : newSelection;
  const modalContent = `
    <p>Please enter the password for ${displayName}:</p>
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
      showToast('success', 'Success', `Logged in as ${displayName}`);
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

// Fixed handleSignOutClick to handle errors gracefully
async function handleSignOutClick() {
  const modalContent = `<p>Are you sure you want to sign out?</p>`;
  const result = await showModal('Confirm Sign Out', modalContent, async () => {
    try {
      const accessToken = gapi.client.getToken()?.access_token;
      
      // Try to revoke the access token (ignore errors)
      if (accessToken) {
        try {
          await fetch('https://accounts.google.com/o/oauth2/revoke?token=' + accessToken, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
          });
          console.log('Access token revoked successfully');
        } catch (revokeError) {
          console.warn('Failed to revoke access token (non-critical):', revokeError.message);
        }
      }
      
      // Try to clear refresh token cookie on backend (ignore errors)
      try {
        await fetch(`${API_BASE_URL}/clear-session`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
          },
          body: JSON.stringify({ sessionId: window.sessionId }),
          credentials: 'include'
        });
        console.log('Session cleared on backend');
      } catch (backendError) {
        console.warn('Failed to clear backend session (non-critical):', backendError.message);
      }
      
      // Reset client-side state (this always works)
      gapi.client.setToken(null);
      localStorage.clear();
      console.log('All localStorage cleared');
      
      // Reset global variables (use window object to avoid const errors)
      window.currentEvaluator = null;
      window.sessionId = null;
      window.secretariatMemberId = null;
      
      // Reset arrays (clear contents instead of reassigning to avoid const errors)
      if (window.vacancies && Array.isArray(window.vacancies)) {
        window.vacancies.length = 0;
      }
      if (window.candidates && Array.isArray(window.candidates)) {
        window.candidates.length = 0;
      }
      if (window.compeCodes && Array.isArray(window.compeCodes)) {
        window.compeCodes.length = 0;
      }
      if (window.competencies && Array.isArray(window.competencies)) {
        window.competencies.length = 0;
      }
      if (window.submissionQueue && Array.isArray(window.submissionQueue)) {
        window.submissionQueue.length = 0;
      }
      
      console.log('Global variables reset');
      
      // Clear API manager cache
      if (window.apiManager && typeof window.apiManager.clearCache === 'function') {
        window.apiManager.clearCache();
      }
      
      // Update UI
      if (typeof updateUI === 'function') updateUI(false);
      if (typeof resetDropdowns === 'function') resetDropdowns([]);
      if (typeof clearRatings === 'function') clearRatings();
      
      // Clean up UI elements
      if (window.elements?.competencyContainer) {
        window.elements.competencyContainer.innerHTML = '';
      }
      
      // Remove evaluator selector
      const evaluatorSelect = document.getElementById('evaluatorSelect');
      if (evaluatorSelect && evaluatorSelect.parentElement) {
        evaluatorSelect.parentElement.remove();
      }
      
      // Disable submit button
      if (window.elements?.submitRatings) {
        window.elements.submitRatings.disabled = true;
      }
      
      // Clear timeouts
      if (window.fetchTimeout) {
        clearTimeout(window.fetchTimeout);
        window.fetchTimeout = null;
      }
      if (window.refreshTimer) {
        clearTimeout(window.refreshTimer);
        window.refreshTimer = null;
      }
      
      // Clean up results area
      const resultsArea = document.querySelector('.results-area');
      if (resultsArea) {
        resultsArea.remove();
      }
      
      // Reset container styling
      const container = document.querySelector('.container');
      if (container) {
        container.style.marginTop = '20px';
      }
      
      // Update auth section
      const authSection = document.querySelector('.auth-section');
      if (authSection) {
        authSection.classList.add('signed-out');
      }
      
      if (typeof showToast === 'function') {
        showToast('success', 'Signed Out', 'You have been successfully signed out.');
      }
      
    } catch (error) {
      console.error('Error during sign out:', error);
      
      // Even if there's an error, try to clean up locally
      try {
        gapi.client.setToken(null);
        localStorage.clear();
        window.currentEvaluator = null;
        window.sessionId = null;
        
        // Clear arrays safely
        if (window.submissionQueue && Array.isArray(window.submissionQueue)) {
          window.submissionQueue.length = 0;
        }
        if (window.vacancies && Array.isArray(window.vacancies)) {
          window.vacancies.length = 0;
        }
        if (window.candidates && Array.isArray(window.candidates)) {
          window.candidates.length = 0;
        }
        if (window.compeCodes && Array.isArray(window.compeCodes)) {
          window.compeCodes.length = 0;
        }
        if (window.competencies && Array.isArray(window.competencies)) {
          window.competencies.length = 0;
        }
        
        if (window.apiManager && typeof window.apiManager.clearCache === 'function') {
          window.apiManager.clearCache();
        }
        if (typeof showToast === 'function') {
          showToast('warning', 'Partial Sign Out', 'Local data cleared, but server cleanup may have failed.');
        }
      } catch (cleanupError) {
        console.error('Failed to clean up even locally:', cleanupError);
        if (typeof showToast === 'function') {
          showToast('error', 'Sign Out Error', 'Failed to sign out properly. Please refresh the page.');
        }
      }
    }
  }, () => {
    console.log('Sign out canceled');
  });
}

// Fixed handleLogoutAll to handle errors and const variables properly
async function handleLogoutAll() {
  const contentHTML = `
    <p>Enter the admin password to log out all sessions:</p>
    <input type="password" id="logoutAllPasswordInput" placeholder="Enter password">
  `;
  
  const result = await showModal(
    'Confirm Logout All Sessions',
    contentHTML,
    async () => {
      const passwordInput = document.getElementById('logoutAllPasswordInput');
      if (!passwordInput) {
        console.error('Password input not found');
        if (typeof showToast === 'function') {
          showToast('error', 'Error', 'Password input not found. Please try again.');
        }
        return;
      }
      
      const password = passwordInput.value.trim();
      if (password !== 'admindan') {
        console.warn('Invalid password entered');
        if (typeof showToast === 'function') {
          showToast('error', 'Error', 'Invalid password');
        }
        return;
      }
      
      try {
        const accessToken = gapi.client.getToken()?.access_token;
        if (!accessToken) {
          if (typeof showToast === 'function') {
            showToast('error', 'Error', 'No valid session found');
          }
          return;
        }
        
        const response = await fetch(`${API_BASE_URL}/logout-all`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          },
          body: JSON.stringify({ sessionId: window.sessionId })
        });
        
        if (response.ok) {
          // Reset client-side state
          gapi.client.setToken(null);
          localStorage.clear();
          console.log('All localStorage cleared');
          
          // Reset global variables (use window object to avoid const errors)
          window.currentEvaluator = null;
          window.sessionId = null;
          window.secretariatMemberId = null;
          
          // Reset arrays (clear contents instead of reassigning to avoid const errors)
          if (window.vacancies && Array.isArray(window.vacancies)) {
            window.vacancies.length = 0;
          }
          if (window.candidates && Array.isArray(window.candidates)) {
            window.candidates.length = 0;
          }
          if (window.compeCodes && Array.isArray(window.compeCodes)) {
            window.compeCodes.length = 0;
          }
          if (window.competencies && Array.isArray(window.competencies)) {
            window.competencies.length = 0;
          }
          if (window.submissionQueue && Array.isArray(window.submissionQueue)) {
            window.submissionQueue.length = 0;
          }
          
          console.log('Global variables reset');
          
          // Clear API manager cache
          if (window.apiManager && typeof window.apiManager.clearCache === 'function') {
            window.apiManager.clearCache();
          }
          
          // Update UI
          if (typeof updateUI === 'function') updateUI(false);
          if (typeof resetDropdowns === 'function') resetDropdowns([]);
          if (typeof clearRatings === 'function') clearRatings();
          
          // Clean up UI elements
          if (window.elements?.competencyContainer) {
            window.elements.competencyContainer.innerHTML = '';
          }
          
          // Remove evaluator selector
          const evaluatorSelect = document.getElementById('evaluatorSelect');
          if (evaluatorSelect && evaluatorSelect.parentElement) {
            evaluatorSelect.parentElement.remove();
          }
          
          // Disable submit button
          if (window.elements?.submitRatings) {
            window.elements.submitRatings.disabled = true;
          }
          
          // Clear timeouts
          if (window.fetchTimeout) {
            clearTimeout(window.fetchTimeout);
            window.fetchTimeout = null;
          }
          if (window.refreshTimer) {
            clearTimeout(window.refreshTimer);
            window.refreshTimer = null;
          }
          
          // Clean up results area
          const resultsArea = document.querySelector('.results-area');
          if (resultsArea) {
            resultsArea.remove();
          }
          
          // Reset container styling
          const container = document.querySelector('.container');
          if (container) {
            container.style.marginTop = '20px';
          }
          
          // Update auth section
          const authSection = document.querySelector('.auth-section');
          if (authSection) {
            authSection.classList.add('signed-out');
          }
          
          if (typeof showToast === 'function') {
            showToast('success', 'Success', 'All sessions logged out');
          }
          
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error('Logout all failed:', errorData);
          if (typeof showToast === 'function') {
            showToast('error', 'Error', 'Failed to log out all sessions');
          }
        }
        
      } catch (error) {
        console.error('Error logging out all sessions:', error);
        if (typeof showToast === 'function') {
          showToast('error', 'Error', 'Failed to log out all sessions');
        }
      }
    },
    () => {
      const passwordInput = document.getElementById('logoutAllPasswordInput');
      if (passwordInput) {
        passwordInput.value = '';
      }
      console.log('Logout all canceled');
    }
  );
}

// Update updateUI to manage tabs visibility and logout buttons
function updateUI(isSignedIn) {
    const isSecretariatAuthenticated = localStorage.getItem('secretariatAuthenticated') === 'true';
    const currentTab = localStorage.getItem('currentTab') || 'rater'; // Default to 'rater' if not set

    if (isSignedIn || isSecretariatAuthenticated) {
        elements.signInBtn.style.display = 'none';
        elements.signOutBtn.style.display = 'block';
        elements.logoutAllBtn.style.display = 'block';

        // Determine authentication status text
        let authStatusText = '';
        if (isSecretariatAuthenticated) {
            const memberName = localStorage.getItem('secretariatMemberName');
            authStatusText = memberName ? `Signed in as Secretariat: ${memberName}` : 'Signed in as Secretariat';
        } else {
            authStatusText = currentEvaluator
                ? `Signed in as ${currentEvaluator === "In-charge, Administrative Division" ? "Chief, Administrative Division" : currentEvaluator}`
                : 'Signed in';
        }
        elements.authStatus.textContent = authStatusText;

        // Show tabs and set content visibility based on currentTab
        elements.tabsContainer.removeAttribute('hidden');
        elements.raterContent.style.display = currentTab === 'rater' ? 'block' : 'none';
        elements.secretariatContent.style.display = currentTab === 'secretariat' ? 'block' : 'none';
        elements.ratingForm.style.display = currentTab === 'rater' ? 'block' : 'none'; // Fixed syntax error

        // Ensure resultsArea is hidden for secretariat tab
        const resultsArea = document.querySelector('.results-area');
        if (resultsArea) {
            console.log('Results area in updateUI, setting display:', currentTab === 'rater' ? 'block' : 'none');
            resultsArea.style.display = currentTab === 'rater' ? 'block' : 'none';
            resultsArea.classList.toggle('active', currentTab === 'rater');
        } else {
            console.error('Results area not found in updateUI!');
        }
    } else {
        elements.signInBtn.style.display = 'block';
        elements.signOutBtn.style.display = 'none';
        elements.logoutAllBtn.style.display = 'none';
        elements.authStatus.textContent = 'Not signed in';
        elements.ratingForm.style.display = 'none';
        elements.tabsContainer.setAttribute('hidden', '');
        elements.raterContent.style.display = 'none';
        elements.secretariatContent.style.display = 'none';

        // Hide resultsArea when not signed in
        const resultsArea = document.querySelector('.results-area');
        if (resultsArea) {
            resultsArea.style.display = 'none';
            resultsArea.classList.remove('active');
        }
    }
}

// Add event listener for logout all button
elements.logoutAllBtn.addEventListener('click', handleLogoutAll);

// Update tab switching logic to ensure tabs work correctly
function initializeTabs() {
  elements.raterTab.addEventListener('click', () => {
    currentTab = 'rater';
    elements.raterTab.classList.add('active');
    elements.secretariatTab.classList.remove('active');
    elements.raterContent.style.display = 'block';
    elements.secretariatContent.style.display = 'none';
    elements.ratingForm.style.display = 'block';
    updateUI(true);
  });

  elements.secretariatTab.addEventListener('click', () => {
    currentTab = 'secretariat';
    elements.secretariatTab.classList.add('active');
    elements.raterTab.classList.remove('active');
    elements.raterContent.style.display = 'none';
    elements.secretariatContent.style.display = 'block';
    elements.ratingForm.style.display = 'none';
    updateUI(true);
  });
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

  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))].sort();
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
        .map((row) => row[1]).sort();
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
        .map((row) => row[0]).sort();
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
        .map((row) => row[0]).sort();
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





// ====================
// HELPER: Consistent row matching
// ====================
function matchesRatingRow(row, item, candidateName, evaluator) {
  const candidateInitials = getInitials(candidateName);

  // Adjust these indices if your sheet changes:
  const rowId = row[0];   // e.g. "ITEM-AB" (item + initials)
  const rowItem = row[1]; // item
  const rowName = row[2]; // candidate name
  const rowEvaluator = row[5]; // evaluator

  return (
    rowId?.startsWith(`${item}-${candidateInitials}`) &&
    rowItem === item &&
    rowName === candidateName &&
    rowEvaluator === evaluator
  );
}

async function fetchSubmittedRatings({ forceRefresh = false } = {}) {
  if (fetchTimeout) clearTimeout(fetchTimeout);

  fetchTimeout = setTimeout(async () => {
    const name = elements.nameDropdown?.value;
    const item = elements.itemDropdown?.value;
    const evaluator = currentEvaluator;

    if (!evaluator || !name || !item) {
      console.warn('Missing evaluator, name, or item');
      if (elements.submitRatings) elements.submitRatings.disabled = true;
      clearRatings();
      return;
    }

    try {
      const { values } = await safeFetchRatings({ name, item, evaluator, forceRefresh });

      const filteredRows = (values.slice ? values.slice(1) : []).filter(row =>
        matchesRatingRow(row, item, name, evaluator)
      );

      const competencyRatings = {};
      filteredRows.forEach(row => {
        const competencyName = row[3];
        if (!competencyRatings[competencyName]) competencyRatings[competencyName] = {};
        competencyRatings[competencyName][evaluator] = row[4];
      });

      console.log(`Fetched ratings for ${name} (${item}) by ${evaluator}:`, competencyRatings);
      console.log('Filtered rows after fetch:', filteredRows);

      prefillRatings(competencyRatings, filteredRows.length === 0, name, item);
      if (elements.submitRatings) elements.submitRatings.disabled = false;

    } catch (error) {
      console.error('Error fetching ratings (wrapped):', error);
      showToast('error', 'Error', 'Failed to fetch ratings');
      clearRatings();
      prefillRatings({}, true, name, item);

      const metrics = apiManager.getMetrics?.();
      console.log('API manager metrics after failure:', metrics);
    }
  }, 300);
}


// Add this at the global level (outside any function)
function clearRatings() {
  // Clear visual radio buttons
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const radios = item.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => (radio.checked = false));
  });
  
  // Reset all displayed values to 0.00
  const ratingElements = [
    'basic-rating-value',
    'organizational-rating-value', 
    'leadership-rating-value',
    'minimum-rating-value',
    'psychosocial-rating-value',
    'potential-rating-value'
  ];
  
  ratingElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.textContent = '0.00';
    }
  });
  
  console.log('Radio buttons cleared and displays reset to 0.00');
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










// =====================================
// CONFIGURATION
// =====================================

const SUBMISSION_CONFIG = {const SUBMISSION_CONFIG = {
  MAX_RETRIES: 5, // Changed from 3 to 5
  BASE_DELAY: 500,
  MAX_DELAY: 3000,
  LOCK_TIMEOUT: 8000,
  BATCH_SIZE: 10
};

// Cache for existing ratings to avoid repeated API calls
const ratingsCache = new Map();
const CACHE_DURATION = 30000; // 30 seconds

// =====================================
// OPTIMIZED SUBMISSION QUEUE
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
      const submission = this.retryQueue.shift() || this.queue.shift();
      if (!submission) break;

      try {
        showSubmittingIndicator();
        console.log('🔄 Starting submission process');

        const result = await this.processSubmission(submission);
        
        // Always hide indicator immediately after submission attempt
        hideSubmittingIndicator();
        console.log('🔄 Submitting indicator hidden');

        if (result.success) {
          const candidateName = submission.ratings[0][2];
          const item = submission.ratings[0][1];
          
          // Clear stored data
          localStorage.removeItem(`radioState_${candidateName}_${item}`);
          handleSuccessfulSubmission(submission.ratings);
          
          // Show success modal
          await new Promise((resolve) => {
            showModal(
              'Submission Successful',
              `<p>${result.message}</p>`,
              () => {
                console.log('Success modal closed');
                fetchSubmittedRatings({ forceRefresh: true });
                resolve();
              },
              null,
              false
            );
          });
        }
      } catch (error) {
        hideSubmittingIndicator(); // Ensure indicator is hidden on error
        await this.handleFailedSubmission(submission, error);
      }
    }

    this.processing = false;
  }

  async processSubmission(submission) {
    submission.attempts++;
    showSubmissionProgress(submission);
    
    try {
      return await submitRatingsOptimized(submission.ratings);
    } catch (error) {
      if (submission.attempts >= SUBMISSION_CONFIG.MAX_RETRIES) {
        throw error;
      }
      throw new Error(`Retry needed: ${error.message}`);
    }
  }

  async handleFailedSubmission(submission, error) {
    if (submission.attempts < SUBMISSION_CONFIG.MAX_RETRIES) {
      const delay = Math.min(
        SUBMISSION_CONFIG.BASE_DELAY * Math.pow(1.5, submission.attempts) + 
        Math.random() * 1000,
        SUBMISSION_CONFIG.MAX_DELAY
      );
      
      setTimeout(() => {
        this.retryQueue.push(submission);
        if (!this.processing) this.process();
      }, delay);
      
      showToastOptimized('info', 'Retrying', `Attempt ${submission.attempts}/${SUBMISSION_CONFIG.MAX_RETRIES}`);
    } else {
      showToastOptimized('error', 'Failed', `Submission failed: ${error.message}`);
      console.error('Final submission failure:', error);
    }
  }

  isEmpty() {
    return this.queue.length === 0 && this.retryQueue.length === 0;
  }
}


const submissionQueue = new SubmissionQueue();

// =====================================
// MAIN SUBMISSION FUNCTION
// =====================================

async function submitRatings() {
  if (submissionQueue.processing) {
    showToastOptimized('info', 'Info', 'Submission already in progress');
    return;
  }

  try {
    // Validate authentication
    const token = gapi.client.getToken();
    if (!token || !await isTokenValid()) {
      await refreshAccessToken();
      if (!gapi.client.getToken()) {
        showToastOptimized('error', 'Error', 'Authentication failed. Please sign in again.');
        handleAuthClick();
        return;
      }
    }

    // Validate evaluator
    if (!currentEvaluator) {
      showToastOptimized('warning', 'Warning', 'Please select an evaluator');
      return;
    }

    // Validate form data
    const item = elements.itemDropdown.value;
    const candidateName = elements.nameDropdown.value;
    if (!item || !candidateName) {
      showToastOptimized('error', 'Error', 'Please select both item and candidate');
      return;
    }

    // ALWAYS check for existing ratings - this ensures proper detection
    console.log('🔍 Checking for existing ratings...');
    const existingRatings = await checkExistingRatingsCached(item, candidateName, currentEvaluator);
    const isUpdate = existingRatings && existingRatings.length > 0;
    
    console.log('📊 Existing ratings found:', existingRatings);
    console.log('🔄 Is update operation:', isUpdate);

    // Handle updates with password verification
    if (isUpdate) {
      console.log('🔐 Requesting password verification for update...');
      const isVerified = await verifyEvaluatorPassword(existingRatings);
      if (!isVerified) {
        revertToExistingRatings(existingRatings);
        showToastOptimized('warning', 'Update Canceled', 'Ratings reverted to original values');
        return;
      }
      console.log('✅ Password verification successful');
    }

    // Prepare ratings data
    const { ratings, error } = prepareRatingsData(item, candidateName, currentEvaluator);
    if (error) {
      showToastOptimized('error', 'Error', error);
      return;
    }

    // Show confirmation modal
    const confirmed = await showConfirmationModal(ratings, existingRatings || [], isUpdate);
    if (!confirmed) {
      if (isUpdate) {
        revertToExistingRatings(existingRatings);
        showToastOptimized('info', 'Canceled', 'Ratings reverted to original values');
      } else {
        showToastOptimized('info', 'Canceled', 'Ratings submission aborted');
      }
      return;
    }

    // Add to queue and process
    submissionQueue.add(ratings, 'normal');
    showToastOptimized('info', 'Queued', 'Submission queued for processing');

  } catch (error) {
    console.error('Submission error:', error);
    showToastOptimized('error', 'Error', `Failed to submit: ${error.message}`);
    if (error.status === 401 || error.status === 403) handleAuthClick();
  }
}

// =====================================
// OPTIMIZED SUBMISSION LOGIC
// =====================================

async function submitRatingsOptimized(ratings) {
  try {
    // Try lockless submission first for better performance
    const result = await tryLocklessSubmission(ratings);
    if (result.success) return result;
  } catch (error) {
    console.log('Lockless failed, trying with lock:', error.message);
  }

  // Fall back to locked submission
  return await submitWithLock(ratings);
}

async function tryLocklessSubmission(ratings) {
  const hasUpdates = await checkForUpdates(ratings);
  
  if (!hasUpdates) {
    if (!await isTokenValid()) await refreshAccessToken();
    
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.RATELOG,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: ratings },
    });
    
    return { success: true, message: 'Ratings submitted successfully' };
  }
  
  throw new Error('Updates detected, lock required');
}

async function submitWithLock(ratings) {
  const lockData = {
    sessionId: sessionId,
    timestamp: Date.now(),
    operation: 'rating_submission'
  };
  
  let lockAcquired = false;
  
  try {
    lockAcquired = await acquireLock(lockData);
    if (!lockAcquired) {
      throw new Error('Could not acquire lock - system busy');
    }

    const result = await processRatingsBatch(ratings);
    return result;
    
  } finally {
    if (lockAcquired) {
      await releaseLock(lockData);
    }
  }
}

// =====================================
// LOCK SYSTEM
// =====================================

async function acquireLock(lockData) {
  const lockRange = "RATELOG!G1:J1";
  const maxAttempts = 5; // Increased from 3 to match MAX_RETRIES
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      if (!await isTokenValid()) await refreshAccessToken();
      
      const lockStatusResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: lockRange,
      });
      
      const lockRow = lockStatusResponse.result.values?.[0] || ['', '', '', ''];
      const [status, timestamp, owner, operation] = lockRow;
      
      const now = Date.now();
      const lockAge = now - new Date(timestamp).getTime();
      
      if (status !== 'locked' || lockAge > SUBMISSION_CONFIG.LOCK_TIMEOUT) {
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: lockRange,
          valueInputOption: 'RAW',
          resource: { 
            values: [['locked', new Date(now).toISOString(), lockData.sessionId, lockData.operation]]
          },
        });
        
        // Verify we got the lock
        const verifyResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: lockRange,
        });
        
        const verifyRow = verifyResponse.result.values?.[0] || [];
        if (verifyRow[2] === lockData.sessionId) {
          return true;
        }
      }
      
      const delay = SUBMISSION_CONFIG.BASE_DELAY * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      
    } catch (error) {
      console.error(`Lock attempt ${attempt + 1} failed:`, error);
      if (attempt === maxAttempts - 1) throw error;
    }
  }
  
  return false;
}

async function releaseLock(lockData) {
  try {
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: "RATELOG!G1:J1",
      valueInputOption: 'RAW',
      resource: { values: [['', '', '', '']] },
    });
  } catch (error) {
    console.error('Lock release failed:', error);
  }
}

// =====================================
// BATCH PROCESSING
// =====================================

async function processRatingsBatch(ratings) {
  if (!await isTokenValid()) await refreshAccessToken();
  
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
  });

  const existingData = response.result.values || [];
  const updates = [];
  const appends = [];
  
  const existingMap = new Map();
  existingData.forEach((row, index) => {
    if (row[0]) existingMap.set(row[0], index);
  });

  ratings.forEach(rating => {
    const ratingCode = rating[0];
    if (existingMap.has(ratingCode)) {
      const index = existingMap.get(ratingCode);
      updates.push({ index, rating });
    } else {
      appends.push(rating);
    }
  });

  const operations = [];
  
  if (updates.length > 0) {
    updates.forEach(({ index, rating }) => {
      existingData[index] = rating;
    });
    
    operations.push(
      gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG,
        valueInputOption: 'RAW',
        resource: { values: existingData },
      })
    );
  }

  if (appends.length > 0) {
    const chunks = [];
    for (let i = 0; i < appends.length; i += SUBMISSION_CONFIG.BATCH_SIZE) {
      chunks.push(appends.slice(i, i + SUBMISSION_CONFIG.BATCH_SIZE));
    }
    
    chunks.forEach(chunk => {
      operations.push(
        gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: SHEET_RANGES.RATELOG,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: chunk },
        })
      );
    });
  }

  await Promise.all(operations);

  return {
    success: true,
    message: updates.length > 0 ? 'Ratings updated successfully' : 'Ratings submitted successfully'
  };
}

// =====================================
// HELPER FUNCTIONS - IMPROVED EXISTING RATINGS CHECK
// =====================================

async function checkExistingRatingsCached(item, candidateName, evaluator) {
  const cacheKey = `${item}:${candidateName}:${evaluator}`;
  const cached = ratingsCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    console.log('📋 Using cached ratings data for:', cacheKey);
    return cached.data;
  }
  
  console.log('🔍 Fetching fresh ratings data for:', cacheKey);
  const ratings = await checkExistingRatings(item, candidateName, evaluator);
  ratingsCache.set(cacheKey, { data: ratings, timestamp: Date.now() });
  
  return ratings;
}

async function checkExistingRatings(item, candidateName, evaluator) {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    
    console.log('🔍 Checking existing ratings for:', { item, candidateName, evaluator });
    
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.RATELOG,
    });

    const existingData = response.result.values || [];
    console.log('📊 Total rows in sheet:', existingData.length);
    
    const matchingRatings = existingData.filter(row => {
      const matches = matchesRatingRow(row, item, candidateName, evaluator);
      if (matches) {
        console.log('✅ Found matching rating:', row);
      }
      return matches;
    });
    
    console.log('📋 Found', matchingRatings.length, 'existing ratings');
    return matchingRatings;
    
  } catch (error) {
    console.error('❌ Error checking existing ratings:', error);
    // Clear cache on error to force fresh fetch next time
    const cacheKey = `${item}:${candidateName}:${evaluator}`;
    ratingsCache.delete(cacheKey);
    return [];
  }
}

// Improved matching function to ensure accurate detection
function matchesRatingRow(row, item, candidateName, evaluator) {
  if (!row || row.length < 6) return false;
  
  const [ratingCode, rowItem, rowCandidate, competency, rating, rowEvaluator] = row;
  
  // More precise matching with trimming and case handling
  const itemMatch = (rowItem || '').trim() === (item || '').trim();
  const candidateMatch = (rowCandidate || '').trim() === (candidateName || '').trim();
  const evaluatorMatch = (rowEvaluator || '').trim() === (evaluator || '').trim();
  
  const matches = itemMatch && candidateMatch && evaluatorMatch;
  
  if (matches) {
    console.log('🎯 Rating row match found:', {
      ratingCode,
      item: rowItem,
      candidate: rowCandidate,
      evaluator: rowEvaluator,
      competency
    });
  }
  
  return matches;
}

async function checkForUpdates(ratings) {
  const firstRating = ratings[0];
  if (!firstRating) return false;
  
  console.log('🔄 Checking for updates with rating:', firstRating);
  
  const existingRatings = await checkExistingRatingsCached(
    firstRating[1], // item
    firstRating[2], // candidateName  
    firstRating[5]  // evaluator
  );
  
  const hasUpdates = existingRatings.length > 0;
  console.log('📊 Has updates:', hasUpdates, '(found', existingRatings.length, 'existing ratings)');
  
  return hasUpdates;
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
  console.log('📝 Ratings to submit:', ratings);
  return { ratings };
}

function showSubmissionProgress(submission) {
  const message = submission.attempts > 1 
    ? `Submitting... (attempt ${submission.attempts}/${SUBMISSION_CONFIG.MAX_RETRIES})`
    : 'Submitting...';
    
  showToastOptimized('info', 'Processing', message);
}

// =====================================
// UI FUNCTIONS
// =====================================

function showSubmittingIndicator() {
  // Remove any existing indicator first
  hideSubmittingIndicator();
  
  const indicator = document.createElement('div');
  indicator.id = 'submittingIndicator';
  indicator.className = 'submitting-indicator';
  indicator.innerHTML = `
    <div class="submitting-content">
      <span class="spinner"></span>
      <span>SUBMITTING...</span>
    </div>
  `;
  document.body.appendChild(indicator);
  console.log('🔄 Submitting indicator shown');
}

function hideSubmittingIndicator() {
  const indicator = document.getElementById('submittingIndicator');
  if (indicator) {
    indicator.remove();
    console.log('🔄 Submitting indicator removed');
  }
}

async function showConfirmationModal(ratings, existingRatings, isUpdate) {
  return new Promise((resolve) => {
    const psychoSocialRating = document.getElementById('psychosocial-rating-value')?.textContent || '0.00';
    const potentialRating = document.getElementById('potential-rating-value')?.textContent || '0.00';

    let modalContent = `
      <div class="modal-body">
        <p>Are you sure you want to ${isUpdate ? 'update' : 'submit'} the following ratings?</p>
        <div class="modal-field"><span class="modal-label">EVALUATOR:</span> <span class="modal-value">${currentEvaluator === "In-charge, Administrative Division" ? "Chief, Administrative Division" : currentEvaluator}</span></div>
        <div class="modal-field"><span class="modal-label">ASSIGNMENT:</span> <span class="modal-value">${elements.assignmentDropdown.value}</span></div>
        <div class="modal-field"><span class="modal-label">POSITION:</span> <span class="modal-value">${elements.positionDropdown.value}</span></div>
        <div class="modal-field"><span class="modal-label">ITEM:</span> <span class="modal-value">${ratings[0][1]}</span></div>
        <div class="modal-field"><span class="modal-label">NAME:</span> <span class="modal-value">${ratings[0][2]}</span></div>
        <div class="modal-section">
          <h4>RATINGS TO ${isUpdate ? 'UPDATE' : 'SUBMIT'}:</h4>
          <div class="modal-field"><span class="modal-label">PSYCHO-SOCIAL:</span> <span class="modal-value rating-value">${psychoSocialRating}</span></div>
          <div class="modal-field"><span class="modal-label">POTENTIAL:</span> <span class="modal-value rating-value">${potentialRating}</span></div>
    `;

    if (isUpdate && existingRatings.length > 0) {
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
      () => resolve(true),
      () => resolve(false)
    );
  });
}

async function verifyEvaluatorPassword(existingRatings) {
  return new Promise((resolve) => {
    const modalContent = `
      <p>Please verify password for ${currentEvaluator === "In-charge, Administrative Division" ? "Chief, Administrative Division" : currentEvaluator} to update ratings:</p>
      <input type="password" id="verificationPassword" class="modal-input">
    `;
    showModal('Password Verification', modalContent, () => {
      const password = document.getElementById('verificationPassword').value;
      if (password === EVALUATOR_PASSWORDS[currentEvaluator]) {
        resolve(true);
      } else {
        showToastOptimized('error', 'Invalid Password', 'Password verification failed');
        resolve(false);
      }
    }, () => {
      revertToExistingRatings(existingRatings);
      resolve(false);
    });
  });
}

function revertToExistingRatings(existingRatings) {
  if (!existingRatings || existingRatings.length === 0) return;
  
  console.log('🔄 Reverting to existing ratings:', existingRatings);
  
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

function showToastOptimized(type, title, message) {
  // Remove existing toasts of the same type to prevent spam
  const existingToasts = document.querySelectorAll(`.toast.${type}`);
  existingToasts.forEach(toastElement => {
    const container = toastElement.closest('.toast-container');
    if (container) container.remove();
  });
  
  // Use your existing showToast function
  showToast(type, title, message);
}

// =====================================
// SUCCESS HANDLING
// =====================================

function handleSuccessfulSubmission(ratings) {
  const candidateName = ratings[0][2];
  const item = ratings[0][1];
  const evaluator = ratings[0][5];
  
  // Clear both old and new storage systems
  localStorage.removeItem(`radioState_${candidateName}_${item}`);
  clearPendingRating(evaluator, item, candidateName);
  
  // Clear cache for this specific rating to force fresh fetch
  const cacheKey = `${item}:${candidateName}:${evaluator}`;
  ratingsCache.delete(cacheKey);
  
  console.log(`🧹 Cleared all stored data for successful submission:`, {
    evaluator, item, candidateName, cacheKey
  });
}

// =====================================
// DEBUG FUNCTIONS
// =====================================

function debugRatingSync(evaluator, item, name) {
  console.group(`🔍 Rating Sync Debug: ${evaluator} | ${item} | ${name}`);
  
  const cacheKey = `${item}:${name}:${evaluator}`;
  const pendingKey = `pending:${evaluator}:${item}:${name}:${apiManager.deviceId}`;
  const oldKey = `radioState_${name}_${item}`;
  
  console.log('Cache Key:', cacheKey);
  console.log('Pending Key:', pendingKey);
  console.log('Old RadioState Key:', oldKey);
  console.log('Device ID:', apiManager.deviceId);
  console.log('Cached Data:', ratingsCache.get(cacheKey));
  console.log('Pending Data:', getPendingRating(evaluator, item, name));
  console.log('Old RadioState Data:', localStorage.getItem(oldKey));
  
  const allKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && (key.startsWith('pending:') || key.startsWith('radioState_'))) {
      allKeys.push(key);
    }
  }
  console.log('All Rating-Related Keys in Storage:', allKeys);
  
  console.groupEnd();
}

// Make debug function available globally
window.debugRatingSync = debugRatingSync;

// Function to manually clear all rating caches (for debugging)
function clearAllRatingCaches() {
  ratingsCache.clear();
  console.log('🧹 All rating caches cleared');
}

window.clearAllRatingCaches = clearAllRatingCaches;

// =====================================
// CLEANUP AND UTILITIES
// =====================================

// Clean up cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of ratingsCache.entries()) {
    if (now - value.timestamp > CACHE_DURATION * 2) {
      ratingsCache.delete(key);
    }
  }
}, CACHE_DURATION);

// Utility function for delays
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('✅ Optimized submission system loaded with 5 retries and improved existing ratings detection');












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
    <button type="button" id="reset-ratings" class="btn-reset">RESET RATINGS</button>
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
        <div class="data-row"><span class="data-label">EVALUATOR:</span> <span class="data-value">${(currentEvaluator === "In-charge, Administrative Division" ? "Chief, Administrative Division" : currentEvaluator) || 'N/A'}</span></div>
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

    // Inside displayCompetencies function - replace the reset button event listener:
  document.getElementById('reset-ratings').addEventListener('click', () => {
    showModal(
      'CONFIRM RESET',
      '<p>Are you sure you want to reset all ratings? This action cannot be undone.</p>',
      () => {
        // Use global clearRatings function
        clearRatings();
        
        // Additionally reset the rating arrays (only accessible here)
        basicRatings.fill(0);
        orgRatings.fill(0);
        leadershipRatings.fill(0);
        minimumRatings.fill(0);
        
        // Update all computations to ensure everything is 0.00
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




// ------------------------------
// Backwards-compatible pending-rating helpers
// ------------------------------
// Add these if older UI code calls savePendingRating/getPendingRating/clearPendingRating

function savePendingRating(evaluator, item, name, ratingData) {
  // Prefer the new manager if present
  if (typeof pendingRatingsManager !== 'undefined' && pendingRatingsManager.save) {
    return pendingRatingsManager.save(evaluator, item, name, ratingData);
  }
  // Fallback: store in localStorage using same key format
  try {
    const key = `pending_rating:${apiManager?.deviceId || 'device_unknown'}:${evaluator}:${item}:${name}`;
    localStorage.setItem(key, JSON.stringify({ ...ratingData, evaluator, item, name, timestamp: Date.now() }));
    console.log(`💾 (fallback) Saved pending rating for "${name}" on item "${item}".`);
  } catch (e) {
    console.warn('Failed to save pending rating fallback:', e);
  }
}

function getPendingRating(evaluator, item, name) {
  if (typeof pendingRatingsManager !== 'undefined' && pendingRatingsManager.get) {
    return pendingRatingsManager.get(evaluator, item, name);
  }
  try {
    const key = `pending_rating:${apiManager?.deviceId || 'device_unknown'}:${evaluator}:${item}:${name}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch (e) {
    console.warn('Failed to get pending rating fallback:', e);
    return null;
  }
}

function clearPendingRating(evaluator, item, name) {
  if (typeof pendingRatingsManager !== 'undefined' && pendingRatingsManager.clear) {
    return pendingRatingsManager.clear(evaluator, item, name);
  }
  try {
    const key = `pending_rating:${apiManager?.deviceId || 'device_unknown'}:${evaluator}:${item}:${name}`;
    localStorage.removeItem(key);
    console.log(`🧹 (fallback) Cleared pending rating for "${name}" on item "${item}".`);
  } catch (e) {
    console.warn('Failed to clear pending rating fallback:', e);
  }
}










function saveRadioState(competencyName, value, candidateName, item) {
  // Use the new pending system instead of the old radioState system
  const currentRatings = getCurrentFormRatings();
  currentRatings[competencyName] = value;
  
  savePendingRating(currentEvaluator, item, candidateName, currentRatings);
}

function loadRadioState(candidateName, item) {
  // Load from pending system
  const pending = getPendingRating(currentEvaluator, item, candidateName);
  
  if (pending && typeof pending === 'object') {
    const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
    
    Array.from(competencyItems).forEach(itemElement => {
      const competencyName = itemElement.querySelector('label').textContent.split('. ')[1];
      const value = pending[competencyName];
      
      if (value) {
        const radio = itemElement.querySelector(`input[type="radio"][value="${value}"]`);
        if (radio) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change'));
          console.log(`🔄 Restored pending rating for ${competencyName}: ${value}`);
        }
      }
    });
  }
}


function getCurrentFormRatings() {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  const ratings = {};
  
  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const checkedRadio = item.querySelector('input[type="radio"]:checked');
    if (checkedRadio) {
      ratings[competencyName] = checkedRadio.value;
    }
  });
  
  return ratings;
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




async function fetchSecretariatMembers() {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'SECRETARIAT_MEMBERS!A:D', // Updated to include column D for vacancies
    });
    SECRETARIAT_MEMBERS = response.result.values?.slice(1)?.map(row => ({
      id: row[0],
      name: row[1],
      password: row[2],
      vacancies: row[3]?.split(',').map(item => item.trim().toUpperCase()) || [], // Normalize to uppercase
    })) || [];
    console.log('Secretariat members fetched:', SECRETARIAT_MEMBERS);
    // Log all item numbers for debugging
    SECRETARIAT_MEMBERS.forEach(member => {
      console.log(`Member ${member.name} (ID: ${member.id}) assigned vacancies:`, member.vacancies);
    });
  } catch (error) {
    console.error('Error fetching secretariat members:', error);
    showToast('error', 'Error', 'Failed to fetch secretariat members');
  }
}

async function saveSecretariatMember(memberData) {
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    // Validate vacancies against available ones
    const validVacancies = vacancies.slice(1).map(row => row[0]?.trim().toUpperCase());
    const invalidVacancies = memberData.vacancies.filter(v => !validVacancies.includes(v.toUpperCase()));
    if (invalidVacancies.length > 0) {
      showToast('error', 'Error', `Invalid vacancies: ${invalidVacancies.join(', ')}`);
      return;
    }
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'SECRETARIAT_MEMBERS!A:D',
      valueInputOption: 'RAW',
      resource: { values: [[memberData.id, memberData.name, memberData.password, memberData.vacancies.join(',')]] },
    });
    console.log('Secretariat member saved:', memberData);
    await fetchSecretariatMembers();
  } catch (error) {
    console.error('Error saving secretariat member:', error);
    showToast('error', 'Error', 'Failed to save secretariat member');
  }
}

async function generatePdfSummary() {
  const base64Logo = 'data:image/png;base64,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';
  showToast('info', 'Generating PDF...', 'Please wait while the PDF is being created.');

  const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');
  const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
  const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');

  const currentItemNumber = secretariatItemDropdown?.value;
  const currentAssignment = secretariatAssignmentDropdown?.value;
  const currentPositionTitle = secretariatPositionDropdown?.value;

  if (!currentItemNumber) {
    showToast('error', 'Error', 'Please select an Item Number first.');
    return;
  }

  try {
    if (!await isTokenValid()) await refreshAccessToken();

    const [generalResponse, candidatesResponse, disqualifiedResponse] = await Promise.all([
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.GENERAL_LIST,
      }),
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.CANDIDATES,
      }),
      gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.DISQUALIFIED,
      }),
    ]);

    const candidatesData = generalResponse.result.values || [];
    const candidatesSheet = candidatesResponse.result.values || [];
    const disqualifiedSheet = disqualifiedResponse.result.values || [];

    const submissions = new Map();
    candidatesSheet.forEach(row => {
      if (row[0] && row[1] && row[16]) {
        const key = `${row[0]?.trim()}|${row[1]?.trim()}|${row[16]?.trim()}`;
        submissions.set(key, { status: 'CANDIDATES' });
      }
    });
    disqualifiedSheet.forEach(row => {
      if (row[0] && row[1] && row[4]) {
        const key = `${row[0]?.trim()}|${row[1]?.trim()}|${row[4]?.trim()}`;
        submissions.set(key, { status: 'DISQUALIFIED' });
      }
    });

    const filteredCandidates = candidatesData
      .filter(row => row[1]?.trim() === currentItemNumber?.trim())
      .map(row => {
        const name = row[0]?.trim();
        const keyToSearch = `${name}|${currentItemNumber?.trim()}|${secretariatMemberId?.trim()}`;
        
        let status = 'NOT_SUBMITTED';
        if (submissions.has(keyToSearch)) {
            status = submissions.get(keyToSearch).status;
        }
        
        return {
          name: name,
          submittedStatus: status,
        };
      });

    const longListCandidates = filteredCandidates.filter(c => c.submittedStatus === 'CANDIDATES').map(c => c.name);
    const disqualifiedCandidates = filteredCandidates.filter(c => c.submittedStatus === 'DISQUALIFIED').map(c => c.name);

    if (longListCandidates.length === 0 && disqualifiedCandidates.length === 0) {
      showToast('info', 'No Data', 'No candidates found for the selected item number and your secretariat ID.');
      return;
    }

    // --- START: More robust jsPDF initialization ---
    let jsPDF;
    if (window.jspdf && window.jspdf.jsPDF) {
      jsPDF = window.jspdf.jsPDF;
    } else if (window.jsPDF) { // Fallback for some versions where it's directly on window
      jsPDF = window.jsPDF;
    } else {
      console.error("jsPDF library not found or not initialized correctly.");
      showToast('error', 'Error', 'PDF generation failed: jsPDF library not loaded. Please ensure jspdf.umd.min.js is correctly linked and loaded.');
      return;
    }
    // --- END: More robust jsPDF initialization ---

    // Define custom paper size: 8x13 inches in points (1 inch = 72 points)
    const doc = new jsPDF({
      format: [576, 936], // [width, height] in points
      unit: 'pt' // Use points as the unit
    });

    // Set a professional font (Helvetica is standard and clean)
    doc.setFont("helvetica");

    // --- FOOTER INFORMATION ---
    const now = new Date();
    const dateTimeString = now.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: true
    });
    const footerText = `Item: ${currentItemNumber} | Generated: ${dateTimeString}`;

    // --- FOOTER FUNCTION ---
    function addFooter() {
      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const currentPage = doc.internal.getCurrentPageInfo().pageNumber;
      const totalPages = doc.internal.getNumberOfPages();
      
      // Save current font settings
      const currentFontSize = doc.getFontSize();
      const currentFont = doc.getFont();
      
      // Set footer font
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      
      // Draw footer line
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(0.5);
      doc.line(50, pageHeight - 30, pageWidth - 50, pageHeight - 30);
      
      // Add footer text (left side)
      doc.text(footerText, 50, pageHeight - 18);
      
      // Add page numbers (right side)
      doc.text(`Page ${currentPage} of ${totalPages}`, pageWidth - 50, pageHeight - 18, { align: 'right' });
      
      // Restore original font settings
      doc.setFontSize(currentFontSize);
      doc.setFont(currentFont.fontName, currentFont.fontStyle);
    }

    // --- IMPORTANT MARGIN AND INITIAL Y-OFFSET ADJUSTMENTS ---
    // Start yOffset for the logo near the top, allowing some margin
    let yOffset = 20; 
    const margin = 50; 
    // --- END MARGIN ADJUSTMENTS ---
    
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    
    // --- START: Logo and New Header Text ---
    // Add the logo with adjusted size
    const logoWidth = 60;   // Reduced logo width for better fit (e.g., 60 points)
    const logoHeight = 60;  // Reduced logo height for better fit (e.g., 60 points)
    const logoX = (pageWidth - logoWidth) / 2; // Keep centered horizontally
    const logoY = yOffset; // Place logo at current yOffset (still 20pt from top)
    
    doc.addImage(base64Logo, 'PNG', logoX, logoY, logoWidth, logoHeight);

    // Adjust yOffset for the text headers to start after the logo with more spacing
    yOffset = logoY + logoHeight + 15; // Logo bottom + 15pt padding (increased for more space)
    // The 'DEPARTMENT OF ENVIRONMENT...' text will now start from this new yOffset.
    
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text('DEPARTMENT OF ENVIRONMENT AND NATURAL RESOURCES (CALABARZON)', pageWidth / 2, yOffset, { align: 'center' });
    yOffset += 15; // Spacing after first new header line
    
    doc.setFontSize(10);
    doc.text('REGIONAL HUMAN RESOURCE SELECTION AND PROMOTION BOARD', pageWidth / 2, yOffset, { align: 'center' });
    yOffset += 25; // Spacing before the main title
    
    // Main Title of the Document
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold"); // Set header title to bold
    doc.text('SUMMARY OF THE DELIBERATION OF CANDIDATES FOR LONG LIST', pageWidth / 2, yOffset, { align: 'center' });
    doc.setFont("helvetica", "normal"); // Revert font after title
    yOffset += 30; // Increased spacing after title block
    // --- END: Logo and New Header Text ---


    // PDF HEADER: POSITION, ASSIGNMENT, ITEM (Aligned like tabs)
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold"); // Set header labels to bold

    // Calculate label width dynamically to ensure consistent alignment
    const labelWidth = Math.max(
        doc.getStringUnitWidth('POSITION:') * doc.getFontSize(),
        doc.getStringUnitWidth('ASSIGNMENT:') * doc.getFontSize(),
        doc.getStringUnitWidth('ITEM:') * doc.getFontSize()
    ) / doc.internal.scaleFactor;
    const valueX = margin + labelWidth + 5; 

    doc.text(`POSITION:`, margin, yOffset);
    doc.setFont("helvetica", "normal"); // Revert font for value
    doc.text(`${currentPositionTitle || 'N/A'}`, valueX, yOffset);
    doc.setFont("helvetica", "bold"); // Re-set bold for next label
    yOffset += 15; 

    doc.text(`ASSIGNMENT:`, margin, yOffset);
    doc.setFont("helvetica", "normal"); // Revert font for value
    doc.text(`${currentAssignment || 'N/A'}`, valueX, yOffset);
    doc.setFont("helvetica", "bold"); // Re-set bold for next label
    yOffset += 15; 

    doc.text(`ITEM:`, margin, yOffset);
    doc.setFont("helvetica", "normal"); // Revert font for value
    doc.text(`${currentItemNumber}`, valueX, yOffset);
    yOffset += 20; // Increased spacing before date/time

    // PRESENT DATE AND TIME
    doc.setFontSize(8);
    const fullDateTimeString = now.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: true
    });
    doc.text(`Generated on: ${fullDateTimeString}`, margin, yOffset);
    yOffset += 30; // Increased spacing before first list

    // Helper function for 2-column lists with vertical ordering - Updated with footer consideration
    function drawTwoColumnList(title, candidates, currentY, isBoldTitle = true) {
      // Check for page break before drawing list title (account for footer space)
      if (currentY > pageHeight - margin - 60) { // Increased margin for footer
          doc.addPage();
          addFooter(); // Add footer to previous page
          currentY = margin + 5; 
      }

      doc.setFontSize(13);
      doc.setFont("helvetica", isBoldTitle ? "bold" : "normal");
      doc.text(title, margin, currentY);
      doc.setFont("helvetica", "normal");
      currentY += 20; // Increased spacing after list title

      doc.setFontSize(10);
      const colWidth = (pageWidth - (2 * margin) - 30) / 2; // 30pt gutter for more separation
      const col1X = margin; 
      const col2X = margin + colWidth + 30; 

      const halfCount = Math.ceil(candidates.length / 2);
      let col1CurrentY = currentY;
      let col2CurrentY = currentY;
      const baseLineHeight = 15; // Base line height for single line items

      // Draw first column (items 1, 3, 5...)
      for (let i = 0; i < halfCount; i++) {
        if (col1CurrentY > pageHeight - margin - 80) { // Account for footer space
            doc.addPage();
            addFooter(); // Add footer to previous page
            col1CurrentY = margin + 5;
            col2CurrentY = margin + 5; // Reset both columns on new page
            doc.setFontSize(10);
        }
        
        const itemNumber = `${i + 1}. `;
        const candidateName = candidates[i];
        const nameLines = doc.splitTextToSize(candidateName, colWidth - doc.getStringUnitWidth(itemNumber) * doc.getFontSize() / doc.internal.scaleFactor);
        
        // Calculate indent for continuation lines (width of number + ". ")
        const indentWidth = doc.getStringUnitWidth(itemNumber) * doc.getFontSize() / doc.internal.scaleFactor;
        
        // Draw first line with number
        doc.text(`${itemNumber}${nameLines[0]}`, col1X, col1CurrentY);
        
        // Draw continuation lines with indent
        for (let lineIndex = 1; lineIndex < nameLines.length; lineIndex++) {
          col1CurrentY += doc.getFontSize() * 1.2;
          doc.text(nameLines[lineIndex], col1X + indentWidth, col1CurrentY);
        }
        
        // Move to next item position
        col1CurrentY += doc.getFontSize() * 1.2 + 2; // Base line height + padding
      }

      // Draw second column (items 2, 4, 6...)
      for (let i = halfCount; i < candidates.length; i++) {
        if (col2CurrentY > pageHeight - margin - 80) { // Account for footer space
            doc.addPage();
            addFooter(); // Add footer to previous page
            col1CurrentY = margin + 5;
            col2CurrentY = margin + 5; // Reset both columns on new page
            doc.setFontSize(10);
        }
        
        const itemNumber = `${i + 1}. `;
        const candidateName = candidates[i];
        const nameLines = doc.splitTextToSize(candidateName, colWidth - doc.getStringUnitWidth(itemNumber) * doc.getFontSize() / doc.internal.scaleFactor);
        
        // Calculate indent for continuation lines (width of number + ". ")
        const indentWidth = doc.getStringUnitWidth(itemNumber) * doc.getFontSize() / doc.internal.scaleFactor;
        
        // Draw first line with number
        doc.text(`${itemNumber}${nameLines[0]}`, col2X, col2CurrentY);
        
        // Draw continuation lines with indent
        for (let lineIndex = 1; lineIndex < nameLines.length; lineIndex++) {
          col2CurrentY += doc.getFontSize() * 1.2;
          doc.text(nameLines[lineIndex], col2X + indentWidth, col2CurrentY);
        }
        
        // Move to next item position
        col2CurrentY += doc.getFontSize() * 1.2 + 2; // Base line height + padding
      }
      
      let finalY = Math.max(col1CurrentY, col2CurrentY); // Use the lowest point of either column
      
      finalY += 10; // Increased space before breaker
      doc.text('*** END OF LIST ***', pageWidth / 2, finalY, { align: 'center' });
      finalY += 25; // Increased space after breaker
      return finalY;
    }

    // Long List Candidates
    if (longListCandidates.length > 0) {
      yOffset = drawTwoColumnList('LONG LIST CANDIDATES:', longListCandidates, yOffset);
    }

    // Disqualified Candidates
    if (disqualifiedCandidates.length > 0) {
      yOffset = drawTwoColumnList('DISQUALIFIED CANDIDATES:', disqualifiedCandidates, yOffset);
    } else {
        yOffset += 20; // Increased buffer if no disqualified list
    }

    // Signatories (dynamic with lines and assignment)
    if (SIGNATORIES.length > 0) {
        const avgSignatoryHeightEstimate = 80; 
        const totalEstimatedSignatoryHeight = (Math.ceil(SIGNATORIES.length / 2) * avgSignatoryHeightEstimate) + 50; 

        if (yOffset + totalEstimatedSignatoryHeight > pageHeight - margin - 60) { // Account for footer
            doc.addPage();
            addFooter(); // Add footer to previous page
            yOffset = margin + 10; 
        }

        // CERTIFYING CLAUSE
        doc.setFontSize(9);
        const certifyingClause = "This certifies that the details contained herein have been thoroughly reviewed and validated.";
        doc.text(certifyingClause, margin, yOffset, { maxWidth: pageWidth - (2 * margin) });
        yOffset += 25; 

        doc.setFontSize(11);
        doc.text("Noted by:", margin, yOffset);
        yOffset += 40; // Adjusted vertical spacing between "Noted by:" and first signatory

        const sigColWidth = (pageWidth - (2 * margin) - 40) / 2; 
        const sigCol1X = margin + sigColWidth / 2;
        const sigCol2X = margin + sigColWidth + 40 + sigColWidth / 2; 

        let currentSigY = yOffset;
        const nameToPositionStartGap = 0; // Adjusted gap to be zero for direct spacing
        const positionToEndOfLineGap = 2; // Keep a small gap from last line of position to start of assignment

        // Define line heights for specific font sizes
        const lineHeightFor8pt = 8 * 1.2; 
        const lineHeightFor9pt = 9 * 1.2; 
        const lineHeightFor11pt = 11 * 1.2; // For name

        for (let i = 0; i < SIGNATORIES.length; i += 2) {
            let maxSignatoryBlockHeight = 0; 

            const sig1 = SIGNATORIES[i];
            const sig2 = SIGNATORIES[i+1];

            // Calculate height for Signatory 1
            let sig1DynamicHeight = 0;
            if (sig1) {
                const positionLines1 = doc.splitTextToSize(sig1.position, sigColWidth);
                const assignmentLines1 = doc.splitTextToSize(sig1.assignment, sigColWidth);
                sig1DynamicHeight = lineHeightFor11pt + // height of name
                                    nameToPositionStartGap + 
                                    (positionLines1.length * lineHeightFor8pt) + 
                                    positionToEndOfLineGap + 
                                    (assignmentLines1.length * lineHeightFor9pt);
            }

            // Calculate height for Signatory 2
            let sig2DynamicHeight = 0;
            if (sig2) {
                const positionLines2 = doc.splitTextToSize(sig2.position, sigColWidth);
                const assignmentLines2 = doc.splitTextToSize(sig2.assignment, sigColWidth);
                sig2DynamicHeight = lineHeightFor11pt + // height of name
                                    nameToPositionStartGap + 
                                    (positionLines2.length * lineHeightFor8pt) + 
                                    positionToEndOfLineGap + 
                                    (assignmentLines2.length * lineHeightFor9pt);
            }
            
            maxSignatoryBlockHeight = Math.max(sig1DynamicHeight, sig2DynamicHeight);

            if (currentSigY + maxSignatoryBlockHeight + 30 > pageHeight - margin - 60) { // Account for footer
                doc.addPage();
                addFooter(); // Add footer to previous page
                currentSigY = margin + 10; 
            }

            // Draw Signatory 1
            if (sig1) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.text(sig1.name, sigCol1X, currentSigY, { align: 'center', maxWidth: sigColWidth });
                doc.setFont("helvetica", "normal");
                
                doc.setFontSize(8); // Set font size for position
                const positionLines1 = doc.splitTextToSize(sig1.position, sigColWidth);
                let currentTextY1 = currentSigY + lineHeightFor11pt + nameToPositionStartGap; // Start after name's line height
                doc.text(positionLines1, sigCol1X, currentTextY1, { align: 'center' });
                
                currentTextY1 += (positionLines1.length * lineHeightFor8pt) + positionToEndOfLineGap; 

                doc.setFontSize(9); // Set font size for assignment
                doc.setFont("helvetica", "italic"); // Set assignment to italic
                const assignmentLines1 = doc.splitTextToSize(sig1.assignment, sigColWidth);
                doc.text(assignmentLines1, sigCol1X, currentTextY1, { align: 'center' });
                doc.setFont("helvetica", "normal"); // Revert font to normal
            }

            // Draw Signatory 2
            if (sig2) {
                doc.setFont("helvetica", "bold");
                doc.setFontSize(11);
                doc.text(sig2.name, sigCol2X, currentSigY, { align: 'center', maxWidth: sigColWidth });
                doc.setFont("helvetica", "normal");
                
                doc.setFontSize(8); // Set font size for position
                const positionLines2 = doc.splitTextToSize(sig2.position, sigColWidth);
                let currentTextY2 = currentSigY + lineHeightFor11pt + nameToPositionStartGap; // Start after name's line height
                doc.text(positionLines2, sigCol2X, currentTextY2, { align: 'center' });
                
                currentTextY2 += (positionLines2.length * lineHeightFor8pt) + positionToEndOfLineGap;

                doc.setFontSize(9); // Set font size for assignment
                doc.setFont("helvetica", "italic"); // Set assignment to italic
                const assignmentLines2 = doc.splitTextToSize(sig2.assignment, sigColWidth);
                doc.text(assignmentLines2, sigCol2X, currentTextY2, { align: 'center' });
                doc.setFont("helvetica", "normal"); // Revert font to normal
            }
            
            currentSigY += maxSignatoryBlockHeight + 40; // Adjusted vertical spacing between signatory blocks
        }
        yOffset = currentSigY;
    }

    // Add footer to ALL pages (including the first page)
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        addFooter();
    }

    doc.save(`Summary_${currentItemNumber}.pdf`);
    showToast('success', 'Success', 'PDF generated successfully!');

  } catch (error) {
    console.error('Error generating PDF:', error);
    showToast('error', 'Error', 'Failed to generate PDF. Check console for details.');
  }
}




async function saveSignatories() {
  try {
    if (!await isTokenValid()) await refreshAccessToken();

    // Clear the existing signatory range before writing the new list
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.SECRETARIAT_SIGNATORIES, // Clears E:G
    });

    if (SIGNATORIES.length > 0) {
      const valuesToSave = SIGNATORIES.map(sig => [sig.name, sig.position, sig.assignment]); // Include assignment
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.SECRETARIAT_SIGNATORIES, // Appends to E:G
        valueInputOption: 'RAW',
        resource: {
          values: valuesToSave
        },
      });
    }
    console.log('Signatories saved:', SIGNATORIES);
  } catch (error) {
    console.error('Error saving signatories:', error);
    showToast('error', 'Error', 'Failed to save signatories.');
  }
}

function manageSignatories() {
  console.log('manageSignatories function called!');
  // elements.signatoriesModal.style.display = 'block'; // REMOVE THIS LINE
  elements.signatoriesModal.classList.add('active'); // ADD THIS LINE
  updateSignatoriesTableInModal();
}


function updateSignatoriesTableInModal() {
  const ul = elements.signatoriesUl;
  ul.innerHTML = '';
  if (SIGNATORIES.length === 0) {
    ul.innerHTML = '<li>No signatories added yet.</li>';
    return;
  }
  SIGNATORIES.forEach((sig, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>
        <strong>${sig.name}</strong><br>
        <em>${sig.position}</em><br>
        <em>${sig.assignment}</em>
      </span>
      <div class="signatory-actions">
        <button class="move-signatory-up-btn" data-index="${index}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="move-signatory-down-btn" data-index="${index}" ${index === SIGNATORIES.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="delete-signatory-btn" data-index="${index}">Delete</button>
      </div>
    `;
    ul.appendChild(li);
  });

  // Add event listeners for delete and reorder buttons
  ul.querySelectorAll('.delete-signatory-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const index = parseInt(event.target.dataset.index);
      deleteSignatory(index);
    });
  });

  ul.querySelectorAll('.move-signatory-up-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const index = parseInt(event.target.dataset.index);
      moveSignatoryUp(index);
    });
  });

  ul.querySelectorAll('.move-signatory-down-btn').forEach(button => {
    button.addEventListener('click', (event) => {
      const index = parseInt(event.target.dataset.index);
      moveSignatoryDown(index);
    });
  });
}


async function moveSignatoryUp(index) {
  if (index > 0) {
    [SIGNATORIES[index], SIGNATORIES[index - 1]] = [SIGNATORIES[index - 1], SIGNATORIES[index]]; // Swap
    await saveSignatories();
    updateSignatoriesTableInModal();
    showToast('success', 'Success', 'Signatory moved up.');
  }
}

async function moveSignatoryDown(index) {
  if (index < SIGNATORIES.length - 1) {
    [SIGNATORIES[index], SIGNATORIES[index + 1]] = [SIGNATORIES[index + 1], SIGNATORIES[index]]; // Swap
    await saveSignatories();
    updateSignatoriesTableInModal();
    showToast('success', 'Success', 'Signatory moved down.');
  }
}


async function loadSignatories() { // Keeping your preferred function name
  try {
    if (!await isTokenValid()) await refreshAccessToken();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.SECRETARIAT_SIGNATORIES, // This range MUST be updated to E:G
    });
    const values = response.result.values || [];
    SIGNATORIES = values.map(row => ({
      name: row[0] || '',     // Data from Column E
      position: row[1] || '', // Data from Column F
      assignment: row[2] || '', // NEW: Data from Column G
    }));
    console.log('Signatories loaded from sheet:', SIGNATORIES);
  } catch (error) {
    console.error('Error loading signatories from sheet:', error);
    showToast('error', 'Error', 'Failed to load signatories from Google Sheet.');
    SIGNATORIES = []; // Initialize empty if loading fails
  }
}



async function addSignatory() {
  const name = elements.newSignatoryName.value.trim();
  const position = elements.newSignatoryPosition.value.trim();
  const assignment = elements.newSignatoryAssignment.value.trim(); // ADD THIS LINE

  if (name && position && assignment) { // Ensure assignment is also present
    SIGNATORIES.push({ name, position, assignment }); // Include assignment
    await saveSignatories();
    updateSignatoriesTableInModal();
    elements.newSignatoryName.value = '';
    elements.newSignatoryPosition.value = '';
    elements.newSignatoryAssignment.value = ''; // Clear new assignment field
    showToast('success', 'Success', 'Signatory added successfully.');
  } else {
    showToast('error', 'Error', 'Name, Position, and Assignment are all required for a signatory.');
  }
}



async function deleteSignatory(index) {
  if (confirm('Are you sure you want to delete this signatory?')) {
    SIGNATORIES.splice(index, 1);
    await saveSignatories(); // Now saves to sheet
    updateSignatoriesTableInModal();
    showToast('success', 'Success', 'Signatory deleted successfully.');
  }
}


// Add this function to your script.js
async function fetchVacanciesData() {
  try {
    if (!gapiInitialized) return;
    
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.VACANCIES,
    });
    
    const values = response.result.values;
    if (values && values.length > 1) {
      vacanciesData = values.slice(1); // Skip header row
      console.log('Vacancies data loaded:', vacanciesData.length, 'records');
    }
  } catch (error) {
    console.error('Error fetching vacancies data:', error);
  }
}


// Add this function to your script.js
function getVacancyDetails(itemNumber) {
  // Find vacancy by item number (assuming item number is in column A)
  const vacancy = vacanciesData.find(row => row[0] === itemNumber);
  
  if (vacancy) {
    return {
      education: vacancy[4] || 'N/A',    // Column E
      training: vacancy[5] || 'N/A',     // Column F
      experience: vacancy[6] || 'N/A',   // Column G
      eligibility: vacancy[7] || 'N/A'   // Column H
    };
  }
  
  return {
    education: 'N/A',
    training: 'N/A',
    experience: 'N/A',
    eligibility: 'N/A'
  };
}




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

// Patch buttons that exist now
function patchOpenLinkButtons(root = document) {
  root.querySelectorAll('button.open-link-button').forEach(b => {
    if (!b.hasAttribute('type')) {
      b.setAttribute('type', 'button');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
  patchOpenLinkButtons();

  // Watch for new buttons being added dynamically
  const observer = new MutationObserver(mutations => {
    for (const m of mutations) {
      m.addedNodes.forEach(node => {
        if (node.nodeType === 1) {
          if (node.matches?.('button.open-link-button')) {
            patchOpenLinkButtons(node.parentNode || node);
          } else if (node.querySelectorAll) {
            patchOpenLinkButtons(node);
          }
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
});


document.addEventListener("DOMContentLoaded", () => {
  const creatorLink = document.getElementById("creatorLink");
  const creatorModal = document.getElementById("creatorModal");
  const closeCreatorModal = document.getElementById("closeCreatorModal");
  const closeCreatorBtn = document.getElementById("closeCreatorBtn");

  creatorLink.addEventListener("click", () => {
    creatorModal.style.display = "flex";
  });

  closeCreatorModal.addEventListener("click", () => {
    creatorModal.style.display = "none";
  });

  creatorModal.addEventListener("click", (e) => {
    if (e.target === creatorModal) {
      creatorModal.style.display = "none";
    }
  });
});


// DOM content loaded handler
document.addEventListener("DOMContentLoaded", function () {
  console.log('DOM content loaded');
  loadingState.dom = true;
  
  // Initialize the app
  initializeApp();
});

// Call initializeTabs on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initializeTabs();
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (authState && authState.access_token) {
    elements.tabsContainer.removeAttribute('hidden');
  }
});

// Window load handler
window.addEventListener("load", function () {
  console.log('Window fully loaded');
  setTimeout(() => {
    if (!loadingState.uiReady) {
      checkAndHideSpinner();
    }
  }, 100);
});

// Ultimate fallback: Hide spinner after maximum wait time
setTimeout(() => {
  console.log('Ultimate fallback: Force hiding spinner after 15 seconds');
  loadingState.gapi = true;
  loadingState.dom = true;
  loadingState.uiReady = true;
  checkAndHideSpinner();
}, 15000);

document.addEventListener('DOMContentLoaded', () => {
    const isAuthenticated = localStorage.getItem('secretariatAuthenticated') === 'true';
    const savedTab = localStorage.getItem('currentTab');
    
    if (isAuthenticated && savedTab === 'secretariat') {
        switchTab('secretariat'); // Restore secretariat tab
    } else {
        switchTab('rater'); // Default to rater tab
    }
});









