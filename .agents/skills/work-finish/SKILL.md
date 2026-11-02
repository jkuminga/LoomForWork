---
name: work-finish
description: 활성 Run이 있는 프로젝트 작업의 최종 답변 전에 Postflight를 검토하고 Artifact·Evidence·기억 후보를 확인하여 올바른 outcome으로 finish_work를 호출한다.
---

# Work finish

현재 Turn에서 시작하거나 이어받은 활성 Run을 최종 답변 전에 정리한다. 완료 의미는 Codex가 판단하고 Hook에는 위임하지 않는다.

## 1. Postflight 읽기

`get_postflight_status(work_item_id)`를 호출해 다음을 확인한다.

- `running_run`: 이번에 종료할 정확한 Run
- `verification`: Acceptance Criteria의 해결 여부와 `can_complete`
- `artifacts`: 이번 Run이 남긴 검증 가능한 결과
- `pending_memory_candidates`: 아직 장기 기억으로 검토되지 않은 후보

활성 Run이 없으면 `finish_work()`를 호출하지 않는다. 예상한 Run과 반환된 `running_run.id`가 다르면 종료하지 않고 충돌을 보고한다.

## 2. 도구 기록 검토와 계획 저장

`list_run_tool_events(run_id)`로 EVT(한 번의 도구 실행 기록) 전체와 `snapshot_max_seq`(이번 검토의 마지막 순번)를 함께 받는다. 목록의 `total_count`와 수신한 항목 수를 확인한다. 메인 Codex가 작업 맥락과 목록을 함께 검토하며 단순 조회·중간 확인은 빠르게 제외하고, 실제 수정·테스트·빌드·커밋 및 중요한 조사 결과를 판단한다. 별도 서브에이전트는 사용하지 않는다.

모든 EVT를 `artifact_evidence`(결과와 AC 근거), `artifact_only`(결과만), `exclude`(제외)로 분류한다. 새 계획은 `schema_version=2`, `run_id`, `work_item_id`, `snapshot_max_seq`, `decisions`, `excluded_event_ids` 형식으로 `save_review_plan(run_id, plan)`에 저장한다. `decisions`에는 등록할 EVT만 `event_id/decision/reason/artifact/evidence`로 기록하고, 제외할 EVT는 `excluded_event_ids`에 ID만 넣는다. Artifact에는 `kind/verification_status/summary/uri`, Evidence에는 `criterion_id/result/note/reason`을 넣는다. 두 목록의 합집합이 스냅샷의 모든 EVT를 정확히 한 번씩 포함해야 한다. 도구가 파일 형식·Run/WI 소속·AC 연결·전체 포함 여부를 검증한다.

기존 계획은 `get_review_plan()`으로 읽어 재사용한다. 누락된 목록·저장 실패·손상된 JSON은 원인을 알리고 계획 없이 A/E 등록을 시작하지 않는다. JSON은 최초 목록의 스냅샷 경계로 고정하며, 이후 EVT를 추가해 재생성하지 않는다.

계획을 확보하지 못한 경우 기억 후보 처리는 가능한 범위에서 수행하고, 계획 적용·검토 마감 단계를 생략해 `interrupted`로 종료한다. 원래 EVT 요약은 복구를 위해 보존한다.

## 3. 계획 적용

`decisions`의 각 항목에 대해 기존 Artifact를 원본 EVT ID인 `source_event_id`로 대조한다. 이미 저장된 결과는 재사용하고, 누락된 Artifact만 `record_artifact()`로 등록한다. 필요한 Evidence(Artifact와 AC를 연결하는 근거)는 `verify_criterion()`으로 연결·판정한다. 이 도구는 Evidence와 AC 상태를 한 DB 트랜잭션으로 처리한다. `excluded_event_ids` 항목은 A/E를 생성하지 않는다. 기존 v1 계획을 재사용할 때는 그 파일의 `events` 형식을 따른다.

`pending` Artifact의 결과가 확정됐다면 `resolve_artifact()`로 결과를 반영한다. 실제로 실패한 결과를 성공 근거로 사용하거나 AC를 사후 왜곡하지 않는다. 부분 실패가 있으면 성공분을 보존하고 다음 단계 후 최종 재시도에서 누락분만 처리한다.

현재 Run의 EVT 저장 실패 알림이 컨텍스트에 있으면, 해당 도구 결과도 Artifact·Evidence 등록 검토에 포함한다. 저장되지 않은 EVT에는 `source_event_id`를 넣지 않으며, Run 소속을 확인할 수 없는 알림을 임의 연결하지 않는다.

## 4. 기억 후보 확인

`pending_memory_candidates`가 있으면 후보마다 `$memory-finalize` 스킬을 실행한다. 저장 가치·노드 타입·중복·관계 판단과 `finalize_memory_candidate()` 호출은 해당 스킬에 맡긴다. 후보의 최종 상태는 finalize 내부 처리로만 변경한다.

