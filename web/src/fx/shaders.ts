import * as THREE from 'three';

/** Combined after-image treatment. It stays disabled when both controls are off. */
export const screenFxShader: THREE.ShaderMaterialParameters = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    resolution: { value: new THREE.Vector2(1, 1) },
    chromaticStrength: { value: 0 },
    grainAmount: { value: 0 },
    vignetteTint: { value: new THREE.Color('#000000') },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float chromaticStrength;
    uniform float grainAmount;
    uniform vec3 vignetteTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec2 center = vUv - 0.5;
      float radial = dot(center, center);
      vec2 shift = center * chromaticStrength * (0.0015 + radial * 0.006);
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - shift).b;

      float noise = hash(gl_FragCoord.xy + time * 61.7) - 0.5;
      color += noise * grainAmount * 0.022;
      float vignette = smoothstep(0.86, 0.18, length(center));
      color = mix(vignetteTint * color, color, 0.88 + vignette * 0.12);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

export const rainVertexShader = /* glsl */ `
  uniform float fogNear;
  uniform float fogFar;
  varying float vFade;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float distanceToCamera = length(mvPosition.xyz);
    vFade = 1.0 - smoothstep(fogNear, fogFar, distanceToCamera);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const rainFragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() {
    gl_FragColor = vec4(color, opacity * vFade);
  }
`;

export const snowVertexShader = /* glsl */ `
  attribute float aSize;
  uniform float fogNear;
  uniform float fogFar;
  varying float vFade;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float distanceToCamera = length(mvPosition.xyz);
    vFade = 1.0 - smoothstep(fogNear, fogFar, distanceToCamera);
    gl_PointSize = clamp(aSize * 10.0 * (260.0 / max(1.0, -mvPosition.z)), 1.0, 18.0);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const snowFragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 color;
  uniform float opacity;
  varying float vFade;
  void main() {
    vec4 sprite = texture2D(map, gl_PointCoord);
    gl_FragColor = vec4(color, opacity * vFade * sprite.a);
  }
`;
