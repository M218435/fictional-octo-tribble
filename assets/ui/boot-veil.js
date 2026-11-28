/* 站点通用开机遮罩：页面还没真正画出来之前，先给一块"在动"的画面，
   不再出现黑屏或"界面出来了但点不动"。等页面真的能连续出帧了再收掉。 */
(function () {
  var D = document, root = D.documentElement;
  var t0 = Date.now(), el = null, shown = false, killT = null, pollT = null, done = false;
  // 先把根背景压暗，避免"白闪一下再黑屏"
  try { if (!root.style.background) root.style.background = "#0b0b0c"; } catch (e) {}

  function build() {
    if (el) return;
    el = D.createElement("div");
    el.id = "rtsx-boot";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:none;" +
      "align-items:center;justify-content:center;flex-direction:column;gap:12px;" +
      "background:#0b0b0c;color:#8C8679;font:12.5px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "letter-spacing:.08em;opacity:1;transition:opacity .28s ease";
    el.innerHTML = '<div style="width:22px;height:22px;border-radius:50%;border:2px solid rgba(226,145,111,.22);border-top-color:#E2916F;animation:rtsxspin .9s linear infinite"></div><b id="rtsx-boot-t" style="font-weight:400">载入中…</b>';
    root.appendChild(el);
    var st = D.createElement("style");
    st.textContent = "@keyframes rtsxspin{to{transform:rotate(360deg)}}";
    root.appendChild(st);
  }

  function show() {
    if (shown || done) return;
    shown = true;
    build();
    if (!el) return;
    el.style.display = "flex";
    var iv = setInterval(function () {
      var s = Math.round((Date.now() - t0) / 1000);
      var t = D.getElementById("rtsx-boot-t");
      if (t && s > 1) t.textContent = "正在准备画面… " + s + "s";
    }, 500);
    el.__iv = iv;
  }

  function hide() {
    if (done) return;
    done = true;
    if (pollT) clearTimeout(pollT);
    if (killT) clearTimeout(killT);
    if (el) {
      if (el.__iv) clearInterval(el.__iv);
      el.style.opacity = "0";
      setTimeout(function () { if (el && el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); }, 320);
    }
  }

  // 320ms 内还没画完就亮出来，短页面不会看见闪一下
  pollT = setTimeout(show, 320);

  // 只认"连续出帧"：主线程被重活占着时 rAF 会停，遮罩就一直盖着；
  // 一旦能连续画出 3 帧（间隔 < 130ms），说明画面真的活了，再收。
  function armHide() {
    var quick = 0, last = 0;
    function step(ts) {
      if (done) return;
      if (last && (ts - last) < 130) quick++; else quick = 0;
      last = ts;
      if (quick >= 3 || Date.now() - t0 > 10000) { setTimeout(hide, 120); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if (D.readyState === "complete") armHide();
  else window.addEventListener("load", armHide);
  // 兜底：再慢也别一直盖着
  killT = setTimeout(hide, 45000);
})();
