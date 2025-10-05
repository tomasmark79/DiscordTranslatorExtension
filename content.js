/**
 * Discord Message Translator - Content Script
 * Author: Tomáš Mark
 * 
 * Automatically translates Discord messages to the page language
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Debug settings
  DEBUG_ENABLED: false,              // Master switch for all debug logging
  DEBUG_VERBOSE: false,              // Extra detailed logs (element detection, viewport checks, etc.)
  DEBUG_API_REQUESTS: false,         // Log API requests and responses
  DEBUG_TRANSLATIONS: false,         // Log translation progress
  DEBUG_PERFORMANCE: false,          // Log timing and performance info

  // DEBUG_ENABLED: true,              // Master switch for all debug logging
  // DEBUG_VERBOSE: true,              // Extra detailed logs (element detection, viewport checks, etc.)
  // DEBUG_API_REQUESTS: true,         // Log API requests and responses
  // DEBUG_TRANSLATIONS: true,         // Log translation progress
  // DEBUG_PERFORMANCE: true,          // Log timing and performance info


  // Translation settings
  API_DELAY_MS: 50,                   // Delay between translation requests
  CYCLE_DELAY_MS: 2000,               // Delay between processing cycles
  TARGET_LANGUAGE: 'cs',              // Target language (Czech)

  // UI settings
  DEBUG_STYLING: false,               // Yellow background + red border for translations
  MANUAL_TRANSLATION: true,           // Enable manual translation with flag icon click
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const logger = {
  debug: (...args) => {
    if (CONFIG.DEBUG_ENABLED && CONFIG.DEBUG_VERBOSE) {
      console.debug('[Discord Translator]', ...args);
    }
  },
  log: (...args) => {
    if (CONFIG.DEBUG_ENABLED) {
      console.log('[Discord Translator]', ...args);
    }
  },
  warn: (...args) => {
    if (CONFIG.DEBUG_ENABLED) {
      console.warn('[Discord Translator]', ...args);
    }
  },
  error: (...args) => {
    // Always log errors
    console.error('[Discord Translator]', ...args);
  },
  api: (...args) => {
    if (CONFIG.DEBUG_ENABLED && CONFIG.DEBUG_API_REQUESTS) {
      console.log('[Discord Translator] 🌐', ...args);
    }
  },
  translate: (...args) => {
    if (CONFIG.DEBUG_ENABLED && CONFIG.DEBUG_TRANSLATIONS) {
      console.log('[Discord Translator] 🔄', ...args);
    }
  },
  perf: (...args) => {
    if (CONFIG.DEBUG_ENABLED && CONFIG.DEBUG_PERFORMANCE) {
      console.log('[Discord Translator] ⚡', ...args);
    }
  }
};

// ============================================================================
// TRANSLATION SERVICE
// ============================================================================

class TranslationService {
  /**
   * Prepare translation request for LibreTranslate API (self-hosted)
   */
  static prepareBatchTranslation(texts, options = {}) {
    const targetLang = options.to || 'en';
    const sourceLang = options.from || 'auto';

    // LibreTranslate uses single text per request
    const text = texts[0]; // We're already sending one text at a time

    // LibreTranslate requires POST with JSON body
    const url = 'http://192.168.79.2:5000/translate';
    const data = JSON.stringify({
      q: text,
      source: sourceLang,
      target: targetLang,
      format: 'text'
    });

    return { url, data };
  }

  /**
   * Format batch translation response from Google Translate API
   */
  static formatBatchResponse(originalTexts, response) {
    const results = {};

    try {
      if (Array.isArray(response) && response[0]) {
        originalTexts.forEach((originalText, index) => {
          const translated = response[0][index];
          if (translated && translated[0]) {
            results[index] = {
              before: originalText,
              after: translated[0],
              detectedLanguage: translated[1] || 'unknown'
            };
          }
        });
      }
    } catch (error) {
      logger.error('Error formatting translation response:', error);
    }

    return results;
  }
}

// ============================================================================
// CONTENT SCRIPT CONTEXT MANAGER
// ============================================================================

class ContentScriptContext {
  constructor(scriptName) {
    this.scriptName = scriptName;
    this.abortController = new AbortController();
    this.isTopFrame = window.self === window.top;
    this.receivedMessageIds = new Set();

    if (this.isTopFrame) {
      this.stopOldScripts();
      this.listenForNewerScripts({ ignoreFirstEvent: true });
    } else {
      this.listenForNewerScripts();
    }
  }

  get signal() {
    return this.abortController.signal;
  }

  get isValid() {
    return !this.signal.aborted && chrome.runtime?.id != null;
  }

  get isInvalid() {
    return !this.isValid;
  }

  onInvalidated(callback) {
    this.signal.addEventListener('abort', callback);
    return () => this.signal.removeEventListener('abort', callback);
  }

  stopOldScripts() {
    const messageType = `${chrome.runtime.id}:content-script-started`;
    window.postMessage({
      type: messageType,
      contentScriptName: this.scriptName,
      messageId: Math.random().toString(36).slice(2)
    }, '*');
  }

  listenForNewerScripts(options = {}) {
    let isFirst = true;
    const messageType = `${chrome.runtime.id}:content-script-started`;

    const handler = (event) => {
      if (event.data?.type === messageType &&
        event.data?.contentScriptName === this.scriptName &&
        !this.receivedMessageIds.has(event.data?.messageId)) {

        this.receivedMessageIds.add(event.data.messageId);

        const shouldIgnore = isFirst && options.ignoreFirstEvent;
        isFirst = false;

        if (!shouldIgnore) {
          this.abortController.abort('Newer script detected');
          logger.debug(`Content script "${this.scriptName}" invalidated by newer instance`);
        }
      }
    };

    window.addEventListener('message', handler);
    this.onInvalidated(() => window.removeEventListener('message', handler));
  }
}

// ============================================================================
// DISCORD MESSAGE TRANSLATOR
// ============================================================================

