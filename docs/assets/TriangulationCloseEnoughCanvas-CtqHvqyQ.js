import{r,a as n,C as U,R as D,F as E,d as z}from"./index-CeGfPT7k.js";import{u as x,df as p,dg as v,T as g,Z as B,k as S,aN as b,q as y,_ as c,g as A,a as R,bi as W}from"./CanvasText-CBonfVPK.js";const d=e=>e===Object(e)&&!Array.isArray(e)&&typeof e!="function";function h(e,o){const t=x(s=>s.gl),a=p(v,d(e)?Object.values(e):e);return r.useLayoutEffect(()=>{o?.(a)},[o]),r.useEffect(()=>{if("initTexture"in t){let s=[];Array.isArray(a)?s=a:a instanceof g?s=[a]:d(a)&&(s=Object.values(a)),s.forEach(i=>{i instanceof g&&t.initTexture(i)})}},[t,a]),r.useMemo(()=>{if(d(e)){const s={};let i=0;for(const u in e)s[u]=a[i++];return s}else return a},[e,a])}h.preload=e=>p.preload(v,e);h.clear=e=>p.clear(v,e);const O=z("body-attenuation-character.png"),l={width:2.91,height:5.32},m={centerX:0,centerY:-.38},F=`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`,X=`
  uniform float uTime;
  uniform sampler2D uBodyTexture;
  uniform vec4 uBodyRect;
  varying vec2 vUv;

  float sampleBody(vec2 uv) {
    vec2 bodyUv = (uv - uBodyRect.xy) / uBodyRect.zw;
    if (bodyUv.x < 0.0 || bodyUv.x > 1.0 || bodyUv.y < 0.0 || bodyUv.y > 1.0) return 0.0;
    return texture2D(uBodyTexture, bodyUv).a;
  }

  // Distance to nearest body surface pixel (ray-march)
  float distToBodySurface(vec2 uv) {
    if (sampleBody(uv) > 0.15) return 0.0;
    float minDist = 1.0;
    const int samples = 20;
    for (int i = 0; i < samples; i++) {
      float angle = float(i) * 6.28318 / float(samples);
      vec2 dir = vec2(cos(angle), sin(angle));
      for (int j = 1; j < 50; j++) {
        float d = float(j) * 0.009;
        if (sampleBody(uv + dir * d) > 0.15) {
          minDist = min(minDist, d);
          break;
        }
      }
    }
    return minDist;
  }

  // Body edge detection (8-neighbor kernel)
  float bodyEdge(vec2 uv, float radius) {
    float center = sampleBody(uv);
    float maxNeighbor = 0.0;
    for (float dx = -1.0; dx <= 1.0; dx += 1.0) {
      for (float dy = -1.0; dy <= 1.0; dy += 1.0) {
        if (dx == 0.0 && dy == 0.0) continue;
        maxNeighbor = max(maxNeighbor, sampleBody(uv + vec2(dx, dy) * radius));
      }
    }
    return maxNeighbor * (1.0 - center);
  }

  void main() {
    float bodyAlpha = sampleBody(vUv);
    bool insideBody = bodyAlpha > 0.15;

    // Distance from this pixel to body surface
    float surfaceDist = distToBodySurface(vUv);

    // Contour boundary ~30px from body edges
    float contourDist = 0.065;

    float time = uTime;

    float speed = 0.35;
    float progress = mod(time * speed, 2.2) - 0.6;

    // Two Radio wave arc ripples (Double Pulse)
    float arcOffset = 0.25 * pow(abs(vUv.y - 0.5) * 2.0, 2.2);
    float dist1 = (vUv.x + arcOffset) - progress;
    float dist2 = (vUv.x + arcOffset) - (progress - 0.12);

    // Razor-thin wavefront with gentle trailing wake — same smoothstep as BodyAttenuation
    float bodyStrength1 = smoothstep(0.015, 0.0, dist1) * smoothstep(-0.35, 0.0, dist1);
    float bodyStrength2 = smoothstep(0.015, 0.0, dist2) * smoothstep(-0.35, 0.0, dist2);
    float bodyStrength = max(bodyStrength1, bodyStrength2);

    // ── Rippling distortion for volume — same as BodyAttenuation ──
    float ripple1 = sin((surfaceDist * 7.5) - (time * 2.6) + (vUv.y * 2.8));
    float ripple2 = sin((surfaceDist * 13.0) + (vUv.x * 4.0) - (time * 4.2));
    float ripple3 = sin((surfaceDist * 4.0) - (vUv.y * 9.0) + (time * 1.5));
    float ripple = ripple1 * 0.42 + ripple2 * 0.33 + ripple3 * 0.25;
    float wave = ripple * 0.5 + 0.5;

    // ── Edge, falloff, depth — same formulas as BodyAttenuation ──
    float edge = smoothstep(0.02, 0.0, abs(dist1)) + smoothstep(0.02, 0.0, abs(dist2));
    float edgeFalloff = smoothstep(0.18, -0.06, dist1) + smoothstep(0.18, -0.06, dist2);
    float bodyDepth = smoothstep(0.0, 0.78, bodyStrength);

    float fresnel = pow(1.0 - clamp(abs(vUv.y - 0.5) * 1.9, 0.0, 1.0), 2.4);
    float crest = pow(wave, 4.0) * edge * 0.6;
    float trough = (1.0 - wave) * bodyStrength * 0.08;
    float caustics = smoothstep(0.28, 0.96, wave) * bodyStrength * 0.12;

    // Incorporate background lines
    alpha = max(alpha, bgLineAlpha);
    
    alpha *= smoothstep(-0.15, 0.15, vUv.x + arcOffset - progress + 0.5);
    alpha *= smoothstep(1.15, 0.85, vUv.x);
    
    alpha = clamp(alpha, 0.0, 0.95);
    alpha = (bodyStrength * 0.02 + caustics + crest + fresnel * 0.22) * clamp(edgeFalloff, 0.0, 1.0);

    // Suppress wave inside the silhouette
    if (insideBody) {
      alpha = 0.0;
    }

    // Silhouette edge outline glow when wave front is near
    float edgeDetect = bodyEdge(vUv, 0.008);
    float waveFrontX = progress - arcOffset;
    float nearWave = smoothstep(0.4, 0.0, abs(vUv.x - waveFrontX));
    // The outline hits 100% only when the wave is exactly wiping over it
    float outlineAlpha = edgeDetect * nearWave * 0.9;

    // Purple force field palette
    vec3 darkCore = vec3(0.04, 0.02, 0.06);
    vec3 midTone = vec3(0.38, 0.18, 0.6); 
    vec3 brightEdge = vec3(0.85, 0.6, 0.98); 
    vec3 hotWhite = vec3(1.0, 0.92, 1.0); 

    vec3 waveBody = mix(darkCore, midTone, wave * 0.5 + bodyDepth * 0.3);
    vec3 edgeGlow = mix(midTone, brightEdge, fresnel * 0.8 + crest * 1.0);
    vec3 color = mix(waveBody, edgeGlow, clamp(fresnel + crest * 0.9, 0.0, 1.0));
    color += hotWhite * edge * 0.35;
    color += vec3(0.03) * trough;
    color = mix(color, lineColor, bgLineAlpha);

    // Replace outline color with iridescent-to-white sweep
    // Same iridescent soap bubble core palette used in the text
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.00, 0.33, 0.67);
    float paletteInput = vUv.x * 0.5 - time * 0.8;
    vec3 iridescentOutline = a + b * cos(6.28318 * (c * paletteInput + d));
    
    // Core of the contour is pure white, edge bleeds into iridescence
    float coreHighlight = smoothstep(0.2, 0.0, abs(vUv.x - waveFrontX));
    vec3 outlineColor = mix(iridescentOutline, vec3(1.0, 1.0, 1.0), coreHighlight);
    
    // Mathematically correct semi-transparent blending (avoids making low-alpha edges appear black/muddy)
    float finalAlpha = clamp(alpha + outlineAlpha, 0.0, 0.95);
    if (finalAlpha > 0.0) {
      color = mix(color, outlineColor, outlineAlpha / finalAlpha);
    }

    gl_FragColor = vec4(color, finalAlpha);
  }
`,j=({bodyTexture:e})=>{const o=r.useRef(null),t=r.useMemo(()=>{const a=m.centerX,f=m.centerY,s=l.width/2,i=l.height/2,u=(a-s+5)/10,C=(f-i+3.25)/6.5,w=l.width/10,T=l.height/6.5;return{uTime:{value:0},uBodyTexture:{value:e},uBodyRect:{value:new A(u,C,w,T)}}},[e]);return r.useEffect(()=>{o.current&&(o.current.uniforms.uBodyTexture.value=e)},[e]),R(a=>{o.current&&(o.current.uniforms.uTime.value=a.clock.elapsedTime)}),n("mesh",{position:[0,0,-.5],frustumCulled:!1,children:[n("planeGeometry",{args:[10,6.5]},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:210,columnNumber:7},void 0),n("shaderMaterial",{ref:o,uniforms:t,vertexShader:F,fragmentShader:X,transparent:!0,depthWrite:!1,blending:W},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:211,columnNumber:7},void 0)]},void 0,!0,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:209,columnNumber:7},void 0)},k=({texture:e})=>n("group",{position:[m.centerX,m.centerY,.2],children:n("mesh",{children:[n("planeGeometry",{args:[l.width,l.height]},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:228,columnNumber:9},void 0),n("meshBasicMaterial",{map:e,transparent:!0,alphaTest:.1,depthWrite:!1},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:229,columnNumber:9},void 0)]},void 0,!0,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:227,columnNumber:7},void 0)},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:226,columnNumber:5},void 0),Y=()=>{const e=h(O),{camera:o}=x();return r.useEffect(()=>{if(o.type==="OrthographicCamera"){const t=o;t.zoom=1,t.updateProjectionMatrix()}},[o]),r.useEffect(()=>{e.colorSpace=S,e.anisotropy=8,e.wrapS=b,e.wrapT=b,e.minFilter=y,e.magFilter=y,e.generateMipmaps=!1,e.needsUpdate=!0},[e]),n(E,{children:[n(j,{bodyTexture:e},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:265,columnNumber:7},void 0),n(k,{texture:e},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:266,columnNumber:7},void 0),n(c,{position:[-4.2,2.62,.35],fontSize:.24,color:"#1e1e26",anchorX:"left",anchorY:"middle",fontWeight:700,text:"Endpoint A (Tx)"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:268,columnNumber:7},void 0),n(c,{position:[-4.2,2.37,.35],fontSize:.17,color:"#3a3a42",anchorX:"left",anchorY:"middle",fontWeight:500,text:"Tx Power: +24.0 dBm"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:269,columnNumber:7},void 0),n(c,{position:[0,2.55,.35],fontSize:.26,color:"#1a1a22",anchorX:"center",anchorY:"middle",fontWeight:700,text:"Target"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:271,columnNumber:7},void 0),n(c,{position:[4.2,2.62,.35],fontSize:.24,color:"#1e1e26",anchorX:"right",anchorY:"middle",fontWeight:700,text:"Endpoint B (Rx)"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:273,columnNumber:7},void 0),n(c,{position:[4.2,2.37,.35],fontSize:.17,color:"#3a3a42",anchorX:"right",anchorY:"middle",fontWeight:500,text:"Rx Power: -48.0 dBm"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:274,columnNumber:7},void 0),n(c,{position:[-4.2,-2.18,.45],fontSize:.26,color:"#1a1a22",anchorX:"left",anchorY:"middle",fontWeight:900,letterSpacing:-.02,text:"13.56 MHz"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:276,columnNumber:7},void 0),n(c,{position:[-4.2,-2.45,.45],fontSize:.15,color:"#3a3a42",anchorX:"left",anchorY:"middle",fontWeight:500,letterSpacing:-.01,text:"RF frequency"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:277,columnNumber:7},void 0)]},void 0,!0,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:264,columnNumber:5},void 0)};function N(){return n(U,{aspectRatio:"10 / 6.4",children:n("div",{style:{width:"100%",height:"100%",position:"relative"},children:[n("div",{style:{position:"absolute",top:-9999,left:-9999,visibility:"hidden"},children:[n("span",{children:"Endpoint A (Tx)"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:287,columnNumber:11},this),n("span",{children:"Endpoint B (Rx)"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:288,columnNumber:11},this),n("span",{children:"+24.0 dBm"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:289,columnNumber:11},this),n("span",{children:"-48.0 dBm"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:290,columnNumber:11},this),n("span",{children:"tx distance"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:291,columnNumber:11},this),n("span",{children:"rx distance"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:292,columnNumber:11},this),n("span",{children:"frequency"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:293,columnNumber:11},this),n("span",{children:"13.56 MHz"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:294,columnNumber:11},this),n("span",{children:"total path loss"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:295,columnNumber:11},this),n("span",{children:"drag inside the panel to move the target cursor"},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:296,columnNumber:11},this)]},void 0,!0,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:286,columnNumber:9},this),n(B,{orthographic:!0,dpr:[1,2],camera:{position:[0,0,10]},gl:{antialias:!0,alpha:!0},style:{cursor:"default",touchAction:"none"},children:n(D.Suspense,{fallback:null,children:n(Y,{},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:300,columnNumber:13},this)},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:299,columnNumber:11},this)},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:298,columnNumber:9},this)]},void 0,!0,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:285,columnNumber:7},this)},void 0,!1,{fileName:"/Users/ceanelamerez/Documents/codescratch.nosync/n-apt/src/md-preview/components/canvas/TriangulationCloseEnoughCanvas.tsx",lineNumber:284,columnNumber:5},this)}const H=Object.freeze(Object.defineProperty({__proto__:null,TriangulationCloseEnoughCanvas:N,default:N},Symbol.toStringTag,{value:"Module"}));export{N as T,H as a,h as u};
