# 🎬 GPU Video Editor 

A browser-based video editor with WebGL-accelerated effects, multi-media composition, AI-assisted cutting, and offline frame-accurate export.

---

## Files

| File | Purpose |
|---|---|
| `video-editor.html` | Main app — open this in your browser |
| `GpuProcessor.js` | WebGL effect pipeline (brightness, contrast, blur, etc.) |
| `magic-cut.js` | AI scene detection and silence analysis |
| `multi-media.js` | Timeline composition engine (video + images) |
| `styles.css` | Neon purple theme |
| `backend-server.js` | Optional Express server for local serving |

---

## Quick Start

**Option A — Direct (no server needed)**
Just open `video-editor.html` in Chrome or Firefox. No build step, no install.

**Option B — Local server**
```bash
npm install express dotenv
node backend-server.js
# Open http://localhost:3001
```

---

## Features

### Media
- Add multiple videos and images to a shared timeline
- Three composition modes: **Sequential** (one after another), **Overlay** (simultaneous layers), **Split** (grid view)
- Drag clips to reposition, drag handles to trim start/end
- Undo / redo up to 50 steps (`Ctrl+Z` / `Ctrl+Y`)

### Color & Filters
- Brightness, contrast, saturation, blur, sharpen
- Hue shift, vibrance, vignette, exposure, temperature
- Grayscale, sepia, invert
- Cinematic and Vibrant presets

### Transitions
- Fade, zoom, slide, blur — applied between any two adjacent clips
- Adjustable duration (0.1 – 2 s)

### Audio
- Add a background audio track with per-track volume and start offset
- Audio syncs precisely to the composition during both preview and export

### Text Overlays
- Custom text at top / center / bottom
- Control color, size, start time, and duration

### AI Magic Cut
- Scans video frames to find high-interest moments
- Detects silence regions for automatic cut suggestions
- Adaptive sampling — faster on long videos (up to 5 s interval for 1 hr+ footage)
- Apply detected cut points directly to the timeline

### Export
- Frame-accurate offline render at 30 fps
- Audio pre-decoded before export starts — no drift
- Downloads as `.webm` (VP9 + Opus where supported)
- Cancel mid-export without saving a partial file

### Project Save / Load
- Media files stored in IndexedDB; metadata stored in localStorage
- Project JSON is gzip-compressed and split into 10 MB chunks to handle large projects
- Auto-saves every 30 s, keeping the last 3 auto-save slots
- Warns clearly if any clips are missing on load

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / Pause |
| `I` | Set in point |
| `O` | Set out point |
| `Delete` / `Backspace` | Delete selected clip |
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |

---

## Browser Support

| Browser | Status |
|---|---|
| Chrome 94+ | ✅ Full support |
| Firefox 90+ | ✅ Full support |
| Safari 15+ | ✅ Supported (Safari-specific WebGL quirks handled) |
| Edge 94+ | ✅ Full support |
| Mobile Chrome / Safari | ✅ Touch-optimised (44 px tap targets) |

WebGL is required for GPU effects. If unavailable, the editor falls back to Canvas 2D automatically and shows a notification.

---

## Known Limitations

- Export produces `.webm` — use [FFmpeg](https://ffmpeg.org) to convert to `.mp4` if needed:
  ```bash
  ffmpeg -i composition.webm -c:v libx264 -c:a aac output.mp4
  ```
- Very long exports (30+ min) may hit browser memory limits. Split into segments if needed.
- Project files are stored in the browser — clearing site data will erase saved projects. Back up by re-saving after each session.
- `MediaRecorder` is not available in Safari 14 and below — export requires Safari 15+.
