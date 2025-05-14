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

function saveDropdownState() {
  const dropdownState = {
    evaluator: document.getElementById('evaluatorSelect')?.value || '',
    assignment: elements.assignmentDropdown.value,
    position: elements.positionDropdown.value,
    item: elements.itemDropdown.value,
    name: elements.nameDropdown.value,
    secretariatAssignment: document.getElementById('secretariatAssignmentDropdown')?.value || '',
    secretariatPosition: document.getElementById('secretariatPositionDropdown')?.value || '',
    secretariatItem: document.getElementById('secretariatItemDropdown')?.value || '',
  };
  localStorage.setItem('dropdownState', JSON.stringify(dropdownState));
  console.log('Dropdown state saved:', dropdownState);
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
  console.log('Loaded auth state:', authState);
  return authState;
}

function loadDropdownState() {
  const dropdownState = JSON.parse(localStorage.getItem('dropdownState'));
  console.log('Loaded dropdown state:', dropdownState);
  return dropdownState || {};
}

async function restoreState() {
  const authState = loadAuthState();
  const dropdownState = loadDropdownState();
  const authSection = document.querySelector('.auth-section');
  const container = document.querySelector('.container');

  if (authState) {
    gapi.client.setToken({ access_token: authState.access_token });
    sessionId = authState.session_id;
    secretariatMemberId = authState.secretariatMemberId;
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!await isTokenValid()) await refreshAccessToken();
    currentEvaluator = authState.evaluator;
    updateUI(true);
    authSection.classList.remove('signed-out');

    // Ensure sheet data is loaded before restoring dropdowns
    await loadSheetData();

    const evaluatorSelect = document.getElementById('evaluatorSelect');
    if (evaluatorSelect && dropdownState.evaluator) {
      evaluatorSelect.value = dropdownState.evaluator;
      currentEvaluator = dropdownState.evaluator;
    }

    // Helper function to wait for dropdown options
    async function waitForDropdownOptions(dropdown, expectedValue, maxAttempts = 5, delayMs = 500) {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (Array.from(dropdown.options).some(option => option.value === expectedValue)) {
          console.log(`Dropdown ${dropdown.id} has option ${expectedValue}`);
          return true;
        }
        console.log(`Attempt ${attempt}: Option ${expectedValue} not found in ${dropdown.id}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        dropdown.dispatchEvent(new Event('change')); // Trigger population
      }
      console.error(`Failed to find option ${expectedValue} in ${dropdown.id} after ${maxAttempts} attempts`);
      return false;
    }

    const changePromises = [];
    // Restore Rater dropdowns
    if (dropdownState.assignment) {
      const dropdown = elements.assignmentDropdown;
      dropdown.value = dropdownState.assignment;
      if (await waitForDropdownOptions(dropdown, dropdownState.assignment)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); dropdown.removeEventListener('change', handler); };
          dropdown.addEventListener('change', handler, { once: true });
          dropdown.dispatchEvent(new Event('change'));
        }));
      }
    }
    if (dropdownState.position) {
      const dropdown = elements.positionDropdown;
      dropdown.value = dropdownState.position;
      if (await waitForDropdownOptions(dropdown, dropdownState.position)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); dropdown.removeEventListener('change', handler); };
          dropdown.addEventListener('change', handler, { once: true });
          dropdown.dispatchEvent(new Event('change'));
        }));
      }
    }
    if (dropdownState.item) {
      const dropdown = elements.itemDropdown;
      dropdown.value = dropdownState.item;
      if (await waitForDropdownOptions(dropdown, dropdownState.item)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); dropdown.removeEventListener('change', handler); };
          dropdown.addEventListener('change', handler, { once: true });
          dropdown.dispatchEvent(new Event('change'));
        }));
      }
    }
    if (dropdownState.name) {
      const dropdown = elements.nameDropdown;
      dropdown.value = dropdownState.name;
      if (await waitForDropdownOptions(dropdown, dropdownState.name)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); dropdown.removeEventListener('change', handler); };
          dropdown.addEventListener('change', handler, { once: true });
          dropdown.dispatchEvent(new Event('change'));
        }));
      }
    }

    // Restore Secretariat dropdowns
    const secretariatAssignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
    const secretariatPositionDropdown = document.getElementById('secretariatPositionDropdown');
    const secretariatItemDropdown = document.getElementById('secretariatItemDropdown');

    if (dropdownState.secretariatAssignment && secretariatAssignmentDropdown) {
      secretariatAssignmentDropdown.value = dropdownState.secretariatAssignment;
      if (await waitForDropdownOptions(secretariatAssignmentDropdown, dropdownState.secretariatAssignment)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); secretariatAssignmentDropdown.removeEventListener('change', handler); };
          secretariatAssignmentDropdown.addEventListener('change', handler, { once: true });
          secretariatAssignmentDropdown.dispatchEvent(new Event('change'));
        }));
      }
    }
    if (dropdownState.secretariatPosition && secretariatPositionDropdown) {
      secretariatPositionDropdown.value = dropdownState.secretariatPosition;
      if (await waitForDropdownOptions(secretariatPositionDropdown, dropdownState.secretariatPosition)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); secretariatPositionDropdown.removeEventListener('change', handler); };
          secretariatPositionDropdown.addEventListener('change', handler, { once: true });
          secretariatPositionDropdown.dispatchEvent(new Event('change'));
        }));
      }
    }
    if (dropdownState.secretariatItem && secretariatItemDropdown) {
      secretariatItemDropdown.value = dropdownState.secretariatItem;
      if (await waitForDropdownOptions(secretariatItemDropdown, dropdownState.secretariatItem)) {
        changePromises.push(new Promise(resolve => {
          const handler = () => { resolve(); secretariatItemDropdown.removeEventListener('change', handler); };
          secretariatItemDropdown.addEventListener('change', handler, { once: true });
          secretariatItemDropdown.dispatchEvent(new Event('change'));
        }));
      }
    }

    await Promise.all(changePromises);
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
}

fetch(`${API_BASE_URL}/config`)
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
    return response.json();
  })
  .then((config) => {
    console.log('Config loaded:', config); // Debug log
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

async function refreshAccessToken() {
  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.session_id) {
    console.warn('No session ID available');
    localStorage.clear();
    handleAuthClick();
    return false;
  }
  try {
    console.log('Attempting token refresh with session_id:', authState.session_id);
    const response = await fetch(`${API_BASE_URL}/refresh-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ session_id: authState.session_id }),
    });
    const newToken = await response.json();
    console.log('Refresh response:', newToken);
    if (!response.ok || newToken.error) {
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
    console.error('Token refresh failed:', error.message);
    showToast('warning', 'Session Issue', 'Unable to refresh session, please sign in again.');
    localStorage.clear();
    handleAuthClick();
    return false;
  }
}

function scheduleTokenRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);

  const authState = JSON.parse(localStorage.getItem('authState'));
  if (!authState?.expires_at || !authState.session_id) {
    console.log('No valid auth state for scheduling refresh');
    return;
  }

  const timeToExpiry = authState.expires_at - Date.now();
  const refreshInterval = Math.max(300000, timeToExpiry - 900000); // 15 min before expiry

  refreshTimer = setTimeout(async () => {
    console.log('Scheduled token refresh triggered');
    const success = await refreshAccessToken();
    if (!success) {
      console.warn('Refresh failed, retrying in 1 minute');
      refreshTimer = setTimeout(scheduleTokenRefresh, 60000);
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
    if (localStorage.getItem('secretariatAuthenticated') && secretariatMemberId) {
      switchTab('secretariat');
      showToast('success', 'Success', `Logged in as Secretariat Member ${secretariatMemberId}`);
    } else {
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
        }
      );
    }
  });
}


function switchTab(tab) {
  currentTab = tab;
  localStorage.setItem('currentTab', tab);
  document.getElementById('raterTab').classList.toggle('active', tab === 'rater');
  document.getElementById('secretariatTab').classList.toggle('active', tab === 'secretariat');
  document.getElementById('raterContent').style.display = tab === 'rater' ? 'block' : 'none';
  document.getElementById('secretariatContent').style.display = tab === 'secretariat' ? 'block' : 'none';

  // Disable dropdowns of the inactive tab
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

  // Initialize tab-specific logic
  if (tab === 'rater') {
    initializeDropdowns(vacancies);
    if (elements.nameDropdown.value && elements.itemDropdown.value) {
      fetchSubmittedRatings();
    }
  } else if (tab === 'secretariat') {
    initializeSecretariatDropdowns();
    if (secretariatItemDropdown.value) {
      fetchSecretariatCandidates(secretariatItemDropdown.value);
    }
  }
}

