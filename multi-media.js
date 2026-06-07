// media-composer.js
// Handles multiple videos, images, and composition

class MediaComposer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx || canvas.getContext('2d');
    this.mediaItems = []; // Array of {id, type, url, startTime, duration, properties}
    this.selectedItem = null;
    this.compositionMode = 'sequential'; // sequential, overlay, split
  }

  // Add video to composition
  addVideo(file, startTime = 0) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        
        video.onloadedmetadata = () => {
          const item = {
            id: Date.now() + Math.random(),
            type: 'video',
            file: file,
            url: url,
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
          
          this.mediaItems.push(item);
          resolve(item);
        };
        
        video.onerror = () => reject(new Error('Failed to load video'));
        video.src = url;
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  // Add image to composition
  addImage(file, startTime = 0, duration = 5) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        
        img.onload = () => {
          const item = {
            id: Date.now() + Math.random(),
            type: 'image',
            file: file,
            url: img.src,
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
          
          this.mediaItems.push(item);
          resolve(item);
        };
        
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  // Remove media item
  removeMedia(id) {
    const index = this.mediaItems.findIndex(item => item.id === id);
    if (index !== -1) {
      const item = this.mediaItems[index];
      if (item.url) URL.revokeObjectURL(item.url);
      this.mediaItems.splice(index, 1);
      if (this.selectedItem === id) this.selectedItem = null;
      return true;
    }
    return false;
  }

  // Update media properties
  updateMedia(id, properties) {
    const item = this.mediaItems.find(item => item.id === id);
    if (item) {
      item.properties = { ...item.properties, ...properties };
      return true;
    }
    return false;
  }

  // ===== UI COMPATIBILITY ALIASES =====
  selectItem(id) {
    this.selectedItem = id;
  }

  updateItemProperties(id, properties) {
    return this.updateMedia(id, properties);
  }

  // Front-end pipeline maps to .render()
  render(currentTime) {
    this.renderFrame(currentTime);
  }
  // =====================================

  // Get total composition duration
  getTotalDuration() {
    if (this.mediaItems.length === 0) return 0;
    
    if (this.compositionMode === 'sequential') {
      return this.mediaItems.reduce((sum, item) => sum + item.duration, 0);
    } else {
      // overlay or split mode
      return Math.max(...this.mediaItems.map(item => item.startTime + item.duration));
    }
  }

  // Render frame at specific time
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

    for (const item of this.mediaItems) {
      const itemStartTime = timeOffset;
      const itemEndTime = timeOffset + item.duration;

      if (currentTime >= itemStartTime && currentTime < itemEndTime) {
        const itemTime = currentTime - itemStartTime;
        
        if (item.type === 'video') {
          // Frame accurate seeking lock
          const targetTime = itemTime * (item.properties.speed || 1);
          if (Math.abs(item.video.currentTime - targetTime) > 0.1) {
            item.video.currentTime = targetTime;
          }
          this.drawMedia(item, itemTime);
        } else if (item.type === 'image') {
          this.drawMedia(item, itemTime);
        }
      }
      timeOffset = itemEndTime;
    }
  }

  // Overlay mode: all videos/images play simultaneously based on track activation
  renderOverlay(currentTime) {
    const sortedItems = [...this.mediaItems].sort((a, b) => a.startTime - b.startTime);

    for (const item of sortedItems) {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video') {
          const targetTime = itemTime * (item.properties.speed || 1);
          if (Math.abs(item.video.currentTime - targetTime) > 0.1) {
            item.video.currentTime = targetTime;
          }
        }
        this.drawMedia(item, itemTime);
      }
    }
  }

  // Split mode: grid allocation
  renderSplit(currentTime) {
    if (this.mediaItems.length === 0) return;
    
    const cols = Math.ceil(Math.sqrt(this.mediaItems.length));
    const rows = Math.ceil(this.mediaItems.length / cols);
    const cellWidth = this.canvas.width / cols;
    const cellHeight = this.canvas.height / rows;

    this.mediaItems.forEach((item, index) => {
      if (currentTime >= item.startTime && currentTime < item.startTime + item.duration) {
        const itemTime = currentTime - item.startTime;
        
        if (item.type === 'video') {
          const targetTime = itemTime * (item.properties.speed || 1);
          if (Math.abs(item.video.currentTime - targetTime) > 0.1) {
            item.video.currentTime = targetTime;
          }
        }

        const row = Math.floor(index / cols);
        const col = index % cols;
        const gridX = col * cellWidth;
        const gridY = row * cellHeight;

        this.ctx.save();
        
        // Clip track space to cell matrix container boundary
        this.ctx.beginPath();
        this.ctx.rect(gridX, gridY, cellWidth, cellHeight);
        this.ctx.clip();

        // Pass custom local translation modifications safely
        const prevX = item.properties.x;
        const prevY = item.properties.y;
        item.properties.x = gridX + prevX;
        item.properties.y = gridY + prevY;
        
        this.drawMedia(item, itemTime);
        
        item.properties.x = prevX;
        item.properties.y = prevY;

        this.ctx.restore();

        // Draw track grid border decoration
        this.ctx.strokeStyle = 'rgba(255, 0, 110, 0.4)';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(gridX, gridY, cellWidth, cellHeight);
      }
    });
  }

  // Draw individual media item with transformations
  drawMedia(item, time) {
    const props = item.properties;
    this.ctx.save();
    
    // Set explicit configurations
    this.ctx.globalAlpha = props.opacity !== undefined ? props.opacity : 1;
    this.ctx.globalCompositeOperation = props.blendMode || 'source-over';
    
    // Calculate canvas matrix translation points
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    this.ctx.translate(centerX + (props.x || 0), centerY + (props.y || 0));
    if (props.rotation) {
      this.ctx.rotate((props.rotation * Math.PI) / 180);
    }
    this.ctx.scale(props.scale || 1, props.scale || 1);
    this.ctx.translate(-centerX, -centerY);

    if (item.type === 'video' && item.video.readyState >= 2) {
      const w = item.video.videoWidth || this.canvas.width;
      const h = item.video.videoHeight || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      
      const displayWidth = w * scale;
      const displayHeight = h * scale;
      const x = (this.canvas.width - displayWidth) / 2;
      const y = (this.canvas.height - displayHeight) / 2;
      
      this.ctx.drawImage(item.video, x, y, displayWidth, displayHeight);
    } else if (item.type === 'image' && item.image) {
      const w = item.image.width || this.canvas.width;
      const h = item.image.height || this.canvas.height;
      const scale = Math.min(this.canvas.width / w, this.canvas.height / h);
      
      const displayWidth = w * scale;
      const displayHeight = h * scale;
      const x = (this.canvas.width - displayWidth) / 2;
      const y = (this.canvas.height - displayHeight) / 2;
      
      this.ctx.drawImage(item.image, x, y, displayWidth, displayHeight);
    }

    this.ctx.restore();
  }

  // Get all media items
  getMediaItems() {
    return this.mediaItems;
  }

  // Reorder media items
  reorderMedia(fromIndex, toIndex) {
    if (fromIndex >= 0 && fromIndex < this.mediaItems.length && 
        toIndex >= 0 && toIndex < this.mediaItems.length) {
      const item = this.mediaItems.splice(fromIndex, 1)[0];
      this.mediaItems.splice(toIndex, 0, item);
      return true;
    }
    return false;
  }

  // Set composition mode
  setCompositionMode(mode) {
    const unifiedMode = mode.toLowerCase();
    if (['sequential', 'overlay', 'split'].includes(unifiedMode)) {
      this.compositionMode = unifiedMode;
      return true;
    }
    return false;
  }

  // Get composition info
  getCompositionInfo() {
    return {
      mode: this.compositionMode,
      itemCount: this.mediaItems.length,
      totalDuration: this.getTotalDuration(),
      items: this.mediaItems.map(item => ({
        id: item.id,
        type: item.type,
        file: item.file?.name || 'unknown',
        startTime: item.startTime,
        duration: item.duration,
        properties: item.properties
      }))
    };
  }

  // Export composition metadata
  exportMetadata() {
    return {
      version: '1.0',
      mode: this.compositionMode,
      canvas: {
        width: this.canvas.width,
        height: this.canvas.height
      },
      items: this.mediaItems.map(item => ({
        type: item.type,
        fileName: item.file?.name || 'unknown',
        startTime: item.startTime,
        duration: item.duration,
        properties: item.properties
      })),
      createdAt: new Date().toISOString()
    };
  }

  // Clear all media tracks and break object references
  clearAll() {
    this.mediaItems.forEach(item => {
      if (item.url) URL.revokeObjectURL(item.url);
      if (item.video) {
        item.video.pause();
        item.video.src = "";
        item.video.load();
      }
    });
    this.mediaItems = [];
    this.selectedItem = null;
  }
}