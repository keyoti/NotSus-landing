// Configure API URL: always use same origin so form posts to the backend you're actually viewing
const config = {
    apiUrl: (() => {
        return `${window.location.origin}/api/feedback`;
    })(),
    downloadUrls: {
        windows: 'https://download.notsus.net/NotSus_Browser_2.0.15.exe',
        mac: 'https://download.notsus.net/NotSus_Browser-2.0.15-arm64.dmg',
        macIntel: 'https://download.notsus.net/NotSus_Browser-2.0.15.dmg',
        linux: 'https://download.notsus.net/notsusbrowser_2.0.15_amd64.deb'
    }
};

// Debug logging to see what URL is being used
console.log('API URL configured as:', config.apiUrl);
console.log('Current location:', window.location.href);

// Function to handle waitlist form multi-step transitions
window.showWaitlistNextStep = (step) => {
    // If moving to step 2, validate email first
    if (step === 2) {
        const waitlistForm = document.getElementById('waitlistForm');
        if (waitlistForm) {
            const emailInput = waitlistForm.querySelector('input[name="email"]');
            const nameInput = waitlistForm.querySelector('input[name="name"]');
            
            // Check if email is filled and valid
            if (!emailInput || !emailInput.value.trim()) {
                // Show error message
                showWaitlistFormError('Please enter your email address to continue.');
                emailInput?.focus();
                return; // Stop here, don't proceed to next step
            }
            
            // Validate email format
            const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailPattern.test(emailInput.value.trim())) {
                showWaitlistFormError('Please enter a valid email address.');
                emailInput.focus();
                return; // Stop here, don't proceed to next step
            }
            
            // Check if name is filled (optional but good to have)
            if (!nameInput || !nameInput.value.trim()) {
                showWaitlistFormError('Please enter your name to continue.');
                nameInput?.focus();
                return;
            }
            
            // Clear any previous error messages
            clearWaitlistFormError();
        }
    }
    
    // If validation passed (or not step 2), proceed with showing the step
    document.querySelectorAll('[id^="waitlist-form-step-"]').forEach(el => el.style.display = 'none');
    document.getElementById(`waitlist-form-step-${step}`).style.display = 'block';
};

// Function to show waitlist form error message
function showWaitlistFormError(message) {
    // Remove any existing error message
    clearWaitlistFormError();
    
    // Create error message element
    const errorDiv = document.createElement('div');
    errorDiv.className = 'form-error-message';
    errorDiv.textContent = message;
    errorDiv.style.cssText = 'color: #ff6b6b; background-color: #ffe0e0; padding: 0.75rem 1rem; border-radius: 4px; margin-top: 1rem; border: 1px solid #ff6b6b;';
    
    // Find the waitlist form step 1 container
    const formStep1 = document.getElementById('waitlist-form-step-1');
    if (formStep1) {
        // Insert error message after the form inputs
        const formInputs = formStep1.querySelector('.form-inputs');
        if (formInputs) {
            formInputs.parentNode.insertBefore(errorDiv, formInputs.nextSibling);
        } else {
            formStep1.appendChild(errorDiv);
        }
    }
}

async function handleDownloadEmailSubmit(feedbackForm, submitButton) {
    const activeSubmitButton = submitButton || feedbackForm.querySelector('button[type="submit"]');
    if (!activeSubmitButton) {
        console.error('Submit button not found for download form.');
        return;
    }

    const formData = buildFormPayload(feedbackForm);
    const originalButtonText = activeSubmitButton.textContent;
    activeSubmitButton.textContent = 'Submitting...';
    activeSubmitButton.disabled = true;

    try {
        console.log('Submitting form data:', formData);

        const responseData = await submitFormData(formData);
        console.log('Form submission successful:', responseData);

        const formStep1 = document.getElementById('form-step-1');
        if (formStep1) {
            formStep1.style.display = 'none';
        }

        if (responseData.requireVerification || responseData.message === 'check_email') {
            const checkEmailSection = document.getElementById('check-email-section');
            const checkEmailAddress = document.getElementById('check-email-address');
            if (checkEmailSection && checkEmailAddress) {
                checkEmailAddress.textContent = formData.email;
                checkEmailSection.style.display = 'block';
            }
        } else {
            document.getElementById('download-section').style.display = 'block';
            setupDownloadTracking(formData.email, {});
        }
    } catch (err) {
        handleSubmitError(err, activeSubmitButton, originalButtonText);
    }
}

