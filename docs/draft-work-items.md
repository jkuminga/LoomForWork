# 웹 콘솔의 Draft와 WorkItem 관리

이 문서는 웹 콘솔에서 WorkItem(WI, 완료 조건을 가진 작업 항목)을 생성·조회·수정·상태 변경·삭제하는 현재 동작을 설명한다. DB 필드의 전체 정의는 [상태 저장소](state-store.html), MCP 도구 목록은 [상태 저장소 함수](mcp-state-store-functions.html), `w/` 선택 이후의 Run(한 번의 작업 실행) 흐름은 [단일 요청 파이프라인](single-request-pipeline.html)을 따른다.

## Draft 생성과 구체화

Draft는 실행 계획을 아직 다듬지 않은 WI다. 웹 콘솔의 새 Draft 모달에서 `title`(제목), `kind`(작업 종류), `goal`(목표)을 필수로 입력하고 `description`(추가 설명)과 `feature_id`(소속 Feature ID)는 선택적으로 입력한다. Feature 선택 버튼은 `GET /api/features`로 현재 목록을 읽어 제목·목표 설명·진행률·상태가 있는 카드 팝업을 열고, 사용자가 고른 ID를 폼에 넣는다. 연결하지 않고도 Draft를 만들 수 있다. `POST /api/draft-work-items`가 `create_draft_work_item()`을 호출해 선택한 Feature가 존재하는지 확인한 뒤 연결한다.

생성 시 DB에는 `is_draft=1`(구체화 전 표시), `status=backlog`(아직 실행 준비 전), `priority=normal`(기본 우선순위)을 저장한다. `next_action`(바로 실행할 다음 행동)과 AC(Acceptance Criteria, 검증 가능한 완료 조건)는 아직 없다. `description`의 공백 입력은 값 없음으로 처리한다. 화면의 “Draft”는 별도 DB 상태가 아니라 `status=backlog`이면서 `is_draft=1`인 WI의 표시·필터 이름이다. 필요 없어진 Draft는 구체화 없이 `cancelled`로 변경할 수 있다.

`w/`에서 Draft를 선택하면 `$work-start`가 `refine_draft_work_item()`으로 `priority`, `next_action`, AC를 저장한다. 이때 `feature_id`를 새로 전달하지 않으면 Draft 생성 때 선택한 Feature 연결을 유지하고, 명시적으로 다른 Feature ID를 전달하면 그 연결로 바꾼다. 이 함수는 한 DB 트랜잭션에서 `is_draft=0`, `status=ready`(실행 준비 완료)로 바꾼다. 구체화에 실패하면 새 Run을 시작하지 않는다. 이미 실행 준비가 된 WI를 대화에서 직접 만들라는 요청은 별도 `$work-item-create` 경로를 사용한다.

## WI 상세 패널

오른쪽 상세 패널 헤더에는 WI ID·종류, 현재 상태 pill, 수정·삭제 버튼이 있다. 상태 pill은 허용된 전이가 있을 때만 메뉴 버튼으로 동작한다. 메뉴는 hover뿐 아니라 클릭·키보드 포커스로도 열 수 있다. 제목 아래에는 상태·우선순위·Feature·생성일을 표시하고, 본문은 Overview와 Memo 탭으로 나눈다. Draft의 Overview에는 아직 실행 계획과 완료 조건을 다듬기 전이라는 안내를 보여준다.

화면은 `GET /api/work-items/{id}`가 반환하는 `capabilities`(현재 WI에 허용된 작업 정보)를 따른다. `editable_fields`는 수정 가능한 필드, `allowed_statuses`는 상태 메뉴 대상, `can_delete`와 `delete_reason`은 삭제 가능 여부와 불가 사유다. 버튼 표시만 믿지 않고 서버도 같은 규칙을 재검증한다.

## 수정·상태 변경·삭제

| 작업 | 웹 API | 현행 규칙 |
| --- | --- | --- |
| 필드 수정 | `PATCH /api/work-items/{id}` | `revise_work_item()`으로 계획 필드만 변경한다. 상태와 AC는 이 요청에서 바꾸지 않는다. |
| 상태 변경 | `PATCH /api/work-items/{id}/status` | `allowed_statuses`에 있는 대상만 허용한다. `done`은 `close_work_item()`이 완료 조건을 검증한 뒤 처리한다. |
| 삭제 | `DELETE /api/work-items/{id}` | `backlog`이고 Run 이력이 없는 WI만 `delete_backlog_work_item()`으로 삭제한다. |

`revise_work_item()`은 WI의 계획 필드를 이력을 보존하며 수정하는 DB 함수다. Draft에서는 제목·종류·목표·설명만 수정할 수 있다. 일반 `backlog`·`ready`·`blocked` WI는 여기에 우선순위와 다음 행동을 더해 수정할 수 있다. `in_progress`(Run 실행 중)에서는 제목·설명·우선순위만 수정할 수 있고, `done`·`cancelled`는 수정하지 않는다. 편집 모달은 기존 값을 채우고 허용된 필드만 보여준다.

| 현재 WI | 웹 상태 메뉴 |
| --- | --- |
| Draft | 없음. `w/` 구체화로 `ready`가 된다. |
| 일반 `backlog` | `cancelled` |
| `ready` | `done`, `cancelled` |
| `blocked` | `ready`, `cancelled` |
| `in_progress`, `done`, `cancelled` | 없음 |

웹 콘솔은 일반 `backlog → ready` 전이를 허용하지 않는다. `ready → in_progress`는 `start_work()`가 Run을 시작할 때 처리한다. `in_progress`에서 벗어나는 전이는 Run 종료 절차가 처리한다. 웹 상태 변경 API는 우회 요청도 거부한다.

삭제는 확인 모달에서 대상 WI ID를 다시 입력해야 실행된다. 삭제 시 연결된 AC와 메모를 같은 트랜잭션에서 정리하고 State Event(상태 변경 이력)를 남긴다. 실행 이력이 있는 WI는 삭제 대신 허용된 경우 `cancelled`로 변경해 이력을 보존한다.

## 목록과 오류 처리

`GET /api/work-items`는 상태·종류 필터를 지원한다. 상태 필터의 `draft`는 `backlog` + `is_draft=1`, `backlog`는 `backlog` + `is_draft=0`으로 해석한다. Draft 저장에 실패하면 입력 모달과 작성값을 유지하고 필드별 오류 또는 서버 오류를 표시한다. 저장에 성공하면 목록을 다시 읽고 생성한 WI를 선택한다. 수정 중 충돌(`409`)이 발생하면 최신 WI 정보를 다시 읽는다.
