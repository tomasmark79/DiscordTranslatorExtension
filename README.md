# DiMeTrans

Chrome extension for automatic Discord message translation to Czech.

Requiring LibreTranslate API endpoint on your infra!

## Setup

1. Configure LibreTranslate API endpoint in `content.js` (line ~100)
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked" and select extension directory

## Features

- **Automatic translation** - Works in background without interaction
- **Manual mode** - Click flag icon to translate specific messages
- **Code block preservation** - Ignores content in ``` code blocks
- **Translation cache** - Avoids re-translating same messages
- **Edit mode detection** - Doesn't interfere with Discord's message editing

## Requirements

- Chrome/Chromium browser
- LibreTranslate API instance (self-hosted or remote)

<img width="1095" height="950" alt="image" src="https://github.com/user-attachments/assets/88ede985-57af-46ee-8837-aed1161f6738" />


