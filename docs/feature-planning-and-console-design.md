# 문서 기반 Feature·WorkItem 계획 및 웹 콘솔 설계

## 결정사항

- 이 흐름은 사용자가 PRD·MVP 등 지정한 문서에서 작업 목록 생성을 요청할 때만 실행한다. 첫 버전의 입력은 저장소 안의 Markdown(`.md`) 문서로 한정한다.
- `vendor/ai-prd-workflow/skills/extract-features`의 기능 추출 결과를 출발점으로 삼는다. 예시 PRD에서는 Must 19개와 Won't 6개가 나왔다. 이 개수는 예시 결과이며 다른 문서에 적용하는 고정 규칙이 아니다.
- 같은 사용자 결과와 작업 흐름을 완성하는 vendor 기능 항목만 한 단계 큰 Feature로 묶는다. 서비스별 권한·데이터·실패 흐름이 독립적이면 분리하고, 작은 메뉴·버튼은 그것이 여는 흐름에 합친다. 이번 버전에 포함하는 각 F의 세부 내용은 일반 `backlog` WorkItem(`is_draft=false`) 후보 하나로 보존한다. 큰 WI는 여러 Run에 걸쳐 진행하며 생성 단계에서 일괄 분할하지 않는다. Won't 항목은 사용자 응답에만 명시하고 후보 JSON·DB에는 넣지 않는다.
- WI `kind`(작업 종류)는 제품 기능이면 `implementation`을 기본으로 하고, 산출물이 조사·결정·검증 자체일 때만 각각 `research`·`decision`·`verification`으로 정한다. WI `priority`(작업 우선순위)는 vendor의 MoSCoW와 별도로 판단한다. 기본 `normal`, 선행 조건·핵심 흐름 차단은 `high`, 뒤로 미룰 수 있는 항목은 `low`, 명시적으로 긴급한 항목만 `urgent`다. 새 Feature의 우선순위는 하위 WI의 최고 우선순위를 기본으로 한다.
- 일반 backlog WI에는 상위 `feature_id`(소속 Feature ID), 목표, 우선순위, AC(완료 조건)를 저장한다. vendor의 F 번호, `Source`(PRD 요구사항 출처), `Complexity`(추정 구현 난이도)는 WI의 `description`(추가 설명)에 기록한다. 별도 DB 컬럼은 추가하지 않는다. 난이도를 다른 WI와 같은 척도로 정렬·필터링하지 않는다.
- 후보 생성과 DB 등록은 별도 단계다. 후보 생성 시 읽기 전용 `list_features`(기존 Feature 목록 조회)로 현재 항목과 비교하고, 사용자에게 Feature와 하위 WI 후보를 보여준다. 후보 생성 스킬은 DB에 Feature·WI를 등록하지 않는다.
- 후보 파일은 `docs/feature-candidates/<문서이름>.features.json`에 저장한다. 문서 근거는 후보 검토에 사용하되 Feature DB의 별도 출처 필드에 저장했다고 주장하지 않는다. 후보 파일은 자동 커밋하거나 등록 결과로 다시 쓰지 않는다.
- 사용자가 후보를 검토한 뒤 별도 등록 인터페이스가 승인된 Feature와 하위 backlog WI를 저장한다. 저장 결과는 성공한 DB ID와 실패한 항목을 보고한다. 등록 과정에서 자동 재시도나 자동 중복 제거를 하지 않는다.
- `w/` 선택기에서는 일반 backlog WI도 접근할 수 있어야 한다. 선택한 일반 backlog는 `$work-start`가 이번 요청과 WI의 목표·AC를 바탕으로 `next_action`(다음 행동)을 정하고 `ready`로 바꾼 뒤 Run을 시작한다. 웹 콘솔에서 사용자가 직접 `next_action`을 채워 상태를 바꾸는 흐름은 필수로 두지 않는다.
- 실제 프로젝트 DB에 검증만을 위한 가상 WI를 만들지 않는다. Feature·WI 연결과 진행률 시험은 임시 테스트 DB에서 수행한다.

## 후보 JSON 계약 (schema_version 2)

