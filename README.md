# DiMeTrans

Chrome extension for automatic Discord message translation to Czech.

Requiring LibreTranslate API endpoint on yout infra!

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

<img width="181" height="606" alt="image" src="https://github.com/user-attachments/assets/43d25c2a-4cc3-4f06-ba8f-cb2a056efcb1" />

