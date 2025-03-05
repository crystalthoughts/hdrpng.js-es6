/**
 * hdrpng.ts - support for Radiance .HDR and RGBE / RGB9_E5 images in PNG.
 * @author Enki
 * @desc load/save Radiance .HDR, RGBE in PNG and RGB9_E5 in PNG for HTML5, webGL, webGL2.
 */

/**
 * Interface for HDRImage element that extends HTMLCanvasElement-like functionality
 */
interface HDRImageElement extends HTMLCanvasElement {
  exposure: number;
  gamma: number;
  readonly dataFloat: Float32Array;
  readonly dataRGBE: Uint8Array;
  readonly src: string;
  toHDRBlob(cb?: BlobCallback, m?: string, q?: number): void;
  onload: ((this: GlobalEventHandlers, ev: Event) => any) | null;
  dataRAW?: Uint32Array;
}

/**
 * HDRImage - wrapper that exposes default Image like interface for HDR images.
 * @returns {HDRImageElement} a html HDR image element
 */
const HDRImage = (): HDRImageElement => {
  const res = document.createElement('canvas') as HDRImageElement;
  let HDRsrc = 't';
  let HDRexposure = 1.0;
  let HDRgamma = 2.2;
  let HDRdata: Uint8Array | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let HDRD: ImageData;

  Object.defineProperty(res, 'exposure', {
    get: () => HDRexposure,
    set: (val: number) => {
      HDRexposure = val;
      if (HDRdata) {
        rgbeToLDR(HDRdata, HDRexposure, HDRgamma, HDRD.data);
        context?.putImageData(HDRD, 0, 0);
      }
    }
  });

  Object.defineProperty(res, 'gamma', {
    get: () => HDRgamma,
    set: (val: number) => {
      HDRgamma = val;
      if (HDRdata) {
        rgbeToLDR(HDRdata, HDRexposure, HDRgamma, HDRD.data);
        context?.putImageData(HDRD, 0, 0);
      }
    }
  });

  Object.defineProperty(res, 'dataFloat', {
    get: () => rgbeToFloat(HDRdata as Uint8Array)
  });

  Object.defineProperty(res, 'dataRGBE', {
    get: () => HDRdata as Uint8Array
  });

  res.toHDRBlob = function(cb?: BlobCallback, m?: string, q?: number): void {
    // Array to image.. slightly more involved.  
    const createShader = (gl: WebGLRenderingContext, source: string, type: number): WebGLShader => {
      const shader = gl.createShader(type) as WebGLShader;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return shader;
    };

    const createProgram = (gl: WebGLRenderingContext, vertexShaderSource: string, fragmentShaderSource: string): WebGLProgram => {
      const program = gl.createProgram() as WebGLProgram;
      const vs = createShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
      const fs = createShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return program;
    };

    const ar = (m && m.match(/rgb9_e5/i)) 
      ? new Uint8Array(floatToRgb9_e5(rgbeToFloat(HDRdata as Uint8Array)).buffer) 
      : new Uint8Array((HDRdata as Uint8Array).buffer);
      
    const vs2 = 'precision highp float;\nattribute vec3 position;\nvarying vec2 tex;\nvoid main() { tex = position.xy/2.0+0.5; gl_Position = vec4(position, 1.0); }';
    const fs2 = 'precision highp float;\nprecision highp sampler2D;\nuniform sampler2D tx;\nvarying vec2 tex;\nvoid main() { gl_FragColor = texture2D(tx,tex); }';
    const x = this.width;
    const y = this.height;
    
    if (x * y * 4 < ar.byteLength) {
      console.error('not big enough.');
      return;
    }
    
    const c = document.createElement('canvas');
    c.width = x;
    c.height = y;
    const gl = c.getContext('webgl', {
      antialias: false,
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true
    }) as WebGLRenderingContext;

    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(ar.buffer));

    const program = createProgram(gl, vs2, fs2);
    const uniformTexLocation = gl.getUniformLocation(program, 'tx');

    const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, 1, 1, 0, -1, 1, 0, -1, -1, 0]);
    const vertexPosBuffer = gl.createBuffer();
    gl.enableVertexAttribArray(0);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexPosBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.useProgram(program);
    gl.uniform1i(uniformTexLocation as WebGLUniformLocation, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    gl.deleteTexture(texture);
    gl.deleteProgram(program);

    if (cb) {
      c.toBlob(cb);
    }
  };

  Object.defineProperty(res, 'src', {
    get: () => HDRsrc,
    set: (val: string) => {
      HDRsrc = val;
      if (context) {
        context.clearRect(0, 0, res.width, res.height);
      }
      
      if (val.match(/\.hdr$/i)) {
        loadHDR(val, (img: Uint8Array | false, width?: number, height?: number) => {
          if (img === false || width === undefined || height === undefined) return;
          
          HDRdata = img;
          res.width = width;
          res.height = height;
          res.style.width = `${width}px`;
          res.style.height = `${height}px`;
          context = res.getContext('2d');
          if (context) {
            HDRD = context.getImageData(0, 0, width, height);
            rgbeToLDR(img, HDRexposure, HDRgamma, HDRD.data);
            context.putImageData(HDRD, 0, 0);
            if (res.onload) res.onload(new Event('load'));
          }
        });
      } else if (val.match(/\.rgb9_e5\.png$/i)) {
        const i = new Image();
        i.src = val;
        i.onload = function() {
          const c = document.createElement('canvas');
          const x = i.width;
          const y = i.height;
          res.width = x;
          res.height = y;
          res.style.width = `${x}px`;
          res.style.height = `${y}px`;
          c.width = x;
          c.height = y;
          const gl = c.getContext('webgl') as WebGLRenderingContext;

          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, i);
           
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture as WebGLTexture, 0);

          const result = new Uint8Array(x * y * 4);
          gl.readPixels(0, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, result);

          gl.deleteTexture(texture);
          gl.deleteFramebuffer(fb);
          
          res.dataRAW = new Uint32Array(result.buffer);
          HDRdata = floatToRgbe(rgb9_e5ToFloat(res.dataRAW));
          context = res.getContext('2d');
          if (context) {
            HDRD = context.getImageData(0, 0, x, y);
            rgbeToLDR(HDRdata, HDRexposure, HDRgamma, HDRD.data);
            context.putImageData(HDRD, 0, 0);
            if (res.onload) res.onload(new Event('load'));
          }
        };
      } else if (val.match(/\.hdr\.png$|\.rgbe\.png/i)) {
        const i = new Image();
        i.src = val;
        i.onload = function() {
          const c = document.createElement('canvas');
          const x = i.width;
          const y = i.height;
          res.width = x;
          res.height = y;
          res.style.width = `${x}px`;
          res.style.height = `${y}px`;
          c.width = x;
          c.height = y;
          const gl = c.getContext('webgl') as WebGLRenderingContext;

          const texture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, i);
           
          const fb = gl.createFramebuffer();
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture as WebGLTexture, 0);

          const result = new Uint8Array(x * y * 4);
          gl.readPixels(0, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, result);

          gl.deleteTexture(texture);
          gl.deleteFramebuffer(fb);
          
          HDRdata = result;
          context = res.getContext('2d');
          if (context) {
            HDRD = context.getImageData(0, 0, x, y);
            rgbeToLDR(HDRdata, HDRexposure, HDRgamma, HDRD.data);
            context.putImageData(HDRD, 0, 0);
            if (res.onload) res.onload(new Event('load'));
          }
        };
      }
    }
  });
  
  return res;
};

