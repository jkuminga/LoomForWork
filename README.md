<div align="center">

# Codex Compass
![Codex Compass 메인 이미지](../../assets/readme-hero-image.png)

> Codex의 프로젝트 작업을 WI(작업 항목), Run(실행 기록), 장기 기억으로 이어 주는 하네스


Codex Compass를 설치하면 프로젝트 안에 하네스 코드와 스킬이 놓입니다. 새 디렉터리에서도, 이미 코드가 있는 Git 프로젝트에서도 시작할 수 있습니다. 작업 상태와 장기 기억은 같은 저장소의 여러 worktree가 공유하는 Git 공통 디렉터리에 보관합니다.

</div>

## 개요

## 시작하기 전에
### 사전 요구 사항

첫 배포는  macOS를 지원합니다. 설치할 컴퓨터에는 Git, Bun(`bunx` 포함), `uv`, Python 3.10 이상, `fzf`가 있어야 합니다. `uv`는 하네스의 Python 의존성을 설치하고, `fzf`는 터미널에서 WI를 고르는 데 쓰입니다. `fzf`가 없다면 `brew install fzf`로 설치할 수 있습니다.

설치기는 필요한 도구를 먼저 확인합니다. 빠진 항목이 있으면 이름을 알려주고 설치를 시작하지 않습니다.

## 설치

하네스를 적용할 **프로젝트 루트**에서 실행합니다. 기존 Git 프로젝트라면 저장소의 최상위 디렉터리여야 합니다. 빈 디렉터리에서는 설치기가 Git 저장소를 만듭니다.

```bash
bunx codex-compass-harness@latest install
```

설치기는 `codex-compass/`에 하네스 파일을 놓고 Python·MemoryGraph 의존성을 준비합니다. 기존 `AGENTS.md`, `.gitignore`, `.codex/` 설정이 있으면 필요한 하네스 항목을 추가합니다. 설치가 끝나면 Codex를 새 세션으로 열어 설정과 스킬을 읽게 하세요.

## 첫 작업 시작하기

Codex에 `w/`로 시작하는 작업 요청을 보내면 하네스가 WI 선택 흐름을 엽니다. WI는 할 일을 기록한 항목이고, Run은 선택한 일을 수행하는 한 번의 실행입니다.

```text
w/ 이번에 선택한 작업을 진행해줘
```

선택한 WI가 Draft(아직 구체화하지 않은 초안)라면 먼저 내용을 구체화합니다. 작업이 시작되면 하네스 스킬이 진행과 마무리 절차를 안내하고, Run에는 수행 결과와 검증 근거를 남깁니다.

## 웹 콘솔

프로젝트 루트에서 웹 콘솔을 실행할 수 있습니다.

```bash
./codex-compass/bin/harness-control-center
```

터미널에 표시된 주소를 브라우저에서 여세요. 기본 포트는 `8765`이며, 이미 사용 중이면 빈 포트를 찾아 실제 주소를 출력합니다. 웹 콘솔에서는 WI와 Run을 살펴보고 Draft WI를 만들 수 있습니다.

## 선택 기능: PreToolUse

기본 설치는 `UserPromptSubmit`, `PostToolUse`, `Stop` 훅을 연결합니다. 훅은 Codex가 특정 시점에 실행하는 스크립트입니다. 도구 실행 전 작업 허용 여부를 검사하는 `PreToolUse` 스크립트도 설치하지만, 처음에는 훅에 연결하지 않습니다.

도구 실행 전 검사가 필요하면 프로젝트 루트에서 켜세요.

```bash
./codex-compass/bin/harness-pre-tool-use-config enable
```

다시 끄려면 다음 명령을 실행합니다.

```bash
./codex-compass/bin/harness-pre-tool-use-config disable
```

변경 후 Codex의 `/hooks`에서 등록 상태를 확인할 수 있습니다. PreToolUse를 켜면 도구를 사용할 때마다 추가 검사가 실행됩니다.

## 설치 파일과 데이터

