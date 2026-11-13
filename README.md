# 엑셀 정리기 — 3주차 목업

엉망인 엑셀·CSV를 끌어다 놓으면 **증상을 진단**하고, **내가 정한 규칙**대로 정리하고, **바꾼 것을 한 줄씩** 남깁니다.
**파일은 이 브라우저를 떠나지 않습니다.** 서버가 없습니다.

## 돌려보기

```
python -m http.server 8000      # index.html 을 더블클릭하면 예시 파일을 못 읽습니다
```

## 올리기

```
1. 이 폴더를 내 GitHub 저장소로
2. vercel.com → Add New → Project → Import → Application Preset: Other → Deploy
```

키도, 서버 함수도 없습니다. 정적 파일만 올라갑니다.

## 파일

| 파일 | 하는 일 |
|---|---|
| `rules/*.json` | ★ **처리 규칙** — 무엇을 어떻게 바꿀지, **왜** 그렇게 정했는지. **사람이 정한다** |
| `clean.js` | 진단(규칙 없이 증상 찾기) · 규칙 적용 · «두 번 돌려도 같은가» · 정답 대조 |
| `app.js` · `index.html` · `style.css` | 화면 |
| `lib/xlsx.full.min.js` | 엑셀 읽기 (SheetJS Community Edition, Apache 2.0 — `lib/LICENSE-sheetjs.txt`) |
| `data/` | 예시 파일 두 개 (만들어낸 데이터) |
| `tools/check.js` | 같은 엔진을 node 로 돌려 숫자를 확인 (배포 제외) |
| `tools/answer/` | **정답 — 배포하지 않는다** (`.vercelignore`) |

## 규칙 파일의 모양

```json
{
  "columns": {
    "채널":   {"trim": true, "map": {"유선": "전화"}, "why": "같은 채널을 여러 이름으로 적었다"},
    "상담시간": {"number": true, "rescale": {"over": 180, "divide": 60}, "why": "…"},
    "이수시간": {"number": true, "missing": "flag", "range": {"min": 0, "max": 400, "action": "flag"}}
  },
  "cross_checks": [{"label": "이수 0시간인데 수료", "when": [["이수시간", "==", 0], ["수료여부", "==", "수료"]]}],
  "duplicates": {"action": "drop", "why": "모든 열이 같은 행은 하나만"}
}
```

적용 순서는 열마다 `trim → map(fold) → blank_to → other_to → strip_units → number → date → rescale → missing/range/negative`, 그다음 `sigma`(3시그마), 두 열 검사, 마지막에 중복입니다.

| 규칙 키 | 뜻 |
|---|---|
| `fold` | `map` 을 볼 때 띄어쓰기·대소문자를 무시 («챗 봇»=«챗봇») |
| `other_to` + `keep` | `keep` 에 없는 값은 모두 `other_to` 로 (수료가 아니면 미수료). 빈칸은 그대로 |
| `range.action: "exclude"` · `negative: "exclude"` | 분석에서 제외할 값 — 지우지 않고 `_표시` 에 «제외:» 로 적는다 |
| `sigma: {k: 3}` | 평균 ±k·표준편차 밖을 표시. 음수·이미 밖인 값을 빼고 되풀이 계산 |
| `integer` · `allowed` | 정수가 아니면 · 허용 목록 밖이면 표시 |
| `summary_rows` | 칸 어디든 소계·총계·합계가 든 줄을 데이터에서 떼어 두고, 소계=팀 줄 합, 총계=전체 합인지 검산 |
| `[열, ">col", 다른열]` | 두 열 검사에서 열끼리 비교 |

엑셀을 읽을 때 병합 셀은 풀어서 범위 전체에 같은 값을 채우고, 첫 줄이 가로 병합된 제목이면 그 아래 칸들의 윗단계로 보고 칸 이름은 둘째 줄에서 읽습니다.

## 확인한 숫자

```
node tools/check.js
```

- 상담이력: 1,542행 → 1,512행 (완전 중복 30행). 정답 1,500행 중 1,482행 일치. **재발송 12행은 정답에 없지만 규칙대로 남겼다**
- ⚠ 위 숫자는 이전 규칙(180 초과는 초 단위로 보고 ÷60) 기준이다. 지금 규칙은 1,440분 초과를 이상 데이터로 제외 표시하고 나누지 않으므로 정답(`tools/answer`)과 상담시간 176행이 달라진다 — `node tools/check.js` 로 다시 확인
- 교육이수로그: 표시한 행 17 (빈칸 9 · 범위 밖 3 · 이수 0시간인데 수료 5). 지운 행 없음
- 두 파일 모두 **두 번 돌려도 같은 결과**

## 도구가 못 보는 것

- **뜻이 같은 다른 말** — «완료»와 «수료». 값 목록을 눈으로 봅니다
- **색으로만 표시된 정보**, 병합 셀, 머리글 두 줄, 시트 여러 개 — 파일을 한 번 열어 봐야 압니다