/**
 * Merges properties from object b into object a
 */
const mergeObjects = <T, U>(a: T, b: U): T & U => {
  for (const i in b) {
    (a as any)[i] = (b as any)[i];
  }
  return a as T & U;
};

/**
 * Load and parse a Radiance .HDR file. It completes with a 32bit RGBE buffer.
 * @param {string} url - location of .HDR file to load.
 * @param {function} completion - completion callback.
 * @returns {XMLHttpRequest} the XMLHttpRequest used to download the file.
 */
const loadHDR = (
  url: string, 
  completion: (img: Uint8Array | false, width?: number, height?: number) => void
): XMLHttpRequest => {
  const req = mergeObjects(new XMLHttpRequest(), { responseType: "arraybuffer" });
  
  // Create a proper error handler that passes false to completion
  const handleError = () => {
    completion(false);
  };
  
  req.onerror = handleError;
  req.onload = function() {
    if (this.status >= 400) {
      handleError();
      return;
    }
    
    let header = '';
    let pos = 0;
    const d8 = new Uint8Array(this.response);
    let format: string;
    
    // read header.  
    while (!header.match(/\n\n[^\n]+\n/g)) {
      header += String.fromCharCode(d8[pos++]);
    }
    
    // check format. 
    const formatMatch = header.match(/FORMAT=(.*)$/m);
    if (!formatMatch) {
      console.warn('format not found in header');
      handleError();
      return;
    }
    
    format = formatMatch[1];
    if (format !== '32-bit_rle_rgbe') {
      console.warn('unknown format : ' + format);
      handleError();
      return;
    }
    
    // parse resolution
    const rez = header.split(/\n/).reverse()[1].split(' ');
    const width = parseInt(rez[3], 10);
    const height = parseInt(rez[1], 10);
    
    // Create image.
    const img = new Uint8Array(width * height * 4);
    let ipos = 0;
    
    // Read all scanlines
    for (let j = 0; j < height; j++) {
      const rgbe = d8.slice(pos, pos += 4);
      const scanline: number[] = [];
      
      if (rgbe[0] != 2 || (rgbe[1] != 2) || (rgbe[2] & 0x80)) {
        let len = width;
        let rs = 0;
        pos -= 4;
        
        while (len > 0) {
          img.set(d8.slice(pos, pos += 4), ipos);
          
          if (img[ipos] == 1 && img[ipos + 1] == 1 && img[ipos + 2] == 1) {
            for (let i = img[ipos + 3] << rs; i > 0; i--) {
              img.set(img.slice(ipos - 4, ipos), ipos);
              ipos += 4;
              len--;
            }
            rs += 8;
          } else {
            len--;
            ipos += 4;
            rs = 0;
          }
        }
      } else {
        if ((rgbe[2] << 8) + rgbe[3] != width) {
          console.warn('HDR line mismatch ..');
          handleError();
          return;
        }
        
        for (let i = 0; i < 4; i++) {
          let ptr = i * width;
          const ptr_end = (i + 1) * width;
          
          while (ptr < ptr_end) {
            const buf = d8.slice(pos, pos += 2);
            
            if (buf[0] > 128) {
              let count = buf[0] - 128;
              while (count-- > 0) scanline[ptr++] = buf[1];
            } else {
              let count = buf[0] - 1;
              scanline[ptr++] = buf[1];
              while (count-- > 0) scanline[ptr++] = d8[pos++];
            }
          }
        }
        
        for (let i = 0; i < width; i++) {
          img[ipos++] = scanline[i];
          img[ipos++] = scanline[i + width];
          img[ipos++] = scanline[i + 2 * width];
          img[ipos++] = scanline[i + 3 * width];
        }
      }
    }
    
    completion(img, width, height);
  };
  
  req.open("GET", url, true);
  req.send(null);
  return req;
};