class DiscordTranslator {
  constructor(context) {
    this.context = context;
    this.translationCache = new Map(); // text -> translation (persistent across channels)
    this.processedMessages = new Set(); // Set of message IDs that have been processed (cleared on channel change)
    this.messageTranslations = new Map(); // messageId -> { text, translation, element }
    this.PROCESSED_ATTRIBUTE = 'discord-translator-processed';
    this.TRANSLATION_CLASS = 'discord-translator-translation';
    this.FLAG_ICON_CLASS = 'discord-translator-flag-icon';
    this.FLAG_CONTAINER_CLASS = 'discord-translator-flag-container';
    this.currentChannelId = null; // Track current channel
    this.isTranslating = false; // Flag to prevent multiple concurrent translations
    this.scrollTimeout = null; // Debounce scroll events
    this.isActive = true; // Translator automatically active for Discord
    this.processingInterval = null; // Interval for processing messages

    // Inject CSS for flag icons
    this.injectFlagIconStyles();
  }

  /**
   * Inject CSS styles for flag icons
   */
  injectFlagIconStyles() {
    if (document.getElementById('discord-translator-flag-styles')) {
      return; // Already injected
    }

    const styleElement = document.createElement('style');
    styleElement.id = 'discord-translator-flag-styles';
    styleElement.textContent = `
      .${this.FLAG_CONTAINER_CLASS} {
        display: inline-flex;
        align-items: center;
        opacity: 0.5;
        transition: opacity 0.3s ease;
        position: absolute;
        left: 0%;
        top: 90%;
        transform: translateY(-50%);
        z-index: 10;
        pointer-events: auto;
      }
      
      /* Make parent message have relative positioning for absolute child */
      [class*="markup"] {
        position: relative;
      }
      
      .${this.FLAG_CONTAINER_CLASS}:hover {
        opacity: 1;
      }
      
      .${this.FLAG_ICON_CLASS} {
        cursor: pointer;
        font-size: 14.8px;
        padding: 0;
        border-radius: 4px;
        transition: all 0.3s ease;
        user-select: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: transparent;
        border: none;
        width: 16.2px;
        height: 16.2px;
        color: var(--text-muted, #747f8d);
        position: relative;
      }
      
      .${this.FLAG_ICON_CLASS}:hover {
        background: rgba(88, 101, 242, 0.15);
        color: #5865f2;
        transform: scale(1.0);
        box-shadow: none;
      }
      
      /* Better visibility in different Discord themes */
      [data-theme="light"] .${this.FLAG_ICON_CLASS}:hover {
        background: rgba(88, 101, 242, 0.12);
        box-shadow: 0 1px 3px rgba(88, 101, 242, 0.25);
      }
      
      [data-theme="dark"] .${this.FLAG_ICON_CLASS}:hover {
        background: rgba(88, 101, 242, 0.18);
        box-shadow: 0 2px 4px rgba(88, 101, 242, 0.15);
      }
      
      .${this.FLAG_ICON_CLASS}:active {
        transform: scale(0.95);
        background: rgba(88, 101, 242, 0.25);
      }
      
      .${this.FLAG_ICON_CLASS}:focus {
        outline: none;
        background: rgba(88, 101, 242, 0.1);
        box-shadow: 0 0 0 2px rgba(88, 101, 242, 0.3);
      }
      
      .${this.FLAG_ICON_CLASS}.translating {
        opacity: 0.5;
        cursor: wait;
        animation: pulse 1.5s infinite;
      }
      
      @keyframes pulse {
        0%, 100% { opacity: 0.5; }
        50% { opacity: 0.8; }
      }
      
      .${this.FLAG_ICON_CLASS} svg {
        width: 100%;
        height: 100%;
        border-radius: 2px;
      }
    `;
    
    document.head.appendChild(styleElement);
    logger.debug('Flag icon styles injected');
  }

