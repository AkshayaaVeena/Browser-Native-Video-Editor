class GPUProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    this.program = null;
    this.texture = null;
    
    if (!this.gl) {
      throw new Error('WebGL not supported');
    }
  }

  compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader error:', this.gl.getShaderInfoLog(shader));
      return null;
    }
    return shader;
  }

  brightness(imageData, brightnessValue = 1.0) {
    const gl = this.gl;

    const vertexShader = `
      attribute vec4 position;
      varying vec2 texCoord;
      void main() {
        gl_Position = position;
        texCoord = vec2((position.x + 1.0) / 2.0, 1.0 - (position.y + 1.0) / 2.0);
      }
    `;

    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float brightness;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
        gl_FragColor = color * brightness;
      }
    `;

    const vShader = this.compileShader(vertexShader, gl.VERTEX_SHADER);
    const fShader = this.compileShader(fragmentShader, gl.FRAGMENT_SHADER);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vShader);
    gl.attachShader(this.program, fShader);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imageData);

    const positions = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1
    ]);
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const brightLoc = gl.getUniformLocation(this.program, 'brightness');
    gl.uniform1f(brightLoc, brightnessValue);
    const imageLoc = gl.getUniformLocation(this.program, 'image');
    gl.uniform1i(imageLoc, 0);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const result = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, result);
    
    return new ImageData(result, this.canvas.width, this.canvas.height);
  }
}