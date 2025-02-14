// Global variables for GIS and API functionality
let gisInitialized = false;
let gapiInitialized = false;
let tokenClient = null;
let currentEvaluator = null;

// Variables for config data (populated after fetching from backend)
let CLIENT_ID;
let API_KEY;
let SHEET_ID;
let SCOPES;
let EVALUATOR_PASSWORDS;
let SHEET_RANGES;

// DOM elements
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

// Fetch constants from the backend
const API_BASE_URL = "https://rhrmspb-rater-by-dan.onrender.com";

fetch(`${API_BASE_URL}/config`)
  .then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return response.json();
  })
  .then((config) => {
    // Extract constants from config
    // Assign constants to global variables
    CLIENT_ID = config.CLIENT_ID;
    API_KEY = config.API_KEY;
    SHEET_ID = config.SHEET_ID;
    SCOPES = config.SCOPES;
    EVALUATOR_PASSWORDS = config.EVALUATOR_PASSWORDS;
    SHEET_RANGES = config.SHEET_RANGES;

    // Use these constants in the rest of your script
    createEvaluatorSelector();

    // Initialize the app after config is loaded
    initializeApp();
  })
  .catch((error) => {
    console.error("Error fetching config:", error);
  });

// Define GIS loading logic globally
function gisLoaded() {
  console.log(`GIS loaded with CLIENT_ID: "successful"`);
  const gisConfig = {
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: handleTokenCallback, // Provide a callback function
  };
  console.log('GIS Config:', "successful");

  gisInitialized = true;
  maybeEnableButtons();
}

// Initialize app only after config is loaded
function initializeApp() {
    // Call GIS loading logic
    gisLoaded();

  // Initialize the Google API client
  gapi.load('client', initializeGapiClient);

  // Initialize Token Client after the config is loaded
  initializeTokenClient();
}

gapi.load('client', async () => {
  await gapi.client.init({
      apiKey: API_KEY, // Replace with your API Key
      discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
  });
  gapiInitialized = true;
  maybeEnableButtons(); // Enable buttons if GIS is also initialized
});

function initializeTokenClient() {
    if (!CLIENT_ID || !SCOPES) {
        console.error('CLIENT_ID or SCOPES are not defined');
        return;
    }

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: handleTokenCallback, // Provide a callback function
        prompt: 'select_account'
    });

    console.log('Token Client Initialized');
}

function handleTokenCallback(tokenResponse) {
  if (tokenResponse.error) {
    console.error('Token error:', tokenResponse.error);
  } else {
    console.log('Token received:', tokenResponse);
    // You can store the token and use it for further API requests
    // For example, store the access token
    const accessToken = tokenResponse.access_token;
    gapi.client.setApiKey(accessToken); // Set API Key with the token
  }
}

function maybeEnableButtons() {
  // Enable buttons if both GIS and GAPI are initialized
  if (gisInitialized && gapiInitialized) {
    elements.signInBtn.style.display = 'inline-block';
    elements.signOutBtn.style.display = 'inline-block';
  }
}

function createEvaluatorSelector() {

  if (!EVALUATOR_PASSWORDS || Object.keys(EVALUATOR_PASSWORDS).length === 0) {
    return;
   }

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
  } else {
    console.error('Error: .rating-form element not found in the DOM.');
  }
}


// Handle evaluator selection
async function handleEvaluatorSelection(event) {
  const selectElement = event.target;
  const newSelection = selectElement.value;

  // Immediately revert the select element to the current evaluator (if any)
  selectElement.value = currentEvaluator || '';

  // If no evaluator is selected, reset and exit
  if (!newSelection) {
    currentEvaluator = null;
    console.log('No evaluator selected. Resetting dropdowns.');
    resetDropdowns(vacancies);
    return;
  }

  const modalContent = `
      <p>Please enter the password for ${newSelection}:</p>
      <input type="password" id="evaluatorPassword" class="modal-input" 
             style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-top: 10px;">
  `;

  // Show modal for password input
  showModal('Evaluator Authentication', modalContent, () => {
    const passwordInput = document.getElementById('evaluatorPassword');
    const password = passwordInput.value.trim();

    if (password === EVALUATOR_PASSWORDS[newSelection]) {
      // Only update the select element and currentEvaluator after successful authentication
      selectElement.value = newSelection;
      currentEvaluator = newSelection;
      console.log(`Logged in successfully as ${newSelection}`);
      showToast('success', 'Success', `Logged in as ${newSelection}`);

      // Reset dropdowns and fetch data for the new evaluator
      console.log('Resetting dropdowns for the new evaluator.');
      resetDropdowns(vacancies);
      fetchSubmittedRatings();
    } else {
      console.error('Incorrect password.');
      showToast('error', 'Error', 'Incorrect password');
      // Select element is already set to the previous value
    }
  });
}

// Initialize evaluator dropdown on page load
document.addEventListener('DOMContentLoaded', () => {
  createEvaluatorSelector();  // Ensure the dropdown is created when the DOM is ready
});


