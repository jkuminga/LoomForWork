# 하네스 템플릿화 전략

## 개발용 독립 복제본에서 작업하기

현재 배포 구조와 파일별 목적지는 정해졌고, `vendor/` 이동까지 원본 저장소에 커밋했다. 나머지 하네스 파일의 이동·경로 수정·검증·설치기 구현은 원본을 보존하기 위해 부모 디렉터리의 독립 복제본에서 진행한다.

1. 원본 저장소의 `git status`가 깨끗한지 확인한다. 미커밋 변경이 있으면 필요한 내용만 먼저 커밋해 복제 기준점을 확정한다.
2. 원본의 부모 디렉터리에서 `git clone --no-hardlinks Harness_v2 Harness_v2-template-trial`로 형제 디렉터리에 복제한다. 이 복제본은 별도 `.git`을 가지며 Git worktree가 아니다.
3. 복제본에서 `git remote remove origin`을 실행한다. 로컬 clone이 기본으로 설정한 원본 저장소 방향의 remote를 제거해 실험 커밋을 원본으로 push하지 않게 한다.
4. 복제본의 `.codex/config.toml`에서 `harness-state`와 `harness-memory` 두 MCP 서버의 `cwd`(서버 실행 폴더)를 복제본의 절대 경로로 바꾼다. 새 세션을 열기 전에 두 항목 모두 원본 경로를 가리키지 않는지 확인한다. `.codex/hooks.json`의 훅 명령은 현재 Git 루트를 기준으로 실행한다.
5. Git 공통 디렉터리의 `harness-data/`는 복제하지 않는다. 복제본에서 새 상태 DB와 기억 DB를 사용하며, 원본 WI·Run·기억을 실험 데이터와 섞지 않는다.
6. 새 Codex 세션의 작업 디렉터리를 복제본으로 지정하고 이 문서의 **구현 순서**를 전달한다. 그 세션에서 파일 이전과 검증을 시작한다.

## 구현 순서

1. 파일 배치표에 따라 하네스 원본 파일을 `lfw/` 구조로 옮긴다.
2. 코드·스크립트·문서의 기존 경로 참조를 새 위치에 맞게 수정한다.
3. 새 구조에서 현재 하네스 기능이 정상 실행되는지 확인한다.
4. 검증된 구조를 빈 디렉터리와 기존 프로젝트에 적용할 설치기를 구현한다.

## 문서 상태

설계 초안. `loomforwork`라는 하나의 npm 패키지에 설치기와 하네스 배포 파일을 담고 `bunx`로 설치기를 실행한다. 설치 후 하네스 파일은 적용 대상 프로젝트의 `lfw/`에 둔다. worktree 간 공유해야 하는 DB와 실행 상태는 기존 결정대로 Git 공통 디렉터리에 둔다. 최초 설치, 같은 버전의 `install` 재실행, 배포 파일·설치 스킬 수정 시 업데이트 중단 규칙을 정했다. 초기 `update`는 기존 공유 파일과 공유 DB 구조를 바꾸지 않아도 작동하는 버전에만 허용한다. 필수 변경이 있는 버전의 이전 절차는 후속 설계로 남겼다.

## 목적

현재 저장소에서 개발한 하네스를 빈 디렉터리와 이미 작업 중인 프로젝트 모두에 적용할 수 있는 배포 방식을 설계한다. 기존 프로젝트의 파일과 설정을 보존하면서 하네스의 실행 코드, Codex 설정, 작업 상태를 연결하는 방법을 정한다.

## 적용 대상과 경계

- 빈 디렉터리: 하네스에 필요한 초기 구성 생성.
- 기존 프로젝트: 이미 존재할 수 있는 `.codex/`, `AGENTS.md`, `.gitignore`, `src/`, `tests/`, `docs/`, `design/`과의 충돌 처리.
- 하네스 코드와 프로젝트별 작업 데이터의 배치 및 Git 추적 범위.
- 최초 설치, 같은 버전의 설치 명령 재실행, 업데이트 시 기존 내용 보존 방법. 제거 절차는 후속 설계 대상이다.

## 결정한 사항

배포할 하네스 코드를 각 프로젝트 루트의 `lfw/`에 모은다. 사용자 프로젝트의 `src/`, `tests/`, `docs/`와 하네스 파일을 섞지 않는다. 프로젝트 루트의 `.codex/`, `AGENTS.md`, `.gitignore`에는 하네스를 연결하는 데 필요한 설정만 반영한다. 공유 상태 파일은 `lfw/` 안에 두지 않는다.

```text
사용자 프로젝트/
├─ src/                         # 사용자 코드
├─ tests/                       # 사용자 테스트
├─ lfw/               # 배포할 하네스 코드
│  ├─ bin/                      # 하네스 실행 명령
│  ├─ src/                      # 하네스 실행 코드
│  ├─ vendor/                   # 하네스 외부 의존 코드
│  ├─ skills/                   # 설치할 하네스 전용 스킬의 원본
│  ├─ docs/                     # 설치할 하네스 사용 문서
│  ├─ runtime/selections/       # 이 worktree의 선택기 임시 파일
│  ├─ pyproject.toml            # 하네스 Python 의존성
│  ├─ uv.lock                   # Python 의존성 버전
│  ├─ install.json              # 대상 프로젝트에서 설치 완료 시 생성하는 기록
│  └─ schema.sql                # 작업 상태 DB 구조
├─ .codex/                      # Codex에서 하네스를 호출하는 설정
├─ .agents/skills/              # Codex가 발견할 하네스 스킬 사본
├─ AGENTS.md                    # 프로젝트 지침과 하네스 사용 지침
└─ .gitignore                   # 생성 데이터 제외 규칙

<git-common-dir>/               # 같은 저장소의 worktree가 공유하는 Git 디렉터리
└─ harness-data/                # Git이 추적하지 않는 공유 상태
   ├─ state.db                  # WorkItem·Run 등 작업 상태 DB
   ├─ memorygraph.db            # 장기 기억 DB
   ├─ runtime/bindings/         # 세션과 활성 Run의 연결 파일
   └─ review-plans/            # 도구 기록 마감 판단 파일
```

Git 공통 디렉터리의 공유 데이터 위치는 기존 멀티 worktree 설계의 고정 조건이다. 선택기 임시 파일은 현재 worktree의 `.harness/runtime/selections/`에 있으며, 설치 후에는 `lfw/runtime/selections/`로 옮기고 Git에서 제외한다.

### npm 패키지 구성

