const videoFile = document.getElementById("videoFile");
    const video = document.getElementById("video");
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('2d');
    const frameCanvas = document.createElement('canvas');
    const frameCtx = frameCanvas.getContext('2d');

    videoFile.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      video.src = url;
      console.log('Video loaded:', file.name);

      video.addEventListener('loadedmetadata', () => {
        canvas.width = video.videoWidth || canvas.width;
        canvas.height = video.videoHeight || canvas.height;
        frameCanvas.width = video.videoWidth;
        frameCanvas.height = video.videoHeight;
        console.log('Canvas resized to', canvas.width, 'x', canvas.height);
      }, { once: true });
    });

    let originalFrame = null;
    let gpu = null;

    function extractFrame() {
      if (!video.src) {
        alert('Please load a video first');
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      originalFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);

      if (!gpu) {
        gpu = new GPUProcessor(document.createElement('canvas'));
        gpu.canvas.width = canvas.width;
        gpu.canvas.height = canvas.height;
        console.log('GPU Processor created');
      }
      console.log('Frame extracted at', video.currentTime.toFixed(2), 's');
    }

    function applyBrightness(value) {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const brightFrame = gpu.brightness(originalFrame, value);
      renderFrame(brightFrame);
    }

    function resetFrame() {
      if (!originalFrame) { alert('No frame to reset'); return; }
      renderFrame(originalFrame);
    }

    function applyGrayscale() {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const grayFrame = gpu.grayscale(originalFrame);
      renderFrame(grayFrame);
    }

    function applyContrast(value) {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const contrastFrame = gpu.contrast(originalFrame, value);
      renderFrame(contrastFrame);
    }

    function applyInvert() {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const invertFrame = gpu.invert(originalFrame); 
      renderFrame(invertFrame);
    }

    function applySepia() {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const sepiaFrame = gpu.sepia(originalFrame);
      renderFrame(sepiaFrame);
    }

    function applySaturation(value) {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const satFrame = gpu.saturation(originalFrame, value);
      renderFrame(satFrame);
    }

    let playLoop = null;

    function getVideoFrame() {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
        return tempCtx.getImageData(0, 0, canvas.width, canvas.height);
}

let animationId = null;

