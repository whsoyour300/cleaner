/* 엑셀 정리기 — 화면.
 *
 * 파일 → 읽기(SheetJS, 브라우저 안) → 진단(clean.js) → 규칙(rules/*.json) → 정리 → 기록·내려받기
 * 서버로 아무것도 보내지 않는다. fetch 는 예시 파일과 규칙 파일을 «내 사이트에서» 읽을 때만 쓴다.
 */
(function () {
  "use strict";
  const $ = s => document.querySelector(s);
  const S = { name: "", rows: [], rules: null, result: null };
  const esc = v => String(v === undefined || v === null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // ── 읽기 ────────────────────────────────────────────
  function readWorkbook(buf, name) {
    const isCsv = /\.csv$/i.test(name);
    const wb = isCsv
      ? XLSX.read(new TextDecoder("utf-8").decode(buf).replace(/^﻿/, ""), { type: "string", raw: true })
      : XLSX.read(buf, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];

    // 병합 셀 — 엑셀은 병합 범위의 맨 왼쪽 위 칸에만 값을 둔다. 범위의 모든 칸에 같은 값을 채운다
    // (영업실적 A열 «요금팀» 이 소계 앞 줄까지 병합 → 한 줄씩 모두 «요금팀»)
    const merges = ws["!merges"] || [];
    const filled = [];
    merges.forEach(m => {
      const src = ws[XLSX.utils.encode_cell(m.s)];
      if (!src) return;
      for (let r = m.s.r; r <= m.e.r; r++) for (let c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue;
        ws[XLSX.utils.encode_cell({ r, c })] = { t: src.t, v: src.v, w: src.w };
      }
      filled.push(m);
    });

    // 제목 줄 — 첫 줄이 가로로 병합된 제목(«집행 결과»)이면 그 아래 칸들의 윗단계로 본다.
    // 진짜 칸 이름은 그다음 줄. groups = { 노출: "집행 결과", 클릭: "집행 결과", … }
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: !isCsv });
    const groups = {};
    let headerRow = 0;
    const band = merges.filter(m => m.s.r === 0 && m.e.r === 0 && m.e.c > m.s.c);
    if (band.length && grid.length > 1) {
      headerRow = 1;
      band.forEach(m => {
        const title = String(grid[0][m.s.c]).trim();
        for (let c = m.s.c; c <= m.e.c; c++) if (grid[1][c] !== "" && grid[1][c] !== undefined) groups[String(grid[1][c]).trim()] = title;
      });
    }
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: !isCsv, range: headerRow });
    return { rows, sheets: wb.SheetNames, groups, merged: filled.length, headerRow };
  }

  async function loadFile(buf, name) {
    const { rows, sheets, groups, merged, headerRow } = readWorkbook(buf, name);
    S.name = name; S.rows = rows; S.groups = groups;
    const gTitles = [...new Set(Object.values(groups))];
    $("#file-info").hidden = false;
    $("#file-info").textContent = `${name} · ${rows.length}행 · 열 ${rows.length ? Object.keys(rows[0]).length : 0}개`
      + (sheets.length > 1 ? ` · ⚠ 시트 ${sheets.length}개 중 첫 시트만 읽었습니다` : "")
      + (merged ? ` · 병합 ${merged}곳을 풀어 한 줄씩 같은 값으로 채웠습니다` : "")
      + (headerRow ? ` · 첫 줄은 제목 «${gTitles.join(", ")}» — 칸 이름은 ${headerRow + 1}번째 줄` : "");
    preview(rows);
    diagnose(rows);
    await loadRulesFor(name);
    $("#sec-result").hidden = true;
  }

  function preview(rows) {
    const cols = rows.length ? Object.keys(rows[0]) : [];
    $("#preview").hidden = false;
    // 윗단계 제목(집행 결과)이 있으면 그 아래 칸들을 한 칸으로 묶어 윗줄에 보여 준다
    let top = "";
    if (S.groups && Object.keys(S.groups).length) {
      const cells = [];
      cols.forEach(c => {
        const g = S.groups[c] || "";
        if (cells.length && cells[cells.length - 1].g === g && g) cells[cells.length - 1].n++;
        else cells.push({ g, n: 1 });
      });
      top = `<tr>${cells.map(x => `<th colspan="${x.n}" style="text-align:center">${esc(x.g)}</th>`).join("")}</tr>`;
    }
    $("#preview").innerHTML = `<table><thead>${top}<tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`
      + rows.slice(0, 8).map(r => `<tr>${cols.map(c => `<td>${esc(r[c])}</td>`).join("")}</tr>`).join("")
      + `</tbody></table>`;
  }

  // ── 진단 ────────────────────────────────────────────
  function diagnose(rows) {
    const d = Clean.diagnose(rows);
    $("#sec-diag").hidden = false;
    $("#symptoms").innerHTML = d.symptoms.length
      ? d.symptoms.map(s => `<div class="sym"><span class="kind ${s.kind}">${s.kind}</span><span>${esc(s.text)}</span></div>`).join("")
      : `<p class="muted">규칙 없이 찾을 수 있는 증상은 없습니다. 그래도 값 목록은 눈으로 보십시오.</p>`;
    const cats = Object.entries(d.columns).filter(([, i]) => i.values);
    $("#values").innerHTML = cats.map(([c, i]) =>
      `<p><b>${esc(c)}</b> — ${Object.entries(i.values).sort((a, b) => b[1] - a[1])
        .map(([v, n]) => `«${esc(v)}» ${n}`).join(" · ")}</p>`).join("") || `<p class="muted">종류가 적은 글자 열이 없습니다.</p>`;
  }

  // ── 규칙 ────────────────────────────────────────────
  async function loadRulesFor(name) {
    const base = name.replace(/\.(xlsx|xls|csv)$/i, "");
    try {
      const r = await fetch(`rules/${encodeURIComponent(base)}.json`);
      S.rules = r.ok ? await r.json() : null;
    } catch (e) { S.rules = null; }
    showRules();
  }

  function showRules() {
    $("#sec-rules").hidden = false;
    const R = S.rules;
    if (!R) {
      $("#rules-owner").hidden = false;
      $("#rules-owner").textContent = "이 파일에 맞는 규칙이 없습니다. 규칙 파일을 불러오십시오 — 규칙은 사람이 정합니다.";
      $("#rules").innerHTML = ""; $("#rules-order").textContent = "";
      $("#btn-apply").disabled = true;
      return;
    }
    $("#btn-apply").disabled = false;
    $("#rules-owner").hidden = false;
    $("#rules-owner").textContent = `${R.title} — ${R.owner}`;
    const parts = Object.entries(R.columns || {}).map(([c, r]) => `<div class="rule"><div class="c">${esc(c)}</div><div class="w">${esc(r.why || "")}</div></div>`);
    (R.cross_checks || []).forEach(cc => parts.push(`<div class="rule"><div class="c">두 열을 같이 — ${esc(cc.label)}</div><div class="w">${esc(cc.why || "")}</div></div>`));
    if (R.duplicates) parts.push(`<div class="rule"><div class="c">중복</div><div class="w">${esc(R.duplicates.why || "")}</div></div>`);
    $("#rules").innerHTML = parts.join("");
    $("#rules-order").textContent = R.order_note ? "순서 — " + R.order_note : "";
  }

  // ── 적용 ────────────────────────────────────────────
  function applyRules() {
    const r1 = Clean.apply(S.rows, S.rules);
    const r2 = Clean.apply(r1.rows, S.rules);        // 한 번 더 — 두 번 돌려도 같은가
    S.result = r1;
    const s = r1.summary;
    $("#sec-result").hidden = false;
    $("#stats").innerHTML = [
      ["행", `${s.before} → ${s.after}`],
      ["지운 행 (완전 중복)", s.dropped],
      ["고친 값", s.changes],
      ["표시한 행 (지우지 않음)", s.flagged],
      ["그중 분석에서 제외할 행", s.excluded],
      ["따로 둔 합계 줄", s.summaryRows],
    ].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");
    const ok = Clean.same(r1.rows, r2.rows) && r2.summary.changes === 0 && r2.summary.dropped === 0;
    $("#idem").innerHTML = ok
      ? `<b class="pass">✓ 두 번 돌려도 같은 결과</b> — 정리본에 규칙을 한 번 더 적용해도 바뀌는 것이 없습니다`
      : `<b class="fail">✕ 두 번 돌리면 결과가 달라집니다</b> — 규칙이 자기 결과를 또 바꿉니다. 규칙을 다시 보십시오`;
    const shown = r1.log.slice(0, 12);
    $("#log").innerHTML = `<table><thead><tr><th>행</th><th>열</th><th>전</th><th>후</th><th>규칙</th></tr></thead><tbody>`
      + shown.map(l => `<tr><td>${l.row}</td><td>${esc(l.col)}</td><td>${esc(l.from)}</td><td>${esc(l.to)}</td><td>${esc(l.rule).slice(0, 30)}…</td></tr>`).join("")
      + (r1.log.length > 12 ? `<tr><td colspan="5">… 외 ${r1.log.length - 12}줄 — «변경 기록 내려받기»</td></tr>` : "")
      + `</tbody></table>`;
    $("#compare").innerHTML = r1.summaryCheck.length
      ? `<p class="small"><b>합계 줄 검산</b> — 소계는 그 팀 줄의 합, 총계는 모든 데이터 줄의 합과 같은가</p>`
        + `<table><thead><tr><th>줄</th><th>합계 줄</th><th>열</th><th>적힌 값</th><th>계산한 값</th><th></th></tr></thead><tbody>`
        + r1.summaryCheck.map(x => `<tr><td>${x.row}</td><td>${esc(x.label)}</td><td>${esc(x.col)}</td><td>${x.got}</td><td>${x.want}</td><td>${x.ok ? "✓" : "✕"}</td></tr>`).join("")
        + `</tbody></table>`
      : "";
  }

  // ── 내려받기 ─────────────────────────────────────────
  function download(name, rows) {
    const ws = XLSX.utils.json_to_sheet(rows);
    const csv = "﻿" + XLSX.utils.sheet_to_csv(ws);           // 엑셀에서 한글이 깨지지 않게 BOM
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = name; a.click();
  }
  const base = () => S.name.replace(/\.(xlsx|xls|csv)$/i, "");
  $("#dl-clean").addEventListener("click", () => download(`${base()}_정리본.csv`, S.result.rows));
  $("#dl-log").addEventListener("click", () => download(`${base()}_변경기록.csv`,
    S.result.log.map(l => ({ 행: l.row, 열: l.col, 전: l.from, 후: l.to, 규칙: l.rule }))));

  // ── 정답 대조 ────────────────────────────────────────
  $("#answer-file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f || !S.result || !S.rules.answer) return;
    const { rows } = readWorkbook(await f.arrayBuffer(), f.name);
    const c = Clean.compare(S.result.rows, rows, S.rules.answer.key, S.rules.answer.compare);
    const diff = Object.entries(c.diff).map(([k, n]) => `${esc(k)} ${n}행`).join(" · ") || "없음";
    $("#compare").innerHTML = `<div class="stat">
        <div><div class="k">정답 행</div><div class="v">${c.answerRows}</div></div>
        <div><div class="k">일치</div><div class="v">${c.match}</div></div>
        <div><div class="k">정답에 없는 행</div><div class="v">${c.notInAnswer}</div></div>
        <div><div class="k">어긋난 열</div><div class="v" style="font-size:14px">${diff}</div></div></div>`
      + (c.examples.length ? `<p class="small">어긋난 예 — ${c.examples.slice(0, 5).map(x => `${esc(x.key.split("|")[0])} ${esc(x.col)}: ${esc(x.got)} (정답 ${esc(x.want)})`).join(" / ")}</p>` : "");
  });

  // ── 연결 ────────────────────────────────────────────
  $("#file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (f) loadFile(await f.arrayBuffer(), f.name);
  });
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async e => {
    const f = e.dataTransfer.files[0];
    if (f) loadFile(await f.arrayBuffer(), f.name);
  });
  document.querySelectorAll("[data-sample]").forEach(b => b.addEventListener("click", async () => {
    const name = b.dataset.sample;
    const buf = await (await fetch("data/" + encodeURIComponent(name))).arrayBuffer();
    loadFile(buf, name);
  }));
  $("#rules-file").addEventListener("change", async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { S.rules = JSON.parse(await f.text()); showRules(); }
    catch (err) { $("#rules-owner").textContent = "규칙 파일을 읽지 못했습니다 — JSON 형식을 확인하십시오"; }
  });
  $("#btn-apply").addEventListener("click", applyRules);
})();