설치기 CLI와 설치할 하네스 파일 묶음을 **하나의 npm 패키지**에 포함한다. 패키지의 실행 파일이 `install`·`update` 명령을 처리하고, 같은 패키지에 포함된 하네스 파일을 읽어 대상 프로젝트의 `lfw/`와 정해진 연결 위치에 배치한다. 설치 도중 하네스 원본을 얻으려고 다른 npm 패키지나 Git 저장소를 추가로 내려받지 않는다. 배포용 `payload/` 사본은 만들지 않는다. 개발 저장소에서 관리하는 배포 원본 한 벌을 패키지에 포함한다.

개발 저장소의 원본 파일과 사용자 프로젝트에 설치할 파일 경로는 아래의 배치표를 따른다. npm 게시용 묶음에는 설치기, `lfw/`로 배치할 파일, 루트 `AGENTS.md`의 지침 원본, 기존 프로젝트 파일에 병합할 설정 양식·규칙을 포함한다. 개발용 테스트·설계 자료·생성 DB는 제외한다. 설치기 자체는 대상 프로젝트에 복사하지 않는다.

개발 저장소 루트의 `package.json`은 npm 게시용 매니페스트로 사용한다. 패키지 이름은 `loomforwork`로 정하고, `bin`은 `installer/cli.ts`를 가리키게 한다. CLI는 Bun으로 실행하며 `install`·`update` 인자를 처리한다. 게시용 `files` 포함 목록은 `installer/`, `lfw/`, 루트 `AGENTS.md`를 기본으로 하고, 배포 README와 필요한 라이선스 파일을 함께 확인한다. 개발용 `tests/`, `design/`, `docs/designs/`, 생성 DB·가상 환경·`node_modules/`는 게시하지 않는다. 루트 매니페스트의 현재 `private: true`는 실제 게시 전에 해제한다. 설치본 루트의 별도 `lfw/package.json`은 현재 실행 경로에 필요하지 않으므로 만들지 않는다. MemoryGraph 의존성은 `lfw/vendor/memory-graph/ts/package.json`과 잠금 파일로 관리한다.

배포 버전별 업데이트 허용 목록은 개발 저장소의 `installer/update-compatibility.json`에 두고 npm 패키지의 `installer/`와 함께 게시한다. 이 파일은 설치기가 읽는 배포 메타데이터이며 대상 프로젝트의 `lfw/`에는 복사하지 않는다. 형식은 다음과 같다.

```json
{
  "format_version": 1,
  "compatible_from": ["0.1.0", "0.1.1"]
}
```

`format_version`은 이 호환성 파일의 형식 버전이다. `compatible_from`은 **현재 배포 버전으로 직접 업데이트할 수 있는 기존 하네스 버전의 정확한 목록**이다. 현재 배포 버전은 별도로 중복 기록하지 않고 npm `package.json`의 `version`을 사용한다. 첫 배포는 이전 설치 버전이 없으므로 `compatible_from`을 빈 배열로 둔다. 새 버전을 게시할 때 기존 버전별 공유 파일 설정과 공유 DB 구조가 새 코드와 호환되는지 검토해 허용 목록을 작성한다. 중간 버전을 건너뛰는 직접 업데이트도 목록에 명시된 경우에만 허용한다. 목록은 배포 원본 간의 호환성을 나타내며, 사용자가 공유 파일이나 DB를 임의로 변경한 경우까지 보증하지 않는다.

현재 루트 `package.json`의 다섯 스크립트는 배포 CLI가 아니다. `memory:setup`은 MemoryGraph 의존성을 준비하는 개발용 편의 명령으로, 설치기는 잠금 파일을 이용해 같은 준비를 직접 수행한다. `memory:recall`은 개발용 기억 명령이며 설치 후에는 `lfw/bin/harness-memory`가 기억 CLI를 호출한다. `test:python`은 개발 저장소 루트의 `tests/`를 실행하며 `PYTHONPATH=lfw`와 하네스 Python 환경을 스크립트 안에서 지정한다. `test:memory`와 `typecheck:memory`는 개발·게시 전 검증용이다. 이 다섯 명령은 개발 저장소에서 사용하고 사용자 프로젝트에 설치하지 않는다.

루트 `AGENTS.md` 전문은 패키지에도 포함한다. 설치기는 이 파일을 사용자 프로젝트에 통째로 덮어쓰지 않고 아래의 하네스 표시 구획에 삽입한다. 배포 전에는 이 전문에 개발 저장소에만 적용할 지침이나 개인 정보가 없는지 검토한다.

새 버전 게시 순서는 다음과 같다.

1. npm 패키지 버전과 포함된 하네스 버전을 같은 번호로 올리고, 잠금 파일·배포 원본·`installer/update-compatibility.json`의 허용 목록을 확정한다.
2. `npm pack --dry-run`으로 실제 포함 파일을 확인하고, 누락·불필요한 개발 자료·개인 경로를 점검한다.
3. `npm pack`으로 로컬 패키지 묶음을 만들고, 게시 전에 그 묶음으로 빈 디렉터리와 기존 프로젝트의 설치·업데이트·실패 복구를 검증한다. 이 단계에는 npm 게시가 필요하지 않다.
4. 배포 README와 하네스 자체의 라이선스·외부 코드 고지를 확정한 뒤 npm 계정으로 `npm publish`를 실행한다. 이미 게시한 같은 이름·버전 조합은 다시 게시하지 않고 다음 버전을 사용한다.
5. 게시된 버전의 `bunx loomforwork@latest install` 동작을 확인한다.

### 대상 프로젝트에 반영하는 파일과 데이터

현재 저장소의 추적 파일과 하네스 코드의 경로 참조를 대조한 결과, **초기 설치 때 대상 프로젝트에 추가·수정해야 할 위치**는 다음과 같다. `lfw/` 이외의 파일도 같은 npm 패키지 안의 원본·설정 양식에서 설치기가 반영한다.

