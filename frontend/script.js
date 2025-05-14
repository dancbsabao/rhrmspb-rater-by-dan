const API_URL = 'https://rater-by-dan.onrender.com';
let gapiLoaded = false;
let accessToken = null;
let sessionId = null;
let isSignedIn = false;
let assignmentsData = [];
let positionsData = [];
let itemsData = [];
let namesData = [];
let candidatesData = [];
let competenciesData = [];
let ratingsData = [];
let config = {};
let currentUserEmail = '';
let passwordAttempts = {};
const MAX_ATTEMPTS = 3;
let isSecretariatAuthenticated = false;

function showToast(type, title, message, duration = 5000, position = 'top-right') {
  let toastContainer = document.querySelector('.toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = `toast-container ${position}`;
    document.body.appendChild(toastContainer);
  } else {
    toastContainer.className = `toast-container ${position}`;
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  let icon;
  switch (type) {
    case 'success': icon = '✓'; break;
    case 'error': icon = '✗'; break;
    case 'info': icon = 'ℹ'; break;
    case 'warning': icon = '⚠'; break;
    default: icon = '';
  }
  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <div class="toast-close" onclick="this.parentElement.remove()">×</div>
  `;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  setTimeout(() => {
    if (position === 'center') {
      toast.style.animation = 'fadeScaleOut 0.3s ease-out forwards';
    } else {
      toast.style.animation = 'slideOut 0.3s ease-out forwards';
    }
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function showModal(options) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title">${options.title || 'Modal'}</h2>
        <span class="modal-close">&times;</span>
      </div>
      <div class="modal-content">${options.content || ''}</div>
      <div:${options.input ? options.input : ''}</div>
      <div class="modal-actions">
        ${options.cancelText ? `<button class="modal-cancel">${options.cancelText}</button>` : ''}
        ${options.confirmText ? `<button class="modal-confirm">${options.confirmText}</button>` : ''}
      </div>
    </div>
  `;
  document.body.appendChild(modalOverlay);

  setTimeout(() => {
    modalOverlay.className = 'modal-overlay active';
  }, 10);

  const closeModal = () => {
    modalOverlay.className = 'modal-overlay';
    setTimeout(() => modalOverlay.remove(), 300);
  };

  modalOverlay.querySelector('.modal-close').addEventListener('click', closeModal);
  if (options.cancelText) {
    modalOverlay.querySelector('.modal-cancel').addEventListener('click', () => {
      closeModal();
      if (options.onCancel) options.onCancel();
    });
  }
  if (options.confirmText) {
    modalOverlay.querySelector('.modal-confirm').addEventListener('click', () => {
      closeModal();
      if (options.onConfirm) options.onConfirm(modalOverlay.querySelector('.modal-input')?.value);
    });
  }
}

function updateUI() {
  const authStatus = document.getElementById('authStatus');
  const signInBtn = document.getElementById('signInBtn');
  const signOutBtn = document.getElementById('signOutBtn');
  const ratingForm = document.querySelector('.rating-form');
  const secretariatForm = document.querySelector('.secretariat-form');

  if (isSignedIn) {
    authStatus.textContent = `Signed in as ${currentUserEmail}`;
    signInBtn.style.display = 'none';
    signOutBtn.style.display = 'block';
    ratingForm.style.display = 'block';
    if (isSecretariatAuthenticated) {
      secretariatForm.style.display = 'block';
    } else {
      secretariatForm.style.display = 'none';
    }
  } else {
    authStatus.textContent = 'Not signed in';
    signInBtn.style.display = 'block';
    signOutBtn.style.display = 'none';
    ratingForm.style.display = 'none';
    secretariatForm.style.display = 'none';
  }
}

async function fetchConfig() {
  try {
    const response = await fetch(`${API_URL}/config`, {
      credentials: 'include',
    });
    config = await response.json();
  } catch (error) {
    console.error('Error fetching config:', error);
    showToast('error', 'Error', 'Failed to load configuration');
  }
}

async function initGapi() {
  if (gapiLoaded) return;
  await new Promise((resolve) => {
    gapi.load('client', () => {
      gapi.client.init({
        apiKey: config.API_KEY,
        clientId: config.CLIENT_ID,
        scope: config.SCOPES,
      }).then(() => {
        gapiLoaded = true;
        resolve();
      });
    });
  });
}

async function getAccessToken() {
  const urlParams = new URLSearchParams(window.location.search);
  accessToken = urlParams.get('access_token');
  sessionId = urlParams.get('session_id');

  if (accessToken) {
    try {
      await initGapi();
      gapi.client.setToken({ access_token: accessToken });
      const userInfo = await gapi.client.request({
        path: 'https://www.googleapis.com/oauth2/v3/userinfo',
      });
      currentUserEmail = userInfo.result.email;
      isSignedIn = true;

      const evaluatorEmails = Object.keys(config.EVALUATOR_PASSWORDS);
      if (evaluatorEmails.includes(currentUserEmail)) {
        promptEvaluatorPassword();
      } else {
        updateUI();
        fetchAssignments();
      }
    } catch (error) {
      console.error('Error verifying access token:', error);
      isSignedIn = false;
      updateUI();
      showToast('error', 'Authentication Error', 'Failed to verify access token');
    }
  } else {
    isSignedIn = false;
    updateUI();
  }
}

function promptEvaluatorPassword() {
  showModal({
    title: 'Evaluator Password',
    content: `
      <p>Please enter your evaluator password for ${currentUserEmail}</p>
      <input type="password" class="modal-input" placeholder="Enter password">
    `,
    cancelText: 'Cancel',
    confirmText: 'Submit',
    onConfirm: (password) => {
      const correctPassword = config.EVALUATOR_PASSWORDS[currentUserEmail];
      if (!passwordAttempts[currentUserEmail]) {
        passwordAttempts[currentUserEmail] = 0;
      }

      if (password === correctPassword) {
        passwordAttempts[currentUserEmail] = 0;
        updateUI();
        fetchAssignments();
        showToast('success', 'Success', 'Password verified');
      } else {
        passwordAttempts[currentUserEmail]++;
        if (passwordAttempts[currentUserEmail] >= MAX_ATTEMPTS) {
          showToast('error', 'Error', 'Maximum password attempts reached');
          signOut();
        } else {
          showToast('error', 'Error', 'Incorrect password');
          promptEvaluatorPassword();
        }
      }
    },
    onCancel: () => {
      signOut();
    },
  });
}

function promptSecretariatPassword() {
  showModal({
    title: 'Secretariat Password',
    content: `
      <p>Please enter the secretariat password</p>
      <input type="password" class="modal-input" placeholder="Enter password">
    `,
    cancelText: 'Cancel',
    confirmText: 'Submit',
    onConfirm: (password) => {
      if (!passwordAttempts['secretariat']) {
        passwordAttempts['secretariat'] = 0;
      }

      if (password === config.SECRETARIAT_PASSWORD) {
        passwordAttempts['secretariat'] = 0;
        isSecretariatAuthenticated = true;
        updateUI();
        fetchSecretariatAssignments();
        showToast('success', 'Success', 'Secretariat access granted');
      } else {
        passwordAttempts['secretariat']++;
        if (passwordAttempts['secretariat'] >= MAX_ATTEMPTS) {
          showToast('error', 'Error', 'Maximum password attempts reached');
          switchTab('rater');
        } else {
          showToast('error', 'Error', 'Incorrect password');
          promptSecretariatPassword();
        }
      }
    },
    onCancel: () => {
      switchTab('rater');
    },
  });
}

function switchTab(tabId) {
  const tabs = document.querySelectorAll('.tab-button');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.tab === tabId) {
      tab.classList.add('active');
    }
  });

  contents.forEach(content => {
    content.classList.remove('active');
    if (content.id === tabId) {
      content.classList.add('active');
    }
  });

  if (tabId === 'secretariat' && isSignedIn && !isSecretariatAuthenticated) {
    promptSecretariatPassword();
  } else if (tabId === 'rater') {
    updateUI();
    fetchAssignments();
  }
}

