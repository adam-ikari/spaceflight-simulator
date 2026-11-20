import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** Loads `*.wasm?bytes` as a synchronous Uint8Array, including in Vitest SSR. */
export function inlineWasmBytes(): Plugin {
  return {
    name: 'inline-wasm-bytes',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.wasm?bytes')) return null;
      const path = id.slice(0, -'?bytes'.length);
      const base64 = readFileSync(path).toString('base64');
      return `
        const binary = atob('${base64}');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        export default bytes.buffer;
      `;
    },
  };
}