function initializeSecretariatDropdowns() {
  const assignmentDropdown = document.getElementById('secretariatAssignmentDropdown');
  const positionDropdown = document.getElementById('secretariatPositionDropdown');
  const itemDropdown = document.getElementById('secretariatItemDropdown');

  assignmentDropdown.setAttribute('data-placeholder', 'Select Assignment');
  positionDropdown.setAttribute('data-placeholder', 'Select Position');
  itemDropdown.setAttribute('data-placeholder', 'Select Item');

  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(assignmentDropdown, uniqueAssignments, 'Select Assignment');

  setDropdownState(positionDropdown, false);
  setDropdownState(itemDropdown, false);

  assignmentDropdown.addEventListener('change', () => {
    const assignment = assignmentDropdown.value;
    if (currentTab !== 'secretariat') return; // Only process if Secretariat tab is active
    if (assignment) {
      const positions = vacancies
        .filter((row) => row[2] === assignment)
        .map((row) => row[1]);
      updateDropdown(positionDropdown, [...new Set(positions)], 'Select Position');
      setDropdownState(positionDropdown, true);
    } else {
      setDropdownState(positionDropdown, false);
    }
    setDropdownState(itemDropdown, false);
    displaySecretariatCandidatesTable([], null, null);
    saveDropdownState();
  });

  positionDropdown.addEventListener('change', () => {
    const assignment = assignmentDropdown.value;
    const position = positionDropdown.value;
    if (currentTab !== 'secretariat') return;
    if (assignment && position) {
      const items = vacancies
        .filter((row) => row[2] === assignment && row[1] === position)
        .map((row) => row[0]);
      updateDropdown(itemDropdown, [...new Set(items)], 'Select Item');
      setDropdownState(itemDropdown, true);
    } else {
      setDropdownState(itemDropdown, false);
    }
    displaySecretariatCandidatesTable([], null, null);
    saveDropdownState();
  });

  itemDropdown.addEventListener('change', () => {
    const item = itemDropdown.value;
    if (currentTab !== 'secretariat') return;
    if (item) {
      fetchSecretariatCandidates(item);
    } else {
      displaySecretariatCandidatesTable([], null, null);
    }
    saveDropdownState();
  });
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
        range: 'CANDIDATES!A:Q',
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
        submissions.set(`${row[0]}|${row[1]}|${row[16]}`, 'CANDIDATES');
      }
    });
    disqualifiedSheet.forEach(row => {
      if (row[0] && row[1] && row[4]) {
        submissions.set(`${row[0]}|${row[1]}|${row[4]}`, 'DISQUALIFIED');
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

  if (candidates.length > 0) {
    const table = document.createElement('table');
    table.className = 'secretariat-table';

    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th>Name</th>
        <th>Documents</th>
        <th>Action</th>
        <th>Comment</th>
        <th>Submit</th>
        <th>Status</th>
      </tr>
    `;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    candidates.forEach(candidate => {
      const row = candidate.data;
      const name = row[0];
      const sex = row[2]; // Sex from GENERAL_LIST!C
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
        ? `<span class="submitted-indicator">Submitted (${candidate.submitted})</span>`
        : '';
      const commentValue = row[16] || '';
      tr.innerHTML = `
        <td>${name}</td>
        <td class="document-links">${linksHtml}</td>
        <td>
          <select class="action-dropdown" onchange="toggleCommentInput(this)">
            <option value="">Select Action</option>
            <option value="FOR DISQUALIFICATION">FOR DISQUALIFICATION</option>
            <option value="FOR LONG LIST">FOR LONG LIST</option>
          </select>
        </td>
        <td class="comment-cell">
          <input type="text" class="comment-input" value="${commentValue}" style="display: none;">
        </td>
        <td>
          <button class="submit-candidate-button" onclick="submitCandidateAction(this, '${name}', '${itemNumber}', '${sex}')">Submit</button>
        </td>
        <td>${submittedStatus}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  } else {
    container.innerHTML = '<p>No candidates found.</p>';
  }
}

// Toggle comment input based on action selection
function toggleCommentInput(selectElement) {
  const commentCell = selectElement.parentElement.nextElementSibling;
  const commentInput = commentCell.querySelector('.comment-input');
  commentInput.style.display = selectElement.value === 'FOR DISQUALIFICATION' ? 'block' : 'none';
}


async function submitCandidateAction(button, name, itemNumber, sex) {
  console.log('submitCandidateAction triggered:', { name, itemNumber, sex });
  const row = button.closest('tr');
  const action = row.querySelector('.action-dropdown').value;
  const comment = action === 'FOR DISQUALIFICATION' ? row.querySelector('.comment-input').value : '';
  console.log('Action:', action, 'Comment:', comment);

  if (!action) {
    showToast('error', 'Error', 'Please select an action');
    return;
  }

  const isDuplicate = await checkDuplicateSubmission(name, itemNumber, action);
  if (isDuplicate) {
    showToast('error', 'Error', `Candidate already submitted as ${action} by Member ${secretariatMemberId}.`);
    return;
  }

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
          <span class="modal-label">Comment:</span>
          <span class="modal-value">${comment || 'None'}</span>
        </div>
      </div>
    </div>
  `;

  showModal('CONFIRM SUBMISSION', modalContent, async () => {
    try {
      console.log('Submitting action:', { name, itemNumber, sex, action, comment });
      if (!await isTokenValid()) {
        console.log('Refreshing token');
        await refreshAccessToken();
      }

      // Normalize data for matching
      const normalizedName = name.trim().toUpperCase();
      const normalizedItemNumber = itemNumber.trim();

      // Remove candidate from the opposite sheet
      if (action === 'FOR LONG LIST') {
        const disqualifiedResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: 'DISQUALIFIED!A:E',
        });
        let disqualifiedValues = disqualifiedResponse.result.values || [];
        console.log('DISQUALIFIED values before deletion:', disqualifiedValues);

        const disqualifiedIndex = disqualifiedValues.findIndex(row => 
          row[0]?.trim().toUpperCase() === normalizedName && 
          row[1]?.trim() === normalizedItemNumber && 
          row[4] === secretariatMemberId
        );

        if (disqualifiedIndex !== -1) {
          disqualifiedValues.splice(disqualifiedIndex, 1);
          console.log(`Removing ${normalizedName} from DISQUALIFIED at index ${disqualifiedIndex}`);
          await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'DISQUALIFIED!A:E',
            valueInputOption: 'RAW',
            resource: { 
              values: disqualifiedValues.length > 0 ? disqualifiedValues : [[]] // Avoid empty sheet issues
            },
          });
          console.log('DISQUALIFIED sheet updated successfully');
        } else {
          console.log(`No matching record found for ${normalizedName} in DISQUALIFIED`);
        }

        const generalResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: 'GENERAL_LIST!A:P',
        });
        let candidate = generalResponse.result.values.find(row => 
          row[0]?.trim().toUpperCase() === normalizedName && 
          row[1]?.trim() === normalizedItemNumber
        );
        if (!candidate) throw new Error('Candidate not found in GENERAL_LIST');
        candidate = [...candidate, secretariatMemberId];
        console.log('Appending to CANDIDATES:', [candidate]);
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: 'CANDIDATES!A:Q',
          valueInputOption: 'RAW',
          resource: { values: [candidate] },
        });
        console.log('Candidate appended to CANDIDATES successfully');
      } else if (action === 'FOR DISQUALIFICATION') {
        const candidatesResponse = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: 'CANDIDATES!A:Q',
        });
        let candidatesValues = candidatesResponse.result.values || [];
        console.log('CANDIDATES values before deletion:', candidatesValues);

        const candidatesIndex = candidatesValues.findIndex(row => 
          row[0]?.trim().toUpperCase() === normalizedName && 
          row[1]?.trim() === normalizedItemNumber && 
          row[16] === secretariatMemberId
        );

        if (candidatesIndex !== -1) {
          candidatesValues.splice(candidatesIndex, 1);
          console.log(`Removing ${normalizedName} from CANDIDATES at index ${candidatesIndex}`);
          await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: 'CANDIDATES!A:Q',
            valueInputOption: 'RAW',
            resource: { 
              values: candidatesValues.length > 0 ? candidatesValues : [[]] // Avoid empty sheet issues
            },
          });
          console.log('CANDIDATES sheet updated successfully');
        } else {
          console.log(`No matching record found for ${normalizedName} in CANDIDATES`);
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
      fetchSecretariatCandidates(itemNumber);
    } catch (error) {
      console.error('Error submitting action:', error);
      showToast('error', 'Error', `Failed to submit action: ${error.message}`);
    }
  });
}


async function checkDuplicateSubmission(name, itemNumber, action) {
  try {
    const sheetName = action === 'FOR LONG LIST' ? 'CANDIDATES' : 'DISQUALIFIED';
    const range = sheetName === 'CANDIDATES' ? 'CANDIDATES!A:S' : 'DISQUALIFIED!A:E';
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


async function submitSecretariatActions() {
  console.log('submitSecretariatActions triggered'); // Debug log
  const itemNumber = document.getElementById('secretariatItemDropdown').value;
  console.log('Item Number:', itemNumber); // Debug log
  if (!itemNumber) {
    showToast('error', 'Error', 'Please select an item');
    return;
  }

  const table = document.querySelector('.secretariat-table');
  if (!table) {
    showToast('error', 'Error', 'No candidates table found');
    console.log('Table not found'); // Debug log
    return;
  }

  const rows = table.querySelectorAll('tbody tr');
  console.log('Number of rows:', rows.length); // Debug log
  const actions = [];
  rows.forEach((row, index) => {
    const name = row.cells[0].textContent;
    const comment = row.querySelector('.comment-input').value;
    const action = row.querySelector('.action-dropdown').value;
    console.log(`Row ${index}:`, { name, comment, action }); // Debug log
    if (action) {
      actions.push({ name, comment, action, itemNumber });
    }
  });

  if (actions.length === 0) {
    showToast('error', 'Error', 'No actions selected');
    console.log('No actions to submit'); // Debug log
    return;
  }

  let modalContent = `
    <div class="modal-body">
      <p>Are you sure you want to submit the following actions?</p>
      <div class="modal-section">
        <h4>ACTIONS TO SUBMIT:</h4>
        ${actions.map(action => `
          <div class="modal-field">
            <span class="modal-label">${action.name}:</span>
            <span class="modal-value">${action.action} (Comment: ${action.comment || 'None'})</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  showModal('CONFIRM SUBMISSION', modalContent, async () => {
    try {
      console.log('Submitting actions:', actions); // Debug log
      if (!await isTokenValid()) {
        console.log('Refreshing token'); // Debug log
        await refreshAccessToken();
      }

      const disqualified = actions.filter(a => a.action === 'FOR DISQUALIFICATION');
      const longList = actions.filter(a => a.action === 'FOR LONG LIST');
      console.log('Disqualified:', disqualified); // Debug log
      console.log('Long List:', longList); // Debug log

      if (disqualified.length > 0) {
        const disqualifiedValues = disqualified.map(a => [a.name, a.itemNumber, a.comment]);
        console.log('Appending to DISQUALIFIED:', disqualifiedValues); // Debug log
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: 'DISQUALIFIED!A:C',
          valueInputOption: 'RAW',
          resource: { values: disqualifiedValues },
        });
      }

      if (longList.length > 0) {
        const longListValues = await Promise.all(longList.map(async a => {
          const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range: `GENERAL_LIST!A:Q`,
            valueRenderOption: 'FORMATTED_VALUE'
          });
          const candidate = response.result.values.find(row => row[0] === a.name && row[1] === a.itemNumber);
          console.log('Candidate for long list:', candidate); // Debug log
          return candidate;
        }));
        console.log('Appending to CANDIDATES:', longListValues); // Debug log
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: 'CANDIDATES!A:Q',
          valueInputOption: 'RAW',
          resource: { values: longListValues },
        });
      }

      // Update comments in GENERAL_LIST
      const commentUpdates = actions.filter(a => a.comment); // Only update if comment exists
      if (commentUpdates.length > 0) {
        const response = await gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range: `GENERAL_LIST!A:Q`,
        });
        const values = response.result.values || [];
        const updatedValues = values.map(row => {
          const matchingAction = commentUpdates.find(a => a.name === row[0] && a.itemNumber === row[1]);
          if (matchingAction) {
            row[16] = matchingAction.comment; // Update comment in column Q
          }
          return row;
        });
        console.log('Updating GENERAL_LIST with comments:', updatedValues); // Debug log
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `GENERAL_LIST!A:Q`,
          valueInputOption: 'RAW',
          resource: { values: updatedValues },
        });
      }

      showToast('success', 'Success', 'Actions submitted successfully');
      fetchSecretariatCandidates(itemNumber); // Refresh table
    } catch (error) {
      console.error('Error submitting actions:', error);
      showToast('error', 'Error', 'Failed to submit actions: ' + error.message);
    }
  });
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
    }

    const outsideClickHandler = (event) => {
      if (event.target === modalOverlay) {
        if (onCancel) onCancel();
        closeHandler(false);
      }
    };
    modalOverlay.addEventListener('click', outsideClickHandler);
  });
}

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

elements.signInBtn.addEventListener('click', handleAuthClick);
elements.signOutBtn.addEventListener('click', handleSignOutClick);
elements.submitRatings.addEventListener('click', submitRatings);

// Fix: Properly close DOMContentLoaded wrapper
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
});