async function refreshAccessToken() {
  try {
    const response = await fetch(`${API_URL}/refresh-token`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await response.json();
    if (data.access_token) {
      accessToken = data.access_token;
      gapi.client.setToken({ access_token: accessToken });
      return true;
    } else {
      throw new Error('No access token received');
    }
  } catch (error) {
    console.error('Error refreshing token:', error);
    showToast('error', 'Authentication Error', 'Session expired. Please sign in again.');
    signOut();
    return false;
  }
}

function signOut() {
  isSignedIn = false;
  isSecretariatAuthenticated = false;
  accessToken = null;
  sessionId = null;
  currentUserEmail = '';
  gapi.auth2.getAuthInstance().signOut();
  document.cookie = 'refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
  updateUI();
  window.location.href = window.location.pathname;
}

async function fetchGoogleSheetData(range) {
  try {
    await initGapi();
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: config.SHEET_ID,
      range: range,
    });
    return response.result.values || [];
  } catch (error) {
    if (error.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return await fetchGoogleSheetData(range);
      }
    }
    console.error(`Error fetching data from ${range}:`, error);
    showToast('error', 'Error', `Failed to fetch data from ${range}`);
    return [];
  }
}

async function updateGoogleSheetData(range, values) {
  try {
    await initGapi();
    const response = await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: config.SHEET_ID,
      range: range,
      valueInputOption: 'RAW',
      resource: { values: values },
    });
    return response.result;
  } catch (error) {
    if (error.status === 401) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        return await updateGoogleSheetData(range, values);
      }
    }
    console.error(`Error updating data in ${range}:`, error);
    showToast('error', 'Error', `Failed to update data in ${range}`);
    return null;
  }
}

