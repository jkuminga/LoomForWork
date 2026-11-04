# Harness 턴 파이프라인 토큰 비용 최적화 설계

## 상태와 범위

- 대상 WI: `WI-559ed862b095`; 출발점: 메모 `MEMO-1f184cf1289c`와 후속 사용자 결정.
- 1번 EVT 조회 최적화와 2번 Review Plan 제외 표현 압축을 적용했다. 나머지 후보는 구현 전 설계다.
- **확정:** Artifact-only(AC의 Evidence와 연결되지 않은 Artifact)는 유지한다. 실제 Run 상세 화면과 과거 결과 조회에서 사용하므로 기본 제외 정책을 도입하지 않는다. 모든 도구 실행을 Artifact로 만들자는 뜻도 아니다.
- **최적화 목표:** Artifact-only 등록 호출을 없애는 것이 아니라, 모델에 들어오거나 모델이 작성하는 반복 데이터와 불필요한 판단을 줄인다.

## 용어

| 용어 | 의미 |
| --- | --- |
| WI / Run | 작업 항목 / 해당 작업의 한 번의 실행 |
| EVT (`run_tool_events`) | PostToolUse가 기록한 도구 실행 한 건 |
| Artifact / Evidence | 검증 가능한 결과 기록 / Artifact를 AC(완료 조건)에 연결한 근거 |
| Review Plan | 한 Run의 EVT를 `artifact_evidence`, `artifact_only`, `exclude`로 분류한 불변 JSON |
| `snapshot_max_seq` | 계획에 포함될 마지막 EVT 순번. 이후 기록은 마감용 기록으로 따로 취급한다 |
| `reviewed_at` | 해당 EVT의 검토와 요약 제거가 끝난 시각 |

## 현재 관찰과 측정의 한계

현재 `$work-finish`는 `get_postflight_status()`로 Run·AC·Artifact·기억 후보를 읽고, `list_run_tool_events()`로 분류에 필요한 EVT 필드와 원본 요약을 받아 Review Plan을 쓴다. A/E 적용과 기억 후보 처리 뒤에는 경량 `view="final"`로 재확인한다. `finalize_review_plan()`이 정상 마감 결과를 반환하면 `get_run_review_status()` 재조회는 생략한다.

메모에 기록된 한 Run의 EVT 7건 사례에서 전체 목록 응답은 약 9,059자였다. 입력 100자·결과 160자만 보여주는 **가상** 미리보기는 약 2,650자(문자 수 약 71% 감소)였다. 제외 7건을 상세 객체로 쓴 가상 계획은 약 1,002자, 제외 ID 목록은 약 272자(문자 수 약 73% 감소)였다. 이는 실제 토큰 수·속도·판단 품질 측정이 아니다. DB에 저장되는 EVT 자체와 일반 PostToolUse 정상 호출은 그 자체로 모델 응답을 늘리지 않는다. 저장된 내용이 나중에 모델에게 반환될 때 비용이 발생한다.

## 설계 원칙

1. 작은 인터페이스 뒤에 조회·검증 복잡도를 둔다. 모델은 원시 DB 행 전체를 다루지 않되, 필요한 상세를 요청할 수 있어야 한다.
2. **판단량을 줄이되 판단 근거는 보존한다.** 조회 도구라는 이유만으로 EVT를 기계적으로 제외하지 않는다. Artifact-only와 Evidence 후보는 계속 작업 맥락과 도구 결과를 함께 판단한다.
3. 기존 복구 안전성을 유지한다. 모든 스냅샷 EVT에 대한 분류, 불변 계획, `source_event_id`(원본 EVT ID)를 이용한 중복 방지, `reviewed_at`과 요약 제거의 원자성은 유지한다.
4. 정상 경로에는 작은 응답을, 오류·복구 경로에는 상세 응답을 제공한다. 비용 절감 때문에 실패 원인을 숨기지 않는다.

## 1단계: EVT 조회 응답에서 불필요한 반복 필드 제거 — 완료

