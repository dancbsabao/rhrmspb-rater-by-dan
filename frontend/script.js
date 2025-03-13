// Global variables for GIS and API functionality
let gisInitialized = false;
let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;
let fetchTimeout;
let isSubmitting = false;

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
};

let vacancies = [];
let candidates = [];
let compeCodes = [];
let competencies = [];

const API_BASE_URL = "https://rhrmspb-rater-by-dan.onrender.com";

function saveAuthState(tokenResponse, evaluator) {
  const authState = {
    access_token: tokenResponse.access_token,
    expires_at: Date.now() + ((tokenResponse.expires_in || 3600) * 1000),
    evaluator: evaluator || null,
  };
  localStorage.setItem('authState', JSON.stringify(authState));
  console.log('Auth state saved:', authState);
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
  // Removed expiration check to allow persistent tokens across devices
  console.log('Loaded auth state (no expiration check):', authState);
  return authState;
}

function loadDropdownState() {
  const dropdownState = JSON.parse(localStorage.getItem('dropdownState'));
  console.log('Loaded dropdown state:', dropdownState);
  return dropdownState || {};
}

function restoreState() {
  const authState = loadAuthState();
  const dropdownState = loadDropdownState();

  if (authState) {
    gapi.client.setToken({ access_token: authState.access_token });
    currentEvaluator = authState.evaluator;
    elements.authStatus.textContent = 'Signed in';
    elements.signInBtn.style.display = 'none';
    elements.signOutBtn.style.display = 'block';
  } else {
    elements.authStatus.textContent = 'Ready to sign in';
    elements.signInBtn.style.display = 'block';
    elements.signOutBtn.style.display = 'none';
    currentEvaluator = null;
  }

  loadSheetData().then(() => {
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

    Promise.all(changePromises).then(() => {
      if (currentEvaluator && elements.nameDropdown.value && elements.itemDropdown.value) {
        fetchSubmittedRatings();
      }
    });
  });
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
    gisLoaded();
    if (gisInitialized && gapiInitialized) {
      createEvaluatorSelector();
      restoreState();
    }
  });
}

function gisLoaded() {
  if (!CLIENT_ID || !SCOPES) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: handleTokenCallback,
    prompt: 'select_account',
  });
  gisInitialized = true;
  console.log('GIS initialized');
  maybeEnableButtons();
}

async function initializeGapiClient() {
  try {
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
    });
    gapiInitialized = true;
    console.log('GAPI client initialized');
    maybeEnableButtons();
  } catch (error) {
    console.error('Error initializing GAPI client:', error);
  }
}

function handleTokenCallback(tokenResponse) {
  if (tokenResponse.error) {
    console.error('Token error:', tokenResponse.error);
    elements.authStatus.textContent = 'Error during sign-in';
  } else {
    gapi.client.setToken({ access_token: tokenResponse.access_token });
    saveAuthState(tokenResponse, currentEvaluator);
    elements.authStatus.textContent = 'Signed in';
    elements.signInBtn.style.display = 'none';
    elements.signOutBtn.style.display = 'block';
    createEvaluatorSelector();
    loadSheetData();
    if (!localStorage.getItem('hasWelcomed')) {
      showToast('success', 'Welcome!', 'Successfully signed in to the system.');
      localStorage.setItem('hasWelcomed', 'true');
    }
  }
}

function maybeEnableButtons() {
  if (gisInitialized && gapiInitialized) {
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
  if (ratingForm) {
    ratingForm.insertBefore(formGroup, ratingForm.firstChild);
  }
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
    <input type="password" id="evaluatorPassword" class="modal-input" 
           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px;">
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
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

function handleSignOutClick() {
  const token = gapi.client.getToken();
  if (token) {
    // Do not revoke the token to allow other devices to stay logged in
    gapi.client.setToken(null); // Clear token only for this device
    localStorage.removeItem('authState');
    localStorage.removeItem('dropdownState');
    localStorage.removeItem('hasWelcomed');
    // Clear assignment authorization
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('currentAssignmentAuth_')) {
        localStorage.removeItem(key);
      }
    });
    elements.authStatus.textContent = 'Signed out';
    elements.signInBtn.style.display = 'block';
    elements.signOutBtn.style.display = 'none';
    currentEvaluator = null;
    vacancies = [];
    candidates = [];
    compeCodes = [];
    competencies = [];
    resetDropdowns(vacancies);
  }
}

