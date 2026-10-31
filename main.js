import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSmoke } from './smoke.js';
import { createCameraCollision } from './camera-collision.js';
import { createStudioAtmosphere } from './studio-atmosphere.js';
import { loadStudioModel } from './model-loader.js';
import { updateLoading, showLoadError, finishLoading, showEnterPage } from './loading.js';

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
    cameraPos:    new THREE.Vector3(-0.33, 1.40,  0.10),
    cameraLookAt: new THREE.Vector3(-0.33, 0.93, -0.61)
  }
];

const VIDEO_CATALOGUE = [
  {
    label: '2015-2017',
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
    label: '2017-2018',
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
    label: '2018-2019',
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
    label: '2019-2020',
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
    label: '2020-2021',
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
    label: '2022-2023',
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
      ${VIDEO_CATALOGUE.map((group) => `
        <details class="video-year-group">
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
    <h2>G.LO BEATZ <span class="title-divider" aria-hidden="true">|</span> GARLOW</h2>

    <section class="profile-section" aria-labelledby="bio-heading">
      <h3 id="bio-heading">Bio</h3>
      <p class="profile-lede">Entrepreneur | A&amp;R | Executive Record Producer | AES-Certified Audio Engineer | 15+ Million Streams | Artist Development | Music &amp; Culture</p>
      <details class="content-accordion">
        <summary>
          <span>Read More</span>
          <span class="content-accordion-chevron" aria-hidden="true"></span>
        </summary>
        <div class="content-accordion-body biography-copy">
          <p>Garlow, professionally known as “G.LO Beatz” &amp; “MixedByGarlow”, is a Toronto-based Executive Record Producer, AES-Certified Audio Engineer, and Entrepreneur with over 15 million streams across his catalogue.</p>
          <p>Raised in a single-mother household, Garlow grew up in a shelter in Malvern, as well as TCHC and Toronto Metro Housing communities, including 17 Allenbury Gardens in North York, 103 West Lodge in Parkdale, 4175 West Hill in Scarborough, and 444 Lumsden Ave. in East York. These experiences shaped his resilience, vision, and determination to craft a sound that amplifies the real talent, energy, and culture that define Toronto’s rap scene.</p>
          <p>Garlow played a pivotal role in developing Toronto’s underground rappers and singers. He built name-brand artists from the ground up while unknowingly shaping the sound, identity, and direction of an entire generation of the Canadian Trap &amp; Drill scene. His signature production and mixing style, recognized for its high-intensity chops, drops, and transitions, quickly became a defining influence adopted by studios, producers, and engineers across the entire country.</p>
          <p>Toronto’s rap scene became widely recognized throughout the 2014–2021 era. From 2015 to 2022, Garlow operated MM ENT. out of his studio at the infamous 799 Brimley Road Plaza in Scarborough, a cornerstone of Toronto’s street culture. During a time when studio access and industry opportunities were limited, he created opportunities for some of the most underserved Black youth, people of colour, and communities, providing an exclusive, private sanctuary where emerging talent could develop their sound, find their voice, and receive the safety, guidance, and attention their artistry deserved.</p>
          <p>This moment in time represents an intersection of real-life experiences from Toronto’s most deeply rooted communities, transitioning into social media, art, and opportunity. Garlow has generated over 15 million streams collectively, with music publicly promoted by Drake, Tory Lanez, Waka Flocka Flame, Casanova, Scotiabank Arena, the Toronto Raptors, OVO Sound Radio, Flow 93.5 FM, Dundas Square, Eaton Centre, the BLM Movement, and 6ixBuzzTV.</p>
          <p>His work and collaborations include 17 Duvy, Robin Banks, Why-S, 3M French, Hypno Carlito, Smiley, Biz Loc, Lil 6, Biig Slime, Lil Berete, 730 Rarri, and Twy, alongside music collectives including OTF, GS9, Wass Gang, 2C6, IYC, NHS, 5IVE ENT., CLE, 10X, and Montreal’s Profit Boyz, with connections spanning Toronto, Montreal, Nova Scotia, Vancouver, and Chicago.</p>
          <p>Beyond music, Garlow is the founder of Freedom Venue, a creative event space bringing thousands of artists, entrepreneurs, corporations, families, charities, and multicultural communities together to celebrate important milestones. Freedom Venue specializes in pristine audio production, 4K visuals, and RGB lighting. Services include full-service event management, staffing, catering, bar services, and custom décor.</p>
          <p>Garlow's career has been entirely self-funded, built without the support of grants or partnerships. Through MM ENT. and Freedom Venue, and the collaboration of music and business, he continues to create opportunities, generate employment, build ownership, and invest in the culture and communities of Toronto while remaining authentically true to himself.</p>
        </div>
      </details>
    </section>

    <section class="profile-section" aria-labelledby="services-heading">
      <h3 id="services-heading">Services &amp; Sessions</h3>
      <p>Full-service music production, artist development, and professional audio engineering. From creative direction and custom beat-making to professional recording, mixing, and mastering, every project is developed with attention to detail and a signature sonic identity.</p>
      <p>Specializing in industry-ready sound across Trap, Drill, Hip-Hop, R&amp;B, TrapSoul, Afrobeats, Lo-Fi, and more, bringing every project from concept to final master.</p>
      <details class="content-accordion">
        <summary>
          <span>More Info</span>
          <span class="content-accordion-chevron" aria-hidden="true"></span>
        </summary>
        <div class="content-accordion-body service-details">
          <section>
            <h4>Executive Production &amp; Artist Development</h4>
            <ul>
              <li><strong>Executive Producer:</strong> Collaborative creative direction and production oversight for your project, EP, mixtape, or album.</li>
              <li><strong>Artist Development:</strong> Sound development, artistic identity, vocal direction, song selection, and musical positioning.</li>
              <li><strong>A&amp;R Services:</strong> Artist discovery, talent development, record selection, and creative collaboration.</li>
              <li><strong>Project Development:</strong> Concept development, track selection, sequencing, and overall project execution.</li>
            </ul>
          </section>
          <section>
            <h4>G.LO Beatz Production &amp; Beats</h4>
            <ul>
              <li><strong>Record Producer:</strong> Sonic direction and creative production for your single release.</li>
              <li><strong>Music Production:</strong> Custom beats, original instrumentals, melodies, arrangements, and compositions.</li>
              <li><strong>Sound Design:</strong> Custom samples, textures, effects, transitions, drops, and signature sonic elements.</li>
              <li><strong>Vocal Production:</strong> Vocal arrangements, harmonies, layering, ad-libs, and performance direction.</li>
            </ul>
          </section>
          <section>
            <h4>Audio Recording &amp; Engineering</h4>
            <ul>
              <li><strong>Recording Engineer:</strong> Professional session control and pristine audio recording.</li>
              <li><strong>Vocal Recording:</strong> Lead vocals, hooks, background vocals, harmonies, and ad-libs.</li>
              <li><strong>Multi-Track Recording:</strong> Individual vocal and instrument recording.</li>
              <li><strong>Session Management:</strong> Microphone selection, signal flow, gain staging, and recording workflow.</li>
              <li><strong>Vocal Comping &amp; Editing:</strong> Performance selection, timing adjustments, vocal alignment, and session preparation.</li>
            </ul>
          </section>
          <section>
            <h4>Mixing</h4>
            <ul>
              <li><strong>Mixing Engineer:</strong> Full track-out mixing and 2-track mixing sessions.</li>
              <li><strong>Full Track-Out Mixing:</strong> Individual track processing, balancing, panning, and professional mix development.</li>
              <li><strong>2-Track Mixing:</strong> Professional vocal mixing over stereo instrumentals.</li>
              <li><strong>Vocal Mixing &amp; Processing:</strong> EQ, compression, clarity, presence, reverb, delay, and effects.</li>
              <li><strong>Signature Chops &amp; Drops:</strong> High-impact vocal edits, transitions, drops, chops, and customized production effects.</li>
              <li><strong>Mix Revisions:</strong> Refinements and adjustments to achieve the intended sonic direction.</li>
            </ul>
          </section>
          <section>
            <h4>Mastering</h4>
            <ul>
              <li><strong>Mastering Engineer:</strong> Final audio balancing, loudness, clarity, and sonic consistency.</li>
              <li><strong>Stereo Mastering:</strong> Final processing and optimization of completed mixes.</li>
              <li><strong>Loudness Optimization:</strong> Playback-level consistency and competitive loudness.</li>
              <li><strong>Streaming Preparation:</strong> Final master preparation for digital streaming platforms.</li>
              <li><strong>Release-Ready Exports:</strong> Radio-Edits, Track-outs (Stems), WAV and MP3 deliverables.</li>
            </ul>
          </section>
          <section>
            <h4>Additional Music Services</h4>
            <ul>
              <li>Single, EP, Mixtape &amp; Album Production</li>
              <li>Custom Intros, Outros &amp; Transitions</li>
              <li>Vocal Editing &amp; Enhancement</li>
              <li>Producer Collaborations</li>
              <li>Studio &amp; Production Consultation</li>
              <li>Project Sequencing &amp; Release Preparation</li>
              <li>Audio Quality Control &amp; Final Delivery</li>
            </ul>
          </section>
        </div>
      </details>
    </section>
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
const studioNav       = document.getElementById('studio-nav');
const menuToggle      = document.getElementById('menu-toggle');
const studioMenu      = document.getElementById('studio-menu');
const hudHint         = document.getElementById('hud-hint');
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const compactDevice = window.matchMedia('(max-width: 768px)').matches || (navigator.deviceMemory ?? 8) <= 4;
const touchInput = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// =====================================================================
// SCENE
// =====================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020712);

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
renderer.toneMappingExposure = 0.84;
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

const ambientLight = new THREE.AmbientLight(0x79aeea, 0.2);
scene.add(ambientLight);
scene.add(new THREE.HemisphereLight(0x8fc7ff, 0x07101f, 0.62));

// The five emissive ceiling panels baked into the GLB. These coordinates are
// the exact world centres of the Light / Light.00x / Light-booth nodes, which
// only line up because the model is no longer rescaled or offset.
const studioLights = [
  { name: 'Light',       pos: [ 2.36, 2.57, -3.40], color: 0xb9ddff, intensity: 4.2 },
  { name: 'Light.004',   pos: [-1.69, 2.53, -3.42], color: 0xb9ddff, intensity: 4.2 },
  { name: 'Light.001',   pos: [-2.45, 2.57,  0.62], color: 0xb9ddff, intensity: 4.2 },
  { name: 'Light.002',   pos: [ 2.25, 2.57,  0.74], color: 0xb9ddff, intensity: 4.2 },
  { name: 'Light-booth', pos: [ 0.14, 2.49, -6.64], color: 0xd5edff, intensity: 4.8 }
];
const ceilingLights = studioLights.map(({ name, pos, color, intensity }) => {
  const pl = new THREE.PointLight(color, intensity, 10, 2);
  pl.name = name;
  pl.position.set(...pos);
  scene.add(pl);
  return pl;
});

// Cool bounce off the back wall, matching the blue ceiling wash.
const deskGlow = new THREE.PointLight(0x5f9bd7, 2.2, 6, 2);
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
const headLight = new THREE.PointLight(0x8fbde8, 0.8, 6, 2);
camera.add(headLight);
scene.add(camera);

const defaultCameraPos = ROOM.defaultCam.clone();
const defaultLookAt    = ROOM.defaultLook.clone();

// =====================================================================
// VIEW STATE
// =====================================================================
let activeHotspot   = null;   // id of the open hotspot, or null
let isTransitioning = false;  // true only while the camera is easing somewhere

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

function setStudioMenuOpen(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', `${open ? 'Close' : 'Open'} studio menu`);
  studioMenu.hidden = !open;
  syncHudHintVisibility();
}

function syncHudHintVisibility() {
  hudHint.hidden = !studioMenu.hidden || activeHotspot !== null || overlay.classList.contains('active');
}

function closeStudioMenu() {
  setStudioMenuOpen(false);
}

function returnToEnterPage() {
  closeStudioMenu();
  transition = null;
  isTransitioning = false;
  overlay.classList.remove('active');
  activeHotspot = null;
  syncHudHintVisibility();
  controls.enabled = false;
  camera.position.copy(ROOM.startCam);
  previousCameraPosition.copy(camera.position);
  controls.target.copy(defaultLookAt);
  controls.update();
  keepInsideRoom();
  setHotspotsVisible(true);
  showEnterPage();
}

menuToggle.addEventListener('click', () => {
  setStudioMenuOpen(studioMenu.hidden);
});

studioMenu.addEventListener('click', (event) => {
  const item = event.target.closest('button');
  if (!item) return;
  if (item.dataset.action === 'home') {
    returnToEnterPage();
    return;
  }
  const hotspotId = item.dataset.hotspot;
  closeStudioMenu();
  if (hotspotId) activateHotspot(hotspotId);
});

document.addEventListener('pointerdown', (event) => {
  if (!studioMenu.hidden && !studioNav.contains(event.target)) closeStudioMenu();
});

window.addEventListener('studio:entered', () => {
  closeStudioMenu();
  controls.enabled = true;
  startTransition(defaultCameraPos, defaultLookAt, INTRO_TRANSITION_MS);
});

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
  if (e.code === 'Escape' && !studioMenu.hidden) closeStudioMenu();
  else if (e.code === 'Escape' && activeHotspot) deactivateHotspot();
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
const hotspotHitMeshes  = {};  // id → invisible enlarged tap target
const hotspotRayTargets = [];  // flat list of enlarged interaction targets
const hotspotPurple = 0x9b5cff;

HOTSPOTS.forEach(hs => {
  // Inner glowing core
  const innerGeo = new THREE.SphereGeometry(0.055, 16, 16);
  const innerMat = new THREE.MeshStandardMaterial({
    color: hotspotPurple,
    emissive: hotspotPurple,
    emissiveIntensity: 0.75
  });
  const inner = new THREE.Mesh(innerGeo, innerMat);
  inner.position.copy(hs.position);
  inner.userData.hotspotId = hs.id;
  scene.add(inner);
  hotspotMeshes[hs.id] = inner;

  // Outer pulse ring
  const outerGeo = new THREE.SphereGeometry(0.095, 16, 16);
  const outerMat = new THREE.MeshStandardMaterial({
    color: hotspotPurple,
    emissive: hotspotPurple,
    emissiveIntensity: 0.08,
    transparent: true,
    opacity: 0.07
  });
  const outer = new THREE.Mesh(outerGeo, outerMat);
  outer.position.copy(hs.position);
  outer.userData.hotspotId = hs.id;
  scene.add(outer);
  outerSpheres.push(outer);

  // Keep the visible marker restrained while giving fingers a forgiving hit
  // area. The target does not render or write to the depth buffer.
  const hit = new THREE.Mesh(
    new THREE.SphereGeometry(touchInput ? 0.36 : 0.27, 12, 12),
    new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
    }),
  );
  hit.position.copy(hs.position);
  hit.userData.hotspotId = hs.id;
  scene.add(hit);
  hotspotHitMeshes[hs.id] = hit;
  hotspotRayTargets.push(hit);
});

function setHotspotsVisible(visible) {
  Object.values(hotspotMeshes).forEach(mesh => { mesh.visible = visible; });
  outerSpheres.forEach(mesh => { mesh.visible = visible; });
  hotspotRayTargets.forEach(mesh => { mesh.visible = visible; });
}

function recolorSpriteBottle(model) {
  const bottleParts = [model.getObjectByName('Sprite'), model.getObjectByName('Sprite_Liquid')].filter(Boolean);
  const recolored = [];
  const colors = {
    'Material.020': 0xa78bfa,
    'Material.021': 0x8b5cf6,
    'Material.015': 0xe9d5ff,
    'Material.022': 0x6b21a8,
    Sprite_Liquid: 0x7c3aed,
  };

  bottleParts.forEach(part => {
    part.traverse(node => {
      if (!node.isMesh || !node.material) return;
      const tint = material => {
        const copy = material.clone();
        copy.color.setHex(colors[copy.name] ?? 0x8b5cf6);
        if (copy.emissive) {
          copy.emissive.setHex(copy.name === 'Sprite_Liquid' ? 0x2e1065 : 0x1e0a3c);
          copy.emissiveIntensity = copy.name === 'Sprite_Liquid' ? 0.32 : 0.12;
        }
        copy.needsUpdate = true;
        recolored.push(copy);
        return copy;
      };
      node.material = Array.isArray(node.material) ? node.material.map(tint) : tint(node.material);
    });
  });

  return recolored;
}

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

    studioDebug.spriteMaterials = recolorSpriteBottle(model);

    atmosphere = createStudioAtmosphere(model, {
      lights: ceilingLights.slice(0, 4),
      ambientLight,
      compact: compactDevice,
    });
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
      hotspotHitMeshes[hsId]?.position.copy(centre);
      const idx = HOTSPOTS.indexOf(hs);
      outerSpheres[idx]?.position.copy(centre);
      console.log(`Snapped "${hsId}" → ${nodeName}`, centre);
    }

    // Prepare GPU programs before revealing the room. The download reaching
    // 100% no longer implies that decoding/uploading/rendering has finished.
    updateLoading(96, 'Lighting the studio…');
    await renderer.compileAsync(scene, camera);

    // Hold on the title view until the visitor chooses Enter.
    camera.position.copy(ROOM.startCam);
    controls.target.copy(defaultLookAt);
    controls.enabled = false;
    controls.update();
    keepInsideRoom();
    renderer.render(scene, camera);
    studioDebug.loaded = true;
    finishLoading();
}

// =====================================================================
// RAYCASTING / POINTER INPUT
// =====================================================================
const raycaster  = new THREE.Raycaster();
const mouse      = new THREE.Vector2();
let pointerStart = null;
const activeCanvasPointers = new Set();
let multiPointerGesture = false;

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

renderer.domElement.addEventListener('pointerdown', (event) => {
  activeCanvasPointers.add(event.pointerId);
  if (activeCanvasPointers.size > 1) multiPointerGesture = true;
  if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
  pointerStart = {
    id: event.pointerId,
    type: event.pointerType,
    x: event.clientX,
    y: event.clientY,
  };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  activeCanvasPointers.delete(event.pointerId);
  const start = pointerStart;
  if (start?.id === event.pointerId) pointerStart = null;
  const wasMultiPointerGesture = multiPointerGesture;
  if (activeCanvasPointers.size === 0) multiPointerGesture = false;
  if (!start || wasMultiPointerGesture) return;

  // Allow a little natural finger drift while keeping drag-to-look distinct
  // from an intentional tap.
  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  const threshold = start.type === 'touch' ? 14 : 5;
  if (Math.hypot(dx, dy) > threshold) return;

  updateMouseVec(event);
  raycaster.setFromCamera(mouse, camera);

  // INSPECT MODE: if holding Shift, log the world position of clicked mesh
  if (event.shiftKey && window._modelMeshes) {
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

renderer.domElement.addEventListener('pointercancel', (event) => {
  activeCanvasPointers.delete(event.pointerId);
  if (pointerStart?.id === event.pointerId) pointerStart = null;
  if (activeCanvasPointers.size === 0) multiPointerGesture = false;
});

// =====================================================================
// HOTSPOT ACTIVATE / DEACTIVATE
// =====================================================================
function activateHotspot(id) {
  const hs = HOTSPOTS.find(h => h.id === id);
  if (!hs) return;

  overlay.classList.remove('active');
  activeHotspot = id;
  syncHudHintVisibility();
  controls.enabled = false;
  tooltip.style.display = 'none';
  document.body.style.cursor = '';

  // Hide all hotspot meshes during zoom
  setHotspotsVisible(false);

  // Fly to the framing, then open the panel once the camera has actually arrived.
  startTransition(hs.cameraPos, hs.cameraLookAt, TRANSITION_MS, () => {
    overlayContent.innerHTML = OVERLAY_CONTENT[id] || `<button class="back-btn" id="back-btn">← Back</button><h2>${hs.label}</h2>`;
    overlay.classList.add('active');
    syncHudHintVisibility();

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

  });
}

function deactivateHotspot() {
  if (!activeHotspot && !overlay.classList.contains('active')) return;

  overlay.classList.remove('active');
  controls.enabled = true;
  activeHotspot = null;
  syncHudHintVisibility();

  startTransition(defaultCameraPos, defaultLookAt);

  // Restore hotspot markers
  setHotspotsVisible(true);
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
  spriteMaterials: [],
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
    sphere.scale.setScalar(motionPreference.matches ? 1 : 1 + 0.08 * Math.sin(t + i * 0.7));
  });

  // Slowly rotate inner orbs
  Object.values(hotspotMeshes).forEach((mesh) => {
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