처음에는 미리보기 목록과 선택 상세 조회를 `$work-finish`의 기본 경로로 도입하려 했다. 모의 Run의 EVT 20건을 두 방식으로 검토한 결과, 미리보기만으로 판단한 항목에서 `artifact_only` 분류가 달라졌고 상세 재조회까지 포함한 응답 크기 절감도 작았다. 따라서 **두 도구로 전환하지 않고**, 기존 `list_run_tool_events(run_id)`의 한 번 조회를 유지했다.

MCP 응답의 각 EVT에서 `$work-finish` 분류에 필요 없는 `tool_use_id`(원본 도구 호출 ID), `run_id`(소속 Run ID), `created_at`(기록 시각), `reviewed_at`(검토 완료 시각)을 제거했다. `id`, `run_seq`, `tool_name`, `tool_family`, `status`, `exit_code`, `input_summary`, `result_summary`와 응답 바깥의 `snapshot_max_seq`, `total_count`는 유지한다. DB 원본 행과 다른 내부 조회·복구 경로는 바꾸지 않았다. 관련 MCP 테스트 14개가 통과했다.

실험용 미리보기·선택 상세 도구는 기본 경로에 채택하지 않았으며 설정·구현·전용 테스트에서도 제거했다. 이 절의 완료는 **기존 조회 응답의 필드 축소**를 뜻하며, 두 단계 조회 도입을 뜻하지 않는다.

## 2단계: Review Plan의 제외 표현 압축 — 완료

기존 `schema_version=1`은 제외된 EVT마다 `event_id`, `decision`, `reason`, `artifact:null`, `evidence:[]`를 요구했다. 새 Run의 `schema_version=2`는 상세 판단과 단순 제외를 분리한다.

```json
{
  "schema_version": 2,
  "run_id": "RUN-example",
  "work_item_id": "WI-example",
  "snapshot_max_seq": 3,
  "decisions": [
    {
      "event_id": "EVT-important",
      "decision": "artifact_only",
      "reason": "재사용할 수 있는 검증 결과",
      "artifact": {"kind": "test_run", "verification_status": "passed", "summary": "테스트 통과", "uri": null},
      "evidence": []
    }
  ],
  "excluded_event_ids": ["EVT-read-1", "EVT-read-2"]
}
```

`decisions`에는 `artifact_only`와 `artifact_evidence`만 넣고, 제외 ID는 별도 배열에 명시한다. 검증 함수는 두 배열의 ID가 서로 겹치지 않고, 합집합이 스냅샷의 전체 EVT ID와 정확히 같은지 확인한다. `artifact_evidence`의 AC ID·Evidence 결과 검증과 계획 재실행의 멱등성도 기존과 동일하다. 저장 실패 시에는 기존 계획을 덮어쓰지 않는다.

제외 건의 개별 사유는 이 형식에서 사라진다. 기존 State DB에도 저장되지 않았고, 계획 파일은 정상 마감 뒤 삭제되므로 영구 감사 기록의 손실은 아니다. 모의 EVT 20건(등록 8건·제외 12건)의 동일 분류를 메모리에서 직렬화한 비교에서는 v1 3,078자 → v2 2,102자(976자·31.7% 감소)였다. 이 수치는 실제 토큰 절감률이 아니며 비제외 항목 내용은 모의 값이었다.

`save_review_plan`, `get_review_plan`, `finalize_review_plan`, `recover_review_plan`은 두 버전을 읽고 검증·마감·복구한다. 새 Run은 `$work-finish` 지침에 따라 v2를 작성한다. 과거 Run의 v1 계획과 계획 없는 복구 도구의 v1 판단 형식은 유지하며, 기존 계획 파일은 일괄 변환하지 않는다. 관련 테스트 46개가 통과했다.

## 3단계: Postflight와 마감 응답 축소