// Initialize the Google API client
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


// Enable sign-in/out buttons if both GAPI and GIS are initialized
function maybeEnableButtons() {
  if (gapiInitialized && gisInitialized) {
    elements.signInBtn.style.display = 'block';
    elements.authStatus.textContent = 'Ready to sign in';
  }
}

// Handle authentication (sign-in)
function handleAuthClick() {
  tokenClient.callback = async (resp) => {
      if (resp.error) {
          elements.authStatus.textContent = 'Error during sign-in';
          return console.error('Auth error:', resp.error);
      }
      elements.authStatus.textContent = 'Signed in';
      elements.signInBtn.style.display = 'none';
      elements.signOutBtn.style.display = 'block';
      await loadSheetData();
  };
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

// Handle sign-out
function handleSignOutClick() {
  const token = gapi.client.getToken();
  if (token) {
    google.accounts.oauth2.revoke(token.access_token, () => {
      gapi.client.setToken(null);

      // Update UI upon successful sign-out
      elements.authStatus.textContent = 'Signed out';
      elements.signInBtn.style.display = 'block';
      elements.signOutBtn.style.display = 'none';

      // Clear global data if necessary
      vacancies = [];
      candidates = [];
      compeCodes = [];
      competencies = [];
    });
  }
}

// Global variables for Google Sheets data
let vacancies = [];
let candidates = [];
let compeCodes = [];
let competencies = [];

// Load data from Google Sheets
async function loadSheetData() {
  try {
    const ranges = Object.values(SHEET_RANGES);

    // Fetch all data ranges in parallel
    const data = await Promise.all(
      ranges.map((range) =>
        gapi.client.sheets.spreadsheets.values.get({
          spreadsheetId: SHEET_ID,
          range,
        })
      )
    );

    // Assign fetched data to global variables
    vacancies = data[0]?.result?.values || [];
    candidates = data[1]?.result?.values || [];
    compeCodes = data[2]?.result?.values || [];
    competencies = data[3]?.result?.values || [];

    console.log('Sheet data loaded:', { vacancies, candidates, compeCodes, competencies });

    // Initialize dropdowns with the loaded data
    initializeDropdowns(vacancies, candidates, compeCodes, competencies);
  } catch (error) {
    console.error('Error loading sheet data:', error);
    elements.authStatus.textContent = 'Error loading sheet data';
  }
}

// Generic function to update dropdowns
function updateDropdown(dropdown, options, defaultOptionText = 'Select') {
  // Clear existing options and add default option
  dropdown.innerHTML = `<option value="">${defaultOptionText}</option>`;

  // Populate dropdown with new options
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    dropdown.appendChild(option);
  });
}

// Initialize dropdowns with loaded data
function initializeDropdowns(vacancies, candidates, compeCodes, competencies) {
  if (elements.assignmentDropdown) {
    updateDropdown(
      elements.assignmentDropdown,
      vacancies.map((v) => v[0]), // Assuming the first column has vacancy titles
      'Select Vacancy'
    );
  }

  if (elements.nameDropdown) {
    updateDropdown(
      elements.nameDropdown,
      candidates.map((c) => c[0]), // Assuming the first column has candidate names
      'Select Candidate'
    );
  }

  if (elements.itemDropdown) {
    updateDropdown(
      elements.itemDropdown,
      compeCodes.map((cc) => cc[0]), // Assuming the first column has item codes
      'Select Item'
    );
  }

  if (elements.competencyContainer) {
    updateDropdown(
      elements.competencyContainer,
      competencies.map((comp) => comp[0]), // Assuming the first column has competency names
      'Select Competency'
    );
  }
}


