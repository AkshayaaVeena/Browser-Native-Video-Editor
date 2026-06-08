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
  }

  // Add video to composition with proper cleanup
  addVideo(file, startTime = 0) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      
      const handleMetadata = () => {
        const item = {
          id: `video-${Date.now()}-${Math.random()}`,
          type: 'video',
          file: file,
          url: url,
          element: video,
          video: video,
          startTime: startTime,
          duration: video.duration,
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
      const reader = new FileReader();
      
      const handleReaderLoad = (e) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        
        const handleImageLoad = () => {
          const item = {
            id: `image-${Date.now()}-${Math.random()}`,
            type: 'image',
            file: file,
            url: url,
            element: img,
            image: img,
            startTime: startTime,
            duration: duration,
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
          URL.revokeObjectURL(url); // CRITICAL: Clean up on error
          reject(new Error('Failed to load image'));
        };

        img.addEventListener('load', handleImageLoad, { once: true });
        img.addEventListener('error', handleImageError, { once: true });
        img.src = URL.createObjectURL(file);
      };

      const handleReaderError = () => {
        reject(new Error('Failed to read file'));
      };

      reader.addEventListener('load', handleReaderLoad, { once: true });
      reader.addEventListener('error', handleReaderError, { once: true });
      reader.readAsArrayBuffer(file);
    });
  }

  // Remove media item safely
  removeMedia(id) {
    const index = this.items.findIndex(item => item.id === id);
    if (index !== -1) {
      const item = this.items[index];
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.video) {
        item.video.pause();
        item.video.src = '';
        item.video.load();
      }
      delete this.lastSeekTimes[id];
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

  // Get total composition duration
  getTotalDuration() {
    if (this.items.length === 0) return 0;
    
    if (this.compositionMode === 'sequential') {
      return this.items.reduce((sum, item) => sum + item.duration, 0);
    } else {
      return Math.max(...this.items.map(item => item.startTime + item.duration));
    }
  }

  // Main render method
  renderFrame(currentTime) {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.compositionMode === 'sequential') {
      this.renderSequential(currentTime);
    } else if (this.compositionMode === 'overlay') {
      this.renderOverlay(currentTime);
    } else if (this.compositionMode === 'split') {
      this.renderSplit(currentTime);
    }
  }

  // Sequential mode: videos play one after another
  renderSequential(currentTime) {
    let timeOffset = 0;

    for (const item of this.items) {
      const itemStartTime = timeOffset;
      const itemEndTime = timeOffset + item.duration;

      if (currentTime >= itemStartTime && currentTime < itemEndTime) {
        const itemTime = currentTime - itemStartTime;
        
        if (item.type === 'video' && item.element) {
          // OPTIMIZATION: Only seek if difference is significant (>150ms)
          const targetTime = itemTime * (item.properties.speed || 1);
          const lastSeek = this.lastSeekTimes[item.id] || -999;
          
          if (Math.abs(item.element.currentTime - targetTime) > 0.15) {
            item.element.currentTime = targetTime;
            this.lastSeekTimes[item.id] = targetTime;
          }
          this.drawMedia(item, itemTime);
        } else if (item.type === 'image' && item.element) {
          this.drawMedia(item, itemTime);
        }
      }
      timeOffset = itemEndTime;
    }
  }

  // Overlay mode: all items play simultaneously
  renderOverlay(currentTime) {
    const sortedItems = [...this.items].sort((a, b) => a.startTime - b.startTime);

    for (const item of sortedItems) {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video' && item.element) {
          // OPTIMIZATION: Only seek if difference is significant
          const targetTime = itemTime * (item.properties.speed || 1);
          if (Math.abs(item.element.currentTime - targetTime) > 0.15) {
            item.element.currentTime = targetTime;
            this.lastSeekTimes[item.id] = targetTime;
          }
        }
        this.drawMedia(item, itemTime);
      }
    }
  }

  // Split mode: grid layout
  renderSplit(currentTime) {
    if (this.items.length === 0) return;
    
    const cols = Math.ceil(Math.sqrt(this.items.length));
    const rows = Math.ceil(this.items.length / cols);
    const cellWidth = this.canvas.width / cols;
    const cellHeight = this.canvas.height / rows;

    this.items.forEach((item, index) => {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video' && item.element) {
          const targetTime = itemTime * (item.properties.speed || 1);
          if (Math.abs(item.element.currentTime - targetTime) > 0.15) {
            item.element.currentTime = targetTime;
            this.lastSeekTimes[item.id] = targetTime;
          }
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
        
        this.drawMedia(item, itemTime);
        
        item.properties.x = prevX;
        item.properties.y = prevY;
        this.ctx.restore();

        this.ctx.strokeStyle = 'rgba(255, 0, 110, 0.4)';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(gridX, gridY, cellWidth, cellHeight);
      }
    });
  }

  // Draw media with transformations
  drawMedia(item, time) {
    if (!item || !item.element) return;
    
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
      } catch (e) {
        console.warn('Draw error:', e);
      }
    }

    this.ctx.restore();
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
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.element && item.type === 'video') {
        item.element.pause();
        item.element.src = '';
        item.element.load();
      }
    });
    this.items = [];
    this.mediaItems = this.items;
    this.selectedItem = null;
    this.lastSeekTimes = {};
    console.log('✅ All media cleared');
  }

  // Get all items
  getMediaItems() {
    return this.items;
  }
}