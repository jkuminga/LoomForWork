# 최종 검토 결과

아래는 설계 검토에서 발견한 문제와 보강점이다. 문제점 1·2번과 보강안 1~4번의 이번 구현 범위는 반영했다. 문제점 3·4번의 별도 정리·폐기 세부 구조는 표시된 후속 Draft WI에서 다룬다. EVT는 한 번의 도구 사용 기록, Artifact(A)는 남길 실행 결과, Evidence(E)는 Artifact와 WI의 완료 조건(AC)을 잇는 근거다.

## 해결해야 할 문제점

1. **JSON에 없는 EVT를 곧바로 JSON 생성 이후의 기록으로 판단할 수 없다.** `list_run_tool_events()`의 목록이 누락되거나 출력 중 잘리면 생성 이전 EVT도 JSON에 없게 된다. 이를 무검토 완료 처리하지 않도록 DB 조회 시점의 스냅샷 경계(예: 증가하는 이벤트 순번)를 정의하고, 그 경계 이후의 EVT만 별도 A/E 검토 없이 마감해야 한다.

   **해결 결정(구현):** `run_tool_events`에 Run 안에서 증가하는 `run_seq`(도구 기록 순번)를 추가하고 `(run_id, run_seq)`의 중복을 금지한다. 최초 EVT 목록과 그 시점의 최대 `run_seq`를 같은 DB 조회 시점에 받아, 최대값을 Review Plan JSON의 `snapshot_max_seq`(이번 계획이 책임지는 마지막 순번)에 저장한다. JSON 저장 전과 복구 시 `run_seq <= snapshot_max_seq`인 EVT ID 전체가 JSON의 `events`에 정확히 있는지 검증한다. 경계 안쪽에서 빠진 EVT는 **누락 오류**이므로 검토 완료 처리하지 않는다. 경계 바깥의 EVT만 최초 목록 조회 이후 발생한 기록으로 보고 별도 A/E 평가 없이 마감한다. 이후의 PostToolUse 기록 자체는 막지 않는다.
2. **새 Run 이전의 복구 쓰기가 현재 PreToolUse에 막힌다.** Artifact 저장, Evidence·AC 판정과 `reviewed_at`(EVT 검토 완료 시각) 기록은 새 `start_work()` 전에 수행되어야 하지만, 일반 쓰기 MCP 도구는 활성 Run을 요구한다. 선택한 WI의 과거 미검토 Run에만 작동하는 좁은 복구 인터페이스와 허용 규칙을 정해야 한다. 범용 쓰기 도구를 일괄 허용하지 않는다.

   **해결 결정(구현):** `$work-start`의 Codex는 DB 함수를 직접 호출하지 않고 MCP 도구만 사용한다. `$work-finish`의 일반 쓰기 MCP 도구에 활성 Run 예외를 넓게 추가하지 않는다. 대신 아래의 **복구 전용 MCP 도구**만 새 `start_work()` 전에도 허용하고, 도구 내부에서 기존 DB 저장 함수를 재사용한다. 복구 쓰기 도구는 선택한 WI에 속한 과거 미검토 Run·EVT만 처리하도록 소속·중복을 검증한다.

   - 기존 MCP 도구 `get_work_context(work_item_id)`는 선택한 WI의 목표·AC를 읽는다. `start_work(work_item_id, ...)`는 모든 복구가 끝난 뒤에만 호출한다.
   - 새 읽기 MCP 도구 `list_runs_with_unreviewed_tool_events(work_item_id)`는 해당 WI에서 미검토 EVT가 있는 과거 Run 목록을 찾는다. `list_run_tool_events(run_id)`는 `$work-finish`와 공유할 새 읽기 MCP 도구로, EVT 목록과 스냅샷 경계를 제공한다.
   - JSON이 있으면 새 쓰기 MCP 도구 `recover_review_plan(work_item_id, run_id)`를 Run마다 호출한다. 도구 내부에서 JSON과 DB를 대조하고 누락된 A/E 저장, `reviewed_at` 기록·요약 제거를 처리한다.
   - JSON이 없거나 손상됐으면 새 읽기 MCP 도구 `get_run_review_context(run_id)`로 과거 EVT·Artifact·Evidence·AC를 받아 Codex가 재판단한다. 확신한 판단만 새 쓰기 MCP 도구 `apply_unplanned_review_recovery(work_item_id, run_id, decisions)`에 전달한다. 확신할 수 없는 EVT는 미검토로 남긴다.
   - `record_artifact_for_recovery()`는 **MCP 도구가 아니라 내부 DB 함수**로 만든다. 종료된 원래 Run의 EVT에 Artifact를 등록하되, 일반 `create_artifact()`의 삽입 로직을 내부적으로 공유한다. Evidence 연결·AC 판정의 단일 트랜잭션 DB 함수와 EVT 검토 완료·요약 제거 DB 함수도 일반 마감 경로와 복구 경로에서 재사용한다. Codex에는 이 DB 함수들을 직접 노출하지 않는다.

   PreToolUse에서는 위 새 **읽기 MCP 도구는 조회로**, `recover_review_plan()`·`apply_unplanned_review_recovery()`만 **복구 전용 선행 쓰기**로 분류한다. 일반 `record_artifact()`·`verify_criterion()`은 계속 활성 Run을 요구한다.
