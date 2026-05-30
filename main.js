const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const timeEl = document.getElementById("time");
const width = 1000;
const imageData = createTestImage(width);
ctx.putImageData(imageData, 0, 0);
const worker1 = new Worker("blurWorker.js");
const worker2 = new Worker("blurWorker.js");
const worker3 = new Worker("blurWorker.js");
const worker4 = new Worker("blurWorker.js");
const startTime = performance.now();
worker1.postMessage({ imageData, startRow: 0, endRow: 250, width });
worker2.postMessage({ imageData, startRow: 250, endRow: 500, width });
worker3.postMessage({ imageData, startRow: 500, endRow: 750, width });
worker4.postMessage({ imageData, startRow: 750, endRow: 1000, width });

let completed = 0;
let finalImage = new Uint8ClampedArray(imageData.data);
worker1.onmessage = handle;
worker2.onmessage = handle;
worker3.onmessage = handle;
worker4.onmessage = handle;

function handle(event) {
  const { result, startRow, endRow } = event.data;
  const rowOffset = startRow * width * 4;
  const chunk = result.subarray(rowOffset, endRow * width * 4);

  finalImage.set(chunk, rowOffset);

  completed++;

  if (completed === 4) {
    const elapsed = performance.now() - startTime;
    console.log(`DONE in ${elapsed.toFixed(2)} ms`);
    ctx.putImageData(new ImageData(finalImage, width, width), 0, 0);
    if (timeEl) {
      timeEl.textContent = `Blur computation finished in ${elapsed.toFixed(2)} ms`;
    }
  }
}

function createTestImage(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(size, size);
  const data = imageData.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = Math.floor((x / (size - 1)) * 255);
      data[i + 1] = Math.floor((y / (size - 1)) * 255);
      data[i + 2] = 150;
      data[i + 3] = 255;
    }
  }

  return imageData;
}