function startRealTimePreview(effectType) {
  const previewGpu = new GPUProcessor(canvas);
  canvas.width = video.videoWidth || canvas.width;
  canvas.height = video.videoHeight || canvas.height;
  video.play();

  function render() {
    if (video.paused || video.ended) {
      cancelAnimationFrame(animationId);
      return;
    }

    if (effectType === "brightness") {
      previewGpu.renderVideoFrame(video, `
        precision mediump float;
        uniform sampler2D image;
        varying vec2 texCoord;
        void main() {
          vec4 color = texture2D(image, texCoord);
          gl_FragColor = color * 1.5;
        }
      `);
    }
    else if (effectType === "grayscale") {
      previewGpu.renderVideoFrame(video, `
        precision mediump float;
        uniform sampler2D image;
        varying vec2 texCoord;
        void main() {
          vec4 color = texture2D(image, texCoord);
          float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
          gl_FragColor = vec4(vec3(gray), 1.0);
        }
      `);
    }
    animationId = requestAnimationFrame(render);
  }
  render();
}

  function stopPlayback() {
    video.pause();
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
}

    function renderFrame(imageData) {
     ctx.putImageData(imageData, 0, 0);
    }

    function exportFrame() {
      if (!originalFrame) { alert('Extract frame first'); return; }
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = originalFrame.width;
      tempCanvas.height = originalFrame.height;
      const tempCtx = tempCanvas.getContext('2d');
      tempCtx.putImageData(originalFrame, 0, 0);

      tempCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `frame-${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
        console.log('Frame exported');
      }, 'image/png');
    }

   let timelineEffects = [];
   let selectedEffectIndex = null;
   let isPlayingTimeline = false;
   let timelinePlaybackId = null;

   const effectPresets = {
    cinematic: {
    contrast: 1.3,
    saturation: 0.9,
    temperature: 0.3,
    exposure: 0.9
  },
    vibrant: {
    saturation: 1.8,
    vibrance: 0.5,
    exposure: 1.1,
    contrast: 1.2
  },
  goldenHour: {
    temperature: 0.8,
    exposure: 1.2,
    vignette: 0.4,
    saturation: 1.3
  },
  coolMoody: {
    temperature: -0.6,
    exposure: 0.8,
    contrast: 1.4,
    vibrance: -0.2
  },
  instagram: {
    saturation: 1.5,
    contrast: 1.2,
    vignette: 0.2,
    exposure: 1.05
  },
  youTube: {
    contrast: 1.3,
    saturation: 1.1,
    temperature: 0.2,
    exposure: 1.05
  }
};

  function addEffectToTimeline(effectType) {
    if (!video.src) {
        alert('Load a video first');
        return;
    }

  const effect = {
    type: effectType,
    trackId :1,
    keyframes: [
    { time: 0, value: 1.0 },
    { time: 5, value: 1.5 },
    { time: 10, value: 1.2 }
  ],
    id: Date.now()
  };
  timelineEffects.push(effect);
  console.log('Effect added:', effect);
  renderTimeline();
}

function addKeyframe(effectIndex, time, value) {
  if (selectedEffectIndex === null) return;
  const effect = timelineEffects[effectIndex];
  effect.keyframes = effect.keyframes || [];
  const existing = effect.keyframes.find(k => k.time === time);
  if (existing) {
    existing.value = value;
  } else {
    effect.keyframes.push({ time, value });
    effect.keyframes.sort((a, b) => a.time - b.time);
  }  
  console.log('Keyframe added at', time, 's');
  renderTimeline();
}

  let effectTracks = [
  { id: 1, name: 'Track 1', color: '#9d4edd' },
  { id: 2, name: 'Track 2', color: '#ff006e' }
];
  let currentTrack = 1;

  function addEffectTrack() {
    const newId = Math.max(...effectTracks.map(t => t.id)) + 1;
    const colors = ['#9d4edd', '#ff006e', '#00d9ff', '#ffc300', '#00ff6f'];
    effectTracks.push({
    id: newId,
    name: `Track ${newId}`,
    color: colors[effectTracks.length % colors.length]
  });
  renderEffectTracks();
}

  function renderEffectTracks() {
    const container = document.getElementById('effectTracks');
    container.innerHTML = '';
    effectTracks.forEach(track => {
        const trackDiv = document.createElement('div');
        trackDiv.style.cssText = `
        padding: 10px;
        margin: 5px 0;
        background: ${track.color}20;
        border-left: 3px solid ${track.color};
        border-radius: 5px;
        cursor: pointer;
    `;
    trackDiv.textContent = track.name;
    trackDiv.onclick = () => {
      currentTrack = track.id;
      console.log('Selected track:', track.id);
    };   
    container.appendChild(trackDiv);
  });
}
renderEffectTracks();

function interpolateEffectValue(effect, currentTime) {
  if (!effect.keyframes || effect.keyframes.length === 0) {
    return effect.value || 1.0;
  }
  const keyframes = effect.keyframes;
  let before = keyframes[0];
  let after = keyframes[keyframes.length - 1];
  for (let i = 0; i < keyframes.length; i++) {
    if (keyframes[i].time <= currentTime) before = keyframes[i];
    if (keyframes[i].time >= currentTime && !after) after = keyframes[i];
  }
  if (before.time === after.time) return before.value;
  const t = (currentTime - before.time) / (after.time - before.time);
  return before.value + (after.value - before.value) * t;
}

function renderTimeline() {
  const container = document.getElementById('effectBlocks');
  const track = document.getElementById('timelineTrack');
  const duration = video.duration || 60;
  container.innerHTML = '';
  timelineEffects.forEach((effect, index) => {
    const start = effect.start !== undefined ? effect.start : 0;
    const end = effect.end !== undefined ? effect.end : 10;
    const startPercent = (start / duration) * 100;
    const widthPercent = ((end - start) / duration) * 100;
    const block = document.createElement('div');
    block.style.cssText = `
      position: absolute;
      left: ${startPercent}%;
      width: ${widthPercent}%;
      height: 60px;
      background: linear-gradient(135deg, #9d4edd 0%, #ff006e 100%);
      border: 2px solid #fff;
      border-radius: 5px;
      cursor: grab;
      top: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 0.8em;
      font-weight: 600;
      z-index: 5;
      user-select: none;
    `;

    block.textContent = `${effect.type} (${start.toFixed(1)}s-${end.toFixed(1)}s)`;
    block.onclick = (e) => {
      e.stopPropagation();
      selectEffect(index);
    };
    let isDragging = false;
    let dragStart = 0;
    let dragType = 'move';
    block.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      isDragging = true;
      dragStart = e.clientX;
      const rect = block.getBoundingClientRect();
      const blockStart = rect.left;
      const blockEnd = rect.right;
      const threshold = 10;
      if (Math.abs(e.clientX - blockStart) < threshold) {
        dragType = 'resizeStart';
        block.style.cursor = 'ew-resize';
      } else if (Math.abs(e.clientX - blockEnd) < threshold) {
        dragType = 'resizeEnd';
        block.style.cursor = 'ew-resize';
      } else {
        dragType = 'move';
        block.style.cursor = 'grabbing';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const trackRect = track.getBoundingClientRect();
      const moveDistance = e.clientX - dragStart;
      const movePercent = (moveDistance / trackRect.width) * 100;
      const moveSeconds = (movePercent / 100) * duration;

      if (dragType === 'move') {
        const newStart = Math.max(0, effect.start + moveSeconds);
        const newEnd = newStart + (effect.end - effect.start);
        if (newEnd <= duration) {
          effect.start = newStart;
          effect.end = newEnd;
        }
      } else if (dragType === 'resizeStart') {
        effect.start = Math.max(0, Math.min(effect.start + moveSeconds, effect.end - 0.5));
      } else if (dragType === 'resizeEnd') {
        effect.end = Math.min(duration, Math.max(effect.end + moveSeconds, effect.start + 0.5));
      }

      dragStart = e.clientX;
      renderTimeline();
    });
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        block.style.cursor = 'grab';
        console.log('Effect moved:', effect);
      }
    });
    container.appendChild(block);
  });
}

  document.addEventListener('DOMContentLoaded', () => {
  const timelineTrack = document.getElementById('timelineTrack');
  if (timelineTrack) {
    timelineTrack.addEventListener('click', (e) => {
      if (!video.src || isPlayingTimeline) return;
      
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percent = clickX / rect.width;
      const duration = video.duration || 60;
      const newTime = percent * duration;
      
      video.currentTime = Math.max(0, Math.min(newTime, video.duration));
      console.log('⏱️ Seeked to', newTime.toFixed(2), 's');
    });
  }
});

  function selectEffect(index) {
  selectedEffectIndex = index;
  const effect = timelineEffects[index];

  document.getElementById('effectStart').value = effect.start;
  document.getElementById('effectStartValue').textContent = effect.start + 's';
  
  document.getElementById('effectEnd').value = effect.end;
  document.getElementById('effectEndValue').textContent = effect.end + 's';
  
  document.getElementById('effectValue').value = effect.value;
  document.getElementById('effectValueDisplay').textContent = effect.value + 'x';

  console.log('Selected effect:', effect);
}
document.getElementById('effectStart').addEventListener('input', (e) => {
  document.getElementById('effectStartValue').textContent = e.target.value + 's';
});

document.getElementById('effectEnd').addEventListener('input', (e) => {
  document.getElementById('effectEndValue').textContent = e.target.value + 's';
});

document.getElementById('effectValue').addEventListener('input', (e) => {
  document.getElementById('effectValueDisplay').textContent = e.target.value + 'x';
});

function updateSelectedEffect() {
  if (selectedEffectIndex === null) {
    alert('Select an effect first');
    return;
  }

  timelineEffects[selectedEffectIndex].start = parseFloat(document.getElementById('effectStart').value);
  timelineEffects[selectedEffectIndex].end = parseFloat(document.getElementById('effectEnd').value);
  timelineEffects[selectedEffectIndex].value = parseFloat(document.getElementById('effectValue').value);
  console.log('Effect updated');
  renderTimeline();
}

function deleteSelectedEffect() {
  if (selectedEffectIndex === null) {
    alert('Select an effect first');
    return;
  }
  timelineEffects.splice(selectedEffectIndex, 1);
  selectedEffectIndex = null;
  console.log('🗑️ Effect deleted');
  renderTimeline();
}

function stopTimeline() {
  video.pause();
  isPlayingTimeline = false;
  if (timelinePlaybackId) {
    cancelAnimationFrame(timelinePlaybackId);
  }
}

function playTimeline() {
  if (!video.src) {
    alert('Load a video first');
    return;
  }
  if (timelineEffects.length === 0) {
    alert('Add effects to timeline first');
    return;
  }
  if (!gpu) {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    gpu = new GPUProcessor(offscreen);
  }
  video.play();
  isPlayingTimeline = true;
  function renderTimelineFrame() {
    if (!isPlayingTimeline || video.paused || video.ended) {
      cancelAnimationFrame(timelinePlaybackId);
      return;
    }
    const currentTime = video.currentTime;
    frameCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let frameData = frameCtx.getImageData(0, 0, canvas.width, canvas.height);

    timelineEffects.forEach(effect => {
      if (currentTime >= effect.start && currentTime <= effect.end) {
        try {
          if (effect.type === 'brightness') {
            frameData = gpu.brightness(frameData, effect.value);
          } else if (effect.type === 'grayscale') {
            frameData = gpu.grayscale(frameData);
          } else if (effect.type === 'contrast') {
            frameData = gpu.contrast(frameData, effect.value);
          } else if (effect.type === 'saturation') {
            frameData = gpu.saturation(frameData, effect.value);
          } else if (effect.type === 'exposure') {
            frameData = gpu.exposure(frameData, effect.value);
          } else if (effect.type === 'sharpen') {
            frameData = gpu.sharpen(frameData, effect.value);
          } else if (effect.type === 'blur') {
            frameData = gpu.blur(frameData, effect.value);
          } else if (effect.type === 'vibrance') {
            frameData = gpu.vibrance(frameData, effect.value);
          } else if (effect.type === 'temperature') {
            frameData = gpu.temperature(frameData, effect.value);
          } else if (effect.type === 'hueShift') {
            frameData = gpu.hueShift(frameData, effect.value);
          } else if (effect.type === 'vignette') {
            frameData = gpu.vignette(frameData, effect.value);
          } else if (effect.type === 'sepia') {
            frameData = gpu.sepia(frameData);
          } else if (effect.type === 'invert') {
            frameData = gpu.invert(frameData);
          }
        } catch (e) {
          console.warn('Effect error:', e);
        }
      }
    });

    ctx.putImageData(frameData, 0, 0);

    const duration = video.duration || 60;
    const playheadPos = (currentTime / duration) * 100;
    document.getElementById('playhead').style.left = playheadPos + '%';
    timelinePlaybackId = requestAnimationFrame(renderTimelineFrame);
  }
  renderTimelineFrame();
}

function addPresetEffect(presetName) {
  if (!video.src) {
    alert('Load a video first');
    return;
  }
  const preset = effectPresets[presetName];
  if (!preset) return;

  Object.keys(preset).forEach(effectType => {
    const value = preset[effectType];
    timelineEffects.push({
      type: effectType,
      start: 0,
      end: 10,
      value: value,
      id: Date.now() + Math.random()
    });
  });

  console.log('Preset added:', presetName);
  renderTimeline();
}
let mediaRecorder = null;
let recordedChunks = [];
let isExporting = false;
let exportStartTime = null;

function startExport() {
  if (!video.src) {
    alert('Load a video first');
    return;
  }
  if (timelineEffects.length === 0) {
    alert('Add effects to timeline first');
    return;
  }

  console.log('Export started');
  recordedChunks = [];
  isExporting = true;
  exportStartTime = Date.now();
  if (!gpu) {
    const offscreen = document.createElement('canvas');
    offscreen.width = canvas.width;
    offscreen.height = canvas.height;
    gpu = new GPUProcessor(offscreen);
  }
  video.currentTime = 0;
  const stream = canvas.captureStream(30);
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 2500000 
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };
  mediaRecorder.start();
  document.getElementById('exportStartBtn').disabled = true;
  document.getElementById('exportStopBtn').disabled = false;
  updateExportStatus('Recording... Playing video with effects applied');
  playExportTimeline();
}

function stopExport() {
  if (!mediaRecorder || !isExporting) {
    alert('Export not in progress');
    return;
  }

  console.log('Stopping export...');
  mediaRecorder.stop();
  isExporting = false;
  mediaRecorder.onstop = () => {
    const duration = ((Date.now() - exportStartTime) / 1000).toFixed(1);
    updateExportStatus(`Processing complete! (${duration}s) Preparing download...`);
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `edited-video-${Date.now()}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    updateExportStatus(`Video downloaded! File: ${link.download}`);
    console.log('Export complete! Video downloaded.');
    document.getElementById('exportStartBtn').disabled = false;
    document.getElementById('exportStopBtn').disabled = true;
    stopTimeline();
  };
}

