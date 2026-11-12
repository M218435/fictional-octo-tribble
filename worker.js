// 微信演示版 · 转发服务（Cloudflare Worker，纯 JS，不需要服务器）
//
// 为什么需要它：智谱的接口不返回 CORS 头，任何网页（包括 GitHub Pages）直连都会被
// 浏览器拦下来。这个 Worker 只是把请求原样转发给智谱，并补上 CORS 头。
//
// 部署：dash.cloudflare.com → Workers → 新建 → 粘贴本文件 → 部署，
// 得到形如 https://wx-demo.xxx.workers.dev 的地址，填到 app.js 的 PROXY_URL。

const UPSTREAM = 'https://open.bigmodel.cn/api/paas/v4';

// 建议改成你自己的站点，例如 'https://你的用户名.github.io'
const ALLOW_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOW_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    // 用浏览器直接打开这个地址时，回一句人话，方便确认它到底部署成功没有
    if (request.method === 'GET' || request.method === 'HEAD') {
      return new Response('worker 已部署：把这个地址填到 app.js 的 PROXY_URL（或页面里的 AI 接口设置）。', {
        status: 200,
        headers: { ...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
    if (request.method !== 'POST') {
      return json({ error: { message: 'only POST is allowed' } }, 405);
    }

    const body = await request.text();
    const headers = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('Authorization');
    if (auth) headers['Authorization'] = auth;

    try {
      const upstream = await fetch(UPSTREAM, { method: 'POST', headers, body });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: { ...corsHeaders(), 'Content-Type': 'application/json; charset=utf-8' }
      });
    } catch (e) {
      return json({ error: { message: 'proxy failed: ' + e.message } }, 502);
    }
  }
};
