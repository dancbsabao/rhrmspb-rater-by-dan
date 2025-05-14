// Global variables
let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;
let fetchTimeout;
let isSubmitting = false;
let refreshTimer = null;
let sessionId = null;
let submissionQueue = [];
let isSecretariat = false; // Track if Secretariat tab is active
let secretariatPassword = '';
let generalList = []; // Data from GENERAL_LIST sheet
let selectedCandidate = null; // Track selected candidate in Secretariat table

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
  assignmentDropdownSecretariat: document.getElementById('assignmentDropdownSecretariat'),
  positionDropdownSecretariat: document.getElementById('positionDropdownSecretariat'),
  itemDropdownSecretariat: document.getElementById('itemDropdownSecretariat'),
  competencyContainer: document.getElementById('competencyContainer'),
  submitRatings: document.getElementById('submitRatings'),
  submitSecretariat: document.getElementById('submitSecretariat'),
  ratingForm: document.querySelector('.rating-form'),
  secretariatForm: document.querySelector('.secretariat-form'),
  secretariatTable: document.getElementById('secretariat-table'),
  candidatesTableSecretariat: document.getElementById('candidates-table-secretariat'),
};

let vacancies = [];
let candidates = [];
let compeCodes = [];
let competencies = [];

const API_BASE_URL = "https://rhrmspb-rater-by-dan.onrender.com";

function saveAuthState(token, evaluator) {
  if (token && sessionId) {
    const authState = {
      access_token: token.access_token,
      expires_in: token.expires_in,
      expires_at: Date.now() + (token.expires_in * 1000),
      session_id: sessionId,
      evaluator: evaluator,
    };
    localStorage.setItem('authState', JSON.stringify(authState));
    console.log('Auth state saved:', authState);
  }
}

function saveDropdownState() {
  const dropdownState = {
    evaluator: document.getElementById('evaluatorSelect')?.value || '',
    assignment: elements.assignmentDropdown.value,
    position: elements.positionDropdown.value,
    item: elements.itemDropdown.value,
    name: elements.nameDropdown.value,
    assignmentSecretariat: elements.assignmentDropdownSecretariat.value,
    positionSecretariat: elements.positionDropdownSecretariat.value,
    itemSecretariat: elements.itemDropdownSecretariat.value,
  };
  localStorage.setItem('dropdownState', JSON.stringify(dropdownState));
  console.log('Dropdown state saved:', dropdownState);
}

function loadAuthState() {
  const authState = localStorage.getItem('authState');
  return authState ? JSON.parse(authState) : null;
}

