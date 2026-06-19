class MediaComposer {
  constructor(canvas, ctx) {
    this.canvas          = canvas;
    this.ctx             = ctx || canvas.getContext('2d');
    this.items           = [];
    this.mediaItems      = this.items; 
    this.selectedItem    = null;
    this.compositionMode = 'sequential';
    this.lastSeekTimes   = {};
    this.activeVideoIds  = new Set();
    this.urlRefCounts    = new Map();
  }

  _retainUrl(url) {
    if (!url) return;
    this.urlRefCounts.set(url, (this.urlRefCounts.get(url) || 0) + 1);
  }

  _releaseUrl(url) {
    if (!url) return;
    const count = (this.urlRefCounts.get(url) || 1) - 1;
    if (count <= 0) {
      this.urlRefCounts.delete(url);
      URL.revokeObjectURL(url);
    } else {
      this.urlRefCounts.set(url, count);
    }
  }

  addVideo(file, startTime = 0) {
    return new Promise((resolve, reject) => {
      const url   = URL.createObjectURL(file);
      const video = document.createElement('video');

      const handleMetadata = () => {
        video.removeEventListener('error', handleError);
        const sourceDuration = Number.isFinite(video.duration) ? video.duration : 0;
        const item = {
          id:              `video-${Date.now()}-${Math.random()}`,
          type:            'video',
          file,
          url,
          element:        video,
          video,
          startTime,
          duration:        sourceDuration,
          sourceDuration,
          trimStart:       0,
          properties: {
            opacity:   1,
            scale:     1,
            rotation:  0,
            x:         0,
            y:         0,
            speed:     1,
            blendMode: 'source-over'
          }
        };
        this.items.push(item);
        this.lastSeekTimes[item.id] = -999;
        this._retainUrl(url);
        console.log('✅ Video added:', item.id);
        resolve(item);
      };

      const handleError = () => {
        URL.revokeObjectURL(url);
        video.removeEventListener('loadedmetadata', handleMetadata);
        video.src = '';
        video.load();
        reject(new Error('Failed to load video'));
      };

      video.addEventListener('loadedmetadata', handleMetadata, { once: true });
      video.addEventListener('error', handleError,            { once: true });
      video.src = url;
    });
  }

  addImage(file, startTime = 0, duration = 5) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      const handleLoad = () => {
        img.removeEventListener('error', handleError);
        const item = {
          id:           `image-${Date.now()}-${Math.random()}`,
          type:         'image',
          file,
          url,
          element:     img,
          image:       img,
          startTime,
          duration,
          sourceDuration: duration,
          trimStart:   0,
          properties: {
            opacity:   1,
            scale:     1,
            rotation:  0,
            x:         0,
            y:         0,
            blendMode: 'source-over'
          }
        };
        this.items.push(item);
        this._retainUrl(url);
        console.log('✅ Image added:', item.id);
        resolve(item);
      };

      const handleError = () => {
        URL.revokeObjectURL(url);
        img.removeEventListener('load', handleLoad);
        img.src = '';
        reject(new Error('Failed to load image'));
      };

      img.addEventListener('load',  handleLoad,  { once: true });
      img.addEventListener('error', handleError, { once: true });
      img.src = url;
    });
  }

  disposeMediaItem(item) {
    if (!item) return;

    if (item.type === 'video' && item.element) {
      try {
        item.element.pause();
        item.element.src = '';   
        item.element.load();     
      } catch(e) {
        console.warn('Video disposal error:', e);
      }
    } else if (item.type === 'image' && item.element) {
      item.element.src = '';     
    }

    if (item.url) {
      this._releaseUrl(item.url); 
      item.url = null;
    }

    item.element = null;
    item.video   = null;
    item.image   = null;
  }

  removeMedia(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      this.disposeMediaItem(this.items[index]);
      delete this.lastSeekTimes[id];
      this.activeVideoIds.delete(id);
      this.items.splice(index, 1);
      if (this.selectedItem === id) this.selectedItem = null;
      return true;
    }
    return false;
  }

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
    const pairs  = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const from     = sorted[i];
      const to       = sorted[i + 1];
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
      this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime), false);
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
    if (this.compositionMode === 'sequential' && item.startTime !== prev) {
      this.compositionMode = 'overlay';
    }
    return true;
  }

  trimItemStart(id, deltaSeconds) {
    const item = this.getItemById(id);
    if (!item || !Number.isFinite(deltaSeconds)) return false;

    const minDuration  = 0.1;
    const maxTrim      = Math.max(0, item.duration - minDuration);
    const appliedDelta = Math.max(-item.trimStart, Math.min(deltaSeconds, maxTrim));
    if (appliedDelta === 0) return false;

    item.trimStart  = (item.trimStart || 0) + appliedDelta;
    item.startTime  = Math.max(0, item.startTime + appliedDelta);
    item.duration   = Math.max(minDuration, item.duration - appliedDelta);

    if (item.type === 'video' && item.sourceDuration) {
      const maxTrimStart = Math.max(0, item.sourceDuration - minDuration);
      item.trimStart = Math.min(item.trimStart, maxTrimStart);
    }

    if (this.compositionMode === 'sequential') this.compositionMode = 'overlay';
    return true;
  }

  trimItemEnd(id, deltaSeconds) {
    const item = this.getItemById(id);
    if (!item || !Number.isFinite(deltaSeconds)) return false;

    const minDuration  = 0.1;
    const maxDuration  = item.sourceDuration
      ? Math.max(0, item.sourceDuration - (item.trimStart || 0))
      : item.duration;

    const newDuration  = Math.min(maxDuration, Math.max(minDuration, item.duration - deltaSeconds));
    item.duration = newDuration;

    if (this.compositionMode === 'sequential') this.compositionMode = 'overlay';
    return true;
  }

  getSourceTime(item, timelineOffset) {
    return (item.trimStart || 0) + timelineOffset * (item.properties.speed || 1);
  }

  splitItemAt(id, timelineTime) {
    const item = this.getItemById(id);
    if (!item) return null;

    const minPiece = 0.1; 
    const offsetIntoItem = timelineTime - item.startTime;

    if (offsetIntoItem <= minPiece || offsetIntoItem >= item.duration - minPiece) {
      return null; 
    }

    const speed = item.properties.speed || 1;
    const rightDuration = item.duration - offsetIntoItem;
    const sourceOffsetConsumed = offsetIntoItem * speed;

    const rightItem = {
      ...item,
      id:          `${item.type}-${Date.now()}-${Math.random()}`,
      startTime:  item.startTime + offsetIntoItem,
      duration:   rightDuration,
      trimStart:  (item.trimStart || 0) + sourceOffsetConsumed,
      properties: { ...item.properties }
    };

    item.duration = offsetIntoItem;

    const insertIndex = this.items.indexOf(item);
    this.items.splice(insertIndex + 1, 0, rightItem);
    this._retainUrl(rightItem.url); 

    if (this.compositionMode === 'sequential') this.compositionMode = 'overlay';

    console.log('✂️ Split clip at', timelineTime.toFixed(2), 's →', item.id, '+', rightItem.id);
    return { left: item, right: rightItem };
  }

  cutRange(id, rangeStart, rangeEnd) {
    const item = this.getItemById(id);
    if (!item) return null;

    const itemEnd = item.startTime + item.duration;
    const start = Math.max(item.startTime, rangeStart);
    const end   = Math.min(itemEnd, rangeEnd);
    const cutDuration = end - start;
    if (cutDuration <= 0.01) return null;

    const speed = item.properties.speed || 1;
    const offsetIntoItemStart = start - item.startTime;
    const offsetIntoItemEnd   = end - item.startTime;

    const clipboardTrimStart = (item.trimStart || 0) + offsetIntoItemStart * speed;
    const clipboard = {
      type:            item.type,
      file:            item.file,
      url:             item.url,
      sourceDuration: item.sourceDuration,
      trimStart:       clipboardTrimStart,
      duration:        cutDuration,
      properties:      { ...item.properties },
      cutAt:           Date.now()
    };
    this._retainUrl(clipboard.url);

    const hasLeftRemainder  = offsetIntoItemStart > 0.01;
    const hasRightRemainder = (item.duration - offsetIntoItemEnd) > 0.01;

    if (hasLeftRemainder && hasRightRemainder) {
      const rightDuration = item.duration - offsetIntoItemEnd;
      const rightTrimStart = (item.trimStart || 0) + offsetIntoItemEnd * speed;
      const rightItem = {
        ...item,
        id:          `${item.type}-${Date.now()}-${Math.random()}`,
        startTime:  start, 
        duration:   rightDuration,
        trimStart:  rightTrimStart,
        properties: { ...item.properties }
      };
      item.duration = offsetIntoItemStart;
      const insertIndex = this.items.indexOf(item);
      this.items.splice(insertIndex + 1, 0, rightItem);
      this._retainUrl(rightItem.url); 
    } else if (hasLeftRemainder) {
      item.duration = offsetIntoItemStart;
    } else if (hasRightRemainder) {
      item.trimStart = (item.trimStart || 0) + offsetIntoItemEnd * speed;
      item.duration   = item.duration - offsetIntoItemEnd;
      item.startTime  = start;
    } else {
      this.removeMedia(item.id);
    }

    this.items.forEach(other => {
      if (other === item) return;
      if (other.startTime >= end - 0.001) {
        other.startTime = Math.max(0, other.startTime - cutDuration);
      }
    });

    console.log('✂️ Cut', cutDuration.toFixed(2), 's from', item.id, '— clipboard ready');
    return clipboard;
  }

  pasteClip(clipboard, targetTime) {
    if (!clipboard) return null;

    const t = Math.max(0, targetTime);

    this.items.forEach(other => {
      if (other.startTime >= t - 0.001) {
        other.startTime += clipboard.duration;
      }
    });

    const newItem = {
      id:              `${clipboard.type}-${Date.now()}-${Math.random()}`,
      type:            clipboard.type,
      file:            clipboard.file,
      url:             clipboard.url,
      element:        null, 
      startTime:      t,
      duration:        clipboard.duration,
      sourceDuration: clipboard.sourceDuration,
      trimStart:       clipboard.trimStart,
      properties:      { ...clipboard.properties }
    };

    if (clipboard.type === 'video') {
      const video = document.createElement('video');
      video.src = clipboard.url;
      video.muted = true;
      video.playsInline = true;
      newItem.element = video;
      newItem.video   = video;
    } else if (clipboard.type === 'image') {
      const img = new Image();
      img.src = clipboard.url;
      newItem.element = img;
      newItem.image   = img;
    }

    let insertIndex = this.items.length;
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].startTime > t) { insertIndex = i; break; }
    }
    this.items.splice(insertIndex, 0, newItem);
    this.lastSeekTimes[newItem.id] = -999;
    this._retainUrl(newItem.url); 
    this._retainUrl(newItem.url); 

    if (this.compositionMode === 'sequential') this.compositionMode = 'overlay';

    console.log('📋 Pasted', clipboard.duration.toFixed(2), 's clip at', t.toFixed(2), 's');
    return newItem;
  }

  discardClipboard(clipboard) {
    if (!clipboard) return;
    this._releaseUrl(clipboard.url);
  }

  renderFrame(currentTime, allowAudio = true) {
    if (!this.hasDrawableMediaAt(currentTime)) {
      this.activateVideosAt(currentTime);
      return false;
    }

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.compositionMode === 'sequential') return this.renderSequential(currentTime, allowAudio);
    if (this.compositionMode === 'overlay')    return this.renderOverlay(currentTime, allowAudio);
    if (this.compositionMode === 'split')      return this.renderSplit(currentTime);
    return false;
  }

  activateVideosAt(currentTime) {
    if (this.compositionMode === 'sequential') {
      let timeOffset = 0;
      for (const item of this.items) {
        const end = timeOffset + item.duration;
        if (currentTime >= timeOffset && currentTime < end && item.type === 'video') {
          this.syncVideoForPlayback(item, this.getSourceTime(item, currentTime - timeOffset), false);
        }
        timeOffset = end;
      }
      return;
    }
    this.items.forEach(item => {
      if (item.type !== 'video' || !this.isItemActive(item, currentTime)) return;
      this.syncVideoForPlayback(item, this.getSourceTime(item, currentTime - item.startTime), false);
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
      const end = timeOffset + candidate.duration;
      if (candidate.id === item.id) {
        return currentTime >= timeOffset && currentTime < end;
      }
      timeOffset = end;
    }
    return false;
  }

  syncVideoForPlayback(item, targetTime, allowAudio = false) {
    const video = item.element;
    if (!video) return;

    video.muted        = !allowAudio;
    video.playsInline  = true;
    video.playbackRate = item.properties.speed || 1;

    const wasInactive = !this.activeVideoIds.has(item.id);
    const drift       = Math.abs(video.currentTime - targetTime);

    if (wasInactive || drift > 0.5) {
      video.currentTime          = targetTime;
      this.lastSeekTimes[item.id] = targetTime;
    }

    this.activeVideoIds.add(item.id);

    if (video.paused) {
      const p = video.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
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
      if (item.type === 'video' && item.element) item.element.pause();
    });
    this.activeVideoIds.clear();
  }

  renderSequential(currentTime, allowAudio = true) {
    let timeOffset = 0;
    let drewFrame  = false;
    const activeIds = new Set();

    for (const item of this.items) {
      const end = timeOffset + item.duration;
      if (currentTime >= timeOffset && currentTime < end) {
        const itemTime = currentTime - timeOffset;
        if (item.type === 'video' && item.element) {
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime), allowAudio);
          drewFrame = this.drawMedia(item, itemTime) || drewFrame;
        } else if (item.type === 'image' && item.element) {
          drewFrame = this.drawMedia(item, itemTime) || drewFrame;
        }
      }
      timeOffset = end;
    }

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  renderOverlay(currentTime, allowAudio = true) {
    const sorted    = [...this.items].sort((a, b) => a.startTime - b.startTime);
    let   drewFrame = false;
    const activeIds = new Set();

    const activeVideoCount = sorted.filter(item =>
      item.type === 'video' && item.element &&
      currentTime >= item.startTime && currentTime < item.startTime + item.duration
    ).length;
    const singleVideoActive = allowAudio && activeVideoCount === 1;

    for (const item of sorted) {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        if (item.type === 'video' && item.element) {
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime), singleVideoActive);
        }
        drewFrame = this.drawMedia(item, itemTime) || drewFrame;
      }
    }

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  renderSplit(currentTime) {
    if (this.items.length === 0) return false;

    const cols       = Math.ceil(Math.sqrt(this.items.length));
    const rows       = Math.ceil(this.items.length / cols);
    const cellWidth  = this.canvas.width  / cols;
    const cellHeight = this.canvas.height / rows;
    let   drewFrame  = false;
    const activeIds  = new Set();

    this.items.forEach((item, index) => {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        if (item.type === 'video' && item.element) {
          activeIds.add(item.id);
          this.syncVideoForPlayback(item, this.getSourceTime(item, itemTime), false);
        }

        const row  = Math.floor(index / cols);
        const col  = index % cols;
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
        this.ctx.lineWidth   = 1.5;
        this.ctx.strokeRect(gridX, gridY, cellWidth, cellHeight);
      }
    });

    this.pauseInactiveVideos(activeIds);
    return drewFrame;
  }

  drawMedia(item, time) {
    if (!item || !item.element) return false;

    const props   = item.properties;
    const centerX = this.canvas.width  / 2;
    const centerY = this.canvas.height / 2;

    this.ctx.save();
    this.ctx.globalAlpha              = props.opacity  !== undefined ? props.opacity  : 1;
    this.ctx.globalCompositeOperation = props.blendMode || 'source-over';
    this.ctx.translate(centerX + (props.x || 0), centerY + (props.y || 0));
    if (props.rotation) this.ctx.rotate((props.rotation * Math.PI) / 180);
    this.ctx.scale(props.scale || 1, props.scale || 1);
    this.ctx.translate(-centerX, -centerY);

    if (item.type === 'video' && item.element.readyState >= 2) {
      const w     = item.element.videoWidth  || this.canvas.width;
      const h     = item.element.videoHeight || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      const dw    = w * scale;
      const dh    = h * scale;
      const x     = (this.canvas.width  - dw) / 2;
      const y     = (this.canvas.height - dh) / 2;
      try {
        this.ctx.drawImage(item.element, x, y, dw, dh);
        this.ctx.restore();
        return true;
      } catch(e) { console.warn('Video draw error:', e); }
    } else if (item.type === 'image' && item.element && item.element.complete) {
      const w     = item.element.width  || this.canvas.width;
      const h     = item.element.height || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      const dw    = w * scale;
      const dh    = h * scale;
      const x     = (this.canvas.width  - dw) / 2;
      const y     = (this.canvas.height - dh) / 2;
      try {
        this.ctx.drawImage(item.element, x, y, dw, dh);
        this.ctx.restore();
        return true;
      } catch(e) { console.warn('Image draw error:', e); }
    }

    this.ctx.restore();
    return false;
  }

  setCompositionMode(mode) {
    const m = mode.toLowerCase();
    if (['sequential', 'overlay', 'split'].includes(m)) {
      this.compositionMode = m;
      console.log('✅ Composition mode:', m);
      return true;
    }
    return false;
  }

  getCompositionInfo() {
    return {
      mode:          this.compositionMode,
      itemCount:     this.items.length,
      totalDuration: this.getTotalDuration(),
      items:         this.items.map(item => ({
        id:         item.id,
        type:       item.type,
        file:       item.file?.name || 'unknown',
        startTime:  item.startTime,
        duration:   item.duration,
        properties: item.properties
      }))
    };
  }

  exportMetadata() {
    return {
      version:   '1.0',
      mode:      this.compositionMode,
      canvas:    { width: this.canvas.width, height: this.canvas.height },
      items:     this.items.map(item => ({
        type:       item.type,
        fileName:   item.file?.name || 'unknown',
        startTime:  item.startTime,
        duration:   item.duration,
        properties: item.properties
      })),
      createdAt: new Date().toISOString()
    };
  }

  clearAll() {
    this.items.forEach(item => this.disposeMediaItem(item));
    this.items          = [];
    this.mediaItems     = this.items;
    this.selectedItem   = null;
    this.lastSeekTimes  = {};
    this.activeVideoIds.clear();
    console.log('All media cleared and disposed');
  }

  getMediaItems() {
    return this.items;
  }
}