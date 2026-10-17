# Harness v2 개요

Harness v2는 로컬 프로젝트의 작업 목표, 한 번의 실행, 검증 근거, 재사용할 기억을 분리해 관리하는 Codex 작업 환경이다. 현재는 단일 사용자·로컬 SQLite 중심으로 운영한다. 이 문서는 전체 구조만 소개하며, 정확한 실행 순서와 DB 계약은 아래의 전용 문서를 따른다.

## 핵심 구성

| 구성 | 역할 |
| --- | --- |
| Feature | 여러 작업을 묶는 큰 목표·기능 영역. WI에 연결하지 않아도 된다. |
| WorkItem (WI) | 목표, 완료 조건(AC), 상태, 다음 행동을 가진 지속적인 작업 항목. 구현뿐 아니라 조사·결정·검증에도 사용한다. |
| Run | 한 WI를 진전시키려는 한 번의 실행. 하나의 WI에 여러 Run을 연결할 수 있다. |
| State DB | `.harness/state.db`의 SQLite 저장소. WI·Run·AC·도구 사용 기록·Artifact·Evidence·기억 후보 등 프로젝트 상태를 저장한다. |
| MemoryGraph | `.harness/memorygraph.db`에 저장하는 장기 기억과 관계. 일회성 진행 로그가 아닌 재사용할 결정·문제·해결책을 다룬다. |
| Control Center | `bin/harness-control-center`로 여는 로컬 웹 콘솔. WI·Run·기억 등 상태를 조회하고, Draft·메모·허용된 WI 관리를 제공한다. |
| Hook·Skill·MCP | Hook은 요청 전후의 기계적 처리, Skill은 Codex의 작업 절차, MCP 도구는 상태·기억 접근을 담당한다. |

Artifact는 Run의 검증 가능한 작업 결과 기록이고, Evidence는 그 결과를 WI의 AC(완료 조건)에 연결한 근거다. Runtime Binding은 현재 Codex 세션·Turn이 어느 WI·Run을 사용하는지 가리키는 임시 파일이다. 상세 필드와 관계는 [상태 저장소](state-store.html)를 참고한다.

## 요청부터 종료까지

1. 일반 요청은 WI 선택기를 열지 않는다. `w/` 요청에서는 UserPromptSubmit Hook(UPS)이 현재 세션의 이전 실행을 정리하고, 사용자가 fzf 선택기에서 `ready` WI 또는 `backlog` Draft WI를 고르게 한다.
2. `$work-start`는 선택한 Draft를 실행 가능한 WI로 구체화하고, 같은 WI의 과거 미검토 도구 기록이 있으면 새 Run 전에 복구한다. `start_work()`가 Run을 시작하면 세션 Binding을 만들고 관련 기억을 회상한다.
3. 활성 Run에서 일반 도구를 사용하면 PostToolUse Hook이 `run_tool_events`(도구 실행별 압축 기록)에 저장한다. 개별 도구 사용 직후 Artifact 등록 여부를 판단하지 않는다. 재사용할 지식은 작업 중 `create_memory_candidate()`로 후보를 남긴다.
4. `$work-finish`는 Postflight(종료 전 상태 조회)와 도구 기록·작업 맥락을 검토한다. Run별 Review Plan JSON에 Artifact·Evidence 등록 판단을 고정하고 적용한다. 기억 후보는 `$memory-finalize`로 검토하되, pending 후보만으로 Run 종료를 막지는 않는다.
5. 도구 기록의 `reviewed_at`(검토 마감 시각)을 채우고 입력·결과 요약을 제거한 뒤 `finish_work()`로 Run을 종료한다. 성공한 Run은 `succeeded`, WI는 다시 `ready`가 될 수 있다. WI의 `done`은 사용자가 웹 콘솔 또는 명시적 완료 요청으로 별도 처리한다.

Stop Hook은 현재 세션의 활성 Run이 마감되지 않았을 때 `$work-finish` 실행을 한 번 지시한다. 다음 `w/` UPS는 현재 세션의 이전 Turn에 남은 Run만 중단 복구하며, 다른 세션의 Run을 임의로 종료하지 않는다. 미검토 도구 기록은 해당 WI의 다음 `$work-start`에서 복구한다. 세부 실패·재시도 조건은 [단일 요청 파이프라인](single-request-pipeline.html)이 정본이다.

## 경계와 현재 범위

- 진행 상태의 정본은 State DB이고, 설계 문서는 규칙과 이유를 설명한다. Git은 실제 코드·문서 변경의 정본이다.
- `run_tool_events`는 활성 Run의 도구 사용 기록이다. 별도의 OpenTelemetry 수집기나 토큰·시간을 추적하는 범용 Trace 저장소를 뜻하지 않는다. Artifact·Evidence 여부는 종료 검토에서 결정한다.
- `.codex/hooks.json`에는 UserPromptSubmit·PreToolUse·PostToolUse·Stop Hook이 등록되어 있다. 실제 적용 여부는 Codex 클라이언트 설정에도 영향을 받으므로, PreToolUse가 모든 환경에서 강제된다고 가정하지 않는다.
- Hook은 Run을 성공으로 마감하거나 WI를 `done`으로 만들지 않는다. Run의 결과 판단은 Codex와 `$work-finish`, WI 완료 결정은 사용자의 몫이다.
- 장기 기억은 State DB의 후보와 MemoryGraph의 실제 기억을 구분한다. 후보 저장이나 기억 저장 실패가 다른 프로젝트 상태 기록을 대신하지 않는다.

## 관련 문서

| 문서 | 읽을 때 |
| --- | --- |
| [작업 단위 분해](implementation-units.md) | Feature와 WI의 범위를 정할 때 |
| [단일 요청 파이프라인](single-request-pipeline.html) | `w/` 선택, Run 시작·종료, Hook·Skill 흐름을 확인할 때 |
| [상태 저장소](state-store.html) | WI·Run·AC·Artifact·Evidence 등의 상태와 스키마를 확인할 때 |
| [MCP·DB 함수](mcp-state-store-functions.html) | 도구와 내부 저장 함수의 책임을 확인할 때 |
| [웹 콘솔 Draft와 WI 관리](draft-work-items.md) | Draft 생성·구체화 및 WI 수정·상태·삭제 UI를 확인할 때 |
| [장기 기억](long-term-memory.html) · [스키마](long-term-memory-schema.html) | 기억 후보, MemoryGraph, 마감 절차를 확인할 때 |
