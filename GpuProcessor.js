class GPUProcessor {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl');
    this.texture = null;

    if (!this.gl) {
      throw new Error('WebGL not supported');
    }

    const gl = this.gl;
    this.videoTexture = gl.createTexture();
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

    this.programCache={};
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
    let program=this.programCache[fragmentShaderSource];
    if(!program){
    const vShader = this.compileShader(this.vertexShaderSource, gl.VERTEX_SHADER);
    const fShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vShader || !fShader) {
      throw new Error('Shader compilation failed');
    }
    program=gl.createProgram();
    gl.attachShader(program, vShader);
    gl.attachShader(program, fShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      throw new Error('WebGL program failed to link');
    }

    this.programCache[fragmentShaderSource] = program;
  }

    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    const posLoc = gl.getAttribLocation(program, 'position');
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

    const imageLoc = gl.getUniformLocation(program, 'image');
    if (imageLoc !== null) {
      gl.uniform1i(imageLoc, 0);
    }

    for (const key in uniforms) {
      const loc = gl.getUniformLocation(program, key);
      if (loc==null) continue;
      const value = uniforms[key];
      if (typeof value === 'number') {
        gl.uniform1f(loc, value);
      } else if (Array.isArray(value)) {
        if (value.length === 2) gl.uniform2fv(loc, value);
        else if (value.length === 3) gl.uniform3fv(loc, value);
        else if (value.length === 4) gl.uniform4fv(loc, value);
      }
    }

    if (this.canvas.width !== imageData.width || this.canvas.height !== imageData.height) {
      this.canvas.width = imageData.width;
      this.canvas.height = imageData.height;
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

updateVideoTexture(video) {
  const gl = this.gl;

  gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    video
  );
}

renderVideoFrame(video, fragmentShaderSource, uniforms = {}) {
  const gl = this.gl;

  const vShader = this.compileShader(this.vertexShaderSource, gl.VERTEX_SHADER);
  const fShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);

  const program = gl.createProgram();
  gl.attachShader(program, vShader);
  gl.attachShader(program, fShader);
  gl.linkProgram(program);

  gl.useProgram(program);

  this.updateVideoTexture(video);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, this.videoTexture);

  const posLoc = gl.getAttribLocation(program, "position");
  gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
  gl.enableVertexAttribArray(posLoc);
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const imageLoc = gl.getUniformLocation(program, "image");
  gl.uniform1i(imageLoc, 0);

  gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
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
// Blur effect
blur(imageData, amount = 1.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float blur;
    varying vec2 texCoord;
    void main() {
      vec4 color = vec4(0.0);
      float offset = blur * 0.01;
      
      color += texture2D(image, texCoord + vec2(-offset, -offset)) * 0.25;
      color += texture2D(image, texCoord + vec2(offset, -offset)) * 0.25;
      color += texture2D(image, texCoord + vec2(-offset, offset)) * 0.25;
      color += texture2D(image, texCoord + vec2(offset, offset)) * 0.25;
      
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { blur: amount });
}

// Sharpen effect
sharpen(imageData, amount = 1.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float sharpen;
    varying vec2 texCoord;
    void main() {
      vec4 center = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      vec4 neighbor = texture2D(image, vec2(texCoord.x + 0.01, 1.0 - texCoord.y));
      
      vec4 color = center + (center - neighbor) * sharpen;
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { sharpen: amount });
}

// Exposure adjustment
exposure(imageData, value = 1.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float exposure;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      color.rgb *= exposure;
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { exposure: value });
}

// Temperature (Warm/Cool)
temperature(imageData, temp = 0.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float temperature;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      
      if (temperature > 0.0) {
        color.r += temperature * 0.2;
      } else {
        color.b -= temperature * 0.2;
      }
      
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { temperature: temp });
}

// Hue shift (Color grading)
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
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      vec3 hsv = rgb2hsv(color.rgb);
      hsv.x += hue;
      color.rgb = hsv2rgb(hsv);
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { hue: hue });
}

// Vibrance (enhanced saturation)
vibrance(imageData, amount = 0.0) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float vibrance;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(vec3(gray), color.rgb, 1.0 + vibrance);
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { vibrance: amount });
}

// Vignette effect
vignette(imageData, amount = 0.5) {
  const fragmentShader = `
    precision mediump float;
    uniform sampler2D image;
    uniform float vignetteAmount;
    varying vec2 texCoord;
    void main() {
      vec4 color = texture2D(image, vec2(texCoord.x, 1.0 - texCoord.y));
      
      vec2 center = vec2(0.5, 0.5);
      float dist = distance(texCoord, center);
      float vignette = smoothstep(0.8, 0.0, dist * vignetteAmount);
      
      color.rgb *= vignette;
      gl_FragColor = color;
    }
  `;
  return this.applyEffect(imageData, fragmentShader, { vignetteAmount: amount });
}
}