3. **미검토 EVT가 남았는데도 WI가 `done`이 될 수 있다.** A/E는 저장됐지만 검토 완료 기록에 실패한 Run을 `succeeded`로 종료할 수 있는 반면, 현재 WI 완료 검증은 미검토 EVT를 검사하지 않는다. WI가 닫히면 다음 `w/` 선택을 통한 복구 경로가 사라져 EVT 요약과 Review Plan JSON이 남을 수 있다.

   **결정(후속 처리):** 지금은 미검토 EVT를 이유로 WI의 `done` 전환을 막거나, 완료 시 검토 완료 트랜잭션을 강제하지 않는다. 복구 대상은 선택한 WI에서만 찾으므로 다른 WI의 작업 흐름에는 영향을 주지 않는다. 실제 검토 없이 `reviewed_at`을 채우지 않으며, 완료 WI에 남은 EVT 요약과 JSON의 정리·보존 정책은 Draft WI `WI-fedb142e33ed`에서 설계·구현한다. 이 항목은 현재 구현을 막지 않는다.
4. **JSON 없이 판단할 근거가 영구히 부족하면 WI가 계속 막힌다.** `$work-start`에서 Review Plan JSON이 없으면 남은 맥락·EVT 요약·DB 기록으로 복구를 시도한다. 그래도 확신할 수 없는 EVT는 미검토로 남기고 새 Run을 시작하지 않는다.

   **결정(세부 설계는 후속 처리):** 실패한 EVT ID 목록과 판단할 수 없는 이유를 사용자에게 알리고 해당 기록의 폐기 여부를 묻는다. 사용자가 **특정 EVT의 폐기를 명시적으로 요청한 경우에만** 그 항목을 폐기한다. 자동 폐기, 사용자에게 과거 작업 맥락을 다시 설명하도록 요구하는 단계, 추가 Run을 열어 과거 도구 사용을 재실행·재검증하는 단계는 이 복구 흐름에 넣지 않는다. 폐기의 정확한 DB 처리·이력 기록과 다음 요청에서의 재개 방식은 Draft WI `WI-039899c092c9`에서 설계한다.

## 보강하면 좋은 점

1. **고아 JSON 정리:** 모든 EVT의 `reviewed_at`이 채워졌어도 `finish_work()` 실패나 강제 종료로 JSON만 남을 수 있다. 현재 복구 탐색은 미검토 EVT가 있는 Run만 찾으므로 이 파일의 발견·검증·삭제 시점을 별도로 정한다.

   **해결 결정(구현):** UPS 내부 Python 함수 `cleanup_orphan_review_plans()`(마감이 끝난 Run에 남은 Review Plan 파일 정리)를 추가한다. MCP 도구로 노출하지 않으며, **기존 Run·Binding 복구 직후, picker 요청 준비 이전**에 호출한다. `$work-finish`의 정상 JSON 삭제는 유지하고, UPS가 그 단계에서 남은 파일을 정리한다.

   `.harness/review-plans/<run_id>.json`의 파일명으로 Run을 찾아 DB 상태를 확인한다. **Run이 종료 상태이고 `reviewed_at IS NULL`인 EVT가 없을 때만** 검증된 해당 JSON을 삭제한다. 실행 중인 Run, 미검토 EVT가 남은 Run, 파일 검증이나 DB 조회에 실패한 경우에는 파일을 보존한다. Binding의 존재나 WI 선택 여부로 삭제를 결정하지 않으며, EVT 재평가나 A/E 등록은 수행하지 않는다. 다른 세션의 실행 중인 Run은 기존 복구 정책과 동일하게 보호한다.

   **반영할 UPS 전체 흐름:**

   1. 프롬프트가 대소문자 구분 없이 `w/`로 시작하는지 확인한다. 해당하지 않으면 별도 처리 없이 일반 Codex 요청으로 넘긴다.
   2. DB 상태를 확인하고 현재 세션의 비정상 Run·Binding을 복구한다. 이전 턴의 활성 Run은 `interrupted`, WI는 `ready`로 변경하고 Binding을 삭제한다. 종료되었거나 사라진 Run을 가리키는 Binding은 정리하고, 같은 턴의 활성 Run은 유지한다. 다른 세션 소유 또는 소유 불명 Run은 자동 변경하지 않고 안내 정보를 모은다. 사용자가 다른 세션의 종료를 명시한 경우에는 이후 Codex가 `recover_abandoned_work()`로 중단 처리할 수 있으며, Run 이력 자체는 삭제하지 않는다. 안전한 복구가 불가능하면 picker를 열지 않고 오류를 전달한다.
   3. `cleanup_orphan_review_plans()`로 위 조건을 충족하는 고아 JSON을 정리한다.
   4. 만료된 선택 임시 파일을 정리하고, `ready` WI 및 `backlog`이면서 `is_draft=true`인 Draft WI 목록을 `.harness/selections/selection-<요청 ID>.request.json`에 저장한다. 이 경로는 일반적인 배치이며, 실제 선택 디렉터리는 상태 DB와 같은 디렉터리 아래의 `selections/`다.
   5. picker 터미널을 열어 로딩 안내와 fzf 목록을 표시한다. 사용자 선택·취소 결과를 같은 요청 ID의 `.result.json`에 저장하고 터미널을 종료한다.
   6. UPS가 요청·세션·턴 식별자, 결과 유효 시간, 선택한 WI의 목록 소속을 검증한다. 취소·시간 초과·터미널 종료도 구분한다.
   7. 해당 요청의 요청·결과 JSON과 터미널 제어용 임시 파일을 정리한다. 정상 선택 외 오류·취소 경로에서도 정리를 시도하며, `selections/` 전체를 비우지 않는다.
   8. 선택 상태, WI 식별 정보와 Draft 여부, 접두사를 제거한 사용자 요청, 복구 결과를 `<work-selection-context>`로 Codex에 전달한다. 이후 `$work-start`가 상세 컨텍스트를 조회하고 작업 시작 절차를 수행한다.