function playExportTimeline() {
  video.play();
  isPlayingTimeline = true;

  function renderExportFrame() {
    if (!isExporting || video.paused) {
      if (isExporting) {
        timelinePlaybackId = requestAnimationFrame(renderExportFrame);
      }
      return;
    }
    if (video.ended) {
      console.log('Video playback complete');
      stopTimeline();
      return;
    }
    const currentTime = video.currentTime;
    const duration = video.duration || 60;
    frameCtx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let frameData = frameCtx.getImageData(0, 0, canvas.width, canvas.height);
    timelineEffects.forEach(effect => {
      if (currentTime >= effect.start && currentTime <= effect.end) {
        try {
          if (effect.type === 'brightness') {
            frameData = gpu.brightness(frameData, effect.value);
          } else if (effect.type === 'contrast') {
            frameData = gpu.contrast(frameData, effect.value);
          } else if (effect.type === 'saturation') {
            frameData = gpu.saturation(frameData, effect.value);
          } else if (effect.type === 'grayscale') {
            frameData = gpu.grayscale(frameData);
          } else if (effect.type === 'sepia') {
            frameData = gpu.sepia(frameData);
          } else if (effect.type === 'invert') {
            frameData = gpu.invert(frameData);
          }
        } catch (e) {
          console.warn('Effect error:', e);
        }
      }
    });
    ctx.putImageData(frameData, 0, 0);
    const playheadPos = (currentTime / duration) * 100;
    document.getElementById('playhead').style.left = playheadPos + '%';
    const percentComplete = ((currentTime / duration) * 100).toFixed(1);
    updateExportStatus(`Recording... ${percentComplete}% complete (${currentTime.toFixed(1)}s / ${duration.toFixed(1)}s)`);
    timelinePlaybackId = requestAnimationFrame(renderExportFrame);
  }
  renderExportFrame();
}

