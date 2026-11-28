// Safari's legacy API returns void and reports failure only through an event.
// Even a fulfilled Promise is not proof that this canvas owns the pointer.
export function requestPointerLock(canvas, { signal, timeoutMs = 2000 } = {}) {
  const doc = canvas.ownerDocument;
  return new Promise((resolve, reject) => {
    let timer;
    function finish(error) {
      clearTimeout(timer);
      doc.removeEventListener("pointerlockchange", changed);
      doc.removeEventListener("pointerlockerror", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    }
    function changed() {
      if (doc.pointerLockElement === canvas) finish();
    }
    function failed() {
      finish(Error("浏览器未允许锁定鼠标，请点击继续重试。"));
    }
    function aborted() {
      finish(new DOMException("Pointer lock cancelled", "AbortError"));
    }
    if (signal?.aborted) return aborted();
    if (doc.pointerLockElement === canvas) return finish();
    doc.addEventListener("pointerlockchange", changed);
    doc.addEventListener("pointerlockerror", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(failed, timeoutMs);
    try {
      // Invoke synchronously, inside the caller's click/keyboard gesture.
      const result = canvas.requestPointerLock();
      Promise.resolve(result).then(changed, finish);
    } catch (error) {
      finish(error);
    }
  });
}
