const kernel=[
    1,  4,  7,
    4, 16,  4,
    7,  4,  1
];
const kernelSum=52;
self.onmessage=function(event){
    const{imageData,startRow,endRow,width}=event.data;
    const data=imageData.data;
    const height = imageData.height;
    const result = new Uint8ClampedArray(data);

    for(let y=Math.max(1,startRow);y<Math.min(endRow,height-1);y++)
    {
        for(let x=1;x<width-1;x++)
        {
            let r = 0, g = 0, b = 0;
            for(let ky=-1;ky<=1;ky++)
            {
                for(let kx=-1;kx<=1;kx++)
                {
                     const neighborIndex = ((y + ky) * width + (x + kx)) * 4;
          const kernelIndex = (ky + 1) * 3 + (kx + 1);
          const weight = kernel[kernelIndex];
 
          r += data[neighborIndex] * weight;
          g += data[neighborIndex + 1] * weight;
          b += data[neighborIndex + 2] * weight;
                }
            }
             const pixelIndex = (y * width + x) * 4;
      result[pixelIndex] = r / kernelSum;
      result[pixelIndex + 1] = g / kernelSum;
      result[pixelIndex + 2] = b / kernelSum;
        }
    }
      self.postMessage({
    result: result,
    startRow: startRow,
    endRow: endRow
  });
};