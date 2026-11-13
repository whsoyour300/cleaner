/* 정리 엔진 — 진단과 규칙 적용.
 *
 *   diagnose(rows)        규칙 없이 다섯 증상을 찾는다 (빈칸 · 튀는 값 · 섞인 형식 · 중복 · 표기)
 *   apply(rows, rules)    사람이 정한 규칙대로 정리하고, 바꾼 것을 한 줄씩 남긴다
 *   same(a, b)            두 결과가 같은가 — «두 번 돌려도 같은 결과» 확인용
 *
 * 브라우저(window.Clean)와 node(require) 양쪽에서 쓴다. 파일은 밖으로 나가지 않는다.
 */
(function (root) {
  "use strict";

  const FLAG = "_표시";
  const isBlank = v => v === null || v === undefined || String(v).trim() === "";
  const numLike = v => typeof v === "number" || /^\s*-?[\d,]+(\.\d+)?\s*$/.test(String(v));
  const toNum = v => (typeof v === "number" ? v : Number(String(v).replace(/,/g, "").trim()));
  const columnsOf = rows => (rows.length ? Object.keys(rows[0]).filter(c => c !== FLAG) : []);

  const DATE_FORMATS = [
    { name: "YYYY-MM-DD", re: /^(\d{4})-(\d{2})-(\d{2})$/, y: 1, m: 2, d: 3 },
    { name: "YYYY/MM/DD", re: /^(\d{4})\/(\d{2})\/(\d{2})$/, y: 1, m: 2, d: 3 },
    { name: "DD-MM-YYYY", re: /^(\d{2})-(\d{2})-(\d{4})$/, y: 3, m: 2, d: 1 },
    { name: "YYYY.MM.DD", re: /^(\d{4})\.(\d{2})\.(\d{2})$/, y: 1, m: 2, d: 3 },
  ];
  const dateFormatOf = v => (DATE_FORMATS.find(f => f.re.test(String(v).trim())) || {}).name || null;

  function quantile(sorted, q) {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // ── 진단 ─────────────────────────────────────────────────────
  function diagnose(allRows) {
    // 소계·총계 줄은 데이터가 아니다 — 따로 세고, 튀는 값·빈칸 계산에서는 뺀다
    const sp = splitSummary(allRows);
    const rows = sp.summary.length ? sp.data.map(x => x.r) : allRows;
    const cols = columnsOf(rows);
    const out = { n: rows.length, columns: {}, symptoms: [], summaryRows: sp.summary.length };

    for (const c of cols) {
      const vals = rows.map(r => r[c]);
      const filled = vals.filter(v => !isBlank(v));
      const info = { empty: vals.length - filled.length };

      // 섞인 형식 — 대부분 숫자인데 글자가 섞였다 («3개», «1,234 원»)
      const nums = filled.filter(numLike);
      info.numericShare = filled.length ? nums.length / filled.length : 0;
      if (info.numericShare >= 0.6 && nums.length < filled.length) {
        info.notNumber = [...new Set(filled.filter(v => !numLike(v)).map(String))].slice(0, 6);
        info.notNumberCount = filled.length - nums.length;
      }

      // 튀는 값 — 숫자 열에서 사분위 범위의 3배 밖
      if (info.numericShare >= 0.6 && nums.length >= 8) {
        const s = nums.map(toNum).sort((a, b) => a - b);
        const q1 = quantile(s, 0.25), q3 = quantile(s, 0.75), iqr = q3 - q1;
        const lo = q1 - 3 * iqr, hi = q3 + 3 * iqr;
        const odd = s.filter(v => v < lo || v > hi);
        info.stats = { min: s[0], max: s[s.length - 1], median: quantile(s, 0.5), lo, hi };
        if (odd.length) info.outliers = { count: odd.length, examples: [...new Set(odd)].slice(-5) };
        const neg = s.filter(v => v < 0).length;
        if (neg) info.negative = neg;
      }

      // 날짜 표기 여러 가지
      const fmts = {};
      filled.forEach(v => { const f = dateFormatOf(v); if (f) fmts[f] = (fmts[f] || 0) + 1; });
      if (Object.keys(fmts).length && Object.values(fmts).reduce((a, b) => a + b, 0) >= filled.length * 0.8) {
        info.dateFormats = fmts;
      }

      // 표기 — 종류가 적은 글자 열이면 전부 보여준다. 공백·대소문자만 다른 것은 묶어서 알려준다
      const distinct = {};
      filled.forEach(v => { const k = String(v); distinct[k] = (distinct[k] || 0) + 1; });
      const kinds = Object.keys(distinct).length;
      if (info.numericShare < 0.6 && !info.dateFormats && kinds <= 30) {
        info.values = distinct;
        const groups = {};
        Object.keys(distinct).forEach(v => {
          const k = v.toLowerCase().replace(/\s+/g, "");
          (groups[k] = groups[k] || []).push(v);
        });
        info.lookAlike = Object.values(groups).filter(g => g.length > 1);
      }
      out.columns[c] = info;
    }

    // 완전히 같은 행
    const seen = new Set();
    let dup = 0;
    rows.forEach(r => { const k = JSON.stringify(cols.map(c => r[c])); if (seen.has(k)) dup += 1; else seen.add(k); });
    out.duplicates = dup;

    // 증상 카드 — 사람이 읽을 요약
    for (const [c, i] of Object.entries(out.columns)) {
      if (i.empty) out.symptoms.push({ kind: "빈칸", col: c, text: `${c} — 빈칸 ${i.empty}개` });
      if (i.notNumberCount) out.symptoms.push({ kind: "섞인 형식", col: c, text: `${c} — 숫자 열에 글자 ${i.notNumberCount}개 (예: ${i.notNumber.slice(0, 3).join(", ")})` });
      if (i.outliers) out.symptoms.push({ kind: "튀는 값", col: c, text: `${c} — 튀는 값 ${i.outliers.count}개 (예: ${i.outliers.examples.join(", ")})` });
      if (i.negative) out.symptoms.push({ kind: "튀는 값", col: c, text: `${c} — 음수 ${i.negative}개` });
      if (i.dateFormats && Object.keys(i.dateFormats).length > 1) out.symptoms.push({ kind: "섞인 형식", col: c, text: `${c} — 날짜 표기 ${Object.keys(i.dateFormats).length}가지 (${Object.keys(i.dateFormats).join(" · ")})` });
      if (i.values && Object.keys(i.values).length > 1 && (i.lookAlike.length || Object.keys(i.values).length > 6)) {
        out.symptoms.push({ kind: "표기", col: c, text: `${c} — ${Object.keys(i.values).length}가지 표기${i.lookAlike.length ? ` (비슷한 것: ${i.lookAlike.map(g => g.map(x => `«${x}»`).join("/")).join(", ")})` : ""}` });
      }
    }
    if (sp.summary.length) out.symptoms.push({ kind: "합계 줄", col: "(행 전체)", text: `소계·총계 줄 ${sp.summary.length}개 — 데이터가 아니라 합계라서 따로 두고 셉니다 (줄 ${sp.summary.map(x => x.i + 2).join(", ")})` });
    if (dup) out.symptoms.push({ kind: "중복", col: "(행 전체)", text: `완전히 같은 행 ${dup}개 — 날짜 표기를 먼저 맞추면 더 나올 수 있습니다` });
    return out;
  }

  // ── 규칙 적용 ─────────────────────────────────────────────────
  function toISODate(v) {
    const s = String(v).trim();
    for (const f of DATE_FORMATS) {
      const m = s.match(f.re);
      if (m) return `${m[f.y]}-${m[f.m]}-${m[f.d]}`;
    }
    return v;
  }

  function test(row, [col, op, value]) {
    const v = row[col];
    if (op === "blank") return isBlank(v);
    if (op === ">col") return !isBlank(v) && !isBlank(row[value]) && numLike(v) && numLike(row[value]) && toNum(v) > toNum(row[value]);   // 다른 열과 비교
    if (isBlank(v)) return false;          // 빈칸은 0이 아니다 — 빈칸을 0으로 읽으면 없는 사실이 생긴다
    const n = typeof value === "number" ? toNum(v) : String(v);
    switch (op) {
      case "==": return n === value;
      case "!=": return n !== value;
      case ">": return toNum(v) > value;
      case "<": return toNum(v) < value;
      case "blank": return isBlank(v);
      default: return false;
    }
  }

  // 띄어쓰기·대소문자를 무시하고 같은 말인지 본다 — «챗 봇»=«챗봇», «APP»=«app»
  const fold = v => String(v).replace(/\s+/g, "").toLowerCase();

  // 합계 줄 — 칸 어디든 «소계»·«총계»·«합계» 가 들어 있으면 데이터 줄이 아니라 합계 줄이다
  const SUMMARY_RE = /소계|총계|합계/;
  const isSummaryRow = (r, cols) => cols.some(c => typeof r[c] === "string" && SUMMARY_RE.test(r[c]));
  function splitSummary(rows) {
    const cols = columnsOf(rows);
    const data = [], summary = [];
    rows.forEach((r, i) => (isSummaryRow(r, cols) ? summary : data).push({ r, i }));
    return { data, summary, cols };
  }

  // 합계 검산 — 소계 = 그 팀 줄의 합, 총계 = 모든 데이터 줄의 합. 맞는지 숫자로 보여 준다
  // «93,520,000 원» 처럼 정리 전 글자도 숫자로 읽는다 (검산은 정리 전 원본 합계 줄과 비교한다)
  const looseNum = v => (typeof v === "number" ? v : (/^\s*-?[\d,.]+\s*(원|개)?\s*$/.test(String(v)) ? Number(String(v).replace(/[,\s원개]/g, "")) : NaN));
  function checkSummary(rows, rule) {
    const { data, summary } = splitSummary(rows);
    const key = rule.group_by, sums = rule.sum_cols, out = [];
    
    summary.forEach(({ r, i }) => {
      const label = String(r[key]).trim();
      const team = label.replace(/\s*(소계|총계|합계)\s*$/, "");
      const isTotal = /총계|^합계/.test(label);
      const scope = isTotal ? data : data.filter(({ r: d }) => String(d[key]).trim() === team);
      sums.forEach(c => {
        const want = scope.reduce((a, { r: d }) => a + (looseNum(d[c]) || 0), 0);
        const got = looseNum(r[c]);
        out.push({ row: i + 2, label, col: c, got, want, ok: got === want });
      });
    });
    return out;
  }

  const validDate = s => {
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  };

  function apply(input, rules) {
    const log = [];
    const cols = columnsOf(input);
    // 합계 줄은 데이터와 따로 둔다 — 합계가 튀는 값·빈칸으로 잡히지 않게
    const sp = rules.summary_rows ? splitSummary(input) : { data: input.map((r, i) => ({ r, i })), summary: [] };
    const summaryRows = sp.summary.map(({ r }) => { const o = {}; cols.forEach(c => { o[c] = r[c]; }); return o; });
    const rows = sp.data.map(({ r }) => { const o = {}; cols.forEach(c => { o[c] = r[c]; }); o[FLAG] = []; return o; });
    const origIdx = sp.data.map(({ i }) => i);
    const note = (i, col, from, to, rule) => log.push({ row: origIdx[i] + 2, col, from, to, rule });

    for (const [col, r] of Object.entries(rules.columns || {})) {
      if (!cols.includes(col)) continue;
      const foldMap = r.map && r.fold ? Object.fromEntries(Object.entries(r.map).map(([k, v]) => [fold(k), v])) : null;
      rows.forEach((row, i) => {
        let v = row[col];
        const before = v;
        if (r.trim && typeof v === "string") v = v.trim();
        if (foldMap) { if (!isBlank(v) && Object.prototype.hasOwnProperty.call(foldMap, fold(v))) v = foldMap[fold(v)]; }
        else if (r.map && Object.prototype.hasOwnProperty.call(r.map, String(v))) v = r.map[String(v)];
        if (r.blank_to !== undefined && isBlank(v)) v = r.blank_to;
        // 정해 둔 값(keep)이 아닌 나머지는 한 값으로 — 수료가 아니면 미수료. 빈칸은 건드리지 않는다
        if (r.other_to !== undefined && !isBlank(v) && !(r.keep || []).includes(v)) v = r.other_to;
        if (r.strip_units && typeof v === "string") r.strip_units.forEach(u => { v = v.split(u).join("").trim(); });
        if (r.number && !isBlank(v) && numLike(v)) v = toNum(v);
        if (r.date && !isBlank(v)) v = toISODate(v);
        if (r.date && !isBlank(v) && !validDate(v)) row[FLAG].push(`${col} 날짜가 아님(${v})`);
        if (r.integer && typeof v === "number" && !Number.isInteger(v)) row[FLAG].push(`${col} 정수가 아님(${v})`);
        if (r.allowed && !isBlank(v) && !r.allowed.includes(v)) row[FLAG].push(`${col} 허용 값 밖(${v})`);
        if (r.rescale && typeof v === "number" && v > r.rescale.over) v = v / r.rescale.divide;
        // 글자 «12»가 숫자 12가 된 것처럼 겉보기가 같으면 기록하지 않는다 — 기록은 사람이 읽을 것만
        const sameNumber = !isBlank(v) && !isBlank(before) && numLike(v) && numLike(before) && toNum(v) === toNum(before);
        if (String(v) !== String(before) && !sameNumber && !(isBlank(v) && isBlank(before))) note(i, col, before, v, r.why || "");
        row[col] = v;

        if (r.missing && isBlank(v)) {
          if (r.missing === "flag") row[FLAG].push(`${col} 빈칸`);
        }
        if (r.range && !isBlank(v) && typeof v === "number" && (v < r.range.min || v > r.range.max)) {
          // exclude: 분석에서 뺄 값 — 지우지 않고 «제외» 라고 적어 둔다. flag: 표시만
          if (r.range.action === "flag") row[FLAG].push(`${col} 범위 밖(${v})`);
          if (r.range.action === "exclude") row[FLAG].push(`제외: ${col} ${v < r.range.min ? "너무 작음" : "너무 큼"}(${v})`);
        }
        if (r.negative === "exclude" && typeof v === "number" && v < 0) row[FLAG].push(`제외: ${col} 음수(${v})`);
      });

      // 3시그마 — 평균에서 표준편차 ×k 밖. 음수와 이미 밖으로 잡힌 값은 빼고 다시 계산하기를 되풀이한다
      // (9999 하나가 평균·표준편차를 부풀려 1440 을 가리기 때문)
      if (r.sigma) {
        const k = r.sigma.k || 3;
        const live = rows.map((row, i) => ({ row, i, v: row[col] })).filter(x => typeof x.v === "number" && x.v >= 0);
        let pool = live.slice();
        for (let it = 0; it < 10; it++) {
          if (pool.length < 3) break;
          const m = pool.reduce((a, x) => a + x.v, 0) / pool.length;
          const sd = Math.sqrt(pool.reduce((a, x) => a + (x.v - m) ** 2, 0) / (pool.length - 1));
          const out = pool.filter(x => Math.abs(x.v - m) > k * sd);
          if (!out.length) break;
          out.forEach(x => x.row[FLAG].push(`${col} ${k}시그마 밖(${x.v})`));
          pool = pool.filter(x => !out.includes(x));
        }
      }
    }

    for (const cc of rules.cross_checks || []) {
      rows.forEach(row => { if (cc.when.every(w => test(row, w))) row[FLAG].push(cc.label); });
    }

    let kept = rows;
    let dropped = 0;
    if (rules.duplicates && rules.duplicates.action === "drop") {
      const seen = new Set();
      kept = [];
      rows.forEach((row, i) => {
        const k = JSON.stringify(cols.map(c => row[c]));
        if (seen.has(k)) { dropped += 1; log.push({ row: origIdx[i] + 2, col: "(행 전체)", from: "", to: "지움", rule: rules.duplicates.why || "완전히 같은 행" }); }
        else { seen.add(k); kept.push(row); }
      });
    }

    kept.forEach(row => { row[FLAG] = row[FLAG].join(" · "); });
    const flagged = kept.filter(r => r[FLAG]).length;
    const excluded = kept.filter(r => /(^| · )제외:/.test(r[FLAG])).length;
    const changedCols = {};
    log.forEach(l => { changedCols[l.col] = (changedCols[l.col] || 0) + 1; });
    return { rows: kept, log, summaryRows, summaryCheck: rules.summary_rows ? checkSummary(input, rules.summary_rows) : [],
      summary: { before: input.length, after: kept.length, dropped, flagged, excluded, summaryRows: summaryRows.length, changes: log.length - dropped, byColumn: changedCols } };
  }

  function same(a, b) {
    if (a.length !== b.length) return false;
    return a.every((r, i) => JSON.stringify(r) === JSON.stringify(b[i]));
  }

  /* 정답과 대조 — 정답은 «완성 기준»이 아니라 «내 규칙이 무엇을 놓쳤나»를 보는 거울이다.
   * key 로 같은 행을 찾고, cols 의 값을 비교한다. 숫자는 값으로 비교한다. */
  function compare(rows, answer, key, cols) {
    const k = r => key.map(c => String(r[c])).join("|");
    const want = new Map(answer.map(r => [k(r), r]));
    let match = 0, notInAnswer = 0;
    const diff = {}, examples = [];
    rows.forEach(r => {
      const a = want.get(k(r));
      if (!a) { notInAnswer += 1; return; }
      let ok = true;
      for (const c of cols) {
        const x = r[c], y = a[c];
        const eq = String(x) === String(y) || (numLike(x) && numLike(y) && !isBlank(x) && !isBlank(y) && toNum(x) === toNum(y));
        if (!eq) {
          ok = false; diff[c] = (diff[c] || 0) + 1;
          if (examples.length < 8) examples.push({ key: k(r), col: c, got: x, want: y });
        }
      }
      if (ok) match += 1;
    });
    return { answerRows: answer.length, match, notInAnswer, diff, examples };
  }

  const api = { diagnose, apply, same, compare, splitSummary, checkSummary, FLAG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Clean = api;
})(this);