function initializeDropdowns(vacancies, candidates, compeCodes, competencies) {
  // Helper function to disable/enable dropdown
  function setDropdownState(dropdown, enabled) {
      dropdown.disabled = !enabled;
      if (!enabled) {
          dropdown.value = '';
          dropdown.innerHTML = `<option value="">${dropdown.getAttribute('data-placeholder') || 'Select Option'}</option>`;
      }
  }

  // Set initial placeholders
  elements.assignmentDropdown.setAttribute('data-placeholder', 'Select Assignment');
  elements.positionDropdown.setAttribute('data-placeholder', 'Select Position');
  elements.itemDropdown.setAttribute('data-placeholder', 'Select Item');
  elements.nameDropdown.setAttribute('data-placeholder', 'Select Name');

  // Initialize assignment dropdown
  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(elements.assignmentDropdown, uniqueAssignments, 'Select Assignment');
  
  // Disable other dropdowns initially
  setDropdownState(elements.positionDropdown, false);
  setDropdownState(elements.itemDropdown, false);
  setDropdownState(elements.nameDropdown, false);

  // Assignment change handler
  elements.assignmentDropdown.addEventListener('change', () => {
      const assignment = elements.assignmentDropdown.value;
      
      if (assignment) {
          const positions = vacancies
              .filter((row) => row[2] === assignment)
              .map((row) => row[1]);
          updateDropdown(elements.positionDropdown, [...new Set(positions)], 'Select Position');
          setDropdownState(elements.positionDropdown, true);
      } else {
          setDropdownState(elements.positionDropdown, false);
      }
      
      // Reset and disable dependent dropdowns
      setDropdownState(elements.itemDropdown, false);
      setDropdownState(elements.nameDropdown, false);
  });

  // Position change handler
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
      
      // Reset and disable name dropdown
      setDropdownState(elements.nameDropdown, false);
  });

  // Item change handler
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
  });

  // Name change handler
  elements.nameDropdown.addEventListener('change', () => {
      const item = elements.itemDropdown.value;
      const name = elements.nameDropdown.value;
      
      if (item && name) {
          displayCandidatesTable(name, item);  // Call function to display data for selected name and item
          const selectedCodes = compeCodes
              .filter((row) => row[0] === item)
              .flatMap((row) => row[1].split(','));
          const relatedCompetencies = competencies
              .filter((row) => selectedCodes.includes(row[0]))
              .map((row) => row[1]);
          displayCompetencies(name, relatedCompetencies);
      }
  });
}



// Function to display the candidates table
// Function to display the candidates table
function displayCandidatesTable(name, itemNumber) {
  const candidatesTableContainer = document.getElementById('candidates-table');
  
  // Clear previous table content
  candidatesTableContainer.innerHTML = '';

  // Add the header before the tiles
  const headerSection = document.createElement('div');
  headerSection.innerHTML = `
      <h2 style="font-size: 22px; text-align: center;">YOU ARE RATING</h2>
      <h2 style="font-size: 36px; text-align: center;">${name}</h2>
  `;
  candidatesTableContainer.appendChild(headerSection);

  // Find the matching row in the candidates array
  const candidateRow = candidates.find(row => row[0] === name && row[1] === itemNumber);
  
  if (candidateRow) {
      // Create a container to hold the tiles
      const tilesContainer = document.createElement('div');
      tilesContainer.classList.add('tiles-container'); // Add class for styling

      // Define the headers for columns C to P (name them according to the order you provided)
      const headers = [
          'SEX', 'DATE OF BIRTH', 'AGE', 'ELIGIBILITY/PROFESSION', 'PROFESSIONAL LICENSE',
          'LETTER OF INTENT (PDF FILE)', 'PERSONAL DATA SHEET (SPREADSHEET FILE)',
          'WORK EXPERIENCE SHEET (WORD FILE)', 'PROOF OF ELIGIBILITY (PDF FILE)', 
          'CERTIFICATES (PDF FILE)', 'INDIVIDUAL PERFORMANCE COMMITMENT REVIEW (PDF FILE)',
          'CERTIFICATE OF EMPLOYMENT (PDF FILE)', 'DIPLOMA (PDF FILE)', 
          'TRANSCRIPT OF RECORDS (PDF FILE)'
      ];

      // Extract data from columns C to P (index 2 to 15)
      const columnsCtoP = candidateRow.slice(2, 16);

      // Create tiles for each column
      columnsCtoP.forEach((value, index) => {
          const tile = document.createElement('div');
          tile.classList.add('tile'); // Add class for styling

          const header = document.createElement('h4');
          header.textContent = headers[index]; // Set header as the tile label
          tile.appendChild(header);

          const content = document.createElement('div');
          content.classList.add('tile-content');

          if (index < 4) {
              // Columns C to F (text content)
              const textContent = document.createElement('p');
              textContent.textContent = value || 'No Data';
              content.appendChild(textContent);
          } else {
              // Columns G to P (links, hidden until clicked)
              const button = document.createElement('button');
              button.classList.add('open-link-button');

              if (value) {
                  // If there's a link, show the "Open Link" button
                  button.textContent = 'Open Link'; // Label for the button
                  button.addEventListener('click', () => {
                      window.open(value, '_blank'); // Open the link in a new tab
                  });
              } else {
                  // If there's no link or it's empty, show "NONE" label
                  button.textContent = 'NONE'; // Label for the button
                  button.disabled = true; // Optionally, disable the button if there's no link
              }

              content.appendChild(button);
          }
          tile.appendChild(content);
          tilesContainer.appendChild(tile);
      });

      // Append the tiles container to the main container
      candidatesTableContainer.appendChild(tilesContainer);
  } else {
      // If no matching row is found, display a message
      candidatesTableContainer.innerHTML = '<p>No matching data found.</p>';
  }
}

// Style for the tiles container and individual tiles
const style = document.createElement('style');
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
      max-height: 200px; /* Limit max height for overflow handling */
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
  .open-link-button {
      background-color:rgb(65, 65, 65);
      color: white;
      border: none;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
      margin-top: 10px;
  }
  .open-link-button:hover {
      background-color:rgb(0, 0, 0);
  }
  .open-link-button:disabled {
      background-color: #ccc;
      cursor: not-allowed;
  }
  .tile-content p.no-data {
      color: #888;
      font-style: italic;
  }
