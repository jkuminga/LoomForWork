# 하네스 템플릿 배포 방식 조사

> 이 문서는 2026-11-16 당시 선택지를 비교한 조사 기록이다. 아래의 MemoryGraph 서브모듈 설치 제안과 미정 사항은 현재 결정이 아니다. 확정한 구조와 구현 정책은 `docs/designs/harness-template-strategy.md`를 따른다.

2026-11-16 기준. 목표는 사용자가 대상 프로젝트에서 한 줄의 CLI 명령으로 `lfw/`를 설치하되, 기존 프로젝트 파일을 병합하고 Git 공통 디렉터리에 상태 DB를 두는 것이다. 아래의 장단점 평가는 공식 도구 문서와 현재 저장소 구성을 함께 놓고 내린 설계 판단이다.

## 현재 저장소의 제약

- Python 실행은 `uv run`과 `pyproject.toml`·`uv.lock`에, 기억 기능은 Bun TypeScript와 `vendor/memory-graph`에 의존한다. 현재 `package.json`은 `"private": true`이고 CLI를 노출하는 `bin` 항목이 없으며, `pyproject.toml`에도 배포용 빌드 설정·CLI 진입점이 없다. 따라서 어느 패키지 매니저를 골라도 별도의 설치 CLI와 배포 패키징 작업이 필요하다. [npm의 `private`·`bin` 설명](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [uv 패키지 빌드 설명](https://docs.astral.sh/uv/guides/package/).
- MemoryGraph는 현재 Git 서브모듈이다. 대상 프로젝트가 서브모듈을 유지하려면 프로젝트 루트 `.gitmodules`에 경로·URL이 들어가고 대상 Git 인덱스에 해당 서브모듈 경로가 등록되어야 한다. 임시로 복제한 하네스 저장소에서 파일만 복사하는 것으로는 이 연결이 생성되지 않는다. 이 마지막 문장은 Git의 서브모듈 구조에서 도출한 판단이다. [Git 서브모듈 추가](https://git-scm.com/docs/git-submodule), [`.gitmodules` 형식](https://git-scm.com/docs/gitmodules.html).

## 선택지 비교

| 방식 | 사용자 명령과 장점 | 현재 구조에서의 비용 |
| --- | --- | --- |
| **`bunx`로 npm 패키지 CLI 실행** | 예: `bunx @조직/lfw init`. Bun이 이미 기억 기능 실행에 필요하다. `bunx`는 npm 패키지의 `bin` 실행 파일을 받아 실행하며 버전 지정도 지원한다. [Bun 공식 문서](https://bun.com/docs/pm/bunx). | 설치용 Bun CLI를 만들어야 한다. 패키지의 `files` 목록에 Python·Bun 코드, 스킬, 문서, 잠금 파일 등 설치 자료를 명시하고 `npm pack --dry-run`으로 포함 여부를 검증해야 한다. 현재 `private: true`와 `bin` 누락을 바꿔야 한다. [npm `files`·`bin`·`private`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/), [npm pack](https://docs.npmjs.com/cli/pack/). |
| **`npx`/`npm exec`로 npm 패키지 CLI 실행** | Node·npm 사용자는 익숙한 한 줄 명령을 쓸 수 있다. `npm exec`는 로컬 또는 원격 패키지의 CLI를 실행한다. [npm exec](https://docs.npmjs.com/cli/v11/commands/npm-exec/). | Bun 기반 CLI를 그대로 쓰면 Node 환경에서 실행되지 않는다. 두 명령을 모두 지원하려면 설치 CLI를 Node 호환 JavaScript로 작성하거나 별도 진입점을 제공해야 한다. 하네스 런타임의 Bun 의존성도 어차피 남는다. |
| **`uvx`로 Python 패키지 CLI 실행** | 예: `uvx lfw init`. 하네스가 이미 `uv`를 사용한다. `uvx`는 프로젝트와 격리된 임시 도구 환경에서 Python 패키지의 CLI를 실행한다. [uv 도구 문서](https://docs.astral.sh/uv/concepts/tools/). | Python 배포 패키지와 CLI 진입점이 필요하다. Python 패키지 안에 셸 스크립트·TypeScript·스킬·문서 등 비 Python 설치 자료를 누락 없이 담는 빌드 설정을 작성해야 한다. [uv 패키지 빌드](https://docs.astral.sh/uv/guides/package/). |
| **사용자에게 Git clone 후 설치 스크립트 실행** | 별도 레지스트리 게시 없이 개발 저장소의 고정 태그를 받을 수 있다. `git clone --recurse-submodules`는 원본 저장소의 서브모듈도 체크아웃한다. [Git clone](https://git-scm.com/docs/git-clone.html). | 사용자 명령이 여러 단계가 된다. 원본 저장소의 개발 파일을 먼저 받아야 하고, 대상 프로젝트로 복사할 때 대상의 서브모듈 등록·설정 병합은 여전히 설치기가 처리해야 한다. |
| **GitHub Release 압축 파일 + 설치기** | 고정된 버전의 배포 자료를 별도 자산으로 제공할 수 있다. GitHub는 릴리스 자산의 다운로드 URL과 SHA-256 digest를 제공한다. [GitHub Release assets](https://docs.github.com/en/rest/releases/assets). | 설치기 호출·다운로드·검증 로직이 추가된다. 압축 파일만 풀어서는 기존 설정 병합이나 대상 프로젝트의 서브모듈 연결이 끝나지 않는다. |

## 추천

**초기 공개 설치 명령은 `bunx` 기반의 얇은 설치 CLI**로 제안한다. Bun은 이미 MemoryGraph를 실행하는 필수 도구이고, npm 패키지는 배포 자료를 `files`로 명시해 한 번에 전달하기 쉽다. 설치 CLI는 대상 프로젝트를 검사하고 `lfw/` 코드·스킬·설정을 배치한 뒤, MemoryGraph를 대상 프로젝트의 `lfw/vendor/memory-graph`에 고정 커밋의 Git 서브모듈로 등록하도록 한다. Git 서브모듈 등록은 CLI 내부 단계이므로 사용자에게 별도 `git clone` 명령을 요구하지 않는다. 이 구성과 명령은 **아직 구현되지 않은 설계안**이며, 실제 패키지명과 게시 방식도 미정이다.

한 줄 설치는 사용자 인터페이스이고, 그 아래에서 Git·`uv`를 실행해도 된다. `bunx`와 `uvx` 중 핵심 차이는 설치기를 Bun으로 작성할지 Python으로 작성할지, 그리고 배포 패키지에 혼합 언어 자료를 얼마나 쉽게 담을 수 있는지다. 현재 파일 구성을 기준으로는 Bun 패키지의 `files` 방식이 직접적이지만, Python 설치기를 우선하고 싶다면 `uvx`도 성립한다. 패키지 매니저가 하네스의 지속 실행 위치를 제공하는 것은 아니다. CLI 실행 후 설치된 코드는 합의한 대로 대상 프로젝트의 `lfw/`에 남긴다.

## 결정 전에 확인할 항목

1. 배포 패키지에 실릴 파일 목록을 만들고 `npm pack --dry-run`으로 개발 자료·DB 제외와 필수 파일 포함을 확인한다. [npm pack](https://docs.npmjs.com/cli/pack/).
2. MemoryGraph 서브모듈을 대상 저장소의 지정 경로와 고정 커밋으로 등록하는 설치 절차를 검증한다. 기존 `.gitmodules` 항목이 있으면 보존한다. [Git submodule](https://git-scm.com/docs/git-submodule).
3. 설치 후 프로젝트의 `lfw/`에서 `uv`·Bun 의존성을 독립적으로 준비하고, 런타임 전제 도구가 없을 때 설치기가 안내할 메시지를 정한다.
