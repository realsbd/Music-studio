import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSmoke } from './smoke.js';
import { createCameraCollision } from './camera-collision.js';
import { createStudioAtmosphere } from './studio-atmosphere.js';
import { loadStudioModel } from './model-loader.js';
import { updateLoading, showLoadError, finishLoading } from './loading.js';

// =====================================================================
// INTERIOR CONFIG
// =====================================================================
// Music_studio.glb is authored in metres and already sits with its floor
// at y = 0, so it is added to the scene WITHOUT any scaling or recentering.
// Every number below is a real world-space coordinate inside the room.
//
// Measured from the GLB (node bounding boxes, in model space):
//   floor        y =  0.00      ceiling (Roof)  y =  2.78
//   left wall    x = -3.82      right wall      x = +3.82   (picture frames sit flush)
//   back wall    z = -5.52      front wall      z = +3.40   (Studio_Block)
//   booth glass  z = -5.90      booth interior  z = -7.81 .. -5.59
//
// So the navigable interior volume is roughly
//   x -3.8..3.8   y 0..2.78   z -5.5..3.35
// =====================================================================
const ROOM = {
  // Hard limits the camera is kept inside (walls inset by a small margin
  // so the near plane never pokes through a surface).
  camMin:    new THREE.Vector3(-3.55, 0.45, -5.15),
  camMax:    new THREE.Vector3( 3.55, 2.58,  3.10),
  // The orbit pivot may sit right on a wall (you look AT the painting), it
  // just must not run off to infinity when panning. So this box is the wall
  // surfaces themselves, slightly wider than the camera box.
  targetMin: new THREE.Vector3(-3.80, 0.30, -5.55),
  targetMax: new THREE.Vector3( 3.80, 2.72,  3.30),
  // Opening view: standing by the sofa at eye level, looking down the room
  // toward the producer desk, mixing desk, TV and the vocal booth beyond.
  eyeHeight:   1.68,
  startCam:    new THREE.Vector3(0.00, 1.68,  2.70),  // clear of the diffuser above the sofa
  defaultCam:  new THREE.Vector3(0.00, 1.68,  2.45),
  defaultLook: new THREE.Vector3(0.00, 1.30, -1.35),
  // Orbit radius limits. Anything beyond the room is caught by the position
  // clamp in keepInsideRoom(), so the camera slides along a wall instead of
  // passing through it.
  minDistance: 0.40,
  maxDistance: 4.60,
  // Walk speed in metres/second (hold Shift to move faster).
  walkSpeed:      2.20,
  walkSpeedFast:  4.50
};

// =====================================================================
// HOTSPOTS
// Mapped to named GLB objects, with positions taken from the real node
// bounding boxes and nudged clear of the surface they sit on:
//   beatstars  → macBook     (0.14, 1.06, -0.74)  producer desk, Table_2
//   phone      → Iphone18   (-0.33, 0.91, -0.61)  beside the macBook
//   computer   → Monitor     (0.00, 1.09, -4.22)  mixing desk, Table1
//   tv         → TV         (-0.01, 2.25, -5.40)  back wall above the booth
//   painting   → Frame.005   (3.82, 1.96, -1.70)  right wall, clear sightline
//
// Every cameraPos below is a point inside the room, at eye level, clear of
// the chairs, desks, guitars and boom stand.
// SHIFT+CLICK any surface to print its exact world coords to the console.
// =====================================================================
const HOTSPOTS = [
  {
    id: 'beatstars',
    label: 'Beat Store  •  macBook',
    position:     new THREE.Vector3( 0.14, 1.42, -0.74),  // floating above the macBook
    cameraPos:    new THREE.Vector3( 0.25, 1.52,  0.72),
    cameraLookAt: new THREE.Vector3( 0.14, 1.15, -0.74)
  },
  {
    id: 'tv',
    label: 'Catalogue & Credits  •  TV',
    position:     new THREE.Vector3( 0.00, 2.25, -5.05),  // in front of the screen
    cameraPos:    new THREE.Vector3( 0.00, 2.08, -2.70),
    cameraLookAt: new THREE.Vector3(-0.01, 2.25, -5.35)
  },
  {
    id: 'computer',
    label: 'Bio & Services  •  Monitor',
    position:     new THREE.Vector3( 0.00, 1.32, -3.98),  // in front of the monitor
    cameraPos:    new THREE.Vector3( 0.00, 1.48, -2.45),
    cameraLookAt: new THREE.Vector3( 0.00, 1.12, -4.20)
  },
  {
    id: 'painting',
    label: 'Gallery  •  Frames',
    position:     new THREE.Vector3( 3.60, 1.96, -1.70),  // off the right wall
    cameraPos:    new THREE.Vector3( 2.05, 1.92, -1.70),
    cameraLookAt: new THREE.Vector3( 3.78, 1.96, -1.70)
  },
  {
    id: 'phone',
    label: 'Contact  •  iPhone',
    position:     new THREE.Vector3(-0.33, 1.20, -0.61),  // above the phone on the desk
    cameraPos:    new THREE.Vector3(-0.33, 1.72,  0.62),
    cameraLookAt: new THREE.Vector3(-0.33, 0.93, -0.61)
  }
];

