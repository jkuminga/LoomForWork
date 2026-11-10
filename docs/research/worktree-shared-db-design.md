# Harness worktree 공용 DB 설계

상태: 공용 경로 구현·첫 데이터 이전 완료. Artifact 경로와 일부 교차 worktree 복구 검증은 후속 과제<br>
범위: 한 컴퓨터에서 **같은 Git 저장소**에 속한 worktree 간 상태 공유. 다른 컴퓨터와의 동기화는 제외한다.

## 결정

Git의 공통 디렉터리(`git rev-parse --path-format=absolute --git-common-dir`) 아래 `harness-data/`를 만들고 두 DB를 둔다. Linked worktree의 `.git`은 디렉터리가 아니라 파일일 수 있으므로 경로를 직접 이어 붙이지 않는다.


| 데이터              | 새 기본 위치                                           | 의미                                                                    |
| ---------------- | ------------------------------------------------- | --------------------------------------------------------------------- |
| `state.db`       | `<git-common-dir>/harness-data/state.db`          | WorkItem·Run·Artifact 등의 작업 상태를 저장하는 SQLite DB                        |
| `memorygraph.db` | `<git-common-dir>/harness-data/memorygraph.db`    | 장기 기억을 저장하는 별도 SQLite DB                                              |
| Runtime Binding  | `<git-common-dir>/harness-data/runtime/bindings/` | Codex 세션과 활성 Run을 연결하는 임시 파일. 모든 worktree에서 Run 소유자를 동일하게 확인해야 하므로 공유 |
| Review Plan      | `<git-common-dir>/harness-data/review-plans/`     | Run의 EVT를 Artifact·Evidence로 처리할 판단 JSON. 다른 worktree에서도 미완료 판단을 복구하도록 공유 |
| Picker selection | `<worktree>/.harness/runtime/selections/`         | `w/` 선택창의 요청·결과 임시 파일. 해당 worktree에만 두며 DB 경로에서 유도하지 않음               |


`.harness/schema.sql`은 지금처럼 Git이 추적하는 worktree별 코드 자산으로 남긴다. `harness-data/`는 Git 관리 디렉터리 안에 있지만 Git이 추적·커밋·푸시하지 않는다. 저장소 삭제 또는 재클론 전에 별도 백업이 필요하다.

## 해결해야 할 항목

아래 다섯 항목의 최초 결정과 구현 지점을 기록한다. 현재 결과와 남은 검증은 문서 끝의 「구현 및 이전 결과」를 따른다.

1. **Runtime Binding 공유 — 미해결.** Runtime Binding은 Codex 세션과 활성 Run(한 번의 작업 실행)을 연결하는 임시 파일이다. 현재 worktree별 경로에 두면 다른 worktree에서 Run 소유자를 정확히 찾지 못할 수 있다. 위 표의 공용 경로가 제안된 상태이며, 서로 다른 worktree에서 소유자 조회·세션 종료·오래된 Binding 정리를 검증해야 한다.
   ```text
    [합의한 설계 방향 — 구현·검증 전]
    위치: <git-common-dir>/harness-data/runtime/bindings/<session-id>.json
    의미: 세션마다 자기 Binding 파일 하나를 소유한다. 모든 worktree는 같은 폴더에서 소유자를 조회한다.
    경로: runtime_binding.py의 DEFAULT_BINDINGS_DIRECTORY를 공용 경로로 바꾼다.
          Hook은 기존처럼 HARNESS_BINDINGS_DIRECTORY가 있으면 이를 우선하고,
          없으면 DEFAULT_BINDINGS_DIRECTORY를 사용한다. Hook별 설정 파일은 만들지 않는다.
    분류: 다른 worktree에서 실행 중인 Run도 Binding이 있으면 other_session으로 표시한다.
          Binding이 없으면 unknown으로 두며, 이를 곧바로 고아 Run으로 단정하지 않는다.
    복구: 다른 세션의 Run은 자동 복구하지 않는다. 세션 종료를 사용자가 확인한 뒤에만 복구한다.
          현재 세션의 오래된 턴을 복구하는 기존 규칙은 유지한다.
    보호: PreToolUse는 현재 비활성화되어 있고 제거 예정이므로 hook_policy.py 변경은 범위에서 제외한다.
    전환: 관련 세션을 종료하고 DB의 running Run과 남은 Binding을 확인한다.
          옛 Binding을 무조건 복사하지 않고 새 경로로 재시작한다.
    검증: 두 worktree 사이의 생성·소유자 조회·종료·오래된 Binding 정리를 확인한다.

    [문제점과 해결방안]
   1. 다른 세션의 중단된 Run을 사용자 확인 후 recover_abandoned_work()로 interrupted로 바꿔도
    해당 세션의 Binding JSON은 남는다. DB 복구 함수에서 파일을 자동 삭제하지 않는다.
    running 충돌 경고를 본 사용자가 이전 세션의 종료를 명시적으로 확인하면 해당 WI·Run을 복구한다.
    남은 Binding 파일은 별도의 자동 정리 정책을 추가하지 않는다.
   2. 공용 폴더의 Binding JSON 하나가 손상되면 find_run_owner()의 소유자 조회가 실패할 수 있다.
    기존 UPS 경고를 사용자에게 보여주고 사용자가 상태를 확인하도록 한다.
    손상 파일의 자동 격리·삭제 정책은 추가하지 않는다.
   3. 서로 다른 세션에 같은 session_id가 주어지면 <session_id>.json 파일 이름이 충돌할 수 있다.
    현재 관측된 문제가 아닌 예외 상황으로 보고, 별도의 충돌 방어 로직은 추가하지 않는다.
   4. PreToolUse의 hook_policy.py는 일반 도구가 Binding 경로를 직접 수정하는지 검사한다.
    현재 PreToolUse가 비활성화되어 있고 제거 예정이므로 공용 경로 전환을 위해 이 정책을 수정하지 않는다.
   ```