| 대상 위치 | 설치기의 처리 | 배포 패키지의 원본 |
| --- | --- | --- |
| `lfw/**` | 배포할 코드·스크립트·MemoryGraph·잠금 파일·문서를 새 디렉터리에 설치 | 아래 파일 배치표에 정한 원본 파일 |
| `.agents/skills/<스킬명>/**` | 선택된 하네스 스킬 디렉터리를 복사. 같은 이름의 기존 스킬은 충돌로 중단 | `lfw/skills/<스킬명>/**` |
| 루트 `AGENTS.md` | 없으면 생성, 있으면 맨 위의 하네스 표시 구획에 지침 전문을 삽입하고 기존 내용을 보존 | 이 개발 저장소의 루트 `AGENTS.md` |
| 루트 `.gitignore` | 없으면 생성, 있으면 맨 위에 하네스 무시 규칙 구획을 삽입 | 설치기에 포함한 무시 규칙 |
| `.codex/hooks.json` | 없으면 생성, 있으면 기존 JSON에 네 하네스 훅 항목만 병합 | 하네스 훅 설정 양식. 기존 파일을 통째로 복사하지 않음 |
| `.codex/config.toml` | 없으면 생성, 있으면 두 MCP 서버 항목만 병합. `cwd`에 대상 `lfw/` 절대 경로를 넣음 | MCP 설정 양식. 개발 저장소의 개인 절대 경로를 복사하지 않음 |
| `lfw/install.json` | 모든 설치·검증이 성공한 마지막 단계에 생성 | 배포 패키지에는 없음 |
| Git 저장소와 `<git-common-dir>/harness-data/` | 대상 루트의 Git 저장소를 준비·검증하고 공유 DB를 생성·검증 | DB 스키마는 배포 파일에 포함. 실제 DB·Binding·Review Plan은 패키지에 없음 |
| `lfw/.venv/`, `lfw/vendor/memory-graph/ts/node_modules/` | 잠금 파일에 맞춰 의존성을 설치하며 생성 | 생성물은 배포 패키지와 Git 추적에서 제외 |

`lfw/runtime/selections/`의 선택기 임시 파일과 Git 공통 디렉터리의 Binding·Review Plan은 실제 작업 중 필요할 때 생성한다. `mvp-to-prd`·`verify-prd`·`extract-features` 스킬이 사용하는 `docs/prd/`·`docs/feature-candidates/`는 작업 산출물 경로이며 초기 설치 파일이 아니다. 빈 디렉터리에서는 Git 초기화로 `.git`도 생긴다. **현재 구현 기준으로 위 목록 이외에 설치 시 반드시 추가·수정할 프로젝트 파일은 확인되지 않았다.**

### 설치 명령과 설치 결과

설치기는 npm 패키지의 CLI로 배포하고 사용자는 대상 프로젝트에서 `bunx loomforwork@latest install` 형태의 **한 줄 명령**으로 실행한다. `bunx`가 내려받아 실행하는 설치기는 일시적인 도구이며, 설치 후 하네스 코드는 대상 프로젝트의 `lfw/`에 남는다. 사용자에게 하네스 저장소를 별도로 clone하도록 요구하지 않는다.

배포 패키지 버전과 해당 패키지에 담긴 하네스 버전은 같은 번호로 맞춘다. `install` 명령은 유효한 `lfw/install.json`이 있으면 기록된 `harness_version`(설치된 하네스 버전)과 실행 중인 패키지 버전만 비교한다. 버전이 같으면 파일의 존재나 내용은 검사·수정하지 않고 설치할 것이 없다고 알린 뒤 종료한다. 이때 파일 수정이 허용된다는 뜻은 아니며, 같은 버전의 `install`은 수정 여부를 검사하지 않는다. 실행 중인 패키지가 더 새 버전이면 자동 적용하거나 `y/n`을 묻지 않고 `bunx <배포 패키지명>@latest update`를 안내하며 종료한다. 실행 중인 패키지가 더 오래된 버전이면 자동으로 낮추지 않고 버전 차이를 알린다. 실제 업데이트는 사용자가 별도 `update` 명령을 실행할 때만 시작한다. 같은 버전을 다시 덮어쓰는 재설치 명령은 초기 범위에서 제공하지 않는다.

첫 배포의 지원 운영체제는 macOS다. 설치기는 **대상 프로젝트를 변경하기 전에** 최소 실행 조건을 먼저 검사한다. macOS 여부와 Git 명령, Bun(설치기와 기억 기능의 실행기), `uv`(Python 의존성 관리자), `fzf`(WorkItem 선택기에 쓰는 별도 실행 프로그램), 하네스가 요구하는 Python 버전(현재 `>=3.10`)을 사용할 수 있는지 확인한다. 하나라도 부족하면 빠진 항목과 필요한 설치·버전 조건을 알려주고 설치를 시작하지 않는다. `fzf`가 없으면 `brew install fzf`를 안내한다. 모두 충족되면 추가 확인 단계 없이 설치를 계속한다. 기본 도구 자체를 설치기가 시스템에 자동 설치하지는 않는다. 단, Bun이 아예 없으면 `bunx` 명령도 시작할 수 없으므로 GitHub README의 설치 안내에서 Bun을 설치 명령보다 앞에 필수 조건으로 명시한다. Git·`uv`·`fzf`·Python 버전 조건도 같은 README에 함께 안내한다.

현재 WorkItem 선택기는 macOS의 기본 `Terminal.app`을 호출한다. 지원 운영체제의 기본 구성으로 가정하며 설치 전 별도 필수 프로그램 검사 항목으로 두지 않는다.

최초 설치에서 설치기는 대상 프로젝트의 Git 저장소를 준비·검증하고, 배포 파일을 `lfw/`에 놓은 뒤 기존 `.codex/` 설정과 `AGENTS.md`·`.gitignore`를 정해진 규칙으로 연결한다. 하네스 스킬은 `.agents/skills/`에 배치한다. **설치기는 하네스 전용 Python 의존성과 MemoryGraph의 Bun 의존성을 직접 설치·검증해야 하며, 이 단계를 사용자에게 별도 명령으로 남기지 않는다.** 성공한 설치의 마지막 단계에서 `lfw/install.json`을 생성한다. 배포 패키지에는 `install.json`, `state.db`(작업 상태 DB), `memorygraph.db`(장기 기억 DB), Runtime Binding(세션·Run 연결 파일), Review Plan(도구 기록 검토 파일)을 담지 않는다. DB와 실행 상태는 각 대상 프로젝트의 Git 공통 디렉터리 아래 `harness-data/`에 두며, 업데이트 때 기존 데이터를 보존한다.

### DB 초기화 시점

설치 과정에서 의존성 준비가 끝난 뒤, Git 공통 디렉터리의 `harness-data/`에 `state.db`와 `memorygraph.db`가 없으면 각각 필요한 스키마로 생성한다. 이미 있으면 새 DB로 덮어쓰거나 초기화하지 않고 스키마 버전과 기본 접근 가능 여부를 확인한다. 생성·검증에 실패하면 설치 성공으로 보고하지 않고 `install.json`도 생성하지 않는다. 따라서 설치 완료 직후 두 DB를 바로 사용할 수 있어야 한다. Runtime Binding과 Review Plan은 실제 Run에서 필요할 때 생성하며 배포물에는 포함하지 않는다.

### 설치 실패와 복구