2. **중복 방지와 AC 재판정:** 설계는 EVT 하나당 Artifact 하나를 계획하지만 현재 DB 고유 인덱스는 Artifact `kind`(종류)가 다르면 같은 EVT의 중복 Artifact를 허용한다. 복구 도구의 재호출 기준을 강화하고, 이미 `passed`인 AC에 Evidence를 추가하는 경우의 단일 트랜잭션 동작도 정한다.

   **구현:** `(run_id, source_event_id)` 고유 인덱스로 EVT당 Artifact 하나를 강제한다. 같은 EVT의 동일 입력 재호출은 기존 Artifact를 반환하고 다른 내용은 충돌로 거부한다. `verify_criterion_with_evidence()` DB 함수가 Evidence 연결과 AC 판정을 원자적으로 처리하며, 이미 `passed`인 AC에는 근거만 추가하고 최종 판정·완료 시각을 유지한다. 기존 개별 DB 함수는 유지한다.
3. **과거 Run 조회 인터페이스:** 현재 `get_postflight_status()`는 실행 중인 Run의 Artifact만 반환한다. JSON이 없는 복구에서 모델이 과거 Run의 EVT·Artifact·Evidence를 비교할 수 있도록 필요한 읽기 인터페이스를 정한다. JSON이 있는 정상 복구의 DB 대조는 가능하면 복구 도구 내부에 둔다.

   **구현:** `get_run_review_context(run_id)` MCP 도구로 해당 Run의 EVT·Artifact·Evidence와 WI·AC를 같은 DB 조회 시점에 반환한다. 정상 JSON 복구에서는 `recover_review_plan()` 내부에서 대조한다.
4. **EVT 기록의 보장 수준:** 현재 PostToolUse는 DB 또는 Runtime Binding(세션과 Run의 임시 연결 정보) 오류 시 도구 사용 기록을 조용히 건너뛴다. 이 설계가 *기록된 EVT를 모두 검토*하는 것인지, *실제 모든 도구 사용을 빠짐없이 기록*하는 것인지 명확히 하고, 후자가 필요하다면 별도의 실패 감지 방안을 정한다.

   **해결 결정(구현):** 일반 도구 실행이 끝난 뒤 EVT 저장 함수의 오류 또는 Binding 검증 실패가 발생하면, PostToolUse가 이를 잡아 `hookSpecificOutput.additionalContext`(모델에게 추가로 전달할 내용)로 기록 실패 알림을 반환한다. 이미 끝난 도구 실행은 유지하고 작업을 계속한다. Harness 상태·기억 MCP 제외처럼 의도적으로 기록하지 않는 경우는 저장 실패 알림 대상이 아니다.

   알림은 `type: "tool_event_recording_failed"`, 확인 가능한 `run_id`, `tool_use_id`(원본 도구 호출 식별자), `tool_name`, 저장하려던 `input_summary`·`result_summary`, 짧은 실패 이유 `reason`을 포함한다. Run을 확인하지 못한 경우 `run_id`는 `null`로 두며 추측으로 다른 Run에 연결하지 않는다. DB가 반드시 실패 코드를 반환해야 하는 구조가 아니라, 저장 함수가 발생시킨 오류를 Hook에서 실패 정보로 변환하는 방식이다.

   `$work-finish`는 DB에서 조회한 정상 EVT 목록과 **현재 Run의 모델 컨텍스트에 남은 기록 실패 알림**을 함께 검토한다. 알림은 DB 재조회로 얻는 자료가 아니다. 해당 도구 결과가 남길 가치가 있으면 기존 Artifact·Evidence 등록 흐름으로 보완하되, 저장되지 않은 EVT를 가리키는 `source_event_id`(원본 EVT 연결)는 넣지 않는다. 알림의 존재만으로 Artifact·Evidence를 자동 등록하거나 AC를 통과시키지는 않는다.

   AGENTS.md에 별도 전역 지침은 추가하지 않고, `$work-finish` 스킬에 다음 한 줄을 추가한다.

   > 현재 Run의 EVT 저장 실패 알림이 컨텍스트에 있으면, 해당 도구 결과도 Artifact·Evidence 등록 검토에 포함한다.

   `additionalContext`는 별도 수신 지침 없이 모델 입력에 추가되지만, 이후 처리 책임은 위 스킬 지침으로 명시한다. 컨텍스트 압축이나 강제 종료로 알림이 소실될 수 있으므로 이 방식은 **기록 실패를 알리는 보완책이며, 모든 실제 도구 사용의 영구 기록을 보장하지 않는다.** 지침을 추가해도 알림 원문의 완전한 보존이 보장되지는 않는다. 별도의 영구 백업·재전송 구조는 이번 결정에 포함하지 않는다.