const VIDEO_CATALOGUE = [
  {
    label: '8 Years',
    videos: [
      'https://www.youtube.com/watch?v=6KfKKQSNewo',
      'https://www.youtube.com/watch?v=aau1r5nixlU',
      'https://www.youtube.com/watch?v=E4uYZWGomLA',
      'https://www.youtube.com/watch?v=gp0xLXGsAao',
      'https://www.youtube.com/watch?v=bAcZUE7apFQ',
      'https://www.youtube.com/watch?v=AYRSxKCf_oE',
      'https://www.youtube.com/watch?v=PoQ_270Bcjc',
      'https://www.youtube.com/watch?v=6U9Fmet-1So',
      'https://www.youtube.com/watch?v=YMqIGJ7iIXY&list=RDYMqIGJ7iIXY&start_radio=1',
    ],
  },
  {
    label: '7 Years',
    videos: [
      'https://www.youtube.com/watch?v=w19fN6PEkFM',
      'https://www.youtube.com/watch?v=iIZfWbR3PJE',
      'https://www.youtube.com/watch?v=I_UOpZbK6VA',
      'https://www.youtube.com/watch?v=h18fT5jhQ-c',
      'https://www.youtube.com/watch?v=qHvM_--B4Ik',
      'https://www.youtube.com/watch?v=_skg4Nc0RHU',
      'https://www.youtube.com/watch?v=ZlzKQNiQyqI',
      'https://www.youtube.com/watch?v=TL19AOJttbU',
      'https://www.youtube.com/watch?v=7ud4i71og0M',
      'https://www.youtube.com/watch?v=5rJCuZ2uSGw',
    ],
  },
  {
    label: '6 Years',
    videos: [
      'https://www.youtube.com/watch?v=NP3Ycfko6lk',
      'https://www.youtube.com/watch?v=ZrwYUawx6WQ',
      'https://www.youtube.com/watch?v=pqOXAkRlq28',
      'https://www.youtube.com/watch?v=Ziu2d6jmfdo',
      'https://www.youtube.com/watch?v=ukDsQfpTpYk',
      'https://www.youtube.com/watch?v=80I_erS1OgU',
      'https://www.youtube.com/watch?v=isYsNRpy6-g',
      'https://www.youtube.com/watch?v=gqOGle7Qwcs',
      'https://www.youtube.com/watch?v=0TU2V5tibMc',
      'https://www.youtube.com/watch?v=MTIXSq1nsY4',
      'https://www.youtube.com/watch?v=FmevpD4Tokk',
      'https://www.youtube.com/watch?v=SP2vIHPN8o4',
      'https://www.youtube.com/watch?v=A8bm91lpPTQ',
      'https://www.youtube.com/watch?v=aBwBCSIP8QU',
      'https://www.youtube.com/watch?v=-sKYMXgE9Wk',
      'https://www.youtube.com/watch?v=dnD560tnME4',
      'https://www.youtube.com/watch?v=0FBbVw5Ja6k',
      'https://www.youtube.com/watch?v=bhRiju5Dkkw',
      'https://www.youtube.com/watch?v=gBCJahmrcp8',
      'https://www.youtube.com/watch?v=8V0WB2KJmRE',
      'https://www.youtube.com/watch?v=WOM24-mgzFI',
      'https://www.youtube.com/watch?v=bdnYnYivDho',
      'https://www.youtube.com/watch?v=ScK7ghkokyQ',
      'https://www.youtube.com/watch?v=TTu2boWalk4',
      'https://www.youtube.com/watch?v=yEIe7N7iLjw',
      'https://www.youtube.com/watch?v=rUa6FEhGN1w',
      'https://www.youtube.com/watch?v=ZKh6MMyQyyk',
      'https://www.youtube.com/watch?v=JDkqLhRt6h0',
      'https://www.youtube.com/watch?v=Zlk_HAjqTOM&list=RDZlk_HAjqTOM&start_radio=1',
      'https://www.youtube.com/watch?v=uH9dFtDCMC4&list=RDuH9dFtDCMC4&start_radio=1',
    ],
  },
  {
    label: '5 Years',
    videos: [
      'https://www.youtube.com/watch?v=Ro66KTeoQ8M',
      'https://www.youtube.com/watch?v=jSS5spZmDNs',
      'https://www.youtube.com/watch?v=wRC8SaSvPPM',
      'https://www.youtube.com/watch?v=oYmi231nI_U',
      'https://www.youtube.com/watch?v=AfCuyGljIoE',
      'https://www.youtube.com/watch?v=Zlk_HAjqTOM',
      'https://www.youtube.com/watch?v=ZdWr7lRQ2N8',
      'https://www.youtube.com/watch?v=EnWCMS9ARdo',
      'https://www.youtube.com/watch?v=uH9dFtDCMC4',
      'https://www.youtube.com/watch?v=z7mMMTnXc_4',
      'https://www.youtube.com/watch?v=M1-48IgkmF8',
      'https://www.youtube.com/watch?v=k5sydUOoAlY',
    ],
  },
  {
    label: '4 Years',
    videos: [
      'https://www.youtube.com/watch?v=mvM-NWZR3Nc',
      'https://www.youtube.com/watch?v=n5Naz6nnBRY',
      'https://www.youtube.com/watch?v=dgND2xKk2-o',
      'https://www.youtube.com/watch?v=q-CkWV3wKsA',
      'https://www.youtube.com/watch?v=j0WSRNiQYA0',
      'https://www.youtube.com/watch?v=5ssYg-Xz1dI',
      'https://www.youtube.com/watch?v=fDqNXcKoEIQ',
      'https://www.youtube.com/watch?v=z87odR623YA',
      'https://www.youtube.com/watch?v=-ea2sBWvtXE',
    ],
  },
  {
    label: '3 Years',
    videos: [
      'https://www.youtube.com/watch?v=UmtgjYDK85Y',
      'https://www.youtube.com/watch?v=hzLjPUeWaiM',
      'https://www.youtube.com/watch?v=PI_u7yYus2s',
      'https://www.youtube.com/watch?v=QC-9Ujv4dM8',
    ],
  },
];