function loadDropdownState() {
  const dropdownState = localStorage.getItem('dropdownState');
  return dropdownState ? JSON.parse(dropdownState) : {};
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

    // Restore Rater tab dropdowns
    const raterPromises = [];
    if (dropdownState.assignment) {
      elements.assignmentDropdown.value = dropdownState.assignment;
      raterPromises.push(new Promise(resolve => {
        elements.assignmentDropdown.addEventListener('change', resolve, { once: true });
        elements.assignmentDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.position) {
      elements.positionDropdown.value = dropdownState.position;
      raterPromises.push(new Promise(resolve => {
        elements.positionDropdown.addEventListener('change', resolve, { once: true });
        elements.positionDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.item) {
      elements.itemDropdown.value = dropdownState.item;
      raterPromises.push(new Promise(resolve => {
        elements.itemDropdown.addEventListener('change', resolve, { once: true });
        elements.itemDropdown.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.name) {
      elements.nameDropdown.value = dropdownState.name;
      raterPromises.push(new Promise(resolve => {
        elements.nameDropdown.addEventListener('change', resolve, { once: true });
        elements.nameDropdown.dispatchEvent(new Event('change'));
      }));
    }

    // Restore Secretariat tab dropdowns
    const secretariatPromises = [];
    if (dropdownState.assignmentSecretariat) {
      elements.assignmentDropdownSecretariat.value = dropdownState.assignmentSecretariat;
      secretariatPromises.push(new Promise(resolve => {
        elements.assignmentDropdownSecretariat.addEventListener('change', resolve, { once: true });
        elements.assignmentDropdownSecretariat.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.positionSecretariat) {
      elements.positionDropdownSecretariat.value = dropdownState.positionSecretariat;
      secretariatPromises.push(new Promise(resolve => {
        elements.positionDropdownSecretariat.addEventListener('change', resolve, { once: true });
        elements.positionDropdownSecretariat.dispatchEvent(new Event('change'));
      }));
    }
    if (dropdownState.itemSecretariat) {
      elements.itemDropdownSecretariat.value = dropdownState.itemSecretariat;
      secretariatPromises.push(new Promise(resolve => {
        elements.itemDropdownSecretariat.addEventListener('change', resolve, { once: true });
        elements.itemDropdownSecretariat.dispatchEvent(new Event('change'));
      }));
    }

    await Promise.all([...raterPromises, ...secretariatPromises]);
    if (currentEvaluator && elements.nameDropdown.value && elements.itemDropdown.value && !isSecretariat) {
      fetchSubmittedRatings();
    }
    if (isSecretariat && elements.itemDropdownSecretariat.value) {
      displaySecretariatTable();
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
      generalList = [];
      compeCodes = [];
      competencies = [];
      resetDropdowns([]);
      resetSecretariatDropdowns([]);
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
    secretariatPassword = config.SECRETARIAT_PASSWORD;
    SHEET_RANGES = config.SHEET_RANGES;
    initializeApp();
  })
  .catch((error) => {
    console.error("Error fetching config:", error);
    elements.authStatus.textContent = 'Error loading configuration';
  });

function initializeApp() {
  gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
  try {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    });
    gapiInitialized = true;
    console.log('GAPI client initialized');
    await restoreState();
    createEvaluatorSelector();
  } catch (error) {
    console.error('Error initializing GAPI client:', error);
    elements.authStatus.textContent = 'Error initializing Google API';
  }
}

async function isTokenValid() {
  const authState = loadAuthState();
  if (!authState || !authState.access_token) return false;
  if (Date.now() >= authState.expires_at - 60000) return false;
  try {
    await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.VACANCIES,
    });
    return true;
  } catch (error) {
    console.error('Token validation failed:', error);
    return false;
  }
}

async function refreshAccessToken() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh?session_id=${sessionId}`);
    if (!response.ok) throw new Error('Failed to refresh token');
    const data = await response.json();
    gapi.client.setToken({ access_token: data.access_token });
    saveAuthState({ access_token: data.access_token, expires_in: data.expires_in }, currentEvaluator);
    scheduleTokenRefresh(data.expires_in);
    return true;
  } catch (error) {
    console.error('Error refreshing token:', error);
    return false;
  }
}

function scheduleTokenRefresh(expiresIn) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    await refreshAccessToken();
  }, (expiresIn - 60) * 1000);
}

function handleTokenCallback(response) {
  if (response.access_token && response.session_id) {
    sessionId = response.session_id;
    gapi.client.setToken({ access_token: response.access_token });
    saveAuthState(response, currentEvaluator);
    scheduleTokenRefresh(response.expires_in);
    updateUI(true);
    loadSheetData();
    createEvaluatorSelector();
  } else {
    console.error('Invalid token response:', response);
    elements.authStatus.textContent = 'Authentication failed';
  }
}

function maybeEnableButtons() {
  const allRated = Array.from(document.querySelectorAll('input[type="radio"]'))
    .filter(radio => radio.name.startsWith('rating_'))
    .every(radio => document.querySelector(`input[name="${radio.name}"]:checked`));
  elements.submitRatings.disabled = !allRated;
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
    isSecretariat = false;
    saveAuthState(gapi.client.getToken(), null);
    saveDropdownState();
    resetDropdowns(vacancies);
    resetSecretariatDropdowns(vacancies);
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
      isSecretariat = false;
      selectElement.value = newSelection;
      saveAuthState(gapi.client.getToken(), currentEvaluator);
      saveDropdownState();
      showToast('success', 'Success', `Logged in as ${newSelection}`);
      resetDropdowns(vacancies);
      resetSecretariatDropdowns(vacancies);
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
    isSecretariat = false;
    sessionId = null;
    vacancies = [];
    candidates = [];
    generalList = [];
    compeCodes = [];
    competencies = [];
    submissionQueue = [];
    console.log('Global variables reset');
    updateUI(false);
    resetDropdowns([]);
    resetSecretariatDropdowns([]);
    elements.competencyContainer.innerHTML = '';
    clearRatings();
    elements.secretariatTable.innerHTML = '';
    const evaluatorSelect = document.getElementById('evaluatorSelect');
    if (evaluatorSelect) {
      evaluatorSelect.value = '';
      evaluatorSelect.parentElement.remove();
    }
    if (elements.submitRatings) {
      elements.submitRatings.disabled = true;
    }
    if (elements.submitSecretariat) {
      elements.submitSecretariat.disabled = true;
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
  if (elements.ratingForm) elements.ratingForm.style.display = isSignedIn && !isSecretariat ? 'block' : 'none';
  if (elements.secretariatForm) elements.secretariatForm.style.display = isSignedIn && isSecretariat ? 'block' : 'none';
  if (!isSignedIn) {
    elements.competencyContainer.innerHTML = '';
    elements.secretariatTable.innerHTML = '';
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
      generalList = data[5]?.result?.values || []; // GENERAL_LIST
      console.log('Sheet data loaded:', { vacancies, candidates, compeCodes, competencies, generalList });
      initializeDropdowns(vacancies);
      initializeSecretariatDropdowns(vacancies);
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

function updateDropdown(dropdown, options, placeholder) {
  const currentValue = dropdown.value;
  dropdown.innerHTML = `<option value="">${placeholder}</option>`;
  options.forEach((option) => {
    const opt = document.createElement('option');
    opt.value = option;
    opt.textContent = option;
    dropdown.appendChild(opt);
  });
  dropdown.value = options.includes(currentValue) ? currentValue : '';
}

function setDropdownState(dropdown, enabled) {
  dropdown.disabled = !enabled;
  dropdown.classList.toggle('disabled', !enabled);
}

function initializeDropdowns(vacancies) {
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

function initializeSecretariatDropdowns(vacancies) {
  elements.assignmentDropdownSecretariat.setAttribute('data-placeholder', 'Select Assignment');
  elements.positionDropdownSecretariat.setAttribute('data-placeholder', 'Select Position');
  elements.itemDropdownSecretariat.setAttribute('data-placeholder', 'Select Item');

  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(elements.assignmentDropdownSecretariat, uniqueAssignments, 'Select Assignment');

  setDropdownState(elements.positionDropdownSecretariat, false);
  setDropdownState(elements.itemDropdownSecretariat, false);

  elements.assignmentDropdownSecretariat.addEventListener('change', () => {
    const assignment = elements.assignmentDropdownSecretariat.value;
    if (assignment) {
      const positions = vacancies
        .filter((row) => row[2] === assignment)
        .map((row) => row[1]);
      updateDropdown(elements.positionDropdownSecretariat, [...new Set(positions)], 'Select Position');
      setDropdownState(elements.positionDropdownSecretariat, true);
    } else {
      setDropdownState(elements.positionDropdownSecretariat, false);
    }
    setDropdownState(elements.itemDropdownSecretariat, false);
    elements.secretariatTable.innerHTML = '';
    elements.candidatesTableSecretariat.innerHTML = '';
    elements.submitSecretariat.disabled = true;
    saveDropdownState();
  });

  elements.positionDropdownSecretariat.addEventListener('change', () => {
    const assignment = elements.assignmentDropdownSecretariat.value;
    const position = elements.positionDropdownSecretariat.value;
    if (assignment && position) {
      const items = vacancies
        .filter((row) => row[2] === assignment && row[1] === position)
        .map((row) => row[0]);
      updateDropdown(elements.itemDropdownSecretariat, [...new Set(items)], 'Select Item');
      setDropdownState(elements.itemDropdownSecretariat, true);
    } else {
      setDropdownState(elements.itemDropdownSecretariat, false);
    }
    elements.secretariatTable.innerHTML = '';
    elements.candidatesTableSecretariat.innerHTML = '';
    elements.submitSecretariat.disabled = true;
    saveDropdownState();
  });

  elements.itemDropdownSecretariat.addEventListener('change', () => {
    const item = elements.itemDropdownSecretariat.value;
    if (item) {
      displaySecretariatTable();
    } else {
      elements.secretariatTable.innerHTML = '';
      elements.candidatesTableSecretariat.innerHTML = '';
      elements.submitSecretariat.disabled = true;
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

function resetSecretariatDropdowns(vacancies) {
  const uniqueAssignments = vacancies.length ? [...new Set(vacancies.slice(1).map((row) => row[2]))] : [];
  updateDropdown(elements.assignmentDropdownSecretariat, uniqueAssignments, 'Select Assignment');
  updateDropdown(elements.positionDropdownSecretariat, [], 'Select Position');
  updateDropdown(elements.itemDropdownSecretariat, [], 'Select Item');
  elements.assignmentDropdownSecretariat.value = '';
  elements.positionDropdownSecretariat.value = '';
  elements.itemDropdownSecretariat.value = '';
  elements.assignmentDropdownSecretariat.disabled = !vacancies.length;
  elements.positionDropdownSecretariat.disabled = true;
  elements.itemDropdownSecretariat.disabled = true;
  elements.secretariatTable.innerHTML = '';
  elements.candidatesTableSecretariat.innerHTML = '';
  elements.submitSecretariat.disabled = true;
}

async function fetchSubmittedRatings() {
  const name = elements.nameDropdown.value;
  const item = elements.itemDropdown.value;
  if (!name || !item || !currentEvaluator) return;

  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.RATELOG,
    });

    const values = response.result.values || [];
    const submittedRatings = values.find(row =>
      row[0] === name &&
      row[1] === item &&
      row[3] === currentEvaluator
    );

    if (submittedRatings) {
      prefillRatings(submittedRatings.slice(5));
    }
  } catch (error) {
    console.error('Error fetching submitted ratings:', error);
  }
}

function clearRatings() {
  elements.competencyContainer.innerHTML = '';
  const resultsArea = document.querySelector('.results-area');
  if (resultsArea) resultsArea.remove();
  elements.submitRatings.disabled = true;
}

function prefillRatings(ratings) {
  ratings.forEach((rating, index) => {
    const radio = document.querySelector(`input[name="rating_${index}"][value="${rating}"]`);
    if (radio) {
      radio.checked = true;
    }
  });
  maybeEnableButtons();
}

async function submitRatings() {
  if (isSubmitting) {
    console.log('Submission already in progress');
    return;
  }

  const ratings = Array.from(document.querySelectorAll('input[type="radio"]:checked'))
    .filter(radio => radio.name.startsWith('rating_'))
    .map(radio => radio.value);

  if (ratings.length === 0) {
    showToast('error', 'Error', 'No ratings selected');
    return;
  }

  const name = elements.nameDropdown.value;
  const item = elements.itemDropdown.value;
  const assignment = elements.assignmentDropdown.value;
  const position = elements.positionDropdown.value;

  const modalContent = `
    <div class="modal-body">
      <p>Are you sure you want to submit the following ratings?</p>
      <div class="modal-field"><span class="modal-label">NAME:</span> <span class="modal-value">${name}</span></div>
      <div class="modal-field"><span class="modal-label">ITEM:</span> <span class="modal-value">${item}</span></div>
      <div class="modal-field"><span class="modal-label">POSITION:</span> <span class="modal-value">${position}</span></div>
      <div class="modal-field"><span class="modal-label">ASSIGNMENT:</span> <span class="modal-value">${assignment}</span></div>
      <div class="modal-field"><span class="modal-label">EVALUATOR:</span> <span class="modal-value">${currentEvaluator}</span></div>
      <div class="modal-field"><span class="modal-label">RATINGS:</span> <span class="modal-value">${ratings.join(', ')}</span></div>
    </div>
  `;

  showModal('Confirm Submission', modalContent, async () => {
    isSubmitting = true;
    showSubmittingIndicator();
    try {
      const lockAcquired = await acquireLock(name, item);
      if (!lockAcquired) {
        showToast('error', 'Error', 'Another user is submitting ratings for this candidate. Please try again later.');
        return;
      }

      const existingRatings = await checkExistingRatings(name, item);
      if (existingRatings && existingRatings[3] !== currentEvaluator) {
        showToast('error', 'Error', 'Ratings already submitted by another evaluator.');
        await revertToExistingRatings(existingRatings);
        return;
      }

      const data = await prepareRatingsData(name, item, ratings);
      await processRatings(data);

      showToast('success', 'Success', 'Ratings submitted successfully');
      clearRatings();
      elements.nameDropdown.value = '';
      setDropdownState(elements.nameDropdown, false);
      saveDropdownState();
    } catch (error) {
      console.error('Submission error:', error);
      showToast('error', 'Error', 'Failed to submit ratings');
    } finally {
      await releaseLock(name, item);
      isSubmitting = false;
      hideSubmittingIndicator();
      processSubmissionQueue();
    }
  });
}

function showSubmittingIndicator() {
  elements.submitRatings.disabled = true;
  elements.submitRatings.textContent = 'Submitting...';
}

function hideSubmittingIndicator() {
  elements.submitRatings.disabled = false;
  elements.submitRatings.textContent = 'SUBMIT RATINGS';
}

function processSubmissionQueue() {
  if (submissionQueue.length > 0 && !isSubmitting) {
    const nextSubmission = submissionQueue.shift();
    submitRatings(nextSubmission);
  }
}

async function checkExistingRatings(name, item) {
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
  });
  const values = response.result.values || [];
  return values.find(row => row[0] === name && row[1] === item);
}

async function revertToExistingRatings(existingRatings) {
  prefillRatings(existingRatings.slice(5));
}

async function verifyEvaluatorPassword(evaluator, password) {
  return EVALUATOR_PASSWORDS[evaluator] === password;
}

async function prepareRatingsData(name, item, ratings) {
  const timestamp = new Date().toISOString();
  const initials = getInitials(currentEvaluator);
  const competencyCodes = compeCodes
    .filter(row => row[0] === item)
    .flatMap(row => row[1].split(','));

  return [
    name,
    item,
    timestamp,
    currentEvaluator,
    initials,
    ...ratings,
  ];
}

async function submitRatingsWithLock(data) {
  await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
    valueInputOption: 'RAW',
    resource: {
      values: [data],
    },
  });
}

async function acquireLock(name, item) {
  try {
    const response = await fetch(`${API_BASE_URL}/lock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, item, sessionId }),
    });
    return response.ok;
  } catch (error) {
    console.error('Error acquiring lock:', error);
    return false;
  }
}

async function releaseLock(name, item) {
  try {
    await fetch(`${API_BASE_URL}/lock`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, item, sessionId }),
    });
  } catch (error) {
    console.error('Error releasing lock:', error);
  }
}