# Run 도구 기록과 Work-Finish 검토 설계

> 설계 및 구현 기록. 아래 체크리스트의 이번 범위는 DB·MCP·Hook·스킬에 반영했다. 후속 Draft WI로 넘긴 정리·폐기 세부 구조는 별도 작업이다. 이미 실행 중인 Codex의 새 MCP 도구 목록은 서버/세션 재시작 후 반영된다.

## 핵심 용어

- **Run Tool Event(EVT)**: `run_tool_events`에 저장된 한 번의 도구 실행 기록. PostToolUse가 모델 판단 없이 생성한다.
- **Artifact(A)**: 파일·테스트 결과·커밋처럼 Run에 남길 만한 검증 가능한 결과.
- **Evidence(E)**: Artifact가 WI의 Acceptance Criterion(AC, 완료 조건)을 뒷받침한다는 연결.
- **Review Plan(JSON)**: 한 Run의 EVT 각각을 `Artifact+Evidence` / `Artifact만` / `제외`로 분류한 마감 계획. DB 처리 결과의 정본이 아니라 재시도와 다음 턴 복구에 쓰는 판단 기록이다.
- **`reviewed_at`**: EVT의 마감 처리가 완료된 시각. `NULL`이면 해당 EVT의 마감 처리가 끝났다고 확인할 수 없다. 입력·결과 요약의 존재 여부로 완료를 추측하지 않는다.

## 구현 체크리스트

- [x] `run_tool_events`에 Run별 증가 순번 `run_seq`와 `(run_id, run_seq)` 고유 제약을 추가하고 기존 행을 이행한다. `list_run_tool_events(run_id)` MCP 도구가 EVT 목록과 같은 DB 조회 시점의 `snapshot_max_seq`를 반환한다.
- [x] PostToolUse의 단순 조회 명령 제외 규칙을 제거한다. 일반 도구는 읽기·조회를 포함해 기록하고, Harness 상태·기억 MCP 도구의 제외 규칙은 유지한다.
- [x] `run_tool_events.review_status`를 nullable `reviewed_at`으로 교체한다. 도구 실행 결과인 `status`는 유지한다.
- [x] EVT ID 목록의 `reviewed_at` 기록과 `input_summary`·`result_summary` 제거를 한 DB 트랜잭션으로 처리하는 함수를 만든다.
- [x] 아래 JSON 계약과 네 가지 검증 규칙에 맞춰 Run별 Review Plan을 `.harness/review-plans/<run_id>.json`에 원자적으로 저장·읽기·삭제한다. 로컬 전용 파일은 Git에서 제외한다.
- [x] `$work-finish`에 EVT 목록 전체의 분류, JSON 저장, 계획에 따른 A/E 등록, 최종 미검토 확인 및 최대 1회 재시도, Run 종료 후 조건부 JSON 삭제를 추가한다.
- [x] `verify_criterion()`이 수행하는 Evidence 연결과 AC 상태 변경을 하나의 DB 트랜잭션으로 묶는 새 DB 함수를 만든다. 기존 개별 DB 함수는 유지한다.
- [x] A/E 등록 완료 여부에 따라 미검토가 남은 Run의 `succeeded`/`interrupted` 종료를 구분하고, 항목 ID·실패 이유·다음 복구 행동을 사용자에게 알린다.
- [x] 선택한 WI의 과거 Run에 미검토 EVT가 있으면 `$work-start`에서 새 `start_work()`보다 먼저 복구한다. 읽기 MCP 도구 `list_runs_with_unreviewed_tool_events()`와 JSON용 쓰기 MCP 도구 `recover_review_plan()`을 추가한다.
- [x] JSON이 없거나 읽을 수 없을 때를 위해 읽기 MCP 도구 `get_run_review_context()`와 Codex의 확실한 판단만 적용하는 쓰기 MCP 도구 `apply_unplanned_review_recovery()`를 추가하고 `$work-start` 예외 지침을 적용한다. 근거가 모자란 항목은 미검토로 남겨 보고한다.
- [x] `record_artifact_for_recovery()`는 MCP가 아닌 내부 DB 함수로 구현하고 일반 Artifact 삽입 로직을 공유한다. 복구 MCP 도구에만 Run 이전 쓰기 허용을 추가하며, 일반 `record_artifact()`·`verify_criterion()`의 활성 Run 제약은 유지한다.
- [x] 중복 호출, A/E 일부 성공, 검토 트랜잭션 실패, `finish_work()` 실패, JSON 손상·누락, 비정상 종료, 긴 목록과 민감정보 보존을 테스트한다.