1. **임시 완성본 준비:** 설치기는 대상 파일을 직접 편집하기 전에 하네스 코드와 의존성을 임시 위치에 준비한다. `AGENTS.md`, `.gitignore`, `.codex/hooks.json`, `.codex/config.toml` 등 기존 파일에 내용을 더해야 할 때는 사용자 내용을 보존한 완성본을 임시 파일로 만든다. 이 단계에서 파일 형식과 의존성을 확인한다. 실제 Codex 연결은 최종 위치에 반영한 뒤 검사한다.
2. **백업 후 반영:** 바꿀 기존 파일의 원본을 백업하고, 설치기가 새로 만드는 파일과 기존 파일을 교체하는 순서를 기록한다. 준비한 완성본을 최종 위치에 적용한 뒤 DB 생성·검증과 최종 연결 검사를 수행한다. 기존 DB는 덮어쓰지 않는다.
3. **실패 시 복구:** 최종 위치에 반영하는 중 또는 최종 검사에서 실패하면 이번 설치가 교체한 파일은 백업본으로 복원하고, 이번 설치가 새로 만든 파일은 제거한다. 설치 전부터 있던 DB는 보존한다. 이번 설치에서 처음 만든 DB는 설치 실패 시 제거한다. 복구도 실패하면 남은 변경과 백업 위치를 명확히 알리고 성공으로 처리하지 않는다.
4. **성공 표시:** 모든 단계가 성공한 뒤에만 `lfw/install.json`을 마지막으로 생성한다. 실패 시에는 완료 기록을 만들지 않는다. 복구가 끝났다면 같은 명령으로 다시 설치를 시도할 수 있다.

### 의존성 버전 고정

하네스의 각 배포 버전에는 그 버전에서 검증한 `uv.lock`(Python 라이브러리 잠금 파일)과 MemoryGraph의 `ts/bun.lock`(Bun 패키지 잠금 파일)을 함께 넣는다. 설치기는 `lfw/`에서 `uv sync --locked`를, `lfw/vendor/memory-graph/ts/`에서 `bun install --frozen-lockfile`을 실행해 잠금 파일에 기록된 라이브러리 버전을 설치한다. 선언 파일과 잠금 파일이 맞지 않으면 임의로 새 버전을 선택하거나 잠금 파일을 다시 쓰지 않고 설치 실패를 알린다. 라이브러리 버전 변경은 새 하네스 배포 버전의 잠금 파일을 갱신해 검증한 뒤 제공한다.

두 잠금 파일은 사용자의 `uv`·Bun 실행기 버전을 고정하거나 교체하지 않는다. 실행기 자체와 Python 버전은 위의 설치 전 최소 조건 검사로 다룬다.

### 경로 계산 기준

하네스 내부의 경로 계산은 호출 당시의 작업 디렉터리(`cwd`)나 설치 당시 저장한 절대 경로에 의존하지 않고, 실행 중인 하네스 파일의 위치를 기준으로 한다. 세 기준 경로를 한 곳에서 정의하고 Python 훅·MCP 서버·제어 센터와 Bun 기억 명령에 같은 규칙을 적용한다.

1. **하네스 루트**는 실행 코드가 들어 있는 `lfw/`다. Python은 `lfw/src/harness/`의 모듈 위치, 셸 진입점은 `lfw/bin/`의 스크립트 위치, Bun은 자신의 소스 파일 위치를 기준으로 찾는다. `bin/`, `src/`, `vendor/`, `schema.sql`, `.venv/`, `runtime/selections/` 같은 하네스 내부 경로는 여기에 연결한다.
2. **프로젝트 루트**는 하네스 루트의 부모 디렉터리다. 사용자 파일에 대한 접근과 도구 실행 경계 판단에 사용한다. 하네스를 호출한 셸의 `cwd`나 가장 가까운 `.git` 탐색 결과를 프로젝트 루트로 사용하지 않는다. 설치 시 `lfw/`가 대상 프로젝트 바로 아래에 있는지 확인한다.
3. **Git 공통 디렉터리**는 프로젝트 루트에서 `git rev-parse --path-format=absolute --git-common-dir`로 조회한다. 그 아래 `harness-data/`에 `state.db`(작업 상태 DB), `memorygraph.db`(장기 기억 DB), Runtime Binding(세션과 Run의 연결 파일), Review Plan(도구 기록 검토 파일)을 둔다. 일반 worktree와 연결 worktree 모두 같은 저장소의 공통 디렉터리를 사용한다. 설치 시 로컬 Git 저장소를 먼저 준비하고 `git rev-parse --show-toplevel`이 프로젝트 루트와 같은지 확인한다. Git 조회가 실패하거나 상위 저장소가 대신 발견되면 다른 위치에 DB를 만들지 않고 오류를 알린다.

이에 따라 현재 코드의 프로젝트 루트 상수, `schema.sql`·가상 환경·선택기·기억 실행 파일 경로, `bin/`의 부모를 프로젝트 루트로 보는 셸 진입점, `process.cwd()`에서 `.git`을 찾는 Bun 코드, `.codex/config.toml`의 MCP `cwd`를 새 기준으로 바꿔야 한다. MCP `cwd`는 설치 시 대상 프로젝트의 `lfw/`로 설정한다. 프로젝트 이동이나 다른 컴퓨터에서 기존 절대 경로를 다시 쓰는 협업 초기화는 Draft WI `WI-5efcf3884092`의 후속 범위다.

### 실행 명령 기준

`.codex/hooks.json`의 네 하네스 훅은 현재 worktree의 프로젝트 루트에서 `lfw/bin/harness-*`를 호출한다. 기존 프로젝트의 `bin/harness-*` 경로는 사용하지 않는다. 각 셸 진입점은 자기 파일 위치로 하네스 루트를 찾고 그곳으로 이동한 다음 Python의 `uv run` 또는 Bun 명령을 실행한다. 따라서 하네스의 `pyproject.toml`, `.venv/`, `src/`와 Bun 의존성은 사용자 프로젝트의 같은 이름 파일과 섞이지 않는다. MCP 서버의 `cwd`도 앞에서 정한 하네스 루트를 사용한다. 훅 설치 시 기존 항목과 병합·중복 판단은 아래의 Codex 훅 설치 규칙을 따른다.

### 현재 파일의 배치표

아래 표의 `/**`는 해당 디렉터리 안의 모든 파일을 뜻한다. **배포 제외**는 원본 저장소에서 삭제한다는 뜻이 아니라 설치 대상 프로젝트에 복사하지 않는다는 뜻이다. 새 경로는 설치된 프로젝트 기준이다.

