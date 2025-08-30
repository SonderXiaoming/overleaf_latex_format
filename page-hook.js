function splitLines(text) { return text.split("\n"); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function offsetFromLineChInText(text, line0, ch) {
    const lines = splitLines(text);
    const L = clamp(line0, 0, lines.length - 1);
    const C = clamp(ch, 0, lines[L].length);
    let off = 0;
    for (let i = 0; i < L; i++) off += lines[i].length + 1; // +1 for '\n'
    return off + C;
}

function lineChFromOffsetInText(text, off) {
    off = clamp(off, 0, text.length);
    const pre = text.slice(0, off);
    const line0 = pre.split("\n").length - 1;
    const lastNL = pre.lastIndexOf("\n");
    const ch = off - (lastNL + 1);
    return { line: line0, ch };
}

// ========== 工具：针对 CM6 文档（已有） ==========
function posFromLineChDoc(state, line0, ch) {
    const line = state.doc.line(line0 + 1);
    return Math.min(line.from + ch, line.to);
}
function lineChFromPosDoc(state, pos) {
    const line = state.doc.lineAt(pos);
    return { line: line.number - 1, ch: pos - line.from };
}


// 监听 Overleaf 的“未稳定”扩展事件，插入一个 ViewPlugin 拿到 EditorView
window.addEventListener("UNSTABLE_editor:extensions", function (evt) {
    const { CodeMirror, extensions } = evt.detail;
    const { ViewPlugin } = CodeMirror;

    const GrabView = ViewPlugin.fromClass(class {
        constructor(view) {
            window.__OFH_VIEW__ = view;
            window.__OFH_ON_CHANGE__ = window.__OFH_ON_CHANGE__ || new Set();
            // console.log("[OFH] got EditorView", view);
        }
        update(u) {
            if (u.docChanged) {
                for (const cb of window.__OFH_ON_CHANGE__) { try { cb(); } catch { } }
            }
        }
        destroy() { delete window.__OFH_VIEW__; }
    });

    extensions.push(GrabView);
});

// ===== 工具：line/ch ↔ offset
function posFromLineCh(state, line0, ch) {
    const line = state.doc.line(line0 + 1);
    return Math.min(line.from + ch, line.to);
}
function lineChFromPos(state, pos) {
    const line = state.doc.lineAt(pos);
    return { line: line.number - 1, ch: pos - line.from };
}

// ===== Editor 封装
const Editor = {
    get view() { return window.__OFH_VIEW__ || null; },
    ensure() {
        const v = this.view;
        if (!v) throw new Error("EditorView not ready");
        return v;
    },
    getText() {
        const v = this.ensure();
        return v.state.doc.toString();
    },
    setText(t, anchor) {
        const v = this.ensure();
        const { state } = v;
        v.dispatch({ changes: { from: 0, to: state.doc.length, insert: t }, selection: anchor != null ? { anchor } : undefined, scrollIntoView: true });
        v.focus();
    },
    getSelectionText() {
        const v = this.ensure();
        const { state } = v;
        return state.selection.ranges.map(r => state.doc.sliceString(r.from, r.to)).join("\n");
    },
    replaceSelection(t) {
        const v = this.ensure();
        const { state } = v;
        const ranges = state.selection.ranges;
        v.dispatch({ changes: ranges.map(r => ({ from: r.from, to: r.to, insert: t })) });
        v.focus();
    },
    getCursor() {
        const v = this.ensure();
        return lineChFromPos(v.state, v.state.selection.main.head);
    },
    setCursor(line0, ch = 0) {
        const v = this.ensure();
        const pos = posFromLineCh(v.state, line0, ch);
        v.dispatch({ selection: { anchor: pos } });
        v.focus();
    }
};

// ===== 你的 formatter 桥（确保 formatter.bundle.js 已在页面挂好）
async function runFormatter(src, opts = {}) {
    const fn = window.OFHFormatter?.ltxFormat || window.ltxFormat;
    if (typeof fn !== "function") throw new Error("Formatter bundle not loaded.");
    return await fn(src, opts);
}

// ===== 选区优先格式化
async function formatSelectionOrAll() {
    const sel = Editor.getSelectionText();
    if (sel && sel.trim()) {
        const out = await runFormatter(sel);
        Editor.replaceSelection(out);
        return { mode: "selection", ok: true };
    } else {
        //console.log("[OFH] no selection, format all");
        const state = Editor.ensure().state;
        const main = state.selection.main;
        const oldHeadPos = main.head;
        const { line: headLine, ch: headCh } = lineChFromPosDoc(state, oldHeadPos);
        const src = Editor.getText();
        const out = await runFormatter(src);
        const anchor = offsetFromLineChInText(out, headLine, headCh);
        Editor.setText(out, anchor);
        return { mode: "full", ok: true };
    }
}

// ===== 同步 \begin{...} 和 \end{...}（在光标处修复不一致）
function syncEnvAtCursor() {
    const v = Editor.ensure();
    const { state } = v;
    const pos = state.selection.main.head;
    const full = state.doc.toString();

    // 找到包含光标的行
    const line = state.doc.lineAt(pos);
    const text = state.doc.sliceString(line.from, line.to);

    // 匹配本行是 begin 还是 end
    const beginRe = /\\begin\{([^\}]+)\}/;
    const endRe = /\\end\{([^\}]+)\}/;

    let isBegin = false, name = null;
    let m = text.match(beginRe);
    if (m) { isBegin = true; name = m[1]; }
    else {
        m = text.match(endRe);
        if (m) { isBegin = false; name = m[1]; }
    }
    if (!m) return { changed: false, reason: "cursor_not_on_env" };

    // 在全文里扫描、用简单栈配对，定位匹配的 begin/end
    const envNameRe = /\\(begin|end)\{([^\}]+)\}/g;
    const stack = [];
    let match, partnerIndex = -1;

    while ((match = envNameRe.exec(full))) {
        const kind = match[1]; // begin / end
        const nm = match[2];
        const start = match.index;
        const end = start + match[0].length;

        if (kind === "begin") {
            stack.push({ name: nm, start, end });
        } else {
            // 找到最近一个未匹配 begin
            let idx = stack.length - 1;
            while (idx >= 0 && stack[idx].name !== nm) idx--;
            if (idx >= 0) {
                const beginTok = stack.splice(idx, 1)[0];
                const thisPair = { begin: beginTok, end: { name: nm, start, end } };
                // 判断当前光标是在 begin 还是 end 这一侧
                if (isBegin) {
                    if (line.from >= beginTok.start && line.to <= beginTok.end) {
                        partnerIndex = thisPair.end.start; // 对应 end 的起点
                        break;
                    }
                } else {
                    if (line.from >= thisPair.end.start && line.to <= thisPair.end.end) {
                        partnerIndex = beginTok.start; // 对应 begin 的起点
                        break;
                    }
                }
            }
        }
    }

    if (partnerIndex < 0) return { changed: false, reason: "partner_not_found" };

    // 检查对侧名称是否一致；不一致就修复成当前侧的名称
    envNameRe.lastIndex = partnerIndex;
    const partner = envNameRe.exec(full);
    if (!partner) return { changed: false, reason: "partner_match_fail" };

    const partnerKind = partner[1];
    const partnerName = partner[2];
    const partnerFrom = partner.index + (partnerKind === "begin" ? "\\begin{".length : "\\end{".length);
    const partnerTo = partnerFrom + partnerName.length;

    if (partnerName === name) return { changed: false, reason: "already_synced" };

    v.dispatch({
        changes: [{ from: partnerFrom, to: partnerTo, insert: name }]
    });

    return { changed: true, from: partnerName, to: name };
}

// ===== 与 messenger 的 RPC：接 isolated world 的请求
window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || msg.from !== "ofh-content") return;

    const reply = (type, id, payload, error) =>
        window.postMessage({ from: "ofh-page", type, id, payload, error }, "*");

    try {
        switch (msg.type) {
            case "OFH_REQ_FORMAT":
                reply("OFH_RES_FORMAT", msg.id, await formatSelectionOrAll());
                break;
            default:
                reply("OFH_RES_UNKNOWN", msg.id, null, "unknown type");
        }
    } catch (e) {
        reply(msg.type.replace("REQ", "RES"), msg.id, null, String(e));
    }
});