async function processRatings(data) {
  await submitRatingsWithLock(data);
}

function getInitials(name) {
  return name
    .split(' ')
    .map(word => word[0])
    .join('')
    .toUpperCase();
}

function getCompetencyCode(competency) {
  const comp = competencies.find(row => row[1] === competency);
  return comp ? comp[0] : '';
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
}

async function displayGeneralCandidatesTable(name, itemNumber) {
  const container = elements.candidatesTableSecretariat;
  container.innerHTML = '';

  const candidateRow = generalList.find(row => row[0] === name && row[1] === itemNumber);
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
}

async function displaySecretariatTable() {
  const item = elements.itemDropdownSecretariat.value;
  if (!item) return;

  const names = generalList
    .filter((row) => row[1] === item)
    .map((row) => ({ name: row[0], sex: row[2] || '' }));

  elements.secretariatTable.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>NAME</th>
          <th>COMMENT</th>
          <th>ACTION</th>
        </tr>
      </thead>
      <tbody>
        ${names.map((candidate, index) => `
          <tr data-name="${candidate.name}">
            <td>${candidate.name}</td>
            <td><input type="text" id="comment-${index}" value=""></td>
            <td>
              <select id="action-${index}">
                <option value="">Select Action</option>
                <option value="disqualify">For Disqualification</option>
                <option value="longlist">For Long List</option>
              </select>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  const rows = elements.secretariatTable.querySelectorAll('tr[data-name]');
  rows.forEach((row, index) => {
    row.addEventListener('click', () => {
      rows.forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      selectedCandidate = {
        name: row.dataset.name,
        item: item,
        comment: document.getElementById(`comment-${index}`).value,
        action: document.getElementById(`action-${index}`).value,
        sex: names[index].sex,
      };
      displayGeneralCandidatesTable(selectedCandidate.name, item);
      updateSubmitButtonState();
    });

    const commentInput = document.getElementById(`comment-${index}`);
    const actionSelect = document.getElementById(`action-${index}`);
    commentInput.addEventListener('input', () => {
      if (selectedCandidate && selectedCandidate.name === row.dataset.name) {
        selectedCandidate.comment = commentInput.value;
        updateSubmitButtonState();
      }
    });
    actionSelect.addEventListener('change', () => {
      if (selectedCandidate && selectedCandidate.name === row.dataset.name) {
        selectedCandidate.action = actionSelect.value;
        updateSubmitButtonState();
      }
    });
  });

  updateSubmitButtonState();
}

function updateSubmitButtonState() {
  elements.submitSecretariat.disabled = !selectedCandidate || !selectedCandidate.action;
}

async function fetchCompetenciesFromSheet(itemNumber) {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.COMPECODES,
    });
    const codes = response.result.values.find(row => row[0] === itemNumber);
    if (!codes) return [];

    const competencyCodes = codes[1].split(',');
    const compResponse = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: SHEET_RANGES.COMPETENCIES,
    });

    return compResponse.result.values
      .filter(row => competencyCodes.includes(row[0]))
      .map(row => row[1]);
  } catch (error) {
    console.error('Error fetching competencies:', error);
    return [];
  }
}

async function displayCompetencies(name, relatedCompetencies, salaryGrade) {
  elements.competencyContainer.innerHTML = '';
  const maxRating = salaryGrade >= 24 ? 5 : 4;

  relatedCompetencies.forEach((competency, index) => {
    const compDiv = document.createElement('div');
    compDiv.className = 'competency';

    const compTitle = document.createElement('h3');
    compTitle.textContent = competency;
    compDiv.appendChild(compTitle);

    const ratingDiv = document.createElement('div');
    ratingDiv.className = 'rating';

    for (let i = 1; i <= maxRating; i++) {
      const label = document.createElement('label');
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `rating_${index}`;
      radio.value = i;
      radio.addEventListener('change', () => {
        saveRadioState();
        maybeEnableButtons();
      });

      label.appendChild(radio);
      label.appendChild(document.createTextNode(i));
      ratingDiv.appendChild(label);
    }

    compDiv.appendChild(ratingDiv);
    elements.competencyContainer.appendChild(compDiv);
  });

  loadRadioState();
  maybeEnableButtons();
}

function saveRadioState() {
  const ratings = {};
  document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
    ratings[radio.name] = radio.value;
  });
  localStorage.setItem('radioState', JSON.stringify(ratings));
}

function loadRadioState() {
  const ratings = JSON.parse(localStorage.getItem('radioState') || '{}');
  Object.keys(ratings).forEach(name => {
    const radio = document.querySelector(`input[name="${name}"][value="${ratings[name]}"]`);
    if (radio) radio.checked = true;
  });
}

async function submitSecretariat() {
  if (isSubmitting) {
    console.log('Submission already in progress');
    return;
  }

  if (!selectedCandidate || !selectedCandidate.action) {
    showToast('error', 'Error', 'Please select a candidate and an action');
    return;
  }

  const modalContent = `
    <div class="modal-body">
      <p>Are you sure you want to submit the following action?</p>
      <div class="modal-field"><span class="modal-label">NAME:</span> <span class="modal-value">${selectedCandidate.name}</span></div>
      <div class="modal-field"><span class="modal-label">ITEM:</span> <span class="modal-value">${selectedCandidate.item}</span></div>
      <div class="modal-field"><span class="modal-label">ACTION:</span> <span class="modal-value">${selectedCandidate.action === 'disqualify' ? 'For Disqualification' : 'For Long List'}</span></div>
      <div class="modal-field"><span class="modal-label">COMMENT:</span> <span class="modal-value">${selectedCandidate.comment || 'N/A'}</span></div>
    </div>
  `;

  showModal('Confirm Submission', modalContent, async () => {
    isSubmitting = true;
    showSubmittingIndicatorSecretariat();
    try {
      if (!await isTokenValid()) await refreshAccessToken();
      if (selectedCandidate.action === 'disqualify') {
        await gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: SHEET_ID,
          range: SHEET_RANGES.DISQUALIFIED,
          valueInputOption: 'RAW',
          resource: {
            values: [[
              selectedCandidate.name,
              selectedCandidate.item,
              selectedCandidate.sex,
              selectedCandidate.comment
            ]]
          }
        });
      } else if (selectedCandidate.action === 'longlist') {
        const candidateRow = generalList.find(row => row[0] === selectedCandidate.name && row[1] === selectedCandidate.item);
        if (candidateRow) {
          await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SHEET_ID,
            range: SHEET_RANGES.CANDIDATES,
            valueInputOption: 'RAW',
            resource: { values: [candidateRow] }
          });
        }
      }

      // Remove from generalList and update table
      generalList = generalList.filter(row => row[0] !== selectedCandidate.name || row[1] !== selectedCandidate.item);
      if (selectedCandidate.action === 'longlist') {
        const candidateRow = generalList.find(row => row[0] === selectedCandidate.name && row[1] === selectedCandidate.item);
        if (candidateRow) candidates.push(candidateRow);
      }
      selectedCandidate = null;
      displaySecretariatTable();
      elements.candidatesTableSecretariat.innerHTML = '';
      showToast('success', 'Success', 'Action submitted successfully');
    } catch (error) {
      console.error('Secretariat submission error:', error);
      showToast('error', 'Error', 'Failed to submit action');
    } finally {
      isSubmitting = false;
      hideSubmittingIndicatorSecretariat();
    }
  });
}

function showSubmittingIndicatorSecretariat() {
  elements.submitSecretariat.disabled = true;
  elements.submitSecretariat.textContent = 'Submitting...';
}

function hideSubmittingIndicatorSecretariat() {
  elements.submitSecretariat.disabled = false;
  elements.submitSecretariat.textContent = 'SUBMIT';
}

function initializeTabs() {
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
    button.addEventListener('click', async () => {
      const tab = button.dataset.tab;
      if (tab === 'secretariat' && !isSecretariat) {
        const modalContent = `
          <p>Please enter the Secretariat password:</p>
          <input type="password" id="secretariatPassword" class="modal-input">
        `;
        const isAuthenticated = await new Promise((resolve) => {
          showModal('Secretariat Authentication', modalContent, () => {
            const passwordInput = document.getElementById('secretariatPassword');
            resolve(passwordInput.value === secretariatPassword);
          }, () => resolve(false));
        });

        if (!isAuthenticated) {
          showToast('error', 'Error', 'Incorrect Secretariat password');
          return;
        }
      }

      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');

      tabContents.forEach(content => content.style.display = 'none');
      document.getElementById(tab).style.display = 'block';

      isSecretariat = tab === 'secretariat';
      updateUI(true);

      if (isSecretariat) {
        elements.competencyContainer.innerHTML = '';
        const resultsArea = document.querySelector('.results-area');
        if (resultsArea) resultsArea.remove();
        if (elements.itemDropdownSecretariat.value) {
          displaySecretariatTable();
        }
      } else {
        if (elements.nameDropdown.value && elements.itemDropdown.value) {
          const item = elements.itemDropdown.value;
          const name = elements.nameDropdown.value;
          const assignment = elements.assignmentDropdown.value;
          const position = elements.positionDropdown.value;
          const vacancy = vacancies.find(row => row[0] === item && row[2] === assignment && row[1] === position);
          const salaryGrade = vacancy && vacancy[3] ? parseInt(vacancy[3], 10) : 0;
          const selectedCodes = compeCodes
            .filter((row) => row[0] === item)
            .flatMap((row) => row[1].split(','));
          const relatedCompetencies = competencies
            .filter((row) => row[0] && selectedCodes.includes(row[0]))
            .map((row) => row[1]);
          await displayCompetencies(name, relatedCompetencies, salaryGrade);
          fetchSubmittedRatings();
        }
      }
    });
  });
}

function showModal(title, content, onConfirm, onCancel) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${title}</h2>
      ${content}
      <div class="modal-actions">
        <button class="modal-confirm">Confirm</button>
        <button class="modal-cancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const confirmBtn = modal.querySelector('.modal-confirm');
  const cancelBtn = modal.querySelector('.modal-cancel');

  confirmBtn.addEventListener('click', () => {
    onConfirm();
    modal.remove();
  });

  cancelBtn.addEventListener('click', () => {
    if (onCancel) onCancel();
    modal.remove();
  });
}

function showFullScreenModal(title, content, onConfirm) {
  const modal = document.createElement('div');
  modal.className = 'modal full-screen';
  modal.innerHTML = `
    <div class="modal-content">
      <h2>${title}</h2>
      ${content}
      <div class="modal-actions">
        <button class="modal-confirm">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const confirmBtn = modal.querySelector('.modal-confirm');
  confirmBtn.addEventListener('click', () => {
    onConfirm();
    modal.remove();
  });
}

function showToast(type, title, message) {
  const toast = new Toast({
    title: title,
    message: message,
    type: type,
    duration: 3000,
  });
  toast.show();
}

elements.signInBtn.addEventListener('click', handleAuthClick);
elements.signOutBtn.addEventListener('click', handleSignOutClick);
elements.submitRatings.addEventListener('click', submitRatings);
elements.submitSecretariat.addEventListener('click', submitSecretariat);

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM fully loaded');
  initializeTabs();
});
