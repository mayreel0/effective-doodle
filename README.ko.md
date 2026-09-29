# effective-doodle

한국어 · [English](README.md)

effective-doodle v0.2는 **구현이 완료된 로컬 Project Knowledge Engine MVP**입니다. Git 저장소의 소스·설정·문서·Git 이력을 읽어 다시 생성할 수 있는 파생 지식을 만듭니다. 원본 Git 저장소가 진실의 원천이며, 등록해도 원본에 파일이나 의존성을 추가하거나 빌드·테스트를 실행하지 않습니다.

이 MVP는 CLI와 재사용 가능한 Node.js API입니다. 호스팅 서비스나 AI 챗봇은 아니며 외부 LLM·임베딩·벡터 DB·LangChain·LangGraph·MCP·Orchestrator를 사용하지 않습니다.

## 준비와 빠른 시작

Node.js 20 이상과 Git이 필요합니다. 아래 명령은 **effective-doodle 저장소의 루트에서** 실행하며, 이 저장소 자체를 대상으로 동작을 확인합니다. 전역 명령을 설치할 필요는 없습니다.

```bash
npm ci
export DOODLE_HOME="$(mktemp -d)"

node bin/doodle.js register "$PWD" --id demo
node bin/doodle.js list
node bin/doodle.js sync demo
node bin/doodle.js current demo
node bin/doodle.js changes demo --since HEAD~1
node bin/doodle.js context demo --task "registry"
node bin/doodle.js unregister demo
```

아래 이미지는 실행 흐름을 익명화한 예시입니다. 경로는 대체값이고 커밋 ID는 짧게 표시했습니다. 정확한 명령과 설명은 이 문서의 텍스트를 기준으로 해주세요.

![저장소 등록, 동기화, 현재 상태, 변경 조회, 컨텍스트, 등록 해제를 보여 주는 익명화된 CLI 예시](assets/readme/cli-demo.png)

다른 Git 저장소를 검사하려면 `register`의 `"$PWD"`를 해당 저장소 경로로 바꾸세요. `DOODLE_HOME`은 반드시 대상 저장소 **밖**에 두어야 합니다. 이 저장소에서 `npm link`를 실행하면 `node bin/doodle.js` 대신 `doodle` 명령을 쓸 수도 있습니다. 검사 대상 저장소에는 아무것도 설치하지 않습니다.

## 명령별 기능

| 명령 | 결과 |
| --- | --- |
| `register <repo> --id <id>` | Git 저장소 하나를 doodle 프로젝트 하나로 등록합니다. |
| `list` | 등록한 프로젝트를 나열합니다. |
| `sync <id>` | 현재 상태, 변경 이력, 명시적으로 작성된 Markdown 의사결정을 파생 저장소에 갱신합니다. |
| `current <id>` | 커밋된 브랜치·HEAD·파일 수와 작업 트리 상태를 구분해 보여 줍니다. |
| `changes <id>` | 마지막 저장 변경 스냅샷을 읽습니다. `--since <git-ref>`는 저장된 스냅샷을 바꾸지 않고 해당 ref부터 분석합니다. |
| `context <id> --task <text>` | 사용 가능한 사실과 의사결정에서 작업과 관련된 컨텍스트를 결정적으로 구성합니다. |
| `unregister <id>` | 등록 정보와 해당 파생 데이터를 지웁니다. 원본 저장소는 지우지 않습니다. |

모든 명령에 `--json`을 붙이면 기계가 읽을 수 있는 JSON을 stdout으로 출력합니다. 오류는 stderr에 출력하고 0이 아닌 종료 코드를 반환합니다. 프로젝트 ID를 받는 명령에서는 위치 인자 대신 `--id <id>`도 사용할 수 있습니다. `sync`는 `--since <git-ref>`와 `--rebuild`를 지원합니다.

저장된 `current`, 기본 `changes`, `context`를 조회하기 전에는 `sync`를 먼저 실행하세요. **첫** `sync`는 현재 `HEAD`를 기준과 결과로 함께 사용하므로 저장된 변경 목록이 비어 있습니다. 이후 `sync`는 마지막 성공 동기화 revision과 비교합니다. 빠른 시작의 `changes demo --since HEAD~1`은 별도로 이전 커밋부터의 변경을 보여 줍니다. 첫 커밋만 있거나 shallow 저장소라면 존재하는 다른 Git ref를 사용하세요. `sync --rebuild`는 파생 스냅샷을 다시 만들고, `--since`가 없으면 변경 기준을 현재 `HEAD`로 재설정합니다. 기존 스냅샷은 미리 삭제하지 않고 원자적으로 교체합니다.