| 현재 경로 | 설치 후 경로 또는 처리 | 범위와 이유 |
| --- | --- | --- |
| `src/__init__.py`, `src/harness/**` | `lfw/src/__init__.py`, `lfw/src/harness/**` | Python 패키지, 훅, MCP 서버, 제어 센터의 정적 파일, TypeScript 기억 코드를 상대 구조 그대로 이동한다. 현재 `src/harness/memory/`는 이미 이동한 `lfw/vendor/memory-graph/`를 참조한다. 이 `src/` 이동 시 상대 import 경로를 최종 위치에 맞게 다시 수정한다. |
| `bin/harness-control-center`, `bin/harness-memory`, `bin/harness-post-tool-use`, `bin/harness-pre-tool-use`, `bin/harness-stop`, `bin/harness-user-prompt-submit` | 각각 `lfw/bin/` 아래 같은 파일명 | 실제 하네스 실행 진입점이다. |
| `bin/orca-harness-state` | `lfw/bin/orca-harness-state` | Git 공통 디렉터리의 상태 백업·복원 명령이다. |
| `.harness/schema.sql` | `lfw/schema.sql` | 배포할 DB 구조 정의다. 실제 DB는 Git 공통 디렉터리에 계속 생성한다. |
| `pyproject.toml`, `uv.lock` | 각각 `lfw/` 아래 같은 파일명 | 하네스 Python 의존성 정의와 잠금 파일을 사용자 프로젝트의 설정에서 분리한다. |
| 현재 루트 `package.json` | 개발 저장소 루트에서 npm 게시용 매니페스트로 개편하고, 설치 시 대상 프로젝트의 `package.json`에는 하네스 명령만 병합 | MemoryGraph 관련 명령은 개발용이다. 설치기는 MemoryGraph 의존성을 직접 준비하고 대상 프로젝트에는 `console`·`verify:install`·`worktree:setup` 명령을 추가한다. |
| `tsconfig.memory.json` | 배포 제외, 개발 저장소에 유지 | 현재 설정의 `include`가 배포하지 않을 `tests/memory/**`를 참조한다. 개발용 타입 검사 설정으로 유지하고 하네스 경로 이동에 맞춰 참조 경로를 수정한다. |
| `.codex/config.toml`, `.codex/hooks.json` | 대상 프로젝트의 같은 경로에 하네스 항목만 병합 | Codex가 읽는 프로젝트 연결 설정이다. 현재 파일을 통째로 덮어쓰지 않는다. |
| `AGENTS.md`, `.gitignore` | 대상 프로젝트의 같은 파일에 하네스 관리 구획·규칙만 병합 | 기존 프로젝트 지침과 무시 규칙을 보존한다. |
| `.agents/skills/work-start/**`, `.agents/skills/work-finish/**`, `.agents/skills/memory-finalize/**`, `.agents/skills/work-item-create/**` | 각 디렉터리를 `lfw/skills/<스킬명>/**`로 이동하고, 설치 시 대상 `.agents/skills/<스킬명>/**`에 반영 | 하네스의 WorkItem·Run 운영에 직접 필요한 스킬이다. 같은 이름의 기존 스킬은 덮어쓰지 않고 충돌로 보고한다. |
| `.agents/skills/mvp-to-prd/**`, `.agents/skills/verify-prd/**` | 각 디렉터리를 `lfw/skills/<스킬명>/**`로 이동하고, 설치 시 대상 `.agents/skills/<스킬명>/**`에 반영 | MVP 문서를 PRD로 전환하고 결과를 원본과 대조하는 필수 스킬이다. 각 디렉터리의 `SKILL.md`와 `LICENSE`를 함께 포함한다. |
| `.agents/skills/extract-features/**` | `lfw/skills/extract-features/**`로 이동하고, 설치 시 대상 `.agents/skills/extract-features/**`에 반영 | PRD에서 Feature·WorkItem 후보를 추출하는 기본 설치 스킬이다. `SKILL.md`와 `LICENSE`를 함께 포함한다. |
| `docs/harness-overview.md`, `docs/draft-work-items.md`, `docs/implementation-units.md`, `docs/long-term-memory-schema.html`, `docs/long-term-memory.html`, `docs/mcp-state-store-functions.html`, `docs/single-request-pipeline.html`, `docs/state-store.html` | 각 파일을 `lfw/docs/` 아래 같은 파일명으로 이동 | 하네스 사용·운영 문서와 서로 참조하는 상세 문서다. 이동 후 내부 링크와 경로 표기를 수정한다. |
| `tests/**` | 배포 제외, 원본 개발 저장소의 `tests/**` 유지 | 하네스 개발·회귀 검증용이다. 대상 프로젝트의 `tests/`와 합치지 않는다. |
| `design/**`, `docs/research/**`, `docs/designs/**` | 배포 제외, 원본 개발 저장소에 유지 | 설계 이력·조사·목업이다. 대상 프로젝트의 `design/`, `docs/`와 합치지 않는다. |
| `docs/docs-index.html`, `docs/viewer.html`, `CONTEXT.md` | 개발 저장소에서 제거 | 옛 파일 위치를 참조하는 문서 탐색 UI와 용어집이며 배포 문서의 필수 구성 요소가 아니다. |
| `bin/migrate-harness-shared-data` | 배포 제외, 원본 개발 저장소의 `bin/` 유지 | 현재 저장소의 과거 worktree 데이터 이전용이다. 신규 설치에 사용하지 않는다. |
| `bin/codex-last-turn-tokens`, `bin/token-cost-current.py`, `bin/token-cost-legacy.py`, `bin/token_cost_compare_common.py` | 배포 제외, 원본 개발 저장소의 `bin/` 유지 | 비용 분석·개발 보조 명령이다. |
| `skills-lock.json` 및 아래에 이름을 열거한 나머지 `.agents/skills/<스킬명>/**` | 배포 제외, 원본 개발 저장소에 유지 | 외부 범용 스킬 설치 기록과 하네스 실행에 필요하지 않은 스킬이다. |
| `tmp/**`, `.harness/backups/**`, `.harness/runtime/test-data/**`, `output/playwright/**`, `.playwright-cli/**`, `.pytest_cache/**`, `.venv/**`, `__pycache__/**` | 배포 제외 | 과거 DB 백업, 테스트 데이터, 브라우저 실행 기록 등 임시 산출물·로컬 환경이다. 대상 프로젝트에 복사하지 않는다. |

