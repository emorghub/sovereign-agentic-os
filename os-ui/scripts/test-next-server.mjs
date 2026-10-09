/* test-only shim for next/server */
// A real Response underneath, so `new NextResponse(body, init)` (MCP 202
// notifications, middleware 404/204), `.headers` and `.status` behave like Next.
// `json()` keeps its original plain-object shape — a re-readable `json()` that
// route tests call more than once — and only gains `headers` (additive).
export class NextResponse extends Response {
  static json(obj, init) {
    return {
      status: (init && init.status) || 200,
      headers: new Headers(init && init.headers),
      async json() { return obj; },
    };
  }

  /** Pass-through. Mirrors Next's wire encoding of forwarded request headers:
   *  each becomes `x-middleware-request-<name>`, listed in `x-middleware-override-headers`. */
  static next(init) {
    const res = new NextResponse(null, { status: 200, headers: init && init.headers });
    res.headers.set('x-middleware-next', '1');
    const fwd = init && init.request && init.request.headers;
    if (fwd) {
      const names = [];
      for (const [k, v] of new Headers(fwd)) {
        res.headers.set(`x-middleware-request-${k}`, v);
        names.push(k);
      }
      res.headers.set('x-middleware-override-headers', names.join(','));
    }
    return res;
  }

  static redirect(url, init) {
    const status = typeof init === 'number' ? init : (init && init.status) || 307;
    return new NextResponse(null, { status, headers: { location: String(url) } });
  }
}
