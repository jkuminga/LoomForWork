---
name: extract-features
description: "사용자가 지정한 PRD에서 하네스 Feature와 하위 backlog WorkItem 후보 JSON을 만들 때 사용한다. 후보 검토용이며 DB 등록이나 Run 시작은 하지 않는다."
metadata:
  upstream_source: "https://github.com/nurettincoban/ai-prd-workflow/tree/b67f4d3e1161dcf10ac6d8d0e31ca22015474de0/skills/extract-features"
  upstream_version: "3.0.0"
---

# PRD에서 Feature·WI 후보 추출

사용자가 지정한 PRD Markdown을 읽고 제품 기능을 빠짐없이 추출한 뒤, 하네스의 상위 Feature와 하위 WorkItem(WI) 후보로 정리한다. 이 스킬은 후보 생성 전용이다. `create_feature()`, `create_work_item()`, Run 시작 및 상태 변경은 수행하지 않는다. 입력이 MVP뿐이면 `mvp-to-prd`와 `verify-prd`를 거쳐 PRD 경로를 받은 후 이 절차를 시작한다.

## 1. 입력과 기존 Feature 확인

1. 사용자에게서 PRD 경로를 받는다. 첫 버전의 입력은 저장소 안의 Markdown(`.md`) PRD다. 경로가 없거나 읽을 수 없으면 요청한다. 같은 PRD 옆의 `<prd-filename-without-.md>.review.md`가 있으면 함께 읽고, JSON의 `review`에 경로를 넣는다.
2. 읽기 전용 `harness-state.list_features()`로 기존 Feature의 ID·제목·목표·상태를 확인한다. 사용할 수 없으면 기존 Feature 재사용을 추정하지 않는다. 신규 후보만 제시하고 조회하지 못한 사실을 보고한다.
3. PRD의 포함·제외 범위와 FR/NFR(기능·비기능 요구사항), 사용자 흐름, 검토 기록의 미해결 항목을 함께 파악한다. 출시 범위를 바꾸는 모호함은 후보 확정 전에 사용자에게 확인하고, 구현 방법의 미결정 사항은 후보의 `notes`로 남긴다.

## 2. vendor 방식으로 세부 기능 추출

1. PRD에 근거한 명시·암묵 기능을 각각 구별 가능한 F 항목으로 추출한다. 각 항목에 `F1`, `F2`처럼 중복 없는 임시 번호, 결과 중심 제목·목표, MoSCoW(`Must`/`Should`/`Could`/`Won't`), 상대 구현 난이도(`Low`/`Medium`/`High`), PRD 요구사항 ID, AC(완료 조건), 기술적 제약·예외를 붙인다. PRD에 없는 새 기능을 만들어 범위를 늘리지 않는다.
2. 각 FR/NFR이 포함 항목 또는 명시적 Won't 항목에 의해 설명되는지 확인한다. PRD의 제외 범위는 Won't로 식별한다. 검토 기록의 높은 영향 항목은 관련 F의 AC·`notes` 또는 Won't 보고에 반영한다. 미검증 가능성을 완료된 기능으로 표현하지 않는다.
3. Won't 항목은 사용자 응답용으로만 보관한다. 후보 JSON에는 포함하지 않고, DB 등록 대상으로 삼지 않는다. 포함하는 각 F 항목은 아래 단계에서 정확히 한 WI 후보로 옮긴다. 크다는 이유만으로 자동 분할하지 않는다. 큰 WI는 여러 Run으로 수행할 수 있다.

## 3. 하네스 Feature로 범주화

같은 사용자 결과와 작업 흐름을 완성하는 F만 하나의 상위 Feature로 묶는다. 두 F가 같은 화면·기술을 쓴다는 이유만으로 합치지 않는다. 서로 다른 서비스의 권한·데이터·실패 흐름이 독립적이면 별도 Feature로 둔다. 단독 제품 기능이 되기 어려운 작은 메뉴·버튼은 그것이 여는 사용자 흐름에 합친다. 하나의 Feature는 관련 WI 후보 하나 이상을 가진다. F가 두 부모에 중복되거나 어느 부모에도 속하지 않는 상태로 끝내지 않는다.

기존 Feature와 목표·범위가 실질적으로 같고 `list_features()`에서 정확한 ID를 확인했으면 `target.mode="reuse"`로 제안한다. 제목 유사성만으로 재사용하지 않는다. `completed`·`cancelled`처럼 닫힌 Feature에 새 WI를 붙이는 판단은 사용자에게 확인한다. 재사용 대상이 확실하지 않으면 새 Feature 후보로 제시하고 겹침 가능성을 사용자에게 알린다. 새 상위 Feature에는 `target.mode="create"`를 쓴다. 어떤 경우에도 후보 생성 중 기존 Feature를 변경하지 않는다.

## 4. WI 속성과 AC 정리

