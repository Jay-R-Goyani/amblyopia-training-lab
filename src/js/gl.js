// WebGL2 compositor.
// Games draw two grayscale layers (amblyopic-eye layer A, fellow-eye layer F) in *linear luminance*.
// The shader adds procedural Gabors and noise at float precision, applies gamma encoding,
// noisy-bit dithering, and either outputs grey (monocular mode) or routes each eye's image
// to the red or cyan channel (anaglyph mode) with per-channel leak gains.
import { db } from './store.js';

const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }`;

const FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D uA, uF, uV;
uniform vec2 uCss; uniform float uDpr;
uniform int uMode; uniform float uBgA, uBgF;
uniform float uGamma; uniform vec3 uColA, uColF;
uniform int uNG; uniform vec4 uG0[12]; uniform vec4 uG1[12];
uniform vec4 uNoise; uniform vec4 uNoiseCirc;
uniform int uVideo; uniform vec4 uVid; uniform vec4 uVidRect;
uniform float uTime;
float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float lum(vec4 c){ return dot(c.rgb, vec3(0.2126,0.7152,0.0722)); }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uCss.y*uDpr - gl_FragCoord.y)/uDpr;
  vec2 uv = px/uCss;
  vec4 ca = texture(uA, uv), cf = texture(uF, uv);
  float LA = mix(uBgA, lum(ca), ca.a);
  float LF = mix(uBgF, lum(cf), cf.a);
  if(uVideo==1){
    vec2 vuv = (px-uVidRect.xy)/uVidRect.zw;
    if(vuv.x>=0. && vuv.y>=0. && vuv.x<=1. && vuv.y<=1.){
      float v = pow(clamp(lum(texture(uV, vuv)),0.,1.), 2.2);
      float n = 0.65*vn(px/uVid.w + uVid.z*17.31) + 0.35*vn(px/(uVid.w*0.45) + uVid.z*5.77);
      float m = smoothstep(0.44, 0.56, n);
      float s = uVid.y;
      LA = v * mix(1.0, m, s);
      LF = (0.35 + (v-0.35)*uVid.x) * mix(1.0, 1.0-m, s);
    }
  }
  for(int i=0;i<12;i++){
    if(i>=uNG) break;
    vec4 g0=uG0[i], g1=uG1[i];
    vec2 d = px - g0.xy;
    float env = exp(-dot(d,d)/(2.0*g0.z*g0.z));
    if(env<1e-5) continue;
    float xr = d.x*cos(g1.x) + d.y*sin(g1.x);
    float w = 1.0 + g1.z*env*cos(6.2831853*g0.w*xr + g1.y);
    if(g1.w<0.5) LA*=w; else if(g1.w<1.5) LF*=w; else { LA*=w; LF*=w; }
  }
  if(uNoise.w > -0.5 && length(px-uNoiseCirc.xy) <= uNoiseCirc.z){
    float n = h21(floor(px/uNoise.y) + uNoise.z*13.7) < 0.5 ? -1.0 : 1.0;
    if(uNoise.w < 0.5) LA *= 1.0 + uNoise.x*n; else LF *= 1.0 + uNoise.x*n;
  }
  float dz = (h21(gl_FragCoord.xy + fract(uTime)*97.13) - 0.5)/255.0;
  float g = 1.0/uGamma;
  if(uMode==0){
    float v = pow(clamp(LA,0.,1.), g) + dz;
    o = vec4(vec3(v), 1.0);
  } else {
    // Each eye's image modulates that eye's calibrated colour; the other lens turns it black.
    float va = pow(clamp(LA,0.,1.), g), vf = pow(clamp(LF,0.,1.), g);
    vec3 c = va*uColA + vf*uColF + dz*min(vec3(1.0), uColA + uColF);
    o = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser. Try a recent Chrome, Edge or Firefox.');
    this.gl = gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uA', 'uF', 'uV', 'uCss', 'uDpr', 'uMode', 'uBgA', 'uBgF', 'uGamma', 'uColA', 'uColF', 'uNG', 'uG0', 'uG1', 'uNoise', 'uNoiseCirc', 'uVideo', 'uVid', 'uVidRect', 'uTime']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    this.tex = [0, 1, 2].map(i => {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
      return t;
    });
    gl.uniform1i(this.u.uA, 0); gl.uniform1i(this.u.uF, 1); gl.uniform1i(this.u.uV, 2);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.g0 = new Float32Array(48); this.g1 = new Float32Array(48);
  }

  resize(cssW, cssH) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cssW = cssW; this.cssH = cssH;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = cssW + 'px';
    this.canvas.style.height = cssH + 'px';
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  _upload(unit, source) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  render(p) {
    const gl = this.gl, u = this.u, s = db.settings;
    gl.useProgram(this.prog);
    if (p.layerA) this._upload(0, p.layerA);
    if (p.layerF) this._upload(1, p.layerF);
    const hasVideo = p.video && p.video.readyState >= 2;
    if (hasVideo) this._upload(2, p.video);
    gl.uniform2f(u.uCss, this.cssW, this.cssH);
    gl.uniform1f(u.uDpr, this.dpr);
    gl.uniform1i(u.uMode, p.mode === 'anaglyph' ? 1 : 0);
    gl.uniform1f(u.uBgA, p.bgA ?? 0);
    gl.uniform1f(u.uBgF, p.bgF ?? p.bgA ?? 0);
    gl.uniform1f(u.uGamma, s.gamma || 2.2);
    const fel = s.amblyopicEye === 'left' ? 'right' : 'left';
    const ca = s.lens[s.amblyopicEye].rgb, cf = s.lens[fel].rgb;
    gl.uniform3f(u.uColA, ca[0] / 255, ca[1] / 255, ca[2] / 255);
    gl.uniform3f(u.uColF, cf[0] / 255, cf[1] / 255, cf[2] / 255);
    const gs = (p.gabors || []).slice(0, 12);
    this.g0.fill(0); this.g1.fill(0);
    gs.forEach((g, i) => {
      const eye = g.eye === 'A' ? 0 : g.eye === 'F' ? 1 : 2;
      this.g0.set([g.x, g.y, g.sigma, g.sf], i * 4);
      this.g1.set([g.ori || 0, g.phase || 0, g.contrast, eye], i * 4);
    });
    gl.uniform1i(u.uNG, gs.length);
    gl.uniform4fv(u.uG0, this.g0);
    gl.uniform4fv(u.uG1, this.g1);
    const n = p.noise;
    if (n) {
      gl.uniform4f(u.uNoise, n.contrast, n.cell || 4, n.seed || 0, n.eye === 'A' ? 0 : 1);
      gl.uniform4f(u.uNoiseCirc, n.cx, n.cy, n.r, 0);
    } else gl.uniform4f(u.uNoise, 0, 1, 0, -1);
    gl.uniform1i(u.uVideo, hasVideo ? 1 : 0);
    if (hasVideo) {
      const v = p.videoParams || {};
      gl.uniform4f(u.uVid, v.feContrast ?? 0.3, v.maskStrength ?? 0.8, v.maskSeed ?? 0, v.maskScale ?? 140);
      const r = v.rect || [0, 0, this.cssW, this.cssH];
      gl.uniform4f(u.uVidRect, r[0], r[1], r[2], r[3]);
    }
    gl.uniform1f(u.uTime, (performance.now() / 1000) % 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
