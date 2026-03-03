/** Magic file. Previously, this function showed up as a missing `env.__assert_fail`
  * import of the WASM module. This was not trivial to polyfill on the JS side in all contexts.
  *
  * - What it is:
  *   https://refspecs.linuxbase.org/LSB_5.0.0/LSB-Core-generic/LSB-Core-generic/baselib---assert-fail-1.html
  *
  * - Where the stub is from:
  *   https://github.com/emscripten-core/emscripten/blob/b8896d18f2163dbf2fa173694eeac71f6c90b68c/system/lib/libc/musl/src/exit/assert.c
  *
  * - General situation:
  *   https://v8.dev/blog/emscripten-standalone-wasm
  *
  **/

// #include <stdio.h>
// #include <stdlib.h>
void __assert_fail (const char *expr, const char *file, int line, const char *func) {
  // FIXME: Throw a JavaScript error from C!
	//fprintf(stderr, "Assertion failed: %s (%s: %s: %d)\n", expr, file, func, line);
	//fflush(NULL);
}
