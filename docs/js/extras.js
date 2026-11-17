// ============================================================
// 新增小卡片模块（全部纯前端，不依赖后端）：
//   1. 番茄钟        —— 25 分钟专注 / 5 分钟休息，本地计时
//   2. 实时热榜      —— 公开 API 多源容错，加载失败仅影响本卡片
//   3. 随机古诗词    —— hitokoto 诗词接口 + 内置兜底语料
//   4. 每日英文短句  —— zenquotes 今日一句 + localStorage 当日缓存 + 内置兜底
// 每个模块独立 try/catch 初始化，任何一个失败都不会影响其它卡片和工作台。
// ============================================================
(function () {
    "use strict";

    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    // 带超时控制的 fetch（默认 8 秒），失败/超时统一抛出异常交由调用方容错
    function fetchJson(url, timeoutMs) {
        var ctrl = ("AbortController" in window) ? new AbortController() : null;
        var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, timeoutMs || 8000);
        return fetch(url, ctrl ? { signal: ctrl.signal } : {})
            .then(function (r) {
                if (!r.ok) throw new Error("HTTP " + r.status);
                return r.json();
            })
            .finally(function () { clearTimeout(timer); });
    }

    // ==================== 1. 番茄钟 ====================
    (function pomodoro() {
        var timeEl = $("pomoTime"), modeEl = $("pomoMode"), fillEl = $("pomoFill"),
            startBtn = $("pomoStart"), resetBtn = $("pomoReset"), hintEl = $("pomoHint");
        if (!timeEl || !startBtn) return;

        var FOCUS = 25 * 60, BREAK = 5 * 60;
        var mode = "focus";          // focus=专注 / break=休息
        var total = FOCUS;           // 当前阶段总秒数
        var left = FOCUS;            // 剩余秒数
        var running = false;
        var timer = null;

        function paint() {
            timeEl.textContent = pad(Math.floor(left / 60)) + ":" + pad(left % 60);
            fillEl.style.width = (total ? ((total - left) / total * 100) : 0) + "%";
            modeEl.textContent = mode === "focus" ? "专注模式" : "休息模式";
            modeEl.classList.toggle("is-break", mode === "break");
            startBtn.innerHTML = running
                ? '<i class="bi bi-pause-fill me-1"></i>暂停'
                : '<i class="bi bi-play-fill me-1"></i>开始';
        }

        function switchMode(next) {
            mode = next;
            total = next === "focus" ? FOCUS : BREAK;
            left = total;
            hintEl.textContent = next === "focus"
                ? "专注 25 分钟 · 休息 5 分钟" : "休息一下，看看远处放松眼睛";
        }

        function tick() {
            left--;
            if (left <= 0) {
                // 阶段结束：自动切换到下一阶段并暂停，等待用户点开始
                running = false;
                clearInterval(timer); timer = null;
                if (mode === "focus") { switchMode("break"); hintEl.textContent = "专注完成！该休息一下了"; }
                else { switchMode("focus"); hintEl.textContent = "休息结束，开始新的专注吧"; }
                paint();
                return;
            }
            paint();
        }

        startBtn.addEventListener("click", function () {
            running = !running;
            if (running) { timer = setInterval(tick, 1000); }
            else if (timer) { clearInterval(timer); timer = null; }
            paint();
        });
        resetBtn.addEventListener("click", function () {
            running = false;
            if (timer) { clearInterval(timer); timer = null; }
            switchMode(mode);
            paint();
        });
        paint();
    })();

    // ==================== 2. 实时热榜 ====================
    (function hotList() {
        var box = $("hotList"), retryWrap = $("hotRetry"), retryBtn = $("hotRetryBtn"),
            sourceEl = $("hotSource");
        if (!box) return;

        // 多个公开数据源，按顺序尝试；任一源成功即渲染，全部失败显示重试
        var SOURCES = [
            {
                name: "微博热搜 · 60s API",
                url: "https://60s.viki.moe/v2/weibo",
                pick: function (j) {
                    var arr = (j && j.data && (j.data.list || j.data)) || [];
                    return Array.isArray(arr) ? arr : [];
                },
                title: function (it) { return it.word || it.title || it.name || ""; },
                heat: function (it) { return it.hot_value || it.hot || ""; },
                link: function (it) { return "https://s.weibo.com/weibo?q=" + encodeURIComponent(it.word || ""); }
            },
            {
                name: "微博热搜 · vvhan",
                url: "https://api.vvhan.com/api/hotlist/weibo",
                pick: function (j) { return (j && j.data) || []; },
                title: function (it) { return it.name || it.title || ""; },
                heat: function (it) { return it.hot || ""; },
                link: function (it) { return it.url || "https://s.weibo.com/weibo?q=" + encodeURIComponent(it.name || ""); }
            }
        ];
        var srcIdx = 0;

        function showError(msg) {
            box.innerHTML = '<div class="wb-hot-error"><i class="bi bi-exclamation-circle me-1"></i>' +
                escapeHtml(msg) + "</div>";
            if (retryWrap) retryWrap.classList.remove("d-none");
        }

        function render(items, src) {
            var html = '<ul class="list-unstyled mb-0">';
            items.slice(0, 10).forEach(function (it, i) {
                var t = String(src.title(it) || "").trim();
                if (!t) return;
                var heat = String(src.heat(it) || "");
                if (heat && /^\d+$/.test(heat)) {
                    var n = Number(heat);
                    heat = n >= 10000 ? (Math.round(n / 1000) / 10) + "万" : String(n);
                }
                html += '<li class="wb-hot-item">';
                html += '<span class="wb-hot-rank' + (i < 3 ? " top" + (i + 1) : "") + '">' + (i + 1) + "</span>";
                html += '<a class="wb-hot-title" href="' + escapeHtml(src.link(it)) +
                    '" target="_blank" rel="noopener" title="' + escapeHtml(t) + '">' + escapeHtml(t) + "</a>";
                if (heat) html += '<span class="wb-hot-heat">' + escapeHtml(heat) + "</span>";
                html += "</li>";
            });
            html += "</ul>";
            box.innerHTML = html;
            if (retryWrap) retryWrap.classList.add("d-none");
            if (sourceEl) sourceEl.textContent = src.name;
        }

        function load() {
            if (!SOURCES.length) return;
            box.innerHTML = '<p class="text-muted text-center py-3 mb-0">热榜加载中…</p>';
            var src = SOURCES[srcIdx % SOURCES.length];
            fetchJson(src.url, 8000)
                .then(function (j) {
                    var arr = src.pick(j) || [];
                    if (!Array.isArray(arr) || arr.length === 0) throw new Error("empty");
                    render(arr, src);
                })
                .catch(function () {
                    // 换下一个数据源再试一次；仍失败则提示重试
                    srcIdx++;
                    if (srcIdx < SOURCES.length * 2) { load(); }
                    else { showError("热榜暂时无法获取，请稍后重试"); }
                });
        }

        if (retryBtn) retryBtn.addEventListener("click", function () { srcIdx = 0; load(); });
        load();
    })();

    // ==================== 3. 随机古诗词 ====================

    (function poem() {
        var textEl = $("poemText"), fromEl = $("poemFrom"), btnEl = $("poemNext");
        if (!textEl) return;

        // 内置兜底语料（接口不可用时随机展示）
        var FALLBACK = [
            ["腹有诗书气自华。", "《和董传留别》· 苏轼"],
            ["长风破浪会有时，直挂云帆济沧海。", "《行路难》· 李白"],
            ["会当凌绝顶，一览众山小。", "《望岳》· 杜甫"],
            ["山重水复疑无路，柳暗花明又一村。", "《游山西村》· 陆游"],
            ["落霞与孤鹜齐飞，秋水共长天一色。", "《滕王阁序》· 王勃"],
            ["千磨万击还坚劲，任尔东西南北风。", "《竹石》· 郑燮"],
            ["欲穷千里目，更上一层楼。", "《登鹳雀楼》· 王之涣"],
            ["少壮不努力，老大徒伤悲。", "《长歌行》· 汉乐府"]
        ];
        var busy = false;

        function showFallback() {
            var i = Math.floor(Math.random() * FALLBACK.length);
            textEl.textContent = "“" + FALLBACK[i][0] + "”";
            fromEl.textContent = "—— " + FALLBACK[i][1];
        }

        function load() {
            if (busy) return;
            busy = true;
            if (btnEl) btnEl.disabled = true;
            fetchJson("https://v1.hitokoto.cn/?c=i&encode=json", 8000)
                .then(function (j) {
                    if (!j || !j.hitokoto) throw new Error("empty");
                    textEl.textContent = "“" + j.hitokoto + "”";
                    var from = j.from ? "《" + j.from + "》" : "";
                    var who = j.from_who ? " · " + j.from_who : "";
                    fromEl.textContent = "—— " + (from || who ? from + who : "佚名");
                })
                .catch(showFallback)
                .finally(function () {
                    busy = false;
                    if (btnEl) btnEl.disabled = false;
                });
        }

        if (btnEl) btnEl.addEventListener("click", load);
        load();
    })();

    // ==================== 4. 每日英文短句 ====================

    (function english() {
        var textEl = $("enText"), authorEl = $("enAuthor");
        if (!textEl) return;

        // 内置兜底：按"当年第几天"固定选一句，保证同一天内容稳定
        var FALLBACK = [
            ["The best time to plant a tree was 20 years ago. The second best time is now.", "Chinese Proverb"],
            ["Education is the most powerful weapon which you can use to change the world.", "Nelson Mandela"],
            ["The only way to do great work is to love what you do.", "Steve Jobs"],
            ["Believe you can and you're halfway there.", "Theodore Roosevelt"],
            ["It does not matter how slowly you go as long as you do not stop moving.", "Confucius"],
            ["Live as if you were to die tomorrow. Learn as if you were to live forever.", "Mahatma Gandhi"],
            ["The beautiful thing about learning is that no one can take it away from you.", "B.B. King"]
        ];
        function dayOfYear() {
            var now = new Date();
            var start = new Date(now.getFullYear(), 0, 0);
            return Math.floor((now - start) / 86400000);
        }
        function showFallback() {
            var i = dayOfYear() % FALLBACK.length;
            textEl.textContent = "“" + FALLBACK[i][0] + "”";
            authorEl.textContent = "—— " + FALLBACK[i][1];
        }

        // 今日一句：优先用当天缓存，其次请求 zenquotes，失败用内置兜底
        var key = "wb-en-" + new Date().toISOString().slice(0, 10);
        try {
            var cached = localStorage.getItem(key);
            if (cached) {
                var c = JSON.parse(cached);
                textEl.textContent = "“" + c.q + "”";
                authorEl.textContent = "—— " + c.a;
                return;
            }
        } catch (e) { /* localStorage 不可用则直接走接口 */ }

        fetchJson("https://zenquotes.io/api/today", 8000)
            .then(function (j) {
                var it = Array.isArray(j) ? j[0] : null;
                if (!it || !it.q) throw new Error("empty");
                textEl.textContent = "“" + it.q + "”";
                authorEl.textContent = "—— " + (it.a || "");
                try { localStorage.setItem(key, JSON.stringify({ q: it.q, a: it.a })); } catch (e) {}
            })
            .catch(showFallback);
    })();
})();