## 확정된 Review Plan JSON 계약

Run 하나에 JSON 파일 하나를 만든다. `events`에는 최초 EVT 목록 조회 시점까지의 EVT를 하나씩 넣고, 각 EVT에서 Artifact는 최대 하나만 계획한다. `snapshot_max_seq`는 그 조회 시점에 확인한 해당 Run의 최대 `run_seq`다(기록이 없으면 `0`). `Artifact만` 분류는 지금 제거하지 않고 실제 사용 경험을 본 뒤 별도 WI에서 필요성을 재검토한다. 한 Artifact가 여러 AC(완료 조건)의 근거가 될 수 있으므로 `evidence`는 배열이다. Artifact의 `uri`(참조 위치)는 선택값이다.

```json
{
  "schema_version": 1,
  "run_id": "RUN-A",
  "work_item_id": "WI-123",
  "snapshot_max_seq": 3,
  "events": [
    {
      "event_id": "EVT-1",
      "decision": "artifact_evidence",
      "reason": "테스트 결과가 완료 조건을 검증함",
      "artifact": {
        "kind": "test_run",
        "verification_status": "passed",
        "summary": "관련 테스트 42개 통과",
        "uri": null
      },
      "evidence": [
        {
          "criterion_id": "AC-1",
          "result": "passed",
          "note": "관련 테스트 통과",
          "reason": "완료 조건 검증 성공"
        }
      ]
    },
    {
      "event_id": "EVT-2",
      "decision": "artifact_only",
      "reason": "남길 만한 결과지만 특정 AC의 근거는 아님",
      "artifact": {
        "kind": "commit",
        "verification_status": "passed",
        "summary": "변경사항 커밋",
        "uri": "abc123"
      },
      "evidence": []
    },
    {
      "event_id": "EVT-3",
      "decision": "exclude",
      "reason": "중간 상태 조회",
      "artifact": null,
      "evidence": []
    }
  ]
}
```

`schema_version`은 파일 형식 버전, `snapshot_max_seq`는 이번 계획이 책임질 마지막 EVT 순번, `event_id`는 원본 도구 사용 기록 ID, `decision`은 세 가지 분류다. `artifact`에는 `record_artifact()`에 필요한 결과를, `evidence`에는 `verify_criterion()`에 필요한 AC ID·판정·설명을 담는다. `artifact_id`, `reviewed_at`, 저장 성공 여부와 원본 도구 입출력은 넣지 않는다. JSON은 처음 저장한 뒤 수정·재생성하지 않으며, 실제 성공 여부는 DB에서 확인하고 모든 처리가 끝나면 파일을 삭제한다.

파일을 저장할 때와 다시 읽을 때 다음 네 가지를 검증한다.

1. **형식:** 지원하는 `schema_version`인지, 필수 필드의 타입·값이 올바른지, EVT ID가 중복되지 않았는지 확인한다. `exclude`는 `artifact: null`과 빈 `evidence`, `artifact_only`는 Artifact와 빈 `evidence`, `artifact_evidence`는 Artifact와 하나 이상의 Evidence를 요구한다.
2. **주인:** 파일명 `<run_id>.json`의 ID와 본문 `run_id`가 같고, JSON의 각 EVT가 실제 그 Run에 속하는지 확인한다. `work_item_id`도 해당 Run의 WI와 일치해야 한다.
3. **연결 대상:** Evidence의 각 AC가 해당 WI에 속하는지 확인한다. Artifact의 `kind`·`verification_status`·선택적 `uri`와 Evidence의 `result`도 현재 DB 함수의 허용값·규칙을 따른다.
4. **스냅샷 범위:** `snapshot_max_seq`가 음이 아닌 정수인지 확인하고, 해당 Run의 `run_seq <= snapshot_max_seq`인 DB EVT ID 집합과 JSON의 `event_id` 집합이 정확히 같은지 검증한다. 경계 밖의 EVT는 JSON에 포함하지 않는다. 파일 게시 전과 복구 시 모두 검사한다.

넷 중 하나라도 실패하면 그 파일을 근거로 DB에 저장하거나 경계 안쪽 EVT를 검토 완료 처리하지 않는다. **해당 Run의 모든 EVT를 JSON과 대조하지는 않는다.** 경계 이후(`run_seq > snapshot_max_seq`)의 EVT가 계획에 없는 것은 정상이며, 마감 시 별도로 완료 표시한다.

