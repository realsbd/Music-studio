import * as THREE from 'three';

// Two continuous plumes, rendered in one draw call. Each wisp has its own
// lifetime, expansion and turbulence; there are no image downloads or sprites
// to decode. Normal alpha blending keeps smoke from looking like a glow.
export function createSmoke(emitters, { compact = false } = {}) {
  const perEmitter = compact ? 36 : 56;
  const count = emitters.length * perEmitter;
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = plane.index;
  geometry.attributes.position = plane.attributes.position;
  geometry.attributes.uv = plane.attributes.uv;
  geometry.instanceCount = count;

  let seed = 72831;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const origins = new Float32Array(count * 3);
  const seeds = new Float32Array(count * 4);
  emitters.forEach((emitter, index) => {
    for (let i = 0; i < perEmitter; i++) {
      const particle = index * perEmitter + i;
      origins.set(emitter.position, particle * 3);
      seeds.set([(i + random() * 0.5) / perEmitter, 6.2 + random() * 1.4, random() * 100, 0.8 + random() * 0.4], particle * 4);
    }
  });
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

  // A small repeating noise lookup avoids expensive trigonometric hashes in
  // the fragment shader. Smooth interpolation and several scales make wisps,
  // rather than visible dots or a stack of round puffs.
  const noiseSize = 64;
  const noiseData = new Uint8Array(noiseSize * noiseSize);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.floor(random() * 256);
  const noiseTexture = new THREE.DataTexture(noiseData, noiseSize, noiseSize, THREE.RedFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.minFilter = noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.generateMipmaps = false;
  noiseTexture.needsUpdate = true;

  const material = new THREE.ShaderMaterial({
    name: 'Rising smoke',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 8 },
      uNoise: { value: noiseTexture },
      uDensity: { value: compact ? 0.34 : 0.25 },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin;
      attribute vec4 aSeed;
      uniform float uTime;
      varying vec2 vUv;
      varying float vAge;
      varying float vSeed;
      varying float vFade;

      void main() {
        float life = fract(uTime / aSeed.y + aSeed.x);
        float age = life * aSeed.y;
        float height = age * 0.185 + 0.04 * sqrt(age);
        float spread = pow(life, 1.35);
        float phase = aOrigin.x * 3.7;
        // Buoyant rise, a shared gentle draft, then increasingly loose curls.
        float curl = height * 4.2 - uTime * 0.68 + phase;
        vec3 center = aOrigin;
        center.y += height;
        center.x += spread * (0.16 * sin(curl) + 0.075 * sin(curl * 1.73 + phase));
        center.x += spread * 0.16 + spread * 0.025 * sin(aSeed.z + age);
        center.z += spread * (0.13 * cos(curl * 0.83) + 0.025 * sin(aSeed.z));

        float size = (0.035 + 0.43 * pow(life, 0.9)) * aSeed.w;
        float angle = aSeed.z + age * (0.08 + 0.1 * sin(aSeed.z));
        mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
        vec2 offset = rotation * (position.xy * vec2(size, size * 1.45));
        // Expand in camera space, so walking around never exposes a flat edge.
        vec4 viewCenter = modelViewMatrix * vec4(center, 1.0);
        vec4 viewPosition = viewCenter + vec4(offset, 0.0, 0.0);
        gl_Position = projectionMatrix * viewPosition;

        vUv = uv;
        vAge = life;
        vSeed = aSeed.z;
        vFade = smoothstep(0.0, 0.055, life) * (1.0 - smoothstep(0.45, 1.0, life));
        // Dissolve before the ceiling and when the camera approaches a plume.
        vFade *= 1.0 - smoothstep(2.30, 2.63, center.y);
        vFade *= smoothstep(0.12, 0.55, -viewCenter.z);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDensity;
      uniform sampler2D uNoise;
      varying vec2 vUv;
      varying float vAge;
      varying float vSeed;
      varying float vFade;

      float noise(vec2 point) {
        vec2 cell = floor(point);
        vec2 fraction = fract(point);
        fraction = fraction * fraction * (3.0 - 2.0 * fraction);
        return texture2D(uNoise, (cell + fraction + 0.5) / 64.0).r;
      }

      float fbm(vec2 point) {
        return noise(point) * 0.57
          + noise(point * 2.07 + 13.1) * 0.28
          + noise(point * 4.13 + 7.7) * 0.15;
      }

      void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        vec2 flow = vec2(vSeed, -uTime * 0.2);
        vec2 warp = vec2(fbm(uv * 2.2 + flow), fbm(uv * 2.2 + flow + 19.4)) - 0.5;
        vec2 curled = uv + warp * 0.55;
        float density = fbm(curled * 3.5 + flow + vec2(0.0, -vAge * 1.8));
        float edge = 1.0 - smoothstep(0.35, 1.0, length(uv));
        float body = exp(-dot(curled, curled) * 2.5);
        float filaments = smoothstep(0.23, 0.78, density);
        float alpha = edge * body * filaments * vFade * uDensity;
        if (alpha < 0.001) discard;
        vec3 color = mix(vec3(0.40, 0.43, 0.46), vec3(0.80, 0.80, 0.77), density);
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Animated desk smoke';
  mesh.frustumCulled = false; // Positions are generated in the vertex shader.
  mesh.raycast = () => {}; // Decorative smoke must never intercept a hotspot.

  return {
    mesh,
    update(delta, reducedMotion = false) {
      if (!reducedMotion) material.uniforms.uTime.value += delta;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
      noiseTexture.dispose();
    },
  };
}