2. **Picker 임시 파일 분리 — 미해결.** Picker selection은 `w/` 선택창의 요청·결과 파일이다. 현재 DB의 상위 경로에서 위치를 유도하므로 DB 경로를 바꾸면 의도치 않게 공용 폴더로 이동한다. 위 표의 worktree별 경로를 명시적으로 사용하도록 바꾸고, 두 worktree의 선택 요청이 섞이지 않는지 확인해야 한다.
   ```text
    [합의한 구현 방향 — 구현·검증 전]
    현재: <state.db가 있는 폴더>/selections/
    변경: <현재 worktree>/.harness/runtime/selections/
    방법: user_prompt_submit.py의 _selection_directory()가 DB 경로 대신 현재 worktree 루트에서
          Picker 요청·결과 임시 파일의 위치를 계산하도록 바꾼다.
    범위: Picker 경로만 분리한다. HARNESS_STATE_DB와 HARNESS_STATE_DATABASE는 이 항목에서 변경하지 않는다.
    검증: 두 worktree에서 동시에 연 선택창의 요청·결과 파일이 각자의 폴더에 생성되고 섞이지 않는지 확인한다.
   ```
3. **백업·복원 경로 변경 — 미해결.** `bin/orca-harness-state`는 현재 각 worktree의 `.harness/`에서 DB를 찾는다. 공용 DB로 전환한 뒤에도 이 경로를 사용하면 새 `state.db`(작업 상태 DB)와 `memorygraph.db`(장기 기억 DB)가 백업되지 않는다. archive/restore 대상을 공용 경로로 바꾸고, 실행 중인 DB의 덮어쓰기 방지와 최초 이전·롤백 절차를 검증해야 한다.
   ```text
    [확정한 경로 변경 — 구현·검증 전]
    대상: bin/orca-harness-state의 archive 원본 경로와 restore 대상 경로
    현재: <worktree>/.harness/state.db, <worktree>/.harness/memorygraph.db
    변경: <git-common-dir>/harness-data/state.db, <git-common-dir>/harness-data/memorygraph.db
    방법: --worktree로 지정한 폴더에서 Git 공통 디렉터리를 찾아 두 명령이 동일한 공용 DB를 사용한다.
    이유: 어느 worktree에서 실행하든 실제 최신 DB를 백업·복원하고 옛 로컬 DB를 잘못 사용하지 않기 위해서다.
    정합성: archive/restore는 자주 실행하는 기능이 아니므로, 여러 세션·worktree의 동시 접근 중
            정합성을 보장하는 기능은 지금 추가하지 않는다. 모든 DB 사용 세션과 프로그램을 멈춘 뒤
            실행하는 운영 규칙을 사용하고, 자동 정합성 보장은 추후 과제로 둔다.
   ```
