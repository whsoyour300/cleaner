# -*- coding: utf-8 -*-
"""상담원장_2025.xlsx 정리.

원본은 읽기만 한다. 결과는 정리본/ 아래 세 파일에 쓴다.
  정리본/상담원장_정리.csv  정리된 표 (원본 칸 24개 + 맨 끝 _표시)
  정리본/지운줄.csv         지운 줄 전부 (원본 값 그대로, 맨 끝 칸에 지운 이유)
  정리본/변경요약.md        무엇을 몇 줄 바꿨나

결정 기록: my-wiki/decisions/d-006-처리상태-합치고-이상한-값은-표시만.md
  결정 1 (d-006 ①)  처리상태 «종결»→«완료», «대기»→«보류» (CS기획팀 답)
  결정 2 (d-006 ②)  처리시간 음수 6건은 값을 그대로 두고 _표시에 이유
  결정 3 (d-006 ③)  만족도 6~10점 14건은 값을 그대로 두고 _표시에 이유. 평균 만족도는 표시한 줄을 뺀다
  결정 4 (d-006 ④)  칸 이름은 원본 그대로 (칸을 더하는 것은 맨 끝 _표시 하나뿐)
  결정 5 (d-006 ⑤)  고객번호 앞뒤 공백을 없앤다
  상담시간 단위는 분 (d-006 ④ 덧붙임). 작성기준 시트: 7/1 이후 전화 채널은 초 단위 → 60으로 나눠 분으로 맞춘다

위 결정에 없는 나머지 정리(테스트 줄 제거, 접수번호별 최신 한 줄, 표기 통일 등)는
앞서 «교안»과 작성기준 시트에 따라 하던 것을 그대로 옮겼다. 새로 더한 처리는 없다.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent.parent          # cleaner 폴더
SRC = BASE.parent / "messy" / "상담원장_2025.xlsx"       # 원본 (읽기만)
OUT = BASE / "정리본"

CHANNEL = {"전화": "전화", "유선": "전화", "전화상담": "전화", "TEL": "전화",
           "챗봇": "챗봇", "chatbot": "챗봇", "Chatbot": "챗봇", "챗 봇": "챗봇",
           "앱": "앱", "모바일앱": "앱", "app": "앱", "APP": "앱",
           "이메일": "이메일", "e-mail": "이메일", "E-mail": "이메일", "메일": "이메일"}
REGION = {"서울시": "서울", "서울특별시": "서울", "경기도": "경기"}
STATUS = {"처리완료": "완료", "종결": "완료", "처리중": "진행중", "대기": "보류"}
REASK = {"Y": "Y", "y": "Y", "TRUE": "Y", "예": "Y",
         "N": "N", "n": "N", "FALSE": "N", "아니오": "N"}
DONE = "완료"


def strip(v):
    return v.strip() if isinstance(v, str) else v


def main():
    raw = pd.read_excel(SRC, sheet_name=0, dtype=object)       # 원본은 읽기만
    cols = list(raw.columns)
    raw["_줄"] = raw.index + 2                                   # 엑셀 줄 번호 (머리글=1)
    raw["_o"] = range(len(raw))
    n_raw = len(raw)

    # ---- 값 앞뒤 공백을 없애고, 빈 문자열은 빈칸으로 (고객번호 포함: 결정 5) ----
    work = raw.copy()
    for c in cols:
        work[c] = work[c].map(strip)
    work = work.replace("", np.nan)

    # ---- 테스트 줄 (작성기준: 상담원ID AG999) ----
    is_test = work["상담원ID"].eq("AG999")
    work = work[~is_test].copy()

    # ---- 같은 접수번호는 최종수정일이 가장 늦은 한 줄 (같은 날이면 파일에서 뒤쪽 줄) ----
    work["_d"] = pd.to_datetime(work["최종수정일"])
    work = work.sort_values(["접수번호", "_d", "_o"])
    keep_mask = ~work.duplicated("접수번호", keep="last")
    kept_idx = set(work.index[keep_mask])
    dup_idx = list(work.index[~keep_mask])
    df = work[keep_mask].sort_values("_o").copy()

    # ---- 지운 줄 이유 ----
    kept_by_id = raw.loc[sorted(kept_idx)].set_index("접수번호", drop=False)

    def same_as_kept(i):
        r = raw.loc[i]
        k = kept_by_id.loc[r["접수번호"]]
        return all((pd.isna(r[c]) and pd.isna(k[c])) or r[c] == k[c] for c in cols)

    reasons = {}
    for i in raw.index[is_test]:
        reasons[i] = "테스트 접수(상담원ID AG999)"
    for i in dup_idx:
        reasons[i] = ("중복: 남긴 줄과 모든 칸 동일" if same_as_kept(i)
                      else "중복: 같은 접수번호의 다른 버전(남긴 줄이 최종수정일 최신)")
    removed = raw.loc[sorted(reasons, key=lambda i: raw.loc[i, "_줄"])]
    removed_out = removed[["_줄"] + cols].rename(columns={"_줄": "원본줄"}).copy()
    removed_out["지운이유"] = [reasons[i] for i in removed.index]

    changes = []   # (칸, 무엇을, 줄 수, 근거)

    def log(col, what, n, basis):
        changes.append((col, what, int(n), basis))

    # ---- 결정 5: 고객번호 앞뒤 공백 (남은 줄 기준으로 센다) ----
    r_kept = raw.loc[df.index]
    n5 = (r_kept["고객번호"] != r_kept["고객번호"].map(strip)).sum()
    log("고객번호", "앞뒤 공백 없앰", n5, "결정 5")
    other_ws = {}
    for c in cols:
        if c == "고객번호":
            continue
        n = ((r_kept[c] != r_kept[c].map(strip)) & r_kept[c].map(lambda v: isinstance(v, str))).sum()
        if n:
            other_ws[c] = int(n)
    for c, n in other_ws.items():
        log(c, "앞뒤 공백 없앰", n, "앞서 정한 표기 통일")

    # ---- 접수일 · 가입일 · 최종수정일 ----
    s = df["접수일"].astype(str)
    log("접수일", "표기 통일 (YYYY/MM/DD, YYYY.MM.DD → YYYY-MM-DD)", s.str.contains(r"[/.]").sum(), "앞서 정한 표기 통일")
    acc = pd.to_datetime(s.str.replace("/", "-").str.replace(".", "-"), format="%Y-%m-%d")

    # ---- 접수채널 ----
    before = df["접수채널"].copy()
    df["접수채널"] = before.map(CHANNEL)
    assert df["접수채널"].notna().all(), "알 수 없는 접수채널"
    log("접수채널", "17가지 → 4가지로 통일", (before != df["접수채널"]).sum(), "앞서 정한 표기 통일")

    # ---- 지역 · 상담원팀 · 월정액 ----
    before = df["지역"].copy()
    df["지역"] = before.replace(REGION)
    log("지역", "서울시·서울특별시→서울, 경기도→경기", (before.fillna("") != df["지역"].fillna("")).sum(), "앞서 정한 표기 통일")
    before = df["상담원팀"].copy()
    df["상담원팀"] = before.str.replace(" ", "", regex=False)
    log("상담원팀", "이름 속 공백 없앰", (before != df["상담원팀"]).sum(), "앞서 정한 표기 통일")
    bs = df["월정액"].astype(str)
    log("월정액", "«33,000원» → 33000", bs.str.contains("원|,").sum(), "앞서 정한 표기 통일")
    df["월정액"] = pd.to_numeric(bs.str.replace(",", "", regex=False).str.replace("원", "", regex=False).replace("nan", np.nan))

    # ---- 결정 1: 처리상태 (종결→완료, 대기→보류) + 앞서 정한 처리완료→완료, 처리중→진행중 ----
    st = df["처리상태"]
    log("처리상태", "«종결» → «완료»", st.eq("종결").sum(), "결정 1")
    log("처리상태", "«대기» → «보류»", st.eq("대기").sum(), "결정 1")
    log("처리상태", "«처리완료» → «완료»", st.eq("처리완료").sum(), "앞서 정한 표기 통일 (CS기획팀 확인 없음)")
    log("처리상태", "«처리중» → «진행중»", st.eq("처리중").sum(), "앞서 정한 표기 통일 (CS기획팀 확인 없음)")
    df["처리상태"] = st.replace(STATUS)

    # ---- 재문의: 표기 통일, 3/1 이전은 빈칸 (작성기준) ----
    rq = df["재문의"]
    log("재문의", "표기 통일 (y·TRUE·예 → Y, n·FALSE·아니오 → N)", (rq.notna() & ~rq.isin(["Y", "N"])).sum(), "앞서 정한 표기 통일")
    new_rq = rq.map(REASK)
    pre = acc < pd.Timestamp("2025-03-01")
    log("재문의", "3/1 이전 접수분 값을 빈칸으로", (rq.notna() & pre).sum(), "작성기준 (3/1부터 기록)")
    new_rq[pre] = np.nan
    df["재문의"] = new_rq

    # ---- 만족도: 0·-·미응답 → 빈칸, «5점» → 5. 6~10점은 값을 그대로 둔다 (결정 3) ----
    sat_raw = df["만족도"].astype(str).where(df["만족도"].notna(), "")
    log("만족도", "0·-·미응답 → 빈칸", sat_raw.isin(["0", "0.0", "-", "미응답"]).sum(), "작성기준 (미응답 표기)")
    log("만족도", "«5점» 꼴 → 숫자", sat_raw.str.endswith("점").sum(), "앞서 정한 표기 통일")
    sat = pd.to_numeric(sat_raw.str.replace("점", "", regex=False), errors="coerce")
    sat[sat < 1] = np.nan                                   # 0 → 빈칸 ('-'·'미응답'은 위에서 이미 NaN)
    df["만족도"] = sat

    # ---- 처리시간: 음수는 지우지 않는다 (결정 2) ----
    ptime = pd.to_numeric(df["처리시간"])
    df["처리시간"] = ptime

    # ---- 상담시간: 9999 → 빈칸, 7/1 이후 전화 채널은 초 → 분 ----
    t = pd.to_numeric(df["상담시간"]).astype(float)
    log("상담시간", "9999 → 빈칸", (t == 9999).sum(), "사용자가 정함 (빈칸 처리)")
    t[t == 9999] = np.nan
    conv = (df["접수채널"] == "전화") & (acc >= pd.Timestamp("2025-07-01")) & t.notna()   # 7/1 이후 전화 채널 (작성기준)
    sec_before = t[conv].copy()
    t[conv] = t[conv] / 60
    log("상담시간", "7/1 이후 전화 채널: 초 → 분 (60으로 나눔)", conv.sum(), "작성기준 + 사용자가 정함 (단위는 분)")
    df["상담시간"] = t.round(1)
    n_phone_late = int(conv.sum())
    avg_sec = float(sec_before.mean())
    avg_min = float(df.loc[conv, "상담시간"].mean())

    # ---- _표시: 값은 두고 이유만 적는다 (결정 2·3) ----
    neg = ptime < 0
    flag_sat = sat > 5
    notes = pd.Series("", index=df.index)
    for i in df.index[neg]:
        notes[i] = f"처리시간 {ptime[i]:g}: 음수. 틀린 값이나 진짜 값을 몰라 그대로 둠"
    for i in df.index[flag_sat]:
        msg = f"만족도 {sat[i]:g}: 6~10점. NPS를 잘못 넣은 것으로 보이나 확인하지 못해 그대로 둠(평균 만족도에서 뺌)"
        notes[i] = (notes[i] + "; " + msg) if notes[i] else msg
    df["_표시"] = notes
    log("_표시", "처리시간 음수 — 값은 그대로, 이유만 적음", neg.sum(), "결정 2")
    log("_표시", "만족도 6~10점 — 값은 그대로, 이유만 적음", flag_sat.sum(), "결정 3")

    # ---- 날짜 칸을 YYYY-MM-DD 로 ----
    df["접수일"] = acc.dt.strftime("%Y-%m-%d")
    for c in ["가입일", "최종수정일"]:
        df[c] = pd.to_datetime(df[c]).dt.strftime("%Y-%m-%d")

    final = df[cols + ["_표시"]]
    assert list(final.columns[:-1]) == cols            # 결정 4: 칸 이름은 원본 그대로
    OUT.mkdir(exist_ok=True)
    final.to_csv(OUT / "상담원장_정리.csv", index=False, encoding="utf-8-sig")
    removed_out.to_csv(OUT / "지운줄.csv", index=False, encoding="utf-8-sig")

    # ---- 변경요약.md ----
    rc = removed_out["지운이유"].value_counts()
    n_test = int(rc.get("테스트 접수(상담원ID AG999)", 0))
    n_dup_same = int(rc.get("중복: 남긴 줄과 모든 칸 동일", 0))
    n_dup_diff = int(rc.get("중복: 같은 접수번호의 다른 버전(남긴 줄이 최종수정일 최신)", 0))
    lines = []
    w = lines.append
    w("# 상담원장 정리 — 변경 요약\n")
    w("만든 것: `정리/정리_상담원장.py` (결정 기록 d-006 ①~⑤ 반영). 원본 `../messy/상담원장_2025.xlsx` 는 읽기만 했다.\n")
    w("## 줄 수\n")
    w("| 단계 | 줄 수 |\n|---|---|")
    w(f"| 원본 (원장 시트, 머리글 제외) | {n_raw:,} |")
    w(f"| 지움: 테스트 접수 (상담원ID AG999) | −{n_test:,} |")
    w(f"| 지움: 중복, 남긴 줄과 모든 칸 동일 | −{n_dup_same:,} |")
    w(f"| 지움: 중복, 같은 접수번호의 다른 버전 | −{n_dup_diff:,} |")
    w(f"| 정리본 | {len(final):,} |")
    w(f"\n검산: {n_raw:,} − {n_test + n_dup_same + n_dup_diff:,} = {n_raw - n_test - n_dup_same - n_dup_diff:,} (정리본 {len(final):,}줄).")
    w("지운 줄 전부는 `정리본/지운줄.csv` 에 있다(맨 앞 칸 `원본줄`, 맨 끝 칸 `지운이유`).\n")
    w("## 상담시간 칸: 7월 이후 전화 줄은 초에서 분으로 바뀌었다\n")
    w("칸 이름은 원본 그대로 `상담시간`이다. 그러나 **2025-07-01 이후 접수된 전화 채널 줄**은 원본에서 **초 단위**로 기록되어 있어(작성기준 시트) 60으로 나눠 **분 단위**로 바꿨다. 이 칸의 단위는 분이다.\n")
    w(f"- 해당 줄: **{n_phone_late:,}줄**")
    w(f"- 환산 전 평균 {avg_sec:,.1f}초 → 환산 후 평균 {avg_min:,.1f}분")
    w("- 접수채널을 «전화»로 본 범위: 전화 · 유선 · 전화상담 · TEL (이 범위는 사용자에게 확인받지 않았다)")
    w("- 환산한 줄을 따로 표시하지는 않았다(표시 여부는 정해지지 않았다).\n")
    w("## 칸 이름\n")
    w(f"원본 {len(cols)}칸의 이름과 순서는 그대로다(결정 4). 더한 칸은 맨 끝 `_표시` 하나뿐이다.\n")
    w("## 값을 바꾼 것\n")
    w("| 칸 | 무엇을 | 줄 수 | 근거 |\n|---|---|---|---|")
    for col, what, n, basis in changes:
        if n:
            w(f"| {col} | {what} | {n:,} | {basis} |")
    w("\n«결정 N» 은 결정 기록 d-006 의 N번 결정이다. «앞서 정한 표기 통일» 은 교안과 이전 정리에서 하던 것을 그대로 옮긴 것이다.")
    w("\n## 지우지 않고 표시만 한 줄 (`_표시` 칸)\n")
    w(f"- 처리시간 음수: {int(neg.sum())}줄 — " + ", ".join(
        f"{df.loc[i, '접수번호']}({ptime[i]:g})" for i in df.index[neg]))
    w(f"- 만족도 6~10점: {int(flag_sat.sum())}줄 — 값은 그대로, 평균 만족도를 낼 때는 이 줄을 뺀다")
    w(f"- 두 가지가 모두 걸린 줄: {int((neg & flag_sat).sum())}줄\n")
    (OUT / "변경요약.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("줄 수:", n_raw, "→", len(final), "(지움", n_test, n_dup_same, n_dup_diff, ")")
    print("상담시간 환산 줄:", n_phone_late)


if __name__ == "__main__":
    sys.exit(main())
