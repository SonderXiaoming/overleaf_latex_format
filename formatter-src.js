// formatter-src.js
import { printPrettier } from "prettier-plugin-latex/standalone.js";

const DEFAULTS = {
    tabWidth: 2,
    printWidth: 100,
    useTabs: false,
    endOfLine: "lf",
};

// 既返回 Promise，也可传回调
window.ltxFormat = function ltxFormat(src, opts = {}, cb) {
    const p = printPrettier(src, { ...DEFAULTS, ...opts }).catch((e) => {
        console.error("[OFH] Prettier format error:", e);
        return src; // 出错时回退原文
    });
    if (cb) p.then((res) => cb(res));
    return p;
};

// 如果你在别处通过 OFHFormatter 调用，也把它挂上去
window.OFHFormatter = window.OFHFormatter || {};
window.OFHFormatter.ltxFormat = (...args) => window.ltxFormat(...args);