async function loadSheetData() {
  try {
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
  } catch (error) {
    console.error('Error loading sheet data:', error);
    elements.authStatus.textContent = 'Error loading sheet data. Retrying...';
    // Retry once after a delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const data = await Promise.all(
        Object.values(SHEET_RANGES).map((range) =>
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
      console.log('Sheet data loaded on retry:', { vacancies, candidates, compeCodes, competencies });
      initializeDropdowns(vacancies);
      elements.authStatus.textContent = 'Signed in';
    } catch (retryError) {
      console.error('Retry failed:', retryError);
      elements.authStatus.textContent = 'Error loading sheet data. Please sign out and sign in again.';
      showToast('error', 'Error', 'Failed to load sheet data after retry. Please re-authenticate.');
    }
  }
}

// Define updateDropdown first
function updateDropdown(dropdown, options, defaultOptionText = 'Select') {
  dropdown.innerHTML = `<option value="">${defaultOptionText}</option>`;
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    dropdown.appendChild(option);
  });
}

// Then define initializeDropdowns
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

    // Check if the current evaluator requires a password prompt
    const requiresPassword = currentEvaluator === "In-charge, Administrative Division" || currentEvaluator === "End-User";
    let isAuthorized = true;

    if (assignment && requiresPassword) {
      // Key to track the currently authorized assignment for this evaluator
      const authKey = `currentAssignmentAuth_${currentEvaluator}`;
      const storedAssignment = localStorage.getItem(authKey);

      // Only skip the prompt if the selected assignment matches the currently authorized one
      if (storedAssignment !== assignment) {
        const modalContent = `
          <p>Please enter the password to access assignment "${assignment}":</p>
          <input type="password" id="assignmentPassword" class="modal-input" 
                 style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px;">
        `;
        
        isAuthorized = await new Promise((resolve) => {
          showModal('Assignment Authentication', modalContent, () => {
            const passwordInput = document.getElementById('assignmentPassword');
            const password = passwordInput.value.trim();
            const isValid = password === "admindan";
            if (isValid) {
              localStorage.setItem(authKey, assignment); // Save only if password is correct
              // Show success modal after authorization
              showModal('Authorization Successful', `<p>Assignment "${assignment}" has been successfully authorized.</p>`);
            }
            resolve(isValid); // Resolve with true only if password matches
          });
        });

        if (!isAuthorized) {
          showToast('error', 'Error', 'Incorrect password for assignment');
          elements.assignmentDropdown.value = storedAssignment || ''; // Revert to the last authorized assignment or clear
          setDropdownState(elements.positionDropdown, false);
          setDropdownState(elements.itemDropdown, false);
          setDropdownState(elements.nameDropdown, false);
          saveDropdownState();
          return;
        }
      } else {
        // If the assignment is the same as the stored one, no prompt needed
        isAuthorized = true;
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
    if (item && name) {
      displayCandidatesTable(name, item);
      const selectedCodes = compeCodes
        .filter((row) => row[0] === item)
        .flatMap((row) => row[1].split(','));
      const relatedCompetencies = competencies
        .filter((row) => row[0] && selectedCodes.includes(row[0]))
        .map((row) => row[1]);
      await displayCompetencies(name, relatedCompetencies);
      if (currentEvaluator && name && item) {
        fetchSubmittedRatings();
      }
    }
    saveDropdownState();
  });
}

function resetDropdowns(vacancies) {
  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(elements.assignmentDropdown, uniqueAssignments, 'Select Assignment');
  updateDropdown(elements.positionDropdown, [], 'Select Position');
  updateDropdown(elements.itemDropdown, [], 'Select Item');
  updateDropdown(elements.nameDropdown, [], 'Select Name');
  elements.assignmentDropdown.value = '';
  elements.positionDropdown.value = '';
  elements.itemDropdown.value = '';
  elements.nameDropdown.value = '';
}

