/*!
 * RTSX SoundKit —— 离线音效选择与播放
 * 所有音频都在 assets/sfx/*.wav 本地文件里，不发任何外部请求。
 *
 * 用法：
 *   <script src="../../assets/sfx/sfx.js"></script>
 *   RTSXSFX.play("click");            // 同类音效里随机挑一个
 *   RTSXSFX.play("score", { volume: .8 });
 *   RTSXSFX.setPreference("click", "ui-click-2.wav");  // 固定选某个文件（会记住）
 *   <button data-sfx="click">…</button>   // 自动绑定点击音
 *
 * 目录/接口：
 *   RTSXSFX.groups()            有哪些音效组
 *   RTSXSFX.catalog()           完整清单（含时长、文件）
 *   RTSXSFX.pick(group)         按当前偏好挑一个文件名（不连着重复）
 *   RTSXSFX.setPreference(g, f) 固定选某个文件，f=null 恢复随机
 *   RTSXSFX.mute(true|false) / toggleMute() / isMuted()
 */
(function () {
  "use strict";
  if (window.RTSXSFX) return;

  /* ---------- 路径：以本脚本所在目录为基准 ---------- */
  var base = "";
  try {
    var s = document.currentScript || (function () {
      var all = document.getElementsByTagName("script");
      for (var i = all.length - 1; i >= 0; i--) {
        if (all[i].src && all[i].src.indexOf("sfx.js") !== -1) return all[i];
      }
      return null;
    })();
    if (s && s.src) base = s.src.replace(/sfx\.js(\?[^#]*)?(#.*)?$/, "");
  } catch (e) { base = ""; }
  if (!/^(http|file|\/)/i.test(base)) base = "assets/sfx/";

  /* ---------- 清单（生成器和 wav 文件一一对应） ---------- */
  var CATALOG = {
    click:   { label: "点击", files: ["ui-click-1.wav", "ui-click-2.wav", "ui-click-3.wav"] },
    hover:   { label: "悬停", files: ["ui-hover-1.wav", "ui-hover-2.wav"] },
    back:    { label: "返回", files: ["ui-back-1.wav", "ui-back-2.wav"] },
    score:   { label: "得分", files: ["score-1.wav", "score-2.wav", "score-3.wav"] },
    catch:   { label: "接住", files: ["catch-1.wav", "catch-2.wav", "catch-3.wav"] },
    error:   { label: "错误", files: ["error-1.wav", "error-2.wav"] },
    land:    { label: "落地", files: ["land-1.wav", "land-2.wav", "land-3.wav"] },
    glitch:  { label: "故障", files: ["glitch-1.wav", "glitch-2.wav", "glitch-3.wav"] },
    warn:    { label: "警告", files: ["warn-1.wav", "warn-2.wav"] },

    success: { label: "完成", files: ["success-1.wav", "success-2.wav"] },
    toggle:  { label: "开关", files: ["toggle-1.wav", "toggle-2.wav"] }
  };

  /*@@EMBED*/
  // 以下为常用音效的 base64 WAV（24k 单声道），内嵌后点击时不需要再发请求
  var EMBED = {
    "ui-click-1.wav": "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TQA4ACMADQD4/+T/0//D/7b/q/+h/5j/kP+J/4L/fP93/3P/cf9y/3X/ev+C/4v/lv+i/67/uv/H/9T/4f/v//7/DgAgADIARQBYAGsAfQCPAJ8ArQC7AMgA0wDfAOoA9QD/AAgBEAEXARwBHwEgAR8BHAEYARMBDgEIAQEB+QDxAOgA3gDSAMYAuACpAJoAigB7AGwAXQBQAEIANQAoABwADwADAPf/7P/h/9f/z//I/8P/v/+9/7v/u/+7/7z/vf/A/8P/x//N/9P/2//k/+7/+f8EABAAHAAnADMAPgBKAFUAYQBtAHkAhQCRAJ0ApwCxALoAwgDJAM4A1ADYANwA3wDhAOMA5ADkAOIA4ADdANgA0gDMAMUAvgC2AK4ApQCdAJQAigCAAHYAawBhAFYASwBBADcALgAlAB0AFgAPAAgAAgD8//f/8v/v/+z/6v/o/+j/6f/r/+3/8P/0//j//f8CAAcADQAUABsAIwArADQAPQBFAE4AVwBgAGgAcAB4AH8AhwCOAJUAmwChAKcArACwALQAtwC5ALoAuwC7ALoAuQC4ALYAswCwAKwAqACjAJ0AlwCRAIoAgwB8AHUAbgBnAGAAWQBSAEsARAA+ADcAMQArACUAIQAcABgAFQASABAADgANAAwACwALAAwADQAPABEAFAAXABsAIAAkACkALgA0ADkAPwBEAEoAUABWAFwAYwBpAG8AdAB6AH8AgwCIAIwAjwCTAJYAmACbAJwAngCfAJ8AnwCeAJ0AmwCZAJcAlACRAI4AigCGAIIAfgB5AHQAbwBqAGUAYABaAFUAUABMAEcAQwA+ADoANwAzADAALQAqACgAJgAlACQAIwAjACMAJAAlACYAJwApACsALgAxADQANwA7AD4AQgBGAEsATwBTAFcAWwBgAGQAaABsAHAAcwB3AHoAfQCAAIIAhACGAIgAiQCKAIoAiwCLAIoAigCJAIcAhgCEAIIAfwB9AHoAdwB0AHEAbQBqAGYAYwBfAFwAWABUAFEATgBKAEcARQBCAD8APQA7ADkAOAA2ADUANAA0ADQANAA0ADUANQA2ADgAOQA7AD0APwBBAEQARgBJAEwATwBSAFUAWABbAF4AYQBkAGYAaQBsAG4AcAByAHQAdgB4AHkAegB7AHwAfAB9AH0AfAB8AHsAegB5AHgAdwB1AHMAcQBvAG0AawBoAGYAYwBhAF4AXABZAFcAVQBSAFAATgBMAEoASABGAEUARABCAEEAQQBAAEAAQAA/AEAAQABBAEEAQgBDAFcAWABYAFgAWABYAFgAWABYAFgAWABYAFgAWABZAFkAWQBZAFkAWQBaAFoAWgBaAFsAWwBbAFsAXABcAFwAXABcAF0AXQBdAF0AXQBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF4AXgBeAF0AXQBdAF0AXQBdAFwAXABcAFwAXABbAFsAWwBbAFsAWgBaAFoAWgBaAFoAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBZAFkAWQBaAFoAWgBaAFoAWgBaAFsAWwBbAFsAWwBbAFwAXABcAFwAXABcAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXQBdAF0AXABcAFwAXABcAFwAXABcAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFoAWgBaAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABcAFwAXABbAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAFsAWwBbAA==",
    "ui-click-2.wav": "UklGRqQMAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YYAMAABoAJkAoQ7PARcL+QqFCL4EUAGG+TfqI+rb4j/ohfUx/UQTjipcO9RLX1IlUSNGyTM8G3v6bdzDyH7Fm8rJ3Pf3Yh/NPk9UtFy6XiJbhVDjOa0bO/oY31PLa8I4whXIDdUc5q/5cwgnETgT0Qwc/Yrow9GdvZyumKSlnwieBaBopGas3rarwrLMntML1jnT4syQxKy7VLR0r26tp65Ds6C7L8eB1R/lb/Oy/ukFsQg5B94C3vy+9vnx1O9N8X32Rv+6CmcXwyNULho2xzpdPAo7WjfRMXErXSWXIBYeTR4qIR8mOix/MuA3oTtHPZI8gzkpNP0sqiQsHIsUpw4OC+wJ/AqdDQAROxRwFvcWXBV+EYUL8gOH+zTz1usZ5mzi5uBf4Xrji+YW6mztOu/Q753uoetR50niKN2B2FLVntPo0xfWxtnU3qTkQurD7xnz8PTA9PLy4+9e7P/odObV5Qrnaeri77z2cf4oBroM5BH+FNYVeBSBEZ0NkQkEBsgDkwNfBRMJKQ4mFBEaHB+YIjsk8iPkIToehhlwFLkP6gt+CboIcQl5C0gOVBHrE5IV7xXPFCkSPw5vCSoEOP8h+8T3/fWK9SL2jfdp+Sj7Ofyu/AL8fPor+Cv1E/I079/sV+ud6qnqZeuj7EXu4+9S8Ufyb/N582Lz2fJI8nrx4PBg8B/wpvCv8VHzn/Uf+OP6oP33//ABGQNuA/gCAAK/AIb/l/5A/tz+WQCfAmcFiwiQCxcOvg97EFMQcA/fDfsLEwqGCHwHIweMB4sI/AmYCyENRg7YDrsO6w1oDGUKFwi+BZ0D5AG9ACsAKwCgACsBKgKyAuMCnwLkAXIAqv6a/Gb6XfjJ9rf1cPW89Yz21fc/+a76v/s3/Pv7E/uX+db37vUv9ALzj/Le8unznvXM9xL6Ivy6/cT+Iv/0/mH+Gv0I/BD7VvoX+l/6Jvs8/OP9m/+BAVADvgTiBZ4G6QbRBk8GdwV1BHIDtwI9AicCmQKkAwYFngY2CLYJyApRCykLcQpWCfIHagb+BOQDOAP4AiwDtwNqBCIFsgX3BdAFOAU8BO0CZgHU/2D+Kf1K/Mv7q/vV+zT8n/wB/Tv9Nf3j/En8ePuC+on5qvj895b3gPe59zb45Piq+Wn6Fvtz++P73/uz+2r7I/vC+o36gfqc+vf6nPtz/JD9uv7c//wA7AGzAi0DUgMnA8UCRQLVAXsBVwGUATMCHgM/BH8FvwbHB3UItgiVCCQIageFBqAF4QRXBBIEGwRfBM8ETwXGBRYGNAbkBaYF5AT4A/gCBQL8ACgAf//4/qn+mv6u/gT/Xf+o//H/DgAPAM3/Qv90/nj9afx2+576AvrS+Qv6lvpg+1T8VP0m/qn+yf6T/h7+bv2f/N77T/sB+/76U/vl+6v8hf1d/hX/mP/b/+T/s/9Y/+v+g/42/hT+Kv53/vb+mv9PAAcBrgEwAoICpQKaAmwCLALoAbABlQGcAcsBHQKLAgYDfgPoAzQEWgRXBC4E5QOHAyIDwwJ2AkICKwIyAlACfAKqAs4C3wLUAqoCYgIAAowBEwGdADYA5f+u/5P/j/+c/7H/xf/O/8X/p/9z/yv/1/5+/in+4f2s/ZD9jP2g/cb99/0r/lv+f/6U/pf+i/5z/lX+Of4l/iD+Lv5Q/oX+y/4a/23/vP8CADoAYgB5AIQAhgCEAIUAjgCkAMcA+QA2AXoBwAECAjsCZwKDAo4CiwJ9AmgCUgI/AjMCMgI6AksCYwJ8ApMCowKoAp8CiQJlAjgCAwLNAZkBawFFASkBFwEMAQUB/wD1AOYAzgCsAIAATgAXAOD/q/99/1f/PP8s/yT/I/8m/yr/K/8n/x3/Df/4/uD+yP6y/qL+m/6c/qf+u/7W/vX+Fv82/1L/aP96/4b/jv+V/5z/pv+2/8z/6P8LADMAXgCJALIA1wD2AA8BIQEuATcBPgFFAU4BWgFqAX4BlQGtAcUB2gHrAfcB+wH5AfEB5QHVAcQBtAGmAZsBkgGNAYkBhQGAAXgBbAFcAUYBLAEOAe8AzwCwAJMAegBlAFQARgA6AC4AIwAVAAYA8//e/8j/sf+a/4X/dP9m/13/Wf9Y/1v/X/9l/2r/b/9x/3P/c/9y/3L/c/93/37/if+Y/6n/vf/T/+r///8UACcANwBFAFIAXgBqAHcAhQCVAKYAugDOAOMA+AALARwBKgE2AT4BRAFIAUoBTAFOAVABUwFXAVwBYAFjAWUBZQFjAV4BVgFMAT8BMgEkARYBCAH8APAA5QDbANEAxwC8ALAAogCTAIIAcABfAE0APAAtAB8AEwAJAAEA+v/z/+3/5//h/9r/0//M/8X/v/+6/7f/tf+1/7j/vP/B/8j/0P/Y/+H/6P/w//f//v8EAAwAFAAdACcAMwBAAE0AWwBqAHgAhQCSAJ0ApwCxALkAwQDIANAA2ADgAOgA8QD5AAABBwENARIBFQEWARYBFQETARABDQEKAQYBAwEAAfwA+QD0AO8A6QDiANoA0ADHALwAsQCnAJwAkgCJAIAAdwBvAGcAYABYAFAARwA/ADYALQAlAB4AFwARAAwACAAFAAMAAgABAAEAAQABAAEAAQACAAMABQAHAAoADgATABkAIAAnAC4ANQA9AEQASwBSAFkAYABnAG4AdQB8AIQAjACUAJwApACrALIAuAC+AMMAxwDLAM4A0QDUANYA2ADbANwA3gDfAN8A3wDfAN0A2wDYANQA0ADMAMgAwwC+ALkAtACvAKoApQCgAJoAlACNAIcAgAB5AHIAbABlAF8AWgBVAFAASwBHAEMAPwA8ADgANQAyAC8ALAAqACkAKAAnACcAKAApACsALQAvADEANAA3ADkAPABAAEMARwBLAFAAVABZAF8AZABpAG8AdAB5AH4AgwCIAIwAkQCVAJkAnQChAKUAqQCsAK8AsgC1ALcAuQC6ALsAvAC8ALwAuwC7ALoAuQC4ALYAtQCzALEArgCrAKgApQChAJ0AmQCVAJEAjQCJAIUAgQB9AHkAdQBxAG4AagBmAGIAXwBbAFgAVQBSAE8ATQBLAEoASABHAEYARgBFAEUARQBFAEUARgBHAEgASQBLAE0ATwBSAFQAVwBaAF0AXwBiAGYAaQBsAG8AcgB2AHkAfACAAIMAhgCJAI0AjwCSAJUAlwCZAJsAnQCfAKAAoQCjAKQApAClAKUApgCmAKUApQCkAKMAogCgAJ8AnQCbAJkAlwCVAJMAkQCPAIwAiQCHAIQAgQB/AHwAeQB2AHQAcQBvAGwAagBoAGYAZABiAGAAXgBdAFwAWgBZAFgAWABXAFcAVwBXAFcAVwBYAFkAWgBaAFwAXQBeAGAAYQBjAGUAZgBoAGsAbQBvAHEAcwB1AHgAegB8AH4AgACCAIQAhgCIAIoAiwCNAI8AkACRAJIAkwCUAJUAlQCWAJYAlgCWAJYAlgCWAJUAlQCUAJMAkgCRAJAAjwCNAIwAigCJAIcAhQCEAIIAgAB/AH0AewB5AHgAdgB0AHIAcQBvAG4AbABrAGoAaQBoAGcAZgBlAGUAZABkAGMAYwBjAGMAYwBjAGQAZABlAGUAZgBnAGgAaQBqAGsAbABtAG8AcABxAHMAdAB2AHcAeAB6AIAAgACAAIAAfwB/AH4AfgB9AH0AfAB8AHsAewB6AHkAeQB4AHgAdwB3AHYAdgB2AHUAdQB1AHQAdAB0AHQAcwBzAHMAcwBzAHMAcwBzAHMAcwBzAHQAdAB0AHQAdQB1AHUAdgB2AHYAdwB3AHgAeAB4AHkAeQB6AHoAewB7AHwAfAB8AH0AfQB9AH4AfgB+AH8AfwB/AH8AfwB/AIAAgACAAIAAgACAAIAAfwB/AH8AfwB/AH8AfgB+AH4AfgB9AH0AfQB8AHwAfAB7AHsAewB6AHoAegB5AHkAeQB4AHgAeAB3AHcAdwB3AHYAdgB2AHYAdgB2AHYAdQB1AHUAdQB1AHUAdgB2AHYAdgB2AHYAdgB2AHcAdwB3AHcAeAB4AHgAeQB5AHkAeQB6AHoAegB6AHoAewB7AHsAewB7AHsAfAB8AHwAfAB8AHwAfAB8AHwAfAB8AHwAfAB8AHwAewB7AHsAewB7AHsAewB7AHsAewB7AHoAegB6AHoAegB6AHoAegB6AHoAegB6AHoAeQB5AHkAeQB5AHkAeQB5AHkAeQB5AHkAeQB5AHkAeQB5AHkAegB6AHoAegB6AHoAegB6AHoAegB6AHoAegB6AHoAegB6AHoAegB6AHoAegB6AA==",
    "ui-click-3.wav": "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wADNANcA4ADoAO8A9gD8AAEBBAEEAQIB/QD1AOwA4gDXAMwAwAC0AKcAmQCKAHkAZgBUAEEALwAeAA8AAQDz/+b/2v/N/8H/tf+r/6P/nf+Z/5j/mP+Z/5v/nv+i/6f/rP+0/73/x//U/+H/8P/+/wwAGgAnADUAQgBQAF4AbQB7AIkAlQCgAKoAsgC4AL4AwwDHAMoAzQDOAM4AzADJAMMAvQC1AKwApACaAJEAhwB8AHEAZABYAEoAPQAwACMAGAANAAMA+f/w/+j/4P/Y/9H/zP/H/8X/w//D/8T/xv/J/83/0f/W/9z/4v/q//P//f8HABIAHAAnADEAOwBGAFAAWgBkAG4AdwCAAIgAjwCVAJoAngChAKQApgCnAKcApwClAKIAnwCaAJQAjgCHAIAAeABwAGgAYABXAE4ARAA7ADEAKAAfABcAEAAJAAIA/P/3//L/7f/p/+f/5f/k/+T/5f/m/+n/7P/v//P/+P/9/wMACQAQABgAIAAoADAANwA/AEcATgBVAFwAYwBqAHAAdgB7AH8AgwCGAIgAigCLAIsAiwCKAIkAhwCEAIAAfAB3AHIAbQBnAGEAWwBUAE4ARwBAADkAMwAsACYAIAAaABUAEAAMAAgABQACAP///v/8//z//P/9//7/AAACAAUACAAMABAAFAAZAB4AJAAqAC8ANQA7AEEARgBMAFEAVgBbAGAAZABoAGwAbwBxAHMAdQB2AHcAdwB2AHYAdABzAHAAbgBrAGcAYwBfAFsAVgBSAE0ASABDAD4AOQA0AC8AKwAnACMAHwAbABgAFgATABEAEAAOAA4ADQAOAA4ADwARABMAFQAYABoAHQAhACQAKAAsADAANQA5AD0AQQBGAEoATQBRAFUAWABbAF4AYABjAGQAZgBnAGgAaABoAGcAZwBmAGQAYgBgAF4AWwBYAFUAUgBPAEsASABEAEAAPQA5ADYAMgAvACwAKQAmACQAIgAgAB4AHQAcABsAGwAaABsAGwAcAB0AHwAgACIAJQAnACkALAAvADIANQA4ADsAPgBCAEUASABKAE0AUABSAFQAVgBYAFkAWwBcAFwAXQBdAF0AXABcAFsAWgBYAFcAVQBTAFEATgBMAEoARwBEAEIAPwA8ADoANwA1ADIAMAAuACwAKgApACcAJgAlACUAJAAkACQAJAAlACUAJgAoACkAKgAsAC4AMAAyADQANgA4ADsAPQA/AEEARABGAEgASgBMAE0ATwBQAFEAUwBTAFQAVABVAFUAVQBUAFQAUwBSAEQARABFAEYARgBHAEgASABIAEkASQBJAEkASQBJAEgASABIAEcARwBGAEUARABEAEMAQgBBAEAAPwA+AD0APAA7ADoAOgA5ADgANwA3ADYANgA2ADUANQA1ADUANQA1ADUANgA2ADYANwA4ADgAOQA5ADoAOwA8AD0APQA+AD8AQABBAEEAQgBDAEMARABEAEUARQBGAEYARgBGAEYARgBGAEYARgBFAEUARQBEAEQAQwBDAEIAQQBBAEAAPwA/AD4APQA8ADwAOwA7ADoAOgA5ADkAOAA4ADgAOAA4ADcANwA4ADgAOAA4ADgAOQA5ADkAOgA6ADsAOwA8AD0APQA+AD4APwBAAEAAQQBBAEIAQgBCAEMAQwBDAEQARABEAEQARABEAEMAQwBDAEMAQwBCAEIAQgBBAEEAQQBAAEAAQAA/AD8APgA+AD0APQA9AD0APQA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA8ADwAPAA9AD0APQA9AD0APQA+AD4APgA+AD4APgA+AD8APwA/AD8APwA/AD8APwA/AD8APwA/AD8APwA/AD8APwA/AD8APwA/AD8APwA/AD8APgA+AD4APgA+AD4APgA+AD4APgA+AD4APgA+AD4APgA+AA=="
  };
  /*@@/EMBED*/

  // 旧接口别名：play("start") 直接走开关音（用户定的）
  var ALIAS = { start: "toggle" };

  var DURATION = {
    "ui-click-1.wav": 100, "ui-click-2.wav": 100, "ui-click-3.wav": 100,
    "ui-hover-1.wav": 160, "ui-hover-2.wav": 160,
    "ui-back-1.wav": 240, "ui-back-2.wav": 240,
    "score-1.wav": 520, "score-2.wav": 520, "score-3.wav": 520,
    "catch-1.wav": 360, "catch-2.wav": 360, "catch-3.wav": 360,
    "error-1.wav": 420, "error-2.wav": 420,
    "land-1.wav": 300, "land-2.wav": 300, "land-3.wav": 300,
    "glitch-1.wav": 400, "glitch-2.wav": 400, "glitch-3.wav": 400,
    "warn-1.wav": 460, "warn-2.wav": 460,

    "success-1.wav": 820, "success-2.wav": 820,
    "toggle-1.wav": 170, "toggle-2.wav": 170
  };

  // 各类音效的默认响度（打击类压低，提示类适中）
  var GAIN = {
    click: 0.72, hover: 0.5, back: 0.72, toggle: 0.6,
    score: 0.85, catch: 0.85, success: 0.85, start: 0.8,
    error: 0.7, warn: 0.75, land: 0.7, glitch: 0.6
  };

  /* ---------- 状态 ---------- */
  var MUTE_KEY = "rtsx.sfx.muted";
  var PREF_KEY = "rtsx.sfx.pref";
  var VOL_KEY = "rtsx.sfx.vol";

  var muted = false, master = 0.75;
  var prefs = {};
  var lastPick = {};
  var pools = {};        // file -> [HTMLAudioElement, ...]
  var POOL_SIZE = 2;
  var useLimiter = true; // 同时播放过多时降音量，避免爆音
  var liveCount = 0;

  try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch (e) {}
  try {
    var pv = parseFloat(localStorage.getItem(VOL_KEY));
    if (!isNaN(pv) && pv > 0 && pv <= 1) master = pv;
  } catch (e) {}
  try {
    prefs = JSON.parse(localStorage.getItem(PREF_KEY) || "{}") || {};
  } catch (e) { prefs = {}; }

  function savePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch (e) {}
  }

  function url(file) { return base + file; }

  function buildPool(file) {
    if (pools[file]) return pools[file];
    var arr = [];
    var src = EMBED[file] ? ("data:audio/wav;base64," + EMBED[file]) : url(file);
    // 内嵌音效不花流量，备两份；文件类只备一份，别在打开页面时抢带宽
    var size = EMBED[file] ? POOL_SIZE : 1;
    for (var i = 0; i < size; i++) {
      var a = new Audio();
      a.preload = "auto";
      a.src = src;
      if (!EMBED[file]) a.load();
      arr.push(a);
    }
    pools[file] = arr;
    return arr;
  }

  function freeElement(file) {
    var pool = buildPool(file);
    for (var i = 0; i < pool.length; i++) {
      if (pool[i].paused || pool[i].ended) return pool[i];
    }
    return pool[0];
  }

  function pick(group) {
    var g = CATALOG[group] || CATALOG[ALIAS[group]];
    if (!g) return null;
    var fixed = prefs[group];
    if (fixed && g.files.indexOf(fixed) !== -1) {
      lastPick[group] = fixed;
      return fixed;
    }
    if (g.files.length === 1) { lastPick[group] = g.files[0]; return g.files[0]; }
    var prev = lastPick[group];
    var cand = [], i;
    for (i = 0; i < g.files.length; i++) if (g.files[i] !== prev) cand.push(g.files[i]);
    if (!cand.length) cand = g.files.slice();
    var chosen = cand[Math.floor(Math.random() * cand.length)];
    lastPick[group] = chosen;
    return chosen;
  }

  function play(group, opts) {
    var file = pick(group);
    if (!file) return null;
    if (muted) return file;
    var o = opts || {};
    var el = freeElement(file);
    var g = (GAIN[group] == null ? 0.8 : GAIN[group]);
    var vol = Math.max(0, Math.min(1, master * g * (o.volume == null ? 1 : o.volume)));
    if (liveCount > 3) vol *= 0.6;
    try {
      el.volume = vol;
      el.currentTime = 0;
      var pr = el.play();
      if (pr && pr.catch) {
        pr.catch(function () {
          // 浏览器未解锁或文件不可播：静默失败，不抛错
        });
      }
      liveCount++;
      setTimeout(function () { liveCount = Math.max(0, liveCount - 1); }, (DURATION[file] || 300) + 30);
    } catch (e) {
      return file;
    }
    if (o.label && window.console && console.debug) console.debug("[sfx]", group, file);
    return file;
  }

  /* 试听某个具体文件：走同一套池子，第一次之后就是秒出 */
  function preview(file, group) {
    if (!file) return null;
    if (muted) return file;
    var el = freeElement(file);
    var g = (GAIN[group] == null ? 0.8 : GAIN[group]);
    try {
      el.volume = Math.max(0, Math.min(1, master * g));
      el.currentTime = 0;
      var pr = el.play();
      if (pr && pr.catch) pr.catch(function () {});
    } catch (e) { return file; }
    return file;
  }

  /* ---------- 预加载 ---------- */
  function preload(groups) {
    var keys = groups || Object.keys(CATALOG);
    keys.forEach(function (k) {
      var g = CATALOG[k];
      if (!g) return;
      g.files.forEach(function (f) { buildPool(f); });
    });
  }

  /* ---------- 自动绑定 ---------- */
  function bind(root) {
    var scope = root || document;
    var nodes = scope.querySelectorAll("[data-sfx]");
    for (var i = 0; i < nodes.length; i++) {
      (function (n) {
        if (n.__sfxBound) return;
        n.__sfxBound = true;
        var clickKey = n.getAttribute("data-sfx") || "click";
        var hoverKey = n.getAttribute("data-sfx-hover");
        var fired = false;
        // 按下就响，不等 click（click 要等手指抬起，听着像延迟）
        n.addEventListener("pointerdown", function () { fired = true; play(clickKey); });
        n.addEventListener("click", function () { if (!fired) play(clickKey); fired = false; });
        n.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") { fired = true; play(clickKey); }
        });
        if (hoverKey) {
          n.addEventListener("pointerenter", function () { play(hoverKey, { volume: 0.7 }); });
        }
      })(nodes[i]);
    }
  }

  /* ---------- 对外 ---------- */
  window.RTSXSFX = {
    version: "1.0",
    base: base,
    groups: function () { return Object.keys(CATALOG); },
    catalog: function () {
      var out = [];
      Object.keys(CATALOG).forEach(function (k) {
        out.push({
          key: k, label: CATALOG[k].label,
          files: CATALOG[k].files.map(function (f) {
            return { file: f, url: url(f), ms: DURATION[f] || 0, chosen: prefs[k] === f };
          })
        });
      });
      return out;
    },
    pick: pick,
    play: play,
    preview: preview,
    warm: function (file) { buildPool(file); return file; },
    preload: preload,
    bind: bind,
    setPreference: function (group, file) {
      if (!CATALOG[group]) return false;
      if (file === null || typeof file === "undefined") delete prefs[group];
      else if (CATALOG[group].files.indexOf(file) === -1) return false;
      else prefs[group] = file;
      savePrefs();
      return true;
    },
    getPreference: function (group) { return prefs[group] || null; },
    mute: function (v) {
      muted = !!v;
      try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch (e) {}
      if (muted) {
        Object.keys(pools).forEach(function (f) {
          pools[f].forEach(function (a) { try { a.pause(); } catch (e) {} });
        });
      }
      return muted;
    },
    toggleMute: function () { return this.mute(!muted); },
    isMuted: function () { return muted; },
    setVolume: function (v) {
      master = Math.max(0, Math.min(1, v));
      try { localStorage.setItem(VOL_KEY, String(master)); } catch (e) {}
      return master;
    },
    getVolume: function () { return master; }
  };

  // 首次交互解锁音频（移动端必须由用户手势触发）
  function unlockOnce() {
    var one = "";
    try { one = play("toggle", { volume: 0.001 }); } catch (e) {}
    document.removeEventListener("pointerdown", unlockOnce, true);
    document.removeEventListener("keydown", unlockOnce, true);
    return one;
  }
  document.addEventListener("pointerdown", unlockOnce, true);
  document.addEventListener("keydown", unlockOnce, true);

  // 常用音等页面空闲了再取，别和页面本身抢带宽（点击音已内嵌，不需要网络）
  function warmHot() { preload(["click", "hover", "toggle", "back", "start"]); }

  function boot() {
    bind(document);
    if (window.requestIdleCallback) requestIdleCallback(warmHot, { timeout: 2500 });
    else setTimeout(warmHot, 800);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
