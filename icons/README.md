# Icon Generation Instructions

Since this is a terminal environment, here are instructions to create the icons:

## Option 1: Use the HTML Generator

1. Open `generate-icons.html` in a web browser
2. Right-click each canvas image
3. Save as `icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`
4. Place them in the `icons/` directory

## Option 2: Use Online Tools

Visit any icon generator website and create simple icons with:
- Background: Discord blurple (#5865F2)
- Text/Symbol: White "A→B" or translation symbol
- Sizes: 16x16, 32x32, 48x48, 128x128

## Option 3: Use ImageMagick (Command Line)

```bash
cd icons/

# Create simple colored squares as placeholders
convert -size 16x16 xc:#5865F2 -fill white -pointsize 8 -gravity center -annotate +0+0 'A→B' icon16.png
convert -size 32x32 xc:#5865F2 -fill white -pointsize 16 -gravity center -annotate +0+0 'A→B' icon32.png
convert -size 48x48 xc:#5865F2 -fill white -pointsize 24 -gravity center -annotate +0+0 'A→B' icon48.png
convert -size 128x128 xc:#5865F2 -fill white -pointsize 64 -gravity center -annotate +0+0 'A→B' icon128.png
```

## Option 4: Use Design Software

Use Figma, GIMP, Photoshop, or any image editor to create icons with:
- Canvas sizes: 16x16, 32x32, 48x48, 128x128 pixels
- Background color: #5865F2 (Discord blurple)
- Icon: White translation symbol or letters "A→B"
- Export as PNG files

## Temporary Placeholder Icons

For quick testing, you can use solid color icons:
- The extension will work without proper icons
- Chrome will show a default placeholder
- Add proper icons before publishing