async function fetchSubmittedRatings() {
  if (fetchTimeout) clearTimeout(fetchTimeout);

  fetchTimeout = setTimeout(async () => {
    const name = elements.nameDropdown.value;
    const item = elements.itemDropdown.value;

    if (!currentEvaluator || !name || !item) {
      console.warn('Missing evaluator, name, or item');
      elements.submitRatings.disabled = true;
      return;
    }

    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG,
      });

      const data = response.result.values || [];
      const filteredRows = data.slice(1).filter(row =>
        row[2] === name && row[1] === item && row[5] === currentEvaluator
      );

      if (filteredRows.length === 0) {
        elements.submitRatings.disabled = false;
        return;
      }

      const competencyRatings = {};
      filteredRows.forEach(row => {
        const competencyName = row[3];
        if (!competencyRatings[competencyName]) {
          competencyRatings[competencyName] = {};
        }
        competencyRatings[competencyName][currentEvaluator] = row[4];
      });

      prefillRatings(competencyRatings);
    } catch (error) {
      console.error('Error fetching ratings:', error);
      showToast('error', 'Error', 'Failed to fetch ratings');
    }
  }, 300);
}

function clearRatings() {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const radios = item.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => (radio.checked = false));
  });
}

let originalRatings = {};
function prefillRatings(competencyRatings) {
  originalRatings = {};
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');

  if (Object.keys(competencyRatings).length === 0) {
    elements.submitRatings.disabled = false;
    return;
  }

  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const rating = competencyRatings[competencyName]?.[currentEvaluator];

    if (rating) {
      originalRatings[competencyName] = rating;
      const radio = item.querySelector(`input[type="radio"][value="${rating}"]`);
      if (radio) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change'));
      }
    }
  });

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
      input.addEventListener('change', () => {
        const competencyName = item.querySelector('label').textContent.split('. ')[1];
        originalRatings[competencyName] = input.value;
        checkAllRatingsSelected();
      });
    });
  });

  checkAllRatingsSelected();
}

// Update submitRatings to use the new lock mechanism
async function submitRatings() {
  if (isSubmitting) {
    console.log('Submission already in progress, ignoring duplicate call');
    return;
  }

  isSubmitting = true;
  const loadingOverlay = document.getElementById('loadingOverlay');

  try {
    const token = gapi.client.getToken();
    if (!token || !token.access_token) {
      showToast('error', 'Error', 'Authentication token missing. Please sign in again.');
      handleAuthClick();
      return;
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

    if (isUpdate) {
      const isVerified = await verifyEvaluatorPassword();
      if (!isVerified) {
        revertToExistingRatings(existingRatings);
        showToast('warning', 'Update Canceled', 'Ratings reverted');
        return;
      }
    }

    const { ratings, error } = prepareRatingsData(item, candidateName, currentEvaluator);
    if (error) {
      showToast('error', 'Error', error);
      return;
    }

    loadingOverlay.classList.add('active');
    const result = await submitRatingsWithLock(ratings);
    if (result.success) {
      showToast('success', 'Success', result.message, 5000, 'center');
    } else {
      console.error('Submission failed with result:', result);
      showToast('error', 'Error', 'Submission failed unexpectedly');
    }
  } catch (error) {
    console.error('Submission error:', error);
    showToast('error', 'Error', `Failed to submit ratings: ${error.message || 'Unknown error'}`);
  } finally {
    isSubmitting = false;
    loadingOverlay.classList.remove('active');
  }
}

async function checkExistingRatings(item, candidateName, evaluator) {
  try {
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

function storeCurrentSelections() {
  const selections = [];
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const selectedRating = Array.from(item.querySelectorAll('input[type="radio"]'))
      .find(radio => radio.checked)?.value;
    selections.push({ competencyName, rating: selectedRating });
  });
  return selections;
}

function revertToExistingRatings(existingRatings) {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const competencyName = item.querySelector('label').textContent.split('. ')[1];
    const existingRating = existingRatings.find(row => row[3] === competencyName);
    if (existingRating) {
      const radio = item.querySelector(`input[type="radio"][value="${existingRating[4]}"]`);
      if (radio) radio.checked = true;
    }
  });
}

