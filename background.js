/**
 * Discord Message Translator - Background Script
 * Author: Tomáš Mark
 * 
 * Handles fetch requests from content script to bypass CORS restrictions
 * Manages translator state and communicates with content scripts
 */

const logger = {
  debug: (...args) => console.debug('[Discord Translator - Background]', ...args),
  log: (...args) => console.log('[Discord Translator - Background]', ...args),
  warn: (...args) => console.warn('[Discord Translator - Background]', ...args),
  error: (...args) => console.error('[Discord Translator - Background]', ...args)
};

// Translator state
let translatorState = {
  isActive: true,  // Automatically active for Discord
  stats: {
    translated: 0,
    cached: 0
  }
};

/**
 * Get current state
 */
function getState() {
  return { ...translatorState };
}

/**
 * Initialize translator state on startup
 */
async function initializeState() {
  // Load state from storage, default to active for Discord
  const stored = await chrome.storage.local.get('translatorActive');
  translatorState.isActive = stored.translatorActive !== undefined ? stored.translatorActive : true;
  await chrome.storage.local.set({ translatorActive: translatorState.isActive });
  logger.log('🚀 Translator initialized:', translatorState.isActive ? 'ACTIVE' : 'INACTIVE');
}

/**
 * Toggle translator on/off
 */
async function toggleTranslator() {
  translatorState.isActive = !translatorState.isActive;
  
  logger.log('🔄 Translator toggled:', translatorState.isActive ? 'ON' : 'OFF');

  // Save state to storage
  await chrome.storage.local.set({ translatorActive: translatorState.isActive });

  // Notify all Discord tabs
  const tabs = await chrome.tabs.query({ url: '*://*.discord.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, JSON.stringify({
        type: 'stateChanged',
        args: [translatorState.isActive]
      }));
    } catch (error) {
      // Tab might not have content script loaded yet
      logger.debug('Could not notify tab', tab.id, error.message);
    }
  }

  return getState();
}

/**
 * Update stats from content script
 */
function updateStats(stats) {
  translatorState.stats = { ...stats };
  logger.debug('📊 Stats updated:', stats);
}

/**
 * Load saved state on startup (deprecated, use initializeState instead)
 */
async function loadState() {
  const result = await chrome.storage.local.get('translatorActive');
  translatorState.isActive = result.translatorActive ?? true; // Default ON for automatic translation
  logger.log('📂 Loaded state:', translatorState.isActive ? 'ON' : 'OFF');
}

/**
 * Handle messages from content scripts and popup
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  logger.log('📨 Message received, type:', typeof message);
  logger.log('📨 Message content (first 200 chars):', typeof message === 'string' ? message.substring(0, 200) : message);

  (async () => {
    try {
      const { type, args } = JSON.parse(message);

      logger.log('✅ Parsed message type:', type);

      switch (type) {
        case 'fetch': {
          const [url, options] = args;
          logger.log('🌐 Proxying fetch request to:', url.substring(0, 100) + '...');

          const response = await fetch(url, options);
          logger.log('📥 Fetch response status:', response.status, response.statusText);

          const text = await response.text();
          logger.log('📄 Fetch response text length:', text.length);
          logger.log('📄 First 200 chars:', text.substring(0, 200));

          sendResponse(text);
          break;
        }

        case 'getState': {
          const state = getState();
          sendResponse(JSON.stringify(state));
          break;
        }

        case 'toggleTranslator': {
          const state = await toggleTranslator();
          sendResponse(JSON.stringify(state));
          break;
        }

        case 'updateStats': {
          const [stats] = args;
          updateStats(stats);
          sendResponse(JSON.stringify({ success: true }));
          break;
        }

        default:
          logger.warn('Unknown message type:', type);
          sendResponse(null);
      }

    } catch (error) {
      logger.error('❌ Error handling message:', error);
      logger.error('❌ Error stack:', error.stack);
      sendResponse(JSON.stringify({ error: error.message }));
    }
  })();

  return true; // Keep message channel open for async response
});

/**
 * Extension lifecycle events
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    logger.log('Extension installed');
    // Set default state to ON for automatic translation
    await chrome.storage.local.set({ translatorActive: true });
  } else if (details.reason === 'update') {
    logger.log('Extension updated to version', chrome.runtime.getManifest().version);
  }
  // Initialize state after install/update
  await initializeState();
});

// Initialize state on startup
initializeState().then(() => {
  logger.log('Discord Message Translator v' + chrome.runtime.getManifest().version + ' - Background script initialized');
  logger.log('Initial state:', translatorState.isActive ? 'ON (automatic)' : 'OFF');
});