- [x] 첫 `get_postflight_status()`는 전체 응답을 유지한다. 최종 확인에는 `view="final"`을 사용해 Run ID·상태, 기존 `verification`(AC 완료 검증 결과), pending 기억 후보 ID만 받는다. Artifact 상세가 필요한 오류·대조 상황에는 기본 전체 조회를 사용한다. `$work-finish` 지침과 함수·MCP 테스트에 반영했다.
- [x] `finalize_review_plan()`은 검토 완료 ID 전체 대신 `reviewed_count`(이번 호출의 마감 대상 EVT 건수)를 반환한다. `unreviewed_event_ids`, `inconsistent_event_ids`, `ae_complete`는 유지한다. 개별 EVT의 상세 진단은 기존 조회 도구를 사용한다.
- [x] 정상 마감의 중복 조회 생략(스킬 지침 완료): `finalize_review_plan()`이 `ae_complete=true`와 빈 미검토·불일치 목록을 반환하면 곧바로 outcome을 정한다. 호출 실패 또는 미검토·불일치가 있을 때만 `get_run_review_status()`를 재호출한다. 함수·DB 코드는 변경하지 않았다.
- `finish_work()`의 DB 검증은 생략하지 않는다. 모델에게 중복 데이터를 보내는 것과 상태 저장소의 최종 방어는 별개다.

## 전역 후속 후보: 시작 문맥과 기억 후보

이들은 본 WI의 work-finish 최적화와 분리해 측정한 뒤 결정한다.

- `get_work_context()`는 모델 공개 메모 본문 전체와 최근 Run 5개의 전체 행을 반환한다. WI에 메모가 쌓이면 시작 시 응답이 커질 수 있다. 메모·최근 Run의 짧은 목록과 선택 상세 조회를 검토하되, `is_model_visible`(모델에게 보여주도록 설정한 메모) 의미를 조용히 약화하지 않는다. 누락 건수와 상세 조회 방법을 함께 제공해야 한다.
- 기억 후보마다 `inspect_memory_candidate()`가 유사 기억을 가져오고 모델이 저장 가치를 판단한다. 여러 후보에서 검색 결과를 재사용할 수 있는지 측정한다. 기억 손실 위험 때문에 일괄 자동 거부·추론 생략은 이번 변경에 포함하지 않는다.
- 일반 코드 조회 출력도 토큰을 쓰지만 훅 저장 비용과 구별한다. AGENTS.md의 diff·필요 구간 우선 규칙을 지키면서 실제 재조회 횟수·출력량을 관찰한다.

## 구현 순서와 검증 게이트

1. **기준선 측정:** 대표 Run을 작은 EVT 수/큰 EVT 수/Artifact-only 포함/Evidence 포함/기억 후보 포함으로 나누어 각 도구의 응답 문자 수·가능하면 실제 입력 토큰·도구 호출 수·지연 시간을 기록한다. 문서의 71%·73%를 실측 절감률로 사용하지 않는다.
2. **EVT 조회 응답 축소 — 완료:** 미리보기·선택 상세 방식은 비교 후 기본 경로에서 제외하고, 기존 단일 조회에서 반복 필드 4개를 제거했다. 원본 요약과 스냅샷 경계는 유지한다.
3. **Review Plan v2 — 완료:** v1 읽기·복구 호환을 유지하면서 v2 전체 커버리지·중복·외부 항목·경계 검증과 저장·마감·복구 테스트를 추가하고 work-finish 지침을 변경했다.
4. **응답 축소 — 완료:** 정상 마감의 중복 조회를 지침에서 제거하고 최종 Postflight 경량 조회와 `finalize_review_plan()` 응답 축소를 구현했다. 실패 경로의 미검토·불일치 ID는 유지한다.
5. **비교:** 같은 작업 사례에서 Artifact-only/Evidence 결정, AC 상태, 복구 결과가 기준선과 같아야 한다. 토큰 절감이 작거나 상세 재조회가 지나치게 많으면 미리보기 폭·조회 조건을 조정한다.

관련 검증 위치: `tests/test_state_store.py`, `tests/test_mcp_server.py`, `tests/test_review_plans.py`. 전역 후속 후보는 별도 결정과 테스트 범위가 필요하다.

## 아직 결정하지 않은 세부값

- 시작 문맥의 메모 본문 기본 노출 정책. 사용자에게 공개한 메모가 무심코 빠지지 않도록 별도 합의가 필요하다.
