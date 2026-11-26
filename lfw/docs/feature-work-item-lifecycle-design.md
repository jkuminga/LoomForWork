# Feature와 WorkItem 연결·상태 설계

## 범위와 현재 동작

이 문서는 `WI-f92e99103f9c`의 세 목표와 Feature 완료 정책을 설계한다. Feature는 여러 WorkItem(WI, 개별 작업)을 묶는 목표이며, `feature_id`는 WI가 속한 Feature를 가리키는 DB 필드다. `status`는 각각의 현재 상태다.

- 기존 WI 편집 화면과 `PATCH /api/work-items/{id}`에는 `feature_id` 변경 항목이 없다. 새 Draft 생성만 Feature를 선택할 수 있다.
- 새 Draft의 Feature 선택 팝업은 `/api/features`의 전체 목록을 보여 준다. 새 Draft 저장은 대상 Feature의 존재만 확인한다.
- `change_feature_status()`는 WI 상태와 무관하게 Feature 상태를 바꾼다. `feature_progress` 뷰는 취소 WI를 분모에서 제외해 진행률을 계산한다.
- 2026-11-26 설계 시점의 `배포` Feature는 `completed`이지만, 취소 WI를 제외한 완료율은 2/4다. 연결된 WI 5개 중 `done` 2개, `cancelled` 1개, 미완료 2개다.

## 현재 구현 범위

이번 구현은 기존 Draft·backlog·ready WI의 Feature 연결과 새 Draft 선택 목록에서 취소 Feature를 제외하는 두 항목으로 한정한다. 현재 구현은 새 연결에서 취소 Feature만 거부하며 completed Feature 연결은 허용한다. 완료 Feature 재사용 정책, 자식 WI 상태에 따른 부모 Feature 자동 전이, Feature 완료 정책은 이 문서의 설계 제안으로만 남아 있으며 이번 구현에는 포함하지 않는다.

## 권고 정책

| 목표 | 정책 | 구현 경계 |
| --- | --- | --- |
| 기존 WI의 Feature 연결 | Draft·backlog·ready WI에서 Feature 연결·변경·해제를 허용한다. 대상 Feature는 `planned`·`active`·`paused`만 허용한다. 실행 중 또는 종료된 WI의 연결 변경은 별도 결정 전까지 막는다. | 웹 편집 화면과 Feature 선택 팝업, `PATCH /api/work-items/{id}/feature`, 상태 저장소의 원자적 연결 변경 함수 |
| 새 Draft의 선택 목록 | `cancelled` Feature를 선택 목록에서 제외한다. 서버도 취소된 Feature 연결을 거부해 직접 API 요청으로 우회할 수 없게 한다. 이미 연결된 과거 항목은 조회 가능하게 유지한다. | `loadDraftFeatures()` 필터, Draft 생성·기존 WI 연결의 공통 대상 검증 |
| 준비 중 Feature의 자동 활성화 | `planned` Feature에 연결된 WI가 `ready`가 되거나 기존 `ready` WI를 연결하면 같은 DB 트랜잭션에서 Feature를 `active`로 바꾼다. 사용자가 정한 `paused`·`completed`·`cancelled`는 자동으로 뒤집지 않는다. | Draft 구체화, WI의 `ready` 전이와 Run 종료, 기존 WI 연결의 공통 상태 저장소 헬퍼 |
| Feature 완료 제한 | 완료는 사용자 결정으로 유지하되, 취소를 제외한 WI가 **1개 이상**이고 그 WI가 **모두 `done`**일 때만 `completed` 전환을 허용한다. 2/4는 거부한다. | `change_feature_status()`의 트랜잭션 내부 검증, API의 409 오류, 화면의 잔여 WI 안내 |

`feature_progress`의 `total_work_items`는 전체 연결 WI 수, `cancelled_count`는 취소 WI 수, `done_count`는 완료 WI 수다. 완료 가능 조건은 `total_work_items - cancelled_count > 0`이고 `done_count == total_work_items - cancelled_count`다. WI가 없거나 모두 취소됐다면 Feature 완료 대신 WI를 추가하거나 Feature 취소를 선택한다. 자동으로 `completed`로 전환하지 않는 이유는 WI 완료와 Feature 목표 달성을 사용자가 마지막으로 확인해야 하기 때문이다.

## 상태 전이와 예외

1. 기존 WI의 연결 변경은 상태 저장소에서 WI 상태·대상 Feature 존재·대상 상태를 한 트랜잭션으로 검사하고 `feature_id`를 갱신한다. 연결 해제는 `null`로 저장한다. 변경 전후 Feature의 계산 진행률은 DB 뷰가 반영하며, 연결 변경 이력은 State Event(상태 변경 감사 기록)에 남긴다.
2. `ready` WI를 `planned` Feature에 연결하거나 연결된 WI가 `ready`로 전이할 때만 자동 활성화한다. 해당 Feature 상태 변경도 같은 트랜잭션의 State Event에 남긴다. `paused`는 수동 재개를 기다린다.
3. 완료된 Feature에 새 미완료 WI를 붙이려면 사용자가 먼저 Feature를 `active`로 다시 열어야 한다. `cancelled` Feature의 재사용도 먼저 명시적인 재개가 필요하다. Feature 상태를 바꾸는 API가 최종 권한을 갖고, 화면의 비활성화·안내는 보조 수단으로 둔다.
4. 완료 제한을 도입하기 전에 이미 `completed`인 불일치 Feature는 자동 변경하지 않는다. `배포`처럼 미완료 WI가 있는 항목을 조회 화면에 표시하고, 사용자가 `active`로 다시 열어 남은 WI를 처리하도록 안내한다.
5. 완료 판정과 상태 변경은 같은 DB 트랜잭션에서 수행한다. 다른 요청이 WI를 연결하거나 상태를 바꾸는 사이에 오래된 화면 진행률만으로 완료를 허용하지 않는다.

## 구현 순서와 확인 항목

1. 상태 저장소에 Feature 연결 대상 검증, 기존 WI 연결 변경, `ready` 전이 시 자동 활성화, Feature 완료 가드를 추가한다. 모든 경로에서 같은 규칙을 재사용하도록 상태 변경 함수를 정리한다.
2. 웹 API에 기존 WI의 Feature 연결·해제 경로를 추가하고, Draft 생성 및 Feature 상태 변경 오류를 사용자에게 읽을 수 있는 메시지로 전달한다.
3. 기존 WI 편집 화면에 Feature 선택을 넣고 Draft 팝업의 선택 가능 목록을 공통 규칙과 맞춘다. Feature 상세 화면은 완료 불가 이유와 과거 완료 불일치를 보여 준다.
4. 검증 시나리오: Draft·backlog·ready 연결/해제, 실행 중 WI 수정 거부, cancelled·completed Feature 선택 거부, 각 `ready` 진입 경로의 `planned → active`, `paused` 보존, 2/4 완료 거부, 4/4 완료 허용, WI 0개·전부 취소된 Feature의 완료 거부, 기존 `배포`의 불일치 표시를 확인한다.

## 코드 위치

- `src/harness/control_center/static/app.js`: Draft Feature 팝업과 기존 WI 편집 UI.
- `src/harness/control_center/static/features.js`: Feature 진행률, 상태 선택, 상세 화면.
- `src/harness/control_center/work_items_api.py`, `features_api.py`: 웹 API 입력·오류 경계.
- `src/harness/state_store.py`: Feature/WI 상태 변경과 감사 기록의 정본.
- `schema.sql`의 `feature_progress`: WI 상태별 개수와 완료율을 계산하는 DB 뷰.
