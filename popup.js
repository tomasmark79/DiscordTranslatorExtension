/**
 * Discord Message Translator - Popup Script
 * Author: Tomáš Mark
 * 
 * Controls translator activation and displays status
 */

const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const toggleBtn = document.getElementById('toggleBtn');
const btnIcon = document.getElementById('btnIcon');
const btnText = document.getElementById('btnText');
const stats = document.getElementById('stats');
const translatedCount = document.getElementById('translatedCount');
const cachedCount = document.getElementById('cachedCount');

let isActive = false;

/**
 * Update UI based on translator state
 */
function updateUI(state) {
  isActive = state.isActive;

  // Update status indicator
  if (isActive) {
    statusIndicator.classList.add('active');
    statusText.textContent = 'Překladač běží';
    toggleBtn.classList.add('active');
    btnIcon.textContent = '⏸️';
    btnText.textContent = 'Zastavit překladač';
    stats.style.display = 'grid';
  } else {
    statusIndicator.classList.remove('active');
    statusText.textContent = 'Překladač vypnut';
    toggleBtn.classList.remove('active');
    btnIcon.textContent = '▶️';
    btnText.textContent = 'Spustit překladač';
    stats.style.display = 'none';
  }

  // Update stats if available
  if (state.stats) {
    translatedCount.textContent = state.stats.translated || 0;
    cachedCount.textContent = state.stats.cached || 0;
  }
}

/**
 * Get current state from background
 */
async function getState() {
  try {
    const response = await chrome.runtime.sendMessage(JSON.stringify({
      type: 'getState',
      args: []
    }));

    const state = JSON.parse(response);
    updateUI(state);
  } catch (error) {
    console.error('Error getting state:', error);
    statusText.textContent = 'Chyba při načítání stavu';
  }
}

/**
 * Toggle translator on/off
 */
async function toggleTranslator() {
  try {
    toggleBtn.disabled = true;

    const response = await chrome.runtime.sendMessage(JSON.stringify({
      type: 'toggleTranslator',
      args: []
    }));

    const state = JSON.parse(response);
    updateUI(state);

  } catch (error) {
    console.error('Error toggling translator:', error);
    statusText.textContent = 'Chyba při přepínání';
  } finally {
    toggleBtn.disabled = false;
  }
}

// Event listeners
toggleBtn.addEventListener('click', toggleTranslator);

// Initialize
getState();

// Update stats every 2 seconds when active
setInterval(() => {
  if (isActive) {
    getState();
  }
}, 2000);