async function verifyEvaluatorPassword() {
  return new Promise((resolve) => {
    const modalContent = `
      <p>Please verify password for ${currentEvaluator}:</p>
      <input type="password" id="verificationPassword" class="modal-input" 
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px;">
    `;
    showModal('Password Verification', modalContent, () => {
      const password = document.getElementById('verificationPassword').value;
      resolve(password === EVALUATOR_PASSWORDS[currentEvaluator]);
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

// Add a utility function for delay
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Enhanced submitRatingsWithLock with retry logic
async function submitRatingsWithLock(ratings, maxRetries = 3) {
  const lockRange = "RATELOG!G1:H1";
  const LOCK_TIMEOUT = 30000; // 30 seconds
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      // Fetch current lock status
      const lockStatusResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: lockRange,
      });

      const lockData = lockStatusResponse.result.values?.[0] || ['', ''];
      const [lockStatus, lockTimestamp] = lockData;

      // Check if locked and still valid
      if (lockStatus === 'locked') {
        const lockTime = new Date(lockTimestamp).getTime();
        const now = new Date().getTime();
        if (now - lockTime < LOCK_TIMEOUT) {
          // Lock is active, wait and retry
          const backoffTime = Math.pow(2, retryCount) * 1000 + Math.random() * 500; // Exponential backoff + jitter
          console.log(`Lock detected, retrying in ${backoffTime}ms (attempt ${retryCount + 1}/${maxRetries})`);
          await delay(backoffTime);
          retryCount++;
          continue;
        }
      }

      // Attempt to acquire lock
      const timestamp = new Date().toISOString();
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: lockRange,
        valueInputOption: 'RAW',
        resource: { values: [['locked', timestamp]] },
      });

      // Verify we acquired the lock (re-fetch to confirm)
      const verifyLock = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: lockRange,
      });
      const [newLockStatus, newTimestamp] = verifyLock.result.values?.[0] || ['', ''];
      if (newLockStatus !== 'locked' || newTimestamp !== timestamp) {
        console.log('Failed to acquire lock, retrying');
        await delay(1000); // Short delay before retry
        retryCount++;
        continue;
      }

      // Process ratings (with conflict resolution)
      const result = await processRatings(ratings);

      // Release lock
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: lockRange,
        valueInputOption: 'RAW',
        resource: { values: [['', '']] },
      });

      return result; // Success
    } catch (error) {
      console.error('Error in submitRatingsWithLock:', error);
      retryCount++;
      if (retryCount >= maxRetries) {
        // Release lock on final failure
        await gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: lockRange,
          valueInputOption: 'RAW',
          resource: { values: [['', '']] },
        });
        throw new Error('Max retries reached, submission failed');
      }
      await delay(Math.pow(2, retryCount) * 1000); // Exponential backoff
    }
  }

  throw new Error('Unexpected failure in submitRatingsWithLock');
}

// Updated processRatings with conflict resolution
async function processRatings(ratings) {
  // Fetch the latest data
  const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
  });

  let existingData = response.result.values || [];
  const newRatings = [];
  let isUpdated = false;

  // Create a map of existing ratings by ratingCode (column A)
  const existingRatingsMap = new Map();
  existingData.forEach((row, index) => {
    if (row[0]) existingRatingsMap.set(row[0], { row, index });
  });

  // Process each new rating
  ratings.forEach(newRating => {
    const ratingCode = newRating[0];
    if (existingRatingsMap.has(ratingCode)) {
      // Update existing rating
      const { index } = existingRatingsMap.get(ratingCode);
      existingData[index] = newRating;
      isUpdated = true;
    } else {
      // Add new rating
      newRatings.push(newRating);
    }
  });

  const batchUpdates = [];
  if (isUpdated) {
    // Write back updated existing data
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
    // Append new ratings
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

  const headerSection = document.createElement('div');
  headerSection.innerHTML = `
    <h2 style="font-size: 22px; text-align: center;">YOU ARE RATING</h2>
    <h2 style="font-size: 36px; text-align: center;">${name}</h2>
  `;
  container.appendChild(headerSection);

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
        button.textContent = value ? 'Open Link' : 'NONE';
        if (value) {
          button.addEventListener('click', () => window.open(value, '_blank'));
        } else {
          button.disabled = true;
        }
        content.appendChild(button);
      }
      tile.appendChild(content);
      tilesContainer.appendChild(tile);
    });

    container.appendChild(tilesContainer);

    const existingStyle = document.getElementById('candidates-table-styles');
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = 'candidates-table-styles';
      style.innerHTML = `
        .tiles-container {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
          gap: 15px;
          justify-items: center;
          padding: 20px;
        }
        .tile {
          border: 1px solid #ccc;
          border-radius: 8px;
          padding: 10px;
          background-color: #f9f9f9;
          width: 100%;
          text-align: center;
          word-wrap: break-word;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          max-height: 200px;
        }
        .tile h4 {
          font-size: 14px;
          font-weight: bold;
          margin-bottom: 10px;
          text-align: center;
        }
        .tile-content p {
          font-size: 12px;
          font-weight: bold;
          color: #333;
          word-wrap: break-word;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: normal;
          margin: 5px 0;
        }
        .tile-content p.no-data {
          color: #888;
          font-style: italic;
        }
        .open-link-button {
          background-color: rgb(65, 65, 65);
          color: white;
          border: none;
          padding: 5px 10px;
          font-size: 12px;
          cursor: pointer;
          margin-top: 10px;
        }
        .open-link-button:hover {
          background-color: rgb(0, 0, 0);
        }
        .open-link-button:disabled {
          background-color: #ccc;
          cursor: not-allowed;
        }
      `;
      document.head.appendChild(style);
    }
  } else {
    container.innerHTML = '<p>No matching data found.</p>';
  }
}