`lfw/vendor/`에는 기존 `vendor/`의 MemoryGraph와 ai-prd-workflow 원본을 일반 파일로 옮겨 둔다. 각 원본의 `LICENSE`·출처 고지는 유지하고 npm 패키지에도 포함한다. 실행 의존성 생성물인 `memory-graph/ts/node_modules/`와 Git 서브모듈 메타데이터는 배포 파일에서 제외한다. ai-prd-workflow는 참고 원본이며 설치된 하네스가 실행에 사용하지 않는다.

`lfw/runtime/selections/`는 각 worktree에 생성되는 임시 파일이고, `state.db`·`memorygraph.db`·Binding·Review Plan은 위 트리의 Git 공통 디렉터리에만 둔다. 배치표의 배포 경로 이전은 원본 저장소에 반영했다.

배포하지 않는 스킬 디렉터리의 정확한 이름은 `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-me`, `grill-with-docs`, `grilling`, `handoff`, `implement`, `improve-codebase-architecture`, `prototype`, `research`, `resolving-merge-conflicts`, `setup-matt-pocock-skills`, `tdd`, `teach`, `to-questionnaire`, `to-spec`, `to-tickets`, `triage`, `wait-what`, `wayfinder`, `wizard`, `writing-for-agents`다. 각 디렉터리의 `SKILL.md`, 보조 문서, 스크립트, `agents/openai.yaml`도 같은 처리 대상이다.

### MemoryGraph 배포 방식

대상 프로젝트에는 MemoryGraph를 **Git 서브모듈이 아닌 일반 파일**로 설치한다. 현재 하네스가 사용하는 원본은 `memory-graph/memory-graph`의 v0.13.0, 커밋 `67fc4f97816aa75823ae2dd4eff49f150cc6f1da`이다. 개발 저장소에서도 `lfw/vendor/memory-graph/`에 일반 파일로 두며, 원본 `LICENSE`와 `UPSTREAM.md`를 함께 배포한다. MemoryGraph의 MIT 라이선스에 따라 원본 저작권 표시와 라이선스 전문을 보존한다. 대상 프로젝트의 `.gitmodules`나 Git 인덱스에는 MemoryGraph 서브모듈 항목을 추가하지 않는다.

이 방식은 대상 프로젝트의 기존 Git 설정을 덜 건드리고, 이후 프로젝트를 복제할 때 별도의 서브모듈 초기화를 요구하지 않는다. MemoryGraph 소스가 대상 프로젝트의 일반 파일로 들어가므로 하네스 배포물의 크기와 추적 파일 수는 늘어난다. 배포 시에는 원본 커밋과 포함 파일의 출처를 기록한다. 설치된 MemoryGraph 파일도 다른 `lfw/` 배포 파일과 같은 업데이트 규칙을 따른다. Bun 의존성은 배포한 `ts/package.json`·`ts/bun.lock`을 사용해 설치하며 `node_modules/`는 배포하지 않는다.

### Git 무시 규칙

대상 프로젝트 루트의 `.gitignore`에 다음 구획을 맨 위에 추가한다. 파일이 없으면 새로 만든다. 모든 패턴은 프로젝트 루트의 `lfw/` 아래에만 적용한다.

```gitignore
# lfw:start
/lfw/.venv/
/lfw/**/node_modules/
/lfw/runtime/selections/
/lfw/**/__pycache__/
/lfw/**/*.py[cod]
# lfw:end
```

현재 하네스가 프로젝트 안에 생성하는 파일 중 Git에서 제외할 것은 Python 가상 환경, Bun 설치 패키지, 선택기 임시 파일, Python 캐시다. 하네스 코드·MemoryGraph 소스와 라이선스·잠금 파일·`install.json`·Codex 설정·설치된 스킬은 하네스 구획에서 무시하지 않는다. `state.db`·`memorygraph.db`와 Runtime Binding·Review Plan은 Git 공통 디렉터리에 있어 프로젝트 루트의 무시 규칙에 넣지 않는다. 설치 중 임시 완성본과 백업은 프로젝트의 추적 대상 경로에 남기지 않는다. 기존 프로젝트의 다른 `.gitignore` 규칙이 하네스 파일을 무시하더라도 설치기가 이를 차단하거나 사용자의 규칙을 자동 변경하지 않는다.

### 기존 파일에 내용을 넣는 규칙

1. 대상 `AGENTS.md` 또는 `.gitignore`가 없으면 새로 만든다. 이미 있으면 기존 내용의 **맨 위**에 하네스 내용을 넣고 나머지 내용을 보존한다.
2. 최초 설치에서 같은 지침이나 무시 규칙을 중복 추가하지 않는다. 하네스가 넣은 구획의 시작·끝 표시로 해당 파일의 연결 여부를 확인한다. `AGENTS.md`는 `<!-- lfw:start -->`와 `<!-- lfw:end -->`, `.gitignore`는 `# lfw:start`와 `# lfw:end`를 사용한다.
3. 사용자는 표시 안의 지침과 무시 규칙을 자유롭게 수정할 수 있다. `update`는 이 두 파일을 자동 수정하지 않는다.

설치용 하네스 지침은 배포 버전을 만들 때의 이 개발 저장소 루트 `AGENTS.md` **전문**을 사용한다. 설치기는 이 전문을 대상 프로젝트 루트 `AGENTS.md`의 `<!-- lfw:start -->`와 `<!-- lfw:end -->` 사이에 넣는다. 대상 프로젝트에 기존 지침이 있으면 구획 아래에 보존한다. 현재 원본에는 설계 문서 저장 위치 지침이 없으며, `Harness MCP 도구 추가` 검토 지침은 포함된다.

### 공유 파일의 업데이트 정책

`AGENTS.md`, `.gitignore`, `.codex/hooks.json`, `.codex/config.toml`은 기존 프로젝트와 하네스가 함께 쓰는 파일이다. 최초 설치 때만 하네스 구획 또는 항목을 병합한다. 초기 `update`는 이 네 파일을 바꾸지 않아도 새 하네스가 작동하는 버전에만 허용하며, 기존 내용을 자동으로 수정하거나 병합하지 않는다. 새 버전에서 공유 파일의 변경이 필수라면 기존 설치본의 `update`를 대상 프로젝트 변경 전에 거부하고, 필요한 파일과 변경사항을 알린다. 이때 `install.json`의 `harness_version`은 이전 버전으로 유지한다. 새 프로젝트에 해당 버전을 최초 설치하는 것은 가능하다. 구획별·항목별 설치 당시 해시는 초기 버전의 `install.json`에 기록하지 않는다. 사용자의 수정을 자동 판별하거나 수동 반영 완료를 자동 확인하는 절차도 초기 범위에 포함하지 않는다.

