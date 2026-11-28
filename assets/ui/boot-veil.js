/* 站点通用开机遮罩：页面里已经静态放了 #rtsx-boot（不依赖脚本先跑起来），
   这里只负责计时文案和"帧稳了再收"。 */
(function () {
  var D = document, t0 = Date.now(), done = false, killT = null, tick = null;

  function el() { return D.getElementById("rtsx-boot"); }

  function tickFn() {
    var b = D.getElementById("rtsx-boot-t");
    if (!b) return;
    var s = Math.round((Date.now() - t0) / 1000);
    if (s > 1) b.textContent = "正在准备画面… " + s + "s";
  }
  tick = setInterval(tickFn, 500);

  function hide() {
    if (done) return;
    done = true;
    clearInterval(tick);
    if (killT) clearTimeout(killT);
    var e = el();
    if (!e) return;
    e.style.animation = "none";
    e.style.transition = "opacity .22s ease";
    e.style.opacity = "0";
    setTimeout(function () { if (e && e.parentNode && e.parentNode.removeChild) e.parentNode.removeChild(e); }, 260);
  }

  // 只认"连续出帧"：主线程被重活占着时 rAF 会停，遮罩就一直盖着；
  // 一旦能连续画出 3 帧（间隔 < 130ms），说明画面真的活了，再收。
  function arm() {
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
  if (D.readyState === "complete") arm();
  else window.addEventListener("load", arm);
  // 兜底：再慢也别一直盖着
  killT = setTimeout(hide, 45000);
})();
