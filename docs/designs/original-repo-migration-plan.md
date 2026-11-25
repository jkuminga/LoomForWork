# 원본 저장소의 배포 구조 이전 계획

## 목적과 기준

이 문서는 원본 저장소 `Harness_v2/`를 검증용 복제본 `Harness_v2-template-trial/`의 배포 구조로 옮기기 위한 실행 계획과 이행 기록이다. 2026-11-25에 아래 경로 이전을 원본 작업 트리에 반영했다. 배포 형태와 설치 로직은 복제본의 현재 구현을 기준으로 삼되, 원본에서 그 뒤에 수정된 내용은 파일별로 확인해 보존한다. 복제본의 Git 이력이나 런타임 데이터는 가져오지 않는다.

`lfw/`는 사용자 프로젝트에 복사되는 하네스 본체다. `installer/`는 npm CLI(명령행 설치기)의 소스다. `harness-data/`는 여러 Git worktree가 공유하는 DB와 실행 상태의 저장 위치이며 Git 공통 디렉터리 아래에 둔다. `install.json`은 설치 성공 후 대상 프로젝트에 생성되는 설치 기록이다.

## 비교 시점과 주의할 차이

- 원본은 현재 추적 파일 기준으로 정리 전 구조이며, 복제본은 설치기와 검증 명령까지 추가한 구조다. 복제본의 `README.md`와 `docs/designs/harness-template-strategy.md`에는 미커밋 수정이 있으므로 이전 전에 diff를 재확인한다.
- `lfw/vendor/`의 외부 소스는 이미 원본과 복제본에 있다. 라이선스와 출처 파일을 보존하고 중복 이동하지 않는다.
- 원본의 `.codex/config.toml`에는 원본 절대 경로가, 복제본에는 복제본 절대 경로가 들어 있다. 복제본 파일 전체를 복사하지 않고 원본의 두 MCP `cwd`(서버 실행 디렉터리)만 `Harness_v2/lfw`로 맞춘다.
- 원본 `.codex/hooks.json`에는 개발 저장소용 네 훅이 있다. 이 명령 경로는 `lfw/bin/`으로 바꾼다. 반면 `installer/templates/hooks.json`은 사용자 프로젝트 최초 설치용 세 훅만 담으며 PreToolUse(도구 호출 전 검사 훅)는 기본 등록하지 않는다. 두 파일의 역할을 섞지 않는다.
- 원본의 `AGENTS.md`는 설치기가 사용자 프로젝트에 넣을 지침의 원본이다. `.agents/skills/`의 개발용 스킬과 `lfw/skills/`의 배포용 스킬도 역할이 다르므로, 배포용 사본을 추가하되 기존 개발용 스킬을 일괄 이동하지 않는다.

## 경로별 처리표

| 원본 경로 | 목표 경로·처리 | 검증할 점 |
| --- | --- | --- |
| `src/__init__.py`, `src/harness/**` | `lfw/src/`의 같은 상대 경로로 이동하고 복제본의 경로 수정 코드를 반영 | Python import, 정적 웹 파일, Bun 기억 코드의 상대 경로. 원본 이후 변경분을 덮지 않기 |
| `bin/harness-{control-center,memory,post-tool-use,pre-tool-use,stop,user-prompt-submit}`, `bin/orca-harness-state` | `lfw/bin/`으로 이동하고 복제본의 실행 경로 수정 반영 | 실행 권한과 셸의 자기 위치 계산 |
| 복제본의 `lfw/bin/harness-{configure-worktree,verify-install,pre-tool-use-config}` | 원본 `lfw/bin/`에 추가 | worktree MCP 경로 설정, 설치 검증, PreToolUse 설정 명령의 참조·실행 권한 |
| `.harness/schema.sql`, `pyproject.toml`, `uv.lock` | 각각 `lfw/schema.sql`, `lfw/pyproject.toml`, `lfw/uv.lock` | 스키마(DB 구조 정의), Python 의존성·잠금 파일이 코드 경로와 일치 |
| `.agents/skills/{work-start,work-finish,memory-finalize,work-item-create,mvp-to-prd,verify-prd,extract-features}/**` | 배포 원본을 `lfw/skills/`에 둠. 개발용 `.agents/skills/`는 유지 | 스킬 본문·참조 문서·라이선스 동기화. `extract-features` 포함 |
| `docs/{harness-overview,draft-work-items,implementation-units,long-term-memory-schema,long-term-memory,mcp-state-store-functions,single-request-pipeline,state-store}.*` | 해당 8개 문서를 `lfw/docs/`로 이동 | 상대 링크와 코드 경로를 새 위치로 수정 |
| 기존 `readme-hero-image.png` | `assets/loomforwork-hero.png`로 교체 | 두 README의 이미지 링크를 새 브랜드 이미지로 변경 |
| 복제본 `installer/` 전체 | 원본 `installer/`에 추가 | CLI, 설정 템플릿 3개, `update-compatibility.json`(버전별 업데이트 호환성 선언) 포함 |
| 루트 `package.json` | 복제본의 npm `bin`·`files`·scripts·MIT 정보 반영, 루트에 유지 | `private: true`는 게시 결정 전 유지. `files`는 패키지 포함 목록이며 설치 대상 목록과 구분 |
| 루트 `tsconfig.memory.json` | 루트에 유지하고 새 `lfw/src` 참조 반영 | TypeScript 타입 검사 범위 |
| 루트 `tests/**` | 루트에 유지하고 복제본의 경로 수정 테스트와 `tests/test_installer.py`를 반영 | 개발 테스트는 npm 배포에서 제외. 설치기·병렬 worktree 회귀 검증 |
| 복제본 `lfw/tests/test_configure_worktree.py` | 같은 위치에 추가 | 설치본의 worktree 설정 명령 자체 검증용으로 패키지에 포함됨 |
| 루트 `.codex/config.toml`, `.codex/hooks.json` | 원본 파일을 유지하며 실행 경로만 수정 | MCP `cwd`의 원본 경로와 개발용 훅 네 개 확인 |
| 루트 `.gitignore`, `AGENTS.md` | 루트에 유지. 복제본에서 추가된 무시 규칙만 비교 반영 | `AGENTS.md` 전문은 설치 템플릿 소스. 기존 개인 지침·무시 규칙 보존 |
| 루트 `README.md`, `README.en.md`, `LICENSE` | 루트에 유지하며 복제본과 내용 비교 | 이미지·스킬 라이선스 링크 변경; 원본의 추가 수정 보존 |
| `lfw/vendor/**` | 기존 위치 유지 | 라이선스·출처·잠금 파일 포함, `node_modules` 제외 |
| 개발용 `bin/`의 나머지 파일, `design/`, `docs/designs/`, `docs/research/`, `docs/docs-index.html`, `docs/viewer.html`, `CONTEXT.md`, 기타 `.agents/skills/` | 원본에 유지하고 npm `files`에서 제외 | 배포 대상과 구분. 정리·삭제는 별도 검토 |
| `.git/`, Git 공통 디렉터리의 `harness-data/`, `.harness/`의 런타임 파일, `.venv/`, `node_modules/`, 캐시 | 이동·복사하지 않음 | 기존 상태 DB(`state.db`), 장기 기억 DB(`memorygraph.db`), Binding(세션·Run 연결), Review Plan(도구 기록 검토 계획) 보존 |

