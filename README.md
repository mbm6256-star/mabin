# TENNIS LAB

대학 테니스 동아리용 로컬 개발 웹앱입니다. 프론트엔드 → Node.js `preview.mjs` API → Supabase Data API 구조로 선수·경기를 조회하고 개발 환경에서 경기·세트를 저장합니다. 전체 PRD를 완료한 운영 서비스는 아닙니다.

## 실행 방법

Node.js 24 이상을 권장합니다(검증: v24.22.1). 서버 실행에는 패키지 설치가 필요 없습니다.

```powershell
cd C:\Projects\tennis-lab
# 최초 설정 시에만 복사하며 기존 .env는 보존합니다.
if (!(Test-Path .env)) { Copy-Item .env.example .env }
node preview.mjs
```

`.env`에 자신의 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 설정합니다. 키는 서버에서만 사용하며 코드·문서·로그에 넣지 않습니다. 서버는 프로젝트의 `.env`를 자동으로 읽습니다. 이미 설정된 프로세스 환경변수가 있으면 그 값이 우선합니다. 설정 변경 후 서버를 재실행합니다.

주소: **http://127.0.0.1:4173**. 터미널 실행 서버는 `Ctrl+C`로 종료합니다. `EADDRINUSE`는 포트 점유 PID와 실행 명령을 확인하고 해당 프로젝트의 서버로 확인된 프로세스만 종료하여 해결합니다.

개발용 저장에는 다음 설정이 모두 필요합니다.

```dotenv
NODE_ENV=development
ENABLE_DEV_MATCH_WRITES=true
```

`GET /api/config`의 `matchWritesEnabled`로 활성 상태를 확인합니다. 조회 전용으로 전환하려면 `ENABLE_DEV_MATCH_WRITES=false`로 변경하고 재시작합니다. production에서는 저장이 차단됩니다. 로컬 쓰기 제한은 로그인·운영자 인증을 대체하지 않습니다.

DB에는 `save_tennis_match` 함수가 설치되어 있어야 합니다. 이미 저장이 동작하는 환경에 설치 SQL을 다시 실행할 필요는 없습니다. 설치·권한·API 계약은 [경기 저장 안내](docs/경기저장-개발테스트.md)를 참고하세요.

## 구현 기능

- Supabase 선수·경기·세트 조회, 로딩·빈 목록·실패·재시도 안내. DB 오류를 샘플 데이터로 대체하지 않습니다.
- 단식 경기 입력과 예상 승자, 날짜·서로 다른 선수·완료 점수 검증. 2세트 선승, 완료된 2~3세트, 세트별 6-0~6-4/7-5/7-6 및 반대 결과 지원.
- 개발용 DB 저장 후 재조회하여 경기 목록·통계·랭킹·개인 대시보드 자동 갱신.
- 경기 수·승패·승률·세트 득실, 랭킹 정렬, 선수별 이력과 누적 승률.
- 중복 클릭 차단, 오류 시 입력 보존, 응답 유실 안내, 저장 후 조회 실패 시 GET만으로 복구.
- 모바일 한 열 배치와 표·차트 내부 스크롤.
- 포핸드 분석은 고정 샘플 데모입니다. 실제 영상 업로드·AI 측정은 없고 데모 리포트만 localStorage에 저장합니다. 선수·경기는 DB에서 읽습니다.

## 중복 및 오류 처리

날짜·선수 쌍·세트 순서와 점수가 같으면 동일 경기입니다. A/B와 점수를 함께 뒤집어도 동일합니다. 신규 저장은 HTTP 201, 동일 경기 재요청은 HTTP 200으로 기존 결과를 반환합니다. 동일 날짜·점수의 실제 재대결 구분은 미지원입니다.

DB 함수는 트랜잭션 잠금으로 동일 요청을 직렬화하고 경기·세트를 함께 저장합니다. 세트 실패 시 경기 INSERT도 롤백합니다. 직접 SQL INSERT 등 함수 외부의 쓰기를 전역적으로 제한하는 중복 UNIQUE 제약은 없습니다.

잘못된 입력·출처·CSRF·본문 형식, DB 권한·연결·시간 초과를 구분합니다. 응답 유실은 저장 실패로 단정하지 않으며 먼저 DB를 다시 조회합니다. 저장 후 화면 갱신만 실패하면 `저장 결과 다시 조회`를 사용합니다.

## PRD 대비 미완료 사항

- 로그인·회원/운영자 권한, 회원·선수 등록 및 계정 연결, 경기 수정·삭제는 미구현입니다.
- 현재 랭킹은 1경기 이상 선수에게 순위를 부여하고 승률 → 승수 → 세트 득실 순으로 비교합니다. PRD의 최소 3경기, 승률 → 세트 득실 → 승수 기준과 다릅니다. 모든 비교값이 같으면 공동 순위(1, 1, 3)를 표시합니다.
- 실제 관절 인식·각도 측정·측정 기반 리포트·개인 분석 결과의 DB 저장과 접근 권한은 미구현입니다.
- ACCEPTANCE 43개 항목 전체 통과를 의미하지 않습니다. [최종 점검 보고서](docs/최종점검-2026-11-15.md)에 근거와 제한을 기록했습니다.

## 자동 테스트

다음 테스트는 실제 Supabase DB에 쓰지 않습니다.

```powershell
node --test core.test.cjs preview.test.mjs preview.write.test.mjs supabase/save_match.test.mjs supabase/guestbook.test.cjs
node --check app.js
node --check core.js
node --check preview.mjs
$env:TENNIS_LAB_BROWSER_MOCK_WRITES = 'true'
node frontend.browser.test.mjs
Remove-Item Env:TENNIS_LAB_BROWSER_MOCK_WRITES
```

브라우저 테스트는 Edge 임시 프로필과 모의 API 서버를 사용합니다. 설치 경로가 다르면 `BROWSER_EXECUTABLE`을 지정합니다. 모의 모드에서는 실제 4173 서버가 없어도 실행됩니다.

SQL 테스트에는 선택적 `@electric-sql/pglite` 엔진이 필요합니다. 별도 테스트 폴더에 설치하고 `PGLITE_MODULE`에 `dist/index.js` 절대 경로를 지정합니다. 없으면 SQL 테스트는 skip됩니다. DB는 메모리에만 생성되며 실제 Supabase에는 연결하지 않습니다. 여러 실제 PostgreSQL 세션의 잠금 경쟁 검증은 별도입니다.

기본 live 브라우저 모드는 초기 4명·5경기 및 쓰기 비활성을 기대합니다. 실습 후 6경기·쓰기 활성 상태인 현재 서버의 범용 검증으로 사용할 수 없습니다. 모의 모드로 실행하고 실제 연결은 GET으로 별도 확인합니다.

## 비밀정보 및 Git

`.gitignore`는 `.env`, `.env.*`, node_modules, 로그를 제외하고 `.env.example`만 허용합니다. `.env`는 정적 서버로도 제공하지 않습니다. 공유 전 `git check-ignore .env`, `git ls-files .env`, `git diff --check`, `git status --short`를 확인합니다. Secret Key는 커밋하지 않습니다.

2026-11-15: 자동 테스트 26개 통과(실패·skip 0), 모의 브라우저 검사 통과, 실제 GET 선수 4명·경기 6건 확인. DB 데이터·RLS 변경과 GitHub push는 수행하지 않았습니다.