4. **브랜치별 스키마 호환성과 Artifact 경로 — 미해결.** 서로 다른 브랜치의 Harness 코드가 같은 DB에 접속하면 스키마(테이블·필드 구조) 버전이 충돌할 수 있다. 첫 이전에서 스키마를 바꾸지 않는 것만으로 이후의 충돌은 해결되지 않는다. 코드와 DB의 호환성 검사·비호환 쓰기 차단 정책을 정해야 한다. Artifact는 테스트 결과나 파일 등을 가리키는 기록으로, 한 worktree에서 저장한 경로가 다른 worktree에서 유효한지와 어느 코드 버전의 결과인지도 확인해야 한다.

   ```text
   [스키마 호환성 결정 — 구현·검증 전]
   state.db와 memorygraph.db는 데이터뿐 아니라 실제 테이블·필드 구조도 각각 담는다.
   각 브랜치의 schema.sql은 DB에 적용할 구조 정의이며, 브랜치별로 별도의 공용 DB 구조를 제공하지 않는다.
   두 DB 각각에 현재 스키마 버전을 메타데이터로 기록하고, Harness 코드에도 지원 버전을 명시한다.
   일반 DB 초기화·조회·쓰기 전에 각 DB의 버전과 코드가 지원하는 버전을 비교한다.
   버전이 같으면 실행하고, 다르면 DB를 자동 변경하거나 쓰기 전에 명시적 오류로 중단한다.
   스키마 버전 변경은 별도 이전 절차로 수행한다. 관련 세션을 멈추고 새 구조를 한 번 적용한 뒤
   DB 버전을 함께 갱신한다.
   Artifact 경로 문제의 처리 방식은 아직 결정하지 않았다.
   ```
5. **Review Plan 공유와 이전 — 공유하기로 결정, 구현·검증 전.** Review Plan은 Run의 EVT(도구 실행 기록)를 Artifact·Evidence로 처리할 판단을 담은 JSON 파일이다. 여러 worktree에서 같은 Run의 미완료 판단을 복구할 수 있도록 공용 DB와 함께 공유한다. 기존 worktree별 파일도 보존·이전해야 한다.
   ```text
   [합의한 구현 방향 — 구현·검증 전]
   위치: <git-common-dir>/harness-data/review-plans/<run-id>.json
   방법: Review Plan 전용 환경변수는 추가하지 않는다. review_plans.py의 _directory(database_path)가
         DB 파일의 부모 폴더에 review-plans/를 만들므로, database_path가 공용 state.db를 가리키면
         새 계획 파일도 자동으로 공용 위치에 저장된다.
   기존 파일: 각 worktree의 기존 state.db 옆 review-plans/를 찾아 공용 위치로 이전한다.
         미완료 계획을 누락하지 않고, 같은 Run ID 파일이 이미 있으면 내용을 비교한다.
         동일하면 중복 이전을 마치고, 내용이 다르면 어느 쪽도 덮어쓰거나 삭제하지 않고 충돌을 보고한다.
         손상된 파일도 자동 삭제하지 않고 보존해 사용자 확인 대상으로 둔다.
   복구: 모든 worktree의 Review Plan API가 동일한 database_path를 사용하도록 한다.
         다른 worktree에서 저장된 계획을 읽어 recover_review_plan()으로 복구할 수 있어야 한다.
         공용 저장만으로 다른 세션의 Run을 자동 복구하거나 계획을 자동 확정하지 않는다.
   구현 위치:
     - src/harness/review_plans.py::_directory() / _path(): 저장 경로의 기준점. 공유 DB 경로를 따르는지 확인하고,
       기존 worktree별 계획 이전 및 동일 Run ID 충돌 처리를 구현한다.
     - src/harness/hooks/user_prompt_submit.py의 dispatch_user_prompt_submit() 내
       cleanup_orphan_review_plans(database_path=database_path) 호출: 공용 DB 경로가 전달되는지 확인한다.
     - src/harness/mcp_server.py의 save/get/apply/finalize/delete/recover Review Plan 도구 래퍼:
       모두 같은 서버 database_path를 전달하는지 확인한다.
     - tests/test_review_plans.py: 서로 다른 worktree가 같은 공용 DB의 계획을 읽고 복구하는 경우,
       이전·중복·내용 충돌·손상 파일 보존을 검증한다. 테스트의 계획 파일 경로도 공용 DB 기준으로 확인한다.
     - docs/state-store.html: 저장 구성 예시의 Review Plan 위치와 “로컬 작업 데이터” 설명을 공용 위치에 맞춘다.
   검증: 이전 전 worktree별 계획 목록과 이전 후 공용 계획 목록을 대조하고,
         다른 worktree에서 미완료 Run의 계획을 읽고 재개할 수 있는지 확인한다.
   ```

