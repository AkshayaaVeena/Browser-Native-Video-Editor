class MagicCut {
  constructor(video, canvas) {
    this.video       = video;
    this.canvas      = canvas;
    this.ctx         = canvas.getContext('2d');
    this.moments     = [];
    this.silences    = [];
    this.cancelled   = false;
    this.audioContext  = null;
    this.audioSource   = null;
  }

  cancel() {
    this.cancelled = true;
  }

  async dispose() {
    this.cancel();
    if (this.audioSource) {
      try { this.audioSource.disconnect(); } catch(e) {}
      this.audioSource = null;
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close().catch(() => {});
    }
    this.audioContext = null;
  }

  async getAudioGraph() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (!this.audioSource) {
      this.audioSource = this.audioContext.createMediaElementSource(this.video);
    }
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume().catch(() => {});
    }
    return { audioContext: this.audioContext, source: this.audioSource };
  }

  // ===== FIX 6: Adaptive sampling — interval scales with duration =====
  // Long videos (>5 min) used to sample every 0.5 s, which meant 600+ seeks
  // for a 5-minute clip. This caused the browser to slow to a crawl and, on
  // hour-long videos, crash the tab. We now pick a coarser interval for longer
  // content and additionally skip obviously-dark (black) frames early.
  _getFrameInterval(duration) {
    if (duration > 3600) return 5.0;   // >1 hr  : every 5 s
    if (duration > 1800) return 3.0;   // >30 min: every 3 s
    if (duration > 600)  return 2.0;   // >10 min: every 2 s
    if (duration > 300)  return 1.5;   // >5 min : every 1.5 s
    if (duration > 60)   return 1.0;   // >1 min : every 1 s
    return 0.5;                        // <1 min : every 0.5 s
  }

  // FIX 6: Quick brightness check to skip black/mostly-dark frames without
  // running the full analyzeFrame pipeline, saving both CPU and seek time.
  _isBlackFrame(imageData) {
    const data    = imageData.data;
    let   sumLuma = 0;
    const step    = 32; // sample every 32nd pixel — fast enough for the check
    let   count   = 0;
    for (let i = 0; i < data.length; i += 4 * step) {
      sumLuma += (data[i] * 299 + data[i+1] * 587 + data[i+2] * 114) / 1000;
      count++;
    }
    return count > 0 && (sumLuma / count) < 12; // luma < 12/255 → effectively black
  }

  async detectMoments(onProgress) {
    console.log('Analyzing video for best moments...');
    this.cancelled = false;
    const moments  = [];
    const duration = this.video.duration || 60;

    // FIX 6: adaptive interval
    const frameInterval = this._getFrameInterval(duration);
    const totalSteps    = Math.max(1, Math.ceil(duration / frameInterval));

    const targetWidth  = this.canvas.width;
    const targetHeight = this.canvas.height;

    let consecutiveBlackFrames = 0;

    for (let step = 0, time = 0; time < duration; step++, time += frameInterval) {
      if (this.cancelled) break;

      await new Promise(resolve => {
        this.video.addEventListener('seeked', resolve, { once: true });
        this.video.currentTime = time;
      });

      if (this.video.readyState < 2) continue;

      this.ctx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const imageData = this.ctx.getImageData(0, 0, targetWidth, targetHeight);

      // FIX 6: fast black-frame skip — avoid full analysis on dark frames
      if (this._isBlackFrame(imageData)) {
        consecutiveBlackFrames++;
        // After 3 consecutive black frames, accelerate: skip ahead by 5 intervals
        if (consecutiveBlackFrames >= 3) {
          time  += frameInterval * 4; // the loop itself adds one more
          step  += 4;
          consecutiveBlackFrames = 0;
        }
        if (onProgress) onProgress(Math.min(1, (step + 1) / totalSteps));
        continue;
      }
      consecutiveBlackFrames = 0;

      const score = this.analyzeFrame(imageData);
      if (score > 0.5) {
        moments.push({ time, score });
      }

      if (onProgress) {
        onProgress(Math.min(1, (step + 1) / totalSteps));
      }
    }

    this.moments = moments;
    console.log('Detected moments:', moments.length,
                `(sampled every ${frameInterval}s for ${duration.toFixed(1)}s video)`);
    return moments;
  }

  analyzeFrame(imageData) {
    const data        = imageData.data;
    let   brightness  = 0;
    const pixelStep   = 16;
    let   count       = 0;

    for (let i = 0; i < data.length; i += 4 * pixelStep) {
      brightness += (data[i] + data[i+1] + data[i+2]) / 3;
      count++;
    }
    brightness = count > 0 ? brightness / count : 0;

    let movement;
    if      (brightness > 50 && brightness < 200) movement = 0.8;
    else if (brightness > 20 && brightness < 240) movement = 0.6;
    else                                           movement = 0.3;

    return (brightness / 255) * 0.5 + movement * 0.5;
  }

  async detectSilences(threshold = -40, onProgress) {
    console.log('Detecting silences...');
    if (!this.video.src) {
      console.log('No video source for audio analysis.');
      return [];
    }

    try {
      const { audioContext, source } = await this.getAudioGraph();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      const duration = this.video.duration || 0;
      if (duration === 0) {
        source.disconnect(analyser);
        analyser.disconnect();
        return [];
      }

      const blockDuration    = 0.1;
      const totalBlocks      = Math.ceil(duration / blockDuration);
      const minSilenceDuration = 0.5;
      const detectedSilences = [];
      const timeDomainBuffer = new Float32Array(analyser.fftSize);
      let   silenceStart     = null;

      const savedCurrentTime = this.video.currentTime;
      const savedPaused      = this.video.paused;

      for (let block = 0; block < totalBlocks; block++) {
        if (this.cancelled) break;

        const targetTime = block * blockDuration;
        await new Promise(resolve => {
          this.video.addEventListener('seeked', resolve, { once: true });
          this.video.currentTime = targetTime;
        });
        await new Promise(resolve => requestAnimationFrame(resolve));

        analyser.getFloatTimeDomainData(timeDomainBuffer);
        let sumSq = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
          sumSq += timeDomainBuffer[i] * timeDomainBuffer[i];
        }
        const rms = Math.sqrt(sumSq / timeDomainBuffer.length);
        const db  = 20 * Math.log10(Math.max(rms, 0.0001));

        if (db < threshold) {
          if (silenceStart === null) silenceStart = targetTime;
        } else if (silenceStart !== null) {
          const silenceDuration = targetTime - silenceStart;
          if (silenceDuration > minSilenceDuration) {
            detectedSilences.push({ start: silenceStart, end: targetTime, duration: silenceDuration });
          }
          silenceStart = null;
        }

        if (onProgress && block % 8 === 0) {
          onProgress(Math.min(1, block / totalBlocks));
        }
      }

      this.video.currentTime = savedCurrentTime;
      if (savedPaused) this.video.pause();

      source.disconnect(analyser);
      analyser.disconnect();

      this.silences = detectedSilences;
      console.log('Detected silences:', detectedSilences.length);
      return detectedSilences;
    } catch (error) {
      console.error('Audio analysis error:', error);
      return [];
    }
  }

  generateCutPoints() {
    console.log('Generating cut points...');
    const cutPoints = [];
    if (this.moments.length === 0) return cutPoints;

    let segmentStart    = this.moments[0].time;
    let lastMomentTime  = this.moments[0].time;

    for (let i = 1; i < this.moments.length; i++) {
      const currentTime        = this.moments[i].time;
      const timeSinceLastMoment = currentTime - lastMomentTime;

      if (timeSinceLastMoment > 3) {
        cutPoints.push({
          start:    segmentStart,
          end:      lastMomentTime,
          duration: lastMomentTime - segmentStart,
          type:     'moment'
        });
        segmentStart = currentTime;
      }
      lastMomentTime = currentTime;
    }

    cutPoints.push({
      start:    segmentStart,
      end:      lastMomentTime,
      duration: lastMomentTime - segmentStart,
      type:     'moment'
    });

    console.log('Generated cut points:', cutPoints.length);
    return cutPoints;
  }

  async analyzeFull(onProgress) {
    console.log('Starting full analysis...');
    this.cancelled = false;

    const report = (fraction, label) => {
      if (onProgress) onProgress(fraction, label);
    };

    report(0, 'Scanning frames...');
    const moments = await this.detectMoments(p => report(p * 0.65, 'Scanning frames...'));
    if (this.cancelled) return { moments: [], silences: [], cutPoints: [] };

    report(0.65, 'Detecting silences...');
    const silences = await this.detectSilences(-40, p => report(0.65 + p * 0.3, 'Detecting silences...'));
    if (this.cancelled) return { moments, silences: [], cutPoints: [] };

    report(0.95, 'Building cut points...');
    const cutPoints = this.generateCutPoints();
    report(1, 'Done');

    return { moments, silences, cutPoints };
  }
}