function renderVideoCatalogue() {
  return `
    <div class="video-catalogue">
      ${VIDEO_CATALOGUE.map((group, groupIndex) => `
        <details class="video-year-group" ${groupIndex === 0 ? 'open' : ''}>
          <summary>
            <span class="video-year-label">${group.label}</span>
            <span class="video-year-count">${group.videos.length} videos</span>
            <span class="video-year-chevron" aria-hidden="true"></span>
          </summary>
          <div class="video-link-grid">
            ${group.videos.map((url, videoIndex) => `
              <a
                class="video-link-card"
                href="${url}"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="${group.label}, video ${videoIndex + 1}: open on YouTube"
              >
                <span class="video-play" aria-hidden="true"></span>
                <span class="video-link-copy">
                  <strong>Video ${String(videoIndex + 1).padStart(2, '0')}</strong>
                  <span>Watch on YouTube</span>
                </span>
              </a>
            `).join('')}
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

// =====================================================================
// OVERLAY CONTENT MAP
// =====================================================================
const OVERLAY_CONTENT = {
  beatstars: `
    <button class="back-btn" id="back-btn">← Back</button>
    <h2>Beat Store</h2>
    <p>Browse and license exclusive G.LO Beatz directly from the store. Premium instrumentals crafted for artists looking for something different.</p>
    <div class="iframe-placeholder">
      <p>BeatStars Player</p>
      <small>Replace this with your BeatStars embed code</small>
      <a href="https://www.beatstars.com" target="_blank" class="btn">Visit Beat Store →</a>
    </div>
  `,
  tv: `
    <button class="back-btn" id="back-btn">← Back</button>
    <h2>Catalogue &amp; Credits</h2>
    <p>Record Producer with a vision, I don't go to work, I put in work I'm the difference. Browse through my catalogue, browse through Toronto history.</p>
    ${renderVideoCatalogue()}
  `,
  computer: `
    <button class="back-btn" id="back-btn">← Back</button>
    <h2>Bio &amp; Services</h2>
    <div class="bio-section">
      <p>Welcome to the studio — a creative sanctuary where sound becomes art. With years of experience crafting chart-ready records, this space is built for artists who refuse to compromise. From concept to final master, every project receives the full attention it deserves.</p>
      <p>The studio is equipped with industry-standard gear, premium acoustics, and a workflow designed to bring out the best in every artist who walks through the door.</p>
    </div>
    <div class="services-grid">
      <div class="service-card">
        <div class="service-icon">🎙️</div>
        <div class="service-name">Recording</div>
        <p class="service-desc">Professional vocal and instrument recording sessions in an acoustically treated environment.</p>
      </div>
      <div class="service-card">
        <div class="service-icon">🎚️</div>
        <div class="service-name">Mixing</div>
        <p class="service-desc">Precision stereo mixing that balances every element for a polished, radio-ready sound.</p>
      </div>
      <div class="service-card">
        <div class="service-icon">💿</div>
        <div class="service-name">Mastering</div>
        <p class="service-desc">Final mastering to ensure your track sounds incredible on every platform and device.</p>
      </div>
      <div class="service-card">
        <div class="service-icon">🎹</div>
        <div class="service-name">Beat Production</div>
        <p class="service-desc">Custom beat creation across all genres — trap, R&amp;B, hip-hop, afrobeats, and beyond.</p>
      </div>
    </div>
  `,
  painting: `
    <button class="back-btn" id="back-btn">← Back</button>
    <h2>Gallery</h2>
    <p>A visual archive of moments, art, and creative milestones.</p>
    <div class="gallery-grid">
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
      <div class="gallery-slot">
        <div class="plus">+</div>
        <div class="slot-label">Add Image</div>
      </div>
    </div>
  `,
  phone: `
    <button class="back-btn" id="back-btn">← Back</button>
    <h2>Contact</h2>
    <p>Ready to lock in? Reach out and let's make it happen.</p>
    <form class="contact-form" id="contact-form">
      <input type="text" placeholder="Your Name" required />
      <input type="email" placeholder="Your Email" required />
      <textarea placeholder="Your Message" rows="4"></textarea>
      <button type="submit" class="btn">Send Message</button>
    </form>
    <div class="social-links">
      <!-- Instagram -->
      <a href="#" target="_blank" class="social-link" title="Instagram">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
        </svg>
      </a>
      <!-- X / Twitter -->
      <a href="#" target="_blank" class="social-link" title="X / Twitter">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.253 5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      </a>
      <!-- YouTube -->
      <a href="#" target="_blank" class="social-link" title="YouTube">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      </a>
    </div>
  `
};

// =====================================================================
// DOM REFS
// =====================================================================
const canvasContainer = document.getElementById('canvas-container');
const tooltip         = document.getElementById('tooltip');
const overlay         = document.getElementById('overlay');
const overlayContent  = document.getElementById('overlay-panel-content');
const hudHint         = document.getElementById('hud-hint');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const compactDevice = window.matchMedia('(max-width: 768px)').matches || (navigator.deviceMemory ?? 8) <= 4;
if (window.matchMedia('(pointer: coarse)').matches) {
  const hints = ['Drag to look', 'Pinch to zoom', 'Tap orbs'];
  hudHint.querySelectorAll('span').forEach((span, index) => { span.textContent = hints[index]; });
}

// =====================================================================
// SCENE
// =====================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070a);

// =====================================================================
// RENDERER
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactDevice ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
// Shadows stay off: five point lights would
// each need a 6-face cube shadow pass. Interior light comes from the ceiling
// panels plus the environment map below.
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
canvasContainer.appendChild(renderer.domElement);

const maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

// =====================================================================
// INTERIOR LIGHTING
// =====================================================================
// Soft indoor environment so the clearcoat / specular / anisotropic materials
// in the GLB (glass, screens, metal, lacquered wood) actually read.
const pmrem = new THREE.PMREMGenerator(renderer);
const roomEnv = new RoomEnvironment(renderer);
scene.environment = pmrem.fromScene(roomEnv, 0.04).texture;
roomEnv.dispose();
pmrem.dispose();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
scene.add(ambientLight);
scene.add(new THREE.HemisphereLight(0xaec6ff, 0x2a1f14, 0.35));

// The five emissive ceiling panels baked into the GLB. These coordinates are
// the exact world centres of the Light / Light.00x / Light-booth nodes, which
// only line up because the model is no longer rescaled or offset.
const studioLights = [
  { name: 'Light',       pos: [ 2.36, 2.57, -3.40], color: 0xfff5e0, intensity: 7 },
  { name: 'Light.004',   pos: [-1.69, 2.53, -3.42], color: 0xfff5e0, intensity: 7 },
  { name: 'Light.001',   pos: [-2.45, 2.57,  0.62], color: 0xfff5e0, intensity: 7 },
  { name: 'Light.002',   pos: [ 2.25, 2.57,  0.74], color: 0xfff5e0, intensity: 7 },
  { name: 'Light-booth', pos: [ 0.14, 2.49, -6.64], color: 0xfff0cc, intensity: 8 }
];
const ceilingLights = studioLights.map(({ name, pos, color, intensity }) => {
  const pl = new THREE.PointLight(color, intensity, 10, 2);
  pl.name = name;
  pl.position.set(...pos);
  scene.add(pl);
  return pl;
});

// Warm bounce off the back wall, behind the mixing desk.
const deskGlow = new THREE.PointLight(0xffb866, 2.8, 5, 2);
deskGlow.position.set(0, 1.5, -4.6);
scene.add(deskGlow);

// =====================================================================
// CAMERA — starts INSIDE the studio at standing eye level
// =====================================================================
// Near plane is tight (0.05) because the camera can get within ~0.3 m of a wall.
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 120);
camera.position.copy(ROOM.startCam);
camera.lookAt(ROOM.defaultLook);

