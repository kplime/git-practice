# 온가드(OnGuard)

> Wi‑Fi 센싱 기반 비촬영 생활안전 보조 시스템

**팀명: 부캉이**

**대회 분야: AI 및 빅데이터** · 2026-10-07 아이디어 소개서 기준

**GitHub 저장소:** [kplime/git-practice](https://github.com/kplime/git-practice) · 기본 브랜치 `main`

제3회 미래융합인재 발굴 소프트웨어 챌린지 준비용 프로젝트입니다. 독거 고령자·낙상 위험이 높은 장애인 등 생활안전 확인이 필요한 사람을 위해, ESP32로 Wi-Fi CSI 데이터를 수집하고 로컬 AI 모델로 실내 활동 변화를 분석합니다. 고정된 실내 환경에서 정상 생활 동작과 낙상 유사 동작의 구분 가능성을 검증하고, 낙상 의심이나 장시간 저활동이 감지되면 사용자 확인 및 보호자 알림을 제공하는 시스템을 목표로 합니다.

카메라 영상·음성을 수집하거나 신체에 기기를 착용할 필요가 없는 방식입니다. 웹·앱 대시보드로 실시간 활동 변화, 사건 발생 및 응답 이력을 확인해 보호자의 상태 확인을 돕고자 합니다.

현재는 **Node.js Express + PostgreSQL API와 보호자 모바일 웹 시제품**입니다. 실제 CSI 수집·학습·추론과 원격 푸시는 후속 개발 단계입니다. Python에는 환경 검사, 게이트웨이 전송 도구, 감지 사용·시간대 정책이 있습니다.

소개서의 핵심 내용은 [프로젝트 설명](./docs/PROJECT_PLAN.md)과 [소개서 반영 요약](./docs/IDEA_ALIGNMENT.md)에 정리했습니다.

```text
git-practice/
├── public/          # HTML, CSS, 실제 API를 호출하는 app.js
├── src/             # Express API, PostgreSQL 초기화
├── scripts/         # 환경 설정, DB 준비·확인, 통합 검증
├── python/          # 의존성·환경 검사·게이트웨이 API 클라이언트·시험 전송
├── tests/           # 모바일 웹·Python 감지 정책 검증
├── docs/            # 프로젝트 설명, API 계약·화면 검토
├── .gitignore       # 로컬 비밀값·설치 폴더·수집 데이터 제외
├── .gitattributes   # 운영체제 간 줄바꿈 규칙
├── .env.example     # 공유 가능한 환경설정 예제
├── package.json
└── package-lock.json
```

`.env`, `node_modules`, `.venv`는 각 PC에서 생성합니다. GitHub에는 소스와 설정 예제·의존성 잠금 파일을 공유합니다. 업로드할 파일과 초기 실행 순서는 [GitHub 공유 안내](./docs/GITHUB_UPLOAD.md)를 참고하세요.

## 현재 동작

- 보호자 모바일 웹에서 관측·기기 연결 상태와 사건을 조회합니다.
- 사건 유형·처리 상태·날짜와 시각으로 조회하고 상세·처리 이력을 확인합니다.
- 보호자의 알림 확인과 직접 관찰에 따른 상황 해소 기록을 구분합니다.
- 감지 설정을 저장하고 기기가 보고한 적용 상태를 확인합니다.
- 실제 신호만 현재 관측에 사용하며 시험 데이터는 사건 기록과 구분합니다.
- 이 브라우저 알림 켜기·끄기, 권한 요청과 알림 표시 확인이 가능합니다.

실제 동작하는 API와 화면의 세부 사항은 [API 계약](./docs/API.md)과 [화면 검토 기록](./docs/UI_REVIEW.md)을 참고하세요.

| 소개서의 핵심 기능 | 현재 상태 |
|---|---|
| CSI 수집·로컬 AI 분석 | 실제 센서 수집·학습·추론 구현 전 |
| 낙상 유사 동작 구분 | 사건 저장·조회는 구현, 실제 CSI 분류 모델은 구현 전 |
| 장시간 저활동 감지 | 구현 전 |
| 보호자 알림 | 브라우저 표시 확인은 구현, 원격 푸시는 구현 전 |
| 활동·사건·응답 이력 대시보드 | 모바일 웹의 사건 조회·보호자 처리 이력 구현, 실시간 활동 지표는 구현 전 |

`python/check_environment.py`의 RandomForest 예제는 실행 환경 확인용이며 실제 CSI 낙상 모델의 학습 결과가 아닙니다.

## 1. 로컬 환경 준비

검증 환경은 Node.js 24.19.0, PostgreSQL 18, Python 3.14.2와 Windows PowerShell입니다. Node 최소 버전은 24.15입니다. 웹·API 실행에는 Node와 PostgreSQL이 필요하며 Python은 분석 도구·Python 연동 검증 시 준비합니다.

```powershell
git clone https://github.com/kplime/git-practice.git
cd git-practice
npm.cmd ci
npm.cmd run setup
```

이미 저장소를 받은 경우 `git-practice` 폴더에서 `npm.cmd ci`부터 실행합니다. 팀원이 프로젝트를 받으려면 프로젝트 소스가 먼저 원격 저장소에 커밋·푸시되어 있어야 합니다.

setup은 .env가 없을 때만 생성하고 프로젝트용 DB 비밀번호와 게이트웨이 토큰을 임의로 만듭니다. 기존 .env는 덮어쓰지 않습니다. 비밀값을 출력하지 않습니다. 기본 포트는 **3002**입니다. PORT를 바꾸면 API_BASE_URL도 함께 바꾸세요.

## 2. PostgreSQL 준비

### 프로젝트 전용 DB·계정 생성

```powershell
npm.cmd run db:setup
```

관리자 postgres 비밀번호를 숨겨진 입력으로 받습니다. 관리자 비밀번호는 파일에 저장하지 않습니다. .env의 프로젝트 비밀번호로 wifi_csi_app 계정과 그 계정 소유의 **onguard** DB를 생성하고 테이블 네 개를 초기화합니다.

기존 계정 비밀번호나 기존 DB 내용은 변경하지 않습니다. 동명의 계정이 이미 있다면 .env의 PGPASSWORD를 해당 계정 비밀번호와 맞춰야 합니다. 관리자 이름이 다르면:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-db.ps1 -AdminUser 본인관리자계정
```

Bypass는 이 PowerShell 프로세스에만 적용하며 PC 실행 정책을 변경하지 않습니다.

### 기존 프로젝트 DB 이름 변경

예전 `wifi_csi_safety` DB를 사용 중이면 새 DB를 만들지 말고 다음 명령을 실행합니다. Node 서버와 해당 DB를 연 pgAdmin 등의 연결을 먼저 닫으세요.

```powershell
npm.cmd run db:rename
npm.cmd run db:check
```

관리자 비밀번호는 로컬 터미널의 숨겨진 입력으로 받습니다. 기존 DB 자체의 이름을 `onguard`로 바꾸고, 앱 계정으로 다시 접속해 사건·처리 이력·기기 수와 설정이 유지되는지 확인한 뒤 `.env`의 PGDATABASE를 갱신합니다. 다른 설정·비밀번호는 유지합니다. 실패하면 출력 안내에 따라 연결을 닫거나 권한을 확인하고 다시 실행하세요. 두 DB가 모두 있으면 병합·삭제하지 않고 중단합니다. 이름 변경 후 `.env` 저장만 실패한 경우에도 같은 명령으로 재확인·갱신할 수 있습니다. 기존 `.env`는 `setup` 명령으로 덮어쓰지 않으므로 이 전환 명령을 사용해야 합니다.

이름 변경에는 관리자 권한 또는 소유권과 CREATEDB 권한이 필요합니다. [PostgreSQL ALTER DATABASE](https://www.postgresql.org/docs/18/sql-alterdatabase.html).

### 이미 사용할 DB·계정이 있을 때

.env의 PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD를 직접 맞추고 db:setup을 생략합니다. 계정에 연결·스키마 사용·테이블 생성 권한이 필요합니다. 서버는 선택한 DB에 프로젝트 테이블을 만듭니다.

```powershell
npm.cmd run db:check
```

로그인과 public 스키마의 프로젝트 테이블 수를 확인합니다. 비밀번호는 출력하지 않습니다.

## 3. 웹·API 실행

```powershell
npm.cmd run dev
```

- 웹: **http://127.0.0.1:3002/**
- 서버·DB 확인: http://127.0.0.1:3002/api/health
- 감시 없이 실행: npm.cmd start

VS Code Live Preview 주소 대신 Node 주소로 엽니다. 화면과 API가 같은 서버에 있어야 합니다. Live Preview가 3000에서 실행 중이어도 Node 포트 3002과 분리됩니다. .env 변경 후 서버를 다시 시작하세요.

## 4. 샘플 데이터와 Python 환경

### 화면 확인용 샘플 데이터

Node 서버가 실행 중인 상태에서 **별도 터미널**을 열어 실행합니다.

```powershell
npm.cmd run demo
```

24개 샘플 사건을 PostgreSQL에 넣습니다. 사건 유형·처리 상태·페이지 이동·상세 처리 이력과 해소 사유를 확인할 수 있습니다. 실제 센서 신호가 없으면 현재 관측은 연결 대기로 표시합니다. 화면에서 확인·해소한 기록은 다시 실행해도 덮어쓰지 않습니다.

```powershell
# 기록만 넣기: 현재 상태가 연결됨으로 바뀌지는 않음
npm.cmd run demo:seed
# 시험 heartbeat 저장을 확인할 때만 사용: 웹 관측에서는 제외됨
npm.cmd run demo -- --heartbeat --scenario=healthy
npm.cmd run demo -- --heartbeat --scenario=sensor-offline
npm.cmd run demo -- --heartbeat --scenario=gateway-offline
```

`--heartbeat`를 지정한 도구는 시험 상태 저장용입니다. 시험 신호는 현재 관측에서 제외되며 실제 신호가 끊겨도 대체 신호로 사용하지 않습니다. 기본 `npm.cmd run demo`와 `demo:seed`는 사건만 생성합니다. 샘플은 실제 센싱 성능 평가에 포함하지 않습니다.

### Python 실행 환경

Python 3.14 환경에서 프로젝트 전용 가상 환경을 만듭니다. 활성화 없이 실행 파일을 직접 사용하면 PowerShell 정책에 영향을 받지 않습니다.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --only-binary=:all: -r python/requirements-lock.txt
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe python/check_environment.py
```

requirements.txt는 허용 범위, requirements-lock.txt는 검증 환경에서 확인한 직접·간접 의존성 버전입니다. Python/OS가 다르면 호환 wheel을 확인해야 합니다. 작은 RandomForest 실행은 생성 데이터로 런타임을 확인할 뿐 낙상 모델 학습 결과가 아닙니다.

### Python → API → 웹 시험

Node 서버가 실행 중인 별도 터미널에서:

```powershell
.\.venv\Scripts\python.exe python/send_demo.py --heartbeat-seconds 30
```

시험 전용 게이트웨이 ID로 상태와 유형별 시험 사건 네 개를 저장하고 30초 동안 heartbeat를 보냅니다. 실제 센서 연결·낙상 추론·장애 발생을 재현하는 도구가 아닙니다. 기록은 삭제하지 않고 isDemo=true로 보존합니다. 웹에서 유형 필터·상세·알림 확인·해소 사유를 확인하세요. 시험 heartbeat는 현재 관측·설정 적용 판정에서 제외됩니다.

## 5. 검증

```powershell
npm.cmd test
# PostgreSQL 설정 후 별도로 실행
npm.cmd run test:integration
```

통합 검증은 같은 PostgreSQL DB의 임시 스키마와 별도 서버 포트를 사용합니다. 프로젝트 사건·설정은 변경하지 않고 임시 스키마만 종료 시 정리합니다. DB 계정에 스키마 생성 권한이 필요합니다. 인증·순번·중복·확인/해소·필터·동일 시각의 페이지 이동·설정·정적 파일을 확인합니다.

UI 검증은 DOM 환경에서 API 응답을 제어해 목록·상세·폼·실패·오래된 상태 표시를 확인합니다. 실제 CSS를 포함해 사건 클릭·상세 직접 주소·뒤로/앞으로 이동의 활성 화면과 기간 조회를 확인합니다. 실제 브라우저 렌더링·휴대폰 Push 검증을 대신하지 않습니다.

`npm.cmd test`는 DB 없이 UI 검증을 실행합니다. 통합 검증은 `.venv`가 준비되어 있으면 Python 정책·API 전송도 함께 확인하고, 없으면 Python 부분을 건너뛴다고 표시합니다. 일반 개발 서버를 미리 실행할 필요는 없습니다.

## 다음 구현 후보 · 미구현

소개서에 제시된 다음 기능을 구현 대상으로 설명합니다.

- ESP32 기반 Wi-Fi CSI 수집과 로컬 AI 분석.
- 정상 생활 동작과 낙상 유사 동작의 구분.
- 장시간 저활동 감지와 사용자 확인·보호자 알림.
- 실시간 활동 변화와 사건·응답 이력을 보여주는 웹·앱 대시보드.

## 문서·근거

- [현재 API 계약](./docs/API.md)
- [아이디어 소개서 반영 요약](./docs/IDEA_ALIGNMENT.md)
- [소개서 기준 삭제·추가·유지할 구현 메모](./docs/IMPLEMENTATION_TODO.md)
- [화면 검토 결과와 남은 개발 항목](./docs/UI_REVIEW.md)
- [소개서 기준 프로젝트 설명](./docs/PROJECT_PLAN.md)
- [GitHub 공유 안내와 검토 기록](./docs/GITHUB_UPLOAD.md)
- [node-postgres 연결 설정](https://node-postgres.com/features/connecting)
- [Python venv](https://docs.python.org/3/library/venv.html)

프로젝트 루트는 `git-practice`입니다. Git 원격 `origin`은 팀장님의 [kplime/git-practice](https://github.com/kplime/git-practice) 저장소를 사용합니다. 팀 작업 절차는 [GitHub 공유 안내](./docs/GITHUB_UPLOAD.md#팀-작업-절차)를 따릅니다.