// ------------------------------
// Form submission helper methods
// ------------------------------

/**
 * Builds the normalized API payload from a form element.
 * @param {HTMLFormElement} formElement - Source form for payload fields.
 * @returns {{name: string, email: string, concerns: string[], gains: string[], otherDescription: string, gainsDescription: string, timestamp: string}}
 */
function buildFormPayload(formElement) {
    return {
        name: formElement.querySelector('input[name="name"]').value,
        email: formElement.querySelector('input[name="email"]').value,
        concerns: Array.from(formElement.querySelectorAll('input[name="concern"]:checked')).map(cb => cb.value),
        gains: Array.from(formElement.querySelectorAll('input[name="gains"]:checked')).map(cb => cb.value),
        otherDescription: formElement.querySelector('input[name="concernDescription"]').value,
        gainsDescription: formElement.querySelector('input[name="gainsDescription"]').value,
        timestamp: new Date().toISOString()
    };
}

/**
 * Submits form payload to the feedback API endpoint.
 * @param {object} formData - Payload returned by buildFormPayload.
 * @returns {Promise<object>} Parsed JSON response from API.
 */
async function submitFormData(formData) {
    const response = await fetch(config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Submission failed');
    }

    return response.json();
}

/**
 * Shows a temporary button error state after submission failure.
 * @param {Error} error - Submission error to log.
 * @param {HTMLButtonElement} submitButton - Button to update.
 * @param {string} originalButtonText - Button label to restore.
 */
function handleSubmitError(error, submitButton, originalButtonText) {
    console.error('Submission error:', error);
    submitButton.textContent = 'Error - Try Again';
    submitButton.disabled = false;
    setTimeout(() => {
        submitButton.textContent = originalButtonText;
    }, 2000);
}

/**
 * Handles waitlist form submission and success state transitions.
 * @param {HTMLFormElement} waitlistForm - Waitlist form element.
 * @param {HTMLButtonElement|undefined} submitButton - Optional event submitter.
 * @returns {Promise<void>}
 */
async function handleWaitlistSubmit(waitlistForm, submitButton) {
    const activeSubmitButton = submitButton || waitlistForm.querySelector('button[type="submit"]');
    if (!activeSubmitButton) {
        console.error('Submit button not found for waitlist form.');
        return;
    }

    const originalButtonText = activeSubmitButton.textContent;
    activeSubmitButton.textContent = 'Submitting...';
    activeSubmitButton.disabled = true;

    try {
        const formData = buildFormPayload(waitlistForm);
        console.log('Submitting waitlist form data:', formData);

        const responseData = await submitFormData(formData);
        console.log('Waitlist form submission successful:', responseData);

        document.getElementById('waitlist-form-step-3').style.display = 'none';
        document.getElementById('waitlist-thankyou-section').style.display = 'block';
    } catch (err) {
        handleSubmitError(err, activeSubmitButton, originalButtonText);
    }
}

// Function to clear waitlist form error message
function clearWaitlistFormError() {
    const waitlistForm = document.getElementById('waitlistForm');
    if (waitlistForm) {
        const existingError = waitlistForm.querySelector('.form-error-message');
        if (existingError) {
            existingError.remove();
        }
    }
}

// TinkerCad 3D Car Model
let tinkercadScene, tinkercadCamera, tinkercadRenderer, tinkercadCar;
let isInitialized = false;