배포 전에 새 버전이 이전 설치본의 공유 파일 설정과 호환되는지 확인해야 한다. 호환되지 않는 버전의 기존 설치본 이전 방법과 사용자의 수동 반영 확인 절차는 Draft WI `WI-a80d862479e3`에서 설계한다.

### 공유 DB의 업데이트 정책

초기 `update`는 Git 공통 디렉터리의 기존 `state.db`와 `memorygraph.db`의 스키마(테이블·필드 구조)를 변경하지 않아도 새 하네스가 작동하는 버전에만 허용한다. 새 버전에서 DB 구조 변경이 필수라면 파일 교체나 의존성 설치 등 대상 프로젝트 변경 전에 업데이트를 중단하고 이유를 알린다. 기존 DB와 `install.json`의 `harness_version`은 유지한다. 새 프로젝트의 최초 설치에는 해당 버전의 DB 구조를 사용할 수 있다. 기존 DB의 이전·검증·복구 절차는 후속으로 설계한다.

`install` 명령은 `lfw/install.json`을 설치 여부와 버전 확인의 기준으로 사용한다. 파일이 있으면 같은 버전의 하네스 코드·스킬·설정 파일이 수정·삭제됐는지 검사하지 않는다. 파일이 없으면 최초 설치 절차를 시작하되 기존 파일과 이름이 충돌하면 별도 규칙에 따라 중단한다. `install.json`은 **배포 원본에는 없고**, 최초 설치가 성공적으로 끝난 **마지막 단계**에서 대상 프로젝트에 생성한다.

`install.json`의 형식은 다음과 같다.

```json
{
  "format_version": 1,
  "harness_version": "0.1.0",
  "integrations": [
    "AGENTS.md",
    ".gitignore",
    ".codex/config.toml",
    ".codex/hooks.json"
  ],
  "managed_files": {
    "bin/harness-stop": "sha256:<설치된 파일 내용의 해시>",
    "src/harness/state_store.py": "sha256:<설치된 파일 내용의 해시>",
    "vendor/memory-graph/LICENSE": "sha256:<설치된 파일 내용의 해시>"
  },
  "installed_skills": {
    "work-start": "sha256:<설치된 디렉터리 내용의 해시>",
    "work-finish": "sha256:<설치된 디렉터리 내용의 해시>"
  }
}
```

`format_version`은 설치 기록 형식의 버전, `harness_version`은 설치한 하네스의 버전이다. `integrations`는 실제로 연결한 프로젝트 루트 파일의 상대 경로다. `managed_files`는 `lfw/`에 설치한 배포 파일의 상대 경로와 설치 완료 시점의 실제 내용 해시다. 실행 코드·스크립트뿐 아니라 배포 문서, 스킬 원본, MemoryGraph 소스·라이선스, 잠금 파일도 해당한다. 별도의 필수 파일 목록을 중복해서 저장하지 않는다. `installed_skills`는 대상 `.agents/skills/`에 설치한 스킬 사본의 디렉터리 내용 해시다. 두 해시 기록은 새 버전으로 업데이트할 때 사용자 수정을 구분하기 위한 것으로, 같은 버전의 `install` 명령에서는 비교하지 않는다. 위 해시 문자열은 형식 설명을 위한 자리표시자다. 절대 경로, 설치 시각, 사용자 정보, DB 내용은 기록하지 않는다. 대상 프로젝트에서는 이 파일을 `.gitignore`로 제외하지 않고 Git에 커밋할 수 있게 한다. 원본 하네스 저장소에는 생성된 `install.json`을 추적하지 않는다.

각 하네스 배포 버전은 설치기가 관리할 파일 경로 목록을 미리 확정한다. 최초 설치는 이 목록대로 파일을 배치하고, 성공한 최종 위치의 실제 내용을 해시해 `install.json`의 `managed_files`에 기록한다. 새 버전에서는 관리 파일 목록이 추가·삭제될 수 있다. 대상 프로젝트의 `AGENTS.md`·`.gitignore`·`.codex/` 공유 파일, 공유 DB, 생성된 가상 환경과 캐시, `install.json` 자신은 `managed_files`에 넣지 않는다. 대상 `.agents/skills/`의 스킬 사본은 `installed_skills`로 별도 관리한다.

### 배포 파일과 설치 스킬의 업데이트 규칙

사용자 프로젝트의 `lfw/`에 들어간 정적 배포 파일과 대상 `.agents/skills/`에 설치한 하네스 스킬 사본은 설치기가 관리한다. 사용자가 직접 수정할 수는 있지만, 수정한 설치본은 이후 자동 업데이트 대상이 아니다. 설치기는 수정사항을 새 버전과 병합하거나 일부 파일만 갱신하지 않는다.

1. `update`는 `install.json`의 유효성과 설치 버전을 확인하고, 실행 중인 패키지의 `installer/update-compatibility.json`에서 `compatible_from`을 읽는다. 설치된 `harness_version`이 목록에 정확히 있지 않거나 호환성 파일이 없거나 유효하지 않으면 대상 프로젝트를 변경하기 전에 이유를 알리고 중단한다. 이어 파일 교체나 의존성 설치 등 대상 프로젝트를 변경하기 **전에** `managed_files`의 모든 배포 파일과 `installed_skills`의 모든 스킬 사본의 존재 여부·현재 해시를 매번 검사한다. 어느 하나라도 삭제됐거나 해시가 다르면 해당 경로를 알리고 업데이트 전체를 중단한다. 두 경우 모두 `install.json`은 바꾸지 않는다. `work-start`·`work-finish`와 PRD·Feature 관련 스킬에 같은 해시 규칙을 적용한다.
2. 검사에 통과하면 새 배포 버전의 관리 파일·설치 스킬 목록을 기준으로 추가·교체·삭제를 준비한다. 새 경로에 설치기가 소유하지 않은 기존 파일이나 스킬이 있으면 덮어쓰지 않고 충돌을 알린다. 준비와 적용에는 위의 백업·복구 원칙을 사용한다. 공유 DB와 프로젝트 공유 파일은 배포 파일 교체 대상이 아니다.
3. 의존성 설치·최종 검사까지 성공한 뒤 새 배포 파일과 스킬 사본의 실제 해시 및 새 `harness_version`을 `install.json`에 기록한다. 실패하면 교체한 파일·스킬을 복구하고 이전 설치 기록을 유지한다.

