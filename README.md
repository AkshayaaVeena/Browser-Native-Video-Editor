GPU Video Editor

A browser-based video editor with WebGL-accelerated effects, multi-media composition, AI-assisted cutting, and offline frame-accurate export.

Files

video-editor.html → Main application (open directly in browser)
GpuProcessor.js → WebGL effect pipeline (brightness, contrast, blur, etc.)
magic-cut.js → Scene detection and silence-based cut suggestions
multi-media.js → Timeline composition engine for video and images
styles.css → UI styling (neon theme)
backend-server.js → Optional Express server for local development

Quick Start

Option A: Direct usage (no setup required)
Open video-editor.html in Chrome or Firefox.

Option B: Local server

npm install express dotenv
node backend-server.js

Then open:
http://localhost:3001

Features

Media handling

Multi-clip timeline supporting video and images
Composition modes: Sequential, Overlay, Split (grid)
Drag-to-reposition clips and trim handles
Undo/redo support (up to 50 steps)

Color and filters

Brightness, contrast, saturation, blur, sharpen
Hue shift, vibrance, vignette, exposure, temperature
Grayscale, sepia, invert
Preset color styles

Transitions

Fade, zoom, slide, blur between clips
Adjustable duration per transition

Audio

Background audio support
Volume and start offset control
Synchronized playback during preview and export

Text overlays

Position-based text layers (top, center, bottom)
Controls for timing, size, color, and duration

AI-assisted editing (Magic Cut)

Detects high-interest frames and silent segments
Suggests automatic cut points
Adaptive sampling for longer videos

Export

Frame-accurate offline rendering at 30 fps
Pre-decoded audio to avoid sync drift
WebM output (VP9/Opus where supported)
Cancel export without partial file output

Project management

IndexedDB storage for media files
Compressed project JSON storage
Auto-save with multiple recovery slots
Missing file detection on reload

Keyboard shortcuts

Space: Play / Pause
I: Set in point
O: Set out point
Delete / Backspace: Remove selected clip
Ctrl+Z: Undo
Ctrl+Y / Ctrl+Shift+Z: Redo

Browser support

Chrome 94+ fully supported
Firefox 90+ fully supported
Edge 94+ fully supported
Safari 15+ supported (WebGL-specific handling included)
Mobile browsers supported with touch optimization

WebGL is required for GPU effects. If unavailable, the editor falls back to Canvas 2D.

Known limitations

Output format is WebM; MP4 requires external conversion via FFmpeg
Long exports may hit browser memory limits (recommended to split large projects)
Projects are stored locally in the browser; clearing storage will remove them
Older Safari versions do not support MediaRecorder (requires Safari 15+)