/**
 * Convert a float buffer to a RGB9_E5 buffer.
 * @param {Float32Array} buffer - Floating point input buffer (96 bits/pixel).
 * @param {Uint32Array} [res] - Optional output buffer with 32 bit RGB9_E5 per pixel.
 * @returns {Uint32Array} A 32bit uint32 array in RGB9_E5
 */
const floatToRgb9_e5 = (buffer: Float32Array, res?: Uint32Array): Uint32Array => {
  const l = (buffer.byteLength / 12) | 0;
  const result = res ?? new Uint32Array(l);
  
  for (let i = 0; i < l; i++) {
    const r = Math.min(32768.0, buffer[i * 3]);
    const g = Math.min(32768.0, buffer[i * 3 + 1]);
    const b = Math.min(32768.0, buffer[i * 3 + 2]);
    const maxColor = Math.max(Math.max(r, g), b);
    let ExpShared = Math.max(-16, Math.floor(Math.log2(maxColor))) + 16;
    let denom = Math.pow(2, ExpShared - 24);
    
    if (Math.floor(maxColor / denom + 0.5) == 511) {
      denom *= 2;
      ExpShared += 1;
    }
    
    result[i] = (Math.floor(r / denom + 0.5) << 23) + 
                (Math.floor(g / denom + 0.5) << 14) + 
                (Math.floor(b / denom + 0.5) << 5) + 
                (ExpShared | 0);
  }
  
  return result;
};

/**
 * Convert an RGB9_E5 buffer to a Float buffer.
 * @param {Uint32Array} buffer - Buffer in RGB9_E5 format. (Uint32 buffer).
 * @param {Float32Array} [res] - Optional float output buffer.
 * @returns {Float32Array} A Float32Array.
 */
const rgb9_e5ToFloat = (buffer: Uint32Array, res?: Float32Array): Float32Array => {
  const l = buffer.byteLength >> 2;
  const result = res ?? new Float32Array(l * 3);
  
  for (let i = 0; i < l; i++) {
    const v = buffer[i];
    const s = Math.pow(2, (v & 31) - 24);
    result[i * 3] = (v >>> 23) * s;
    result[i * 3 + 1] = ((v >>> 14) & 511) * s;
    result[i * 3 + 2] = ((v >>> 5) & 511) * s;
  }
  
  return result;
};

/**
 * Convert a float buffer to a RGBE buffer.
 * @param {Float32Array} buffer - Floating point input buffer (96 bits/pixel).
 * @param {Uint8Array} [res] - Optional output buffer with 32 bit RGBE per pixel.
 * @returns {Uint8Array} A 32bit uint8 array in RGBE
 */