`;
document.head.appendChild(style);


async function fetchCompetenciesFromSheet() {
    try {
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID, // Replace with your actual sheet ID
        range: 'ALLCOMPE!A:B',    // Fetch from Columns A and B
      });
  
      const competenciesColumn1 = response.result.values
        ? response.result.values.map(row => row[0]).filter(value => value)  // Get Column A competencies
        : [];
        
      const competenciesColumn2 = response.result.values
        ? response.result.values.map(row => row[1]).filter(value => value)  // Get Column B competencies
        : [];
  
      return { competenciesColumn1, competenciesColumn2 };
    } catch (error) {
      console.error('Error fetching competencies from sheet:', error);
      alert('Error fetching competencies.');
      return { competenciesColumn1: [], competenciesColumn2: [] };
    }
  }


  async function displayCompetencies(name, competencies) {
    const { competenciesColumn1, competenciesColumn2 } = await fetchCompetenciesFromSheet();

    // Clear the container and set the structure
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
    <!-- Updated Results Area -->
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

// Updated styles
const style = document.createElement("style");
style.innerHTML = `
    .results-area {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        margin: 30px 0;
        text-align: center;
    }

    .row {
        display: flex;
        flex-wrap: wrap;
        gap: 20px;
        justify-content: center;
        width: 100%;
    }

    .result-tile {
        padding: 30px;
        border-radius: 12px;
        border: 1px solid #666;
        outline: 1px solid #aaa;
        background-color: #f9f9f9;
        color: #222;
        text-transform: uppercase;
        display: flex;
        flex-direction: column;  /* Ensure content stacks vertically */
        gap: 20px;  /* Add space between the label and value */
        justify-content: center;
        align-items: center;
        text-align: center;
        min-height: 140px;
        font-weight: bold;
        line-height: 1.4;
        overflow-wrap: break-word;
        word-wrap: break-word;
        white-space: normal;
        flex: 1 1 200px;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
        transition: transform 0.2s, box-shadow 0.2s;
    }

    .result-tile:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .tile-label {
        font-size: clamp(1rem, 2.5vw, 1.5rem);
        width: 100%;
        color: #555;
        margin-bottom: 10px; /* Ensure some space below the label */
    }

    .tile-value {
        font-size: clamp(2.2rem, 5vw, 3.2rem);
        color: #111;
        font-weight: 900;
        margin-top: 10px; /* Added space between title and value */
    }

    .small-tile {
        flex: 1 1 200px;
        background-color: #ffffff;
    }

    .large-tile {
        flex: 1 1 350px;
        background-color: #eaf4f4;
        color: #222;
    }

    .large-tile .tile-label {
        font-size: clamp(1.3rem, 2.8vw, 1.8rem);
    }

    .large-tile .tile-value {
        font-size: clamp(2.8rem, 5.5vw, 3.8rem);
    }

    /* Make Psycho-Social and Potential more prominent */
    #psychosocial-tile .tile-label,
    #potential-tile .tile-label {
        font-size: 1.6rem;
        font-weight: bold;
    }

    /* Reset Button */
    .btn-reset {
        margin-top: 25px;
        padding: 10px 20px;
        font-size: 1rem;
        color: #333;
        background-color: #fff;
        border: 1px solid #666;
        outline: 1px solid #888;
        border-radius: 6px;
        cursor: pointer;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }

    .btn-reset:hover {
        background-color: #d9534f;
        color: white;
    }

    /* Media query for portrait mode (narrow screens) */
    @media (max-width: 768px) {
        .row {
            flex-direction: column;
            align-items: center;
            gap: 15px;
        }
        .result-tile {
            padding: 20px;
            min-height: 100px;
            flex: 1 1 90%;
        }
        .tile-label {
            font-size: clamp(0.9rem, 2vw, 1.3rem);
        }
        .tile-value {
            font-size: clamp(2rem, 4.5vw, 2.8rem);
        }
    }

    /* Media query for tablets in landscape */
    @media (min-width: 768px) and (max-width: 1024px) {
        .result-tile {
            padding: 30px;
            min-height: 140px;
        }
        .tile-label {
            font-size: clamp(1rem, 2.2vw, 1.4rem);
        }
        .tile-value {
            font-size: clamp(2.4rem, 5vw, 3rem);
        }
    }