| 위치 | 쓰임 |
| --- | --- |
| `codex-compass/` | 하네스 코드, 실행 스크립트, 포함된 외부 소스, 설치 기록 `install.json` |
| `.agents/skills/` | `work-start`, `work-finish` 등 Codex가 읽는 하네스 스킬 6개 |
| `.codex/config.toml` | `harness-state`, `harness-memory` MCP 서버 설정. MCP 서버는 Codex가 작업 상태와 기억에 접근하는 연결 프로그램입니다. |
| `.codex/hooks.json` | 기본 훅 3개의 실행 설정 |
| `AGENTS.md`, `.gitignore` | 기존 내용 위에 표시된 하네스 구획을 추가하는 공유 파일 |
| Git 공통 디렉터리의 `harness-data/` | 작업 상태 DB `state.db`, 장기 기억 DB `memorygraph.db`, Run 연결 파일 |

하네스 코드는 프로젝트의 `src/`, `tests/`, `docs/`에 섞이지 않습니다. Git 공통 디렉터리의 DB는 같은 저장소에 연결된 worktree에서 함께 사용합니다.

## 업데이트와 사용자 수정

같은 버전에서 `install`을 다시 실행하면 파일을 바꾸지 않고 종료합니다. 새 버전이 나와도 설치 명령이 자동으로 업데이트하지는 않습니다. 사용자가 업데이트를 선택했다면 다음 명령을 실행합니다.

```bash
bunx codex-compass-harness@latest update
```

설치기는 `install.json`에 기록한 해시(파일 내용이 같은지 확인하는 값)와 현재 하네스 파일·설치된 스킬을 비교합니다. 하나라도 수정되었거나 없어졌다면 업데이트를 중단합니다. 업데이트할 수 있는 이전 버전도 배포 패키지의 호환성 목록에 있어야 합니다.

`AGENTS.md`, `.gitignore`, `.codex/config.toml`, `.codex/hooks.json`은 프로젝트와 함께 쓰는 파일입니다. 업데이트는 이 파일들의 사용자 변경을 덮어쓰지 않습니다. 새 버전이 이 공유 설정이나 DB 구조의 변경을 요구한다면 현재 업데이트 명령은 중단합니다.

## worktree에서 사용하기

Git worktree는 같은 저장소의 다른 브랜치를 별도 디렉터리에서 작업하는 기능입니다. 하네스 DB와 Run 연결 데이터는 Git 공통 디렉터리에 있어 worktree 사이에서 공유됩니다.

설치 과정에서 `.codex/config.toml`의 MCP 서버 실행 경로(`cwd`)에는 설치한 프로젝트의 절대 경로가 들어갑니다. 새 worktree를 만들어도 이 경로는 기존 디렉터리를 가리킬 수 있습니다. 새 worktree의 하네스 코드를 사용하려면 두 MCP 서버의 `cwd`를 새 경로에 맞춰야 합니다. 이를 돕는 자동 설정 스크립트는 후속 작업으로 계획되어 있습니다.

## 문제가 생겼을 때

- **`fzf 명령이 필요합니다`가 표시됩니다:** `brew install fzf`로 설치한 뒤 다시 실행하세요. 다른 필수 도구도 설치기가 이름을 알려줍니다.
- **대상이 Git 저장소 루트가 아니라는 오류가 납니다:** `git rev-parse --show-toplevel`로 루트를 확인하고 그 디렉터리에서 설치하세요.
- **웹 콘솔이 `8765`에서 열리지 않습니다:** 실행 직후 터미널에 출력된 실제 주소로 접속하세요.
- **업데이트가 수정된 파일 때문에 중단됩니다:** `codex-compass/`의 코드 또는 `.agents/skills/`의 설치 스킬이 바뀌었는지 확인하세요. 설치기는 변경된 파일을 덮어쓰지 않습니다.

## 라이선스와 외부 구성요소

Codex Compass는 [MIT 라이선스](../../LICENSE)로 배포할 예정입니다. 함께 포함된 외부 소스의 저작권·출처·라이선스는 `codex-compass/vendor/memory-graph/`와 `codex-compass/vendor/ai-prd-workflow/`의 `LICENSE`, `UPSTREAM.md`에 기록되어 있습니다. 외부 스킬의 고지는 해당 `codex-compass/skills/` 디렉터리의 `LICENSE`에서 확인할 수 있습니다.

<!-- HUMANIZE-SUMMARY
경로: light | 탐지: 뚜렷한 AI 문체 패턴 없음 | 수정: 설명 문장 4곳을 보수적으로 다듬음
자체검증: 사실·명령·경로·수치·고유명사·문서 형식 6/6 확인
-->