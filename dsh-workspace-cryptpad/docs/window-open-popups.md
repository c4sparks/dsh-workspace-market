# CryptPad 弹窗 / window.open 问题记录

> 现象:CryptPad 面板里点"打开新标签"类操作,界面报
> **「CryptPad 需要能够打开新标签才能操作。请允许在浏览器的地址栏中弹出窗口」**,
> 或连接打不开。

## 根因

CryptPad 是**双 iframe 架构**(外层 sframe 页 + 内层 sframe iframe),真正触发新标签的是外层
`www/common/sframe-common-outer.js` 里的 `openURL`:

```js
var openURL = function (url) {
    if (!url) { return; }
    var a = window.open(url);
    if (!a) { sframeChan.event('EV_POPUP_BLOCKED'); }  // ← 用户看到的那条提示
};
sframeChan.on('EV_OPEN_URL', openURL);  // 由内层 iframe 的 postMessage 触发
```

问题在于 **`openURL` 是在 postMessage 消息处理器里执行的,不是用户直接点击的手势上下文**:

- 浏览器(Chrome)对**非用户激活**的 `window.open` 一律拦截,返回 `null`;
- `window.open() === null` → CryptPad 触发 `EV_POPUP_BLOCKED` → 显示上面的提示;
- 工作台 widget 的 iframe **即使带了 `allow="popups"`**(`src/client/CryptPadWidget.tsx`),
  `allow` 只解除 Permission Policy 限制,**不豁免浏览器的"用户激活"检查**,所以仍然被拦。

## 修复

### Web(浏览器)侧

`vendor/cryptpad-fixes/www/common/sframe-common-outer.js` 里,把 `openURL` 与
`EV_OPEN_VIEW_URL` 两处 `window.open` 的兜底从「报 EV_POPUP_BLOCKED」改为「**当前 iframe 内导航**」:

```js
var a = window.open(url);
if (!a) {
    // 弹窗被拦 → 当前 iframe 内导航兜底,不再报「需要允许弹窗」
    window.location.href = url;
}
```

> 改的是 `vendor/`(源),构建时 `scripts/copy-fixes.mjs` 会把 `vendor/cryptpad-fixes` 同步到
> `lib/cryptpad-fixes`(运行时实际使用)。**改完必须 `pnpm run build` 重建**。

### ⚠️ 改了 vendor / lib 但运行时还报错?—— 检查运行期 overlay

插件启动时把 overlay 复制到 **cryptpad checkout 的 `customize/`** 目录
(`src/index.ts` `ensureFixes()`),CryptPad 运行时用 `customize/` 覆盖同名静态文件。
旧版 `ensureFixes()` **只在 marker 存在时跳过**(`template.js` 含 `dsh-workspace-cryptpad` 即
`return`),所以**第一次装完后,后续 fix 更新永远不会再应用**——运行期 `customize/` 里残留旧版
`sframe-common-outer.js`,`EV_POPUP_BLOCKED` 照旧触发。

- 位置:`<cryptpad checkout>/customize/`,checkout 在插件
  `node_modules/.pnpm/cryptpad@.../node_modules/cryptpad`。
- 判定:运行期 `customize/www/common/sframe-common-outer.js` 里 `grep EV_POPUP_BLOCKED` 若还有
  命中 = 残留旧版。
- 处理:
  1. 删掉运行期 `customize/`(或整目录),重启 `dsh web` 让它从 `lib/cryptpad-fixes` 重装;或
  2. 手动把 `lib/cryptpad-fixes` 复制成运行期 `customize/` 后重启;
  3. `ensureFixes()` 已改为**每次启动覆盖安装**(先 `rmSync` 再 `cpSync`,`src/index.ts`),修复后
     `pnpm run build` 重建 `lib/index.js`,以后 fix 更新重启即生效,无需再手动清。

### Desktop(Electron)侧

`dsh-desktop` 主进程(`dsh-workspace-sidebar/dsh-desktop/src/main.ts`)原先**完全没有**调用
`setWindowOpenHandler`,window.open 默认会新开 Electron BrowserWindow。现已在 `createWindow()` 加:

```ts
win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)        // 走系统默认浏览器
    return { action: 'deny' }           // deny 让 window.open 拿到 null
})
```

配合 web 侧"被拦 → 当前 iframe 内导航"的兜底,deny 不会触发 CryptPad 报错。

## 排查清单(此类问题通用)

1. **是不是手势问题**:非用户点击链路上触发的 `window.open`,Chrome 一律拦(即使 iframe 已 `allow="popups"`)。
   排查:在页面 DevTools 控制台手动 `window.open(...)` 一般能开,点击流里就返回 null → 基本就是它。
2. **iframe 是否有 `allow="popups"` / sandbox**:`<iframe sandbox>` 没加 `allow-popups` 会**静默**返回 null
   (连提示都没有)。
3. **跨源 iframe 更严**:跨源 iframe 的 `window.open` 手势要求更严格,别指望和顶层页面一致。
4. **Electron 端**:`webContents.setWindowOpenHandler` 是主进程 API,页面里查不到;
   没设置时 window.open 默认开新 Electron 窗口,不会报错但体验差——按需 `shell.openExternal` 或 `allow`。