function initTinkercadModel() {
    if (isInitialized) return;
    
    const canvas = document.getElementById('tinkercad-canvas');
    if (!canvas) return;

    // Check if we're in the visible tab
    const createTab = document.querySelector('.category-tab[data-category="create"]');
    const isCreateActive = createTab.classList.contains('active');
    
    // Create scene
    tinkercadScene = new THREE.Scene();
    tinkercadScene.background = new THREE.Color(0x2d2a2a); // bg-medium color
    
    // Create camera
    tinkercadCamera = new THREE.PerspectiveCamera(75, canvas.clientWidth / canvas.clientHeight, 0.1, 1000);
    tinkercadCamera.position.z = 5;
    
    // Create renderer
    tinkercadRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
    tinkercadRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
    tinkercadRenderer.setPixelRatio(window.devicePixelRatio);
    
    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    tinkercadScene.add(ambientLight);
    
    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 1, 1);
    tinkercadScene.add(directionalLight);
    
    // Create car body
    const carGroup = new THREE.Group();
    
    // Car body - main block
    const bodyGeometry = new THREE.BoxGeometry(2, 0.5, 1);
    const bodyMaterial = new THREE.MeshPhongMaterial({ color: 0x3f88c5 });
    const carBody = new THREE.Mesh(bodyGeometry, bodyMaterial);
    carGroup.add(carBody);
    
    // Car top - cabin
    const cabinGeometry = new THREE.BoxGeometry(1, 0.4, 0.8);
    const cabinMaterial = new THREE.MeshPhongMaterial({ color: 0x3f88c5 });
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.position.set(-0.1, 0.45, 0);
    carGroup.add(cabin);
    
    // Create wheels
    const wheelGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.1, 16);
    const wheelMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
    
    // Front left wheel
    const frontLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontLeftWheel.rotation.z = Math.PI / 2;
    frontLeftWheel.position.set(0.7, -0.25, 0.4);
    carGroup.add(frontLeftWheel);
    
    // Front right wheel
    const frontRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    frontRightWheel.rotation.z = Math.PI / 2;
    frontRightWheel.position.set(0.7, -0.25, -0.4);
    carGroup.add(frontRightWheel);
    
    // Rear left wheel
    const rearLeftWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rearLeftWheel.rotation.z = Math.PI / 2;
    rearLeftWheel.position.set(-0.7, -0.25, 0.4);
    carGroup.add(rearLeftWheel);
    
    // Rear right wheel
    const rearRightWheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    rearRightWheel.rotation.z = Math.PI / 2;
    rearRightWheel.position.set(-0.7, -0.25, -0.4);
    carGroup.add(rearRightWheel);
    
    // Add details - headlights
    const headlightGeometry = new THREE.BoxGeometry(0.1, 0.1, 0.2);
    const headlightMaterial = new THREE.MeshPhongMaterial({ color: 0xffff00, emissive: 0xffff00, emissiveIntensity: 0.5 });
    
    // Left headlight
    const leftHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    leftHeadlight.position.set(1.05, 0, 0.3);
    carGroup.add(leftHeadlight);
    
    // Right headlight
    const rightHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    rightHeadlight.position.set(1.05, 0, -0.3);
    carGroup.add(rightHeadlight);
    
    // Add the car to the scene
    tinkercadScene.add(carGroup);
    tinkercadCar = carGroup;
    
    // Animation loop
    function animate() {
        requestAnimationFrame(animate);
        
        // Only render when tab is visible
        const createCategory = document.getElementById('create-category');
        if (createCategory && createCategory.classList.contains('active')) {
            // Gentle rotation for idle animation
            if (!isDragging) {
                tinkercadCar.rotation.y += 0.005;
            }
            
            tinkercadRenderer.render(tinkercadScene, tinkercadCamera);
        }
    }
    
    // Mouse controls
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };
    
    const containerElement = document.getElementById('tinkercad-canvas-container');
    
    containerElement.addEventListener('mousedown', (e) => {
        isDragging = true;
    });
    
    containerElement.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaMove = {
                x: e.offsetX - previousMousePosition.x,
                y: e.offsetY - previousMousePosition.y
            };
            
            tinkercadCar.rotation.y += deltaMove.x * 0.01;
            tinkercadCar.rotation.x += deltaMove.y * 0.01;
        }
        
        previousMousePosition = {
            x: e.offsetX,
            y: e.offsetY
        };
    });
    
    containerElement.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    containerElement.addEventListener('mouseleave', () => {
        isDragging = false;
    });
    
    // Wheel scroll to zoom
    containerElement.addEventListener('wheel', (e) => {
        e.preventDefault();
        
        if (tinkercadCamera.position.z > 2 && e.deltaY > 0) {
            tinkercadCamera.position.z -= 0.2;  // Zoom in
        } else if (tinkercadCamera.position.z < 8 && e.deltaY < 0) {
            tinkercadCamera.position.z += 0.2;  // Zoom out
        }
    });
    
    // Handle window resize
    window.addEventListener('resize', () => {
        // Only update if renderer exists
        if (tinkercadRenderer) {
            tinkercadCamera.aspect = canvas.clientWidth / canvas.clientHeight;
            tinkercadCamera.updateProjectionMatrix();
            tinkercadRenderer.setSize(canvas.clientWidth, canvas.clientHeight);
        }
    });
    
    // Start animation loop
    animate();
    isInitialized = true;
}