pending 후보가 남아도 Run 종료는 계속 진행한다. 남은 후보 수와 처리 실패 원인은 최종 답변에서 알린다. 후보는 pending 상태로 보존한다.

## 5. 최종 검토와 최대 1회 재시도

`get_postflight_status(work_item_id)`를 다시 호출해 AC·Artifact·Run의 실제 상태를 확인한다. `finalize_review_plan(run_id)`으로 계획대로 A/E가 저장된 EVT와 제외 EVT의 `reviewed_at` 기록·입력/결과 요약 제거를 원자적으로 수행한다. `run_seq > snapshot_max_seq`인 후속 마감 도구 기록도 별도 A/E 추론 없이 마감한다. 경계 안의 누락 EVT는 자동 완료 처리하지 않는다.

`get_run_review_status(run_id)`의 미검토·불일치 ID와 처리 오류를 확인한다. 남아 있으면 JSON과 실제 DB 결과를 대조하고 수정 가능한 오류를 바로잡은 뒤, 누락된 A/E 또는 검토 트랜잭션만 **최대 1회** 재시도한다. 재시도 후 상태를 다시 읽으며 새로운 A/E 후보를 추론하거나 JSON을 재작성하지 않는다. 검토 트랜잭션이 실패해 `ae_complete`를 받지 못했다면 `get_run_review_context()`로 계획의 A/E 저장 여부를 대조한다.

계획된 A/E 등록이 끝내 실패하면 `interrupted`로 종료한다. A/E가 모두 저장됐고 검토 완료 표시만 실패했다면 Run은 `progressed`로 종료할 수 있다. 미검토 ID·실패 이유·보존된 JSON 및 같은 WI를 다음 `w/`에서 빠르게 재선택해 복구할 필요성을 사용자에게 알린다.

## 6. Outcome 선택

다음 중 실제 상태와 일치하는 하나만 선택한다.

| outcome | 의미 | 필수 입력 |
| --- | --- | --- |
| `progressed` | 이번 Run이 성공했고 WorkItem은 계속 선택 가능한 `ready`로 돌아감 | `summary`, `reason`, 아래 규칙에 따른 완료 권장값 또는 `next_action` |
| `retry_needed` | 구현이나 검증이 실패하여 다음 Run에서 다시 수행해야 함 | `summary`, `reason`, `termination_reason`, 구체적인 `next_action` |
| `blocked` | 외부 결정·권한·환경 때문에 진행할 수 없음 | `summary`, `reason`, `termination_reason`, `block_reason`, 해제 후의 `next_action` |
| `interrupted` | 작업이 중간에 멈췄지만 다시 시작할 수 있음 | `summary`, `reason`, `termination_reason`, 구체적인 `next_action` |
| `cancelled` | WorkItem 자체를 더 수행하지 않기로 확정함 | `summary`, `reason`, `termination_reason` |

성공한 Run은 모두 `progressed`를 선택한다.

- 재조회한 `can_complete`가 `true`이면 `completion_recommended=true`를 전달하고 `next_action`은 생략한다. 상태 저장 함수가 고정된 사용자 완료 권장 문구를 저장한다.
- `can_complete`가 `false`이고 정상적인 후속 작업이 남았다면 `completion_recommended=false`와 구체적인 `next_action`을 전달한다.
- 구현·검증 실패나 외부 차단이면 성공으로 처리하지 않고 실제 상태에 맞는 outcome을 선택한다.

Codex는 Run 종료 과정에서 WI를 `done`으로 바꾸지 않는다. WI 완료는 웹 콘솔 또는 사용자의 명시적 완료 요청에서 별도로 수행된다.

## 7. Run 종료와 파일 정리

선택한 값으로 `finish_work(run_id, outcome, ...)`를 한 번 호출한다.

- 성공 응답에서 Run과 WorkItem의 종료 상태를 확인한다.
- 실패하면 같은 호출을 추측으로 반복하거나 완료했다고 보고하지 않는다. 현재 Postflight 상태와 실패 원인을 사용자에게 알린다.
- 성공 직후의 전용 PostToolUse가 현재 세션 Runtime Binding을 삭제한다. 스킬이 Binding 파일을 직접 지우지 않는다.

`finish_work()`가 성공하고 모든 EVT의 검토·요약 제거도 끝났으면 `delete_review_plan(run_id)`을 호출한다. 이 도구는 활성 Run 없이도 종료 상태와 완전한 마감을 검증한다. 미검토가 남았거나 종료 함수가 실패하면 JSON을 보존한다. 파일 삭제 실패는 알리고, 다음 UPS의 고아 JSON 정리에 맡긴다.

최종 답변에는 수행 결과, 검증 결과, 남은 작업 또는 경고를 간단히 전달한다.
