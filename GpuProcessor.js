class GPUProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    this.program = null;
    this.texture = null;

    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    const gl = this.gl;

    this.vertexShaderSource = `
      attribute vec4 position;
      varying vec2 texCoord;
      void main() {
        gl_Position = position;
        texCoord = vec2((position.x + 1.0) / 2.0, 1.0 - (position.y + 1.0) / 2.0);
      }
    `;

    const positions = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
      -1,  1,
       1, -1,
       1,  1
    ]);

    this.posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  compileShader(source, type) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error('Shader error:', this.gl.getShaderInfoLog(shader));
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  applyEffect(imageData, fragmentShaderSource, uniforms = {}) {
    const gl = this.gl;

    const vShader = this.compileShader(this.vertexShaderSource, gl.VERTEX_SHADER);
    const fShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vShader || !fShader) {
      throw new Error('Shader compilation failed');
    }

    this.program = gl.createProgram();
    gl.attachShader(this.program, vShader);
    gl.attachShader(this.program, fShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(this.program));
      throw new Error('WebGL program failed to link');
    }

    gl.useProgram(this.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    const posLoc = gl.getAttribLocation(this.program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      imageData.width,
      imageData.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      imageData.data
    );

    const imageLoc = gl.getUniformLocation(this.program, 'image');
    if (imageLoc !== null) {
      gl.uniform1i(imageLoc, 0);
    }

    for (const key in uniforms) {
      const loc = gl.getUniformLocation(this.program, key);
      if (!loc) continue;
      const value = uniforms[key];
      if (typeof value === 'number') {
        gl.uniform1f(loc, value);
      } else if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2fv(loc, value);
        else if (value.length === 3) gl.uniform3fv(loc, value);
        else if (value.length === 4) gl.uniform4fv(loc, value);
      }
    }

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    const result = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(
      0,
      0,
      this.canvas.width,
      this.canvas.height,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      result
    );

    return new ImageData(result, this.canvas.width, this.canvas.height);
  }

  brightness(imageData, brightnessValue = 1.0) {
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

    return this.applyEffect(imageData, fragmentShader, {
      brightness: brightnessValue
    });
  }

  grayscale(imageData) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(vec3(gray), color.a);
      }
    `;

    return this.applyEffect(imageData, fragmentShader);
  }

  contrast(imageData, value) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float contrast;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
        color.rgb = (color.rgb - 0.5) * contrast + 0.5;
        gl_FragColor = color;
      }
    `;

    return this.applyEffect(imageData, fragmentShader, {
      contrast: value
    });
  }
  invert(imageData) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      gl_FragColor = vec4(1.0 - color.rgb, color.a);
    }
  `;
  return this.applyEffect(imageData, fragmentShader);
}

sepia(imageData) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      float r = color.r * 0.393 + color.g * 0.769 + color.b * 0.189;
      float g = color.r * 0.349 + color.g * 0.686 + color.b * 0.168;
      float b = color.r * 0.272 + color.g * 0.534 + color.b * 0.131;
      gl_FragColor = vec4(r, g, b, color.a);
    }
  `;
  return this.applyEffect(imageData, fragmentShader);
}

saturation(imageData, amount = 1.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float saturation;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      vec3 saturated = mix(vec3(gray), color.rgb, saturation);
      gl_FragColor = vec4(saturated, color.a);
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { saturation: amount });
}
}