function updateExportStatus(message) {
  const statusDiv = document.getElementById('exportStatus');
  if (statusDiv) {
    statusDiv.textContent = message;
  }
  console.log(message);
}

function saveProject() {
  if (!video.src) {
    alert('Load a video first');
    return;
  }

  const videoName = video.src.split('/').pop().split('?')[0] || 'video';
  const project = {
    version: '1.0',
    name: `Project - ${new Date().toLocaleString()}`,
    videoFile: videoName,
    videoUrl: video.src,
    canvas: {
      width: canvas.width,
      height: canvas.height
    },
    effects: timelineEffects.map(effect => ({
      type: effect.type,
      start: effect.start,
      end: effect.end,
      value: effect.value,
      id: effect.id
    })),
    metadata: {
      createdAt: new Date().toISOString(),
      videoDuration: video.duration
    }
  };

  const projectJSON = JSON.stringify(project, null, 2);
  const blob = new Blob([projectJSON], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `project-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  updateProjectStatus(`Project saved: ${link.download}`);
  console.log('Project saved', project);
}

function loadProject(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const project = JSON.parse(e.target.result);
      if (!project.effects || !project.videoUrl) {
        alert('Invalid project file');
        return;
      }
      video.src = project.videoUrl;
      console.log('Loading video:', project.videoFile);

      video.addEventListener('loadedmetadata', () => {
        canvas.width = project.canvas.width || video.videoWidth;
        canvas.height = project.canvas.height || video.videoHeight;
        timelineEffects = project.effects;
        selectedEffectIndex = null;
        renderTimeline();

        updateProjectStatus(
          `Project loaded: ${project.effects.length} effects restored`
        );
        console.log('Project loaded!', project);
      }, { once: true });

    } catch (error) {
      alert('Error loading project: ' + error.message);
      console.error('Load error:', error);
    }
  };

  reader.readAsText(file);
}
function newProject() {
  if (confirm('Create new project? (Current effects will be cleared)')) {
    timelineEffects = [];
    selectedEffectIndex = null;
    video.src = '';
    video.pause();
    video.currentTime = 0;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    renderTimeline();
    updateProjectStatus('New project created');
    console.log('New project created');
  }
}
function updateProjectStatus(message) {
  const statusDiv = document.getElementById('projectStatus');
  if (statusDiv) {
    statusDiv.textContent = message;
  }
  console.log(message);
}