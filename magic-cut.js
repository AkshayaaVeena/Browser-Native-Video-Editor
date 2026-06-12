class MagicCut {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.moments = [];
    this.silences = [];
    this.cancelled = false;
    this.audioContext = null;
    this.audioSource = null;
  }

  cancel() {
    this.cancelled = true;
  }

  async dispose() {
    this.cancel();
    if (this.audioSource) {
      try { this.audioSource.disconnect(); } catch (error) { /* already disconnected */ }
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
    return {
      audioContext: this.audioContext,
      source: this.audioSource
    };
  }

  async detectMoments(onProgress) {
    console.log('Analyzing video for best moments...');
    this.cancelled = false;
    const moments = [];
    const frameInterval = 0.5;
    const duration = this.video.duration || 60;
    const totalSteps = Math.max(1, Math.ceil(duration / frameInterval));

    const targetWidth = this.canvas.width;
    const targetHeight = this.canvas.height;

    for (let step = 0, time = 0; time < duration; step++, time += frameInterval) {
      if (this.cancelled) break;

      const seeked = new Promise(resolve => {
        this.video.addEventListener('seeked', resolve, { once: true });
      });
      this.video.currentTime = time;
      await seeked;

      if (this.video.readyState < 2) continue;

      this.ctx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const imageData = this.ctx.getImageData(0, 0, targetWidth, targetHeight);
      const score = this.analyzeFrame(imageData);

      if (score > 0.5) {
        moments.push({ time, score });
      }

      if (onProgress) {
        onProgress(Math.min(1, (step + 1) / totalSteps));
      }
    }

    this.moments = moments;
    console.log('Detected moments:', moments.length);
    return moments;
  }

  analyzeFrame(imageData) {
    const data = imageData.data;
    let brightness = 0;
    const pixelStep = 16;
    let countedSamples = 0;

    for (let i = 0; i < data.length; i += (4 * pixelStep)) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      brightness += (r + g + b) / 3;
      countedSamples++;
    }

    brightness = brightness / countedSamples;

    let movement = 0;
    if (brightness > 50 && brightness < 200) {
      movement = 0.8;
    } else if (brightness > 20 && brightness < 240) {
      movement = 0.6;
    } else {
      movement = 0.3;
    }

    return (brightness / 255) * 0.5 + movement * 0.5;
  }

  // FIX #4: Replaced full HTTP re-fetch of the video file (which doubled memory usage
  // and would crash the tab for large files) with createMediaElementSource, which
  // taps the already-loaded video element directly via the Web Audio graph.
  // Falls back gracefully if the video element cannot be used as an audio source.
  async detectSilences(threshold = -40, onProgress) {
    console.log('Detecting silences...');
    if (!this.video.src) {
      console.log('No video source file found for audio parsing context.');
      return [];
    }

    try {
      const { audioContext, source } = await this.getAudioGraph();
      // Use createMediaElementSource so we tap the already-decoded media in memory
      // instead of issuing a second HTTP/blob fetch of the entire file.
      // We need an AnalyserNode to read amplitude data frame-by-frame.
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      // Connect through to destination so the video audio still plays normally
      // when the editor is playing (no silent side-effect).
      analyser.connect(audioContext.destination);

      const duration = this.video.duration || 0;
      if (duration === 0) {
        source.disconnect(analyser);
        analyser.disconnect();
        return [];
      }

      const blockDuration = 0.1; // sample every 100 ms
      const totalBlocks = Math.ceil(duration / blockDuration);
      const minSilenceDuration = 0.5;
      const detectedSilences = [];
      const timeDomainBuffer = new Float32Array(analyser.fftSize);

      let silenceStart = null;
      const savedCurrentTime = this.video.currentTime;
      const savedPaused = this.video.paused;

      for (let block = 0; block < totalBlocks; block++) {
        if (this.cancelled) break;

        const targetTime = block * blockDuration;

        // Seek the video to each sample position
        await new Promise(resolve => {
          const onSeeked = () => resolve();
          this.video.addEventListener('seeked', onSeeked, { once: true });
          this.video.currentTime = targetTime;
        });

        // Give the analyser one animation frame to fill its buffer
        await new Promise(resolve => requestAnimationFrame(resolve));

        analyser.getFloatTimeDomainData(timeDomainBuffer);

        let sumOfSquares = 0;
        for (let i = 0; i < timeDomainBuffer.length; i++) {
          sumOfSquares += timeDomainBuffer[i] * timeDomainBuffer[i];
        }
        const rms = Math.sqrt(sumOfSquares / timeDomainBuffer.length);
        const db = 20 * Math.log10(Math.max(rms, 0.0001));
        const currentTime = targetTime;

        if (db < threshold) {
          if (silenceStart === null) {
            silenceStart = currentTime;
          }
        } else if (silenceStart !== null) {
          const silenceDuration = currentTime - silenceStart;
          if (silenceDuration > minSilenceDuration) {
            detectedSilences.push({
              start: silenceStart,
              end: currentTime,
              duration: silenceDuration
            });
          }
          silenceStart = null;
        }

        if (onProgress && block % 8 === 0) {
          onProgress(Math.min(1, block / totalBlocks));
        }
      }

      // Restore video position
      this.video.currentTime = savedCurrentTime;
      if (savedPaused) {
        this.video.pause();
      }

      // Disconnect this analysis pass but keep the media source/context alive.
      // Browsers only allow one MediaElementAudioSourceNode per video element.
      source.disconnect(analyser);
      analyser.disconnect();

      this.silences = detectedSilences;
      console.log('Detected silences setup complete:', detectedSilences.length);
      return detectedSilences;
    } catch (error) {
      console.error('Audio context processing track exception:', error);
      return [];
    }
  }

  generateCutPoints() {
    console.log('Generating cut points...');
    const cutPoints = [];

    if (this.moments.length === 0) {
      console.log('No moments detected');
      return cutPoints;
    }

    let segmentStart = this.moments[0].time;
    let lastMomentTime = this.moments[0].time;

    for (let i = 1; i < this.moments.length; i++) {
      const currentTime = this.moments[i].time;
      const timeSinceLastMoment = currentTime - lastMomentTime;

      if (timeSinceLastMoment > 3) {
        cutPoints.push({
          start: segmentStart,
          end: lastMomentTime,
          duration: lastMomentTime - segmentStart,
          type: 'moment'
        });
        segmentStart = currentTime;
      }

      lastMomentTime = currentTime;
    }

    cutPoints.push({
      start: segmentStart,
      end: lastMomentTime,
      duration: lastMomentTime - segmentStart,
      type: 'moment'
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
    const moments = await this.detectMoments((p) => report(p * 0.65, 'Scanning frames...'));
    if (this.cancelled) return { moments: [], silences: [], cutPoints: [] };

    report(0.65, 'Detecting silences...');
    const silences = await this.detectSilences(-40, (p) => report(0.65 + p * 0.3, 'Detecting silences...'));
    if (this.cancelled) return { moments, silences: [], cutPoints: [] };

    report(0.95, 'Building cut points...');
    const cutPoints = this.generateCutPoints();
    report(1, 'Done');

    return { moments, silences, cutPoints };
  }
}