// A faint light riding the camera so dark corners are never pitch black.
const headLight = new THREE.PointLight(0xffe8c8, 1.5, 6, 2);
camera.add(headLight);
scene.add(camera);

const defaultCameraPos = ROOM.defaultCam.clone();
const defaultLookAt    = ROOM.defaultLook.clone();

// =====================================================================
// VIEW STATE
// =====================================================================
let activeHotspot   = null;   // id of the open hotspot, or null
let isTransitioning = false;  // true only while the camera is easing somewhere
let hudHidden       = false;

// =====================================================================
// CONTROLS — orbit + pan + WASD walk, confined to the room interior
// =====================================================================
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping      = true;
controls.dampingFactor      = 0.08;
controls.rotateSpeed        = 0.75;
controls.zoomSpeed          = 1.0;
controls.panSpeed           = 0.9;
controls.screenSpacePanning = true;
controls.minDistance        = ROOM.minDistance;
controls.maxDistance        = ROOM.maxDistance;
// Stop short of straight up / straight down so you cannot tumble through the
// floor or the ceiling. The hard clamp in keepInsideRoom() is the backstop.
controls.minPolarAngle      = 0.45;
controls.maxPolarAngle      = 2.30;
controls.target.copy(defaultLookAt);
controls.update();

const collision = createCameraCollision({
  radius: 0.20,
  bounds: new THREE.Box3(ROOM.camMin, ROOM.camMax),
});
const previousCameraPosition = camera.position.clone();