- `kind`(작업 종류): 제품 기능 구현은 `implementation`이 기본이다. F 자체의 결과물이 조사·결정·검증이면 각각 `research`·`decision`·`verification`을 쓴다. 연동이 어렵거나 불확실하다는 이유만으로 구현 F를 `research`로 바꾸지 않는다. PRD가 명시한 경우에만 나머지 허용 종류(`bug`, `refactor`, `migration`, `maintenance`)를 쓴다.
- `priority`(작업 우선순위): MoSCoW는 출시 범위이고 이 값은 작업 순서다. 기본값은 `normal`; 다른 필수 작업의 선행 조건이거나 핵심 흐름을 막는 작업은 `high`; 범위 안에서 뒤로 미룰 수 있는 작업은 `low`; 명시적인 긴급 요청만 `urgent`로 둔다. F 사이의 강제 순위를 만들지 않고, 모든 Must를 일괄 `high`로 바꾸지 않는다. 새 Feature의 우선순위는 하위 WI의 가장 높은 우선순위를 기본으로 하되 PRD의 명시적 결정과 충돌하면 확인한다.
- AC: vendor가 추출한 내용을 보존한다. 한 문장에 독립적인 결과가 여럿 묶였으면 PRD 근거를 보며 분리한다. 한 개로 충분하면 유지한다. AC 개수를 맞추기 위한 조건이나 확인되지 않은 기능을 추가하지 않는다. 각 WI에는 비어 있지 않은 AC가 하나 이상 있어야 한다.
- `notes`에는 구현 제약·엣지 케이스·검토 기록의 미해결 사항을 간결하게 쓴다. `vendor_id`에는 vendor F 번호, `origin`에는 MoSCoW·난이도·FR/NFR 출처를 남긴다. 등록 단계는 이를 WI의 `description`(추가 설명)으로 옮긴다.

## 5. JSON 저장과 보고

후보 파일을 `docs/feature-candidates/<prd-base>.features.json`에 저장한다. PRD 파일명이 `.prd.md`이면 그 접미사를 제거해 `<prd-base>`를 만든다. 다른 `.md` 파일은 마지막 `.md`만 제거한다. 예: `docs/prd/sample.prd.md` → `docs/feature-candidates/sample.features.json`.

### 후보 JSON 계약 (`schema_version: 2`)

```json
{
  "schema_version": 2,
  "source_prd": "docs/prd/sample.prd.md",
  "review": "docs/prd/sample.prd.review.md",
  "features": [
    {
      "key": "G-001",
      "target": {
        "mode": "create",
        "title": "Google Docs 원본 연결·선택",
        "goal": "기존 문서를 찾아 분석에 활용할 수 있다.",
        "priority": "high"
      },
      "work_items": [
        {
          "vendor_id": "F6",
          "title": "문서 검색·선택·내용 읽기",
          "goal": "선택한 문서 내용을 분석에 사용한다.",
          "kind": "implementation",
          "priority": "normal",
          "acceptance_criteria": ["문서를 검색해 선택할 수 있다."],
          "notes": "읽기 권한이 없는 문서 처리 방법을 확인한다.",
          "origin": {
            "moscow": "Must",
            "complexity": "High",
            "requirements": ["FR-2", "FR-3"]
          }
        }
      ]
    },
    {
      "key": "G-002",
      "target": { "mode": "reuse", "feature_id": "FEAT-abc123" },
      "work_items": [
        {
          "vendor_id": "F8",
          "title": "기존 기능의 다음 흐름",
          "goal": "기존 Feature의 목표를 진전시킨다.",
          "kind": "implementation",
          "priority": "normal",
          "acceptance_criteria": ["다음 흐름을 확인할 수 있다."],
          "origin": {
            "moscow": "Should",
            "complexity": "Medium",
            "requirements": ["FR-4"]
          }
        }
      ]
    }
  ]
}
```

- 최상위 필드는 `schema_version`, `source_prd`(원본 PRD 경로), 선택적 `review`(검토 문서 경로), 비어 있지 않은 `features`뿐이다. `review`는 검토 문서가 있을 때만 넣는다.
- Feature 후보는 임시 `key`, `target`, 비어 있지 않은 `work_items`만 가진다. `target.mode="create"`는 `title`·`goal`·`priority`를, `target.mode="reuse"`는 `list_features()`로 확인한 기존 `feature_id`만 가진다. 기존 Feature의 목표·범위가 실질적으로 같을 때만 재사용한다. 등록 때도 ID 존재 여부를 확인한다.
- WI 후보는 `vendor_id`, `title`, `goal`, `kind`, `priority`, 비어 있지 않은 `acceptance_criteria`(완료 조건), `origin` 및 선택적 `notes`만 가진다. `origin`에는 `moscow`, `complexity`, 비어 있지 않은 `requirements`(PRD의 `FR-숫자`·`NFR-숫자` ID)를 넣는다. `kind`·`priority` 값은 4단계 규칙을 따른다.
- `key`·`vendor_id`는 후보 식별자이며 DB의 `FEAT-…`·`WI-…` ID가 아니다. WI의 부모는 소속 Feature 배열로 나타내므로 하위 WI에 `feature_id`를 반복하지 않는다. 등록 인터페이스는 `origin`과 `notes`를 WI의 `description`으로 조합하고 AC를 별도로 저장한다.
- Won't 항목은 사용자 응답에 제외 이유와 함께 보고한다. JSON에는 `excluded`, 승인 상태, 등록 결과, 생성된 DB ID를 넣지 않는다. 후보 파일을 자동 커밋하거나 등록 결과로 다시 쓰지 않는다.

저장 후 JSON을 파싱하고 다음을 확인한다: Feature `key`와 WI `vendor_id`의 유일성, `create`·`reuse` 대상 필드, 허용된 `kind`·`priority`, 모든 포함 F의 정확히 한 번 배치, PRD 요구사항 ID의 실제 존재, AC의 근거와 빈 값 여부, Won't 항목의 JSON 제외. 기존 파일을 다시 만들 때는 사용자가 수정한 후보를 덮어쓰지 않도록 먼저 내용을 비교한다.

사용자에게 JSON 경로와 상위 Feature별 하위 WI 목록·개수를 보여준다. 기존 Feature 재사용 제안은 ID와 이유를 명시한다. Won't 항목과 제외 이유, 검토 기록에서 구현 전 확인이 필요한 항목도 답변에 포함한다. 다음 DB 등록은 사용자가 후보를 검토한 후 별도 절차로 수행한다.
