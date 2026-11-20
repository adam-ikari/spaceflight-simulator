/// <reference types="vite/client" />

declare module '*.wasm?bytes' {
  const bytes: ArrayBuffer;
  export default bytes;
}
