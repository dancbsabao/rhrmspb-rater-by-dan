// Add new form elements
const employeeSelect = document.getElementById('employee-select');
const tinInput = document.getElementById('tin-input');
const photoFolderBtn = document.getElementById('photo-folder-btn');

// Google Sheets Configuration - Will be loaded dynamically
let GOOGLE_SHEETS_CONFIG = {
    apiKey: null,
    spreadsheetId: null,
    range: null
};

// Fetch secure configuration from backend
async function loadConfig() {
    try {
        const response = await fetch('https://arta-generator-by-dan.onrender.com');
        if (!response.ok) {
            throw new Error('Failed to load configuration');
        }
        GOOGLE_SHEETS_CONFIG = await response.json();
        console.log('Configuration loaded successfully');
        
        // Initialize GAPI after we have the configuration
        initializeGAPI();
    } catch (error) {
        console.error('Error loading configuration:', error);
        alert('Failed to load application configuration. Please refresh the page or contact support.');
    }
}

// Initialize Google API client
function initializeGAPI() {
    gapi.load('client', async () => {
        try {
            await gapi.client.init({
                apiKey: GOOGLE_SHEETS_CONFIG.apiKey,
                discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            });
            
            // Now that GAPI is initialized, we can fetch employee data
            initializeForm();
        } catch (error) {
            console.error('Error initializing GAPI client:', error);
            alert('Error connecting to Google services. Please refresh and try again.');
        }
    });
}

document.getElementById('photo-folder-btn').addEventListener('click', () => {
    window.open('https://drive.google.com/drive/folders/1DJzqBJKDaARcOU9hvPtKMXwpEmBWb-La?usp=sharing', '_blank');
});


// Form elements
const form = document.getElementById('id-form');
const photoInput = document.getElementById('upload-photo');
const photoImg = document.getElementById('photo');
const photoPlaceholder = document.getElementById('photo-placeholder');
const generateBtn = document.getElementById('generate-btn');
const downloadBtn = document.getElementById('download-btn');

// Text elements
const firstNameInput = document.getElementById('first-name-input');
const middleInitialInput = document.getElementById('middle-initial-input');
const lastNameInput = document.getElementById('last-name-input');
const positionInput = document.getElementById('position-input');
const assignmentInput = document.getElementById('assignment-input');

// Display elements
const firstNameText = document.getElementById('first-name-text');
const lastNameText = document.getElementById('last-name-text');
const positionText = document.getElementById('position-text');
const assignmentText = document.getElementById('assignment-text');

// Error elements
const photoError = document.getElementById('photo-error');
const firstNameError = document.getElementById('first-name-error');
const middleInitialError = document.getElementById('middle-initial-error');
const lastNameError = document.getElementById('last-name-error');
const positionError = document.getElementById('position-error');
const assignmentError = document.getElementById('assignment-error');

const modal = document.getElementById('cropperModal');
const cropperImage = document.getElementById('cropperImage');
const cropButton = document.getElementById('cropButton');
const closeButton = document.querySelector('.close');
let cropper = null;


// Form state
let formState = {
    photo: null,
    firstName: '',
    middleInitial: '',
    lastName: '',
    position: '',
    assignment: ''
};


// Input validation and real-time preview
const validateInput = (input, errorElement, fieldName) => {
    const value = input.value.trim();
    let error = '';

    if (!value && fieldName !== 'middleInitial') {
        error = `${fieldName} is required`;
    } else if (fieldName === 'middleInitial' && value.length > 1) {
        error = 'Middle initial should be a single character';
    }

    errorElement.textContent = error;
    return !error;
};

// Photo upload handling
photoInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        if (!file.type.startsWith('image/')) {
            photoError.textContent = 'Please upload an image file';
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            // Instead of directly setting the photo, show the cropper
            cropperImage.src = event.target.result;
            modal.style.display = 'block';
            
            // Initialize cropper
            if (cropper) {
                cropper.destroy();
            }
            cropper = new Cropper(cropperImage, {
                aspectRatio: 3 / 4, // Match the ID photo dimensions
                viewMode: 1,
                dragMode: 'move',
                autoCropArea: 1,
                restore: false,
                guides: true,
                center: true,
                highlight: false,
                cropBoxMovable: false,
                cropBoxResizable: false,
                toggleDragModeOnDblclick: false,
            });
        };
        reader.readAsDataURL(file);
    }
});