async function fetchAssignments() {
  const data = await fetchGoogleSheetData(config.SHEET_RANGES.ASSIGNMENTS);
  assignmentsData = data.slice(1).map(row => ({
    Assignment: row[0] || '',
    Position: row[1] || '',
    Item: row[2] || '',
  }));
  populateDropdown('assignmentDropdown', assignmentsData.map(a => a.Assignment), 'Select Assignment');
}

async function fetchSecretariatAssignments() {
  const data = await fetchGoogleSheetData(config.SHEET_RANGES.SECRETARIAT);
  assignmentsData = data.slice(1).map(row => ({
    Assignment: row[0] || '',
    Position: row[1] || '',
    Item: row[2] || '',
  }));
  populateDropdown('secretariatAssignmentDropdown', assignmentsData.map(a => a.Assignment), 'Select Assignment');
}

function populateDropdown(elementId, items, placeholder) {
  const dropdown = document.getElementById(elementId);
  dropdown.innerHTML = `<option value="">${placeholder}</option>`;
  const uniqueItems = [...new Set(items.filter(item => item))];
  uniqueItems.forEach(item => {
    const option = document.createElement('option');
    option.value = item;
    option.textContent = item;
    dropdown.appendChild(option);
  });
}

function populateCandidatesTable(candidates, tableId) {
  const tableContainer = document.getElementById(tableId);
  tableContainer.innerHTML = '';

  if (candidates.length === 0) {
    tableContainer.innerHTML = '<p>No candidates available</p>';
    return;
  }

  const tilesContainer = document.createElement('div');
  tilesContainer.className = 'tiles-container';

  candidates.forEach(candidate => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = `
      <h4>${candidate.Name || 'No Name'}</h4>
      <div class="tile-content">
        <p><strong>Position:</strong> ${candidate.Position || 'N/A'}</p>
        <p><strong>Item:</strong> ${candidate.Item || 'N/A'}</p>
        ${candidate.FileLink ? `
          <button class="open-link-button" onclick="openDocument('${candidate.FileLink}')">
            View Document
          </button>
        ` : '<p class="no-data">No document available</p>'}
      </div>
    `;
    tilesContainer.appendChild(tile);
  });

  tableContainer.appendChild(tilesContainer);
}

function openDocument(url) {
  showModal({
    title: 'Document Viewer',
    content: `<iframe src="${url}" title="Document"></iframe>`,
    cancelText: 'Close',
    onCancel: () => {},
  });
  const modal = document.querySelector('.modal');
  const modalOverlay = document.querySelector('.modal-overlay');
  modal.classList.add('full-screen-modal');
  modalOverlay.classList.add('active');
}

