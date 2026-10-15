# 여러 Git worktree에서 Harness 저장소를 공유하는 방법

조사 기준일: 2026-09-25<br>
범위: 한 컴퓨터의 같은 Git 저장소에 속한 worktree들이 `state.db`와 `memorygraph.db`를 함께 사용하는 설계. 여러 컴퓨터 사이의 동기화는 별도 문제다.

## 현재 동작과 공유 범위

- `state.db`는 WorkItem·Run·Artifact 등 작업 상태를 보관하는 SQLite 파일이다. 현재 기본 경로는 **각 worktree의** `.harness/state.db`다. `state_store.open_database()`는 연결마다 외래 키를 켜고, 쓰기 함수는 `BEGIN IMMEDIATE` 트랜잭션을 사용한다. [상태 저장소 코드](../../src/harness/state_store.py)
- `memorygraph.db`는 장기 기억을 보관하는 별도 SQLite 파일이다. 현재 기본 경로는 각 worktree의 `.harness/memorygraph.db`이며 `HARNESS_MEMORY_DB_PATH`로 재지정할 수 있다. 해당 백엔드는 연결할 때 WAL 모드를 켠다. [기억 경로 코드](../../src/harness/memory/client.ts), [SQLite 백엔드](../../vendor/memory-graph/ts/src/backends/sqlite.ts)
- `runtime/bindings`는 Codex 세션과 활성 Run을 연결하는 임시 파일이다. 현재 worktree 안에 있다. 공유 DB에 기록된 다른 worktree의 활성 Run까지 정확히 소유자 판별하려면 이 Binding을 공통 디렉터리에서 조회할지, worktree별 Binding을 안전하게 집계할지 별도로 결정해야 한다. 선택기 임시 파일은 상태 DB의 상위 폴더 아래에 생성되므로, DB 경로 변경 시 함께 이동하는 부수효과를 검토해야 한다. [Binding 코드](../../src/harness/runtime_binding.py), [선택기 Hook 코드](../../src/harness/hooks/user_prompt_submit.py), [복구 Hook](../../src/harness/hooks/ups_recovery.py)
- Git은 linked worktree마다 별도 `$GIT_DIR`을 두지만, 같은 저장소의 `$GIT_COMMON_DIR`을 공유한다. `git rev-parse --path-format=absolute --git-common-dir`로 그 경로를 얻을 수 있다. 현재 주 worktree와 linked worktree에서도 동일한 공통 경로가 출력됐다. 따라서 `.git`이 반드시 디렉터리라고 가정하거나 `git rev-parse --show-toplevel`을 공유 저장소의 키로 삼으면 안 된다. [Git worktree 공식 설명](https://git-scm.com/docs/git-worktree#_details), [git-rev-parse](https://git-scm.com/docs/git-rev-parse)
- 기존 `bin/orca-harness-state`는 이미 공통 Git 디렉터리로 프로젝트를 식별해 DB를 `.backup` 스냅샷으로 보관·복원한다. 이는 **복원 시점의 복사본**이지 동시 접속하는 단일 DB가 아니다. [기존 보관 스크립트](../../bin/orca-harness-state), [SQLite 온라인 백업 API](https://www.sqlite.org/backup.html)

## 선택지

| 안 | 두 DB의 실제 위치 | 이점 | 주된 비용·위험 |
| --- | --- | --- | --- |
| A. Git 공통 디렉터리 아래 | `<git-common-dir>/harness-data/` | worktree 모두 같은 경로를 자동 발견하고, 로컬 저장소와 함께 이동한다 | Git 관리 디렉터리에 애플리케이션 데이터를 둔다. 저장소 삭제·재클론 시 별도 백업 없으면 유실된다 |
| B. 외부 앱 데이터 디렉터리 | 사용자별 로컬 데이터 디렉터리에서 Git 공통 경로를 키로 구분 | Git 내부와 분리되고 권한·백업 경계를 명확히 잡기 좋다 | Git 공통 경로가 이동하면 키가 달라지므로 이관/별칭 처리가 필요하다 |
| C. worktree별 `.harness`의 symlink | 각 worktree 경로는 유지하되 두 DB만 공통 로컬 폴더를 가리킴 | 기존 기본 경로 코드 변경량은 작다 | symlink/실경로 혼용과 WAL `-wal`/`-shm` 파일 위치를 실기기에서 검증해야 한다. 끊어진 링크·잘못된 재생성·기존 DB 충돌을 다뤄야 한다 |
| D. 전용 단일 프로세스 서비스 | DB는 서비스만 열고 worktree는 API로 호출 | 데이터 접근·마이그레이션을 한 곳에서 조정한다 | 서버 수명주기·인증·장애 복구와 기존 Python/Bun 호출부 변경이 가장 크다 |

한 컴퓨터에서 같은 Git 저장소의 worktree만 공유한다면 **A를 기본 권장**한다. Git의 공식 `--git-common-dir` 경로를 정규화한 뒤 그 아래의 *Git이 관리하지 않는 명시적 앱 하위 폴더*에 두 DB를 저장하고, 경로 계산을 Python/Bun이 공통으로 따라야 한다. Git 메타데이터와 앱 데이터를 물리적으로 분리해야 한다는 운영 선호가 강하면 B가 대안이다. C는 빠른 이행안처럼 보이나 경로 별칭·부수 파일 위험을 자체 테스트로 해소하기 전에는 기본안으로 삼지 않는 편이 좋다. D는 여러 기기, 네트워크 저장소, 높은 쓰기 경합까지 요구될 때 검토한다. 이 권고는 현재 규모와 코드 구조에 따른 설계 판단이다.

기존 스냅샷 방식은 별도 **E. 비실시간 공유** 선택지로 유지할 수 있다. 동시에 열린 worktree끼리 최신 상태를 즉시 보아야 하는 요구에는 맞지 않지만, worktree 교체 시 상태 이관이나 롤백에는 계속 유용하다. [기존 보관 스크립트](../../bin/orca-harness-state)

## SQLite에서 지켜야 할 경계

- 여러 로컬 프로세스는 하나의 SQLite 파일을 동시에 열 수 있지만, 동시에 기록하는 프로세스는 하나다. 따라서 공유 DB가 된다고 쓰기 충돌이 사라지는 것은 아니다. 잠금 대기 정책과 `SQLITE_BUSY` 처리, 긴 트랜잭션, 실제 동시 쓰기 테스트가 필요하다. [SQLite FAQ의 동시 접속 설명](https://www.sqlite.org/faq.html#q5), [busy timeout pragma](https://www.sqlite.org/pragma.html#pragma_busy_timeout)
- MemoryGraph DB는 현재 WAL 모드다. WAL은 읽기/쓰기가 겹치기 좋지만 모든 DB 사용자 프로세스가 **같은 호스트**에 있어야 하며 네트워크 파일시스템에서 작동하지 않는다. 공유 폴더를 iCloud/NFS/SMB 등에 두는 방식으로 여러 기기에 확장하면 안 된다. `-wal`·`-shm`은 본 DB와 같은 위치에서 함께 운영되어야 한다. [SQLite WAL 설명](https://www.sqlite.org/wal.html)
- `state.db`는 코드상 WAL을 설정하지 않으므로 기본 rollback-journal 모드에서 시작한다. 두 DB를 한꺼번에 WAL로 바꾸는 것은 별도 선택이다. 현행 트랜잭션·잠금 동작을 유지한 채 공유 경로를 먼저 검증할 수 있다. [상태 저장소 코드](../../src/harness/state_store.py), [SQLite WAL 활성화 설명](https://www.sqlite.org/wal.html#activating_and_configuring_wal_mode)
- DB를 실행 중에 파일 복사만 해서 이관하면 일관된 최신 스냅샷을 보장하기 어렵다. SQLite 온라인 백업 API(`sqlite3 .backup` 포함)로 복사하고, 전환 시에는 구/신 경로를 동시에 쓰는 프로세스를 정지·재시작해야 한다. [SQLite 온라인 백업 API](https://www.sqlite.org/backup.html)

## 구현 전에 함께 손볼 부분

1. **경로 해석을 단일 규칙으로 통일.** 현재 상태 MCP는 `HARNESS_STATE_DB`, Hook은 `HARNESS_STATE_DATABASE`, MemoryGraph는 `HARNESS_MEMORY_DB_PATH`를 각각 읽고, 웹 콘솔은 Python 기본값을 쓴다. 한 프로세스만 다른 DB를 보지 않도록 기본 경로 계산을 공통화하고 명시적 override의 우선순위를 문서화해야 한다. [상태 MCP](../../src/harness/mcp_server.py), [Hook 예시](../../src/harness/hooks/user_prompt_submit.py), [웹 콘솔](../../src/harness/control_center/app.py), [기억 경로](../../src/harness/memory/client.ts)
2. **임시 파일의 범위를 명시한다.** Picker의 `selections`는 공유 DB 옆으로 의도치 않게 이동하지 않도록 별도 worktree-local 경로를 준다. `runtime/bindings`는 세션별 임시 파일이지만, 현재 `find_run_owner()`가 자기 worktree 디렉터리만 검색하므로 다른 worktree의 Run 소유자는 `unknown`으로 보일 수 있다. 공통 Binding 디렉터리를 쓰거나 worktree별 디렉터리를 집계하는 방안을 비교하고, 중복 세션 ID·권한·정리 동작을 검증해야 한다. [Binding 코드](../../src/harness/runtime_binding.py), [선택기 Hook](../../src/harness/hooks/user_prompt_submit.py), [복구 Hook](../../src/harness/hooks/ups_recovery.py)
3. **보호 정책을 새 경로에 맞춘다.** 현재 Hook 보호 로직은 `.harness/state.db`와 `.git/` 경로를 특별 취급한다. A안의 공유 경로 또는 B안의 프로젝트 밖 경로에서 DB 수정·삭제를 차단하는 동작을 다시 테스트해야 한다. `memorygraph.db` 보호 여부도 명시적으로 결정한다. [Hook 정책](../../src/harness/hook_policy.py)
4. **서로 다른 코드 버전의 동시 접속을 검증한다.** 서로 다른 브랜치의 서버가 같은 스키마를 초기화·마이그레이션할 수 있다. 스키마 버전 호환성 검사와, 비호환 버전에서 쓰기를 중단하는 정책을 먼저 설계해야 한다. 현재 상태 DB는 초기화 시 마이그레이션을 실행하고 MemoryGraph도 연결 시 스키마를 초기화한다. [상태 DB 초기화](../../src/harness/state_store.py), [MemoryGraph 연결](../../src/harness/memory/client.ts)

## 안전한 이행·되돌리기 개요

1. 모든 관련 서버·Hook 실행을 멈춘 상태에서 현재 worktree들의 `state.db`와 `memorygraph.db` 존재 여부, 스키마 버전, 주요 row 수를 각각 조사한다. 이미 여러 worktree에 **서로 다른 데이터가 있으면 어떤 DB를 정본으로 삼을지 결정**해야 하며, 무작정 파일을 덮어쓰거나 단순 복사로 병합하지 않는다.
2. 정본 DB 두 개를 온라인 백업 API로 타임스탬프가 붙은 불변 백업에 저장한다. 공유 위치는 기존 파일이 있으면 자동 덮어쓰지 않고 중단한다. 파일·디렉터리는 사용자 전용 권한으로 만든다. [SQLite 온라인 백업 API](https://www.sqlite.org/backup.html)
3. 새 공유 경로로 복원한 뒤 무결성·스키마·샘플 WI 및 기억을 확인한다. 동일한 Git 공통 디렉터리를 가진 두 worktree에서 **같은 정규화 DB 경로**가 나오는지, 한쪽의 쓰기가 다른 쪽에서 바로 보이는지, 동시 읽기/쓰기와 `SQLITE_BUSY` 복구를 테스트한다.
4. 서버·Hook을 새 코드와 경로로 동시에 재시작한다. 이 시점 이후 옛 worktree DB는 쓰지 못하도록 읽기 전용 백업으로만 남긴다. 롤백 시에도 새 공유 DB의 마지막 일관된 백업을 먼저 확보하고, 구버전 코드가 이해할 수 있는 스키마인지 확인한 뒤 한 경로만 다시 활성화한다.

이행 절차는 제안이며 아직 구현·실기기 동시성 테스트를 한 것은 아니다.
