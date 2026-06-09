class GPUProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, preserveDrawingBuffer: true });
    
    if (!this.gl) {
      console.warn('WebGL not supported, falling back to Canvas 2D');
      this.useWebGL = false;
      return;
    }
    
    this.useWebGL = true;
    this.texture = null;
    this.videoTexture = null;
    this.programCache = {};
    
    // VERTEX SHADER (OPTIMIZED): Perfectly clean mapping. 
    // Handled natively via driver unpacking flags.
    this.vertexShaderSource = `
      attribute vec2 position;
      varying vec2 texCoord;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        texCoord = position * 0.5 + 0.5;
      }
    `;

    const positions = new Float32Array([
      -1, -1,   1, -1,  -1,  1,
      -1,  1,   1, -1,   1,  1
    ]);

    const gl = this.gl;
    this.posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Instantiate static processing texture structure
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  compileShader(source, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  createProgram(vertexShaderSource, fragmentShaderSource) {
    const gl = this.gl;
    const vShader = this.compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    
    if (!vShader || !fShader) return null;
    
    const program = gl.createProgram();
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    const posLoc = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    
    program.positionLocation = posLoc;

    gl.deleteShader(vShader);
    gl.deleteShader(fShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    // UPGRADE #1: Pre-cache standard attributes & uniform maps once during registration
    program.positionLocation = gl.getAttribLocation(program, 'position');
    program.uniforms = {};
    return program;
  }

  getUniformLocation(program, name) {
    if (!(name in program.uniforms)) {
      program.uniforms[name] = this.gl.getUniformLocation(program, name);
    }
    return program.uniforms[name];
  }

  setUniform(program, name, value) {
    const gl = this.gl;
    const loc = this.getUniformLocation(program, name);
    if (loc === null) return;

    if (typeof value === 'number') {
      gl.uniform1f(loc, value);
    } else if (Array.isArray(value)) {
      if (value.length === 2) gl.uniform2fv(loc, value);
      else if (value.length === 3) gl.uniform3fv(loc, value);
      else if (value.length === 4) gl.uniform4fv(loc, value);
    }
  }

  // UPGRADE #6: Generic Effect Engine execution pattern handler
  executePipeline(program, uniforms) {
    const gl = this.gl;
    
    // UPGRADE #1: Use the zero-latency cached attribute location handle
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(program.positionLocation);
    gl.vertexAttribPointer(program.positionLocation, 2, gl.FLOAT, false, 0, 0);
    
    const imageLoc = this.getUniformLocation(program, 'image');
    if (imageLoc !== null) gl.uniform1i(imageLoc, 0);
    for (const key in uniforms) {
  this.setUniform(program, key, uniforms[key]);
   }
   gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Pipeline Method A: Handles static image/thumbnail parsing
  applyEffect(imageData, fragmentShaderSource, uniforms = {}) {
    if (!this.useWebGL) return imageData;

    const gl = this.gl;
    let program = this.programCache[fragmentShaderSource];
    
    if (!program) {
      program = this.createProgram(this.vertexShaderSource, fragmentShaderSource);
      if (!program) return imageData;
      this.programCache[fragmentShaderSource] = program;
    }

    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    
    // Upload the static image data into the GPU texture
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

    const resLoc = this.getUniformLocation(program, 'u_resolution');
    if (resLoc !== null) gl.uniform2f(resLoc, imageData.width, imageData.height);

    if (this.canvas.width !== imageData.width || this.canvas.height !== imageData.height) {
      this.canvas.width = imageData.width;
      this.canvas.height = imageData.height;
    }

    this.executePipeline(program, uniforms);
 
    // UPGRADE #3: Converted readPixels to be safe and strictly ring-fenced for export pipelines only
    const result = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
    gl.readPixels(0, 0, this.canvas.width, this.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, result);
    return new ImageData(result, this.canvas.width, this.canvas.height);
  }

  // Pipeline Method B: Live Video Frame Player Pipeline (Zero GPU-CPU Synchronization Drag)
  renderVideoFrame(video, fragmentShaderSource, uniforms = {}) {
    if (!this.useWebGL) return;

    const gl = this.gl;
    let program = this.programCache[fragmentShaderSource];
    
    if (!program) {
      program = this.createProgram(this.vertexShaderSource, fragmentShaderSource);
      if (!program) return;
      this.programCache[fragmentShaderSource] = program;
    }

    gl.useProgram(program);

    gl.activeTexture(gl.TEXTURE0);

    // UPGRADE #2: Configure configuration filtering properties strictly ONCE upon initial allocation
    if (!this.videoTexture) {
      this.videoTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);
    }
    
    // UPGRADE #4: Force driver to natively correct orientation layout for raw HTML5 video tags
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);

    const resLoc = this.getUniformLocation(program, 'u_resolution');
    if (resLoc !== null) gl.uniform2f(resLoc, video.videoWidth, video.videoHeight);

    if (this.canvas.width !== video.videoWidth || this.canvas.height !== video.videoHeight) {
      this.canvas.width = video.videoWidth;
      this.canvas.height = video.videoHeight;
    }

    // UPGRADE #3: Executes drawing operations natively to canvas framebuffer surface with no read stalling
    this.executePipeline(program, uniforms);
  }

  // ===== UPGRADE #4: SHADERS ARE CLEAN & DISENCUMBERED FROM "1.0 - uv.y" WRAPPERS =====
  
  brightness(imageData, value = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float brightness;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        gl_FragColor = vec4(color.rgb * brightness, color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { brightness: value });
  }

  contrast(imageData, value = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float contrast;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        color.rgb = (color.rgb - 0.5) * contrast + 0.5;
        gl_FragColor = color;
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { contrast: value });
  }

  saturation(imageData, amount = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float saturation;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(mix(vec3(gray), color.rgb, saturation), color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { saturation: amount });
  }

  exposure(imageData, value = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float exposure;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        gl_FragColor = vec4(color.rgb * exposure, color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { exposure: value });
  }

  temperature(imageData, temp = 0.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float temperature;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        if (temperature > 0.0) {
          color.r += temperature * 0.15;
          color.b -= temperature * 0.05;
        } else {
          color.b -= temperature * 0.15;
          color.r += temperature * 0.05;
        }
        gl_FragColor = color;
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { temperature: temp });
  }

  hueShift(imageData, hue = 0.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float hue;
      varying vec2 texCoord;
      
      vec3 rgb2hsv(vec3 c) {
        vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
        vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
        vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
        float d = q.x - min(q.w, q.y);
        float e = 1.0e-10;
        return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
      }
      
      vec3 hsv2rgb(vec3 c) {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
      }
      
      void main() {
        vec4 color = texture2D(image, texCoord);
        vec3 hsv = rgb2hsv(color.rgb);
        hsv.x = fract(hsv.x + hue);
        color.rgb = hsv2rgb(hsv);
        gl_FragColor = color;
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { hue: hue });
  }

  vibrance(imageData, amount = 0.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float vibrance;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        float maxVal = max(color.r, max(color.g, color.b));
        float avgVal = (color.r + color.g + color.b) / 3.0;
        float amt = (maxVal - avgVal) * (-amount * 3.0);
        color.rgb = mix(color.rgb, vec3(maxVal), amt);
        gl_FragColor = color;
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { vibrance: amount });
  }

  vignette(imageData, amount = 0.5) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float vignetteAmount;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        float dist = distance(texCoord, vec2(0.5));
        float vignette = smoothstep(0.8, 0.8 - (vignetteAmount * 0.4), dist);
        gl_FragColor = vec4(color.rgb * vignette, color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { vignetteAmount: amount });
  }

  blur(imageData, amount = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float blur;
      uniform vec2 u_resolution;
      varying vec2 texCoord;
      void main() {
        vec2 step = vec2(blur) / u_resolution;
        
        vec4 color = vec4(0.0);
        color += texture2D(image, texCoord + vec2(-step.x, -step.y)) * 0.0625;
        color += texture2D(image, texCoord + vec2(0.0, -step.y)) * 0.125;
        color += texture2D(image, texCoord + vec2(step.x, -step.y)) * 0.0625;
        
        color += texture2D(image, texCoord + vec2(-step.x, 0.0)) * 0.125;
        color += texture2D(image, texCoord + vec2(0.0, 0.0)) * 0.25;
        color += texture2D(image, texCoord + vec2(step.x, 0.0)) * 0.125;
        
        color += texture2D(image, texCoord + vec2(-step.x, step.y)) * 0.0625;
        color += texture2D(image, texCoord + vec2(0.0, step.y)) * 0.125;
        color += texture2D(image, texCoord + vec2(step.x, step.y)) * 0.0625;
        
        gl_FragColor = color;
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { blur: amount });
  }

  sharpen(imageData, amount = 1.0) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      uniform float sharpen;
      uniform vec2 u_resolution;
      varying vec2 texCoord;
      void main() {
        vec2 step = 1.0 / u_resolution;
        
        vec4 center = texture2D(image, texCoord);
        vec4 top = texture2D(image, texCoord + vec2(0.0, step.y));
        vec4 bottom = texture2D(image, texCoord + vec2(0.0, -step.y));
        vec4 left = texture2D(image, texCoord + vec2(-step.x, 0.0));
        vec4 right = texture2D(image, texCoord + vec2(step.x, 0.0));
        
        vec4 edgeTotal = top + bottom + left + right;
        vec3 result = center.rgb + (center.rgb - (edgeTotal * 0.25)) * sharpen * 2.5;
        gl_FragColor = vec4(clamp(result, 0.0, 1.0), center.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader, { sharpen: amount });
  }

  grayscale(imageData) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        gl_FragColor = vec4(vec3(gray), color.a);
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
        vec4 color = texture2D(image, texCoord);
        vec3 sepiaColor;
        sepiaColor.r = dot(color.rgb, vec3(0.393, 0.769, 0.189));
        sepiaColor.g = dot(color.rgb, vec3(0.349, 0.686, 0.168));
        sepiaColor.b = dot(color.rgb, vec3(0.272, 0.534, 0.131));
        gl_FragColor = vec4(sepiaColor, color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader);
  }

  invert(imageData) {
    const fragmentShader = `
      precision mediump float;
      uniform sampler2D image;
      varying vec2 texCoord;
      void main() {
        vec4 color = texture2D(image, texCoord);
        gl_FragColor = vec4(1.0 - color.rgb, color.a);
      }
    `;
    return this.applyEffect(imageData, fragmentShader);
  }

  // ===== UPGRADE #5: NATIVE HARDWARE BUFFER & CONTENT CLEANUP HOOK =====
  destroy() {
    const gl = this.gl;
    if (!gl) return;

    Object.values(this.programCache).forEach(program => {
      gl.deleteProgram(program);
    });
    this.programCache = {};

    if (this.texture) {
      gl.deleteTexture(this.texture);
      this.texture = null;
    }

    if (this.videoTexture) {
      gl.deleteTexture(this.videoTexture);
      this.videoTexture = null;
    }

    if (this.posBuffer) {
      gl.deleteBuffer(this.posBuffer);
      this.posBuffer = null;
    }
    
    console.log('WebGL processor context assets discarded successfully.');
  }
}