파일명에 사용할 Run ID는 안전한 식별자로 검증한다. 저장 디렉터리는 소유자 전용 권한으로 만들고, 같은 디렉터리의 임시 파일에 기록한 뒤 원자적으로 게시한다. 기존 계획이 있으면 덮어쓰지 않고 읽어 검증한다. 파일은 `.gitignore`에 넣는다. 민감정보에 대한 별도 필터나 추가 보존 제한은 이번 설계에서 다루지 않고, 기존의 로컬 임시 저장 허용 방침을 유지한다.

## 복구 구현 규칙

`review_plans.py`가 파일 검증·복구를 모으고, SQL·트랜잭션은 `state_store.py`에 둔다. 정상 마감용 `save_review_plan()`·`get_review_plan()`·`finalize_review_plan()`·`get_run_review_status()`·`delete_review_plan()` MCP 도구를 제공한다. 검토 완료·요약 제거는 공용 DB 함수 `mark_tool_events_reviewed()`가 담당한다. 종료 후 파일 삭제를 위해 `delete_review_plan()`도 종료 상태·전체 마감 검증을 갖춘 좁은 Bootstrap 예외로 둔다.

정상 복구는 선택한 WI가 `ready`이고 활성 Run이 없는지, 원래 Run이 종료됐고 해당 WI 소속인지 확인한 뒤 수행한다. Artifact는 원본 `source_event_id`, Evidence는 `(criterion_id, artifact_id)`로 기존 결과를 찾아 재사용한다. 항목별 A/E 저장 결과는 `results` 배열의 EVT ID·`applied`/`failed`·실패 이유로 반환한다. 성공분만 검토 완료·요약 제거를 수행하고, 후속 순번의 EVT도 마감한다. 필요한 A/E와 검토 완료가 모두 확인되면 JSON을 삭제한다. 부분 실패는 JSON과 미검토 요약을 유지하며, 검토 트랜잭션 실패는 `acknowledgement_error`로 구분한다. 이미 복구·삭제된 계획의 재호출은 미검토가 없음을 확인한 뒤 완료 결과를 반환한다.

기존 `review_status`는 Evidence·AC 처리 완료의 증거로 보지 않으므로, 레거시 EVT는 ID·요약·Artifact 연결을 보존한 채 `reviewed_at=NULL`로 이행한다. 완료 여부를 추측해서 채우지 않는다.

## 작업 중 기록과 마감 범위

PostToolUse는 일반 도구의 실행 사실을 EVT로 기계적으로 저장한다. 단순 조회도 미리 버리지 않는다. Harness 상태·기억 MCP 도구는 EVT에 등록하지 않아 마감 도구가 다시 미검토 로그를 만드는 순환을 막는다.

`$work-finish`의 메인 Codex는 현재 작업 맥락과 EVT 목록을 함께 본다. 목록 자체는 짧게 제공하며, 단순 조회·중간 확인은 빠르게 제외하고 실제 결과가 있는 수정·테스트·빌드·커밋 및 중요한 조사 근거를 검토한다. 로그만으로 AC 충족을 단정하지 않는다. 별도의 판정 서브에이전트는 사용하지 않는다.

**해당 Run에서 A/E 후보가 되는 EVT 집합은 최초 EVT 목록과 `snapshot_max_seq`를 함께 조회한 시점에 확정한다.** 경계 밖에서 생긴 EVT는 A/E 후보로 추가하거나 JSON을 다시 생성하지 않는다. 후속 마감 과정에서 생긴 EVT는 최종 미검토 확인에서 `run_seq > snapshot_max_seq`인지 확인하고, 별도 A/E 평가 없이 `reviewed_at`을 기록하며 요약을 비운다. 이것을 이유로 검토 루프를 늘리지 않는다.

## `$work-finish` 흐름