// Sweep from the last safe position, including controls updates triggered
// directly by wheel/touch events between animation frames.
function keepInsideRoom() {
  controls.target.clamp(ROOM.targetMin, ROOM.targetMax);
  collision.resolve(previousCameraPosition, camera.position);
  previousCameraPosition.copy(camera.position);
  camera.lookAt(controls.target);
}
controls.addEventListener('change', keepInsideRoom);

// =====================================================================
// CAMERA TRANSITIONS
// =====================================================================
// Duration-based, not a per-frame lerp. A `position.lerp(target, 0.06)` takes
// ~65 frames to settle, which is half a second at 120fps but over ten seconds
// on a weak GPU — and the overlay used to open on a fixed 900ms timer, so on a
// slow machine the panel appeared while the camera was still flying. Easing
// over wall-clock time and firing the callback on arrival fixes both.
const TRANSITION_MS       = 900;
const INTRO_TRANSITION_MS = 1600;

let transition = null;

function startTransition(toPos, toTarget, ms = TRANSITION_MS, onArrive = null) {
  transition = {
    fromPos:    camera.position.clone(),
    fromTarget: controls.target.clone(),
    toPos:      toPos.clone(),
    toTarget:   toTarget.clone(),
    start:      performance.now(),
    duration:   motionPreference.matches ? 1 : Math.max(1, ms),
    onArrive
  };
  isTransitioning = true;
}

function updateTransition() {
  if (!transition) return;

  const k = Math.min(1, (performance.now() - transition.start) / transition.duration);
  // easeInOutCubic
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;

  camera.position.lerpVectors(transition.fromPos,    transition.toPos,    e);
  controls.target.lerpVectors(transition.fromTarget, transition.toTarget, e);

  if (k >= 1) {
    const { onArrive } = transition;
    transition = null;
    isTransitioning = false;
    if (onArrive) onArrive();
  }
}

// ---- WASD / arrow-key walking -------------------------------------------
const heldKeys  = new Set();
const walkFwd   = new THREE.Vector3();
const walkRight = new THREE.Vector3();
const walkStep  = new THREE.Vector3();
const WALK_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'
]);

window.addEventListener('keydown', (e) => {
  // Never swallow keys while the contact form is focused.
  if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
  if (WALK_KEYS.has(e.code)) {
    heldKeys.add(e.code);
    e.preventDefault();
  }
  if (e.code === 'Escape' && activeHotspot) deactivateHotspot();
});
window.addEventListener('keyup',  (e) => heldKeys.delete(e.code));
window.addEventListener('blur',   ()  => heldKeys.clear());

function updateWalk(dt) {
  if (activeHotspot || isTransitioning || !controls.enabled) return;

  let fwd  = 0;
  let side = 0;
  if (heldKeys.has('KeyW') || heldKeys.has('ArrowUp'))    fwd  += 1;
  if (heldKeys.has('KeyS') || heldKeys.has('ArrowDown'))  fwd  -= 1;
  if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) side += 1;
  if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft'))  side -= 1;
  if (fwd === 0 && side === 0) return;

  const fast  = heldKeys.has('ShiftLeft') || heldKeys.has('ShiftRight');
  const speed = (fast ? ROOM.walkSpeedFast : ROOM.walkSpeed) * dt;

  // Move on the floor plane only, relative to where you are looking.
  camera.getWorldDirection(walkFwd);
  walkFwd.y = 0;
  if (walkFwd.lengthSq() < 1e-6) return;
  walkFwd.normalize();
  walkRight.crossVectors(walkFwd, camera.up).normalize();

  walkStep.set(0, 0, 0)
    .addScaledVector(walkFwd,  fwd  * speed)
    .addScaledVector(walkRight, side * speed);

  // Translate camera and pivot together so the view direction is preserved.
  camera.position.add(walkStep);
  collision.resolve(previousCameraPosition, camera.position);
  walkStep.subVectors(camera.position, previousCameraPosition);
  previousCameraPosition.copy(camera.position);
  controls.target.add(walkStep);
  keepInsideRoom();
}


// =====================================================================
// HOTSPOT MESHES
// =====================================================================
const hotspotMeshes     = {};  // id → inner sphere
const outerSpheres      = [];  // for pulse animation
const hotspotRayTargets = [];  // flat list for raycasting

