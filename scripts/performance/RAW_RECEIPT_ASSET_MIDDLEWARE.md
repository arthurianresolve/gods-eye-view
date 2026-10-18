# Raw receipt sidecar preview endpoint

`rawReceiptAssetMiddleware.mjs` is a private, test-only Vite preview helper.
It serves only receipt-listed physical `.br` and `.gz` files from the build
root, as bounded `application/octet-stream` bytes without `Content-Encoding`.
This preserves the compressed representation required by build provenance
verification when Node's normal `fetch` would transparently decompress it.

All ordinary application requests fall through to Vite unchanged. The helper
does not alter production compression behavior, own a server lifecycle, or
participate in measured browser requests.