1. `get_postflight_status(work_item_id)`로 현재 `running_run`(실행 중인 Run), AC 판정, 기존 Artifact, pending Memory Candidate(아직 장기 기억으로 판정하지 않은 후보)를 확인한다. 반환된 Run ID가 예상한 Run과 다르면 종료하지 않는다.
2. `list_run_tool_events(run_id)`로 이번 Run의 EVT와 같은 DB 조회 시점의 `snapshot_max_seq`를 읽는다. 메인 Codex가 **경계 안의 EVT 전체**를 `Artifact+Evidence` / `Artifact만` / `제외`로 분류하고, 각 선택의 짧은 이유를 포함한 Review Plan을 만든다. 파일 게시 전에 경계 안 DB EVT ID와 JSON의 ID 집합이 정확히 일치하는지 검증해 `.harness/review-plans/<run_id>.json`에 저장한다. 누락·초과 또는 저장 실패 시 계획 없이 A/E 등록을 시작하지 않는다.
3. JSON을 기준으로 `Artifact+Evidence`와 `Artifact만` 항목의 Artifact를 `record_artifact()`로 저장한다. Evidence가 필요한 항목은 `verify_criterion()`으로 AC와 연결·판정한다. `record_artifact()` 자체는 Evidence를 만들지 않는다. `verify_criterion()` 내부의 Evidence 연결과 AC 상태 변경은 새 단일 트랜잭션 DB 함수를 사용하도록 고친다. A/E 저장의 일부가 실패하면 성공분을 보존하고, JSON과 DB의 실제 결과를 대조해 누락분만 재시도한다.
4. 기존 `$memory-finalize` 흐름으로 pending 장기 기억 후보를 별도로 처리한다. 후보가 남아도 Run 종료를 막지 않으며, 처리 실패는 사용자에게 알린다.
5. `get_postflight_status(work_item_id)`를 다시 호출해 AC·Artifact 등 종료 판단에 필요한 최종 상태를 확인한다. JSON 안의 EVT는 계획된 처리가 끝난 항목만 `reviewed_at` 기록과 요약 제거를 한 트랜잭션으로 수행한다. `제외`로 분류한 항목은 별도 A/E 저장 없이 처리 완료로 표시한다. 필요한 A/E가 아직 실패한 항목은 완료 표시하지 않는다.
6. 이번 Run의 `reviewed_at IS NULL`인 EVT를 최종 조회한다. `run_seq > snapshot_max_seq`인 항목만 경계 이후의 도구 사용으로 보고 A/E 재평가 없이 완료 표시와 요약 제거를 수행한다. 경계 안의 미검토 항목이 JSON에 없으면 누락 오류로 멈추고 자동 완료 표시하지 않는다. 경계 안의 JSON 항목은 누락된 A/E 저장 또는 검토 트랜잭션 실패인지 확인한다. 수정 가능한 실패 원인을 바로잡고 누락된 처리만 **최대 1회** 재시도한다. 다시 목록을 조회하되 새 A/E 후보를 추론하거나 JSON을 재생성하지 않는다.
7. 계획된 A/E가 모두 저장됐다면, 검토 완료 표시만 남았더라도 `progressed`로 `finish_work()`를 호출한다. 결과는 Run `succeeded`, WI `ready`다. 계획된 A/E 저장 자체가 끝내 실패했다면 `interrupted`로 호출한다. 결과는 Run `interrupted`, WI `ready`다. 둘 다 `finish_work()`가 **성공했을 때만** 확정된 상태다. 해당 WI의 AC 상태와 `next_action`·완료 권장값은 실제 Postflight 결과에 맞춰 전달한다. 기존의 다른 종료 사유(`retry_needed`, `blocked`, `cancelled`)는 별도로 유지한다.
8. `finish_work()`가 성공했고 모든 EVT의 마감 처리도 완료됐으면 JSON을 삭제한다. 미검토 EVT가 남았거나 `finish_work()` 자체가 실패했다면 JSON을 보존한다. 함수 실패 시 Run 종료를 가정하지 말고 DB의 실제 상태와 원인을 확인한다. 삭제는 PostToolUse가 아니라 `$work-finish`의 명시적 마지막 단계다.

최종 답변에는 미검토 EVT ID, 실패 이유, 보존된 JSON과 다음 선택 시의 복구 필요성을 알린다. `succeeded`는 이번 Run의 A/E 저장 성공을 뜻하지 WI의 `done`을 뜻하지 않는다.

## 다음 `$work-start`에서의 복구

사용자가 `w/`로 같은 WI를 선택하면, `$work-start`는 **새 `start_work()` 전에** `list_runs_with_unreviewed_tool_events(work_item_id)`로 그 WI의 과거 Run 중 `reviewed_at IS NULL`인 EVT를 찾는다. 현재 스킬에는 이 단계가 없으므로 추가해야 한다. UPS의 stale Run 복구를 스킬 안에서 재현한다는 뜻은 아니다.

- JSON이 있으면 `recover_review_plan(work_item_id, run_id)` MCP 도구를 해당 Run마다 호출한다. 도구가 Run ID·EVT ID·WI 및 AC 소속을 확인하고 계획과 DB의 Artifact·Evidence를 대조한다. 이미 성공한 항목은 다시 만들지 않고 누락된 A/E만 저장한다. 필요한 A/E가 갖춰진 EVT는 `reviewed_at`과 요약 제거를 수행한다. 모두 처리되면 JSON을 삭제한다.
- JSON이 없거나 손상됐으면 `get_run_review_context(run_id)`로 과거 EVT·Artifact·Evidence·AC를 읽고 아래의 `$work-start` 예외 지침에 따라 DB 상태·EVT 요약·현재 맥락으로 다시 판단한다. 확신한 판단만 `apply_unplanned_review_recovery(work_item_id, run_id, decisions)`로 적용하고, 확신할 수 없는 EVT는 미검토로 남긴다.
- 기존 `record_artifact()` MCP 도구는 실행 중인 Run에서만 쓰므로 그 제한을 전역으로 풀지 않는다. 복구용 MCP 도구는 내부 DB 함수 `record_artifact_for_recovery()`와 Evidence·AC 단일 트랜잭션 함수, 검토 완료·요약 제거 함수를 재사용한다. 복구를 마친 뒤에야 선택한 WI의 새 Run을 시작한다.

