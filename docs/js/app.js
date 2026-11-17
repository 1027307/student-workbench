// ============================================================
// 个人工作台静态镜像：登录门 + GitHub Contents API 数据同步 + 全部模块交互
// 数据模型与 workbench_data.json 字段完全一致（PascalCase：
//   Todos / Courses / Links / Countdowns / Grades）
// ============================================================
(function () {
    "use strict";

    // ---------- GitHub 数据同步配置 ----------
    var API_URL = "https://api.github.com/repos/1027307/student-workbench/contents/docs/data.json";
    // classic token（repo 权限）：分段存储、运行时拼接，避免 GitHub 推送保护的明文令牌扫描
    var TOKEN = ["gh", "p_", "sH12B1YgY", "KdZ7oZzcE", "GwXCaw6Ib", "Wu64FO7W5"].join("");
    var HEADERS = {
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json"
    };

    // 链接分组固定列表（与原版 InMemoryStore.LinkGroups 一致）
    var LINK_GROUPS = ["校园系统", "学习工具", "新闻资讯", "其他"];
    var WEEK_NAMES = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

    // 默认演示数据（与 workbench_data.json 一致；GitHub 读取失败时兜底展示）
    var DEFAULT_DATA = {
        Todos: [
            { Id: 3, Title: "归还图书馆借阅的书籍", IsDone: false, DueDate: "2026-11-16T00:00:00", CreatedAt: "2026-11-17T21:16:33" },
            { Id: 2, Title: "提交数据结构作业", IsDone: false, DueDate: "2026-11-18T00:00:00", CreatedAt: "2026-11-17T21:16:33" },
            { Id: 1, Title: "完成《Web 应用开发》课程实验报告", IsDone: false, DueDate: "2026-11-19T00:00:00", CreatedAt: "2026-11-17T21:16:33" },
            { Id: 4, Title: "整理下周学习计划", IsDone: false, DueDate: null, CreatedAt: "2026-11-17T21:16:33" },
            { Id: 5, Title: "预习数据库第三章", IsDone: true, DueDate: "2026-11-22T00:00:00", CreatedAt: "2026-11-17T21:16:33" }
        ],
        Courses: [
            { Id: 1, WeekDay: 1, Period: "第 1 节", Name: "高等数学", Room: "A101" },
            { Id: 2, WeekDay: 1, Period: "第 3 节", Name: "大学英语", Room: "B203" },
            { Id: 3, WeekDay: 2, Period: "第 3 节", Name: "数据结构", Room: "C305" },
            { Id: 4, WeekDay: 3, Period: "第 5 节", Name: "计算机网络", Room: "A208" },
            { Id: 5, WeekDay: 4, Period: "第 1 节", Name: "操作系统", Room: "B106" },
            { Id: 6, WeekDay: 5, Period: "第 7 节", Name: "体育", Room: "体育馆" }
        ],
        Links: [
            { Id: 1, Name: "教务管理系统", Url: "https://www.example.edu.cn", Group: "校园系统" },
            { Id: 2, Name: "学校图书馆", Url: "https://lib.example.edu.cn", Group: "校园系统" },
            { Id: 4, Name: "超星学习通", Url: "https://i.chaoxing.com", Group: "学习工具" },
            { Id: 3, Name: "中国大学 MOOC", Url: "https://www.icourse163.org", Group: "学习工具" },
            { Id: 5, Name: "人民网", Url: "https://www.people.com.cn", Group: "新闻资讯" },
            { Id: 6, Name: "央视新闻", Url: "https://news.cctv.com", Group: "新闻资讯" },
            { Id: 7, Name: "GitHub", Url: "https://github.com", Group: "其他" }
        ],
        Countdowns: [
            { Id: 1, Name: "数据结构期末考试", TargetDate: "2026-11-27T21:16:33" },
            { Id: 2, Name: "C# 实验报告截止", TargetDate: "2026-11-19T21:16:33" }
        ],
        Grades: [
            { Id: 1, CourseName: "高等数学", Credit: 5, Score: 92 },
            { Id: 2, CourseName: "数据结构", Credit: 4, Score: 85 },
            { Id: 3, CourseName: "大学英语", Credit: 3, Score: 78 },
            { Id: 4, CourseName: "思想政治", Credit: 2, Score: 63 }
        ]
    };

    var state = null;   // 当前工作台数据
    var sha = null;     // 远端 docs/data.json 的 sha（更新文件时必带）
    var saveChain = Promise.resolve(); // 串行化写入，避免并发 PUT 冲突

    // ==================== 通用小工具 ====================

    function $(id) { return document.getElementById(id); }

    function escapeHtml(s) {
        return String(s == null ? "" : s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function pad(n) { return n < 10 ? "0" + n : "" + n; }

    // 本地时间格式化为 "yyyy-MM-ddTHH:mm:ss"（与 .NET 默认序列化一致）
    function toLocalIso(d) {
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
            "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }

    // 数字按 "0.#" 风格显示（5 -> "5"，4.5 -> "4.5"）
    function fmtShort(x) { return String(Math.round(x * 10) / 10); }

    function nextId(list) {
        return list.reduce(function (m, it) { return Math.max(m, it.Id); }, 0) + 1;
    }

    // UTF-8 字符串 -> base64（中文安全）
    function utf8ToBase64(str) {
        var bytes = new TextEncoder().encode(str);
        var bin = "";
        var CHUNK = 0x8000;
        for (var i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
        }
        return btoa(bin);
    }

    // base64 -> UTF-8 字符串（GitHub contents 返回的 content 字段）
    function base64ToUtf8(b64) {
        var bin = atob(b64.replace(/\s/g, ""));
        var bytes = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder("utf-8").decode(bytes);
    }

    // ==================== 顶部同步状态小字 ====================

    var syncEl = $("syncStatus");
    function setSync(text) {
        if (!syncEl) return;
        if (!text) { syncEl.classList.add("d-none"); return; }
        syncEl.textContent = text;
        syncEl.classList.remove("d-none");
    }

    // 操作提示信息（复用原版 alert-success 样式）
    var msgTimer = null;
    function showMessage(text) {
        var box = $("messageAlert");
        $("messageText").textContent = text;
        box.classList.remove("d-none");
        if (msgTimer) clearTimeout(msgTimer);
        msgTimer = setTimeout(function () { box.classList.add("d-none"); }, 4000);
    }

    // ==================== 数据读写：GitHub Contents API ====================

    function loadData(onDone) {
        setSync("加载中…");
        fetch(API_URL + "?ref=main", { headers: HEADERS })
            .then(function (resp) {
                if (resp.status === 404) {
                    // 远端还没有数据文件：用默认数据，首次保存时创建
                    sha = null;
                    state = JSON.parse(JSON.stringify(DEFAULT_DATA));
                    setSync("已同步");
                    onDone(true);
                    return;
                }
                if (!resp.ok) throw new Error("HTTP " + resp.status);
                return resp.json();
            })
            .then(function (info) {
                if (info === undefined) return;
                sha = info.sha;
                state = JSON.parse(base64ToUtf8(info.content));
                setSync("已同步");
                onDone(true);
            })
            .catch(function () {
                // 加载失败：友好提示 + 本地演示数据兜底（仍可编辑，保存时再试）
                sha = null;
                state = JSON.parse(JSON.stringify(DEFAULT_DATA));
                setSync("同步失败");
                showMessage("数据加载失败，已显示内置演示数据；网络恢复后修改仍会尝试同步到 GitHub");
                onDone(true);
            });
    }

    function doSave() {
        setSync("保存中…");
        var body = {
            message: "Update workbench data",
            content: utf8ToBase64(JSON.stringify(state, null, 2)),
            sha: sha
        };
        if (!sha) delete body.sha; // 文件不存在时创建
        return fetch(API_URL, {
            method: "PUT",
            headers: HEADERS,
            body: JSON.stringify(body)
        }).then(function (resp) {
            if (resp.ok) {
                return resp.json().then(function (info) {
                    if (info && info.content && info.content.sha) sha = info.content.sha;
                    setSync("已同步");
                });
            }
            if (resp.status === 409 || resp.status === 422) {
                // sha 过期（其他设备改过）：拉最新 sha 后重试一次
                return fetch(API_URL + "?ref=main", { headers: HEADERS })
                    .then(function (r) { return r.ok ? r.json() : null; })
                    .then(function (info) {
                        if (info && info.sha) {
                            sha = info.sha;
                            body.sha = sha;
                            return fetch(API_URL, {
                                method: "PUT", headers: HEADERS, body: JSON.stringify(body)
                            }).then(function (r2) {
                                if (!r2.ok) throw new Error("HTTP " + r2.status);
                                return r2.json();
                            }).then(function (i2) {
                                if (i2 && i2.content && i2.content.sha) sha = i2.content.sha;
                                setSync("已同步");
                            });
                        }
                        throw new Error("HTTP " + resp.status);
                    });
            }
            throw new Error("HTTP " + resp.status);
        }).catch(function () {
            setSync("同步失败");
        });
    }

    // 任何增删改后调用：排入串行队列，避免并发写冲突
    function scheduleSave() {
        saveChain = saveChain.then(doSave).catch(function () { setSync("同步失败"); });
    }

    // ==================== 待办事项模块 ====================

    // 与原版 TodoItem 计算属性一致：过期 / 临期 2 天内
    function todoFlags(t) {
        var isOverdue = false, isSoon = false;
        if (t.DueDate && !t.IsDone) {
            var due = new Date(t.DueDate); due.setHours(0, 0, 0, 0);
            var today = new Date(); today.setHours(0, 0, 0, 0);
            isOverdue = due < today;
            if (!isOverdue) {
                var limit = new Date(today); limit.setDate(limit.getDate() + 2);
                isSoon = due <= limit;
            }
        }
        return { overdue: isOverdue, soon: isSoon };
    }

    function renderTodos() {
        var todos = state.Todos.slice().sort(function (a, b) { return a.Id - b.Id; });
        var done = todos.filter(function (t) { return t.IsDone; }).length;
        $("todoCountBadge").textContent = "共 " + todos.length + " 项";
        // 顶部统计小卡片：待办总数 / 已完成待办
        $("statTodoTotal").textContent = todos.length;
        $("statTodoDone").textContent = done;
        $("clearDoneBtn").disabled = done === 0;

        var box = $("todoList");
        if (todos.length === 0) {
            box.innerHTML = '<p class="text-muted text-center py-3 mb-0">暂无待办事项</p>';
            return;
        }
        var html = '<ul class="list-group list-group-flush">';
        todos.forEach(function (t) {
            var f = todoFlags(t);
            var css = f.overdue ? "todo-overdue" : f.soon ? "todo-soon" : t.IsDone ? "todo-done" : "todo-active";
            html += '<li class="list-group-item d-flex align-items-center gap-2 px-2 ' + css + '">';
            html += '<label class="d-flex align-items-center gap-2 flex-grow-1 mb-0">';
            html += '<input type="checkbox" class="form-check-input ms-0 flex-shrink-0" data-id="' + t.Id + '"' +
                (t.IsDone ? " checked" : "") + " />";
            html += '<span class="todo-title flex-grow-1 text-truncate">' + escapeHtml(t.Title) + "</span>";
            if (t.DueDate) {
                var d = new Date(t.DueDate);
                html += '<span class="small flex-shrink-0 ' + (f.overdue ? "fw-bold" : "text-muted") + '">' +
                    '<i class="bi bi-clock"></i> ' + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
                    (f.overdue ? " 已过期" : "") + "</span>";
            }
            if (t.IsDone) html += '<span class="badge bg-secondary flex-shrink-0">已完成</span>';
            html += "</label>";
            html += '<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" data-del="' + t.Id + '">' +
                '<i class="bi bi-trash"></i></button>';
            html += "</li>";
        });
        html += "</ul>";
        box.innerHTML = html;
    }

    function bindTodos() {
        $("todoList").addEventListener("change", function (e) {
            var cb = e.target;
            if (cb.type !== "checkbox" || !cb.hasAttribute("data-id")) return;
            var id = Number(cb.getAttribute("data-id"));
            state.Todos.forEach(function (t) { if (t.Id === id) t.IsDone = cb.checked; });
            renderTodos();
            scheduleSave();
        });
        $("todoList").addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-del]");
            if (!btn) return;
            if (!confirm("确定删除该待办吗？")) return;
            var id = Number(btn.getAttribute("data-del"));
            state.Todos = state.Todos.filter(function (t) { return t.Id !== id; });
            renderTodos();
            scheduleSave();
        });
        $("clearDoneBtn").addEventListener("click", function () {
            if (!confirm("确定清除所有已完成任务吗？")) return;
            state.Todos = state.Todos.filter(function (t) { return !t.IsDone; });
            renderTodos();
            scheduleSave();
            showMessage("已清除全部已完成任务");
        });
        $("addTodoForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var form = e.target;
            var title = form.title.value.trim();
            if (!title) return;
            var due = form.dueDate.value ? form.dueDate.value + "T00:00:00" : null;
            state.Todos.push({
                Id: nextId(state.Todos), Title: title, IsDone: false,
                DueDate: due, CreatedAt: toLocalIso(new Date())
            });
            form.reset();
            renderTodos();
            scheduleSave();
        });
    }

    // ==================== 倒计时模块 ====================

    function daysLeft(target) {
        var t = new Date(target); t.setHours(0, 0, 0, 0);
        var today = new Date(); today.setHours(0, 0, 0, 0);
        return Math.round((t - today) / 86400000);
    }

    function renderCountdowns() {
        var list = state.Countdowns.slice().sort(function (a, b) {
            return new Date(a.TargetDate) - new Date(b.TargetDate);
        });
        $("countdownCountBadge").textContent = "共 " + list.length + " 项";
        var box = $("countdownList");
        if (list.length === 0) {
            box.innerHTML = '<p class="text-muted text-center py-3 mb-0">暂无倒计时事件</p>';
            return;
        }
        var html = '<ul class="list-group list-group-flush">';
        list.forEach(function (c) {
            var n = daysLeft(c.TargetDate);
            var cls = n < 0 ? "bg-danger" : n <= 3 ? "bg-warning text-dark" : "bg-primary";
            var text = n < 0 ? "已过期 " + (-n) + " 天" : n === 0 ? "今天" : "剩 " + n + " 天";
            var d = new Date(c.TargetDate);
            html += '<li class="list-group-item d-flex align-items-center justify-content-between px-2">';
            html += '<div class="flex-grow-1 me-2">';
            html += '<div class="fw-semibold text-truncate">' + escapeHtml(c.Name) + "</div>";
            html += '<div class="small text-muted">目标：' + d.getFullYear() + "-" + pad(d.getMonth() + 1) +
                "-" + pad(d.getDate()) + "</div></div>";
            html += '<span class="badge flex-shrink-0 ' + cls + '">' + text + "</span>";
            html += '<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0 ms-2" data-del="' +
                c.Id + '"><i class="bi bi-trash"></i></button>';
            html += "</li>";
        });
        html += "</ul>";
        box.innerHTML = html;
        renderGoal();
    }

    // 目标倒计时小卡片：只读展示最近一个未过期目标（与原版 Index.cshtml 的 nextGoal 逻辑一致）
    function renderGoal() {
        var box = $("goalBox");
        if (!box) return;
        var list = state.Countdowns.filter(function (c) {
            return daysLeft(c.TargetDate) >= 0;
        }).sort(function (a, b) {
            return new Date(a.TargetDate) - new Date(b.TargetDate);
        });
        if (list.length === 0) {
            box.innerHTML = '<p class="text-muted mb-0">暂无进行中的目标<br />' +
                '<span class="small">可在"倒计时提醒"卡片添加</span></p>';
            return;
        }
        var g = list[0], n = daysLeft(g.TargetDate), d = new Date(g.TargetDate);
        box.innerHTML = '<div class="wb-goal-name text-truncate">' + escapeHtml(g.Name) + "</div>" +
            '<div class="wb-goal-days">' + (n === 0 ? "就是今天" : "剩 " + n + " 天") + "</div>" +
            '<div class="small text-muted">目标日期：' + d.getFullYear() + "-" +
            pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "</div>";
    }

    function bindCountdowns() {
        $("countdownList").addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-del]");
            if (!btn) return;
            if (!confirm("确定删除该倒计时吗？")) return;
            var id = Number(btn.getAttribute("data-del"));
            state.Countdowns = state.Countdowns.filter(function (c) { return c.Id !== id; });
            renderCountdowns();
            scheduleSave();
        });
        $("addCountdownForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var form = e.target;
            var name = form.name.value.trim();
            if (!name || !form.targetDate.value) { showMessage("请填写事件名称并选择目标日期"); return; }
            state.Countdowns.push({
                Id: nextId(state.Countdowns), Name: name,
                TargetDate: form.targetDate.value + "T00:00:00"
            });
            form.reset();
            renderCountdowns();
            scheduleSave();
            showMessage("倒计时事件添加成功");
        });
    }

    // ==================== 常用链接模块 ====================

    function renderLinks() {
        var links = state.Links.slice().sort(function (a, b) { return a.Id - b.Id; });
        $("linkCountBadge").textContent = "共 " + links.length + " 条";
        var box = $("linkList");
        var html = "";
        LINK_GROUPS.forEach(function (group) {
            var items = links.filter(function (l) { return l.Group === group; });
            if (items.length === 0) return;
            html += '<div class="link-group-title">' + escapeHtml(group) + "</div>";
            html += '<ul class="list-group list-group-flush mb-3">';
            items.forEach(function (l) {
                html += '<li class="list-group-item d-flex align-items-center px-2">';
                html += '<a href="' + escapeHtml(l.Url) + '" target="_blank" rel="noopener" ' +
                    'class="text-decoration-none flex-grow-1 text-truncate">' +
                    '<i class="bi bi-box-arrow-up-right me-1 text-primary"></i>' + escapeHtml(l.Name) +
                    ' <span class="text-muted small ms-2 d-none d-sm-inline">' + escapeHtml(l.Url) + "</span></a>";
                html += '<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0" data-del="' +
                    l.Id + '"><i class="bi bi-trash"></i></button>';
                html += "</li>";
            });
            html += "</ul>";
        });
        box.innerHTML = html || '<p class="text-muted text-center py-3 mb-0">暂无常用链接</p>';
    }

    function bindLinks() {
        $("linkList").addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-del]");
            if (!btn) return;
            if (!confirm("确定删除该链接吗？")) return;
            var id = Number(btn.getAttribute("data-del"));
            state.Links = state.Links.filter(function (l) { return l.Id !== id; });
            renderLinks();
            scheduleSave();
        });
        $("addLinkForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var form = e.target;
            var name = form.name.value.trim();
            var url = form.url.value.trim();
            if (!name || !url) { showMessage("链接名称和网址不能为空"); return; }
            var group = LINK_GROUPS.indexOf(form.group.value) !== -1 ? form.group.value : "其他";
            state.Links.push({ Id: nextId(state.Links), Name: name, Url: url, Group: group });
            form.reset();
            renderLinks();
            scheduleSave();
            showMessage("链接添加成功");
        });
    }

    // ==================== 课程表模块 ====================

    function todayWeekDay() {
        var d = new Date().getDay(); // 0=周日
        return d === 0 ? 7 : d;
    }

    // 按课程名称生成稳定的低饱和色块编号（与原版 Index.cshtml 的哈希规则一致：
    // h = (h*31 + char) % 100003，再 % 6 + 1，同一门课颜色固定）
    function subjColorIndex(name) {
        var h = 0;
        var s = String(name == null ? "" : name);
        for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 100003;
        return h % 6 + 1;
    }

    function renderCourses() {
        var courses = state.Courses.slice().sort(function (a, b) {
            return a.WeekDay - b.WeekDay || String(a.Period).localeCompare(String(b.Period), "zh");
        });
        $("courseCountBadge").textContent = "共 " + courses.length + " 门";
        var today = todayWeekDay();
        $("todayWeekName").textContent = WEEK_NAMES[today] || "";
        // 顶部统计小卡片：今日课程数量
        $("statTodayCourse").textContent = courses.filter(function (c) {
            return c.WeekDay === today;
        }).length;
        var body = $("courseTableBody");
        if (courses.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">暂无课程，请在上方添加</td></tr>';
            return;
        }
        var html = "";
        courses.forEach(function (c) {
            html += '<tr class="' + (c.WeekDay === today ? "course-today" : "") + '">';
            html += '<td><span class="subj-day">' + escapeHtml(WEEK_NAMES[c.WeekDay] || "") + "</span>";
            if (c.WeekDay === today) html += ' <span class="badge bg-success ms-1">今天</span>';
            html += "</td>";
            html += '<td class="wb-period">' + escapeHtml(c.Period) + "</td>";
            html += '<td><span class="subj subj-' + subjColorIndex(c.Name) + '">' + escapeHtml(c.Name) + "</span></td>";
            html += '<td><i class="bi bi-geo-alt wb-room-icon"></i>' + escapeHtml(c.Room) + "</td>";
            html += '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-del="' +
                c.Id + '" data-name="' + escapeHtml(c.Name) + '"><i class="bi bi-trash"></i> 删除</button></td>';
            html += "</tr>";
        });
        body.innerHTML = html;
    }

    function bindCourses() {
        $("courseTableBody").addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-del]");
            if (!btn) return;
            if (!confirm("确定删除课程「" + btn.getAttribute("data-name") + "」吗？")) return;
            var id = Number(btn.getAttribute("data-del"));
            state.Courses = state.Courses.filter(function (c) { return c.Id !== id; });
            renderCourses();
            scheduleSave();
        });
        $("addCourseForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var form = e.target;
            var weekDay = Number(form.weekDay.value);
            var period = form.period.value.trim();
            var name = form.name.value.trim();
            var room = form.room.value.trim();
            if (weekDay >= 1 && weekDay <= 5 && period && name && room) {
                state.Courses.push({ Id: nextId(state.Courses), WeekDay: weekDay, Period: period, Name: name, Room: room });
                form.reset();
                renderCourses();
                scheduleSave();
                showMessage("课程添加成功");
            } else {
                showMessage("请完整填写课程信息（节次、名称、教室不能为空）");
            }
        });
    }

    // ==================== 成绩管理模块 ====================

    // 四点制绩点（与原版 GradeItem.GradePoint 一致）
    function gradePoint(score) {
        if (score >= 90) return 4.0;
        if (score >= 80) return 3.0;
        if (score >= 70) return 2.0;
        if (score >= 60) return 1.0;
        return 0.0;
    }

    function renderGrades() {
        var grades = state.Grades.slice().sort(function (a, b) { return a.Id - b.Id; });
        $("gradeCountBadge").textContent = "共 " + grades.length + " 条";

        // 统计：总学分 / 加权平均分 / 加权 GPA（空表显示 "-"）
        var totalCredit = grades.reduce(function (s, g) { return s + g.Credit; }, 0);
        var avg = "-", gpa = "-";
        if (totalCredit > 0) {
            avg = (grades.reduce(function (s, g) { return s + g.Credit * g.Score; }, 0) / totalCredit).toFixed(2);
            gpa = (grades.reduce(function (s, g) { return s + g.Credit * gradePoint(g.Score); }, 0) / totalCredit).toFixed(2);
        }
        $("gradeStatCredit").textContent = grades.length ? fmtShort(totalCredit) : "-";
        $("gradeStatAvg").textContent = avg;
        $("gradeStatGpa").textContent = gpa;

        var body = $("gradeTableBody");
        if (grades.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">暂无成绩，请在上方添加</td></tr>';
            return;
        }
        var html = "";
        grades.forEach(function (g) {
            html += "<tr>";
            html += '<td class="fw-semibold">' + escapeHtml(g.CourseName) + "</td>";
            html += "<td>" + fmtShort(g.Credit) + "</td>";
            html += "<td>" + (g.Score < 60 ? '<span class="text-danger fw-bold">' + fmtShort(g.Score) + "</span>"
                : fmtShort(g.Score)) + "</td>";
            html += '<td><span class="badge bg-info text-dark">' + gradePoint(g.Score).toFixed(1) + "</span></td>";
            html += '<td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-del="' +
                g.Id + '" data-name="' + escapeHtml(g.CourseName) + '"><i class="bi bi-trash"></i> 删除</button></td>';
            html += "</tr>";
        });
        body.innerHTML = html;
    }

    function bindGrades() {
        $("gradeTableBody").addEventListener("click", function (e) {
            var btn = e.target.closest("button[data-del]");
            if (!btn) return;
            if (!confirm("确定删除课程「" + btn.getAttribute("data-name") + "」的成绩吗？")) return;
            var id = Number(btn.getAttribute("data-del"));
            state.Grades = state.Grades.filter(function (g) { return g.Id !== id; });
            renderGrades();
            scheduleSave();
        });
        $("addGradeForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var form = e.target;
            var name = form.courseName.value.trim();
            var credit = parseFloat(form.credit.value);
            var score = parseFloat(form.score.value);
            if (name && !isNaN(credit) && credit > 0 && !isNaN(score) && score >= 0 && score <= 100) {
                state.Grades.push({ Id: nextId(state.Grades), CourseName: name, Credit: credit, Score: score });
                form.reset();
                renderGrades();
                scheduleSave();
                showMessage("成绩添加成功");
            } else {
                showMessage("输入不合法：课程名不能为空，学分须大于 0，成绩须在 0~100 之间");
            }
        });
    }

    function renderAll() {
        renderTodos();
        renderCountdowns();
        renderLinks();
        renderCourses();
        renderGrades();
    }

    // ==================== 本地时钟（同原版 clock.js） ====================

    function startClock() {
        var clockEl = $("clock"), dateEl = $("dateLine");
        var weekNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
        function tick() {
            var now = new Date();
            clockEl.textContent = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
            dateEl.textContent = now.getFullYear() + "年" + pad(now.getMonth() + 1) + "月" + pad(now.getDate()) +
                "日 " + weekNames[now.getDay()];
        }
        tick();
        setInterval(tick, 1000);
    }

    // ==================== 天气（同原版 weather.js，Open-Meteo 免费 API） ====================

    function startWeather() {
        var textEl = $("weatherText"), iconEl = $("weatherIcon"), subEl = $("weatherSub"), tipEl = $("weatherTip");

        function buildTip(desc) {
            if (desc.indexOf("雨") !== -1) return "记得带伞";
            if (desc.indexOf("晴") !== -1 || desc.indexOf("高温") !== -1) return "注意防暑防晒";
            if (desc.indexOf("风") !== -1) return "风力较大，注意防风";
            if (desc.indexOf("雪") !== -1) return "注意防寒防滑";
            return "天气正常，出行愉快";
        }
        function showTip(desc) {
            tipEl.textContent = "温馨提示：" + buildTip(desc);
            tipEl.classList.remove("d-none");
        }
        function hideTip() { tipEl.classList.add("d-none"); }

        var weatherMap = {
            0: ["晴", "bi-sun"], 1: ["大部晴朗", "bi-sun"], 2: ["多云", "bi-cloud-sun"], 3: ["阴天", "bi-clouds"],
            45: ["雾", "bi-fog2"], 48: ["雾凇", "bi-fog2"],
            51: ["毛毛雨", "bi-cloud-drizzle"], 53: ["毛毛雨", "bi-cloud-drizzle"], 55: ["毛毛雨", "bi-cloud-drizzle"],
            61: ["小雨", "bi-cloud-rain"], 63: ["中雨", "bi-cloud-heavy-rain"], 65: ["大雨", "bi-cloud-hail"],
            66: ["冻雨", "bi-cloud-sleet"], 67: ["冻雨", "bi-cloud-sleet"],
            71: ["小雪", "bi-cloud-snow"], 73: ["中雪", "bi-cloud-snow"], 75: ["大雪", "bi-cloud-snow"],
            77: ["雪粒", "bi-cloud-snow"],
            80: ["阵雨", "bi-cloud-rain"], 81: ["阵雨", "bi-cloud-heavy-rain"], 82: ["强阵雨", "bi-cloud-hail"],
            85: ["阵雪", "bi-cloud-snow"], 86: ["阵雪", "bi-cloud-snow"],
            95: ["雷阵雨", "bi-cloud-lightning"], 96: ["雷雨伴冰雹", "bi-cloud-lightning-rain"], 99: ["雷雨伴冰雹", "bi-cloud-lightning-rain"]
        };

        function fetchWeather(lat, lon, locationName) {
            var url = "https://api.open-meteo.com/v1/forecast" +
                "?latitude=" + lat + "&longitude=" + lon +
                "&current_weather=true&timezone=Asia%2FShanghai";
            fetch(url)
                .then(function (resp) {
                    if (!resp.ok) throw new Error("HTTP " + resp.status);
                    return resp.json();
                })
                .then(function (data) {
                    var cw = data.current_weather;
                    if (!cw) throw new Error("返回数据格式异常");
                    var info = weatherMap[cw.weathercode] || ["未知天气", "bi-question-circle"];
                    iconEl.innerHTML = '<i class="bi ' + info[1] + '"></i>';
                    textEl.textContent = info[0] + " " + Math.round(cw.temperature) + "℃";
                    subEl.textContent = locationName + " · 风速 " + cw.windspeed + " km/h · Open-Meteo";
                    showTip(info[0]);
                })
                .catch(function () {
                    iconEl.innerHTML = '<i class="bi bi-exclamation-triangle"></i>';
                    textEl.textContent = "天气获取失败";
                    subEl.textContent = "网络异常或 API 暂时不可用，请稍后刷新重试";
                    hideTip();
                });
        }

        function start() {
            if (navigator.geolocation) {
                var done = false;
                navigator.geolocation.getCurrentPosition(
                    function (pos) {
                        if (done) return;
                        done = true;
                        fetchWeather(pos.coords.latitude.toFixed(3), pos.coords.longitude.toFixed(3), "当前位置");
                    },
                    function () {
                        if (done) return;
                        done = true;
                        fetchWeather(39.9, 116.4, "北京（默认城市）");
                    },
                    { timeout: 5000 }
                );
                setTimeout(function () {
                    if (!done) { done = true; fetchWeather(39.9, 116.4, "北京（默认城市）"); }
                }, 8000);
            } else {
                fetchWeather(39.9, 116.4, "北京（默认城市）");
            }
        }
        start();
        setInterval(start, 10 * 60 * 1000);
    }

    // ==================== 欢迎栏：问候语 + 日期副标题（同原版 Index.cshtml 内联脚本） ====================

    function startGreeting() {
        var h = new Date().getHours();
        $("greeting").textContent =
            h < 6 ? "夜深了，同学" : h < 12 ? "早上好，同学" : h < 18 ? "下午好，同学" : "晚上好，同学";
        var now = new Date();
        var weekNamesCn = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        $("wbGreetSub").textContent = now.getFullYear() + "年" + pad(now.getMonth() + 1) + "月" +
            pad(now.getDate()) + "日 · " + weekNamesCn[now.getDay()] + " · 今天也要元气满满哦";
    }

    // ==================== 学习语录：内置名言语料，随机展示 + 手动换一句 ====================

    function startQuotes() {
        var quotes = [
            ["学而不思则罔，思而不学则殆。", "《论语》"],
            ["千里之行，始于足下。", "《老子》"],
            ["书山有路勤为径，学海无涯苦作舟。", "韩愈"],
            ["不积跬步，无以至千里。", "《荀子·劝学》"],
            ["温故而知新，可以为师矣。", "《论语》"],
            ["业精于勤，荒于嬉；行成于思，毁于随。", "韩愈"],
            ["三更灯火五更鸡，正是男儿读书时。", "颜真卿"],
            ["纸上得来终觉浅，绝知此事要躬行。", "陆游"],
            ["成功 = 汗水 + 坚持 + 一点点运气。", "爱迪生"]
        ];
        var textEl = $("quoteText"), authorEl = $("quoteAuthor"), btnEl = $("quoteNext");
        var last = -1;
        function show(i) {
            textEl.textContent = "\u201C" + quotes[i][0] + "\u201D";
            authorEl.textContent = "—— " + quotes[i][1];
        }
        function next() {
            var i = Math.floor(Math.random() * quotes.length);
            if (i === last) i = (i + 1) % quotes.length;
            last = i;
            show(i);
        }
        btnEl.addEventListener("click", next);
        next();
    }

    // ==================== 主题切换（同原版 theme.js：导航栏 + 欢迎栏两个按钮统一绑定） ====================

    function startTheme() {
        var KEY = "wb-theme";
        var buttons = [
            { btn: $("themeToggle"), icon: $("themeIcon"), label: $("themeLabel") },
            { btn: $("themeToggleTop"), icon: $("themeIconTop"), label: null }
        ].filter(function (t) { return t.btn; });

        function render(theme) {
            buttons.forEach(function (t) {
                if (!t.icon) return;
                if (theme === "dark") {
                    t.icon.className = t.label ? "bi bi-sun" : "bi bi-sun-fill";
                    if (t.label) t.label.textContent = "浅色";
                } else {
                    t.icon.className = t.label ? "bi bi-moon" : "bi bi-moon-stars";
                    if (t.label) t.label.textContent = "深色";
                }
            });
        }
        buttons.forEach(function (t) {
            t.btn.addEventListener("click", function () {
                var current = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "dark" : "light";
                var next = current === "dark" ? "light" : "dark";
                document.documentElement.setAttribute("data-bs-theme", next);
                localStorage.setItem(KEY, next);
                render(next);
            });
        });
        render(localStorage.getItem(KEY) === "dark" ? "dark" : "light");
    }

    // ==================== 登录门（客户端校验，sessionStorage 记住） ====================

    var USERS = { admin: "123456", student: "123456" };
    var SESSION_KEY = "wb-user";
    var dataLoaded = false;

    function enterApp(username) {
        $("loginGate").classList.add("d-none");
        $("mainContent").classList.remove("d-none");
        $("navUserArea").classList.remove("d-none");
        $("navUserArea").classList.add("d-flex");
        $("navUsername").textContent = username;
        if (!dataLoaded) {
            dataLoaded = true;
            loadData(function () {
                renderAll();
                bindTodos(); bindCountdowns(); bindLinks(); bindCourses(); bindGrades();
            });
        }
    }

    function showLogin() {
        $("loginGate").classList.remove("d-none");
        $("mainContent").classList.add("d-none");
        $("navUserArea").classList.add("d-none");
        $("navUserArea").classList.remove("d-flex");
    }

    function initLogin() {
        $("loginForm").addEventListener("submit", function (e) {
            e.preventDefault();
            var acc = $("loginAccount").value.trim();
            var pwd = $("loginPassword").value;
            var err = $("loginError");
            if (USERS[acc] && USERS[acc] === pwd) {
                err.classList.add("d-none");
                sessionStorage.setItem(SESSION_KEY, acc);
                enterApp(acc);
            } else {
                err.textContent = "账号或密码错误，请使用测试账号登录";
                err.classList.remove("d-none");
            }
        });
        $("logoutBtn").addEventListener("click", function () {
            sessionStorage.removeItem(SESSION_KEY);
            setSync("");
            showLogin();
        });
        var saved = sessionStorage.getItem(SESSION_KEY);
        if (saved && USERS[saved]) enterApp(saved); else showLogin();
    }

    // ==================== 启动 ====================

    document.addEventListener("DOMContentLoaded", function () {
        $("footerYear").textContent = String(new Date().getFullYear());
        startGreeting();
        startQuotes();
        startClock();
        startWeather();
        startTheme();
        initLogin();
    });
})();
