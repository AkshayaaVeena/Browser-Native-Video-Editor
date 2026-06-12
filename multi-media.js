// media-composer.js - FIXED VERSION
// Handles multiple videos, images, and composition with proper optimization

class MediaComposer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx || canvas.getContext('2d');
    this.items = [];
    this.mediaItems = this.items; // Alias for compatibility
    this.selectedItem = null;
    this.compositionMode = 'sequential';
    this.lastSeekTimes = {}; // Track last seek time per item to avoid excessive seeking
    this.activeVideoIds = new Set();
  }

  // Add video to composition with proper cleanup
  addVideo(file, startTime = 0) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      
      const handleMetadata = () => {
        video.removeEventListener('error', handleError);
        const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0;
        const item = {
          id: `video-${Date.now()}-${Math.random()}`,
          type: 'video',
          file: file,
          url: url,
          element: video,
          video: video,
          startTime: startTime,
          duration: sourceDuration,
          sourceDuration,
          trimStart: 0,
          properties: {
            opacity: 1,
            scale: 1,
            rotation: 0,
            x: 0,
            y: 0,
            speed: 1,
            blendMode: 'source-over'
          }
        };
        
        this.items.push(item);
        this.lastSeekTimes[item.id] = -999; // Initialize seek tracker
        console.log('✅ Video added:', item.id);
        resolve(item);
      };

      const handleError = (err) => {
        URL.revokeObjectURL(url); // CRITICAL: Clean up on error
        video.removeEventListener('loadedmetadata', handleMetadata);
        video.removeEventListener('error', handleError);
        video.removeAttribute('src');
        reject(new Error('Failed to load video'));
      };

      video.addEventListener('loadedmetadata', handleMetadata, { once: true });
      video.addEventListener('error', handleError, { once: true });
      video.src = url;
    });
  }

  // Add image to composition with proper cleanup
  addImage(file, startTime = 0, duration = 5) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      const handleImageLoad = () => {
        img.removeEventListener('error', handleImageError);
        const item = {
          id: `image-${Date.now()}-${Math.random()}`,
          type: 'image',
          file: file,
          url: url,
          element: img,
          image: img,
          startTime: startTime,
          duration: duration,
          sourceDuration: duration,
          trimStart: 0,
          properties: {
            opacity: 1,
            scale: 1,
            rotation: 0,
            x: 0,
            y: 0,
            blendMode: 'source-over'
          }
        };

        this.items.push(item);
        console.log('✅ Image added:', item.id);
        resolve(item);
      };

      const handleImageError = () => {
        URL.revokeObjectURL(url);
        img.removeEventListener('load', handleImageLoad);
        img.removeEventListener('error', handleImageError);
        img.removeAttribute('src');
        reject(new Error('Failed to load image'));
      };

      img.addEventListener('load', handleImageLoad, { once: true });
      img.addEventListener('error', handleImageError, { once: true });
      img.src = url;
    });
  }

  disposeMediaItem(item) {
    if (!item) return;

    if (item.element && item.type === 'video') {
      try {
        item.element.pause();
        item.element.removeAttribute('src');
        item.element.load();
      } catch (error) {
        console.warn('Video disposal failed:', error);
      }
    } else if (item.element && item.type === 'image') {
      item.element.removeAttribute('src');
    }

    if (item.url) {
      URL.revokeObjectURL(item.url);
      item.url = null;
    }
    item.element = null;
    item.video = null;
    item.image = null;
  }

  // Remove media item safely
  removeMedia(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      const item = this.items[index];
      this.disposeMediaItem(item);
      delete this.lastSeekTimes[id];
      this.activeVideoIds.delete(id);
      this.items.splice(index, 1);
      if (this.selectedItem === id) this.selectedItem = null;
      return true;
    }
    return false;
  }

  // Update media properties
  updateMedia(id, properties) {
    const item = this.items.find(item => item.id === id);
    if (item) {
      item.properties = { ...item.properties, ...properties };
      return true;
    }
    return false;
  }

  getTimelineEnd() {
    if (this.items.length === 0) return 0;
    return Math.max(...this.items.map(item => item.startTime + item.duration));
  }

  // Get total composition duration
  getTotalDuration() {
    if (this.items.length === 0) return 0;

    if (this.compositionMode === 'sequential') {
      return this.items.reduce((sum, item) => sum + item.duration, 0);
    }

    return this.getTimelineEnd();
  }

  getItemById(id) {
    return this.items.find(item => item.id === id) || null;
  }

  getSortedItems() {
    return [...this.items].sort((a, b) => a.startTime - b.startTime);
  }

  getAdjacentPairs(gapTolerance = 0.05) {
    const sorted = this.getSortedItems();
    const pairs = [];

    for (let i = 0; i < sorted.length - 1; i++) {
      const from = sorted[i];
      const to = sorted[i + 1];
      const boundary = from.startTime + from.duration;
      if (Math.abs(to.startTime - boundary) <= gapTolerance) {
        pairs.push({ from, to, boundary });
      }
    }

    return pairs;
  }

  renderOnlyItem(item, compositionTime, targetCtx = this.ctx) {
    if (!item || !targetCtx) return false;

    targetCtx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    targetCtx.fillStyle = '#000000';
    targetCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const itemTime = Math.max(0, Math.min(compositionTime - item.startTime, item.duration - 0.001));

    if (item.type === 'video' && item.element) {
      this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime));
    }

    const savedCtx = this.ctx;
    this.ctx = targetCtx;
    const drew = this.drawMedia(item, itemTime);
    this.ctx = savedCtx;
    return drew;
  }

  moveItem(id, newStartTime) {
    const item = this.getItemById(id);
    if (!item) return false;
    const prev = item.startTime;
    item.startTime = Math.max(0, newStartTime);
    // Only switch away from sequential if the position actually changed,
    // indicating the user deliberately placed the clip at a non-sequential slot.
    if (this.compositionMode === 'sequential' && item.startTime !== prev) {
      this.compositionMode = 'overlay';
    }
    return true;
  }

  trimItemStart(id, deltaSeconds) {
    const item = this.getItemById(id);
    if (!item || !Number.isFinite(deltaSeconds)) return false;

    const minDuration = 0.1;
    const maxTrim = Math.max(0, item.duration - minDuration);
    const appliedDelta = Math.max(-item.trimStart, Math.min(deltaSeconds, maxTrim));

    if (appliedDelta === 0) return false;

    item.trimStart = (item.trimStart || 0) + appliedDelta;
    item.startTime = Math.max(0, item.startTime + appliedDelta);
    item.duration = Math.max(minDuration, item.duration - appliedDelta);

    if (item.type === 'video' && item.sourceDuration) {
      const maxTrimStart = Math.max(0, item.sourceDuration - minDuration);
      item.trimStart = Math.min(item.trimStart, maxTrimStart);
    }

    if (this.compositionMode === 'sequential') {
      this.compositionMode = 'overlay';
    }
    return true;
  }

  trimItemEnd(id, deltaSeconds) {
    const item = this.getItemById(id);
    if (!item || !Number.isFinite(deltaSeconds)) return false;

    const minDuration = 0.1;
    // FIX: use sourceDuration as the max expandable size so dragging right
    // can grow the clip back up to its original full length.
    const maxDuration = item.sourceDuration
      ? Math.max(0, item.sourceDuration - (item.trimStart || 0))
      : item.duration;

    // deltaSeconds > 0 means right handle dragged left (shrink).
    // deltaSeconds < 0 means right handle dragged right (expand).
    const newDuration = Math.min(maxDuration, Math.max(minDuration, item.duration - deltaSeconds));
    item.duration = newDuration;

    if (this.compositionMode === 'sequential') {
      this.compositionMode = 'overlay';
    }
    return true;
  }

  getSourceTime(item, timelineOffset) {
    return (item.trimStart || 0) + timelineOffset * (item.properties.speed || 1);
  }

  // Main render method
  renderFrame(currentTime) {
    if (!this.hasDrawableMediaAt(currentTime)) {
      this.activateVideosAt(currentTime);
      return false;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    let drewFrame = false;

    if (this.compositionMode === 'sequential') {
      drewFrame = this.renderSequential(currentTime);
    } else if (this.compositionMode === 'overlay') {
      drewFrame = this.renderOverlay(currentTime);
    } else if (this.compositionMode === 'split') {
      drewFrame = this.renderSplit(currentTime);
    }

    return drewFrame;
  }

  activateVideosAt(currentTime) {
    if (this.compositionMode === 'sequential') {
      let timeOffset = 0;
      for (const item of this.items) {
        const itemStartTime = timeOffset;
        const itemEndTime = timeOffset + item.duration;
        if (currentTime >= itemStartTime && currentTime < itemEndTime && item.type === 'video') {
          const itemTime = currentTime - itemStartTime;
          this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime));
        }
        timeOffset = itemEndTime;
      }
      return;
    }

    this.items.forEach(item => {
      if (item.type !== 'video' || !this.isItemActive(item, currentTime)) return;
      const itemTime = currentTime - item.startTime;
      this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime));
    });
  }

  hasDrawableMediaAt(currentTime) {
    return this.items.some(item => {
      if (!this.isItemActive(item, currentTime)) return false;
      if (item.type === 'image') return item.element && item.element.complete;
      return item.element && item.element.readyState >= 2;
    });
  }

  isItemActive(item, currentTime) {
    if (this.compositionMode !== 'sequential') {
      return currentTime >= item.startTime && currentTime < item.startTime + item.duration;
    }

    let timeOffset = 0;
    for (const candidate of this.items) {
      const itemStartTime = timeOffset;
      const itemEndTime = timeOffset + candidate.duration;
      if (candidate.id === item.id) {
        return currentTime >= itemStartTime && currentTime < itemEndTime;
      }
      timeOffset = itemEndTime;
    }

    return false;
  }

  syncVideoForPlayback(item, targetTime) {
    const video = item.element;
    if (!video) return;

    video.muted = true;
    video.playsInline = true;
    video.playbackRate = item.properties.speed || 1;

    const wasInactive = !this.activeVideoIds.has(item.id);
    const drift = Math.abs(video.currentTime - targetTime);

    if (wasInactive || drift > 0.5) {
      video.currentTime = targetTime;
      this.lastSeekTimes[item.id] = targetTime;
    }

    this.activeVideoIds.add(item.id);

    if (video.paused) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    }
  }

  pauseInactiveVideos(activeIds) {
    this.items.forEach(item => {
      if (item.type !== 'video' || !item.element || activeIds.has(item.id)) return;
      item.element.pause();
      this.activeVideoIds.delete(item.id);
    });
  }

  stopPlayback() {
    this.items.forEach(item => {
      if (item.type === 'video' && item.element) {
        item.element.pause();
      }
    });
    this.activeVideoIds.clear();
  }

  // Sequential mode: videos play one after another
  renderSequential(currentTime) {
    let timeOffset = 0;
    let drewFrame = false;
    const activeIds = new Set();

    for (const item of this.items) {
      const itemStartTime = timeOffset;
      const itemEndTime = timeOffset + item.duration;

      if (currentTime >= itemStartTime && currentTime < itemEndTime) {
        const itemTime = currentTime - itemStartTime;
        
        if (item.type === 'video' && item.element) {
          const targetTime = this.getSourceTime(item, itemTime);
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, targetTime);
          drewFrame = this.drawMedia(item, itemTime) || drewFrame;
        } else if (item.type === 'image' && item.element) {
          drewFrame = this.drawMedia(item, itemTime) || drewFrame;
        }
      }
      timeOffset = itemEndTime;
    }

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  // Overlay mode: all items play simultaneously
  renderOverlay(currentTime) {
    const sortedItems = [...this.items].sort((a, b) => a.startTime - b.startTime);
    let drewFrame = false;
    const activeIds = new Set();

    for (const item of sortedItems) {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video' && item.element) {
          const targetTime = this.getSourceTime(item, itemTime);
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, targetTime);
        }
        drewFrame = this.drawMedia(item, itemTime) || drewFrame;
      }
    }

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  // Split mode: grid layout
  renderSplit(currentTime) {
    if (this.items.length === 0) return;
    
    const cols = Math.ceil(Math.sqrt(this.items.length));
    const rows = Math.ceil(this.items.length / cols);
    const cellWidth = this.canvas.width / cols;
    const cellHeight = this.canvas.height / rows;
    let drewFrame = false;
    const activeIds = new Set();

    this.items.forEach((item, index) => {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video' && item.element) {
          const targetTime = this.getSourceTime(item, itemTime);
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, targetTime);
        }

        const row = Math.floor(index / cols);
        const col = index % cols;
        const gridX = col * cellWidth;
        const gridY = row * cellHeight;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(gridX, gridY, cellWidth, cellHeight);
        this.ctx.clip();

        const prevX = item.properties.x;
        const prevY = item.properties.y;
        item.properties.x = gridX + prevX;
        item.properties.y = gridY + prevY;
        
        drewFrame = this.drawMedia(item, itemTime) || drewFrame;
        
        item.properties.x = prevX;
        item.properties.y = prevY;
        this.ctx.restore();

        this.ctx.strokeStyle = 'rgba(255, 0, 110, 0.4)';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(gridX, gridY, cellWidth, cellHeight);
      }
    });

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  // Draw media with transformations
  drawMedia(item, time) {
    if (!item || !item.element) return false;
    
    const props = item.properties;
    this.ctx.save();
    
    this.ctx.globalAlpha = props.opacity !== undefined ? props.opacity : 1;
    this.ctx.globalCompositeOperation = props.blendMode || 'source-over';
    
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    this.ctx.translate(centerX + (props.x || 0), centerY + (props.y || 0));
    if (props.rotation) {
      this.ctx.rotate((props.rotation * Math.PI) / 180);
    }
    this.ctx.scale(props.scale || 1, props.scale || 1);
    this.ctx.translate(-centerX, -centerY);

    // Draw video
    if (item.type === 'video' && item.element.readyState >= 2) {
      const w = item.element.videoWidth || this.canvas.width;
      const h = item.element.videoHeight || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      
      const displayWidth = w * scale;
      const displayHeight = h * scale;
      const x = (this.canvas.width - displayWidth) / 2;
      const y = (this.canvas.height - displayHeight) / 2;
      
      try {
        this.ctx.drawImage(item.element, x, y, displayWidth, displayHeight);
        this.ctx.restore();
        return true;
      } catch (e) {
        console.warn('Draw error:', e);
      }
    }
    // Draw image
    else if (item.type === 'image' && item.element && item.element.complete) {
      const w = item.element.width || this.canvas.width;
      const h = item.element.height || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      
      const displayWidth = w * scale;
      const displayHeight = h * scale;
      const x = (this.canvas.width - displayWidth) / 2;
      const y = (this.canvas.height - displayHeight) / 2;
      
      try {
        this.ctx.drawImage(item.element, x, y, displayWidth, displayHeight);
        this.ctx.restore();
        return true;
      } catch (e) {
        console.warn('Draw error:', e);
      }
    }

    this.ctx.restore();
    return false;
  }

  // Set composition mode
  setCompositionMode(mode) {
    const unifiedMode = mode.toLowerCase();
    if (['sequential', 'overlay', 'split'].includes(unifiedMode)) {
      this.compositionMode = unifiedMode;
      console.log('✅ Composition mode:', unifiedMode);
      return true;
    }
    return false;
  }

  // Get composition info
  getCompositionInfo() {
    return {
      mode: this.compositionMode,
      itemCount: this.items.length,
      totalDuration: this.getTotalDuration(),
      items: this.items.map(item => ({
        id: item.id,
        type: item.type,
        file: item.file?.name || 'unknown',
        startTime: item.startTime,
        duration: item.duration,
        properties: item.properties
      }))
    };
  }

  // Export metadata
  exportMetadata() {
    return {
      version: '1.0',
      mode: this.compositionMode,
      canvas: { width: this.canvas.width, height: this.canvas.height },
      items: this.items.map(item => ({
        type: item.type,
        fileName: item.file?.name || 'unknown',
        startTime: item.startTime,
        duration: item.duration,
        properties: item.properties
      })),
      createdAt: new Date().toISOString()
    };
  }

  // Clear all media safely
  clearAll() {
    this.items.forEach(item => {
      this.disposeMediaItem(item);
    });
    this.items = [];
    this.mediaItems = this.items;
    this.selectedItem = null;
    this.lastSeekTimes = {};
    this.activeVideoIds.clear();
    console.log('✅ All media cleared');
  }

  // Get all items
  getMediaItems() {
    return this.items;
  }
}