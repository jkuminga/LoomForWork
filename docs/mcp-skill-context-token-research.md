# MCP·스킬의 컨텍스트/토큰 영향 조사

조사일: 2026-09-02<br>
범위: Codex와 OpenAI Responses API에서 MCP 도구와 스킬이 차지하는 입력 컨텍스트. OpenAI 공식 문서와 MCP 공식 명세만 사용했다.

## 결론

**MCP는 실제로 큰 토큰·지연 요인이 될 수 있다.** OpenAI는 수십 개의 도구를 모델에 노출하면 비용과 지연이 높아질 수 있으므로, 필요한 도구만 가져오도록 권장한다. GPT-5.4의 36개 MCP 서버 평가에서는 tool search 사용 시 같은 정확도로 총 토큰 사용량이 47% 줄었다. 이 수치는 해당 벤치마크 평균이며 모든 환경의 보장값은 아니다. [OpenAI MCP/커넥터 가이드](https://developers.openai.com/api/docs/guides/tools-connectors-mcp#filtering-tools), [OpenAI GPT-5.4 발표](https://openai.com/index/introducing-gpt-5-4/)

**스킬도 시작 컨텍스트를 쓴다.** Codex는 모든 사용 가능 스킬의 이름·설명·경로 메타데이터를 먼저 넣고, 선택된 스킬만 SKILL.md 전체 지침을 읽는다. Codex의 스킬 목록 예산은 컨텍스트 창의 최대 2%(창 크기를 모르면 8,000자)이며, 넘치면 설명을 먼저 줄이고 일부 스킬을 생략하며 경고한다. 방금 본 경고의 직접적인 원인이다. [OpenAI Skills 문서](https://learn.chatgpt.com/docs/build-skills#progressive-disclosure)

## 문서로 확인된 사실

| 대상 | 확인된 내용 | 실제 의미 |
| --- | --- | --- |
| MCP 도구 정의 | MCP Tool에는 name(식별자), description(기능 설명), inputSchema(인수 JSON Schema)가 들어간다. | 도구 수뿐 아니라 설명·필드 설명·열거값·중첩 스키마 길이도 정의 크기에 포함된다. [MCP Tools 명세](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) |
| OpenAI MCP 비용 | Remote MCP에서는 도구 정의를 가져오거나 호출할 때 사용된 토큰에 대해 과금하며, 도구 호출 자체의 별도 수수료는 없다고 명시한다. | API에서는 정의가 커질수록 입력 토큰이 늘어난다. [OpenAI MCP/커넥터 가이드](https://developers.openai.com/api/docs/guides/tools-connectors-mcp#how-it-works) |
| 도구 범위 | OpenAI는 수십 개 도구의 노출이 높은 비용·지연을 만들 수 있어 allowed_tools로 필요한 부분집합만 import하라고 권장한다. | 서버 전체를 연결해 두는 것보다 작업별 도구 범위를 좁히는 편이 낫다. [OpenAI MCP/커넥터 가이드](https://developers.openai.com/api/docs/guides/tools-connectors-mcp#filtering-tools) |
| 도구 결과 | Remote MCP의 반환 결과도 모델 컨텍스트에 포함된다. Codex 역시 이전 대화와 도구 호출을 후속 요청에 포함하며, 다수 도구 호출은 컨텍스트 창을 소진할 수 있다고 설명한다. | 긴 로그·큰 JSON·문서 본문은 도구 정의보다 더 큰 누적 비용이 될 수 있다. [OpenAI MCP 호출 단계](https://developers.openai.com/api/docs/guides/tools-connectors-mcp#step-2-calling-tools), [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) |
| 스킬 | 각 사용 가능 스킬의 name, description, path를 사용자 프롬프트 컨텍스트에 넣고, 모델이 선택할 때만 해당 SKILL.md 전체 지침을 읽는다. | 설치 스킬 수와 설명 길이에 따라 시작 컨텍스트가 선형으로 늘지만, 모든 본문을 매번 읽는 것은 아니다. [OpenAI Skills in the user prompt](https://developers.openai.com/api/docs/guides/tools-skills#skills-in-the-user-prompt) |
| 스킬 목록 제한 | 스킬 메타데이터 목록은 컨텍스트 창의 최대 2%, 창 크기 미상 시 8,000자까지만 사용한다. 초과하면 설명을 축약하고 일부 스킬을 생략하며 경고한다. | 현재 표시된 경고는 단순 안내가 아니라, 스킬 목록이 실제 컨텍스트 예산에 닿았다는 신호다. [OpenAI Skills progressive disclosure](https://learn.chatgpt.com/docs/build-skills#progressive-disclosure) |

## 무엇이 더 큰가

일반적인 우선순위는 다음과 같다.

1. 사용하지 않는 대형 MCP 서버와 긴 도구 정의
2. 실제 호출 뒤 쌓이는 긴 도구 반환값
3. 설치 수가 매우 많거나 설명이 긴 스킬 메타데이터
4. 실제로 선택된 스킬의 SKILL.md 본문

1~4의 고정 비율은 공개되지 않았다. 위 순서는 OpenAI가 MCP 도구 정의를 수천~수만 토큰 규모로 언급하고, 도구 결과가 후속 컨텍스트에 들어간다고 밝힌 사실에 근거한 실무적 추론이다. 특정 환경에서는 큰 SKILL.md 하나가 더 클 수도 있다.

## 권장 정리 순서

1. **안 쓰는 MCP 서버부터 끈다.** 특히 도구 수가 많고 JSON Schema가 긴 서버가 1순위다.
2. **가능하면 allowed_tools를 사용한다.** allowed_tools는 작업에 필요한 도구만 import하는 필터다.
3. **도구 반환량을 줄인다.** 검색 결과 수·로그 줄 수·페이지 크기를 제한하고 필요한 필드만 반환한다.
4. **스킬 설명을 짧고 구별 가능하게 쓴다.** 이름과 description은 시작 목록에 들어가므로, 긴 사용법·예시는 본문이나 연결 자료로 옮긴다.
5. **쓰지 않는 스킬·플러그인을 끈다.** 단, 정상적인 소수 스킬을 무작정 지우기보다 MCP와 반환량을 먼저 줄이는 편이 보통 더 효과적이다.

용어:

- **입력 컨텍스트**: 모델이 답변·도구 선택 전에 읽는 텍스트, 도구 정의, 이전 대화의 묶음.
- **JSON Schema**: 도구 인수의 필드명·자료형·필수 여부 등을 선언하는 구조 명세.
- **allowed_tools**: Remote MCP에서 가져와 모델에 노출할 도구만 고르는 필터.
- **progressive disclosure**: 처음에는 짧은 메타데이터만 보여주고, 필요할 때 상세 지침을 읽는 방식.

## 한계

- Responses API의 토큰 과금 설명을 ChatGPT/Codex 구독형의 정확한 크레딧·한도 산식으로 그대로 환산할 수는 없다.
- MCP 표준은 모든 클라이언트가 모든 도구 정의를 모델 컨텍스트에 넣도록 강제하지 않는다. 다만 OpenAI의 MCP 통합은 import한 정의와 호출 결과를 컨텍스트에서 활용한다고 문서화한다.
- 스킬 N개가 정확히 몇 토큰인지와 이 대화의 개별 경고가 줄인 토큰 수는 공개되지 않았다.
