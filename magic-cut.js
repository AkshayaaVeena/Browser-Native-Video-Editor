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

    for (let time = 0; time < duration; time += frameInterval) {
      this.video.currentTime = time;
      await new Promise(resolve => {
        this.video.addEventListener('seeked', resolve, { once: true });
      });

      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

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
    let movement = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      brightness += (r + g + b) / 3;
    }

    brightness = brightness / (data.length / 4);

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
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();

    if (!this.video.src) {
      console.log('No video loaded');
      return [];
    }

    try {
      const response = await fetch(this.video.src);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      const silences = this.analyzeSilence(audioBuffer, threshold);
      this.silences = silences;

      console.log('Detected silences:', silences.length);
      return silences;
    } catch (error) {
      console.warn('Silence detection error:', error);
      return [];
    }
  }

  analyzeSilence(audioBuffer, threshold) {
    const silences = [];
    const rawData = audioBuffer.getChannelData(0);
    const blockSize = 4096;
    let silenceStart = null;

    for (let i = 0; i < rawData.length; i += blockSize) {
      const block = rawData.slice(i, i + blockSize);
      const rms = Math.sqrt(block.reduce((sum, val) => sum + val * val, 0) / block.length);
      const db = 20 * Math.log10(Math.max(rms, 0.001));

      if (db < threshold) {
        if (silenceStart === null) {
          silenceStart = (i / audioBuffer.sampleRate);
        }
      } else {
        if (silenceStart !== null) {
          const silenceEnd = (i / audioBuffer.sampleRate);
          if (silenceEnd - silenceStart > 0.5) {
            silences.push({ start: silenceStart, end: silenceEnd, duration: silenceEnd - silenceStart });
          }
          silenceStart = null;
        }
      }
    }

    return silences;
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

    return {
      moments,
      silences,
      cutPoints,
      analysis: {
        totalMoments: moments.length,
        totalSilences: silences.length,
        estimatedCuts: cutPoints.length,
        totalDuration: this.video.duration
      }
    };
  }
}