const floatToRgbe = (buffer: Float32Array, res?: Uint8Array): Uint8Array => {
  const l = (buffer.byteLength / 12) | 0;
  const result = res ?? new Uint8Array(l * 4);
  
  for (let i = 0; i < l; i++) {
    const r = buffer[i * 3];
    const g = buffer[i * 3 + 1];
    const b = buffer[i * 3 + 2];
    const v = Math.max(Math.max(r, g), b);
    const e = v == 0.5 ? 0 : Math.ceil(Math.log2(v));
    const s = Math.pow(2, e - 8);
    
    result[i * 4] = (r / s) | 0;
    result[i * 4 + 1] = (g / s) | 0;
    result[i * 4 + 2] = (b / s) | 0;
    result[i * 4 + 3] = (e + 128);
  }
  
  return result;
};

/**
 * Convert an RGBE buffer to a Float buffer.
 * @param {Uint8Array} buffer - The input buffer in RGBE format. (as returned from loadHDR)
 * @param {Float32Array} [res] - Optional result buffer containing 3 floats per pixel.
 * @returns {Float32Array} A floating point buffer with 96 bits per pixel (32 per channel, 3 channels).
 */
const rgbeToFloat = (buffer: Uint8Array, res?: Float32Array): Float32Array => {
  const l = buffer.byteLength >> 2;
  const result = res ?? new Float32Array(l * 3);
  
  for (let i = 0; i < l; i++) {
    const s = Math.pow(2, buffer[i * 4 + 3] - (128 + 8));
    result[i * 3] = buffer[i * 4] * s;
    result[i * 3 + 1] = buffer[i * 4 + 1] * s;
    result[i * 3 + 2] = buffer[i * 4 + 2] * s;
  }
  
  return result;
};

/**
 * Convert an RGBE buffer to LDR with given exposure and display gamma.
 * @param {Uint8Array} buffer - The input buffer in RGBE format. (as returned from loadHDR)
 * @param {number} [exposure=1] - Optional exposure value. (1=default, 2=1 step up, 3=2 steps up, -2 = 3 steps down)
 * @param {number} [gamma=2.2] - Optional display gamma to respect. (1.0 = linear, 2.2 = default monitor)
 * @param {Uint8ClampedArray} [res] - Optional result buffer.
 * @returns {Uint8ClampedArray} The LDR result buffer
 */
const rgbeToLDR = (
  buffer: Uint8Array, 
  exposure: number = 1, 
  gamma: number = 2.2, 
  res?: Uint8ClampedArray
): Uint8ClampedArray => {
  const exposureFactor = Math.pow(2, exposure) / 2;
  const one_over_gamma = 1 / gamma;
  const l = buffer.byteLength >> 2;
  const result = res ?? new Uint8ClampedArray(l * 4);
  
  for (let i = 0; i < l; i++) {
    const s = exposureFactor * Math.pow(2, buffer[i * 4 + 3] - (128 + 8));
    result[i * 4] = 255 * Math.pow(buffer[i * 4] * s, one_over_gamma);
    result[i * 4 + 1] = 255 * Math.pow(buffer[i * 4 + 1] * s, one_over_gamma);
    result[i * 4 + 2] = 255 * Math.pow(buffer[i * 4 + 2] * s, one_over_gamma);
    result[i * 4 + 3] = 255;
  }
  
  return result;
};

/**
 * Convert an float buffer to LDR with given exposure and display gamma.
 * @param {Float32Array} buffer - The input buffer in floating point format.
 * @param {number} [exposure=1] - Optional exposure value. (1=default, 2=1 step up, 3=2 steps up, -2 = 3 steps down)
 * @param {number} [gamma=2.2] - Optional display gamma to respect. (1.0 = linear, 2.2 = default monitor)
 * @param {Uint8ClampedArray} [res] - Optional result buffer.
 * @returns {Uint8ClampedArray} The LDR result buffer
 */
const floatToLDR = (
  buffer: Float32Array, 
  exposure: number = 1, 
  gamma: number = 2.2, 
  res?: Uint8ClampedArray
): Uint8ClampedArray => {
  const exposureFactor = Math.pow(2, exposure) / 2;
  const one_over_gamma = 1 / gamma;
  const l = (buffer.byteLength / 12) | 0;
  const result = res ?? new Uint8ClampedArray(l * 4);
  
  for (let i = 0; i < l; i++) {
    result[i * 4] = 255 * Math.pow(buffer[i * 3] * exposureFactor, one_over_gamma);
    result[i * 4 + 1] = 255 * Math.pow(buffer[i * 3 + 1] * exposureFactor, one_over_gamma);
    result[i * 4 + 2] = 255 * Math.pow(buffer[i * 3 + 2] * exposureFactor, one_over_gamma);
    result[i * 4 + 3] = 255;
  }
  
  return result;
};

// Export the main HDRImage constructor and utility functions
export {
  HDRImage,
  floatToRgbe,
  rgbeToFloat,
  floatToRgb9_e5,
  rgb9_e5ToFloat,
  rgbeToLDR,
  floatToLDR
};

// Default export for backward compatibility
export default HDRImage; 