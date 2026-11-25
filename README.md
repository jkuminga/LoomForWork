<div align="center">

# LoomForWork
![LoomForWork 메인 이미지](assets/loomforwork-hero.png)

할 일을 정하고, 실행을 기록하고, 배운 것을 다음 작업으로 잇는 Codex 하네스

[English](README.en.md)

</div>

&nbsp;

## 📖 개요
LoomForWork는 Codex의 프로젝트 작업을 정리하고 기록하는 도구입니다. 프로젝트의 기능을 Feature(기능)로, 기능별 할 일을 WI(작업 항목)로 나누어 관리합니다.

Codex에 작업을 요청할 때 관련 WI를 선택하면, Codex는 그 항목의 목표, 완료 조건, 사용자 메모와 이전 Run(실행 기록)을 참고해 작업합니다. 작업을 마칠 때는 수행한 내용과 결과를 기록하고, 이후에도 필요한 정보는 메모리 그래프에 장기 기억으로 저장합니다. 작업 상태와 장기 기억은 세션이 바뀌어도 유지되며, 같은 Git 저장소의 여러 worktree에서 공유됩니다.

LoomForWork로 프로젝트의 할 일과 작업 기록을 한곳에서 관리하고, 다음 작업을 더 수월하게 시작해 보세요.


&nbsp;

## **📦** 설치
### 1. 요구 사항
#### 지원 운영 체제
- macOS

#### 사전 요구 사항
- Codex Desktop App / CLI
- bun
- uv
- Git
- Python >= 3.10
- fzf: 작업할 WorkItem을 선택할 때 사용됩니다.
※ 사전 요구 사항이 충족되지 않으면 하네스 설치가 거부될 수 있습니다.


### 2. 설치
LoomForWork를 적용할 **프로젝트의 루트 디렉터리**에서 아래 명령어를 실행하세요. 새 디렉터리와 기존 프로젝트에서 모두 설치할 수 있습니다.
```bash
bunx loomforwork@latest install
```

명령어를 실행하면 디렉터리에 아래 파일들이 설치됩니다. 하네스에 필요한 소스 코드와 스킬이 추가되며, `AGENTS.md`, `.gitignore`, `.codex/config.toml`, `.codex/hooks.json`, `package.json`처럼 기존 프로젝트와 공유하는 파일은 기존의 내용을 유지하면서 필요한 설정만 추가합니다.

```
프로젝트 루트/
├── AGENTS.md                         # 하네스 작업 지침 추가
├── package.json                      # 하네스 관련 명령어 추가
├── .gitignore                        # 하네스 생성 파일 제외 규칙 추가
├── .codex/
│   ├── config.toml                   # 하네스 MCP 서버 설정 추가
│   └── hooks.json                    # 작업 시작·기록·종료 훅 추가
├── .agents/
│   └── skills/                       # 하네스 관련 스킬 추가
│       ├── work-start/
│       ├── work-finish/
│       ├── work-item-create/
│       ├── memory-finalize/
│       ├── mvp-to-prd/
│       ├── verify-prd/
│       └── extract-features/
└── lfw/
    ├── bin/                          # 하네스 스크립트 모음
    ├── src/                          # 하네스 소스 코드
    ├── skills/                       # 배포용 스킬 원본
    ├── vendor/                       # 포함된 외부 구성 요소
    ├── docs/                         # 하네스 설명 문서
    ├── pyproject.toml
    ├── uv.lock
    ├── schema.sql
    └── install.json                  # 설치 버전과 관리 파일 기록

Git 공유 디렉터리
└── harness-data/
    ├── state.db                   # 상태 저장소
    └── memorygraph.db             # 장기 기억 저장소
```

### 3. 웹 콘솔 실행하기
```bash
bun run console
```

또는

```bash
lfw/bin/harness-control-center
```
웹 콘솔에서는 새 기능(Feature)과 작업 항목(WI)을 생성하고, 등록된 항목을 확인할 수 있습니다. 수행된 작업의 진행 내역을 추적하고 작업 도중 저장된 장기 기억도 살펴볼 수 있습니다. 관련된 배경 정보나 결정 사항은 웹 콘솔에서 WI 메모로 기록하여 이후 Codex가 작업에 참조하도록 할 수 있습니다.

### 4. 훅 신뢰 및 설치 확인
설치 후 Codex 세션을 새로 시작하세요. 설치된 훅에 대한 신뢰 요청이 표시되면 내용을 확인하고 승인하세요. 훅은 Codex의 작업 시작·기록·종료 단계에서 실행되는 스크립트입니다.