// Set up form submission handlers
document.addEventListener('DOMContentLoaded', function() {
    // If user landed here after verifying email, show download section and set up token-based download links
    const urlParams = new URLSearchParams(window.location.search);
    const downloadToken = urlParams.get('download_token');
    if (downloadToken) {
        const downloadSection = document.getElementById('download-section');
        const feedbackForm = document.getElementById('feedbackForm');
        if (downloadSection && feedbackForm) {
            document.querySelectorAll('[id^="form-step-"]').forEach(el => { el.style.display = 'none'; });
            const checkEl = document.getElementById('check-email-section');
            if (checkEl) checkEl.style.display = 'none';
            downloadSection.style.display = 'block';
            setupDownloadTracking(downloadToken, { useToken: true });
            downloadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        if (window.history && window.history.replaceState) {
            urlParams.delete('download_token');
            const cleanSearch = urlParams.toString();
            const newUrl = cleanSearch ? `${window.location.pathname}?${cleanSearch}` : window.location.pathname;
            window.history.replaceState({}, '', newUrl);
        }
    }

    // Modal functionality
    const privacyModal = document.getElementById('privacyModal');
    const termsModal = document.getElementById('termsModal');
    const privacyModalBody = document.getElementById('privacyModalBody');
    const termsModalBody = document.getElementById('termsModalBody');
    const privacyPolicyLink = document.getElementById('privacyPolicyLink');
    const termsOfServiceLink = document.getElementById('termsOfServiceLink');
    const modalCloses = document.querySelectorAll('.modal-close');

    // Cache for loaded content
    let privacyContentLoaded = false;
    let termsContentLoaded = false;

    // Function to load content from external HTML file
    async function loadModalContent(url, targetElement, contentSelector) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to load ${url}: ${response.statusText}`);
            }
            const html = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const content = doc.querySelector(contentSelector);
            
            if (content) {
                targetElement.innerHTML = content.innerHTML;
                // Re-attach event listeners for links within the loaded content
                attachModalLinkListeners();
                return true;
            } else {
                throw new Error(`Content selector "${contentSelector}" not found in ${url}`);
            }
        } catch (error) {
            console.error('Error loading modal content:', error);
            targetElement.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <p>Error loading content. Please try again later.</p>
                    <p style="font-size: 0.9rem; margin-top: 1rem;">${error.message}</p>
                </div>
            `;
            return false;
        }
    }

    // Function to open modal and load content if needed
    async function openModal(modal, contentUrl, contentSelector, bodyElement, isLoaded) {
        // Load content if not already loaded
        if (!isLoaded && contentUrl && contentSelector && bodyElement) {
            bodyElement.innerHTML = '<div style="text-align: center; padding: 2rem;"><p>Loading...</p></div>';
            await loadModalContent(contentUrl, bodyElement, contentSelector);
            if (modal === privacyModal) {
                privacyContentLoaded = true;
            } else if (modal === termsModal) {
                termsContentLoaded = true;
            }
        }
        
        modal.classList.add('active');
        document.body.classList.add('modal-open');
        document.body.style.overflow = 'hidden';
    }

    // Function to close modal
    function closeModal(modal) {
        modal.classList.remove('active');
        document.body.classList.remove('modal-open');
        document.body.style.overflow = '';
    }

    // Function to attach event listeners to links within modal content
    function attachModalLinkListeners() {
        // Handle Privacy Policy link in Terms modal
        const privacyPolicyLinkInModal = document.getElementById('privacyPolicyLinkInModal');
        if (privacyPolicyLinkInModal) {
            privacyPolicyLinkInModal.addEventListener('click', function(e) {
                e.preventDefault();
                closeModal(termsModal);
                setTimeout(() => {
                    openModal(privacyModal, 'docs/PrivacyPolicy.html', '.privacy-content', privacyModalBody, privacyContentLoaded);
                }, 300);
            });
        }
    }

    // Open Privacy Policy modal
    if (privacyPolicyLink) {
        privacyPolicyLink.addEventListener('click', function(e) {
            e.preventDefault();
            openModal(privacyModal, 'docs/PrivacyPolicy.html', '.privacy-content', privacyModalBody, privacyContentLoaded);
        });
    }

    // Open Terms of Service modal
    if (termsOfServiceLink) {
        termsOfServiceLink.addEventListener('click', function(e) {
            e.preventDefault();
            openModal(termsModal, 'docs/TandC.html', '.terms-content', termsModalBody, termsContentLoaded);
        });
    }

    // Close modals when clicking the X button
    modalCloses.forEach(closeBtn => {
        closeBtn.addEventListener('click', function() {
            const modal = this.closest('.modal');
            if (modal) {
                closeModal(modal);
            }
        });
    });

    // Close modal when clicking outside the modal content
    [privacyModal, termsModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', function(e) {
                if (e.target === modal) {
                    closeModal(modal);
                }
            });
        }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (privacyModal && privacyModal.classList.contains('active')) {
                closeModal(privacyModal);
            }
            if (termsModal && termsModal.classList.contains('active')) {
                closeModal(termsModal);
            }
        }
    });

       const hamburgerBtn = document.getElementById('hamburgerBtn');
    const mobileNav = document.getElementById('mobileNav');
    const navLinks = document.querySelectorAll('.nav-link');
    
    // Create overlay element
    const overlay = document.createElement('div');
    overlay.className = 'nav-overlay';
    document.body.appendChild(overlay);

    // Toggle menu
    function toggleMenu() {
        hamburgerBtn.classList.toggle('active');
        mobileNav.classList.toggle('active');
        overlay.classList.toggle('active');
        
        // Prevent body scroll when menu is open
        if (mobileNav.classList.contains('active')) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
    }

    // Close menu
    function closeMenu() {
        hamburgerBtn.classList.remove('active');
        mobileNav.classList.remove('active');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
    }

    // Event listeners
    hamburgerBtn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', closeMenu);

    // Close menu when clicking a nav link
    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default anchor behavior
            
            const targetId = this.getAttribute('href');
            
            // Close the menu first
            closeMenu();
            

            // Smooth scroll to section with offset for fixed header
            if (targetId.startsWith('#')) {
                const targetSection = document.querySelector(targetId);
                if (targetSection) {
                    // Small delay to let menu close smoothly
                    setTimeout(() => {
                        const headerHeight = document.querySelector('header').offsetHeight;
                        const targetPosition = targetSection.getBoundingClientRect().top + window.pageYOffset;
                        const offsetPosition = targetPosition - headerHeight - 20; // 20px extra breathing room
                        
                        window.scrollTo({
                            top: offsetPosition,
                            behavior: 'smooth'
                        });
                    }, 300);
                }
            } else {
				location.href=targetId;
			}
        });
    });
    
    // Load Three.js library dynamically
    const threejsScript = document.createElement('script');
    threejsScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    threejsScript.onload = function() {
        console.log('Three.js loaded successfully');
        
        // Initialize the 3D model if we're on the create tab
        const createTab = document.querySelector('.category-tab[data-category="create"]');
        if (createTab && createTab.classList.contains('active')) {
            initTinkercadModel();
        }
    };
    document.head.appendChild(threejsScript);

    // Handle category tab toggling in tools section
    document.querySelectorAll('.category-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            // Remove active class from all tabs
            document.querySelectorAll('.category-tab').forEach(t => {
                t.classList.remove('active');
            });
            
            // Add active class to clicked tab
            this.classList.add('active');
            
            // Hide all categories
            document.querySelectorAll('.tools-category').forEach(cat => {
                cat.classList.remove('active');
            });
            
            // Show selected category
            const category = this.getAttribute('data-category');
            document.getElementById(`${category}-category`).classList.add('active');
            
            // Initialize 3D model when create tab is selected
            if (category === 'create') {
                setTimeout(initTinkercadModel, 100); // Slight delay to ensure DOM is updated
            }
        });
    });

    // Main feedback form submission
    const feedbackForm = document.getElementById('feedbackForm');
    if (feedbackForm) {
        feedbackForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitButton = e.submitter;
            await handleDownloadEmailSubmit(feedbackForm, submitButton);
        });
    }

    // Waitlist form submission
    const waitlistForm = document.getElementById('waitlistForm');
    if (waitlistForm) {
        waitlistForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const submitButton = e.submitter;
            await handleWaitlistSubmit(waitlistForm, submitButton);
        });
    }

    // Smooth scroll for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            
            // Skip if it's just "#" or if it's a nav-link (already handled above)
            if (targetId === '#' || this.classList.contains('nav-link')) {
                return;
            }
            
            e.preventDefault();
            const targetElement = document.querySelector(targetId);
            
            if (targetElement) {
                const headerHeight = document.querySelector('header').offsetHeight;
                const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset;
                const offsetPosition = targetPosition - headerHeight - 20;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
});