// Handle cropping
cropButton.addEventListener('click', () => {
    if (cropper) {
        const croppedCanvas = cropper.getCroppedCanvas();
        const croppedImage = croppedCanvas.toDataURL('image/jpeg');
        
        // Update the ID photo
        photoImg.src = croppedImage;
        photoImg.style.display = 'block';
        formState.photo = croppedImage;
        photoError.textContent = '';
        
        // Hide the placeholder overlay
        const overlay = photoPlaceholder.querySelector('.photo-overlay');
        if (overlay) {
            overlay.style.opacity = '0';
        }
        
        // Close the modal
        modal.style.display = 'none';
        cropper.destroy();
        cropper = null;
    }
});

// Close modal handlers
closeButton.addEventListener('click', () => {
    modal.style.display = 'none';
    if (cropper) {
        cropper.destroy();
        cropper = null;
    }
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
        if (cropper) {
            cropper.destroy();
            cropper = null;
        }
    }
});

// Real-time input handling and preview updates
firstNameInput.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    formState.firstName = value;
    firstNameText.textContent = value || 'FIRST NAME';
    validateInput(firstNameInput, firstNameError, 'First name');
});

middleInitialInput.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    formState.middleInitial = value;
    updateLastNameDisplay();
    validateInput(middleInitialInput, middleInitialError, 'Middle initial');
});

lastNameInput.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    formState.lastName = value;
    updateLastNameDisplay();
    validateInput(lastNameInput, lastNameError, 'Last name');
});

positionInput.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    formState.position = value;
    positionText.textContent = value || 'POSITION';
    validateInput(positionInput, positionError, 'Position');
});

assignmentInput.addEventListener('input', (e) => {
    const value = e.target.value.trim().toUpperCase();
    formState.assignment = value;
    assignmentText.textContent = value || 'ASSIGNMENT';
    validateInput(assignmentInput, assignmentError, 'Assignment');
});

// Helper function to update last name display
function updateLastNameDisplay() {
    const middleInitial = formState.middleInitial ? formState.middleInitial : 'M.';
    const lastName = formState.lastName || 'LASTNAME';
    lastNameText.textContent = `${middleInitial} ${lastName}`;
}

// Form validation
const validateForm = () => {
    const validations = [
        validateInput(firstNameInput, firstNameError, 'First name'),
        validateInput(lastNameInput, lastNameError, 'Last name'),
        validateInput(positionInput, positionError, 'Position'),
        validateInput(assignmentInput, assignmentError, 'Assignment')
    ];

    if (!formState.photo) {
        photoError.textContent = 'Photo is required';
        validations.push(false);
    }

    return validations.every(valid => valid);
};

// Download ID Card as A5 PDF
downloadBtn.addEventListener('click', async () => {
    try {
        // Check if jsPDF is available
        if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
            console.error('jsPDF is not loaded properly. Make sure the script is included before this code runs.');
            alert('PDF generation library is not available. Please refresh the page and try again.');
            return;
        }
        
        const { jsPDF } = window.jspdf;

        // Validate Form Fields
        const selectedEmployee = JSON.parse(employeeSelect.value || '{}');
        const tinValue = tinInput.value.trim();
        
        if (!tinValue) {
            document.getElementById('tin-error').textContent = 'TIN NUMBER IS REQUIRED';
            document.getElementById('tin-error').style.color = 'red';
            return;
        }

        if (tinValue !== selectedEmployee.tin) {
            document.getElementById('tin-error').textContent = 'INVALID TIN NUMBER';
            document.getElementById('tin-error').style.color = 'red';
            return;
        }

        if (!validateForm()) {
            console.error("Form validation failed.");
            alert("Please fill in all required fields.");
            return;
        }

        const idCard = document.getElementById('id-card');

        // Convert ID card to image
        const canvas = await html2canvas(idCard, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#FFFFFF',  // Force white background
            logging: false
        });

        const imgData = canvas.toDataURL('image/jpeg', 1.0);

        // Create A5 PDF (Landscape)
        const pdf = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: 'a5'
        });

        // Set Image Dimensions
        const imgWidth = 90;
        const imgHeight = 125;
        const margin = 10;

        // Add Two IDs Side by Side
        pdf.addImage(imgData, 'JPEG', margin, 10, imgWidth, imgHeight);
        pdf.addImage(imgData, 'JPEG', margin + imgWidth + 10, 10, imgWidth, imgHeight);

        // Save PDF
        pdf.save(`${selectedEmployee.firstName}-${selectedEmployee.lastName}-ID.pdf`);
        
    } catch (error) {
        console.error('Error generating ID card:', error);
        alert('Error generating ID card. Please check console.');
    }
});