## 실행 순서

1. **기준 고정:** 양쪽 `git status`와 차이 목록을 다시 기록한다. 복제본의 미커밋 README·설계 문서 변경을 읽고 반영 범위를 정한다. 원본의 새 변경과 파일 실행 권한도 확인한다.
2. **본체 이전:** `src/`, 하네스용 `bin/`, 스키마, Python 의존성 파일, 운영 문서, 이미지의 목적지를 만든다. 추적 파일 이동은 이력이 보이도록 `git mv`를 사용하고, 복제본에서 추가·수정된 코드는 파일별로 적용한다. 이미 있는 `vendor/`는 유지한다.
3. **배포 계층 추가:** `lfw/skills/`, 신규 하네스 명령, `installer/`, 루트 npm 설정을 반영한다. 설치기가 사용자 프로젝트의 `.codex/`, `AGENTS.md`, `.gitignore`, `package.json`을 병합하는 규칙을 보존한다.
4. **개발 저장소 연결 수정:** 원본의 `.codex` 경로, 테스트·타입 검사·README 링크, 문서의 상대 경로를 수정한다. 루트 `tests/`는 유지한다. 복제본의 절대 경로를 원본에 복사하지 않는다.
5. **검증 후 정리:** Python·Bun 테스트, 타입 검사, 설치기 테스트, 빈 프로젝트와 기존 프로젝트 설치, worktree 설정, `npm pack --dry-run`을 확인한다. 배포물에 개발 문서·루트 테스트·로컬 DB·가상 환경이 없는지 검사한다. 확인 후에만 오래된 경로·불필요한 개발 파일 정리를 별도 변경으로 다룬다.

## 완료 판단과 복구

- 원본 저장소에서 개발 명령과 훅이 새 경로로 실행되고, 설치기는 새 프로젝트와 기존 프로젝트에 같은 패키지 내용을 적용해야 한다.
- `npm pack --dry-run`의 목록은 `installer/`, `lfw/`, `assets/`, 루트 `AGENTS.md`·`README.md`·`LICENSE`를 중심으로 확인한다. `lfw/tests/test_configure_worktree.py`는 현재 설치기 검증에 필요하므로 포함 여부를 별도 확인한다.
- Git 공통 디렉터리의 기존 DB와 연결 상태는 이전 전후에 같은 위치·내용으로 남아야 한다. 배포용 `install.json`은 원본 패키지에 생성하지 않는다.
- 각 단계는 검증 가능한 작은 변경으로 분리한다. 실패하면 마지막 변경의 파일별 diff를 확인해 되돌릴 수 있게 하며, 광범위한 삭제나 원본 전체를 복제본으로 덮어쓰는 방식은 사용하지 않는다.

## 2026-11-25 이행 결과

- 이전 전 커밋 `28d01c3`을 `backup/pre-template-migration-20261125` 브랜치로 보존했다. 미추적 상태였던 이 계획 문서는 원본의 형제 디렉터리 `Harness_v2-migration-backup-20261125/`에 별도 사본을 만들었다.
- 본체·설치기·설정·스킬·문서 경로를 위 표대로 반영했다. 원본에만 있던 잠금 재시도 테스트는 `lfw/src/`를 참조하도록 수정해 유지했다.
- Python 테스트 278개, Bun 테스트 22개, TypeScript 타입 검사 통과. `npm pack --dry-run`은 343개 파일을 보고했고 루트 개발 테스트·설계 문서·DB·`install.json`은 포함하지 않았다.
- 이 변경은 원본 저장소의 로컬 커밋으로 보존한다. npm 게시 전에는 설치기의 빈 프로젝트·기존 프로젝트 실제 설치를 다시 검증한다.
