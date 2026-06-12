/**
 * Build a minimal `Response`-shaped object for use with a monkey-patched
 * `globalThis.fetch`. ChartClient only consumes `.ok`, `.status`,
 * `.statusText`, `.json()`, `.arrayBuffer()`, and `.text()`, so this is the
 * smallest stub that exercises the full client surface.
 *
 * @param {object} opts
 * @param {boolean} [opts.ok=true]
 * @param {number}  [opts.status=200]
 * @param {string}  [opts.statusText='OK']
 * @param {object}  [opts.json]            JSON body (sets ok=true unless overridden)
 * @param {Uint8Array | ArrayBuffer} [opts.binary]  Binary body
 * @param {string}  [opts.text='']         Plain-text body (used for error messages)
 */
export function fakeResponse({
  ok,
  status = 200,
  statusText = 'OK',
  json,
  binary,
  text = '',
} = {}) {
  const isOk = ok ?? (status >= 200 && status < 300);
  let bin;
  if (binary instanceof Uint8Array) {
    bin = binary;
  } else if (binary instanceof ArrayBuffer) {
    bin = new Uint8Array(binary);
  } else {
    bin = new Uint8Array(0);
  }
  return {
    ok: isOk,
    status,
    statusText,
    json: async () => json,
    arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength),
    text: async () => text,
  };
}

/**
 * Install a stub fetch on `globalThis.fetch` that records every call and
 * returns the supplied response (or the result of `responseFn(url, init)`).
 *
 * Returns a controller with:
 *   - `calls`:   array of `{ url, init }` for every invocation
 *   - `restore()`: reinstall the previous fetch
 *   - `lastCall()`: convenience accessor
 *   - `lastUrl()`: URL string of the most recent call
 *   - `lastHeaders()`: headers object of the most recent call
 *
 * @param {object | ((url: string, init: object) => object)} responseOrFn
 */
export function installFakeFetch(responseOrFn) {
  const calls = [];
  const previous = globalThis.fetch;

  const fn = typeof responseOrFn === 'function' ? responseOrFn : () => responseOrFn;

  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return fn(String(url), init);
  };

  return {
    calls,
    lastCall() { return calls[calls.length - 1]; },
    lastUrl() { return calls.at(-1)?.url; },
    lastHeaders() { return calls.at(-1)?.init?.headers ?? {}; },
    restore() { globalThis.fetch = previous; },
  };
}
