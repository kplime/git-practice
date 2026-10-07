# 온가드(OnGuard)

> Wi‑Fi 센싱 기반 비촬영 생활안전 보조 시스템

**팀명: 부캉이**

**GitHub 저장소:** [kplime/git-practice](https://github.com/kplime/git-practice) · 기본 브랜치 `main`

제3회 미래융합인재 발굴 소프트웨어 챌린지 준비용 프로젝트입니다. 고정된 실내 공간에서 낙상 의심과 침대 이탈 후 미복귀 가능성을 감지하고 보호자가 확인할 수 있는 시스템을 개발합니다. 동아리방 또는 허가받은 기숙사 한 곳부터 검증합니다.

현재는 **Node.js Express + PostgreSQL API와 보호자 모바일 웹 시제품**입니다. 실제 CSI 수집·학습·추론과 원격 푸시는 후속 개발 단계입니다. Python에는 환경 검사, 게이트웨이 전송 도구, 감지 사용·시간대 정책이 있습니다.

```text
git-practice/
├── public/          # HTML, CSS, 실제 API를 호출하는 app.js
├── src/             # Express API, PostgreSQL 초기화
├── scripts/         # 환경 설정, DB 준비·확인, 통합 검증
├── python/          # 의존성·환경 검사·게이트웨이 API 클라이언트·시험 전송
├── tests/           # 모바일 웹·Python 감지 정책 검증
├── docs/            # 기획·학습 설계, 현재 API 계약
├── .gitignore       # 로컬 비밀값·설치 폴더·수집 데이터 제외
├── .gitattributes   # 운영체제 간 줄바꿈 규칙
├── .env.example     # 공유 가능한 환경설정 예제
├── package.json
└── package-lock.json
```

`.env`, `node_modules`, `.venv`는 각 PC에서 생성합니다. GitHub에는 소스와 설정 예제·의존성 잠금 파일을 공유합니다. 업로드할 파일과 초기 실행 순서는 [GitHub 공유 안내](./docs/GITHUB_UPLOAD.md)를 참고하세요.

## 현재 동작

- 웹 홈: 최신 관측·통신·품질·침대 추정·미확인 사건 조회. 5초마다 홈 상태 갱신.
- 사건 목록: 유형 구분, 기본 접힌 처리 상태·기간 조회(발생 시각 기준), 날짜별 묶음, 처리·해소 사유 요약, 추가 페이지, 상세와 처리 이력. 시작일·종료일에 시각을 선택해 지정 가능. 시각을 비우면 날짜 전체, 종료 시각을 지정하면 해당 분 전체 포함. 접힌 상태에도 선택 상태·날짜·시각 표시. 한쪽만 지정하거나 날짜·시각을 전체 기간으로 함께 초기화 가능.
- 알림 확인: ACKNOWLEDGED 기록. 상황 해소·타이머 변경과 구분.
- 상황 해소: 직접 관찰 체크와 3~1000자 사유를 요구. 버튼은 비활성 시 회색, 입력 조건을 충족하면 강조색. 상세 카드는 미확인·확인됨·해소됨에 따라 색상을 구분.
- 설정: 기기 상태 → 미복귀 → 낙상 의심 → 기기 장애 → 저장 순서. 감지 사용 여부와 미복귀 기준 1~1440분을 설정. 상시는 시간 입력을 숨기고 지정 시간은 표시(한국 시간·자정 넘김). 낙상 의심·센싱 연결 장애·기기 통신 장애를 독립 저장. 미저장·저장 중·저장 완료·기기 적용 대기를 구분. 기기에서 보고한 적용 버전과 연결을 확인한 뒤 '적용됨' 표시. 주기 갱신 중 입력과 저장 피드백 보존.
- 모바일 UI: 크림색 배경·흰색 일반 카드, 사건이 있을 때 홈 경고색 표시, 상단 브랜드·하단 메뉴 고정, 공통 SVG 아이콘. 시각은 날짜와 24시간제 HH:mm:ss로 표시. 토글 행 48px·뒤로 가기 44px 터치 영역과 입력 윤곽 강화.
- 게이트웨이 API: 토큰 인증·이벤트 중복 방지·heartbeat 순번 검사.
- Python: NumPy, SciPy, pandas, scikit-learn, pyserial, requests, python-dotenv 환경, camelCase API 전송 도구, 새 감지 사건의 생성 여부를 판단하는 detection_enabled. send_detection_event는 꺼진 유형의 새 전송을 건너뛰고, 기존 사건 재전송은 send_event로 유지. 측정·heartbeat와 감지 유형 설정을 구분. 실제 CSI 루프·자동 장애 사건 생성·Push 연결은 후속 개발.
- 실제 기기의 최근 측정이 15초 이내이고 연결·센싱·품질이 정상일 때만 현재 침대 상태 표시. 이탈 시각이 있으면 경과 시간 표시. 테스트 신호는 현재 관측·측정 시각·설정 적용 판정에서 제외. 실제 heartbeat가 없으면 연결 대기.
- 이 브라우저 알림 켜기·끄기와 설정 유지, 알림 권한 요청 및 이 기기의 알림 표시 확인. 끄면 표시 요청을 차단하고 준비 중인 요청을 취소. 요청 성공과 사용자가 확인한 실제 표시를 구분. 원격 푸시 수신 제어는 후속 개발.
- 샘플은 DB의 isDemo=true·details.source로 구분하며 화면은 일반 사용 화면과 같은 문구를 사용.

감지 알고리즘의 현재 구현 범위는 다음과 같습니다.

| 감지 유형 | 구현된 내용 | 남은 구현 |
|---|---|---|
| 장애 | 실제 heartbeat의 15초 기준 연결 상태와 측정 신선도 판정, 기기가 보고한 센싱·품질 상태 표시 | 장애 사건 자동 생성·복구·중복 방지와 실제 CSI 수집 중단 판정 |
| 미복귀 | 사용 여부·기준 시간·한국 시간대 정책과 새 사건 전송 제어, 기기가 보고한 이탈 시각의 경과 표시 | 침대 이탈·복귀 추정, 연속 미복귀 타이머·관측 중단 처리·자동 사건 생성 |
| 낙상 의심 | 감지 사용 정책, 외부에서 전달한 낙상 사건 저장·조회·처리 | 실제 CSI 전처리·특징 추출·모델 학습·실시간 낙상 분류와 자동 사건 생성 |

사건 수신·저장 기능과 설정 정책은 구현되어 있습니다. `python/check_environment.py`의 RandomForest는 개발 환경 확인용 작은 예제로, 실제 CSI 낙상 분류 모델은 아직 없습니다. CSI 수집·학습·실시간 추론·SQLite outbox·Web Push·보호자 로그인은 후속 작업입니다. 알림 화면은 실제 브라우저 권한과 Push 구현 전 상태를 구분합니다. 기획 문서의 확장 테이블·API는 현재 구현과 구분해서 읽어 주세요.

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

24개 사건 기록만 PostgreSQL에 넣습니다. 낙상 의심·미복귀·센서 장애·기기 통신 장애와 미확인·확인됨·해소됨을 포함합니다. 20개 이후 '이전 사건 더 보기', 상세 처리 이력·해소 사유를 확인할 수 있습니다. 실제 기기 신호가 없으면 현재 관측은 연결 대기이며 측정·신호 시각은 기록 없음, 설정 적용 상태는 연결 필요로 표시합니다. 화면에서 확인/해소한 기록은 다시 실행해도 덮어쓰지 않습니다. 실행 직후 상대 시각으로 만든 사건은 이후 그대로 보존합니다.

```powershell
# 기록만 넣기: 현재 상태가 연결됨으로 바뀌지는 않음
npm.cmd run demo:seed
# 시험 heartbeat 저장을 확인할 때만 사용: 웹 관측에서는 제외됨
npm.cmd run demo -- --heartbeat --scenario=healthy
npm.cmd run demo -- --heartbeat --scenario=sensor-offline
npm.cmd run demo -- --heartbeat --scenario=gateway-offline
```

`--heartbeat`를 지정한 상태 도구는 시험 저장용입니다. `gateway-offline`은 한 번 보내고 종료하고, 다른 상태는 Ctrl+C까지 유지합니다. 모두 `isDemo=true`로 저장되며 `/api/status`는 이 신호를 제외합니다. 실제 heartbeat가 끊겨도 샘플로 대체하지 않습니다. 기본 `npm.cmd run demo`와 `demo:seed`는 사건만 생성합니다. 실제 평가에서는 `is_demo=false` 기록만 사용하고 샘플을 학습·정확도 측정에 포함하지 않습니다.

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

시험 전용 게이트웨이 ID로 상태와 유형별 시험 사건 네 개를 저장하고 30초 동안 heartbeat를 보냅니다. 실제 센서 연결·낙상 추론·장애 발생을 재현하는 도구가 아닙니다. 기록은 삭제하지 않고 isDemo=true로 보존합니다. 웹에서 유형 필터·상세·알림 확인·해소 사유를 확인하세요. 시험 heartbeat는 현재 관측·침대 상태·설정 적용 판정에서 제외됩니다.

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

아래 항목은 후속 개발 목록이다. 현재 코드에 기능이 연결되어 있거나 실제 감지가 되는 것은 아니다.

| 후보 | 구현 내용과 선행 조건 |
|---|---|
| 미복귀 타이머 | 실제 침대 이탈·복귀 판단을 받아 기준 시간 초과 시 이탈 episode당 한 건을 생성한다. 센싱 중단, 감지 시간대 종료·끄기, 프로세스 재시작 시 타이머 경계와 재개 조건을 처리한다. 먼저 CSI 기반 이탈·복귀 판단이 필요하다. |
| 장애 사건 자동 생성 | 실제 heartbeat 또는 센싱 상태를 바탕으로 장애 시작·복구를 기록하고, 같은 장애가 지속되는 동안 중복 사건을 만들지 않는다. 현재 15초 연결 판정은 화면 상태 조회용이다. |
| 전송 실패 재시도 | Python 로컬 SQLite outbox에 사건을 저장하고, 네트워크 복구 후 동일 eventId와 원래 payload로 재전송한다. 재시도 간격·성공 처리·오래된 사건 표기도 구현한다. |
| 설정 자동 동기화 | Python 게이트웨이가 서버 설정을 주기적으로 조회하고 감지 로직에 적용한다. 실제 적용 버전을 서버에 보고해 저장 설정과 기기 상태가 다른 경우를 표시한다. |
| 사용 기기 감지·관리 | 현재 브라우저의 OS·브라우저 표시에서 더 나아가 보호자 계정의 알림 구독 기기를 등록·식별하고, 기기별 구독 상태를 조회·해제한다. 계정 로그인과 실제 Push 구독을 함께 구현해야 한다. |
| 원격 푸시 알림 | HTTPS 기반으로 기기 구독 등록·갱신·해제, 서버 전송 작업·실패 재시도, 알림 클릭 후 해당 사건 상세 열기를 구현한다. 권한 요청과 로컬 시험 알림만으로는 원격 푸시가 되지 않는다. |

## 다음 개발 범위

1. ESP32-S3 공식 예제로 원시 CSI 수신·저장 확인.
2. 실제 수신 형식에 맞춘 파서·품질 검사·라벨 수집 도구.
3. 세션별 학습/검증/시험 분리 후 기준 모델과 오경보 평가.
4. 모델 출력·침대 추정·미복귀 상태 머신과 SQLite outbox.
5. 게이트웨이 heartbeat 지속·설정 동기화, detection_policy.py의 시간대 판단을 실제 미복귀 사건 생성에 연결하고 적용 버전 보고. 지정 시간 종료/알림 끄기 시 미복귀 타이머를 종료하고, 다시 활성화되면 새 관측으로 시작해 비활성 구간을 경과 시간에 포함하지 않음.
6. 보호자 인증·HTTPS·실제 Android Chrome Push 시험.

기본 접속은 localhost 개발용입니다. 현재 보호자 API에는 계정 인증이 없으므로 외부 공개와 실제 돌봄 운영 전에 해당 단계를 구현해야 합니다.

## 문서·근거

- [현재 API 계약](./docs/API.md)
- [화면 검토 결과와 남은 개발 항목](./docs/UI_REVIEW.md)
- [프로젝트 기획·센서·모델·평가 설계](./docs/PROJECT_PLAN.md)
- [GitHub 공유 안내와 검토 기록](./docs/GITHUB_UPLOAD.md)
- [node-postgres 연결 설정](https://node-postgres.com/features/connecting)
- [Python venv](https://docs.python.org/3/library/venv.html)

프로젝트 루트는 `git-practice`입니다. Git 원격 `origin`은 팀장님의 [kplime/git-practice](https://github.com/kplime/git-practice) 저장소를 사용합니다. 팀 작업 절차는 [GitHub 공유 안내](./docs/GITHUB_UPLOAD.md#팀-작업-절차)를 따릅니다.