## 경로와 실행 규칙

1. Python과 Bun 모두 **현재 worktree의 루트에서 Git 공통 디렉터리를 조회**하여 절대 경로로 정규화한다. 조회 실패 시 다른 위치에 새 DB를 조용히 만들지 않고 명시적 오류로 중단한다. 기존 테스트의 임시 DB 경로 주입은 유지한다.
2. 상태 DB의 공식 override는 `HARNESS_STATE_DB`로 통일한다. 기존 Hook용 `HARNESS_STATE_DATABASE`는 이행 기간에만 별칭으로 받아들이되, 두 값이 동시에 다르면 오류로 중단한다. MCP 서버·Hook·웹 콘솔이 동일한 경로 해석 함수를 사용한다. 기억 DB의 `HARNESS_MEMORY_DB_PATH`는 유지한다. Override는 공용 기본 경로보다 우선한다.
3. 공유 경로 초기화와 디렉터리 생성은 사용자 전용 권한으로 한다(`0700`, DB/Binding 파일 `0600`). PreToolUse 보호 정책은 현재 비활성화되어 있고 제거 예정이므로 이번 경로 전환의 구현 대상에 넣지 않는다.
4. `state.db`의 현재 journal 방식은 유지하고 `memorygraph.db`의 WAL도 유지한다. SQLite의 `-wal`·`-shm` 파일은 기억 DB 옆에 둔다. 두 DB의 동시 쓰기·잠금 대기 동작을 검증하되, 이번 변경에서 journal 방식을 함께 바꾸지 않는다. 공유 디렉터리는 로컬 파일시스템에만 둔다.
5. 서로 다른 브랜치의 프로세스가 같은 DB를 열 수 있다. 첫 이행은 스키마 변경 없이 진행한다. 이후 비호환 스키마 변경을 배포할 때는 DB 버전 검사와 구버전 쓰기 차단을 별도 선행 과제로 삼는다. 기존 코드 버전의 서버·Hook과 신버전을 섞어 실행하지 않는다.

## 안전한 첫 이전

자동 복사·자동 병합은 하지 않는다. 전용 이전 절차를 한 번 실행하고, 완료 전에는 새 기본 경로로 서비스를 시작하지 않는다.

1. 웹 콘솔·MCP 서버·Hook 등 DB 접근 프로세스를 모두 멈춘다. `git worktree list --porcelain`로 등록된 worktree를 확인하고, 각 `.harness/`의 두 DB 존재 여부·무결성·데이터 양을 조사한다. 서로 다른 유효 DB가 둘 이상이면 정본을 사용자와 결정할 때까지 중단한다.
2. 선택한 정본의 두 DB를 SQLite backup API로 타임스탬프가 있는 별도 백업에 보존한다. 대상 공유 경로에 DB가 이미 있으면 덮어쓰지 않는다. 백업·복원 중에는 단일 이전 작업만 실행되도록 잠근다.
3. 공용 위치에 복원하고 DB 무결성, WorkItem/Run 표본, 기억 표본을 확인한다. 기존 worktree의 DB는 즉시 삭제하지 않고 백업으로 격리해 구버전 코드의 재사용을 막는다. 진행 중인 세션은 종료·재시작하며 오래된 Runtime Binding을 자동 이전하지 않는다.
4. 새 코드로 모든 서버·Hook을 재시작한다. 공유 DB가 없는 상태에서 옛 worktree DB가 발견되면 빈 DB를 자동 생성하지 않고 이전 필요 오류를 낸다. 이미 공유 DB가 있다면 옛 worktree DB를 다시 사용하지 않는다.
5. 기존 `bin/orca-harness-state`의 archive/restore 경로는 새 공용 DB를 바라보도록 갱신한다. 복원은 실행 중인 DB에 덮어쓰지 않으며, 롤백도 먼저 최신 공유 DB를 백업한 뒤 서비스를 멈춘 상태에서 수행한다.

## 구현·검증 범위

