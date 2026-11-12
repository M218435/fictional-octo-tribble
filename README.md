# 微信 · 本地演示版

一个仿微信界面的纯前端演示项目：开屏加载 → 登录/注册 → 聊天 / 通讯录 / 发现 / 我，接入了智谱 GLM 作为「AI 助手」。

**这不是真正的微信。** 它不连接腾讯服务器，真实微信账号无法登录，必须注册演示账号；账号、聊天记录、朋友圈都只存在当前浏览器里。

## 文件结构

```
index.html      页面结构与样式
app.js          全部交互逻辑（含 AI 请求、localStorage 存储）
worker.js       可选的转发服务（Cloudflare Worker），让 AI 在网页里真正连通
icon/ODF-hd.png 图标
_backup/        历史版本，不用上传
_shots/         自检截图，不用上传
```

## 本地查看

直接双击 `index.html`。界面与聊天都能用，但 AI 会退到「离线演示回复」——因为浏览器跨域策略不允许网页直连智谱接口。

## 部署到 GitHub Pages

**这个项目选「静态文件、无需构建」这一种。** 它没有打包步骤，`index.html` 就是最终页面，用 Jekyll 或 Actions 只会多一层可能出错的东西（Jekyll 会去处理页面里的花括号，Actions 要等队列）。

不用装 git，网页上就能传：

1. github.com 右上角 **+** → **New repository**，名字随便取（例如 `wechat-demo`），Public，Create。
2. 进仓库点 **Add file → Upload files**，把 `index.html`、`app.js`、`worker.js`、`README.md`、`icon` 文件夹一起拖进去，Commit changes。
   - 目录必须保持平铺：`index.html` 和 `app.js` 在同一层，图标在 `icon/` 里。
   - 再加一个空文件 `.nojekyll`（Add file → Create new file，文件名就写 `.nojekyll`，内容留空）。有它 GitHub 才会原样发布文件、不套 Jekyll。
3. 仓库 **Settings → Pages → Source** 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`，Save。
4. 等 1–2 分钟，访问 `https://你的用户名.github.io/仓库名/`。

发布后如果更新了 `app.js` 却没生效，先按 Ctrl+F5 强刷——Pages 有缓存。

页面里的账号与聊天记录存在浏览器 localStorage，换设备或清缓存会丢。

## 让 AI 真的回复

GitHub Pages 只放静态文件，不能当转发，而智谱接口又不给 CORS 头，所以有两条路，选一条就行。

### 路线 A：什么都不用额外部署（推荐先试这个）

1. 打开页面「我 → AI 接口设置」，点「填入公共免费接口」。
2. 点「测试连接」，看到「连接成功」就点「保存」。
3. 聊天页发一句试试。

它用的是公共免费接口（`text.pollinations.ai`），不是智谱，也不需要 Key，适合演示。我在浏览器里实测过：跨域放行、中文正常返回。它是公益服务，可能变慢或停服，长期用请走路线 B。

### 路线 B：用自己的智谱 Key（走 Cloudflare 转发）

1. 打开 dash.cloudflare.com 并登录，左边选 **Workers & Pages** → **Create** → **Worker** → **Deploy**（先用默认模板建一个）。
2. 进去点 **Edit code**，把编辑器里的内容全删掉，粘贴本项目的 `worker.js` 全文。
3. 右上角 **Deploy**（有些界面是 Save and Deploy），等它变成已部署。
4. 页面右上方会显示地址，形如 `https://wx-demo.你的子域.workers.dev`。**复制这个正式地址，不要用带随机字母前缀的 Preview 地址**——预览地址直接访问会返回 404。
5. 想确认它活着：浏览器直接打开这个地址，看到「worker 已部署」这行字就说明部署成功。
6. 回到页面「我 → AI 接口设置」，把地址填进「接口地址」，Key 保留智谱的，点「测试连接」，通了再点「保存」。

`400/401/429` 之类都在这一步能看出来：404 是地址不对或没部署，405 是填了静态站点地址，403 是 Key 被拒，429 是上游限流。

设置存在浏览器里，不用改代码；也可以改 `app.js` 顶部的 `PROXY_URL` 写死。

不管走哪条，连不上时聊天里都会明确标注原因并给本地演示回复，不会假装成功。

## 安全提示

`app.js` 里的 API Key 是明文，任何人打开页面源码都能看到。仅供演示，别把它当生产配置；要长期用，应该把 Key 放到 Worker 的环境变量里，页面只调自己的转发地址。

## 关于 `示例/` 文件夹

那份 Frasnow Chat 用的是第三方转发站 `new.sharedchat.cc/codex`。实测该接口已关闭旧转发链路（返回「该接口未接入公益站独立网关，旧转发链路已关闭」），且响应不带 CORS 头，所以照它的写法直连拿不到回复。本项目的「AI 接口设置」可以填任意这类兼容 OpenAI 格式的转发地址，换一个能用的填进去即可。


## 已知未实现

支付、视频通话、真实好友关系、语音/图片消息都没有做，扫一扫、小程序、视频号只是演示入口。