async function fetchCompetenciesFromSheet() {
  try {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'ALLCOMPE!A:B',
    });

    const competenciesColumn1 = response.result.values
      ? response.result.values.map(row => row[0]).filter(value => value)
      : [];
    const competenciesColumn2 = response.result.values
      ? response.result.values.map(row => row[1]).filter(value => value)
      : [];

    return { competenciesColumn1, competenciesColumn2 };
  } catch (error) {
    console.error('Error fetching competencies:', error);
    return { competenciesColumn1: [], competenciesColumn2: [] };
  }
}

async function displayCompetencies(name, competencies) {
  const { competenciesColumn1, competenciesColumn2 } = await fetchCompetenciesFromSheet();

  elements.competencyContainer.innerHTML = `
    <div class="competency-section" id="basic-competencies">
      <h3 style="font-size: 32px;">PSYCHO-SOCIAL ATTRIBUTES AND PERSONALITY TRAITS</h3>
      <h3>BASIC COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    <div class="competency-section" id="organizational-competencies">
      <h3 style="font-size: 32px;">POTENTIAL</h3>
      <h3>ORGANIZATIONAL COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    <div class="competency-section" id="minimum-competencies">
      <h3>MINIMUM COMPETENCIES</h3>
      <div class="competency-grid"></div>
    </div>
    <div class="results-area">
      <h3 style="font-size: 32px;">RATING RESULTS</h3>
      <div class="row">
        <div class="result-tile small-tile" id="basic-rating-tile">
          <span class="tile-label">BASIC COMPETENCIES:</span>
          <span class="tile-value">0.00</span>
        </div>
        <div class="result-tile small-tile" id="organizational-rating-tile">
          <span class="tile-label">ORGANIZATIONAL COMPETENCIES:</span>
          <span class="tile-value">0.00</span>
        </div>
        <div class="result-tile small-tile" id="minimum-rating-tile">
          <span class="tile-label">MINIMUM COMPETENCIES:</span>
          <span class="tile-value">0.00</span>
        </div>
      </div>
      <div class="row">
        <div class="result-tile large-tile" id="psychosocial-tile">
          <span class="tile-label">PSYCHO-SOCIAL ATTRIBUTES AND PERSONALITY TRAITS:</span>
          <span class="tile-value">0.00</span>
        </div>
        <div class="result-tile large-tile" id="potential-tile">
          <span class="tile-label">POTENTIAL:</span>
          <span class="tile-value">0.00</span>
        </div>
      </div>
    </div>
    <button id="reset-ratings" class="btn-reset">RESET RATINGS</button>
  `;

  const style = document.createElement("style");
  style.innerHTML = `
    .results-area { display: flex; flex-direction: column; align-items: center; gap: 20px; margin: 30px 0; text-align: center; }
    .row { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; width: 100%; }
    .result-tile { padding: 30px; border-radius: 12px; border: 1px solid #666; background-color: #f9f9f9; color: #222; text-transform: uppercase; display: flex; flex-direction: column; gap: 20px; justify-content: center; align-items: center; text-align: center; min-height: 140px; font-weight: bold; flex: 1 1 200px; box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1); transition: transform 0.2s; }
    .result-tile:hover { transform: scale(1.05); }
    .tile-label { font-size: clamp(1rem, 2.5vw, 1.5rem); width: 100%; color: #555; }
    .tile-value { font-size: clamp(2.2rem, 5vw, 3.2rem); color: #111; font-weight: 900; }
    .small-tile { flex: 1 1 200px; background-color: #ffffff; }
    .large-tile { flex: 1 1 350px; background-color: #eaf4f4; }
    .large-tile .tile-label { font-size: clamp(1.3rem, 2.8vw, 1.8rem); }
    .large-tile .tile-value { font-size: clamp(2.8rem, 5.5vw, 3.8rem); }
    .btn-reset { margin-top: 25px; padding: 10px 20px; font-size: 1rem; color: #333; background-color: #fff; border: 1px solid #666; border-radius: 6px; cursor: pointer; }
    .btn-reset:hover { background-color: #d9534f; color: white; }
    @media (max-width: 768px) { .row { flex-direction: column; } .result-tile { padding: 20px; min-height: 100px; flex: 1 1 90%; } }
  `;
  document.head.appendChild(style);

  const basicCompetencyRatings = Array(competenciesColumn1.length).fill(0);
  const organizationalCompetencyRatings = Array(competenciesColumn2.length).fill(0);
  const minimumCompetencyRatings = Array(competencies.length).fill(0);

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
      });
    });
    return div;
  }

  const basicGrid = document.querySelector("#basic-competencies .competency-grid");
  competenciesColumn1.slice(0, 5).forEach((comp, idx) => {
    basicGrid.appendChild(
      createCompetencyItem(comp, idx, basicCompetencyRatings, computeTotalBasicRating)
    );
  });

  const organizationalGrid = document.querySelector("#organizational-competencies .competency-grid");
  competenciesColumn2.slice(0, 5).forEach((comp, idx) => {
    organizationalGrid.appendChild(
      createCompetencyItem(comp, idx, organizationalCompetencyRatings, computeOrganizationalRating)
    );
  });

  const minimumGrid = document.querySelector("#minimum-competencies .competency-grid");
  competencies.forEach((comp, idx) => {
    minimumGrid.appendChild(
      createCompetencyItem(comp, idx, minimumCompetencyRatings, computeMinimumRating)
    );
  });

  function computeTotalBasicRating() {
    const totalRating = basicCompetencyRatings.filter(r => r > 0).reduce((sum, r) => sum + (r / 5) * 2, 0);
    document.getElementById("basic-rating-tile").querySelector('.tile-value').textContent = totalRating.toFixed(2);
  }

  function computeOrganizationalRating() {
    const totalRating = organizationalCompetencyRatings.filter(r => r > 0).reduce((sum, r) => sum + r / 5, 0);
    document.getElementById("organizational-rating-tile").querySelector('.tile-value').textContent = totalRating.toFixed(2);
  }

  function computeMinimumRating() {
    const totalRating = minimumCompetencyRatings.filter(r => r > 0).reduce((sum, r) => sum + r / minimumCompetencyRatings.length, 0);
    document.getElementById("minimum-rating-tile").querySelector('.tile-value').textContent = totalRating.toFixed(2);
  }

  function computePsychosocial() {
    const basicTotal = parseFloat(document.getElementById("basic-rating-tile").querySelector('.tile-value').textContent) || 0;
    document.getElementById("psychosocial-tile").querySelector('.tile-value').textContent = basicTotal.toFixed(2);
  }

  function computePotential() {
    const organizationalTotal = parseFloat(document.getElementById("organizational-rating-tile").querySelector('.tile-value').textContent) || 0;
    const minimumTotal = parseFloat(document.getElementById("minimum-rating-tile").querySelector('.tile-value').textContent) || 0;
    const potential = ((organizationalTotal + minimumTotal) / 2) * 2;
    document.getElementById("potential-tile").querySelector('.tile-value').textContent = potential.toFixed(2);
  }

  document.getElementById("reset-ratings").addEventListener("click", () => {
    document.querySelectorAll(".competency-item input[type='radio']").forEach(input => {
      input.checked = false;
    });
    basicCompetencyRatings.fill(0);
    organizationalCompetencyRatings.fill(0);
    minimumCompetencyRatings.fill(0);
    computeTotalBasicRating();
    computeOrganizationalRating();
    computeMinimumRating();
    computePsychosocial();
    computePotential();
  });
}

// Event Listeners
elements.signInBtn.addEventListener('click', handleAuthClick);
// Removed: elements.signOutBtn.addEventListener('click', handleSignOutClick);
if (elements.submitRatings) {
  elements.submitRatings.removeEventListener('click', submitRatings);
  elements.submitRatings.addEventListener('click', submitRatings);
  console.log('Submit ratings listener attached');
}