```json
{
  "schema_version": 2,
  "source_prd": "docs/prd/example2.prd.md",
  "review": "docs/prd/example2.prd.review.md",
  "features": [
    {
      "key": "G-001",
      "target": {
        "mode": "create",
        "title": "Google Docs 원본 연결·선택",
        "goal": "사용자가 기존 Docs 문서를 찾아 분석에 활용할 수 있다.",
        "priority": "high"
      },
      "work_items": [
        {
          "vendor_id": "F6",
          "title": "Docs 문서 검색·선택·내용 읽기",
          "goal": "선택한 Docs 문서의 내용을 공고 분석에 사용한다.",
          "kind": "implementation",
          "priority": "normal",
          "acceptance_criteria": [
            "기존 Docs 문서를 검색해 선택할 수 있다.",
            "선택한 문서 내용을 공고 분석에 사용할 수 있다."
          ],
          "notes": "읽기 권한이 없는 문서의 처리 방법을 확인한다.",
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
      "target": {
        "mode": "reuse",
        "feature_id": "FEAT-abc123"
      },
      "work_items": [
        {
          "vendor_id": "F8",
          "title": "Figma 폴더 탐색·링크 선택·내용 읽기",
          "goal": "선택한 Figma 파일의 내용을 공고 분석에 사용한다.",
          "kind": "implementation",
          "priority": "normal",
          "acceptance_criteria": [
            "접근 가능한 파일을 폴더 또는 링크로 선택하고 내용을 읽을 수 있다."
          ],
          "origin": {
            "moscow": "Must",
            "complexity": "High",
            "requirements": ["FR-2", "FR-3"]
          }
        }
      ]
    }
  ]
}
```

- `source_prd`는 원본 PRD 경로이고 `review`는 검토 기록이 있을 때만 넣는다. Feature는 하나 이상의 하위 WI 후보를 가진다.
- `key`와 `vendor_id`는 후보 식별자이며 DB의 `FEAT-…`·`WI-…` ID와 다르다. 하위 WI는 소속 Feature 안에 넣으므로 별도 `feature_id`를 반복하지 않는다.
- `target.mode=create`에는 새 Feature의 `title`·`goal`·`priority`를 넣는다. `target.mode=reuse`에는 `list_features`에서 확인한 기존 `feature_id`만 넣으며, 기존 Feature의 속성을 변경하지 않는다. 제목이 비슷하다는 이유만으로 재사용하지 않고 목표·범위가 일치하는지 검토해 사용자에게 보여준다. 등록 시에도 해당 ID가 존재하는지 확인한다.
- `origin`은 vendor의 우선순위·난이도·PRD 요구사항 출처를 보존한다. 등록 인터페이스는 `origin`과 선택적 `notes`를 WI의 `description`으로 조합하고, `acceptance_criteria`는 AC로 저장한다.
- `kind`·`priority`는 등록에 필요한 필드다. 위 값은 형식 예시이며 vendor 값에서 변환하는 규칙은 구현 항목 2번에서 결정한다.
- Won't 항목은 후보 JSON에서 생략한다. 후보 생성 시 사용자 응답에 제외 항목과 이유를 알리고 DB에는 등록하지 않는다. 승인·등록 결과 필드도 JSON에 추가하지 않는다.

## 다음에 결정할 사항

- **준비 전이:** 선택된 일반 backlog에 이미 `next_action`이 있을 때 재사용·수정할 기준과, 값이 없을 때 이번 요청에서 작성하는 기준을 정한다. `change_work_item_state()`(WI 상태 변경 도구)에 `ready`와 비어 있지 않은 `next_action`을 함께 전달해야 한다.
- **부분 저장 실패:** Feature 저장 후 일부 WI 등록이 실패한 경우 성공한 ID를 어떻게 알려주고 실패 항목만 재시도할지 정한다. 후보 JSON에 등록 상태를 기입하지 않는 기존 결정을 유지한다.

## 구현 항목