  async start() {
    logger.log('='.repeat(60));
    logger.log('Discord Translator initialized by Tomáš Mark');
    logger.log('='.repeat(60));
    logger.log('Configuration:');
    logger.log(`  Debug Enabled: ${CONFIG.DEBUG_ENABLED}`);
    logger.log(`  Debug Verbose: ${CONFIG.DEBUG_VERBOSE}`);
    logger.log(`  Debug API: ${CONFIG.DEBUG_API_REQUESTS}`);
    logger.log(`  Target Language: ${CONFIG.TARGET_LANGUAGE}`);
    logger.log(`  API Delay: ${CONFIG.API_DELAY_MS}ms`);
    logger.log(`  Cycle Delay: ${CONFIG.CYCLE_DELAY_MS}ms`);
    logger.log(`  Debug Styling: ${CONFIG.DEBUG_STYLING ? 'ON (yellow+red)' : 'OFF (subtle gray)'}`);
    logger.log(`  Manual Translation: ${CONFIG.MANUAL_TRANSLATION ? 'ON (flag icons)' : 'OFF (auto-translate)'}`);
    logger.log('='.repeat(60));

    // Get initial state from background (but default to ON)
    await this.checkState();

    // Listen for state changes (for manual toggle if needed)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      try {
        const { type, args } = JSON.parse(message);
        if (type === 'stateChanged') {
          const [isActive] = args;
          this.setActive(isActive);
          sendResponse(JSON.stringify({ success: true }));
        }
      } catch (error) {
        logger.error('Error handling message:', error);
      }
      return true;
    });

    // Wait for Discord to load messages
    await delay(3000);
    
    // Always start processing automatically on Discord
    logger.log('🚀 Starting automatic message translation...');
    await this.startProcessing();
  }

  /**
   * Check current state from background
   */
  async checkState() {
    // Check if chrome runtime is still valid
    if (!chrome?.runtime?.id) {
      logger.error('Chrome runtime not available');
      this.isActive = true; // Default to ON for automatic translation
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage(JSON.stringify({
        type: 'getState',
        args: []
      }));
      const state = JSON.parse(response);
      this.isActive = state.isActive ?? true; // Default to ON if undefined
      logger.log(`📊 Current state: ${this.isActive ? 'ON (automatic)' : 'OFF'}`);
    } catch (error) {
      logger.error('Error checking state:', error);
      this.isActive = true; // Default to ON on error for automatic translation
    }
  }

  /**
   * Set translator active state
   */
  setActive(isActive) {
    this.isActive = isActive;
    logger.log(`🔄 Translator ${isActive ? 'activated' : 'deactivated'}`);

    if (isActive) {
      this.startProcessing();
    } else {
      this.stopProcessing();
    }
  }

  /**
   * Start processing messages
   */
  async startProcessing() {
    if (this.processingInterval) {
      return; // Already running
    }

    logger.log('▶️ Starting message processing loop...');
    
    // Process immediately
    await this.processMessages();

    // Then process periodically
    this.processingInterval = setInterval(async () => {
      if (this.isActive) {
        await this.processMessages();
      }
    }, CONFIG.CYCLE_DELAY_MS);
  }

  /**
   * Stop processing messages
   */
  stopProcessing() {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.log('⏸️ Message processing stopped');
    }
  }

  /**
   * Send stats to background
   */
  async sendStats() {
    // Check if chrome runtime is still valid
    if (!chrome?.runtime?.id) {
      logger.debug('Chrome runtime not available, skipping stats update');
      return;
    }

    try {
      await chrome.runtime.sendMessage(JSON.stringify({
        type: 'updateStats',
        args: [{
          translated: this.messageTranslations.size,
          cached: this.translationCache.size
        }]
      }));
    } catch (error) {
      // Background might not be ready or extension was reloaded, ignore
      logger.debug('Failed to send stats:', error.message);
    }
  }

  /**
   * Get unique ID for a message element
   * Uses Discord's message ID from parent container
   */
  getMessageId(markupElement) {
    // Try to find parent message container with ID
    let current = markupElement;
    while (current && current !== document.body) {
      // Discord message IDs are in format: chat-messages-{channelId}-{messageId}
      if (current.id && current.id.includes('chat-messages-')) {
        return current.id;
      }
      // Also check for message content ID
      if (current.id && current.id.startsWith('message-content-')) {
        return current.id;
      }
      current = current.parentElement;
    }

    // Fallback: use text content hash + position
    const text = markupElement.textContent.trim();
    const position = Array.from(document.querySelectorAll('[class*="markup"]')).indexOf(markupElement);
    return `msg-${this.simpleHash(text)}-${position}`;
  }

  /**
   * Simple hash function for text
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Check if element is visible in viewport
   */
  isElementVisible(element) {
    const rect = element.getBoundingClientRect();
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;

    // Element is visible if any part is in viewport
    const vertInView = (rect.top <= windowHeight) && ((rect.top + rect.height) >= 0);
    const horInView = (rect.left <= windowWidth) && ((rect.left + rect.width) >= 0);

    return vertInView && horInView;
  }

  /**
   * Get current Discord channel ID from URL or DOM
   */
  getCurrentChannelId() {
    // Method 1: From URL (most reliable)
    const urlMatch = window.location.pathname.match(/\/channels\/(\d+)\/(\d+)/);
    if (urlMatch) {
      return urlMatch[2]; // Return channel ID (second number)
    }

    // Method 2: From DOM - look for channel name element
    const channelName = document.querySelector('[class*="title"]');
    if (channelName) {
      return `channel-${this.simpleHash(channelName.textContent)}`;
    }

    return 'unknown-channel';
  }

  /**
   * Check if channel changed and reset processed messages if needed
   */
  checkChannelChange() {
    const newChannelId = this.getCurrentChannelId();

    if (this.currentChannelId !== newChannelId) {
      logger.log(`📺 Channel changed: ${this.currentChannelId || 'none'} → ${newChannelId}`);

      // Clear processed messages (but keep translation cache for speed)
      this.processedMessages.clear();
      this.messageTranslations.clear();

      logger.log(`🗑️ Cleared processed messages (${this.translationCache.size} translations in cache)`);

      this.currentChannelId = newChannelId;
      return true; // Channel changed
    }

    return false; // Same channel
  }

  /**
   * Add clickable translation icons to messages for manual translation
   */
  async addFlagIcons() {
    // Use the best selector that finds message content reliably
    const allMessages = document.querySelectorAll('[class*="markup"]');
    
    logger.debug(`Found ${allMessages.length} total messages to check for translation icons`);

    let flagsAdded = 0;
    let flagsSkipped = 0;

    for (const messageElement of allMessages) {
      try {
        const messageId = this.getMessageId(messageElement);
        
        // Skip messages being edited
        if (this.isMessageBeingEdited(messageElement)) {
          flagsSkipped++;
          continue;
        }
        
        // Skip if already has flag icon
        if (this.processedMessages.has(messageId)) {
          flagsSkipped++;
          continue;
        }
        
        // Check if flag already exists near this message
        if (this.hasFlagNearby(messageElement)) {
          this.processedMessages.add(messageId);
          flagsSkipped++;
          continue;
        }

        // Skip if message is already translated
        if (this.messageTranslations.has(messageId)) {
          this.processedMessages.add(messageId);
          flagsSkipped++;
          continue;
        }

        // Skip embeds and replies (same logic as in processMessages)
        if (this.shouldSkipMessage(messageElement)) {
          continue;
        }

        // Skip if no content
        const hasContent = messageElement.textContent.trim().length > 0;
        if (!hasContent) {
          continue;
        }

        // Only add flag to visible messages
        if (!this.isElementVisible(messageElement)) {
          continue;
        }

        // Debug message structure if needed
        this.analyzeMessageStructure(messageElement);

        // Find a good place to add the translation icon
        const flagContainer = this.createFlagIcon(messageElement, messageId);
        if (flagContainer) {
          flagsAdded++;
          this.processedMessages.add(messageId);
        }

      } catch (error) {
        logger.error('Error adding translation icon:', error);
      }
    }

    logger.log(`� Translation icons: ${flagsAdded} added, ${flagsSkipped} skipped`);
  }

  /**
   * Check if message is being edited
   */
  isMessageBeingEdited(messageElement) {
    // Check if the message element itself contains edit fields
    if (messageElement.querySelector('textarea, [contenteditable="true"]')) {
      return true;
    }

    // Check parent message container
    let parent = messageElement.parentElement;
    let depth = 0;
    while (parent && parent !== document.body && depth < 10) {
      // Check if this is a message container
      if (parent.role === 'article' || parent.classList?.contains('message')) {
        // Check if it contains edit fields
        if (parent.querySelector('textarea, [contenteditable="true"]')) {
          return true;
        }
        break; // Found message container, stop searching
      }
      parent = parent.parentElement;
      depth++;
    }

    return false;
  }

  /**
   * Check if message should be skipped (embeds, replies, etc.)
   */
  shouldSkipMessage(messageElement) {
    const messageId = this.getMessageId(messageElement);

    // Skip messages being edited
    if (this.isMessageBeingEdited(messageElement)) {
      logger.debug(`⏭️ Skipping message being edited [${messageId}]`);
      return true;
    }

    // Skip embeds
    let current = messageElement.parentElement;
    while (current && current !== document.body) {
      const classList = current.classList ? Array.from(current.classList).join(' ') : '';
      const className = current.className || '';

      if (classList.includes('embed') ||
          classList.includes('messageAccessories') ||
          classList.includes('container') && classList.includes('embedWrapper') ||
          className.includes('embed') ||
          current.id?.includes('message-accessories')) {
        logger.debug(`⏭️ Skipping embed element [${messageId}]`);
        return true;
      }
      current = current.parentElement;
    }

    // Skip replies/quotes
    let parent = messageElement.parentElement;
    while (parent && parent !== document.body) {
      const classList = parent.classList ? Array.from(parent.classList).join(' ') : '';
      if (classList.includes('repliedMessage') ||
          classList.includes('repliedText') ||
          parent.id?.startsWith('message-reply-context')) {
        logger.debug(`⏭️ Skipping quoted/reply element [${messageId}]`);
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  /**
   * Create and insert a clickable Czech flag icon next to a message
   */
  createFlagIcon(messageElement, messageId) {
    try {
      logger.debug(`Creating flag icon for message [${messageId}]`);
      
      const targetParent = messageElement.parentElement;
      if (!targetParent) {
        logger.debug(`No parent found for message [${messageId}]`);
        return null;
      }
      
      const flagContainer = this.createFlagElement(messageElement, messageId);
      
      // Simply add the flag after the message element as a sibling
      // DO NOT wrap or move the original message element to avoid conflicts with Discord's edit functionality
      if (messageElement.nextSibling) {
        targetParent.insertBefore(flagContainer, messageElement.nextSibling);
      } else {
        targetParent.appendChild(flagContainer);
      }
      
      logger.debug(`Flag icon placed for [${messageId}]`);
      return flagContainer;

    } catch (error) {
      logger.error(`Error creating flag icon for message [${messageId}]:`, error);
      return null;
    }
  }
  
  /**
   * Check if flag can be placed inline with message
   */
  canPlaceInline(messageElement) {
    const style = window.getComputedStyle(messageElement);
    const parent = messageElement.parentElement;
    const parentStyle = window.getComputedStyle(parent);
    
    return (
      style.display.includes('inline') ||
      parentStyle.display === 'flex' ||
      parent.tagName.toLowerCase() === 'span'
    );
  }
  
  /**
   * Find the message wrapper/container in Discord's structure
   */
  findMessageWrapper(messageElement) {
    let current = messageElement.parentElement;
    let depth = 0;
    const maxDepth = 5; // Prevent infinite loops
    
    while (current && current !== document.body && depth < maxDepth) {
      const classList = Array.from(current.classList || []).join(' ');
      const className = current.className || '';
      
      // Look for Discord message content patterns
      if (
        classList.includes('messageContent') ||
        classList.includes('markup') && current !== messageElement ||
        className.includes('content') ||
        current.querySelector('[class*="timestamp"]') // Messages usually have timestamps nearby
      ) {
        logger.debug(`Found wrapper at depth ${depth}:`, current.className);
        return current;
      }
      
      current = current.parentElement;
      depth++;
    }
    
    return null;
  }
  
  /**
   * Check if there's already a flag icon near this message
   */
  hasFlagNearby(messageElement) {
    // Check siblings
    const parent = messageElement.parentElement;
    if (!parent) return false;
    
    // Check next/previous siblings
    const siblings = Array.from(parent.children);
    const messageIndex = siblings.indexOf(messageElement);
    
    // Check 2 siblings in each direction
    for (let i = Math.max(0, messageIndex - 2); i <= Math.min(siblings.length - 1, messageIndex + 2); i++) {
      const sibling = siblings[i];
      if (sibling.classList?.contains(this.FLAG_CONTAINER_CLASS) ||
          sibling.querySelector(`.${this.FLAG_CONTAINER_CLASS}`)) {
        return true;
      }
    }
    
    // Check if parent contains a flag
    return parent.querySelector(`.${this.FLAG_CONTAINER_CLASS}`) !== null;
  }

  /**
   * Debug helper - analyze message structure for flag placement
   */
  analyzeMessageStructure(messageElement) {
    if (!CONFIG.DEBUG_ENABLED) return;
    
    const messageId = this.getMessageId(messageElement);
    const parent = messageElement.parentElement;
    const style = window.getComputedStyle(messageElement);
    const parentStyle = window.getComputedStyle(parent);
    
    logger.debug(`Message structure analysis [${messageId}]:`, {
      element: messageElement.tagName,
      elementClass: messageElement.className,
      elementDisplay: style.display,
      parent: parent.tagName,
      parentClass: parent.className,
      parentDisplay: parentStyle.display,
      canPlaceInline: this.canPlaceInline(messageElement),
      hasWrapper: !!this.findMessageWrapper(messageElement),
      hasFlagNearby: this.hasFlagNearby(messageElement)
    });
  }

  /**
   * Create the flag icon element
   */
  createFlagElement(messageElement, messageId) {
    const flagContainer = document.createElement('span');
    flagContainer.className = this.FLAG_CONTAINER_CLASS;
    
    const flagIcon = document.createElement('button');
    flagIcon.className = this.FLAG_ICON_CLASS;
    flagIcon.title = 'Přeložit do češtiny';
    flagIcon.setAttribute('data-message-id', messageId);
    
    // Create translation icon SVG (subtle language swap icon)
    flagIcon.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
        <path opacity="0.6" d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
      </svg>
    `;
    
    // Add click handler
    flagIcon.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.translateSingleMessage(messageElement, messageId, flagIcon);
    });
    
    flagContainer.appendChild(flagIcon);
    return flagContainer;
  }

  /**
   * Translate a single message when flag is clicked
   */
  async translateSingleMessage(messageElement, messageId, flagIcon) {
    try {
      logger.log(`🔄 Translating message on demand [${messageId}]`);
      
      // Check if already translated
      if (this.messageTranslations.has(messageId)) {
        logger.log(`⏭️ Message [${messageId}] already translated - removing icon`);
        
        // Remove the translation icon since message is already translated
        this.removeTranslationIcon(flagIcon);
        return;
      }

      // Add loading state
      flagIcon.classList.add('translating');
      flagIcon.title = 'Překládám...';
      
      // Change to loading icon
      flagIcon.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <circle cx="12" cy="12" r="2" opacity="0.8">
            <animate attributeName="r" values="2;6;2" dur="1.2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite"/>
          </circle>
          <path opacity="0.4" d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
        </svg>
      `;
      
      // Extract text content
      const textContent = this.extractCleanText(messageElement);
      if (!textContent || textContent.trim().length === 0) {
        logger.debug(`⏭️ No text to translate [${messageId}]`);
        flagIcon.classList.remove('translating');
        flagIcon.title = 'Žádný text k překladu';
        
        // Reset to original translation icon
        flagIcon.innerHTML = `
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
            <path opacity="0.6" d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          </svg>
        `;
        return;
      }

      // Check cache first
      if (this.translationCache.has(textContent)) {
        const cachedTranslation = this.translationCache.get(textContent);
        this.displaySingleTranslation(messageElement, cachedTranslation, messageId);
        
        // Remove the translation icon since message is now translated (from cache)
        this.removeTranslationIcon(flagIcon);
        
        logger.log(`✅ Message [${messageId}] translated from cache and icon removed`);
        return;
      }

      // Translate using API
      const translation = await this.translateText(textContent);
      if (translation && translation.trim().length > 0) {
        // Cache translation
        this.translationCache.set(textContent, translation);
        
        // Display translation
        this.displaySingleTranslation(messageElement, translation, messageId);
        
        // Remove the translation icon since message is now translated
        this.removeTranslationIcon(flagIcon);
        
        logger.log(`✅ Message [${messageId}] translated successfully and icon removed`);
      } else {
        throw new Error('Empty translation received');
      }

    } catch (error) {
      logger.error(`❌ Error translating message [${messageId}]:`, error);
      flagIcon.classList.remove('translating');
      flagIcon.title = 'Chyba při překladu ❌';
      
      // Change to error icon (subtle error with translation icon)
      flagIcon.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor">
          <path opacity="0.3" d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"/>
          <circle fill="#f44336" cx="18" cy="6" r="4"/>
          <path fill="white" d="M16 4.5l4 4M20 4.5l-4 4" stroke="white" stroke-width="1" stroke-linecap="round"/>
        </svg>
      `;
    }
  }

  /**
   * Extract clean text from message element
   */
  extractCleanText(element) {
    const clone = element.cloneNode(true);
    
    // Remove Discord-specific elements including code blocks
    const elementsToRemove = clone.querySelectorAll(
      '[class*="repliedMessage"], ' +
      '[class*="repliedText"], ' +
      '[class*="embed"], ' +
      'pre, code, ' +
      'img, video, audio'
    );
    
    elementsToRemove.forEach(el => el.remove());
    
    let text = clone.textContent || '';
    
    // Remove URLs
    text = text.replace(/https?:\/\/[^\s]+/g, '');
    
    return text.trim();
  }

  /**
   * Translate text using the API
   */
  async translateText(text) {
    try {
      const { url, data } = TranslationService.prepareBatchTranslation([text], {
        to: CONFIG.TARGET_LANGUAGE,
        from: 'auto'
      });

      logger.api(`🌐 Translating: "${text.substring(0, 50)}..."`);

      const responseText = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          JSON.stringify({
            type: 'fetch',
            args: [url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
              },
              body: data
            }]
          }),
          (response) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(response);
            }
          }
        );
      });

      if (responseText) {
        const response = JSON.parse(responseText);
        const translatedText = response.translatedText;
        
        if (translatedText && translatedText.trim().length > 0) {
          logger.api(`✅ Translation: "${translatedText.substring(0, 50)}..."`);
          return translatedText;
        }
      }

      throw new Error('Invalid API response');

    } catch (error) {
      logger.error('Translation API error:', error);
      throw error;
    }
  }

  /**
   * Display translation for a single message
   */
  displaySingleTranslation(messageElement, translatedText, messageId) {
    try {
      // Check if translation already displayed
      if (messageElement.nextSibling?.classList?.contains(this.TRANSLATION_CLASS)) {
        logger.debug(`⏭️ Translation already displayed [${messageId}]`);
        return;
      }

      // Create translation element
      const translationSpan = document.createElement('div');
      translationSpan.className = this.TRANSLATION_CLASS;

      const baseStyle = {
        fontSize: '14px',
        fontStyle: 'normal',
        marginTop: '2px',
        marginBottom: '0px',
        padding: '0px',
        lineHeight: '1.375rem',
        fontFamily: 'gg sans, "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
        opacity: '0.8',
        backgroundColor: 'transparent',
        border: 'none',
        borderRadius: '0px',
        color: 'var(--text-muted, #949ba4)'
      };

      Object.assign(translationSpan.style, baseStyle);

      translationSpan.textContent = translatedText;

      // Insert after message element
      const parent = messageElement.parentElement;
      if (messageElement.nextSibling) {
        parent.insertBefore(translationSpan, messageElement.nextSibling);
      } else {
        parent.appendChild(translationSpan);
      }

      // Store translation
      this.messageTranslations.set(messageId, {
        text: messageElement.textContent.trim(),
        translation: translatedText,
        element: messageElement,
        timestamp: Date.now()
      });

      logger.debug(`✅ Translation displayed for [${messageId}]`);

    } catch (error) {
      logger.error(`❌ Error displaying translation [${messageId}]:`, error);
    }
  }

  /**
   * Remove translation icon from the DOM
   */
  removeTranslationIcon(flagIcon) {
    try {
      const flagContainer = flagIcon.closest(`.${this.FLAG_CONTAINER_CLASS}`);
      if (flagContainer && flagContainer.parentElement) {
        flagContainer.parentElement.removeChild(flagContainer);
        logger.debug('Translation icon removed from DOM');
      } else {
        // Fallback: just remove the icon itself
        if (flagIcon.parentElement) {
          flagIcon.parentElement.removeChild(flagIcon);
          logger.debug('Translation icon removed (fallback)');
        }
      }
    } catch (error) {
      logger.error('Error removing translation icon:', error);
    }
  }

  async processMessages() {
    if (this.context.isInvalid) {
      logger.log('Context invalidated, stopping...');
      this.stopProcessing();
      return;
    }

    if (!this.isActive) {
      logger.debug('Translator is not active, skipping processing');
      return;
    }

    // Check if channel changed and reset if needed
    const channelChanged = this.checkChannelChange();
    if (channelChanged) {
      logger.log('🔄 Channel changed, will process all messages in new channel');
    }

    // Use the best selector that finds message content reliably
    const allMessages = document.querySelectorAll('[class*="markup"]');

    logger.log('Found messages:', allMessages.length);

    if (allMessages.length === 0) {
      logger.debug('No messages found, will retry in next cycle');
      return;
    }

    // If manual translation mode is enabled, add flag icons instead of auto-translating
    if (CONFIG.MANUAL_TRANSLATION) {
      await this.addFlagIcons();
      return;
    }

    // Filter messages that haven't been processed and have content
    let processedCount = 0;
    let noContentCount = 0;
    let hasTranslationCount = 0;
    let alreadyInSetCount = 0;
    let notVisibleCount = 0;

    const messageElements = [...allMessages].filter(el => {
      // Get unique message ID
      const messageId = this.getMessageId(el);

      // Skip messages being edited
      if (this.isMessageBeingEdited(el)) {
        logger.debug('Skipping message in edit mode');
        return false;
      }

      // Check if already processed using our Set
      const alreadyProcessed = this.processedMessages.has(messageId);
      if (alreadyProcessed) {
        alreadyInSetCount++;
        return false;
      }

      // Skip embeds (YouTube previews, images, etc.)
      // Embeds are usually in elements with parent having "message-accessories" or similar
      let current = el.parentElement;
      while (current && current !== document.body) {
        const classList = current.classList ? Array.from(current.classList).join(' ') : '';
        const className = current.className || '';

        // Check for embed-related classes
        if (classList.includes('embed') ||
          classList.includes('messageAccessories') ||
          classList.includes('container') && classList.includes('embedWrapper') ||
          className.includes('embed') ||
          current.id?.includes('message-accessories')) {
          logger.debug(`⏭️ Skipping embed element [${messageId}]`);
          return false;
        }
        current = current.parentElement;
      }

      // Skip if element is inside a reply/quote
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const classList = parent.classList ? Array.from(parent.classList).join(' ') : '';
        if (classList.includes('repliedMessage') ||
          classList.includes('repliedText') ||
          parent.id?.startsWith('message-reply-context')) {
          logger.debug(`⏭️ Skipping quoted/reply element [${messageId}]`);
          return false;
        }
        parent = parent.parentElement;
      }

      const hasContent = el.textContent.trim().length > 0;

      if (!hasContent) {
        noContentCount++;
        return false;
      }

      // IMPORTANT: Only translate visible messages for faster response
      const isVisible = this.isElementVisible(el);
      if (!isVisible) {
        notVisibleCount++;
        return false;
      }

      return true;
    }); // Process messages in order: OLDEST FIRST (top to bottom)

    logger.log(`📊 Message filtering: Total=${allMessages.length}, AlreadyProcessed=${alreadyInSetCount}, NoContent=${noContentCount}, NotVisible=${notVisibleCount}, ToProcess=${messageElements.length}`);
    logger.log(`🔄 Processing order: OLDEST FIRST (top to bottom)`);
    logger.log(`💾 Processed messages in Set: ${this.processedMessages.size}`);

    if (!messageElements.length) {
      logger.debug('No new messages found, will retry in next cycle');
      return;
    }

    logger.log(`Found ${messageElements.length} new messages to translate (all visible on screen)`);

    // Process ALL visible messages (no batch limit needed since we only process visible messages)
    const messagesToProcess = messageElements;

    const htmlPlaceholders = new Map();

    const extractTextParts = (element, elementIndex) => {
      // Clone element to safely remove quoted/reply content and embeds
      const clone = element.cloneNode(true);

      // Remove Discord reply/quote elements (citations)
      const quotesToRemove = clone.querySelectorAll(
        '[class*="repliedMessage"], ' +
        '[class*="repliedText"], ' +
        '[class*="blockquote"], ' +
        '[id^="message-reply-context"]'  // Remove reply context by ID
      );
      quotesToRemove.forEach(quote => quote.remove());

      // Remove embed elements (YouTube previews, images, etc.)
      const embedsToRemove = clone.querySelectorAll(
        '[class*="embed"], ' +
        '[class*="embedWrapper"], ' +
        '[class*="messageAccessories"], ' +
        '[id^="message-accessories"]'
      );
      embedsToRemove.forEach(embed => embed.remove());

      // Remove code blocks - we want to translate text around them, but not the code itself
      // First remove all <pre> elements (which contain the code blocks)
      const preElements = clone.querySelectorAll('pre');
      preElements.forEach(pre => {
        logger.debug('Removing <pre> element from message ' + elementIndex);
        pre.remove();
      });
      
      // Then remove any remaining <code> elements (inline code)
      const codeElements = clone.querySelectorAll('code');
      codeElements.forEach(code => {
        logger.debug('Removing <code> element from message ' + elementIndex);
        code.remove();
      });

      // Get text without quotes, embeds, and code blocks
      let text = clone.textContent.trim();

      if (text.length === 0) {
        logger.debug(`Message ${elementIndex}: Empty after removing quotes/embeds/code`);
        return [];
      }

      // Remove URLs from text (don't translate links)
      // Matches http://, https://, www. links, and discord.gg links
      const urlRegex = /https?:\/\/[^\s]+|www\.[^\s]+|discord\.gg\/[^\s]+/gi;
      const originalText = text;
      text = text.replace(urlRegex, '').trim();

      // If text was ONLY URLs, skip translation
      if (text.length === 0) {
        logger.debug(`Message ${elementIndex}: Only URLs, skipping translation`);
        return [];
      }

      // Skip if text is too short after removing URLs (probably just emoji or reaction)
      if (text.length < 3) {
        logger.debug(`Message ${elementIndex}: Text too short after URL removal (${text.length} chars): "${text}"`);
        return [];
      }

      // Log if URLs were removed
      if (originalText !== text) {
        logger.debug(`Message ${elementIndex}: Removed URLs, text: "${originalText.substring(0, 50)}..." -> "${text.substring(0, 50)}..."`);
      }

      return [text];
    };

    // Track which messageIds we've already seen in this batch
    const seenMessageIds = new Set();

    const textsToTranslate = messagesToProcess
      .map((element, index) => {
        const messageId = this.getMessageId(element);

        // Skip if we've already seen this messageId (multiple markup elements for same message)
        if (seenMessageIds.has(messageId)) {
          logger.debug(`⏭️ Skipping duplicate messageId: ${messageId}`);
          return null;
        }
        seenMessageIds.add(messageId);

        const parts = extractTextParts(element, index);
        const text = parts.join('');
        logger.debug(`Message ${index} [${messageId}]: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);

        // If text is in cache, display cached translation and mark as processed
        if (this.translationCache.has(text)) {
          const cachedTranslation = this.translationCache.get(text);
          logger.debug(`📦 Using cached translation for message ${index} [${messageId}]`);
          try {
            // Check if element still exists in DOM
            if (element && element.isConnected) {
              this.displayTranslation(element, cachedTranslation, index, messageId);
            } else {
              logger.debug(`⏭️ Cached element ${index} [${messageId}] no longer in DOM`);
              this.processedMessages.add(messageId);
            }
          } catch (displayError) {
            logger.error(`❌ Error displaying cached translation [${messageId}]:`, displayError);
            this.processedMessages.add(messageId);
          }
          return null; // Skip this item
        }

        return { element, text, index, messageId }; // Store element reference and ID
      })
      .filter(item => item !== null && item.text);

    logger.log('Texts to translate:', textsToTranslate.length, 'of', messageElements.length);

    // Show some sample texts
    if (textsToTranslate.length > 0) {
      logger.log('Sample texts to translate:', textsToTranslate.slice(0, 3).map(item => `"${item.text.substring(0, 50)}..."`));
    }

    if (textsToTranslate.length === 0) {
      logger.debug('All messages already cached, will check again in next cycle');
      return;
    }

    try {
      const targetLanguage = CONFIG.TARGET_LANGUAGE;
      logger.log(`Translating ${textsToTranslate.length} texts to Czech`);

      // Translate texts one by one instead of batch to avoid API issues
      const translations = [];
      for (let i = 0; i < textsToTranslate.length; i++) {
        const { element, text, index, messageId } = textsToTranslate[i];
        logger.log(`🔄 Translating ${i + 1}/${textsToTranslate.length} [${messageId}]: "${text.substring(0, 50)}..."`);

        const { url, data } = TranslationService.prepareBatchTranslation(
          [text], // Single text instead of batch
          { to: targetLanguage }
        );

        try {
          // LibreTranslate requires POST with JSON body
          const requestUrl = url;
          logger.log(`🌐 Making request to: ${requestUrl}`);
          logger.log(`📦 Request body:`, data);

          let responseText;
          try {
            // Wrap chrome.runtime.sendMessage in Promise for proper async/await
            logger.log(`📞 Sending message to background script...`);
            responseText = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage(
                JSON.stringify({
                  type: 'fetch',
                  args: [requestUrl, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    body: data
                  }]
                }),
                (response) => {
                  logger.log(`📬 Background script callback received`);
                  if (chrome.runtime.lastError) {
                    logger.error(`❌ Chrome runtime error:`, chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                  } else {
                    logger.log(`✅ Response received from background, type: ${typeof response}`);
                    resolve(response);
                  }
                }
              );
            });
          } catch (messageError) {
            logger.error(`❌ Error sending message to background:`, messageError);
            translations.push({ originalText: text, translatedText: `MESSAGE_ERROR_${i}` });
            continue;
          }

          logger.log(`📨 Response text length: ${responseText ? responseText.length : 'NULL/UNDEFINED'}`);

          if (responseText) {
            // Log raw response
            logger.debug(`📤 Raw response text (first 500 chars): ${responseText.substring(0, 500)}`);

            let response;
            try {
              response = JSON.parse(responseText);
              logger.debug(`📤 Parsed JSON response:`, response);
            } catch (parseError) {
              logger.error(`❌ Failed to parse response as JSON:`, parseError);
              logger.error(`Response text: ${responseText.substring(0, 1000)}`);
              translations.push({ originalText: text, translatedText: `PARSE_ERROR_${i}` });
              continue;
            }

            // LibreTranslate API response format: { translatedText: "...", detectedLanguage: { ... } }
            logger.debug(`📊 Response structure:`, response);

            // Check if LibreTranslate API response is valid
            if (response && response.translatedText) {
              const translatedText = response.translatedText;
              const detectedLang = response.detectedLanguage?.language || 'unknown';

              logger.log(`✅ Translated [${messageId}]: "${text.substring(0, 30)}..." -> "${translatedText.substring(0, 30)}..."`);

              // IMMEDIATELY add to cache
              this.translationCache.set(text, translatedText);

              // IMMEDIATELY display this translation and mark as processed
              try {
                // Check if element still exists in DOM
                if (element && element.isConnected) {
                  this.displayTranslation(element, translatedText, index, messageId);
                } else {
                  logger.debug(`⏭️ Element ${index} [${messageId}] no longer in DOM, skipping display`);
                  // Still mark as processed to avoid retrying
                  this.processedMessages.add(messageId);
                }
              } catch (displayError) {
                logger.error(`❌ Error displaying translation [${messageId}]:`, displayError);
                // Mark as processed to avoid infinite retries
                this.processedMessages.add(messageId);
              }

            } else {
              logger.error(`❌ No translation in response:`, response);
              this.translationCache.set(text, `NO_TRANSLATION_${i}`);
            }
          } else {
            logger.log(`🚫 Error translating: "${text.substring(0, 30)}..." - No response`);
            this.translationCache.set(text, `ERROR_${i}`);
          }
        } catch (error) {
          logger.error(`Translation error for text ${i}:`, error);
          this.translationCache.set(text, `ERROR_${i}`);
        }

        // Small delay between requests to avoid overwhelming API
        await delay(CONFIG.API_DELAY_MS);
      }

      logger.log('💾 Cache now contains:', this.translationCache.size, 'translations');
      logger.log('✅ All translations displayed immediately after each API call');

      // Send stats to background
      await this.sendStats();

    } catch (error) {
      logger.error('Translation error:', error);
      logger.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
    }

    // Send stats to background after processing
    await this.sendStats();
  }

  /**
   * Display a single translation immediately after it's translated
   */
  displayTranslation(messageElement, translatedText, index, messageId) {
    // Validate inputs first
    if (!messageElement) {
      logger.error(`❌ displayTranslation called with null messageElement [${messageId}]`);
      return;
    }

    if (!messageElement.isConnected) {
      logger.debug(`⏭️ Element ${index} [${messageId}] not in DOM, skipping display`);
      this.processedMessages.add(messageId);
      return;
    }

    if (!translatedText || translatedText.trim().length === 0) {
      logger.debug(`⏭️ Empty translation for ${index} [${messageId}], skipping display`);
      this.processedMessages.add(messageId);
      return;
    }

    logger.log(`➕ Displaying translation ${index} [${messageId}]: "${translatedText.substring(0, 30)}..."`);

    // Check if already processed using our Set (most reliable)
    if (this.processedMessages.has(messageId)) {
      logger.log(`⏭️ Skipping [${messageId}]: already in processedMessages Set`);
      return;
    }

    // Check if translation already exists as next sibling
    if (messageElement.nextSibling?.classList?.contains(this.TRANSLATION_CLASS)) {
      logger.log(`⏭️ Skipping [${messageId}]: translation already exists as next sibling`);
      // Still mark as processed
      this.processedMessages.add(messageId);
      return;
    }

    // Create translation element
    const translationSpan = document.createElement('div');
    translationSpan.className = 'discord-translator-translation';

    // Minimal styling - transparent, blends with Discord
    const baseStyle = {
      fontSize: '14px',
      fontStyle: 'normal',
      marginTop: '2px',
      marginBottom: '0px',
      padding: '0px',
      lineHeight: '1.375rem',
      fontFamily: 'gg sans, "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
      opacity: '0.8',
      backgroundColor: 'transparent',
      border: 'none',
      borderRadius: '0px'
    };

    // Debug styling (yellow + red) or production styling (minimal transparent)
    const debugStyle = CONFIG.DEBUG_STYLING ? {
      backgroundColor: '#ffff00', // Yellow background
      border: '2px solid #ff0000', // Red border
      padding: '8px 12px',
      borderRadius: '4px',
      opacity: '1'
    } : {
      // Minimal production style - just color
      color: 'var(--text-muted, #949ba4)' // Discord's muted text color
    };

    Object.assign(translationSpan.style, { ...baseStyle, ...debugStyle });

    // Translated text without flag emoji
    translationSpan.textContent = translatedText;

    try {
      // Insert directly after the message element
      const parent = messageElement.parentElement;
      
      // Validate parent exists and is still in DOM
      if (!parent || !parent.isConnected) {
        logger.debug(`⏭️ Parent element not found or not in DOM [${messageId}]`);
        this.processedMessages.add(messageId);
        return;
      }

      if (messageElement.nextSibling) {
        parent.insertBefore(translationSpan, messageElement.nextSibling);
      } else {
        parent.appendChild(translationSpan);
      }

      logger.log(`✅ Translation displayed for message ${index} [${messageId}]`);

      // Mark as processed in our Set - MOST IMPORTANT
      this.processedMessages.add(messageId);

      // Also set attribute as backup
      messageElement.setAttribute(this.PROCESSED_ATTRIBUTE, '1');

      // Store in messageTranslations map for reference
      this.messageTranslations.set(messageId, {
        text: messageElement.textContent.trim(),
        translation: translatedText,
        element: messageElement,
        timestamp: Date.now()
      });

      logger.debug(`✓ Message ${index} [${messageId}] marked as processed in Set (total: ${this.processedMessages.size})`);

    } catch (error) {
      logger.error(`💥 Error displaying translation [${messageId}]:`, error.message || error);
      logger.debug('Error details:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      // Mark as processed to prevent infinite retries
      this.processedMessages.add(messageId);
    }
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

(async function main() {
  try {
    logger.log('Initializing Discord Translator...');

    if (!chrome?.runtime?.id) {
      logger.error('Chrome runtime not available - this script requires Chrome extension context');
      return;
    }

    logger.log('Chrome runtime available, creating context...');

    const context = new ContentScriptContext('discord-translator');
    const translator = new DiscordTranslator(context);

    // Make translator globally accessible for manual testing
    window.discordTranslator = translator;
    logger.log('Translator assigned to window.discordTranslator');

    await translator.start();

  } catch (error) {
    logger.error('Content script crashed on startup:', error);
    logger.error('Startup error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    // Don't throw - we want to see the error but not crash completely
  }
})();
