// Global variables
let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;
let fetchTimeout;
let isSubmitting = false;
let refreshTimer = null;
let sessionId = null; // To track server session
let submissionQueue = []; // Queue for pending submissions

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
  };
  localStorage.setItem('dropdownState', JSON.stringify(dropdownState));
  console.log('Dropdown state saved:', dropdownState);
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
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (!await isTokenValid()) await refreshAccessToken();
    currentEvaluator = authState.evaluator;
    updateUI(true);
    authSection.classList.remove('signed-out');
    await loadSheetData();
    const evaluatorSelect = document.getElementById('evaluatorSelect');
    if (evaluatorSelect && dropdownState.evaluator) {
      evaluatorSelect.value = dropdownState.evaluator;
      currentEvaluator = dropdownState.evaluator;
    }

    const changePromises = [];
    if (dropdownState.assignment) {
      elements.assignmentDropdown.value = dropdownState.assignment;
      changePromises.push(new Promise(resolve => {
        elements.assignmentDropdown.addEventListener('change', resolve, { once: true });
        elements.assignmentDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.position) {
      elements.positionDropdown.value = dropdownState.position;
      changePromises.push(new Promise(resolve => {
        elements.positionDropdown.addEventListener('change', resolve, { once: true });
        elements.positionDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.item) {
      elements.itemDropdown.value = dropdownState.item;
      changePromises.push(new Promise(resolve => {
        elements.itemDropdown.addEventListener('change', resolve, { once: true });
        elements.itemDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.name) {
      elements.nameDropdown.value = dropdownState.name;
      changePromises.push(new Promise(resolve => {
        elements.nameDropdown.addEventListener('change', resolve, { once: true });
        elements.nameDropdown.dispatchEvent(new Event('change'));
      }));
    }

    await Promise.all(changePromises);
    if (currentEvaluator && elements.nameDropdown.value && elements.itemDropdown.value) {
      fetchSubmittedRatings();
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
    CLIENT_ID = config.CLIENT_ID;
    API_KEY = config.API_KEY;
    SHEET_ID = config.SHEET_ID;
    SCOPES = config.SCOPES;
    EVALUATOR_PASSWORDS = config.EVALUATOR_PASSWORDS;
    SHEET_RANGES = config.SHEET_RANGES;
    initializeApp();
  })
  .catch((error) => {
    console.error("Error fetching config:", error);
    elements.authStatus.textContent = 'Error loading configuration';
  });

function initializeApp() {
  gapi.load('client', async () => {
    await initializeGapiClient();
    gapiInitialized = true;
    console.log('GAPI client initialized');
    maybeEnableButtons();
    createEvaluatorSelector();
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
      const ranges = Object.values(SHEET_RANGES);
      const data = await Promise.all(
        ranges.map((range) =>
          gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SHEET_ID,
            range,
          })
        )
      );
      vacancies = data[0]?.result?.values || [];
      candidates = data[1]?.result?.values || [];
      compeCodes = data[2]?.result?.values || [];
      competencies = data[3]?.result?.values || [];
      console.log('Sheet data loaded:', { vacancies, candidates, compeCodes, competencies });
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

  // Render Basic
  const basicGrid = document.querySelector("#basic-competencies .competency-grid");
  competenciesColumn1.forEach((comp, idx) => {
    basicGrid.appendChild(createCompetencyItem(comp, idx, basicRatings, computeBasicRating));
  });

  // Render Organizational
  const orgGrid = document.querySelector("#organizational-competencies .competency-grid");
  competenciesColumn2.forEach((comp, idx) => {
    orgGrid.appendChild(createCompetencyItem(comp, idx, orgRatings, computeOrgRating));
  });

  // Render Leadership (if SG >= 24)
  if (salaryGrade >= 24) {
    const leadGrid = document.querySelector("#leadership-competencies .competency-grid");
    competenciesColumn3.forEach((comp, idx) => {
      leadGrid.appendChild(createCompetencyItem(comp, idx, leadershipRatings, computeLeadershipRating));
    });
  }

  // Render Minimum
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
    const potential = ((orgTotal + minTotal) / 2) * 2;
    document.getElementById("potential-rating-value").textContent = potential.toFixed(2);
  }

  document.getElementById('reset-ratings').addEventListener('click', () => {
    showModal(
      'CONFIRM RESET',
      '<p>Are you sure you want to reset all ratings?</p>',
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
        showToast('success', 'Reset', 'All ratings cleared.');
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
