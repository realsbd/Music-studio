import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer/meshopt_decoder.module.js';

export async function loadStudioModel(url, byteLength, onProgress) {
  const controller = new AbortController();
  let timeout;
  // Reset on each chunk: a slow connection can continue, but a stalled
  // request should offer recovery instead of leaving the loader up forever.
  const resetTimeout = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(), 30000);
  };

  let buffer;
  try {
    resetTimeout();
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Studio download failed (HTTP ${response.status}).`);
    const chunks = [];
    let received = 0;
    if (response.body) {
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.byteLength;
          resetTimeout();
          // The generated metadata describes decoded bytes, unlike a CDN's
          // Content-Length which may describe the compressed transfer size.
          onProgress(Math.min(90, received / byteLength * 90), 'Loading the studio…');
        }
      } finally {
        reader.releaseLock();
      }
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      buffer = bytes.buffer;
    } else {
      buffer = await response.arrayBuffer();
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The studio download stalled. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  // A missing asset can be rewritten to index.html by a host. Check the
  // binary header so that case has a useful error, as does a truncated file.
  const header = new DataView(buffer);
  if (buffer.byteLength < 12 || header.getUint32(0, true) !== 0x46546c67
      || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== buffer.byteLength) {
    throw new Error('The studio file is missing or incomplete. Please try again.');
  }

  onProgress(92, 'Preparing the room…');
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader.parseAsync(buffer, new URL('.', url).href);
}