프로젝트 루트에서 다음 명령어를 실행해 필수 파일이 설치되었는지 확인하세요.

```bash
bun run verify:install
```

또는

```bash
lfw/bin/harness-verify-install
```

파일이 빠져 있으면 해당 경로가 출력됩니다. 이 명령어는 파일의 존재 여부를 확인하며, 훅의 실행 상태까지 검사하지는 않습니다.

&nbsp;

## 🚀 첫 작업 시작하기
### 1. Feature/WI 등록하기
LoomForWork는 프로젝트 작업을 Feature, WorkItem(WI), Run 세 단위로 관리합니다.
- Feature(기능)는 프로젝트에서 구현할 기능이나 작업 영역을 묶는 단위입니다.
- WorkItem(WI, 작업 항목)은 Codex에 요청할 실제 작업을 뜻하며, 목표와 완료 조건 등을 담습니다. WI는 Feature에 속할 수도 있고, 별도의 Feature 없이 독립적으로 사용할 수도 있습니다.
- Run(실행 기록)은 하나의 WI를 실제로 수행한 내역입니다. 같은 WI를 여러 번 작업하면 실행할 때마다 Run이 하나씩 남아, 어떤 작업을 진행했고 어떤 결과를 얻었는지 이어서 확인할 수 있습니다.

프로젝트에 사용할 Feature와 WorkItem은 다음 두 가지 방법으로 만들 수 있습니다.

#### 1.1 스킬을 활용하여 생성
LoomForWork에는 기획 문서를 바탕으로 Feature와 WI를 준비하는 스킬이 포함되어 있습니다. 이 스킬들의 기반이 된 원본과 변경 내역은 [출처 기록](lfw/skills/UPSTREAM.md)에서 확인할 수 있습니다.

PRD(제품 요구 사항 문서)가 있다면 `extract-features` 스킬로 Feature와 각 Feature에 속할 WI 후보를 추출할 수 있습니다. 이 스킬은 등록할 Feature와 WI 후보를 JSON 파일로 만듭니다. 파일의 내용을 검토한 뒤 에이전트에게 등록을 요청하면, 선택한 항목을 실제 Feature와 WI로 저장할 수 있습니다.

MVP(최소 기능 제품) 문서부터 시작한다면 `mvp-to-prd` 스킬로 PRD를 작성하고, `verify-prd` 스킬로 원본 MVP와 비교해 검증한 다음 `extract-features`를 사용하세요.

#### 1.2 직접 등록하기
기능과 작업 항목을 직접 추가하고 싶거나, 기존에 진행 중인 프로젝트에서 필요한 항목만 등록하려면, 다음 두 가지 방법을 사용할 수 있습니다.

- **Codex에 요청하기:** 만들고 싶은 Feature나 WI의 목적과 내용을 대화로 전달하세요. Codex에 완성된 WI 등록을 요청하면 목표, 다음 행동, 완료 조건을 갖춘 `ready` 상태의 작업 항목으로 저장합니다. `ready`는 작업을 시작할 준비가 됐다는 뜻입니다.
- **웹 콘솔에서 만들기:** 새 Feature를 등록하거나 Draft WI를 생성할 수 있습니다. Draft WI는 아직 실행 계획을 구체화하지 않은 작업 항목으로, 이후 해당 WI를 선택하면 등록된 설명과 목표를 바탕으로 실행 계획과 완료 조건을 구체화합니다.

### 2. `w/` 요청
등록한 WI를 대상으로 작업하려면 Codex에 보내는 요청의 맨 앞에 `w/`를 붙이세요.

```text
w/ 로그인 화면을 구현해줘
```

요청을 보내면 터미널에 WI 선택기가 열립니다. 이번 요청과 관련된 WI를 선택하면 Codex가 저장된 목표, 완료 조건, 메모와 이전 Run을 읽고 작업을 시작합니다. Draft WI를 선택한 경우에는 먼저 설명과 목표를 바탕으로 실행 계획과 완료 조건을 구체화한 뒤 시작합니다. 요청할 작업과 가장 관련 있는 WI를 선택해 주세요.

작업을 시작할 때 생성되는 Run은 이번 실행의 진행 내용과 결과를 기록합니다. 같은 WI로 다시 작업해도 새 Run이 남아 이전 작업과 이어서 살펴볼 수 있습니다.

`w/`는 필수가 아닙니다. 단, 일반 요청의 경우 WI를 선택하거나 Run을 시작하지 않으므로, 작업 내용은 LoomForWork의 실행 기록에 남지 않습니다.

