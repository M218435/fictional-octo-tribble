export async function downloadSceneBuffer(url, expectedBytes, signal, progress, { fetcher = fetch, idleMs = 20000 } = {}) {
  const idle = new AbortController();
  const downloadSignal = signal ? AbortSignal.any([signal, idle.signal]) : idle.signal;
  const timeoutError = Error('地图下载长时间没有进度，请重试。');
  let timer;
  const renew = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(timeoutError), idleMs);
  };
  try {
    renew();
    const response = await fetcher(url, { credentials: 'omit', cache: 'force-cache', signal: downloadSignal });
    if (!response.ok) throw Error('地图模型下载失败。');
    renew();
    return await readSceneBuffer(response, expectedBytes, downloadSignal, (loaded, total) => {
      renew();
      progress?.(loaded, total);
    });
  } catch (failure) {
    if (downloadSignal.reason === timeoutError) throw timeoutError;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

// The manifest size is the decoded body size. Content-Length may instead be the
// gzip size, so it cannot be used to calculate GLB download progress.
export async function readSceneBuffer(response, expectedBytes, signal, progress) {
  if (!response.body?.getReader) {
    const buffer = await response.arrayBuffer();
    signal?.throwIfAborted();
    progress?.(buffer.byteLength, expectedBytes);
    return buffer;
  }
  const reader = response.body.getReader();
  const data = new Uint8Array(expectedBytes);
  let loaded = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.byteLength > expectedBytes) throw Error('地图模型大小与服务器版本不一致，请刷新页面。');
      data.set(value, loaded);
      loaded += value.byteLength;
      progress?.(loaded, expectedBytes);
    }
    signal?.throwIfAborted();
    if (loaded !== expectedBytes) throw Error('地图模型下载不完整，请重试。');
    return data.buffer;
  } catch (failure) {
    await reader.cancel().catch(() => {});
    throw failure;
  } finally { reader.releaseLock(); }
}