### Review Plan이 없거나 손상됐을 때의 `$work-start` 지침

이 분기는 정상적인 JSON 복구의 대체 경로다. 기계적인 재분류 규칙을 새로 만들지 않고, 메인 Codex가 이용 가능한 근거로 판단한다. 손상된 파일은 정상 계획처럼 사용하거나 임의로 덮어쓰거나 삭제하지 않으며, 파일 문제를 사용자에게 알린다.

> 선택한 WI의 과거 Run에 미검토 EVT(`reviewed_at IS NULL`)가 있고 Review Plan JSON이 없거나 읽을 수 없다면, 그 Run의 미검토 EVT 요약과 DB에 이미 연결된 Artifact·Evidence, WI의 목표·AC, 현재 대화에서 이용 가능한 작업 맥락을 함께 확인한다. 기존 DB 기록은 이미 저장된 결과의 근거이지, Artifact가 없는 EVT가 원래 `제외` 대상이었다는 증거는 아니다.
>
> 각 EVT에서 이미 저장된 A/E는 중복 생성하지 않는다. 누락된 Artifact 또는 Evidence가 필요하다는 근거가 충분하거나 등록 가치가 없다는 판단이 명확한 EVT만 `apply_unplanned_review_recovery()`에 전달한다. 도구는 내부 DB 함수를 통해 필요한 A/E 저장 또는 제외 처리 후 `reviewed_at`을 기록하고 요약을 제거한다.
>
> 요약·DB 기록·현재 맥락만으로 원래 도구 사용의 의미나 AC와의 관계를 확신할 수 없는 EVT는 `reviewed_at`을 비워 둔다. 미검토 EVT ID, 판단에 부족한 근거, JSON 누락 또는 손상 사실을 사용자에게 알리고 해당 EVT를 폐기할지 묻는다. 사용자가 특정 EVT의 폐기를 명시적으로 요청하기 전에는 자동으로 제외하지 않으며 새 `start_work()`를 호출하지 않는다. 모든 미검토 EVT가 처리된 경우에만 새 Run을 시작한다. 폐기 처리의 구체적인 저장 방식과 재개 흐름은 후속 WI에서 정한다.

`apply_unplanned_review_recovery()`는 모델의 가치 판단을 대신하지 않는다. 모델이 선택한 EVT만 **종료된 원래 Run**에 적용하며, 내부의 `record_artifact_for_recovery()` DB 함수는 필요한 Artifact 삽입을 담당한다. 복구 과정에서는 다른 Run으로 Artifact를 옮기거나, 손상된 JSON을 새 추론 결과로 재생성하지 않는다.

## JSON과 DB의 책임

Review Plan의 필드·파일 검증 규칙은 위의 JSON 계약을 따른다. 저장 실패 시 불완전한 파일을 정상 계획으로 취급하지 않는다.

JSON은 **판단의 보존본**이고, 성공 여부의 정본은 SQLite의 Artifact·Evidence·AC·`reviewed_at`이다. JSON에 `Artifact+Evidence`라고 쓰였다는 이유만으로 저장에 성공했다고 보지 않는다. 재시도·복구마다 DB 결과를 대조해 중복 Artifact나 Evidence를 만들지 않아야 한다.

`reviewed_at`과 `input_summary`·`result_summary` 제거는 같은 트랜잭션이다. `run_seq <= snapshot_max_seq`인 EVT는 JSON에 포함되어 분류에 따른 처리가 끝나야 완료 표시할 수 있다. `run_seq > snapshot_max_seq`인 EVT는 별도 A/E 평가 없이 완료 표시한다. 기존 `review_status`의 `pending`·`promoted`·`ignored`·`error` 분류는 사용하지 않는다.

## 민감정보와 보존 기간

EVT의 짧은 입력·결과 요약에도 비밀정보가 들어갈 수 있다. Review Plan에는 전체 도구 입력·출력을 복사하지 않고 복구에 필요한 판단·짧은 요약만 담는다. JSON은 로컬 전용이며 Git에 올리지 않는다. 기존에 허용한 임시 로컬 저장을 유지하고, 이번에는 별도 민감정보 탐지·필터나 보존 기간 단축 기능을 설계하지 않는다. 검토 완료 시 DB 요약을 비우고 JSON도 위 삭제 조건에서 제거한다. SQLite 파일·백업에 남은 과거 바이트까지 즉시 완전 삭제된다는 뜻은 아니다.

세션 강제 종료나 DB·마감 실패 시 JSON과 미검토 요약이 다음 턴까지 남을 수 있다. UPS는 이를 임의 삭제하거나 대신 평가하지 않는다. 따라서 민감정보가 반드시 한 턴 안에 지워진다고 보장하지 않는다.