수정된 파일·스킬에 대한 diff 보고서, 자동 병합, 부분 업데이트, 수정본을 승인해 계속 업데이트하는 예외 절차는 초기 범위에 넣지 않는다. 사용자가 만든 하네스 변경은 그대로 보존한다. 수정된 설치본을 설치 당시 원본으로 되돌리면 다음 `update`의 해시 검사에 통과할 수 있다. `AGENTS.md`·`.gitignore`·`.codex/`처럼 프로젝트와 공유하는 파일은 이 해시 검사 대상이 아니며, 앞서 정한 공유 파일 정책을 따른다.

### 스킬 최초 설치와 같은 버전의 재실행

기본 설치 스킬 7개의 범위는 위 배치표를 따른다. 최초 설치에서 대상 `.agents/skills/<스킬명>/`이 이미 있으면 기존 스킬을 덮어쓰지 않고 이름 충돌을 알린다. 같은 버전의 `install` 재실행은 버전만 확인하고 종료하므로 스킬의 내용이나 존재 여부도 검사하지 않는다. 새 버전의 `update`에서만 위의 사전 검사를 수행한다.

### Codex 훅 설치 규칙

1. 하네스 스크립트는 `lfw/bin/`에 별도 파일로 설치한다. 기존 프로젝트의 훅 스크립트 파일은 수정하지 않는다. `.codex/hooks.json`이 없으면 새로 만들고, 있으면 기존 JSON과 훅 항목을 보존한 채 `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` 이벤트에 하네스 훅 항목을 각각 독립적으로 추가한다.
2. 최초 설치에서 훅을 연결할 때는 **이벤트 이름과 `lfw/bin/harness-*`를 호출하는 명령**을 함께 확인한다. 같은 이벤트에 같은 하네스 명령이 이미 있으면 추가하지 않는다. `install.json`에는 `.codex/hooks.json`을 연결 파일로 기록한다. 이후 `install` 재실행과 `update`는 기존 훅 항목을 자동 추가·수정·삭제하지 않는다.
3. 새 하네스 훅 항목은 각 이벤트 배열에서 기존 항목 **앞**에 배치한다. 이 위치는 설치 파일의 배치 규칙이며, 여러 훅의 실제 상대 실행 순서에 하네스 동작을 의존시키지 않는다. 작업 승인과 기록에 쓰는 하네스 훅은 동기 실행으로 둔다.

### MCP 서버 최초 설치와 이름 충돌 규칙

`harness-state`와 `harness-memory`는 하네스 스킬이 사용하는 MCP 서버 이름이다. 이름만 같다고 기존 설정을 우리 하네스의 것으로 판단하지 않는다.

1. `install.json`이 없는 최초 설치에서 같은 이름의 서버 항목이 이미 있으면 소유자를 확인할 수 없으므로 기존 항목을 덮어쓰거나 다른 이름으로 자동 변경하지 않는다. 해당 MCP 서버 연결을 중단하고 이름 충돌을 알린다.
2. 최초 설치에서 같은 이름의 서버 항목이 없으면 하네스 실행 명령과 대상 프로젝트의 `lfw/` 경로를 사용해 새 항목을 추가하고 `.codex/config.toml`을 `install.json`의 연결 파일로 기록한다.
3. 이후 같은 버전의 `install` 재실행과 새 버전의 `update`는 기존 MCP 항목을 자동 추가·수정·삭제하지 않는다. 새 버전에서 설정 변경이 필요하면 위의 공유 파일 업데이트 정책에 따라 알린다.

설치 시 두 서버의 `cwd`(MCP 서버 프로세스의 실행 폴더)는 대상 프로젝트의 `lfw/` 절대 경로로 생성한다. 프로젝트 이동·다른 컴퓨터나 worktree에서의 절대 경로 재생성과 Git을 통한 DB 공유는 현재 개인용 템플릿화 범위에서 해결하지 않는다. 협업 확장 Draft WI `WI-5efcf3884092`에서 다룬다.

## 결정해야 할 사항

1. **공유 파일의 필수 변경:** 초기 `update`에서 제외한, 공유 파일 변경이 필수인 버전의 기존 설치본 이전 방법과 수동 반영 확인 방법을 정한다. Draft WI `WI-a80d862479e3`에서 다룬다.
2. **DB 스키마 변경:** 초기 `update`에서 제외한, 공유 DB 구조 변경이 필수인 버전의 기존 DB 검증·이전·복구 절차를 정한다. 기존 DB를 보존한다는 원칙은 유지한다.
3. **제거:** 첫 배포에서는 제거 명령과 절차를 제공하지 않는다. 설치된 파일·연결 설정과 Git 공통 디렉터리의 공유 데이터를 어떤 범위까지 제거할지는 후속으로 정한다.

## 구현 과제

1. 파일 배치표에 따라 배포 파일과 스킬 원본을 `lfw/` 구조로 옮기고, 사용자 프로젝트의 파일과 분리한다.
2. 하네스 루트·프로젝트 루트·Git 공통 디렉터리의 계산, 훅·MCP 실행 명령, 문서 링크를 새 경로로 바꾼다.
3. 최소 조건 검사, 의존성 설치, DB 초기화, 기존 프로젝트 파일 병합, 백업·복구, 마지막 `install.json` 생성까지 최초 설치 흐름을 구현한다.
4. 같은 버전의 `install` 명령은 버전만 확인하고 종료하게 하고, `update`에는 관리 파일·설치 스킬 사전 검사와 전체 중단·복구 규칙을 적용한다. 프로젝트 공유 파일에는 별도로 정한 정책을 적용한다.

## 현재 자료

- WI `WI-41e8e419a6ce`의 메모 **「템플릿화를 위한 파일 분류 초안」**: 현재 파일의 잠정 분류와 우선 확인 지점.
- 현재 `.codex/config.toml`에는 개발 환경의 절대 경로가 있고, `.codex/hooks.json`은 프로젝트 루트의 `bin/`을 호출한다.
- `src/harness/` 일부는 코드 위치를 기준으로 프로젝트 루트를 계산한다. 따라서 배치 방식에 따라 경로 처리 검토가 필요하다.

## 다음 단계

현재 코드와 설정에서 프로젝트 루트·실행 파일·의존성 경로를 참조하는 위치를 조사한다. 이어서 정한 배포 패키지 구조와 CLI 진입점을 구현하고, 게시 전 파일 목록과 설치 동작을 검증한다.

## 용어

- **하네스 실행 코드**: 훅, MCP 서버, 상태 저장소와 UI를 실행하는 프로그램.
- **프로젝트별 작업 데이터**: WorkItem(작업 항목), Run(한 번의 작업 실행)과 그 결과를 담는 로컬 상태.
- **훅**: Codex의 요청·도구 실행 시점에 호출되는 명령.
- **MCP 서버**: Codex에 하네스 도구를 제공하는 프로세스.