`;
    
    document.head.appendChild(style);

    // Prepare rating trackers
    const basicCompetencyRatings = Array(competenciesColumn1.length).fill(0);
    const organizationalCompetencyRatings = Array(competenciesColumn2.length).fill(0);
    const minimumCompetencyRatings = Array(competencies.length).fill(0);

    function displayCandidatesTable() {
    // Extract only columns C:P from the candidates data
    const candidatesData = candidates.map((row) => row.slice(2, 16));

    // Get the container for the table
    const container = document.getElementById("candidates-table");

    // Create a table element
    const table = document.createElement("table");

    // Add headers
    const headers = candidatesData[0];
    if (headers) {
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headers.forEach((header) => {
            const th = document.createElement("th");
            th.textContent = header;
            headerRow.appendChild(th);
        });
    }

    // Add body rows
    const tbody = table.createTBody();
    candidatesData.slice(1).forEach((row) => {
        const tr = tbody.insertRow();
        row.forEach((cell) => {
            const td = document.createElement("td");
            td.textContent = cell || ""; // Use an empty string for undefined cells
            tr.appendChild(td);
        });
    });

    // Clear the container and append the table
    container.innerHTML = "";
    container.appendChild(table);
}

    function createCompetencyItem(comp, idx, ratings, updateFunction) {
        const div = document.createElement("div");
        div.className = "competency-item";
        div.innerHTML = `
            <label>${idx + 1}. ${comp}</label>
            <div class="rating-container">
                ${[1, 2, 3, 4, 5]
                    .map(
                        (val) => `
                    <input type="radio" id="${comp}-${val}" name="${comp}" value="${val}">
                    <label for="${comp}-${val}">${val}</label>`
                    )
                    .join("")}
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
        const totalRating = basicCompetencyRatings.filter((r) => r > 0).reduce((sum, r) => sum + (r / 5) * 2, 0);
        document.getElementById("basic-rating-tile").textContent = `BASIC COMPETENCIES: ${totalRating.toFixed(2)}`;
    }

    function computeOrganizationalRating() {
        const totalRating = organizationalCompetencyRatings.filter((r) => r > 0).reduce((sum, r) => sum + r / 5, 0);
        document.getElementById("organizational-rating-tile").textContent = `ORGANIZATIONAL COMPETENCIES: ${totalRating.toFixed(2)}`;
    }

    function computeMinimumRating() {
        const totalRating = minimumCompetencyRatings.filter((r) => r > 0).reduce((sum, r) => sum + r / minimumCompetencyRatings.length, 0);
        document.getElementById("minimum-rating-tile").textContent = `MINIMUM COMPETENCIES: ${totalRating.toFixed(2)}`;
    }

    function computePsychosocial() {
        const basicTotal = parseFloat(document.getElementById("basic-rating-tile").textContent.split(": ")[1]) || 0;
        document.getElementById("psychosocial-tile").textContent = `PSYCHO-SOCIAL ATTRIBUTES AND PERSONALITY TRAITS: ${basicTotal.toFixed(2)}`;
    }

    function computePotential() {
        const organizationalTotal = parseFloat(document.getElementById("organizational-rating-tile").textContent.split(": ")[1]) || 0;
        const minimumTotal = parseFloat(document.getElementById("minimum-rating-tile").textContent.split(": ")[1]) || 0;
        const potential = ((organizationalTotal + minimumTotal) / 2) * 2;
        document.getElementById("potential-tile").textContent = `POTENTIAL: ${potential.toFixed(2)}`;
    }

    document.getElementById("reset-ratings").addEventListener("click", () => {
        document.querySelectorAll(".competency-item input[type='radio']").forEach((input) => {
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


let fetchTimeout;

async function fetchSubmittedRatings() {
  // Clear any ongoing fetches if the user rapidly switches names
  if (fetchTimeout) clearTimeout(fetchTimeout);

  // Delay fetching to ensure stable selection
  fetchTimeout = setTimeout(async () => {
    const name = elements.nameDropdown.value; // Selected candidate name
    const item = elements.itemDropdown.value; // Selected item

    // Check if an evaluator is selected and authenticated
    if (!currentEvaluator) {
      console.warn('No evaluator selected or authenticated.');
      return;
    }

    // Clear existing ratings
    clearRatings();

    if (!name || !item) {
      console.warn('Name or item not selected.');
      return;
    }

    try {
      // Fetch data from the RATELOG sheet
      const response = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: SHEET_RANGES.RATELOG, // Use RATELOG range from constants
      });

      const data = response.result.values || [];
      const headers = data[0]; // Header row
      const rows = data.slice(1); // Actual data rows

      // Filter rows matching the selected name, item, and authenticated evaluator (column 6 - index 5)
      const filteredRows = rows.filter(row =>
        row[2] === name && row[1] === item && row[5] === currentEvaluator
      );

      if (filteredRows.length === 0) {
        console.warn('No ratings found for the selected name, item, and evaluator.');
        elements.submitRatings.disabled = false; // No data found, enable submit button
        return;
      }

      // Create a mapping of competency names to ratings, now including evaluator
      const competencyRatings = {};
      filteredRows.forEach(row => {
        const competencyName = row[3]; // Column 4 (index 3) for competency name
        const rating = row[4]; // Column 5 (index 4) for rating
        
        // Ensure the competency name exists in the map, and include evaluator-based rating
        if (!competencyRatings[competencyName]) {
          competencyRatings[competencyName] = {};
        }
        competencyRatings[competencyName][currentEvaluator] = rating;
      });

      console.log('Competency Ratings:', competencyRatings); // Debugging line

      // Pre-fill the competency ratings in the DOM
      prefillRatings(competencyRatings);

    } catch (error) {
      console.error('Error fetching submitted ratings:', error);
      alert('Error fetching submitted ratings. Please try again.');
    }
  }, 300); // Debounce delay (300ms)
}

// Clear all ratings in the DOM
function clearRatings() {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  Array.from(competencyItems).forEach(item => {
    const radios = item.querySelectorAll('input[type="radio"]');
    radios.forEach(radio => (radio.checked = false)); // Uncheck all radio buttons
  });
}

// Pre-fill the competency ratings
let originalRatings = {};

function prefillRatings(competencyRatings) {
    // Store original ratings before modification
    originalRatings = {};
    const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');

    // If no ratings exist, just unlock the submit button
    if (Object.keys(competencyRatings).length === 0) {
        elements.submitRatings.disabled = false;
        return; // Skip the pre-fill process if no ratings exist
    }

    Array.from(competencyItems).forEach(item => {
        const competencyName = item.querySelector('label').textContent.split('. ')[1];
        const rating = competencyRatings[competencyName] ? competencyRatings[competencyName][currentEvaluator] : null;

        if (rating) {
            const radio = item.querySelector(`input[type="radio"][value="${rating}"]`);
            if (radio) {
                // Store original rating
                originalRatings[competencyName] = rating;

                radio.checked = true;
                radio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    });

    // Enable the submit button if there is data, regardless of any changes
    elements.submitRatings.disabled = false;

    // Function to check if all ratings are selected and changes are detected
    function checkAllRatingsSelected() {
        const allItems = Array.from(elements.competencyContainer.getElementsByClassName('competency-item'));

        // Check if all ratings are selected
        const allRated = allItems.every(item => {
            const inputs = Array.from(item.getElementsByTagName('input'));
            return inputs.some(input => input.checked);
        });

        // Enable the submit button if all items are rated, regardless of changes
        elements.submitRatings.disabled = !allRated;
    }

    // Add change listeners to track modifications
    Array.from(competencyItems).forEach(item => {
        const inputs = item.querySelectorAll('input[type="radio"]');
        inputs.forEach(input => {
            input.addEventListener('change', function() {
                // Ensure original ratings are updated on any change
                const competencyName = item.querySelector('label').textContent.split('. ')[1];
                originalRatings[competencyName] = input.value;

                // Re-check ratings status
                checkAllRatingsSelected();
            });
        });
    });

    // Initial check to update the submit button state
    checkAllRatingsSelected();
}

// Add this function to the name dropdown's change event listener
elements.nameDropdown.addEventListener('change', fetchSubmittedRatings);
elements.itemDropdown.addEventListener('change', fetchSubmittedRatings);





// Function to reset all dropdowns to their default state
function resetDropdowns(vacancies) {
  console.log('Fetching unique assignments to reset the dropdowns.');

  // Ensure vacancies is defined
  if (!vacancies || !Array.isArray(vacancies)) {
    console.error('Error: vacancies data is undefined or invalid.');
    return;
  }

  // Reset Assignments dropdown
  const uniqueAssignments = [...new Set(vacancies.slice(1).map((row) => row[2]))];
  updateDropdown(elements.assignmentDropdown, uniqueAssignments, 'Select Assignment');

  // Clear dependent dropdowns
  updateDropdown(elements.positionDropdown, [], 'Select Position');
  updateDropdown(elements.itemDropdown, [], 'Select Item');
  updateDropdown(elements.nameDropdown, [], 'Select Name');

  // Reset dropdown values explicitly
  elements.assignmentDropdown.value = '';
  elements.positionDropdown.value = '';
  elements.itemDropdown.value = '';
  elements.nameDropdown.value = '';

  console.log('Dropdowns reset successfully.');
}

// Generic dropdown update function
function updateDropdown(dropdown, options, defaultOptionText = 'Select') {
  dropdown.innerHTML = `<option value="">${defaultOptionText}</option>`;
  options.forEach((opt) => {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    dropdown.appendChild(option);
  });
  console.log(`Dropdown ${dropdown.id} updated with options:`, options);
}


// Modify your existing submitRatings function to include evaluator check
async function submitRatings() {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 1000;
  const LOCK_TIMEOUT = 30000;
  
  const token = gapi.client.getToken();
  if (!token) {
      showToast('error', 'Error', 'Please sign in to submit ratings');
      handleAuthClick();
      return;
  }

  if (!currentEvaluator) {
      showToast('warning', 'Warning', 'Please select an evaluator and enter the correct password');
      return;
  }

  const item = elements.itemDropdown.value;
  const candidateName = elements.nameDropdown.value;

  if (!item || !candidateName) {
      showToast('error', 'Error', 'Please select both item and candidate before submitting the ratings.');
      return;
  }

  // Check if there are existing ratings
  const existingRatings = await checkExistingRatings(item, candidateName, currentEvaluator);
  const isUpdate = existingRatings.length > 0;

  if (isUpdate) {
      // Store current selections before password verification
      const currentSelections = storeCurrentSelections();
      
      // Verify password before proceeding with update
      const isPasswordVerified = await verifyEvaluatorPassword();
      
      if (!isPasswordVerified) {
          // Revert to existing ratings if password verification was canceled or failed
          revertToExistingRatings(existingRatings);
          showToast('warning', 'Update Canceled', 'Ratings have been reverted to their previous state');
          return;
      }
  }

  const { ratings, error } = prepareRatingsData(item, candidateName, currentEvaluator);
  if (error) {
      showToast('error', 'Error', error);
      return;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
          const result = await submitRatingsWithLock(ratings);
          if (result.success) {
              showToast('success', 'Success', result.message);
              return;
          }
          
          if (attempt < MAX_RETRIES) {
              await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
              continue;
          }
          
          showToast('error', 'Error', 'Maximum retry attempts reached. Please try again later.');
          return;
      } catch (error) {
          console.error(`Attempt ${attempt} failed:`, error);
          if (attempt === MAX_RETRIES) {
              showToast('error', 'Error', 'Failed to submit ratings after multiple attempts');
              return;
          }
      }
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
      
      return existingData.filter(row => {
        console.log('Checking row:', row);
        console.log('Item-Initials:', row[0]);
        console.log('Evaluator in row:', row[5]);
        console.log('Current evaluator:', evaluator);
        return row[0].startsWith(`${item}-${candidateInitials}`) && 
               row[5] === evaluator;
      });
  } catch (error) {
      console.error('Error checking existing ratings:', error);
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
          
      selections.push({
          competencyName,
          rating: selectedRating
      });
  });
  
  return selections;
}

function revertToExistingRatings(existingRatings) {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  
  Array.from(competencyItems).forEach((item, index) => {
      const competencyName = item.querySelector('label').textContent.split('. ')[1];
      const existingRating = existingRatings.find(row => row[3] === competencyName);
      
      if (existingRating) {
          const ratingValue = existingRating[4];
          const radioButton = item.querySelector(`input[type="radio"][value="${ratingValue}"]`);
          if (radioButton) {
              radioButton.checked = true;
          }
      }
  });
}

async function verifyEvaluatorPassword() {
  // Create and show the password verification modal
  return new Promise((resolve) => {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = `
          <div class="modal-content">
              <h2>Password Verification Required</h2>
              <p>You are attempting to update existing ratings for ${currentEvaluator}. Please verify your password to continue.</p>
              <input type="password" id="verificationPassword" class="password-input" placeholder="Enter your password">
              <div class="modal-buttons">
                  <button id="cancelVerification" class="cancel-button">Cancel</button>
                  <button id="confirmVerification" class="confirm-button">Verify & Update</button>
              </div>
          </div>
      `;

      document.body.appendChild(modal);

      // Add modal styles if not already present
      if (!document.getElementById('modalStyles')) {
          const style = document.createElement('style');
          style.id = 'modalStyles';
          style.textContent = `
              .modal {
                  position: fixed;
                  top: 0;
                  left: 0;
                  width: 100%;
                  height: 100%;
                  background-color: rgba(0, 0, 0, 0.5);
                  display: flex;
                  justify-content: center;
                  align-items: center;
                  z-index: 1000;
              }
              .modal-content {
                  background-color: white;
                  padding: 20px;
                  border-radius: 5px;
                  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
                  max-width: 400px;
                  width: 90%;
              }
              .modal-content h2 {
                  margin-top: 0;
                  color: #333;
              }
              .modal-content p {
                  color: #666;
                  margin-bottom: 15px;
              }
              .password-input {
                  width: 100%;
                  padding: 8px;
                  margin: 10px 0;
                  border: 1px solid #ddd;
                  border-radius: 4px;
              }
              .modal-buttons {
                  display: flex;
                  justify-content: flex-end;
                  gap: 10px;
                  margin-top: 15px;
              }
              .cancel-button {
                  padding: 8px 15px;
                  background-color: #ddd;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
              }
              .cancel-button:hover {
                  background-color: #ccc;
              }
              .confirm-button {
                  padding: 8px 15px;
                  background-color:rgb(0, 0, 0);
                  color: white;
                  border: none;
                  border-radius: 4px;
                  cursor: pointer;
              }
              .confirm-button:hover {
                  background-color:rgb(255, 255, 255);
              }
              .password-input:focus {
                  outline: none;
                  border-color:rgb(0, 0, 0);
                  box-shadow: 0 0 5px rgba(46, 53, 46, 0.2);
              }
          `;
          document.head.appendChild(style);
      }

      const verificationPassword = document.getElementById('verificationPassword');
      const cancelBtn = document.getElementById('cancelVerification');
      const confirmBtn = document.getElementById('confirmVerification');

      cancelBtn.onclick = () => {
          document.body.removeChild(modal);
          resolve(false);
      };

      confirmBtn.onclick = () => {
          const password = verificationPassword.value;
          // Use the EVALUATOR_PASSWORDS constant for verification
          const isCorrect = password === EVALUATOR_PASSWORDS[currentEvaluator];
          
          if (isCorrect) {
              document.body.removeChild(modal);
              resolve(true);
          } else {
              showToast('error', 'Error', 'Incorrect password');
              verificationPassword.value = '';
              verificationPassword.focus();
          }
      };

      // Allow Enter key to submit
      verificationPassword.onkeyup = (e) => {
          if (e.key === 'Enter') {
              confirmBtn.click();
          }
      };

      // Focus the password input
      verificationPassword.focus();

      // Allow closing modal with Escape key
      document.addEventListener('keydown', function escapeHandler(e) {
          if (e.key === 'Escape') {
              document.removeEventListener('keydown', escapeHandler);
              cancelBtn.click();
          }
      });
  });
}

function prepareRatingsData(item, candidateName, currentEvaluator) {
  const competencyItems = elements.competencyContainer.getElementsByClassName('competency-item');
  const competencies = Array.from(competencyItems).map(item => item.querySelector('label').textContent.split('. ')[1]);
  const ratings = [];

  for (let i = 0; i < competencyItems.length; i++) {
      const competencyName = competencies[i];
      const rating = Array.from(competencyItems[i].querySelectorAll('input[type="radio"]'))
          .find(radio => radio.checked)?.value;

      if (!rating) {
          return { error: 'Please rate all competencies before submitting.' };
      }

      const competencyCode = getCompetencyCode(competencyName);
      const candidateInitials = getInitials(candidateName);
      const ratingCode = `${item}-${candidateInitials}-${competencyCode}-${currentEvaluator}`;
      ratings.push([ratingCode, item, candidateName, competencyName, rating, currentEvaluator]);
  }

  return { ratings };
}

async function submitRatingsWithLock(ratings) {
const lockRange = "RATELOG!G1:H1";

try {
    // Get current lock status
    const lockStatusResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: lockRange,
    });

    const lockData = lockStatusResponse.result.values?.[0] || ['', ''];
    const [lockStatus, lockTimestamp] = lockData;
    
    // Check if lock is stale
    if (lockStatus === 'locked') {
        const lockTime = new Date(lockTimestamp).getTime();
        const now = new Date().getTime();
        if (now - lockTime < LOCK_TIMEOUT) {
            return { success: false, message: 'Another submission is in progress' };
        }
    }

    // Acquire lock with timestamp
    const timestamp = new Date().toISOString();
    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: lockRange,
        valueInputOption: 'RAW',
        resource: {
            values: [['locked', timestamp]],
        },
    });

    // Double-check lock acquisition
    const verifyLockResponse = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: lockRange,
    });
    
    const verifyLockData = verifyLockResponse.result.values?.[0] || ['', ''];
    if (verifyLockData[0] !== 'locked' || verifyLockData[1] !== timestamp) {
        return { success: false, message: 'Failed to acquire lock' };
    }

    try {
        // Process ratings
        const result = await processRatings(ratings);
        return result;
    } finally {
        // Release lock
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: SHEET_ID,
            range: lockRange,
            valueInputOption: 'RAW',
            resource: {
                values: [['', '']], // Clear lock and timestamp
            },
        });
    }
} catch (error) {
    console.error('Error in submitRatingsWithLock:', error);
    throw error;
}
}

async function processRatings(ratings) {
// Get existing ratings
const response = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGES.RATELOG,
});

const existingData = response.result.values || [];
const updatedRatings = [];
const newRatings = [];
let isUpdated = false;

// Process each rating
ratings.forEach(newRating => {
    const existingRowIndex = existingData.findIndex(row => row[0] === newRating[0]);
    if (existingRowIndex !== -1) {
        existingData[existingRowIndex] = newRating;
        isUpdated = true;
    } else {
        newRatings.push(newRating);
    }
});

// Batch update operations
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

// Execute all updates
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



// Add this to your existing handleAuthClick callback
function onSignInSuccess() {
  elements.authStatus.textContent = 'Signed in';
  elements.signInBtn.style.display = 'none';
  elements.signOutBtn.style.display = 'block';
  createEvaluatorSelector(); // Add evaluator selector after successful sign-in
  loadSheetData();
}


// Event Listeners
elements.signInBtn.addEventListener('click', handleAuthClick);
elements.signOutBtn.addEventListener('click', handleSignOutClick);

// Load APIs
gapi.load();
gisLoaded();