HOTSPOTS.forEach(hs => {
  // Inner glowing core
  const innerGeo = new THREE.SphereGeometry(0.12, 16, 16);
  const innerMat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c,
    emissive: 0xc9a84c,
    emissiveIntensity: 2
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.position.copy(hs.position);
  inner.userData.hotspotId = hs.id;
  scene.add(inner);
  hotspotMeshes[hs.id] = inner;
  hotspotRayTargets.push(inner);

  // Outer pulse ring
  const outerGeo = new THREE.SphereGeometry(0.22, 16, 16);
  const outerMat = new THREE.MeshStandardMaterial({
    color: 0xc9a84c,
    emissive: 0xc9a84c,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.3
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.copy(hs.position);
  outer.userData.hotspotId = hs.id;
  scene.add(outer);
  outerSpheres.push(outer);
});

// =====================================================================
// LOAD GLB
// =====================================================================

// Vite emits a hashed asset URL and includes it in dist automatically. No
// root-folder file, third-party decoder URL or serverless function is needed.
const modelURL = new URL('./assets/music-studio.glb', import.meta.url).href;
const studioMetadataURL = new URL('./assets/studio.json', import.meta.url).href;
let smoke = null;
let atmosphere = null;

async function loadStudioMetadata() {
  const response = await fetch(studioMetadataURL);
  if (!response.ok) throw new Error(`Studio metadata failed to load (HTTP ${response.status}).`);
  const metadata = await response.json();
  if (!Number.isFinite(metadata.byteLength) || !Array.isArray(metadata.smokeEmitters)) {
    throw new Error('The studio metadata is missing or invalid.');
  }
  return metadata;
}

async function loadModel() {
    const studioAsset = await loadStudioMetadata();
    const gltf = await loadStudioModel(modelURL, studioAsset.byteLength, updateLoading);
    const model = gltf.scene;

    // -----------------------------------------------------------------
    // NO SCALING, NO RECENTERING.
    // The studio is authored in metres with its floor already at y = 0 and
    // its walls already centred on x = 0, so the model is used as-is.
    //
    // The previous "scale longest axis to 10 units, then sit on y = 0" pass
    // was what pushed the view outside the building: the longest axis is
    // measured against `smoke_big`, a 9 m tall billboard that reaches from
    // y -2.80 to y 6.35, so `model.position.y -= box.min.y` lifted the whole
    // studio ~2.5 m into the air and the auto-fitted camera ended up at
    // z ≈ 12, well beyond the front wall at z ≈ 3.4.
    // -----------------------------------------------------------------
    model.updateMatrixWorld(true);

    // Material / texture pass
    model.traverse((node) => {
      if (!node.isMesh || !node.material) return;

      const mats = Array.isArray(node.material) ? node.material : [node.material];
      mats.forEach((mat) => {
        for (const slot of ['map', 'emissiveMap', 'specularMap', 'sheenColorMap']) {
          if (mat[slot]) mat[slot].colorSpace = THREE.SRGBColorSpace;
        }
        // Sharper floors, desks and wall panels at grazing angles — you see a
        // lot of those from inside the room.
        for (const slot of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
          if (mat[slot]) mat[slot].anisotropy = maxAnisotropy;
        }
        // Walls, floor and ceiling are all authored double-sided, so they
        // render correctly when viewed from inside.
        mat.needsUpdate = true;
      });

      // Transparent smoke billboards are decoration: keep them out of the
      // raycaster so they never eat a hotspot click.
      if (/^smoke/i.test(node.name)) {
        node.raycast = () => {};
        node.visible = false;
      }
    });

    atmosphere = createStudioAtmosphere(model, { lights: ceilingLights.slice(0, 4), ambientLight });
    collision.addModel(model);
    scene.add(model);
    studioDebug.model = model;
    studioDebug.atmosphere = atmosphere;
    smoke = createSmoke(studioAsset.smokeEmitters, { compact: compactDevice });
    scene.add(smoke.mesh);
    studioDebug.smoke = smoke;

    // Sanity check: confirm the shell is where the interior constants expect.
    const shell = model.getObjectByName('Main_Studio');
    if (shell) {
      const shellBox = new THREE.Box3().setFromObject(shell);
      console.log('Studio shell — min:', shellBox.min, 'max:', shellBox.max);
      window.__studio.shellBox = {
        min: shellBox.min.toArray(),
        max: shellBox.max.toArray()
      };
      if (Math.abs(shellBox.min.y) > 0.5) {
        console.warn(
          `Studio floor is at y=${shellBox.min.y.toFixed(2)}, not ~0. ` +
          'The ROOM constants at the top of main.js assume a floor at y=0.'
        );
      }
    } else {
      console.warn('Mesh "Main_Studio" not found — ROOM bounds may not match this GLB.');
    }

    // Keep the Shift+Click inspector. Because the model is untransformed, any
    // coordinate it prints can be pasted straight into HOTSPOTS or ROOM.
    window._modelMeshes = [];
    model.traverse((n) => { if (n.isMesh && n.visible) window._modelMeshes.push(n); });

    // Snap each hotspot to its real object, preserving the manual offset that
    // lifts the orb clear of the surface it sits on.
    const snapMap = {
      beatstars: { node: 'macBook',   offset: new THREE.Vector3( 0.00, 0.36,  0.00) },
      phone:     { node: 'Iphone18',  offset: new THREE.Vector3( 0.00, 0.29,  0.00) },
      computer:  { node: 'Monitor',   offset: new THREE.Vector3( 0.00, 0.23,  0.24) },
      tv:        { node: 'TV',        offset: new THREE.Vector3( 0.00, 0.00,  0.35) },
      painting:  { node: 'Frame.005', offset: new THREE.Vector3(-0.22, 0.00,  0.00) }
    };

    for (const [hsId, { node: nodeName, offset }] of Object.entries(snapMap)) {
      const target = model.getObjectByName(nodeName);
      if (!target) {
        console.warn(`Hotspot "${hsId}": node "${nodeName}" not found — keeping the hard-coded position.`);
        continue;
      }
      // Bounding-box centre, not the node origin: several nodes in this GLB
      // have their pivot at the world origin.
      const box = new THREE.Box3().setFromObject(target);
      if (box.isEmpty()) continue;
      const centre = box.getCenter(new THREE.Vector3()).add(offset);

      const hs = HOTSPOTS.find((h) => h.id === hsId);
      if (!hs) continue;
      hs.position.copy(centre);
      hotspotMeshes[hsId]?.position.copy(centre);
      const idx = HOTSPOTS.indexOf(hs);
      outerSpheres[idx]?.position.copy(centre);
      console.log(`Snapped "${hsId}" → ${nodeName}`, centre);
    }

    // Prepare GPU programs before revealing the room. The download reaching
    // 100% no longer implies that decoding/uploading/rendering has finished.
    updateLoading(96, 'Lighting the studio…');
    await renderer.compileAsync(scene, camera);

    // Ease from the intro pose to the default interior view.
    camera.position.copy(ROOM.startCam);
    controls.target.copy(defaultLookAt);
    controls.update();
    keepInsideRoom();
    renderer.render(scene, camera);
    startTransition(defaultCameraPos, defaultLookAt, INTRO_TRANSITION_MS);
    studioDebug.loaded = true;
    finishLoading();
}

// =====================================================================
// RAYCASTING / MOUSE
// =====================================================================
const raycaster  = new THREE.Raycaster();
const mouse      = new THREE.Vector2();
let mouseDownPos = { x: 0, y: 0 };

function updateMouseVec(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
}

window.addEventListener('mousemove', (e) => {
  updateMouseVec(e);

  raycaster.setFromCamera(mouse, camera);
  const hits = raycaster.intersectObjects(hotspotRayTargets, false);

  if (hits.length > 0) {
    const hsId = hits[0].object.userData.hotspotId;
    const hs   = HOTSPOTS.find(h => h.id === hsId);
    tooltip.textContent    = hs ? hs.label : '';
    tooltip.style.display  = 'block';
    tooltip.style.left     = (e.clientX + 16) + 'px';
    tooltip.style.top      = (e.clientY - 10) + 'px';
    document.body.style.cursor = 'pointer';
  } else {
    tooltip.style.display  = 'none';
    document.body.style.cursor = '';
  }
});

window.addEventListener('mousedown', (e) => {
  mouseDownPos = { x: e.clientX, y: e.clientY };
});

window.addEventListener('mouseup', (e) => {
  // Only treat as click if mouse barely moved (not a drag)
  const dx = Math.abs(e.clientX - mouseDownPos.x);
  const dy = Math.abs(e.clientY - mouseDownPos.y);
  if (dx > 5 || dy > 5) return;

  updateMouseVec(e);
  raycaster.setFromCamera(mouse, camera);

  // INSPECT MODE: if holding Shift, log the world position of clicked mesh
  if (e.shiftKey && window._modelMeshes) {
    const inspectHits = raycaster.intersectObjects(window._modelMeshes, false);
    if (inspectHits.length > 0) {
      const hit = inspectHits[0];
      const wp  = hit.point;
      const obj = hit.object;
      console.log(`%c📍 Hit: "${obj.name}"`, 'color:#c9a84c;font-weight:bold');
      console.log(`   World position of click: x:${wp.x.toFixed(3)}, y:${wp.y.toFixed(3)}, z:${wp.z.toFixed(3)}`);
      console.log(`   Copy → new THREE.Vector3(${wp.x.toFixed(2)}, ${wp.y.toFixed(2)}, ${wp.z.toFixed(2)})`);
    } else {
      console.log('Shift+click missed all meshes — try clicking on the model');
    }
    return;
  }

  // Normal hotspot click
  const hits = raycaster.intersectObjects(hotspotRayTargets, false);
  if (hits.length > 0) {
    const hsId = hits[0].object.userData.hotspotId;
    activateHotspot(hsId);
  }
});

// =====================================================================
// HOTSPOT ACTIVATE / DEACTIVATE
// =====================================================================
function activateHotspot(id) {
  const hs = HOTSPOTS.find(h => h.id === id);
  if (!hs) return;

  activeHotspot = id;
  controls.enabled = false;
  tooltip.style.display = 'none';
  document.body.style.cursor = '';

  // Hide all hotspot meshes during zoom
  hotspotRayTargets.forEach(m => m.visible = false);
  outerSpheres.forEach(m => m.visible = false);

  // Fly to the framing, then open the panel once the camera has actually arrived.
  startTransition(hs.cameraPos, hs.cameraLookAt, TRANSITION_MS, () => {
    overlayContent.innerHTML = OVERLAY_CONTENT[id] || `<button class="back-btn" id="back-btn">← Back</button><h2>${hs.label}</h2>`;
    overlay.classList.add('active');

    // Wire up contact form if present
    const form = document.getElementById('contact-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        alert('Message sent! (Wire up to your backend or Formspree to make this work.)');
      });
    }

    // Wire up back button
    const backBtn = document.getElementById('back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', deactivateHotspot);
    }

    // Hide HUD hint once user has interacted
    if (!hudHidden) {
      hudHint.classList.add('hidden');
      hudHidden = true;
    }
  });
}