- [x] 외부 문서 기반 기능 추출 스킬을 조사하고 `extract-features`의 출력 규모를 예시 PRD로 확인한다.
- [x] 읽기 전용 `list_features` MCP 도구를 추가하고 PostToolUse 기록 제외 여부를 검토한다.
- [x] **1. 후보 JSON 스키마를 개정한다.** 새 Feature 생성·기존 Feature 재사용과 하위 backlog WI의 관계, AC, vendor 세부 정보의 저장 위치를 정하고 Won't 항목은 JSON에서 제외한다.
- [x] **2. 기능 추출 스킬을 수정한다.** vendor 원본은 유지하고 `.agents/skills/extract-features/SKILL.md`를 하네스용으로 승격했다. Feature 범주화·WI `kind`와 `priority`·JSON 출력 규칙을 정하고 임시 `$feature-from-document`를 제거했다. 예시 PRD 후보 `docs/feature-candidates/example2.features.json`에서 Feature 7개·WI 19개와 요구사항 14개의 연결을 확인했다.
- [x] **3. WI 생성 입력을 확장한다.** `create_work_item()`(일반 backlog WI 생성 도구)에 기존 DB의 `description` 필드를 입력받도록 연결한다.
- [x] **4. 등록 인터페이스를 구현한다.** `python -m src.harness.feature_registration <후보 JSON>`으로 승인된 후보를 등록한다. `target.mode=create`면 Feature를 생성하고 `reuse`면 기존 ID를 확인한 뒤 하위 WI를 일반 backlog와 AC로 저장한다. `origin`과 `notes`는 WI의 `description`에 보존한다. 결과 JSON에 성공한 DB ID와 실패한 후보 ID·이유를 반환하고 후보 파일은 수정하지 않는다. 실패 시 결과 JSON에 `retry.message`(안내)와 `retry.command`(재실행 명령)를 포함하고, 모델이 이를 읽어 사용자에게 전달한다. 명령에는 실패한 WI에 대한 `--only F번호`와 이미 만든 상위 Feature의 `--feature-id G번호=FEAT-ID`가 포함된다. 모델의 전달은 스크립트만으로 기계적으로 강제하지 않는다. 자동 중복 제거는 하지 않는다. 임시 DB에서 부분 실패 후 출력된 명령으로 실패 WI만 재등록하는 테스트를 통과했다.
- [x] **5. `w/` 선택 흐름을 확장한다.** fzf에서 일반 backlog WI를 선택하고 `BACKLOG`로 표시하며, 정렬은 ready → 일반 backlog → draft로 둔다. `$work-start`는 직접 선택한 일반 backlog의 현재 목표·AC(완료 조건)를 확인해 필요할 때만 보강한다. `next_action`(다음 행동)은 기존 값이 이번 요청과 맞으면 재사용하고, 없거나 낡았으면 이번 요청에 맞게 작성해 `ready` 전이에 전달한다. 상태별 목록 표시 방식은 8번에 기록했다.
- [x] **6. 흐름을 검증한다.** 예시 후보 JSON을 임시 DB에 등록하면서 F19 저장 실패를 재현하고, 반환된 재시도 명령으로 F19만 복구했다. 최종 Feature 7개·일반 backlog WI 19개·AC 27개가 중복 없이 연결됐으며, ready → backlog → draft 선택 순서와 선택 결과 ID, backlog → ready → Run 시작, 잘못된 전이의 거부, Feature 진행률을 확인했다. 실제 `w/` 요청에서 모델이 목표·AC·`next_action`을 적절히 판단하는지는 사용자 확인 단계로 남긴다.
- [x] **7. 웹 콘솔 Feature 화면을 구현한다.** Feature 목록·상세, 연결된 WI와 상태별 진행률, backlog WI 표시, 상태 필터 및 WI 상세 이동을 구현했다.
- [x] **8. fzf 목록 표시 방식을 설계·구현한다.** 기본 목록은 Ready만 표시한다. `Ctrl+R`(Ready)·`Ctrl+O`(일반 Backlog)·`Ctrl+T`(Draft)로 각 상태를 독립적으로 켜고 끄며, 검색 프롬프트에 현재 표시 상태를 나타낸다. 키 입력 시 기존 요청 파일의 WI만 다시 필터링하므로 DB 재조회나 새 Run은 발생하지 않는다. 검색어와 기존 ready → backlog → draft 정렬을 유지하며, 세 상태를 모두 끈 빈 목록에서도 다시 상태를 켤 수 있다.
