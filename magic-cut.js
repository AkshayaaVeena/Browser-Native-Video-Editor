class MagicCut {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.moments = [];
    this.silences = [];
  }

  async detectMoments() {
    console.log('Analyzing video for best moments...');
    const moments = [];
    const frameInterval = 0.5;
    const duration = this.video.duration || 60;

    // Cache parameters to avoid forcing recalculation checks within the iteration loops
    const targetWidth = this.canvas.width;
    const targetHeight = this.canvas.height;

    for (let time = 0; time < duration; time += frameInterval) {
      this.video.currentTime = time;
      await new Promise(resolve => {
        this.video.addEventListener('seeked', resolve, { once: true });
      });

      this.ctx.drawImage(this.video, 0, 0, targetWidth, targetHeight);
      const imageData = this.ctx.getImageData(0, 0, targetWidth, targetHeight);

      const score = this.analyzeFrame(imageData);

      if (score > 0.5) {
        moments.push({ time, score });
      }
    }

    this.moments = moments;
    console.log('Detected moments:', moments.length);
    return moments;
  }

  analyzeFrame(imageData) {
    const data = imageData.data;
    let brightness = 0;
    
    // Performance Optimization: Implementation of a pixel step cadence to avoid main thread evaluation lockups.
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

  async detectSilences(threshold = -40) {
    console.log('Detecting silences...');
    if (!this.video.src) {
      console.log('No video source file found for audio parsing context.');
      return [];
    }

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    try {
      const response = await fetch(this.video.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      const rawData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;
      const blockSize = 4096;
      const minSilenceDuration = 0.5;
      const detectedSilences = [];
      let silenceStart = null;

      // Iteration logic avoiding heavy sub-array slice reallocations inside memory loops
      for (let i = 0; i < rawData.length; i += blockSize) {
        const endLimit = Math.min(i + blockSize, rawData.length);
        let sumOfSquares = 0;
        let count = 0;

        for (let j = i; j < endLimit; j++) {
          sumOfSquares += rawData[j] * rawData[j];
          count++;
        }

        if (count === 0) continue;
        const rms = Math.sqrt(sumOfSquares / count);
        const db = 20 * Math.log10(Math.max(rms, 0.0001)); // Bound clamp to prevent -Infinity issues
        const currentTime = i / sampleRate;

        if (db < threshold) {
          if (silenceStart === null) {
            silenceStart = currentTime;
          }
        } else {
          if (silenceStart !== null) {
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
        }
      }

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

  async analyzeFull() {
    console.log('Starting full analysis...');
    const moments = await this.detectMoments();
    const silences = await this.detectSilences();
    const cutPoints = this.generateCutPoints();

    return { moments, silences, cutPoints };
  }
}