function deactivateHotspot() {
  if (!activeHotspot && !overlay.classList.contains('active')) return;

  overlay.classList.remove('active');
  controls.enabled = true;
  activeHotspot = null;

  startTransition(defaultCameraPos, defaultLookAt);

  // Restore hotspot markers
  hotspotRayTargets.forEach(m => m.visible = true);
  outerSpheres.forEach(m => m.visible = true);
}

// Click dark overlay background to close
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) deactivateHotspot();
});

// =====================================================================
// DEV HOOK
// =====================================================================
// Handy from the browser console while tuning the interior, e.g.
//   __studio.camera.position            → where am I standing?
//   __studio.clickHotspot('tv')         → fly to a hotspot
//   __studio.reset()                    → back to the default interior view
const studioDebug = {
  scene, camera, controls, renderer, ROOM, HOTSPOTS, collision,
  model: null,
  smoke: null,
  atmosphere: null,
  loaded: false,
  shellBox: null,
  get hotspots() { return HOTSPOTS; },
  clickHotspot(id) {
    if (!HOTSPOTS.some(h => h.id === id)) return false;
    activateHotspot(id);
    return true;
  },
  back: deactivateHotspot,
  isSettled: () => !isTransitioning,
  setView(position, target) {
    transition = null;
    isTransitioning = false;
    // Explicit debug teleport; ordinary navigation always sweeps its path.
    camera.position.fromArray(position);
    previousCameraPosition.copy(camera.position);
    controls.target.fromArray(target);
    controls.update();
    keepInsideRoom();
  },
  reset() {
    deactivateHotspot();
    transition = null;
    isTransitioning = false;
    camera.position.copy(defaultCameraPos);
    previousCameraPosition.copy(camera.position);
    controls.target.copy(defaultLookAt);
    controls.update();
    keepInsideRoom();
  }
};
window.__studio = studioDebug;