`Relevant decisions: none`은 작업과 일치하는 색인된 의사결정이 없다는 뜻이지 오류가 아닙니다. 작업 트리의 파일 수는 현재 수정 상황에 따라 이미지와 다를 수 있습니다. 작업 컨텍스트는 기계가 읽을 수 있는 설정, 현재 소스, 명시적 의사결정, README·문서, 파생 지식 순으로 우선합니다. 엔진은 확인 가능한 저장소 사실과 작업 트리 변경을 보고하지만, 확인되지 않은 비즈니스 의미를 추론하지 않습니다.

## 데이터·안전·지원 범위

기본 파생 데이터 위치는 `~/.doodle`이며 `DOODLE_HOME`으로 변경할 수 있습니다. 저장 구조는 다음과 같습니다.

```text
DOODLE_HOME/
  registry.json
  registry-transaction.json  # 중단된 registry 갱신의 복구가 필요할 때만 존재
  .registry.lock/             # 일시적인 로컬 프로세스 간 잠금
  projects/<id>/
    project.json       # 원본 경로와 마지막 성공 동기화 revision
    current.json       # 커밋 상태, 작업 트리, 감지한 사실
    changes.json       # 마지막 저장 변경 스냅샷
    decisions.json     # 명시적으로 작성된 Markdown 의사결정
```

모든 저장 JSON에는 `schemaVersion: 1`이 들어갑니다. 원본 저장소를 다시 등록하면 파생 스냅샷을 재생성할 수 있습니다. 민감한 경로를 제외하고 인식 가능한 비밀값을 파생 출력에서 가리지만 **범용 비밀정보 탐지기는 아닙니다**. JSON이나 스크린샷을 공개하기 전에는 직접 확인하세요.

`register`·`unregister`·`list`·프로젝트 조회는 `DOODLE_HOME`별 로컬 잠금을 사용합니다. 동시 갱신은 최대 5초간 기다린 뒤 잠금을 얻지 못하면 registry를 변경하지 않고 명확한 오류를 냅니다. 프로세스가 강제 종료됐다면 잠금이 오래된 것으로 판정될 때까지(최대 30초) 기다렸다가 재시도하세요. 이후 명령은 중단된 registry 작업을 복구하며, 남은 정리는 다음 갱신에서 마칩니다. 단일 컴퓨터의 로컬 저장소를 대상으로 하며 네트워크 파일시스템이나 `sync`와 `unregister`의 동시 실행까지 일관성을 보장하지는 않습니다.

프로그램에서는 패키지가 내보내는 `KnowledgeProvider`를 사용할 수 있습니다. CLI는 인자를 해석하고 이 API를 호출한 뒤 결과를 출력하는 역할만 합니다.

```js
import { KnowledgeProvider } from 'effective-doodle';

const knowledge = new KnowledgeProvider();
knowledge.register('/path/to/git-repository', { id: 'sample' });
knowledge.sync('sample');
const context = knowledge.getContext('sample', 'authentication');
```

## 문제 해결과 검증

- `doodle: command not found`: 이 저장소에서 `node bin/doodle.js`를 쓰거나 먼저 `npm link`를 실행하세요.
- `current.json` 또는 `changes.json`이 없다는 오류: 저장된 정보를 읽기 전에 `sync <id>`를 실행하세요.
- 저장 위치 경계 오류: `DOODLE_HOME`을 원본 저장소 밖으로 옮기세요.
- `HEAD~1`이 유효하지 않다는 오류: `HEAD`처럼 존재하는 ref를 쓰거나 커밋이 두 개 이상인 저장소에서 시도하세요.
- registry 잠금 대기 시간 초과: 같은 `DOODLE_HOME`을 갱신하는 다른 프로세스가 끝나면 다시 시도하세요. 프로세스가 중단됐다면 오래된 잠금이 만료될 때까지 최대 30초 기다린 뒤 재시도하세요.

`npm test`는 Node.js 단위·통합 테스트와 기존 셸 테스트를 실행합니다. 실제 저장소 `congenial-pancake`에서의 MVP 검증 결과는 [DEV-80](https://linear.app/kim015jh/issue/DEV-80)에 기록돼 있습니다.

## 기존 Wiki 기능

앞서 만든 Obsidian/Syncthing/Git/Quartz Wiki 도구는 `scripts/`, `config/`, `vault/`, `docs/operations/`에 남아 있습니다. Project Knowledge Engine의 저장·실행 경로가 아닌 별도의 레거시/실험적 기능입니다. 운영 자료는 [서버 부트스트랩](docs/operations/server-bootstrap.md), [Project Wiki Mode](docs/operations/project-wiki-mode.md), [에이전트 정책](docs/operations/llm-agent-policy.md), [검증 체크리스트](docs/operations/verification-checklist.md)를 참고하세요.
