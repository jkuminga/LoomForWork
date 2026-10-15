# Harness worktree 공용 DB 설계

상태: 설계안 — 구현·데이터 이전 전<br>
범위: 한 컴퓨터에서 **같은 Git 저장소**에 속한 worktree 간 상태 공유. 다른 컴퓨터와의 동기화는 제외한다.

## 결정

Git의 공통 디렉터리(`git rev-parse --path-format=absolute --git-common-dir`) 아래 `harness-data/`를 만들고 두 DB를 둔다. Linked worktree의 `.git`은 디렉터리가 아니라 파일일 수 있으므로 경로를 직접 이어 붙이지 않는다.

| 데이터 | 새 기본 위치 | 의미 |
| --- | --- | --- |
| `state.db` | `<git-common-dir>/harness-data/state.db` | WorkItem·Run·Artifact 등의 작업 상태를 저장하는 SQLite DB |
| `memorygraph.db` | `<git-common-dir>/harness-data/memorygraph.db` | 장기 기억을 저장하는 별도 SQLite DB |
| Runtime Binding | `<git-common-dir>/harness-data/runtime/bindings/` | Codex 세션과 활성 Run을 연결하는 임시 파일. 모든 worktree에서 Run 소유자를 동일하게 확인해야 하므로 공유 |
| Picker selection | `<worktree>/.harness/runtime/selections/` | `w/` 선택창의 요청·결과 임시 파일. 해당 worktree에만 두며 DB 경로에서 유도하지 않음 |

`.harness/schema.sql`은 지금처럼 Git이 추적하는 worktree별 코드 자산으로 남긴다. `harness-data/`는 Git 관리 디렉터리 안에 있지만 Git이 추적·커밋·푸시하지 않는다. 저장소 삭제 또는 재클론 전에 별도 백업이 필요하다.

## 경로와 실행 규칙

1. Python과 Bun 모두 **현재 worktree의 루트에서 Git 공통 디렉터리를 조회**하여 절대 경로로 정규화한다. 조회 실패 시 다른 위치에 새 DB를 조용히 만들지 않고 명시적 오류로 중단한다. 기존 테스트의 임시 DB 경로 주입은 유지한다.
2. 상태 DB의 공식 override는 `HARNESS_STATE_DB`로 통일한다. 기존 Hook용 `HARNESS_STATE_DATABASE`는 이행 기간에만 별칭으로 받아들이되, 두 값이 동시에 다르면 오류로 중단한다. MCP 서버·Hook·웹 콘솔이 동일한 경로 해석 함수를 사용한다. 기억 DB의 `HARNESS_MEMORY_DB_PATH`는 유지한다. Override는 공용 기본 경로보다 우선한다.
3. 공유 경로 초기화와 디렉터리 생성은 사용자 전용 권한으로 한다(`0700`, DB/Binding 파일 `0600`). DB와 Binding에 대한 Hook 보호 정책도 **실제 정규화 경로** 기준으로 갱신한다. 일반 도구가 `.git` 안의 DB를 직접 수정하는 것은 허용하지 않는다.
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

이 문서는 구현 기준을 정한 것이며 아직 DB를 이동하거나 코드를 변경하지 않았다. 선택지 비교와 근거는 [기존 조사](worktree-shared-sqlite-options.md)를 참고한다.