// =====================================================================
// RESIZE
// =====================================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compactDevice ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================================================
// ANIMATION LOOP
// =====================================================================
const clock = new THREE.Clock();
let animationFrame = null;

function animate() {
  if (document.hidden) {
    animationFrame = null;
    return;
  }
  animationFrame = requestAnimationFrame(animate);

  // Cap delta so a backgrounded tab does not teleport the camera on return.
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!studioDebug.loaded) return;

  // Camera fly-to (intro, hotspot, back). Duration-based, so it always lands.
  const transitioningAtFrameStart = isTransitioning;
  updateTransition();

  // Do not count the final fly-to step as walking displacement when a key
  // is held on arrival (especially with reduced-motion transitions).
  if (!transitioningAtFrameStart) updateWalk(dt);

  // Pulse outer spheres
  const t = performance.now() * 0.003;
  outerSpheres.forEach((sphere, i) => {
    sphere.scale.setScalar(motionPreference.matches ? 1 : 1 + 0.3 * Math.sin(t + i * 0.7));
  });

  // Slowly rotate inner orbs
  hotspotRayTargets.forEach((mesh) => {
    if (!motionPreference.matches) mesh.rotation.y += dt * 0.5;
  });

  controls.update();
  // Keep the near plane clear of furniture, lights, and the room shell.
  keepInsideRoom();
  if (!activeHotspot) smoke?.update(dt, motionPreference.matches);
  atmosphere?.update(dt, motionPreference.matches);

  renderer.render(scene, camera);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(animationFrame);
    animationFrame = null;
    clock.stop();
    heldKeys.clear();
  } else if (animationFrame === null) {
    clock.start();
    animate();
  }
});

animate();
loadModel().catch(showLoadError);
