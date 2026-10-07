# 온가드(OnGuard) GitHub 공유 안내

팀명은 **부캉이**, 아이디어명은 **온가드(OnGuard)**다. 의미는 **Wi‑Fi 센싱 기반 비촬영 생활안전 보조 시스템**이다.

정리 기준일: 2026-10-07. 저장소는 [kplime/git-practice](https://github.com/kplime/git-practice), 프로젝트 루트 폴더는 `git-practice`, 기본 브랜치는 `main`이다. 현재 공유 범위는 보호자 모바일 웹과 Express/PostgreSQL API 시제품, Python 환경·전송 도구·감지 정책이다. 실제 CSI 감지 모델·미복귀 타이머·자동 장애 사건·원격 Push는 미구현 후보이며 [README](../README.md#다음-구현-후보--미구현)에 정리했다.

## 공유할 파일

| 경로 | 내용 |
|---|---|
| `public/` | 모바일 웹 HTML·CSS·JavaScript·알림 클릭 Service Worker |
| `src/` | Express API, PostgreSQL 초기화, 생성 샘플 정의 |
| `scripts/` | 환경·DB 설정과 검증 도구 |
| `python/` | Python 소스와 requirements 파일. `__pycache__` 제외 |
| `tests/` | 웹·Python 정책 검증 소스. `__pycache__` 제외 |
| `docs/` | API 계약·프로젝트 설계·화면 검토·공유 안내 |
| `README.md`, `package.json`, `package-lock.json` | 실행 안내·Node 의존성 |
| `.gitignore`, `.gitattributes`, `.env.example` | 제외 규칙·줄바꿈 규칙·비밀값 없는 설정 예제 |

프로젝트 기획 문서는 `PROJECT_PLAN.md`로 이름을 정리했다. 특정 질환·야간 제한 없이 한 공간부터 진행하는 현재 목표를 따른다.

## 각 PC에서 생성할 파일

- `.env`: 실제 DB 비밀번호·게이트웨이 토큰. `npm.cmd run setup`으로 각 PC에서 생성한다.
- `node_modules/`, `.venv/`: 잠금 파일을 기준으로 각 PC에서 설치한다.
- Python 캐시, 로그, SQLite DB와 sidecar, DB dump, 개인키·인증서: 로컬 실행 파일이다.
- `data/`, `models/`, `reports/`: 실제 수집 데이터·학습 산출물·자동 생성 보고서다. 검토한 평가 요약은 문서로 작성해 `docs/`에 공유한다.
위 로컬 경로는 `.gitignore`에서 제외한다. GitHub 웹에서 개별 파일을 올릴 때도 `.env`, DB, 설치 폴더가 선택되지 않았는지 확인한다.

## 팀원이 처음 실행할 때

저장소를 받은 뒤 `package.json`이 있는 폴더에서 Windows PowerShell로 실행한다. Node 24.15 이상과 로컬 PostgreSQL을 준비한다. 검증 환경은 PostgreSQL 18, Python 3.14.2다.

```powershell
git clone https://github.com/kplime/git-practice.git
cd git-practice
npm.cmd ci
npm.cmd run setup
npm.cmd run db:setup
npm.cmd run db:check
npm.cmd test
npm.cmd run dev
```

프로젝트 소스가 원격 저장소에 공유된 뒤 위 절차를 실행한다. 이미 저장소를 받은 경우 `git-practice` 폴더에서 `npm.cmd ci`부터 실행한다. `db:setup`의 PostgreSQL 관리자 비밀번호는 로컬 입력창에 입력한다. 기본 DB 이름은 `onguard`다. 예전 `wifi_csi_safety` DB를 사용 중이면 [README의 이름 변경 절차](../README.md#기존-프로젝트-db-이름-변경)를 먼저 따른다. 이미 사용할 다른 DB가 있으면 `.env`를 해당 DB 접속 정보에 맞추고 `db:setup` 대신 `db:check`를 실행한다. 기존 역할 비밀번호나 DB 내용은 설정 스크립트가 덮어쓰지 않는다.

웹은 `http://127.0.0.1:3002/`에서 연다. GitHub Pages에는 PostgreSQL과 Node 서버가 없어 현재 전체 서비스를 그대로 실행할 수 없다. GitHub 소스 공유와 서비스 배포는 별도 작업이다.

샘플 사건이 필요하면 다른 터미널에서 `npm.cmd run demo:seed`를 실행한다. 실제 센서 신호가 없어도 사건 목록은 확인할 수 있으며 관측 상태는 연결 대기로 유지한다. 샘플은 실제 감지 성능의 근거로 사용하지 않는다.

Python이 필요한 경우 [README의 Python 준비](../README.md#python-실행-환경)를 따른다. PostgreSQL 설정과 Python 환경 준비 후 `npm.cmd run test:integration`으로 연동을 확인한다. 통합 검증은 별도 임시 스키마·서버를 사용하고 종료 후 정리한다.

현재 지원·검증 기준은 Windows PowerShell이다. Linux/macOS에서는 `npm`과 `.venv/bin/python`을 사용하되 DB 준비와 플랫폼별 패키지 호환은 따로 확인한다.

## 저장소 연결 상태

2026-10-07 확인 시 `git-practice` 폴더에 `.git`이 있고 `origin`은 `https://github.com/kplime/git-practice`로 연결되어 있다. 로컬 `main`은 `origin/main`을 추적한다. 원격 연결과 프로젝트 소스 공유는 별도다. 확인 시점의 프로젝트 파일은 대부분 아직 커밋되지 않았으며, 커밋·푸시 이후 팀원이 받을 수 있다.

Git으로 등록할 때는 스테이징된 목록에 `.env`, 설치 폴더, 로컬 DB·개인키가 없는지 확인한다. `.gitignore`는 이미 추적 중인 파일을 자동으로 제거하지 않는다. 공개 라이선스는 팀 합의 후 지정한다.

## 팀 작업 절차

Git 초기화와 원격 연결은 완료된 상태다. 저장소 루트에서 다음 명령으로 연결과 변경 목록을 확인한다.

```powershell
git remote -v
git status --short --branch
```

이번 초기 정리는 `wonjun/setup` 브랜치에서 진행한다. 프로젝트 최초 공유는 팀장님과 커밋 범위를 정한 뒤 진행한다. 이후 각 기능은 `wonjun/작업명` 형식의 작업 브랜치에서 개발하고 팀장님의 검토를 거쳐 `main`에 반영한다. 예를 들어 아래 명령은 `main`에서 `wonjun/my-task` 작업 브랜치를 만든다. 시작 전에 `git status`로 현재 변경을 확인하고, 커밋되지 않은 변경이 있으면 먼저 보관·커밋할 범위를 정한다.

```powershell
git switch main
git pull --ff-only origin main
git switch -c wonjun/my-task
```

변경한 파일만 선택해 추가하고 `git diff --cached`로 내용을 확인한 뒤 커밋한다. 원격에 올린 작업 브랜치로 Pull Request를 만들어 검토를 요청한다. `.env`, 설치 폴더, 로컬 DB는 공유하지 않는다. 팀원은 각 PC에서 환경 설정과 DB를 준비한다.

## 검토 기록

### 저장소 연결 후 확인 · 2026-10-07

- `origin` 주소와 `main`의 추적 브랜치를 확인한 뒤 초기 정리용 `wonjun/setup` 브랜치를 생성했다. 커밋·푸시는 이 정리 작업에서 실행하지 않았다.
- `git check-ignore -v`로 `.env`, `node_modules/`, `.venv/`가 제외되는 것을 확인했다. 해당 경로는 현재 추적 파일 목록에도 없다. `.env.example`은 공유 대상이다.
- 프로젝트 루트 이름, 저장소 주소, Node 패키지 이름과 잠금 파일의 루트 이름을 `git-practice`에 맞췄다. 제품명은 온가드(OnGuard), 기본 DB 이름은 `onguard`다.

### 최초 공유 준비 때의 검증 · 2026-10-06

- `npm.cmd test`: UI 검증 25개 통과.
- `npm.cmd run test:integration`: 임시 PostgreSQL 스키마·별도 서버에서 API 검증 통과. Python 정책 8개와 실제 Python→API 시험 전송도 함께 통과. 검증 서버·임시 스키마는 종료 시 정리했다.
- `npm.cmd ls --depth=0`: 직접 의존성 Express 5.2.1, pg 8.23.1, 개발 의존성 jsdom 30.1.2 확인.
- 소스·설정 예제·문서 파일에서 현재 로컬 `.env`의 비밀번호·토큰과 일치하는 값, 개인키 블록·GitHub 토큰 패턴이 발견되지 않았다. 임의의 모든 비밀값이나 과거 Git 기록까지 검사한 결과는 아니다.
- Markdown의 로컬 파일 링크가 모두 존재하는 파일을 가리키는 것을 확인했다. 외부 참고 자료 전체를 재검증한 결과는 아니다. 대회 모집 안내는 정리일에 공식 홈페이지에서 재확인했다.
- `.gitignore`에 SQLite DB·sidecar, DB dump, 개인키·인증서, 로그와 에디터 설정 제외를 보강했다. `.env.example`은 placeholder만 포함한다.
- 실제 휴대폰 렌더링·시스템 알림·CSI 측정·원격 Push는 별도 검증 대상이다. 현재 보호자 API는 로그인 없는 localhost 개발용이다.
