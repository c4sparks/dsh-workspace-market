// SPDX-FileCopyrightText: 2023 XWiki CryptPad Team <contact@cryptpad.org> and contributors
//
// SPDX-License-Identifier: AGPL-3.0-or-later
// NOTE(dsh-workspace-cryptpad, modified 2026-08-30): 桌面 WebView2 在跨源 iframe 里无法抓取 worker 脚本
// （console 报 "Failed to fetch a worker script"），CryptPad 应用会卡在加载。
// 强制禁用 worker，走主线程 store 兜底（cryptpad-common.js noWorker 分支）。

(() => {
const factory = (AppConfig) => {
    AppConfig.disableWorkers = true;
    return AppConfig;
};

// Do not change code below
if (typeof(module) !== 'undefined' && module.exports) {
    module.exports = factory(
        require('../www/common/application_config_internal.js')
    );
} else if ((typeof(define) !== 'undefined' && define !== null) && (define.amd !== null)) {
    define(['/common/application_config_internal.js'], factory);
}

})();
