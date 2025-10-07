# DiMeTrans

Chrome extension pro překlad Discord zpráv do češtiny.
Při kliku na ikonu překladu vedle zprávy se zpráva přeloží.

Vyžaduje LibreTranslate API endpoint na vaší infrastruktuře!

## Setup

1. Nakonfigurujte LibreTranslate API endpoint v `content.js` (řádek ~100)
2. Otevřete Chrome a přejděte na `chrome://extensions/`
3. Zapněte "Developer mode"
4. Klikněte na "Load unpacked" a vyberte adresář s rozšířením

## Funkce

- **Manuální překlad** - Kliknutím na ikonu překladu vedle zprávy se zpráva přeloží do češtiny
- **Zachování kódu** - Ignoruje obsah v ``` code blocích (nepřekládá zdrojový kód)
- **Cache překladů** - Ukládá překlady do paměti, rychlejší opakované překlady
- **Detekce editace** - Nezasahuje do editace zpráv v Discordu

## Requirements

- Chrome/Chromium browser
- LibreTranslate API instance (self-hosted or remote)

<img width="1155" height="749" alt="image" src="https://github.com/user-attachments/assets/2da6fbbe-9537-4bb2-8c4e-6c2723229c28" />
<img width="1155" height="749" alt="image" src="https://github.com/user-attachments/assets/dacdc7a1-8c58-4993-ac66-f4610f83f2fb" />