// Modified function to fetch employee data from Google Sheets via backend
async function fetchEmployeeData() {
    try {
        // Check if GAPI is initialized and config is loaded
        if (!GOOGLE_SHEETS_CONFIG.apiKey) {
            throw new Error('Google Sheets configuration not loaded');
        }

        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: GOOGLE_SHEETS_CONFIG.spreadsheetId,
            range: GOOGLE_SHEETS_CONFIG.range,
        });

        const rows = response.result.values;
        if (rows.length) {
            // Convert rows to employee objects (skip header row)
            return rows.slice(1).map(row => ({
                lastName: row[0],
                firstName: row[1],
                middleInitial: row[2],
                position: row[3],
                assignment: row[4],
                tin: row[5],
                fullName: `${row[0]}, ${row[1]} ${row[2]}`
            }));
        }
        return [];
    } catch (error) {
        console.error('Error fetching data:', error);
        throw error;
    }
}

// Handle employee selection
employeeSelect.addEventListener('change', (e) => {
    if (e.target.value) {
        const employee = JSON.parse(e.target.value);
        
        // Update form fields
        firstNameInput.value = employee.firstName;
        middleInitialInput.value = employee.middleInitial;
        lastNameInput.value = employee.lastName;
        positionInput.value = employee.position;
        assignmentInput.value = employee.assignment;
        
        // Trigger input events to update preview
        firstNameInput.dispatchEvent(new Event('input'));
        middleInitialInput.dispatchEvent(new Event('input'));
        lastNameInput.dispatchEvent(new Event('input'));
        positionInput.dispatchEvent(new Event('input'));
        assignmentInput.dispatchEvent(new Event('input'));
        
        // Clear TIN input and error
        tinInput.value = '';
        document.getElementById('tin-error').textContent = '';
    }
});

// Initialize the form
async function initializeForm() {
    try {
        // Fetch employee data
        const employees = await fetchEmployeeData();
        const employeeSelect = $("#employee-select");

        // Clear existing options
        employeeSelect.empty().append('<option value="">Select an employee...</option>');

        // Add employees to dropdown
        employees.forEach(emp => {
            const option = new Option(emp.fullName, JSON.stringify(emp), false, false);
            employeeSelect.append(option);
        });

        $(document).ready(function() {
            $('#employee-select').select2({
                placeholder: "Who are you?",
                allowClear: true,
                minimumResultsForSearch: 0, // Always show search bar
                language: {
                    searching: function() {
                        return ""; // Prevents extra text while typing
                    }
                }
            });
        
            // Ensure search field gets proper placeholder
            $(document).on('select2:open', function() {
                setTimeout(() => {
                    $('.select2-search__field').attr('placeholder', 'Search employee...');
                }, 50);
            });
        });
        

        // Handle employee selection
        employeeSelect.on("change", function () {
            if (this.value) {
                const selectedEmployee = JSON.parse(this.value);
                updateFormFields(selectedEmployee);
            }
        });

        function updateFormFields(employee) {
            firstNameInput.value = employee.firstName;
            middleInitialInput.value = employee.middleInitial;
            lastNameInput.value = employee.lastName;
            positionInput.value = employee.position;
            assignmentInput.value = employee.assignment;

            // Trigger input events to update preview
            [firstNameInput, middleInitialInput, lastNameInput, positionInput, assignmentInput].forEach(input => {
                input.dispatchEvent(new Event("input"));
            });

            // Reset TIN input
            tinInput.value = "";
            document.getElementById("tin-error").textContent = "";
        }

    } catch (error) {
        console.error("Error initializing form:", error);
        alert("Error loading employee data. Please refresh the page.");
    }
}


document.addEventListener("DOMContentLoaded", function () {
    const firstNameInput = document.getElementById("first-name-input");
    const firstNameElement = document.getElementById("first-name-text");

    function formatFirstName() {
        let nameText = firstNameInput.value.trim().toUpperCase(); // Get user input
        let words = nameText.split(/\s+/); // Split words by spaces

        if (words.length === 2) {
            firstNameElement.innerHTML = words.join("<br>"); // 2 words → 2 lines
        } else if (words.length === 3) {
            firstNameElement.innerHTML = words.join("<br>"); // 3 words → 3 lines
        } else if (words.length === 4) {
            firstNameElement.innerHTML = words.slice(0, 2).join(" ") + "<br>" + words.slice(2).join(" "); // 4 words → 2 lines (2 words each)
        } else {
            firstNameElement.textContent = nameText; // Default single-line name
        }
    }

    // Run function when the user types in the input field
    firstNameInput.addEventListener("input", formatFirstName);
    
    // Load secure configuration first
    loadConfig();
});


// Photo folder button click handler (preserved from original)
photoFolderBtn.addEventListener('click', () => {
    window.open('https://drive.google.com/drive/folders/1DJzqBJKDaARcOU9hvPtKMXwpEmBWb-La?usp=sharing', '_blank');
});
