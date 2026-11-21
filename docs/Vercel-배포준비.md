# TENNIS LAB Vercel 배포 준비

이번 변경은 로컬에서 검증한 배포용 코드다. 이후 사용자가 승인한 시점에만 Preview 또는 Production 배포를 진행한다.

## 공개판 구성

- Vercel은 프로젝트 루트의 `vercel.json`을 사용한다. 별도 프레임워크 설정 없이 `node scripts/build-public.mjs`를 실행하고 `dist`를 정적 파일로 제공한다. `dist`에 다른 파일이 이미 있다면 빌드는 중지한다. 배포용 HTML에는 내부 문서 링크를 넣지 않는다.
- `api/players.mjs`, `api/matches.mjs`, `api/config.mjs`는 Vercel Node.js 함수다. `preview.mjs`는 로컬 서버로 남으며 공통 Supabase 조회·검증 로직을 호출한다. 공개판은 회원 코드를 조회하지 않고 호환 필드 `memberCode`를 빈 문자열로 반환한다. 선수 이름과 경기 기록은 공개 응답에 포함된다.
- 공개 설정은 `matchWritesEnabled: false`를 반환한다. 경기 저장 요청은 함수에서 HTTP 405로 거절되며 Supabase를 호출하지 않는다. 로컬 전용 저장 플래그는 Vercel 환경에 등록할 필요가 없다.
- 공개 함수는 Vercel 서버 환경의 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 읽는다. 기존 키를 유지하는 조건으로 작성했으며 키 값 교체·폐기는 수행하지 않았다. 기존 키가 이미 외부에 노출됐다면 키를 계속 사용할 때의 위험은 공개 저장 차단과 별개다.
- 영상은 브라우저에서 읽고 분석한다. MediaPipe의 JS·WASM·모델과 Three.js 모듈은 현재 브라우저 로딩 경로를 유지한다. Vercel에서 `.mjs`를 JavaScript로 제공하도록 설정했다.

[Vercel Node.js 함수](https://vercel.com/docs/functions/runtimes/node-js) · [Vercel 설정](https://vercel.com/docs/project-configuration/vercel-json)

## 다음 실행 순서

1. 프로젝트 루트에서 `node scripts/build-public.mjs`와 `node --test vercel.test.mjs preview.test.mjs preview.write.test.mjs`를 실행한다. `git status --short`로 최신 포즈 모듈과 배포 파일을 확인한다. `.env`, `.env.local`, `dist`, `.vercel`은 Git 대상에서 제외한다.
2. 공개할 선수 이름과 경기 데이터 범위를 확인한다. Vercel Hobby 프로젝트를 연결할 권한을 받은 뒤 프로젝트 루트에서 CLI의 `vercel link`를 사용하고, 대시보드에 두 서버 환경 변수를 Preview에 등록한다. 로컬 CLI 인증이나 실제 연결 없이 수행한 이번 검증에서는 플랫폼 관리자 설정을 확인하지 않았다.
3. **배포 승인을 받은 후에만** `vercel`로 Preview를 만든다. 선수·경기 조회와 랭킹, 저장 버튼 비활성 상태, `POST /api/matches`의 405, `/.env` 등의 접근 차단을 확인한다. 실제 MP4로 2D·3D·각도·A/B 비교를 실행하고 Network에서 원본 영상 업로드가 없는지 확인한다.
4. Preview 확인과 공개 승인 후 Production 환경 변수도 등록하고 `vercel --prod`를 실행한다. 이후 변경도 Preview에서 확인하고 공개한다. 기존 [배포계획서](배포계획서.md)의 비용 한도를 함께 확인한다.

[Vercel 환경 변수](https://vercel.com/docs/environment-variables) · [Vercel CLI](https://vercel.com/docs/cli/deploy)