// Set up download buttons with token (verified users) or email (legacy). Token grants access to all platforms.
function setupDownloadTracking(emailOrToken, options) {
    const useToken = options && options.useToken === true;
    const downloadButtons = document.querySelectorAll('.download-button');

    downloadButtons.forEach(button => {
        let platform = 'mac';
        const href = button.getAttribute('href');
        if (href && href.includes('windows')) platform = 'windows';
        else if (href && href.includes('macIntel')) platform = 'macIntel';
        else if (href && href.includes('linux')) platform = 'linux';
        else if (href && href.includes('mac')) platform = 'mac';

        const downloadUrl = useToken
            ? `/download/${platform}?token=${encodeURIComponent(emailOrToken)}`
            : (config.downloadUrls[platform] || `/download/${platform}?email=${encodeURIComponent(emailOrToken)}`);
        button.setAttribute('href', downloadUrl);

        button.addEventListener('click', function(e) {
            if (useToken) {
                trackDownload(null, platform, 'click', emailOrToken);
            } else {
                trackDownload(emailOrToken, platform, 'click');
            }
        });
    });
}

// Function to track downloads (email or token for verified users)
async function trackDownload(email, platform, action, token) {
    try {
        const userAgent = navigator.userAgent;
        const browserInfo = {
            userAgent,
            browser: getBrowserInfo(),
            os: getOSInfo(),
            timestamp: new Date().toISOString()
        };

        const body = { platform, action, browserInfo };
        if (token) body.token = token;
        else if (email) body.email = email;

        await fetch('/api/track-download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        console.log(`Download ${action} tracked for ${platform}`);
    } catch (err) {
        console.error('Error tracking download:', err);
    }
}

// Helper function to get browser info
function getBrowserInfo() {
    const ua = navigator.userAgent;
    let browserName;
    let browserVersion;
    
    if (ua.indexOf("Chrome") > -1) {
        browserName = "Chrome";
        browserVersion = ua.match(/Chrome\/(\d+\.\d+)/)?.[1] || '';
    } else if (ua.indexOf("Safari") > -1) {
        browserName = "Safari";
        browserVersion = ua.match(/Version\/(\d+\.\d+)/)?.[1] || '';
    } else if (ua.indexOf("Firefox") > -1) {
        browserName = "Firefox";
        browserVersion = ua.match(/Firefox\/(\d+\.\d+)/)?.[1] || '';
    } else if (ua.indexOf("MSIE") > -1 || ua.indexOf("Trident") > -1) {
        browserName = "Internet Explorer";
        browserVersion = ua.match(/(?:MSIE |rv:)(\d+\.\d+)/)?.[1] || '';
    } else if (ua.indexOf("Edge") > -1) {
        browserName = "Edge";
        browserVersion = ua.match(/Edge\/(\d+\.\d+)/)?.[1] || '';
    } else {
        browserName = "Unknown";
        browserVersion = "Unknown";
    }
    
    return { name: browserName, version: browserVersion };
}

// Helper function to get OS info
function getOSInfo() {
    const ua = navigator.userAgent;
    let os;
    let version = "Unknown";
    
    if (ua.indexOf("Win") !== -1) {
        os = "Windows";
        if (ua.indexOf("Windows NT 10") !== -1) version = "10";
        else if (ua.indexOf("Windows NT 6.3") !== -1) version = "8.1";
        else if (ua.indexOf("Windows NT 6.2") !== -1) version = "8";
        else if (ua.indexOf("Windows NT 6.1") !== -1) version = "7";
    } else if (ua.indexOf("Mac") !== -1) {
        os = "macOS";
        const match = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
        if (match) version = match[1].replace(/_/g, '.');
    } else if (ua.indexOf("Linux") !== -1) {
        os = "Linux";
    } else if (ua.indexOf("Android") !== -1) {
        os = "Android";
        const match = ua.match(/Android (\d+\.\d+)/);
        if (match) version = match[1];
    } else if (ua.indexOf("like Mac") !== -1) {
        os = "iOS";
        const match = ua.match(/OS (\d+[._]\d+[._]?\d*)/);
        if (match) version = match[1].replace(/_/g, '.');
    } else {
        os = "Unknown";
    }
    
    return { name: os, version: version };
}