### 3. 작업 흐름
작업할 WI를 선택하면 LoomForWork는 다음과 같은 흐름으로 작업을 수행합니다.
```text
1. 작업 준비: 선택한 WI의 목표, 완료 조건, 메모, 이전 Run 등을 확인합니다.

2. Run 생성: 선택한 WI에 이번 작업을 위한 Run(실행 기록)을 생성하고, 해당 작업과 관련된 장기 기억을 찾아 맥락에 추가합니다.

3. 작업 수행과 기록: 요청에 따른 작업을 수행합니다. 작업 도중 발생한 도구 실행 내역과 장기 기억 후보가 메모리에 기록됩니다.

4. 결과 정리: 도구 실행 기록을 검토해 WI의 완료 조건을 뒷받침하는 근거를 남기고, 이후 작업에 활용할 만한 장기 기억 후보를 저장합니다.
```

#### PreToolUse 활성화
- LoomForWork에서는 `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop` 4개의 훅으로 사용자 작업을 처리한다.
- 그중 PreToolUse는 w/ 요청이 아니면 코드 수정/커밋 등을 엄격하게 제한하며, 설치 시 기본값은 비활성화 상태이다.

도구 실행 전 검사가 필요하면 프로젝트 루트에서 켜세요.

```bash
./lfw/bin/harness-pre-tool-use-config enable
```

다시 끄려면 다음 명령을 실행합니다.

```bash
./lfw/bin/harness-pre-tool-use-config disable
```


### 4. 다른 Git worktree에서 작업하기
Git worktree는 같은 저장소의 브랜치를 별도 디렉터리에서 작업하는 기능입니다. LoomForWork는 작업 상태와 장기 기억을 Git 공통 디렉터리에 저장하므로, 같은 저장소의 여러 worktree에서 WI와 이전 작업의 맥락을 공유할 수 있습니다. 각 worktree에서는 서로 다른 브랜치의 파일을 다루면서도 같은 작업 기록을 참고할 수 있습니다.

새 worktree에 하네스 파일과 `.codex/config.toml`이 있어야 합니다. 설치 시 이 파일에 기록된 MCP 서버의 `cwd`(실행 디렉터리)는 설치한 worktree의 절대 경로입니다. 새 worktree에서는 그 디렉터리로 이동한 뒤 아래 명령으로 `harness-state`와 `harness-memory` 서버의 경로를 현재 worktree에 맞게 바꾸세요. 변경 후 Codex 세션을 새로 시작해야 설정이 반영됩니다.

```bash
bun run worktree:setup
```
&nbsp;


## 🔄 업데이트 적용 방식
아래 명령어를 통해서 필요한 업데이트를 진행할 수 있습니다.
```bash
bunx loomforwork@latest update
```
사용자는 LoomForWork의 하네스 파일과 스킬을 직접 수정할 수 있습니다. 다만 설치기가 관리하는 파일을 수정한 경우에는 변경 내용을 보호하기 위해 이후 업데이트가 중단됩니다.



&nbsp;

## 🛠️트러블슈팅
- **대상이 Git 저장소 루트가 아니라는 오류가 납니다:** `git rev-parse --show-toplevel`로 루트를 확인하고 그 디렉터리에서 설치하세요.
- **업데이트가 수정된 파일 때문에 중단됩니다:** `lfw/`의 코드 또는 `.agents/skills/`의 설치 스킬이 바뀌었는지 확인하세요. 설치기는 변경된 파일을 덮어쓰지 않습니다.

&nbsp;

## ⚖️ 라이선스

이 저장소는 MIT 라이선스를 따릅니다. 자세한 내용은 [LICENSE](LICENSE)를 참고하세요. 설치된 하네스에도 [lfw/LICENSE](lfw/LICENSE)가 함께 들어갑니다.

하네스에 포함된 외부 소스와 이를 바탕으로 구성한 스킬의 라이선스 및 출처는 다음 파일에서 확인할 수 있습니다.

- **MemoryGraph:** [라이선스](lfw/vendor/memory-graph/LICENSE) · [출처](lfw/vendor/memory-graph/UPSTREAM.md)
- **기획 문서·Feature 추출 스킬:** [출처와 변경 내역](lfw/skills/UPSTREAM.md) · 라이선스 [mvp-to-prd](lfw/skills/mvp-to-prd/LICENSE) · [verify-prd](lfw/skills/verify-prd/LICENSE) · [extract-features](lfw/skills/extract-features/LICENSE)