async function fetchCompetencies(position, item) {
  const data = await fetchGoogleSheetData(config.SHEET_RANGES.COMPETENCIES);
  competenciesData = data.slice(1).map(row => ({
    Position: row[0] || '',
    Item: row[1] || '',
    Competency: row[2] || '',
    Type: row[3] || '',
    Description: row[4] || '',
  }));

  const filteredCompetencies = competenciesData.filter(c => c.Position === position && c.Item === item);
  const groupedCompetencies = {
    basic: filteredCompetencies.filter(c => c.Type.toLowerCase() === 'basic'),
    organizational: filteredCompetencies.filter(c => c.Type.toLowerCase() === 'organizational'),
    minimum: filteredCompetencies.filter(c => c.Type.toLowerCase() === 'minimum'),
  };

  const competencyContainer = document.getElementById('competencyContainer');
  competencyContainer.innerHTML = '';

  const createSection = (title, competencies) => {
    if (competencies.length === 0) return;
    const section = document.createElement('div');
    section.className = 'competency-section';
    section.innerHTML = `<h3 class="section-title">${title}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'competency-grid';
    competencies.forEach(comp => {
      const item = document.createElement('div');
      item.className = 'competency-item';
      item.innerHTML = `
        <h3>${comp.Competency}</h3>
        <p>${comp.Description}</p>
        <div class="rating-container" data-competency="${comp.Competency}">
          ${[1, 2, 3, 4, 5].map(score => `
            <input type="radio" name="${comp.Competency}" id="${comp.Competency}-${score}" value="${score}">
            <label for="${comp.Competency}-${score}">${score}</label>
          `).join('')}
        </div>
      `;
      grid.appendChild(item);
    });
    section.appendChild(grid);
    competencyContainer.appendChild(section);
  };

  createSection('Basic Competencies', groupedCompetencies.basic);
  createSection('Organizational Competencies', groupedCompetencies.organizational);
  createSection('Minimum Competencies', groupedCompetencies.minimum);

  document.getElementById('submitRatings').disabled = !filteredCompetencies.length;
}

async function fetchRatings(name, position, item) {
  const data = await fetchGoogleSheetData(config.SHEET_RANGES.RATINGS);
  ratingsData = data.slice(1).map(row => ({
    Evaluator: row[0] || '',
    Name: row[1] || '',
    Position: row[2] || '',
    Item: row[3] || '',
    Competency: row[4] || '',
    Rating: row[5] || '',
    Timestamp: row[6] || '',
  }));

  const existingRatings = ratingsData.filter(r => 
    r.Evaluator === currentUserEmail &&
    r.Name === name &&
    r.Position === position &&
    r.Item === item
  );

  if (existingRatings.length > 0) {
    showExistingRatings(existingRatings, name, position, item);
  }
}

function showExistingRatings(ratings, name, position, item) {
  const ratingsByCompetency = ratings.reduce((acc, r) => {
    acc[r.Competency] = r.Rating;
    return acc;
  }, {});

  const modalContent = `
    <p>Existing ratings found for ${name} (${position} - ${item}).</p>
    <div class="modal-section">
      <h4>Ratings</h4>
      ${Object.entries(ratingsByCompetency).map(([comp, rating]) => `
        <div class="modal-field">
          <span class="modal-label">${comp}</span>
          <span class="modal-value rating-value">${rating}</span>
        </div>
      `).join('')}
    </div>
  `;

  showModal({
    title: 'Existing Ratings',
    content: modalContent,
    cancelText: 'Close',
    confirmText: 'Update Ratings',
    onCancel: () => {},
    onConfirm: () => {
      document.querySelectorAll('.rating-container').forEach(container => {
        const competency = container.dataset.competency;
        const rating = ratingsByCompetency[competency];
        if (rating) {
          const radio = container.querySelector(`input[value="${rating}"]`);
          if (radio) radio.checked = true;
        }
      });
    },
  });
}

function populateNamesTable(names, position, item) {
  const tableContainer = document.getElementById('secretariat-names-table');
  tableContainer.innerHTML = '';

  if (names.length === 0) {
    tableContainer.innerHTML = '<p>No names available</p>';
    return;
  }

  const table = document.createElement('table');
  table.className = 'names-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Comment</th>
        <th>Action</th>
      </tr>
    </thead>
    <tbody>
      ${names.map((name, index) => `
        <tr>
          <td>${name}</td>
          <td><textarea placeholder="Enter comment" rows="2"></textarea></td>
          <td>
            <select data-index="${index}">
              <option value="">Select Action</option>
              <option value="disqualified">Disqualify</option>
              <option value="long_list">Long List</option>
            </select>
          </td>
        </tr>
      `).join('')}
    </tbody>
  `;

  tableContainer.appendChild(table);

  table.querySelectorAll('select').forEach(select => {
    select.addEventListener('change', () => {
      const row = select.closest('tr');
      row.classList.toggle('selected', select.value !== '');
      updateSubmitSecretariatButton();
    });
  });

  table.querySelectorAll('textarea').forEach(textarea => {
    textarea.addEventListener('input', updateSubmitSecretariatButton);
  });
}

function updateSubmitSecretariatButton() {
  const table = document.querySelector('#secretariat-names-table .names-table');
  if (!table) {
    document.getElementById('submitSecretariat').disabled = true;
    return;
  }

  const hasSelection = Array.from(table.querySelectorAll('select')).some(select => select.value !== '');
  document.getElementById('submitSecretariat').disabled = !hasSelection;
}

async function submitSecretariatSelections() {
  const assignment = document.getElementById('secretariatAssignmentDropdown').value;
  const position = document.getElementById('secretariatPositionDropdown').value;
  const item = document.getElementById('secretariatItemDropdown').value;

  const table = document.querySelector('#secretariat-names-table .names-table');
  const selections = Array.from(table.querySelectorAll('tr')).map(row => {
    const name = row.cells[0].textContent;
    const comment = row.querySelector('textarea').value;
    const action = row.querySelector('select').value;
    return { name, comment, action };
  }).filter(sel => sel.action);

  if (selections.length === 0) {
    showToast('warning', 'Warning', 'No actions selected');
    return;
  }

  const disqualified = selections.filter(s => s.action === 'disqualified').map(s => ({
    Name: s.name,
    Comment: s.comment,
    Status: 'Disqualified',
    Timestamp: new Date().toISOString(),
  }));

  const longList = selections.filter(s => s.action === 'long_list').map(s => ({
    Name: s.name,
    Comment: s.comment,
    Status: 'Long List',
    Timestamp: new Date().toISOString(),
  }));

  const showSubmittingIndicator = () => {
    const indicator = document.createElement('div');
    indicator.className = 'submitting-indicator';
    indicator.innerHTML = `
      <div class="submitting-content">
        <div class="spinner"></div>
        <span>Submitting...</span>
      </div>
    `;
    document.body.appendChild(indicator);
    return () => document.body.removeChild(indicator);
  };

  const hideIndicator = showSubmittingIndicator();

  try {
    const values = [...disqualified, ...longList].map(s => [
      assignment,
      position,
      item,
      s.Name,
      s.Status,
      s.Comment,
      s.Timestamp,
    ]);

    const result = await updateGoogleSheetData(config.SHEET_RANGES.SECRETARIAT, [values[0], ...values]);
    if (result) {
      showToast('success', 'Success', 'Selections submitted successfully');
      document.getElementById('secretariat-names-table').innerHTML = '';
      document.getElementById('submitSecretariat').disabled = true;
      fetchSecretariatAssignments();
    }
  } catch (error) {
    console.error('Error submitting selections:', error);
    showToast('error', 'Error', 'Failed to submit selections');
  } finally {
    hideIndicator();
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await fetchConfig();
  await getAccessToken();

  document.getElementById('signInBtn').addEventListener('click', () => {
    window.location.href = `${API_URL}/auth/google`;
  });

  document.getElementById('signOutBtn').addEventListener('click', signOut);

  document.getElementById('assignmentDropdown').addEventListener('change', async (e) => {
    const assignment = e.target.value;
    positionsData = assignmentsData.filter(a => a.Assignment === assignment);
    populateDropdown('positionDropdown', positionsData.map(p => p.Position), 'Select Position');
    document.getElementById('positionDropdown').disabled = !positionsData.length;
    document.getElementById('itemDropdown').innerHTML = '<option value="">Select Item</option>';
    document.getElementById('itemDropdown').disabled = true;
    document.getElementById('nameDropdown').innerHTML = '<option value="">Select Name</option>';
    document.getElementById('nameDropdown').disabled = true;
    document.getElementById('candidates-table').innerHTML = '';
    document.getElementById('competencyContainer').innerHTML = '';
    document.getElementById('submitRatings').disabled = true;
  });

  document.getElementById('positionDropdown').addEventListener('change', async (e) => {
    const position = e.target.value;
    itemsData = positionsData.filter(p => p.Position === position);
    populateDropdown('itemDropdown', itemsData.map(i => i.Item), 'Select Item');
    document.getElementById('itemDropdown').disabled = !itemsData.length;
    document.getElementById('nameDropdown').innerHTML = '<option value="">Select Name</option>';
    document.getElementById('nameDropdown').disabled = true;
    document.getElementById('candidates-table').innerHTML = '';
    document.getElementById('competencyContainer').innerHTML = '';
    document.getElementById('submitRatings').disabled = true;

    if (position) {
      const data = await fetchGoogleSheetData(config.SHEET_RANGES.CANDIDATES);
      candidatesData = data.slice(1).map(row => ({
        Assignment: row[0] || '',
        Position: row[1] || '',
        Item: row[2] || '',
        Name: row[3] || '',
        FileLink: row[4] || '',
      }));
      const filteredCandidates = candidatesData.filter(c => c.Position === position);
      populateCandidatesTable(filteredCandidates, 'candidates-table');
    }
  });

  document.getElementById('itemDropdown').addEventListener('change', async (e) => {
    const item = e.target.value;
    const position = document.getElementById('positionDropdown').value;
    const data = await fetchGoogleSheetData(config.SHEET_RANGES.CANDIDATES);
    candidatesData = data.slice(1).map(row => ({
      Assignment: row[0] || '',
      Position: row[1] || '',
      Item: row[2] || '',
      Name: row[3] || '',
      FileLink: row[4] || '',
    }));
    namesData = candidatesData
      .filter(c => c.Position === position && c.Item === item)
      .map(c => c.Name);
    populateDropdown('nameDropdown', namesData, 'Select Name');
    document.getElementById('nameDropdown').disabled = !namesData.length;
    document.getElementById('competencyContainer').innerHTML = '';
    document.getElementById('submitRatings').disabled = true;

    const filteredCandidates = candidatesData.filter(c => c.Position === position && c.Item === item);
    populateCandidatesTable(filteredCandidates, 'candidates-table');

    if (item) {
      await fetchCompetencies(position, item);
    }
  });

  document.getElementById('nameDropdown').addEventListener('change', async (e) => {
    const name = e.target.value;
    const position = document.getElementById('positionDropdown').value;
    const item = document.getElementById('itemDropdown').value;
    if (name && position && item) {
      await fetchRatings(name, position, item);
    }
  });

  document.getElementById('submitRatings').addEventListener('click', async () => {
    const assignment = document.getElementById('assignmentDropdown').value;
    const position = document.getElementById('positionDropdown').value;
    const item = document.getElementById('itemDropdown').value;
    const name = document.getElementById('nameDropdown').value;

    const ratings = [];
    document.querySelectorAll('.rating-container').forEach(container => {
      const competency = container.dataset.competency;
      const selectedRating = container.querySelector('input:checked');
      if (selectedRating) {
        ratings.push({
          Evaluator: currentUserEmail,
          Name: name,
          Position: position,
          Item: item,
          Competency: competency,
          Rating: selectedRating.value,
          Timestamp: new Date().toISOString(),
        });
      }
    });

    if (ratings.length === 0) {
      showToast('warning', 'Warning', 'Please provide ratings for at least one competency');
      return;
    }

    const showSubmittingIndicator = () => {
      const indicator = document.createElement('div');
      indicator.className = 'submitting-indicator';
      indicator.innerHTML = `
        <div class="submitting-content">
          <div class="spinner"></div>
          <span>Submitting...</span>
        </div>
      `;
      document.body.appendChild(indicator);
      return () => document.body.removeChild(indicator);
    };

    const hideIndicator = showSubmittingIndicator();

    try {
      const values = ratings.map(r => [
        r.Evaluator,
        r.Name,
        r.Position,
        r.Item,
        r.Competency,
        r.Rating,
        r.Timestamp,
      ]);

      const result = await updateGoogleSheetData(config.SHEET_RANGES.RATINGS, [values[0], ...values]);
      if (result) {
        showToast('success', 'Success', 'Ratings submitted successfully');
        document.querySelectorAll('.rating-container input').forEach(input => input.checked = false);
        document.getElementById('submitRatings').disabled = true;
      }
    } catch (error) {
      console.error('Error submitting ratings:', error);
      showToast('error', 'Error', 'Failed to submit ratings');
    } finally {
      hideIndicator();
    }
  });

  document.getElementById('secretariatAssignmentDropdown').addEventListener('change', async (e) => {
    const assignment = e.target.value;
    positionsData = assignmentsData.filter(a => a.Assignment === assignment);
    populateDropdown('secretariatPositionDropdown', positionsData.map(p => p.Position), 'Select Position');
    document.getElementById('secretariatPositionDropdown').disabled = !positionsData.length;
    document.getElementById('secretariatItemDropdown').innerHTML = '<option value="">Select Item</option>';
    document.getElementById('secretariatItemDropdown').disabled = true;
    document.getElementById('secretariat-candidates-table').innerHTML = '';
    document.getElementById('secretariat-names-table').innerHTML = '';
    document.getElementById('submitSecretariat').disabled = true;
  });

  document.getElementById('secretariatPositionDropdown').addEventListener('change', async (e) => {
    const position = e.target.value;
    itemsData = positionsData.filter(p => p.Position === position);
    populateDropdown('secretariatItemDropdown', itemsData.map(i => i.Item), 'Select Item');
    document.getElementById('secretariatItemDropdown').disabled = !itemsData.length;
    document.getElementById('secretariat-candidates-table').innerHTML = '';
    document.getElementById('secretariat-names-table').innerHTML = '';
    document.getElementById('submitSecretariat').disabled = true;

    if (position) {
      const data = await fetchGoogleSheetData(config.SHEET_RANGES.CANDIDATES);
      candidatesData = data.slice(1).map(row => ({
        Assignment: row[0] || '',
        Position: row[1] || '',
        Item: row[2] || '',
        Name: row[3] || '',
        FileLink: row[4] || '',
      }));
      const filteredCandidates = candidatesData.filter(c => c.Position === position);
      populateCandidatesTable(filteredCandidates, 'secretariat-candidates-table');
    }
  });

  document.getElementById('secretariatItemDropdown').addEventListener('change', async (e) => {
    const item = e.target.value;
    const position = document.getElementById('secretariatPositionDropdown').value;
    const data = await fetchGoogleSheetData(config.SHEET_RANGES.CANDIDATES);
    candidatesData = data.slice(1).map(row => ({
      Assignment: row[0] || '',
      Position: row[1] || '',
      Item: row[2] || '',
      Name: row[3] || '',
      FileLink: row[4] || '',
    }));
    namesData = candidatesData
      .filter(c => c.Position === position && c.Item === item)
      .map(c => c.Name);
    populateNamesTable(namesData, position, item);
    document.getElementById('submitSecretariat').disabled = true;

    const filteredCandidates = candidatesData.filter(c => c.Position === position && c.Item === item);
    populateCandidatesTable(filteredCandidates, 'secretariat-candidates-table');
  });

  document.getElementById('submitSecretariat').addEventListener('click', submitSecretariatSelections);

  document.querySelectorAll('.tab-button').forEach(button => {
    button.addEventListener('click', () => {
      switchTab(button.dataset.tab);
    });
  });
});