- 공통 경로 계산, Python/Bun DB 기본값, 환경변수 충돌 처리, 웹 콘솔·MCP·Hook 연결부를 수정한다.
- Binding은 공용 위치로, Picker 파일은 worktree별 위치로 분리한다. 기존 명시적 경로 주입 테스트는 유지한다.
- 두 worktree에서 계산된 실제 DB 경로가 같고, 한쪽에서 만든 WI·기억이 다른 쪽에 즉시 보이는지 확인한다. 같은 Run의 소유 세션 판별과 Picker의 독립성도 확인한다.
- 동시 읽기/쓰기, `SQLITE_BUSY` 처리, WAL 보조 파일, 서버 재시작, 이전 중단·재시도, DB 부재/충돌 시 오류 경로를 테스트한다.

## 구현 및 이전 결과 (2026-11-11)

- Git 공통 디렉터리 아래 `harness-data/`로 기본 DB·Binding 경로를 전환했다. Picker 파일은 각 worktree의 `.harness/runtime/selections/`에 둔다. Hook·MCP·웹 콘솔은 같은 상태 DB 경로를 사용하며, `HARNESS_STATE_DB`와 구 Hook 별칭 `HARNESS_STATE_DATABASE`가 다르면 오류로 중단한다.
- `state.db`와 `memorygraph.db`에 SQLite `user_version=1`을 기록했다. 코드가 지원하는 스키마 버전과 DB 값이 다르면 일반 연결·초기화 전에 중단한다. 이후 구조 변경 시에는 버전 상향과 별도 이전 절차가 필요하다.
- master worktree의 두 DB를 공용 위치로 이전했다. 이전 후 `PRAGMA integrity_check=ok`, 상태 DB WorkItem 90개, 기억 DB Memory 5개, 두 DB의 버전 1을 확인했다. 원본 DB는 `.harness/backups/shared-migration-*/`에 보존한다. 당시 이전 대상 Review Plan은 0개였다.
- `bin/migrate-harness-shared-data`는 모든 등록 worktree의 기존 DB를 조사하고, 서로 다른 DB나 같은 Run ID의 서로 다른 Review Plan이 있으면 덮어쓰지 않고 중단한다. DB와 Review Plan을 임시 디렉터리에서 검증한 뒤 디렉터리 하나를 원자적으로 게시한다. 손상된 Review Plan은 원본을 보존하고 이전을 중단한다. 첫 시도에서 WAL 반영 전에 게시된 파일은 `.git/harness-data/failed-migration-*/`에 격리했다. 고친 도구로 다시 이전해 최종 DB의 무결성과 버전을 확인했다.
- `bin/orca-harness-state`의 archive/restore 대상은 공용 DB 경로로 변경했다. linked worktree에서 archive로 두 DB를 백업했고, 임시 Git 저장소에서 두 DB의 archive→restore 왕복을 확인했다. 실제 미완료 Review Plan의 다른 worktree 복구는 별도로 검증해야 한다.
- 기존 합의대로 archive/restore는 두 DB만 다룬다. Review Plan JSON은 이 스냅샷에 포함되지 않으므로, 미완료 계획이 있는 시점의 전체 복구에는 공용 `review-plans/`도 별도로 보존해야 한다.
- Artifact `uri`의 worktree 간 파일 경로 해석과 archive/restore 중 동시 접근 정합성은 합의대로 추후 과제로 남긴다. 이 세션의 기존 MCP 프로세스는 이전 전 코드를 실행 중이므로 다음 작업 전에 재시작해야 한다.

### 되돌리기

코드 변경은 해당 커밋을 `git revert`하여 되돌릴 수 있다. DB 파일은 Git이 추적하지 않으므로 코드만 되돌려도 DB 위치는 복원되지 않는다. 모든 Harness 세션과 웹 콘솔을 종료한 뒤 현재 공용 DB를 먼저 `bin/orca-harness-state archive`로 보존하고, `.harness/backups/shared-migration-*/`에 남긴 이전 전 DB를 원래 worktree의 `.harness/`로 복구해야 한다. 이전 후 생성된 Run·Artifact 등은 이전 전 DB에 없으므로, 필요하면 공용 DB 백업에서 별도로 확인한다. 복구 후에는 구버전 코드를 사용하는 세션을 다시 시작한다.

선택지 비교와 근거는 [기존 조사](worktree-shared-sqlite-options.md)를 참고한다.
