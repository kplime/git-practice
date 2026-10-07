# 온가드(OnGuard) 프로젝트 기획·개발 문서

- 팀명: **부캉이**
- 아이디어명: **온가드(OnGuard)**
- 의미: **Wi‑Fi 센싱 기반 비촬영 생활안전 보조 시스템**

> 제3회 미래융합인재 발굴 소프트웨어 챌린지 준비용 기획·개발 문서\
> 검토일: 2026-10-06\
> 상태: 웹·API 시제품 구현, 실제 CSI 감지·원격 알림은 후속 개발. 아래 성능·수집량·파라미터는 측정 결과가 아닌 초기 실험안이다. 현재 실행법·구현 범위는 [README](../README.md), 구현된 계약은 [API.md](./API.md)를 따른다.

## 1. 프로젝트 목표와 적용 범위

카메라나 웨어러블 없이 WiFi CSI의 변화를 분석해 **일상 동작과 낙상 의심 동작을 구분하고, 침대 이탈 후 복귀가 확인되지 않는 상황을 보호자에게 알리는 실내 돌봄 보조 시스템**을 개발한다.

시간대를 제한하지 않고, 치매 진단이나 특정 질환을 전제로 하지 않는다. 개발·시연은 동아리방 또는 허용된 기숙사 공간 중 **한 장소를 선택해도 진행 가능**하며, 성인 팀원의 모의 동작으로 검증한다. 두 장소 사이의 이동 검증은 선택 사항이다.

| 항목 | 이번 MVP 범위 |
|---|---|
| 대상 공간 | 고정된 센서 배치의 1인 실내 공간 |
| 핵심 감지 | 모의 낙상과 일상 동작의 구분, 침대 이탈·복귀 추정 |
| 보호자 기능 | 모바일 웹에서 상태·이벤트 조회, Push 알림, 확인 기록 |
| 감지 영역 | 실제 반복 실험으로 평가한 위치에 한정 |
| 개발 장비 | ESP32-S3, USB로 연결한 노트북 또는 소형 PC |
| 제외 | 질환·부상 진단, 여러 사람 식별, 여러 방 정밀 위치 추적, 대규모 딥러닝, iOS 검증 |

**낙상 의심 구분은 필수 개발 목표다.** 구분이 어려워도 단순 움직임 감지를 낙상 감지로 표현하지 않는다. 실패 조건과 미완료 기능을 기록한다.

움직임이 적게 관측됐다는 사실만으로 수면·침대 재실·안전을 확인할 수 없다. 보호자의 알림 확인도 사고 해소나 침대 복귀를 뜻하지 않는다.

### 대회 일정과 내부 개발 일정

2026-10-06에 확인한 경산이노베이션아카데미 공식 홈페이지의 보도자료 안내에는 **2026년 10월 7일까지 참가자를 모집**한다고 안내되어 있다. 접수 완료 여부와 변경 공지는 팀에서 별도로 확인한다. [공식 모집 안내](https://www.gsia.kr/gsia/index.do)

이 문서의 **3주 계획은 팀 내부 개발 계획**이다. 참가 접수와 개발기획서 제출, 작품 제출, 본선 발표의 마감이 같다고 가정하지 않는다. 상세 공고·첨부 서식에서 제출물과 일정을 확인해 팀 캘린더에 옮긴다. 상세 제출 시각과 최종 작품 마감은 이 문서에서 확정하지 않았다.

## 2. 해결하려는 문제와 기술 근거

카메라는 사생활 부담이 있고, 웨어러블은 착용·충전이 필요하다. WiFi CSI는 영상·음성을 직접 수집하지 않고 공간의 무선 채널 변화를 관측한다.

CSI는 Channel State Information이다. 사람의 움직임에 따라 전파의 반사·차폐가 변하면 여러 부반송파의 복소 채널 값도 달라진다. RSSI 하나만 보는 방식보다 분석할 정보가 많지만, CSI 자체에 “낙상”이나 “침대 복귀”라는 정답이 들어 있지는 않다.

Espressif는 CSI 수집과 움직임·재실 감지 예제를 제공한다. 낙상 구분에는 별도의 라벨 데이터, 분류기와 평가가 필요하다. [ESP-CSI 공식 프로젝트](https://github.com/espressif/esp-csi)

ESP32 CSI 기반 낙상 분류 연구와 RF 기반 온라인 낙상 연구가 존재한다. 다른 논문의 성능을 본 프로젝트의 성능으로 사용하지 않는다. [ESP32 기반 연구](https://doi.org/10.1016/j.jiixd.2024.04.001), [SiFall](https://arxiv.org/abs/2301.03773)

다른 공개 구현에는 Python 분석과 Express·SQLite·PWA를 조합한 Buoy, Python 분석과 FastAPI·React를 조합한 ElderCare가 있다. 특정 웹 백엔드가 필수라는 근거는 아니다. 해당 저장소의 성능·실행 가능성을 팀이 재현한 상태도 아니다. [Buoy](https://github.com/GabeMerc/Buoy---CSI-For-Fall-Detection), [ElderCare](https://github.com/dungnotnull/wifi-sensing-based-elderlycare-deeplearning)

## 3. 기술 스택과 담당 경계

초기 설계 검토에서는 백엔드 선택을 열어 두었지만, 현재 시제품 구현은 사용자가 선택한 **Python 분석 프로그램 + Node.js·Express 웹 서버 + 사용 가능한 로컬 PostgreSQL** 기준으로 진행한다. 실제 DB 접속 정보는 프로젝트 비공개 `.env`에만 둔다.

| 부분 | 기본 설계안 | 담당 기능 |
|---|---|---|
| 펌웨어 | C + ESP-IDF + 공식 esp-csi 예제 | 패킷 송수신, CSI·메타데이터 출력 |
| 로컬 분석 | Python + NumPy + SciPy + pandas + pyserial | 수집, 전처리, 특징 추출, 실시간 추론 |
| 모델 | scikit-learn Random Forest | 모의 낙상과 일상 동작 구분 |
| 웹 서버 | Node.js + Express | 상태 API, 이벤트·확인 기록, 권한 검사 |
| 저장 | PostgreSQL (서버), SQLite (Python 게이트웨이 outbox) | 서버 이벤트 DB와 별도 로컬 재전송 큐 |
| 알림 | Node.js web-push + VAPID | 보호자 브라우저 Push |
| 화면 | HTML + CSS + JavaScript | 반응형 보호자 웹, Fetch로 상태 조회 |
| 설치 기능 | Web App Manifest | Android 홈 화면 설치는 선택 |
| 협업 | Git + GitHub | 코드·설정·실험 변경 기록 |

현재 코드 기준은 Express + PostgreSQL이다. Python 웹 서버로 통일하는 FastAPI나 기존 우선콕 코드를 활용하는 Django는 대안으로만 남긴다. API 계약과 분석 프로그램을 유지한 채 **웹 서버 하나만** 사용한다.

앞서 기록에서 확인한 Django 구현 경험은 재사용 자료로 판단한다. 바이브코딩 경험을 독립 설계·운영 능력으로 환산하지 않는다. 최종 선택은 팀이 수정·디버깅할 수 있는 정도까지 고려한다.

### 프로그램별 역할

| 담당 프로그램 | 상태의 소유자 |
|---|---|
| ESP32 | 원시 패킷과 장치 메타데이터 |
| Python 분석 프로그램 | 센싱 품질, 동작 분류, 침대 추정 상태, 미복귀 타이머, 위험 감지 이벤트 생성 |
| Express 서버 | 이벤트 영구 저장, Push 전송 작업, 보호자 확인·해소 기록 |
| 모바일 웹 | 서버 상태 표시와 사용자 조작 |
| 서버 장애 감시 | 마지막 heartbeat 수신 이후 연결 단절 판단 |

Python과 서버에서 미복귀 타이머를 각각 실행하지 않는다. 감지 판단은 로컬에서 수행하고, 서버는 받은 이벤트의 전달 상태를 관리한다.

Firebase·Firestore·FCM은 필수가 아니다. 현재 Node 시제품은 PostgreSQL과 표준 Web Push 구성을 목표로 한다. Python 게이트웨이의 로컬 재전송 큐는 별도 SQLite 파일로 둔다. FCM을 선택해도 Firestore가 반드시 필요한 것은 아니다.

## 4. 전체 데이터 흐름

```text
TX1(침대 링크) ─┐
                 ├─ WiFi ─ RX ─ USB/UART ─ 로컬 Python
TX2(문 링크) ───┘                         │
                                          ├─ 원본·라벨·모델·재전송 큐
                                          ├─ 품질 검사 → 특징 → 분류
                                          └─ 침대 FSM / 낙상 이벤트
                                                     │
                                      HTTPS 이벤트·상태·heartbeat
                                                     ↓
                                            Express + PostgreSQL
                                                     │
                                      서버 전송 큐 → Web Push 서비스
                                                     ↓
                                      보호자 스마트폰의 브라우저 알림
                                                     │
                                      웹에서 조회·확인·해소 기록
```

노트북은 초기 제품의 **상시 실행 로컬 게이트웨이**다. ESP32만 켜 두면 모델 추론과 원격 알림까지 동작하는 구조가 아니다. 노트북의 절전·뚜껑 닫기·프로그램 종료·인터넷 단절을 장애 조건으로 다룬다.

클라우드에 노트북의 USB 포트를 연결할 수는 없다. USB 수집과 분석은 센서 옆에서 수행하고, 인터넷에는 결과만 전송한다.

## 5. 하드웨어 구성과 첫 검증

### 준비물

- ESP32-S3 개발 보드 3대: TX 2대 + RX 1대.
- 데이터 전송을 지원하는 USB 케이블, 안정적인 전원, 고정용 거치대.
- Windows 노트북, 필요하면 USB-UART 어댑터.
- 원리 확인용 2.4GHz 공유기.
- 센서 위치·방 구조를 기록할 평면도와 거리 측정 도구.

공유기만 이용하는 1대 구성은 CSI 출력 확인용이다. 모델 학습용 본 데이터는 최종 센서 구성에서 수집한다.

### 단계별 구성

| 단계 | 구성 | 통과 조건 |
|---|---|---|
| 1 | RX 1대 + 공유기 | CSI 행이 실제로 수집됨 |
| 2 | TX 1대 + RX 1대 | 빈 방·정지·움직임 신호 비교 가능 |
| 3 | TX 2대 + RX 1대 | 두 송신자의 패킷이 식별되고 수신율이 유지됨 |
| 4 | 침대·문 주변 고정 배치 | 뒤척임·이탈·복귀·문 통과를 비교할 데이터 확보 |

```text
┌──────────────────────────┐
│ TX1 ●   [침대]           │
│      \                   │
│       \ BED LINK         │
│        ● RX              │
│         \                │
│          \ DOOR LINK     │
│           ● TX2 [문]     │
└──────────────────────────┘
```

두 링크가 있어도 위치가 자동으로 구분되지는 않는다. 먼저 침대 뒤척임, 침대에서 일어나기, 문 통과, 침대 옆을 지나가기의 링크별 변화량을 비교한다. 공간 구분이 안 되면 배치와 감지 영역을 조정하고 데이터를 다시 모은다.

### 두 송신자를 사용할 때의 수정

공식 기본 `csi_recv` 소스는 `CONFIG_CSI_SEND_MAC` 하나를 기준으로 수신 CSI를 필터링한다. 두 송신기의 데이터를 쓰려면 **서로 다른 송신 MAC을 배정하고 RX 필터를 두 MAC의 허용 목록으로 수정**해야 한다. [공식 RX 소스](https://github.com/espressif/esp-csi/blob/master/examples/get-started/csi_recv/main/app_main.c)

TX1·TX2·RX의 장치 MAC은 중복하지 않게 관리한다. 허용 목록에 없는 무선 패킷은 특징 계산에서 제외한다. 실제 전파 채널은 TX·RX 모두 동일하게 맞춘다. BED LINK와 DOOR LINK는 같은 RF 채널 안의 송수신 링크 이름이다.

최초 목표는 송신기당 50 packet/s로 두고 혼잡·USB 처리량을 측정한다. 동시에 TX 2대에서 100 packet/s씩 송신하는 것으로 바로 시작하지 않는다. 송신 시점을 어긋나게 해도 장치 시계가 드리프트하므로 충돌 방지가 보장되지는 않는다.

단일 RX에서 두 링크의 수신이 불안정하면 **TX 1대 + RX 2대**도 대안으로 실험한다. 이 경우 USB 포트 두 개와 장치 간 시간 정렬이 추가로 필요하다. 본 데이터 수집 전에 구성을 정하고 `layout_id`를 부여한다.

## 6. 펌웨어와 개발 환경 구성

### 버전 고정

1. ESP-IDF와 esp-csi를 설치하고 선택 예제가 ESP32-S3에서 빌드되는 조합을 찾는다.
2. 성공한 ESP-IDF 버전, esp-csi 커밋, 보드 모델·리비전, sdkconfig, TX/RX 수정 코드를 기록한다.
3. 학습 데이터 수집 이후에는 펌웨어·채널·대역폭·출력 포맷을 임의로 변경하지 않는다.
4. 변경이 필요하면 `firmware_version`과 `layout_id`를 갱신하고 기존 모델 호환 여부를 다시 확인한다.

공식 예제마다 요구 환경과 경로가 다르다. 옛 console_test README에 적힌 ESP-IDF 버전을 모든 최신 예제의 권장 버전으로 사용하지 않는다. 실제 checkout의 README와 의존성 파일을 따른다.

Windows에서는 **ESP-IDF가 설정된 터미널**에서 실행한다. 아래 COM 번호는 예시이며 실제 장치 번호로 바꾼다.

```powershell
cd esp-csi/examples/get-started/csi_send
idf.py set-target esp32s3
idf.py menuconfig
idf.py build
idf.py -p COM3 flash
```

TX1·TX2는 각각 자신의 MAC·장치 ID가 들어간 펌웨어를 사용한다. RX는 `examples/get-started/csi_recv`에서 별도로 빌드·플래시한다. 공유기 기반 원리 확인에는 `csi_recv_router`를 사용한다.

`idf.py monitor`와 Python 수집기가 같은 COM 포트를 동시에 사용하지 않도록 한다. 펌웨어의 실제 출력 포트와 baud를 확인하며, USB 연결만으로 그 포트가 곧 UART 데이터 포트라고 가정하지 않는다. [console_test 안내](https://github.com/espressif/esp-csi/tree/master/examples/esp-radar/console_test)

### RX에서 구현할 사항

- 송신 MAC, 패킷 번호, 수신 장치 시각, CSI 길이·형식, 유효성 플래그를 출력한다.
- CSI callback에서는 버퍼와 메타데이터를 **복사**해 큐로 넘긴다. 포인터만 보관하면 callback 이후 유효하지 않을 수 있다.
- 낮은 우선순위 작업에서 직렬화·UART 출력한다. 큐가 가득 차면 드롭 수를 기록한다.
- 패킷 payload에서 순번을 꺼낼 때 길이와 포맷을 검사한다. 공식 예제의 고정 바이트 오프셋을 다른 프레임에도 그대로 적용하지 않는다.
- UART 로그와 CSI 데이터 행을 구분한다. 매 패킷의 디버그 로그 때문에 수집이 밀리지 않도록 한다.

CSI callback은 WiFi task에서 실행되므로 긴 처리를 피하는 것이 공식 지침이다. [ESP32-S3 CSI 가이드](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32s3/api-guides/wifi.html#wi-fi-channel-state-information)

### UART 처리량 확인

8N1 기준으로 데이터 1 byte에 약 10 bit를 사용한다. 다음 계산으로 출력 예산을 확인한다.

```text
필요 전송량(bit/s) ≈ 전체 packet/s × 평균 행 길이(byte) × 10
```

예를 들어 두 링크 합계 100 packet/s, 평균 700 byte/행이면 약 700,000 bit/s다. 921,600 baud에서도 로그·버퍼 지연을 포함한 여유가 크지 않다. 이것은 계산 예시이며 실제 행 길이와 손실은 측정해야 한다.

병목이 생기면 디버그 로그 축소, 출력 필드 축소, 송신율 조정, 검증된 바이너리 포맷 전환 순으로 해결한다. 실제 수신율이 낮은 상태에서 모델에만 보간 데이터를 늘리지 않는다.

## 7. 데이터 수집·라벨링 설계

**모델 학습 전에 데이터 수집 기준부터 정한다.** 시작은 “모의 낙상 패턴 / 일상 동작”의 이진 분류이고, 세부 동작 라벨은 오탐 원인 분석용으로 보존한다.

### 수집할 동작

| 세부 라벨 | 이진 학습 라벨 | 비교 이유 |
|---|---|---|
| EMPTY / STILL | NON_FALL | 빈 방·정지 구간의 배경 |
| WALK / STAND_UP | NON_FALL | 일반 이동·일어서기 |
| SIT_SLOW / SIT_FAST | NON_FALL | 특히 빠르게 앉는 오탐 |
| LIE_DOWN / BED_ROLL | NON_FALL | 정상 눕기·뒤척임 |
| BEND / PICK_OBJECT | NON_FALL | 낮아지는 동작 |
| DOOR_OPEN / WALK_BY | NON_FALL | 문·감지 영역 주변 교란 |
| FALL_SIM | FALL_LIKE | 안전한 모의 낙상 동작 |
| AMBIGUOUS | 학습에서 제외 | 정답 또는 신호 대응이 불확실한 구간 |

`FALL_LIKE`는 실험용 학습 라벨이다. 제품 화면에서는 `FALL_SUSPECTED`, “낙상 의심”으로 표시한다. `UNKNOWN`은 모델이 자동으로 모든 새로운 동작을 발견한다는 뜻이 아니라 품질 부족·불확실성 처리 결과다.

모의 낙상은 안전 매트와 보조자가 있는 조건에서 진행하고 자유낙하나 실제 부상을 요구하지 않는다. 안전하게 동작을 수행할 조건이 없으면 수집하지 않는다. 실제 어르신에게 낙상을 재현하도록 요청하지 않는다. 기록에 `simulation=true`를 남기고, 통제된 내려앉기만 수집했다면 그 범위까지 설명한다.

### 최초 수집량 제안

- 원리 확인: 한 사람이 각 정상 동작을 5회씩 수행해 신호·라벨 기록이 되는지 확인.
- 본 수집: 가능하면 3명, 사람당 서로 다른 날 또는 분리된 실행 세션 2회 이상.
- 세션마다 각 정상 동작 5~10회, 수행 가능한 모의 낙상 유형은 안전 조건에서 3~5회부터 시작.
- 빈 방·정지·자연스러운 일상 구간을 별도로 연속 기록.
- 침대 이탈·복귀는 별도 순서 실험으로 각 5회 이상 수집해 방향 구분 가능성을 확인.

이 수량은 작업량을 정하기 위한 시작안이다. 충분한 데이터 수나 성공률을 보장하지 않는다. 겹치는 윈도 1,000개를 만들었다고 독립 낙상 실험 1,000회를 확보한 것이 아니다.

동작 순서는 가능한 범위에서 섞는다. 모든 낙상만 특정 날짜·사람·장소에서 수집하면 모델이 낙상 대신 그 환경을 구분할 수 있다. 모든 세션에 여러 정상 동작과 모의 낙상 비교 구간을 포함시키는 것을 목표로 한다.

### 한 번의 동작 기록 절차

1. 장비가 고정됐는지 확인하고 세션과 시행 ID를 생성한다.
2. 정지 상태를 3~5초 기록한다.
3. 관찰자가 키보드 또는 라벨 도구로 동작 시작을 표시한다.
4. 실험자가 동작을 수행하고, 관찰자가 중요한 전환 시점과 종료를 표시한다.
5. 3~5초의 후속 구간을 기록한다.
6. 동작 수행 실패·다른 사람 진입·장치 흔들림·라벨 지연을 메모한다.

동작 전후 데이터는 학습 원본으로 보존하되 실시간 예측에 미래 구간을 미리 제공하지 않는다. 라벨 시각은 수집 프로그램과 같은 노트북의 단조 증가 시계 기준으로 기록한다. 사람이 눌러 표시한 시각에는 오차가 있으므로 경계가 불확실한 윈도는 제외하거나 별도 평가한다.

### 파일 구성

```text
data/raw/S001/
├── metadata.json
├── packets.jsonl
├── labels.jsonl
└── collection_notes.md
```

`metadata.json`에는 세션 ID, 익명 참여자 ID, 방·배치 ID, 장치 위치·높이·안테나 방향, 채널·대역폭, 목표 송신율, firmware/IDF 버전, parser 버전, 보정 절차를 넣는다.

`packets.jsonl`의 프로젝트 표준 필드:

| 필드 | 내용 |
|---|---|
| session_id / layout_id | 원본 세션·센서 배치 구분 |
| receiver_id / source_id | RX 장치와 TX1·TX2의 논리 ID |
| source_mac | 필터·디버깅용 송신 MAC, 공개 시 익명화 |
| source_seq / receiver_seq | 확인 가능한 송신·수신 순번, 없으면 null |
| device_timestamp_us | RX 시각, 단위·wrap 여부 명시 |
| host_monotonic_ns | 같은 PC에서 기록한 라벨·수신 시각 |
| recorded_at_utc | 보고서·로그 표시용 UTC 시각 |
| rssi / noise_floor | 수신 메타데이터 |
| channel / bandwidth / sig_mode | 신호 형식 확인 |
| csi_len / first_word_invalid | 파싱·유효성 검사 |
| csi_values / schema_version | 원본 수치와 해석 규칙 |

이것은 공식 펌웨어가 그대로 출력하는 형식이 아니다. 수집기가 공식 CSV 헤더를 읽어 변환한다. 리스트 내부 쉼표가 있으므로 CSV에 단순 `split(",")`를 사용하지 않고 CSV parser와 숫자 배열 parser를 사용한다. `eval`로 배열 문자열을 실행하지 않는다.

라벨 예시의 숫자는 가상 시각이다.

```json
{
  "session_id": "S001",
  "trial_id": "T014",
  "participant_id": "P01",
  "action": "FALL_SIM",
  "start_ms": 12000,
  "end_ms": 13600,
  "impact_ms": 13100,
  "simulation": true,
  "annotation_quality": "checked"
}
```

`impact_ms`는 실제 충격을 만들라는 지시가 아니다. 모의 동작에서 미리 정의한 빠른 자세 전환 시점을 관찰해 표시하는 필드다. 점 라벨을 정할 수 없는 느린 모의 동작은 별도 동작 구간 규칙으로 처리한다.

침대 상태 실험에는 `BED_EXIT`, `BED_RETURN`, `BED_ROLL`, `WALK_BY`와 초기 재실 확인 기록을 따로 남긴다. 낙상 이진 모델만으로 침대 복귀를 판단하지 않는다.

## 8. CSI 파싱·전처리·데이터 품질

### 복소 값 해석

ESP32-S3의 원시 CSI는 부반송파별 허수·실수 순서의 signed 값이다. 길이는 LTF·패킷 형식에 따라 달라지고 `first_word_invalid`가 참이면 처음 4 byte는 무효다. [공식 CSI 형식](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32s3/api-guides/wifi.html#wi-fi-channel-state-information)

```text
I_k = imaginary 값
R_k = real 값
A_k = sqrt(R_k^2 + I_k^2)
```

원시 byte를 다룰 때는 signed 해석을 맞춘다. 이미 firmware에서 gain 보정 후 숫자로 출력한 CSV는 int8로 다시 강제 변환하지 않는다. 곱셈 전에 float32 이상으로 변환해 정수 overflow를 피한다.

첫 무효 값과 DC·guard 등 제외할 항목은 **고정된 부반송파 인덱스 마스크**로 처리한다. 유효한 값만 매 행 앞쪽으로 당겨 서로 다른 인덱스를 같은 열에 넣지 않는다. 학습과 실시간 입력은 동일한 LTF·길이·인덱스 순서를 사용한다.

진폭으로 시작하고 절대 위상 분석은 다음 단계로 미룬다. gain 변화·출력 보정 여부를 기록하고, 보정 코드가 달라진 데이터를 무조건 합치지 않는다.

### 기본 전처리 순서

1. TX1·TX2를 분리하고 형식·길이가 맞는 패킷만 채택한다.
2. 수신 시각·순번을 검사해 역순·중복·장치 재부팅을 구분한다.
3. 장치 timestamp wrap을 처리하고 노트북의 단조 증가 시간축에 대응시킨다.
4. 고정된 CSI 부분을 골라 진폭을 계산한다.
5. 과거만 사용하는 보정·완만한 필터를 적용한다. 급격한 변화 특징에는 필터 전 진폭도 보존한다.
6. 각 링크를 같은 시간 그리드에 맞추고, 동일한 끝 시각의 윈도로 특징을 만든다.

RX 한 대라도 USB 버퍼링 때문에 PC 수신 시각과 무선 패킷 발생 시각이 다를 수 있다. UART 밀림을 측정하고 라벨 오차보다 커지면 수집을 수정한다.

### 최초 실험 파라미터

| 항목 | 초기값 제안 | 변경 근거 |
|---|---|---|
| TX 송신 목표 | TX별 50 packet/s | 링크별 실제 수신율과 직렬 처리량 |
| 특징 시간 그리드 | 링크별 50 Hz | 원본 수신이 충분한지 먼저 확인 |
| 분류 윈도 | 최근 2초 | 1·2·3초를 검증 세션에서 비교 |
| 추론 간격 | 0.25초 | CPU 처리량·알림 지연 |
| 보정 구간 | 시작 전 빈 방/정지 30~60초 | 절차를 고정하고 평가에도 동일 적용 |
| 짧은 누락 보충 | 최대 0.1초의 과거 값 유지부터 실험 | 마스크·누락 비율을 보존 |
| 품질 보류 예시 | 윈도 내 원본 수신 비율 80% 미만 또는 최대 gap 0.5초 초과 | 실제 동작 손실과 비교해 확정 |

품질 비율은 채운 그리드 개수가 아니라 **목표 송신 수 대비 정상 원본 패킷 수**를 기준으로 기록한다. 패킷 번호가 없는 경우 측정 가능한 지표와 한계를 별도 명시한다.

송신율 자체가 변경됐으면 기준도 갱신한다. 장치 재부팅·형식 불일치·채널 변경은 일반 누락으로 메우지 않는다. 긴 공백에 걸친 윈도는 폐기하고 `SENSOR_UNAVAILABLE`로 표시한다.

### 학습과 실시간 처리의 일치

최초 구현은 bounded 과거 값 유지 또는 실제 수신 특징으로 시작한다. 미래 패킷을 보고 보간했다면 그만큼 추론을 지연시켜야 하고, 같은 지연을 평가에도 반영한다.

`filtfilt` 같은 앞뒤 방향 필터나 centered 이동 평균을 오프라인에만 적용하지 않는다. 실시간에서 가능한 causal 필터를 학습 원본 재생에도 동일하게 적용한다. 시간 필터 상태는 실제 재시작 조건에서 reset하고 윈도마다 다른 방식으로 초기화하지 않는다.

보정·정규화 기준은 사전 보정 구간 또는 훈련 데이터에서만 구한다. 평가 구간 전체 평균이나 낙상 라벨을 보고 보정하지 않는다. 새 방의 사전 보정을 허용한 평가와 아무 보정 없는 방 이동 평가는 다른 조건으로 보고한다.


## 9. 특징 추출과 모델 입력 만들기

### 최초 특징 세트

각 링크의 진폭 배열을 `A[time, subcarrier]`로 놓고 2초 구간에서 아래 특징을 만든다. 처음에는 20~60개 정도의 요약 특징으로 시작하고, 실제 구현한 특징 이름·순서를 저장한다.

| 특징 후보 | 구체적 계산 | 목적 |
|---|---|---|
| 평균·표준편차 | 부반송파별 시간 평균·표준편차를 다시 평균·중앙값·상위 분위수로 요약 | 움직임의 크기 |
| 변화량 | 인접 시각의 절대 진폭 차이 평균·95분위수·최댓값 | 빠른 변화 |
| 진폭 범위 | 부반송파별 max-min 또는 95-5분위수 차이 | 순간 변화의 범위 |
| 구간별 변화 | 윈도 앞·중간·뒤 구간의 변화량 | 동작의 시간 순서 |
| 움직임 지속 | 보정 기준보다 큰 변화가 관측된 시간 비율 | 짧은 변화와 지속 움직임 |
| 링크 차이 | BED·DOOR 변화량 차이와 작은 epsilon을 둔 비율 | 영역별 반응 비교 |
| 선택 특징 | 동일 시간축의 링크 상관, 검증한 주파수대 에너지 | 기본 특징보다 개선되는지 확인 |

“최대 변화량”만으로 낙상을 판단하지 않는다. 낮은 진폭의 긴 누락·gain 변경도 급격한 변화처럼 보일 수 있다.

초기에는 주파수 특징·PCA 없이 시작해 데이터 문제를 보기 쉽게 한다. 주파수 특징을 추가하면 sampling rate, FFT 길이, 주파수대를 모델 설정에 저장한다. 도어 동작과 침대 동작의 차이를 단순 비율 하나로 확정하지 않는다.

### 윈도 라벨 규칙

- 모든 윈도는 끝 시각까지의 **최근 2초**로 만든다.
- 빠른 모의 낙상은 관찰자가 표시한 `impact_ms`가 윈도 안에 들어오면 `FALL_LIKE` 후보 라벨로 지정한다.
- 느린 모의 동작은 “주요 전환 구간과 얼마나 겹쳤는가”를 사전에 정해 따로 적용한다.
- 정상 동작·배경은 정상으로 표시한 구간 안에 온전히 들어오는 윈도를 `NON_FALL`로 만든다.
- 다른 시행의 동작이 섞였거나 라벨 경계 오차로 정답이 애매한 윈도는 학습에서 제외하고 제외 사유를 남긴다.
- 품질이 나쁜 윈도는 모델 훈련에 넣지 않는다. 전체 시스템 평가에서는 그 시점의 모의 낙상을 검출하지 못한 사례로 포함한다.

전환 시점을 정확히 맞춰 자른 동작 파일만 학습하면 실제 연속 스트림과 다를 수 있다. 동작이 윈도 안의 여러 위치에 나타나도록 슬라이딩 윈도를 만들고, 평가도 전체 스트림으로 한다.

### 학습 데이터 표

`data/processed/features.csv`의 열:

```text
session_id, trial_id, participant_id, layout_id,
detail_label, label, window_start_ms, window_end_ms, quality,
f_bed_std_mean, f_bed_diff_p95, f_door_std_mean, f_door_diff_p95, ...
```

모델 입력 X는 `f_`로 시작하는 **관측 특징 열만** 사용한다. 정답 라벨, 사람 ID, 방 ID, 파일명, 시행 번호, 절대 시각을 특징으로 넣지 않는다.

이진 정답 y는 `NON_FALL=0`, `FALL_LIKE=1`로 변환한다. 세부 라벨은 빠르게 앉기·눕기·허리 숙이기별 오탐률을 확인하기 위해 보존한다.

## 10. 데이터 분리와 모델 학습

### 학습·검증·최종 평가를 분리

| 구분 | 용도 | 사용하면 안 되는 작업 |
|---|---|---|
| train | 모델 fit, 훈련 내부 그룹 교차검증 | 최종 평가 결과를 보고 수정 |
| validation | 모델 후보·윈도·알림 임계값·이벤트 결합 규칙 선택 | 최종 성능으로 발표 |
| test | 설정을 고정한 후 마지막 성능 측정 | 결과를 보며 임계값 재조정 |

**원본 세션을 먼저 분리하고, 그 세션 안에서 윈도를 만든다.** 같은 동작에서 나온 인접·겹치는 윈도와 augmentation 결과는 모두 같은 split에 둔다.

권장 시작안은 세션 기준 약 60/20/20이다. 세션이 6개뿐이면 4/1/1처럼 나눌 수 있지만 검증·평가 다양성이 작다. 가능한 범위에서 서로 다른 실행 세션을 늘려 검증·평가에 각각 여러 세션을 확보한다.

같은 방·같은 사람의 새 세션 평가는 “본 배치에서 새 실행 세션에 대한 평가”다. 새로운 사람으로 일반화한다고 발표하려면 그 사람의 모든 세션을 test에 둔 평가가 필요하다.

**동아리방 또는 기숙사 중 한 장소만 선택해도 진행할 수 있다.** 필수 평가는 선택한 장소의 고정 배치에서 날짜·실행 세션을 분리하는 것이다. 두 장소를 모두 쓸 수 있을 때만 방 이동 후 성능과 재보정·재학습 필요성을 추가 평가한다. 한 장소 결과를 여러 방에 대한 검증으로 표현하지 않는다.

split은 `data/splits/session_split.csv`로 저장한다.

```csv
session_id,split
S001,train
S002,train
S003,train
S004,train
S005,validation
S006,test
```

위 표는 구조 예시다. 실제로는 참여자·세부 동작·모의 낙상 유무·시간대가 split별로 어떻게 분포하는지 확인해 배정한다. 자동 GroupShuffleSplit은 세션을 분리할 수 있지만 클래스 균형을 자동 보장하지 않는다. [그룹 분리 문서](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupShuffleSplit.html)

학습 데이터에서 선택한 정규화·PCA·feature selection은 훈련 데이터로만 fit한다. Logistic Regression이나 SVM과 scaler를 사용하면 Pipeline으로 묶는다. [데이터 누수 방지](https://scikit-learn.org/stable/common_pitfalls.html)

### 모델 후보와 선택 이유

| 후보 | 사용 목적 |
|---|---|
| 움직임 임계값 | 비교용 baseline. 이것만으로 낙상 구분 완료라고 하지 않음 |
| Logistic Regression + StandardScaler | 간단한 분류 기준과 Random Forest 비교 |
| Random Forest | 적은 특징 데이터로 시작하고 CPU에서 학습·추론 |
| SVM / 소형 CNN·LSTM | 데이터·일정이 충분하고 기본 모델의 실패 원인이 확인된 뒤 검토 |

첫 모델은 Random Forest로 시작한다. GPU 구매·딥러닝 학습은 초기 필수가 아니다. 모델보다 먼저 라벨, 수신 손실, 배치, 빠르게 앉기·눕기와의 실제 차이를 점검한다.

Random Forest 초기값 예시는 tree 250개, max_depth 10, min_samples_leaf 5, class_weight balanced다. 훈련 세션이 충분하면 훈련 내부 그룹 교차검증으로 tree 100/250, depth 6/10, leaf 3/8 정도의 작은 후보를 비교한다. 이것들은 추천 시작값이며 최적값이 아니다. [모델 API](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html)

### 학습 코드의 시작 예시

아래 코드는 전처리·특징 생성이 끝난 파일에서 **후보 모델과 검증 점수**를 만든다. CSI parser·특징 추출기·이벤트 평가기를 대신하지 않는다. `features.csv`와 split 파일이 있어야 실행할 수 있으며 현재 프로젝트에서 실행한 코드는 아니다.

```python
from pathlib import Path
import json
import platform

import joblib
import numpy as np
import pandas as pd
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import precision_score, recall_score, f1_score

features_path = Path("data/processed/features.csv")
split_path = Path("data/splits/session_split.csv")

df = pd.read_csv(features_path)
manifest = pd.read_csv(split_path)
assert not manifest["session_id"].duplicated().any()
assert set(manifest["split"]) == {"train", "validation", "test"}

df = df.merge(manifest, on="session_id", how="left", validate="many_to_one")
assert df["split"].notna().all()
assert set(df["label"]) <= {"NON_FALL", "FALL_LIKE"}
assert df.groupby("session_id")["split"].nunique().max() == 1

# 품질 보류 수는 별도 기록하고, 최종 이벤트 평가에서 누락하지 않는다.
invalid_count = int((df["quality"] != "valid").sum())
df = df.loc[df["quality"] == "valid"].copy()
df["target"] = df["label"].map({"NON_FALL": 0, "FALL_LIKE": 1})
feature_columns = sorted(c for c in df.columns if c.startswith("f_"))
assert feature_columns
assert np.isfinite(df[feature_columns].to_numpy(dtype=float)).all()

train = df.loc[df["split"] == "train"]
validation = df.loc[df["split"] == "validation"]
test = df.loc[df["split"] == "test"]

for subset in (train, validation, test):
    assert not subset.empty
    assert set(subset["target"]) == {0, 1}

model = RandomForestClassifier(
    n_estimators=250,
    max_depth=10,
    min_samples_leaf=5,
    class_weight="balanced",
    random_state=42,
    n_jobs=-1,
)
model.fit(train[feature_columns], train["target"])

fall_column = int(np.flatnonzero(model.classes_ == 1)[0])
scores = model.predict_proba(validation[feature_columns])[:, fall_column]
validation_output = validation[
    ["session_id", "trial_id", "detail_label", "window_end_ms", "target"]
].copy()
validation_output["fall_score"] = scores

output = Path("models/candidate")
output.mkdir(parents=True, exist_ok=True)
joblib.dump(model, output / "fall_model.joblib")
validation_output.to_csv(output / "validation_scores.csv", index=False)

rows = []
for threshold in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
    predicted = (scores >= threshold).astype(int)
    rows.append({
        "threshold": threshold,
        "precision": float(precision_score(
            validation["target"], predicted, zero_division=0)),
        "recall": float(recall_score(
            validation["target"], predicted, zero_division=0)),
        "f1": float(f1_score(
            validation["target"], predicted, zero_division=0)),
    })

(output / "threshold_table.json").write_text(
    json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8"
)
metadata = {
    "status": "candidate_requires_event_replay",
    "features": feature_columns,
    "label_mapping": {"NON_FALL": 0, "FALL_LIKE": 1},
    "train_sessions": sorted(train["session_id"].unique().tolist()),
    "validation_sessions": sorted(validation["session_id"].unique().tolist()),
    "test_sessions": sorted(test["session_id"].unique().tolist()),
    "excluded_quality_windows": invalid_count,
    "python_version": platform.python_version(),
    "sklearn_version": sklearn.__version__,
    "numpy_version": np.__version__,
}
(output / "model_meta.json").write_text(
    json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("Candidate saved. Select event rules on validation replay before test.")
```

이 예시는 아직 최종 test의 예측을 수행하지 않는다. 검증용 연속 기록을 재생해 임계값과 이벤트 결합을 정한 뒤, 설정을 고정하고 test를 평가한다.

### 알림 임계값과 모델 저장

`predict_proba` 값은 모델의 출력 점수로 사용한다. 0.9이므로 “실제 사고 확률 90%”라고 표시하지 않는다. 필요하면 독립된 검증 절차로 확률 보정을 수행한다.

0.3~0.9 등의 임계값 후보를 검증용 연속 기록에서 비교하고 **이벤트 재현율·시간당 오알림·지연**으로 선택한다. 윈도 accuracy가 가장 큰 값만 고르지 않는다. 모델 훈련과 동일한 데이터로 임계값을 정하지 않는다. [임계값 선택 공식 설명](https://scikit-learn.org/stable/modules/classification_threshold.html)

모델과 함께 저장할 항목:

- 특징명·순서, 라벨 대응, window/hop, LTF·부반송파 마스크.
- 전처리·보정 설정, 품질 조건, 임계값·이벤트 결합 규칙.
- firmware/schema/layout 버전, Python·라이브러리 고정 버전.
- split 목록, 데이터 버전, 학습 코드 커밋, 검증 보고서.

`joblib`은 팀이 생성한 신뢰할 수 있는 모델만 읽는다. 다른 라이브러리 버전의 호환을 전제로 하지 않고 학습·추론 환경을 맞춘다. [모델 저장 공식 문서](https://scikit-learn.org/stable/model_persistence.html)

### 공개 데이터와 성능 개선 순서

공개 CSI 데이터는 처리 코드 학습과 모델 비교에 참고할 수 있다. Intel NIC·다른 ESP32·다른 링크 수·주파수·sampling rate의 데이터를 열 수만 맞춰 자체 데이터와 합치지 않는다. 센서·환경 차이가 모델에 영향을 준다.

외부 데이터에서 좋은 결과가 나와도 본 배치에서 독립 평가한다. 공개 데이터·모델의 라이선스와 출처도 기록한다.

성능이 낮으면 다음 순서로 확인한다.

1. 라벨 시각과 CSI 시각이 맞는지 확인.
2. 링크별 손실·gain 변화·형식 불일치 확인.
3. 빠르게 앉기·눕기 등 실제 혼동 동작의 데이터를 추가.
4. 배치와 특징·윈도를 수정하고 모델 버전을 갱신.
5. 검증 조건에서 비교하고, 최종 설정만 새로운 test에 평가.

test를 본 뒤 수정했다면 그 test는 개발 자료가 된 것이다. 수정 모델의 최종 평가에는 새로 확보한 독립 세션이 필요하다.

## 11. 성능 평가와 합격 판단

### 두 종류의 평가

**윈도 평가**는 모델 비교용이다. 혼동행렬, 낙상 클래스 precision·recall·F1, 세부 정상 동작별 오탐을 기록한다. 배경 윈도가 많으면 accuracy가 높아도 낙상을 놓칠 수 있다.

**이벤트 평가**는 전체 시스템 평가다. parser·품질 검사·추론·FSM·중복 제거·전송을 모두 켜고 원본 연속 스트림을 재생한다.

이벤트 매칭은 설정을 고정하기 전에 정한다. 예를 들어 표시한 주요 전환 시점부터 3초 이내 생성된 첫 위험 이벤트를 해당 모의 낙상의 검출로 보고, 한 실제 시행과 한 예측 이벤트만 1:1 대응시킨다. 3초는 초기 평가안이며 필요한 지연과 함께 검증한다.

점 라벨이 없는 느린 모의 동작은 주요 전환 구간을 정의해 별도 매칭한다. 동작 라벨 오차도 기록한다. 정답이 끝난 뒤 충분히 늦은 예측을 “언젠가 감지했으므로 성공”으로 세지 않는다.

| 지표 | 계산·기록 방법 |
|---|---|
| 이벤트 재현율 | 매칭된 모의 낙상 수 / 전체 모의 낙상 수 |
| 이벤트 정밀도 | 매칭된 예측 이벤트 수 / 전체 예측 위험 이벤트 수 |
| 시간당 오알림 | 정상 연속 구간의 오알림 수 / 정상 관측 시간 |
| 감지 지연 | 주요 전환 시점 → 로컬 이벤트 생성 |
| 전달 지연 | 로컬 생성 → 서버 저장 → 실제 휴대폰 알림 표시 |
| 중복 | 같은 시행의 반복 Push·중복 이벤트 개수 |
| 이용 가능성 | 유효 센싱 시간 / 전체 평가 시간 |

품질 부족 시점의 모의 낙상을 성능 표에서 빼고 유효 구간만의 높은 재현율을 발표하지 않는다. “전체 시행 기준 결과”와 “유효 센싱 구간에서의 분류 결과”를 구분한다. 중복 예측은 별도로 보고하고 필요하면 매칭되지 않은 예측으로도 센다.

배경 구간, 사람이 가만히 있음, 문을 열고 닫음, 빠르게 앉기, 정상 눕기, 장비 근처 움직임을 포함한 정상 연속 기록이 필요하다. 가능한 범위에서 1~2시간 이상의 배경·일상 기록부터 시작하고 관측 시간을 늘린다. 짧은 시연에서 오알림 0회는 장시간 오알림 0을 입증하지 않는다.

### 평가 조건의 구분

| 조건 | 기본/추가 | 설명 |
|---|---|---|
| 선택한 한 장소의 새 세션 | 기본 | 같은 배치, 세션·날짜 분리 |
| 새로운 참여자 | 가능하면 추가 | 해당 사람 데이터가 학습·검증에 들어가지 않음 |
| 센서 위치·가구 변화 | 추가 | 기존 모델의 취약점 확인 |
| 다른 방으로 이동 | 두 장소를 쓸 수 있을 때 추가 | 재보정만 했는지 재학습했는지 구분 |
| CSI 또는 인터넷 중단 | 기본 통합 검증 | 최신 상태·알림 복구·재전송 확인 |

동아리방과 기숙사를 모두 사용하는 것이 필수 통과 조건은 아니다. 한 장소만 사용할 때는 그 장소의 실제 평가 범위와 한계를 발표한다.

### 결과 표와 개발 목표

다음 항목을 채운 `reports/final_evaluation.md`를 제출물에 포함한다.

```text
방/배치:
참여자·세션·동작 시행 수:
원본 수신율·품질 보류 비율:
모의 낙상 검출: __ / __
빠르게 앉기·정상 눕기·허리 숙이기별 오탐:
정상 연속 관측 시간: __ 시간
오알림: __ 회, __ 회/시간
감지·휴대폰 알림 지연: 중앙값 / 상위 95분위 / 최대
품질 부족 때문에 놓친 시행:
침대 이탈·복귀 검출과 미복귀 알림 결과:
```

내부 목표의 예로 모의 낙상 이벤트 재현율 90%, 정밀도 80%, 정상 구간 오알림 2회/시간 이하를 검증 시작 전에 정할 수 있다. **이 수치는 달성 결과·의료적 허용 기준이 아니며, 작은 표본에서 높게 나와도 실제 사용 적합성을 뜻하지 않는다.** 감지·전송 지연 목표도 따로 정한다.

결과에는 분모를 함께 쓴다. 3/3과 30/30은 같은 근거가 아니다. 목표를 못 맞추면 달성한 범위·실패 동작·추가 데이터 계획을 보고하고 낙상 구분의 미완료 여부를 명시한다.

침대 이탈·복귀는 정답 시각 대비 검출·오탐·지연을 각각 평가한다. “낙상 모델 점수”와 “미복귀 알림 시나리오 성공”을 하나의 정확도로 합치지 않는다.

## 12. 실시간 추론과 이벤트 생성

### 프로그램의 지속 실행 구조

```text
수집 작업: USB 읽기 → 유효 패킷 → 링크별 ring buffer
추론 작업: 0.25초마다 품질 검사 → 최근 2초 특징 → 모델 점수
상태 작업: 침대 추정·미복귀 타이머, 낙상 episode 관리
전송 작업: 로컬 저장 큐 → 서버 요청·재시도
```

모델은 시작 시 한 번 읽고 반복해서 사용한다. 매 윈도마다 학습하거나 디스크에서 다시 읽지 않는다. HTTP 요청의 timeout 때문에 USB 읽기가 멈추지 않도록 전송 작업을 분리한다.

처리 시간이 추론 간격보다 길면 오래된 윈도를 무제한 쌓지 않고 최신 시각을 기준으로 따라잡는다. 원본은 계속 기록하고, 건너뛴 추론 구간과 지연을 로그에 남긴다.

### 낙상 추론 정책

MVP는 **품질이 유효한 모든 윈도에 분류기를 실행**한다. 큰 움직임 임계값을 통과한 구간에만 실행하면 작거나 느린 낙상을 후보 단계에서 놓칠 수 있기 때문이다.

CPU 부족으로 후보 gate를 추가한다면 gate가 놓친 모의 낙상도 포함해 전체 재현율을 다시 측정한다. 후보·분류·알림의 각각의 지연도 기록한다.

같은 모의 동작에 걸친 겹치는 윈도는 하나의 `episode_id`와 이벤트로 묶는다. 높은 점수가 처음 기준을 넘을 때 생성하고, 점수가 낮은 기준 아래로 일정 기간 떨어지면 새로운 episode를 받을 수 있게 한다. 높은/낮은 임계값과 기간은 validation replay로 정한다.

이 **모델 episode 종료**는 사람의 움직임이 멎었다는 조건과 다르다. 낙상 의심 생성에 후속 정지를 요구하지 않는다. 긴 전역 cooldown으로 다른 낙상 이벤트를 막지 않고, 짧은 간격의 두 동작도 평가에 넣어 병합 오류를 확인한다.

센싱 중단이나 다른 layout으로 바뀌면 예측을 보류하고 버퍼를 다시 채운다. 기존 위험 기록은 유지한다. 재시작 중 관측하지 못한 동작을 복원할 수 있다고 가정하지 않는다.


## 13. 침대 상태·낙상·알림 상태 머신

### 침대 상태는 별도 판단

낙상 이진 모델에는 침대 재실·이탈·복귀 라벨이 없다. 침대 상태에는 별도 규칙 또는 별도 작은 분류기가 필요하다.

처음에는 BED·DOOR 링크 변화의 순서와 지속시간을 비교한다. 뒤척임·침대 옆 통과와 이탈·복귀가 분리되는지 확인하고, 규칙이 부족하면 `BED_EXIT / BED_RETURN / OTHER` 분류기를 같은 세션 분리 원칙으로 학습한다.

문까지 이동하지 않아도 침대에서 내려올 수 있으므로 **문 링크 움직임을 이탈의 필수 조건으로 두지 않는다.** 문 링크는 검증된 경우 보조 근거로 사용한다.

```text
UNKNOWN
  └─ 실험자가 초기 침대 재실 확인 또는 검증한 초기화
       → IN_BED_ESTIMATED

IN_BED_ESTIMATED
  └─ 검증한 BED_EXIT 패턴 → OUT_OF_BED_ESTIMATED
                                ├─ 검증한 BED_RETURN → IN_BED_ESTIMATED
                                └─ 설정 시간 초과 → NON_RETURN_WARNING

어떤 상태에서든 센싱·판단 근거 손실 → UNKNOWN
```

| 전환·조건 | 처리 |
|---|---|
| 초기 재실 확인 | 확인 방법·시각을 기록. 수동 초기화라면 화면·시연에 표시 |
| 침대 뒤척임 / 침대 옆 통과 | 재실·이탈을 자동 확정하지 않음 |
| 이탈 추정 | 단조 증가 시계로 미복귀 타이머 시작 |
| 복귀 추정 | 타이머 종료·복귀 기록. 기존 알림은 삭제하지 않음 |
| 미복귀 시간 초과 | 해당 이탈 episode당 위험 이벤트 한 개 생성 |
| 보호자 알림 확인 | 확인 시각만 저장. 타이머·침대 상태는 바꾸지 않음 |
| 센싱 손실 / 재부팅 | 상태 UNKNOWN, 관측하지 못한 시간 표시, 새 판단 보류 |
| 복구 | 유효 버퍼를 다시 채우고 상태를 재확인한 뒤 감지 재개 |

센싱 중단 구간을 “계속 복귀하지 않았다”는 증거로 사용하지 않는다. 중단 이전 타이머·이탈 시각은 이력으로 보존하되, 현재 상태를 다시 확인하기 전에는 연속 미복귀로 확정하지 않는다.

원격 설정을 바꾸면 Python이 다음 설정 동기화에서 적용하고 `appliedSettingsVersion`을 보고한다. 서버 DB만 바뀌고 로컬 타이머는 옛 설정을 사용하는 일을 막는다.

침대 이탈 후 미복귀 알림은 현재 웹에서 켜기·끄기, 상시·매일 지정 시간(한국 시간), 미복귀 기준을 함께 저장할 수 있다. 기존 배치는 기본 상시를 유지한다. 22:00~07:00처럼 시작 시간이 종료 시간보다 늦으면 다음 날까지 적용한다. 시간대 밖과 알림 끄기에서는 미복귀 사건을 새로 만들지 않으며 낙상·장애 관측은 지속한다. `python/detection_policy.py`의 시간대 판단을 실제 상태 머신에 연결해야 한다. 비활성 구간을 연속 미복귀 경과 시간으로 세지 않고, 시간대가 다시 활성화되면 새 관측으로 시작한다. 침대 이탈 즉시 알림은 현재 이벤트 종류에 포함하지 않는다.

### 낙상 감지와 보호자 확인은 독립

웹 설정에는 낙상 의심(`fallAlertEnabled`), 센싱 연결 장애(`sensorFaultAlertEnabled`), 기기 통신 장애(`gatewayFaultAlertEnabled`) 감지의 개별 켜기·끄기를 추가했다. 기존 API 필드명은 호환성을 위해 유지하며 기본값은 모두 true다. 미복귀 감지 시간대와 별도로 판단한다. 옵션을 꺼도 원시 측정·heartbeat·기존 사건 기록은 유지한다. 새 episode와 outbox 기록을 만들기 전에 detection_enabled를 확인한다. 새 사건 전송에는 send_detection_event, 이미 기록한 사건의 재전송에는 send_event를 사용한다. 설정 저장·게이트웨이 전달·Python 판단 및 새 전송 제어는 구현했으며 실제 CSI 추론 루프와 서버의 자동 장애 사건 생성 worker 연결, 원격 Push는 후속 개발이다.

```text
MONITORING
  ├─ 품질 부족 → SENSOR_UNAVAILABLE
  └─ 유효한 모델 점수가 검증 기준 충족
         → FALL_SUSPECTED 이벤트 생성
         → 서버 저장·알림 전송

이벤트 처리 상태:
OPEN → ACKNOWLEDGED → RESOLVED
          └─ 확인 기록, 사고 해소 의미 없음
```

낙상 분류는 어떤 침대 상태에서도 실행한다. 미복귀 10분을 기다리지 않으며, 후속 저활동이나 움직임 정지를 알림 필수 조건으로 두지 않는다.

새 낙상 episode는 이전 알림의 확인 여부와 관계없이 기록한다. “이미 미복귀 알림이 열려 있으니 낙상 알림은 무시”하는 전역 조건을 만들지 않는다.

`RESOLVED`는 보호자가 상태를 확인하고 해소 사유를 별도로 기록했을 때 사용한다. 정상 동작으로 판단한 오알림도 삭제하지 않고 사유와 함께 보존한다. 모델 개선용으로 사용할 때는 별도 라벨 검토를 거친다.

## 14. 서버 API 계약과 재전송

### 기본 API

현재 구현은 Node.js Express + PostgreSQL이다. HTTP 요청·응답의 필드명은 camelCase로 통일한다. 실제 구현 계약과 필드별 제약은 [API 계약](./API.md)을 기준으로 한다. PostgreSQL 열 이름과 CSI 수집 파일의 필드명은 별도 규칙이며 HTTP 필드명과 구분한다. Push 관련 API는 다음 단계의 설계이며 아직 구현되지 않았다.

| API | 호출자 | 기능 |
|---|---|---|
| POST /api/ingest/events | Python 게이트웨이 | 감지 이벤트 수신·멱등 저장 |
| POST /api/ingest/status | Python 게이트웨이 | 최신 센싱·침대 추정 상태와 heartbeat |
| GET /api/gateway/settings | Python 게이트웨이 | 적용할 감지 설정·버전 조회 |
| GET /api/status | 보호자 | 최신 상태·데이터 나이·연결 상태 조회 |
| GET /api/events?cursor=... | 보호자 | 이벤트 목록 조회 |
| GET /api/events/:id | 보호자 | 사건 상세·처리 기록 |
| POST /api/events/:id/ack | 보호자 | 알림 확인 |
| POST /api/events/:id/resolve | 보호자 | 상태 확인 후 해소 사유 기록 |
| GET /api/settings | 보호자 | 설정 조회 |
| PATCH /api/settings | 보호자 | 설정 변경 |
| POST /api/push/subscriptions | 보호자 | 브라우저 구독 등록 |
| DELETE /api/push/subscriptions/:id | 보호자 | 자신의 구독 해제 |
| POST /api/push/test | 보호자 | 자신의 기기로 시험 알림 |

장치 수집 API에는 게이트웨이 전용 토큰을 사용한다. 보호자용 로그인 세션과 장치 토큰은 구분한다. 브라우저에 장치 토큰이나 VAPID 개인키를 보내지 않는다.

### 위험 이벤트 예시

날짜·ID·점수는 요청 형식을 설명하기 위한 예시이며 실제 감지 결과가 아니다.

```json
{
  "eventId": "example-event-001",
  "gatewayId": "G01",
  "type": "FALL_SUSPECTED",
  "occurredAt": "2026-10-05T06:20:00.000Z",
  "detectedAt": "2026-10-05T06:20:01.000Z",
  "score": 0.84,
  "qualityStatus": "AVAILABLE",
  "modelVersion": "fall-rf-v1",
  "isDemo": true,
  "details": {
    "schemaVersion": 1,
    "episodeId": "example-episode-001",
    "layoutId": "ROOM_A_LAYOUT_01",
    "calibrationVersion": "cal-v1",
    "settingsVersion": 3,
    "bedPacketRatio": 0.96,
    "doorPacketRatio": 0.94
  }
}
```

각 실제 이벤트는 Python에서 UUID 등 충돌하지 않는 ID를 한 번 생성한다. 실패한 HTTP 요청을 다시 보낼 때 같은 `eventId`와 원래 요청 내용을 그대로 사용한다. 점수와 품질 수치는 서버가 허용하는 범위로 검사한다.

| 응답 | 의미·재시도 |
|---|---|
| 201 Created | 이벤트와 생성 이력이 DB에 저장됨. Push 전송 작업은 구현 예정 |
| 200 OK + duplicate=true | 같은 ID·같은 이벤트가 이미 저장됨 |
| 409 Conflict | 같은 ID에 다른 내용이 들어옴. 자동으로 덮어쓰지 않음 |
| 400 / 422 | 형식·필드 오류. 내용을 수정하기 전까지 무한 재시도하지 않음 |
| 401 / 403 | 토큰·권한 오류. 운영 로그와 상태 화면에 표시 |
| 429 / 5xx / timeout | backoff로 재시도. 같은 ID 유지 |

201은 “휴대폰에서 알림을 봤다”는 의미가 아니다. 이벤트 저장과 알림 전송을 구분한다.

### 로컬·서버 전송 큐

1. Python은 이벤트를 로컬 SQLite outbox에 먼저 저장한다.
2. 별도 전송 작업이 timeout을 둔 HTTPS 요청을 보낸다.
3. 현재 서버는 이벤트와 생성 이력을 한 transaction에서 저장한다. Push 구현 시 서버 전송 작업도 같은 transaction에 포함한다.
4. 성공 응답을 받은 로컬 항목은 전송 완료로 표시한다.
5. 응답이 유실되면 같은 ID로 재전송하고 서버의 중복 응답을 처리한다.
6. Push 구현 시 서버 작업자가 DB에서 미완료 Push를 읽고 재시도한다. 현재 단계에는 Push worker가 없다.

초기 backoff는 1·2·4·8초 증가 후 30초 상한과 약간의 무작위 지연을 제안한다. 네트워크 복구 후 오래된 이벤트에는 발생 시각과 지연 전달 표시를 유지한다.

인터넷 단절 시에도 로컬 분석·이벤트 기록은 계속될 수 있지만 **원격 휴대폰 알림은 인터넷 없이 전달되지 않는다.** 로컬 화면·부저는 일정에 여유가 있을 때 추가할 수 있다.

### 최신 상태·heartbeat

최신 상태는 5초 간격 전송부터 시작한다. 서버는 마지막 수신 이후 15초 초과 등을 `GATEWAY_OFFLINE` 기준으로 검증한다. 이는 실험용 시작값이다.

현재 상태 요청에는 `gatewayId`, `generation`, `sequence`, `measuredAt`, `sensorAvailable`, `qualityStatus`, `bedState`, 선택적인 `isDemo`, `bedExitedAt`, `appliedSettingsVersion`을 넣는다. generation은 로컬 DB에 저장해 프로그램 재시작마다 증가시키고 sequence는 그 실행에서 증가시킨다. 서버는 이탈 시각·적용 버전을 수신하고 웹은 실제 기기의 연결과 적용 버전을 비교해 적용 상태를 표시한다. isDemo=true 시험 신호는 현재 관측 조회에서 제외하며, 실제 신호가 없으면 연결 대기이고 측정 시각·침대 추정·적용 버전을 인정하지 않는다. 기본 샘플 명령은 사건 기록만 생성한다. 실제 CSI 타이머가 설정을 적용하고 버전을 보고하는 Python 코드는 후속 개발이다. 상세 계약은 [API.md](./API.md)를 따른다.

서버는 이전 generation 또는 이전 seq의 상태 요청으로 최신 상태를 덮어쓰지 않는다. 상태·heartbeat는 오래된 요청을 outbox에 쌓지 않고 **최신 한 개만** 전송한다. 과거 이벤트 재전송이 연결 상태를 정상으로 갱신하지 않게 한다.

서버의 현재 판단은 두 축으로 표시한다.

- `GATEWAY_OFFLINE`: 분석 프로그램과 서버의 통신이 끊김.
- `SENSOR_UNAVAILABLE`: 프로그램은 응답하지만 CSI 품질·수집에 문제가 있음.

보호자 화면에는 서버 수신 시각과 측정 시각을 함께 표시한다. 오래된 “침대 재실 추정”을 현재 안전 상태처럼 보여주지 않는다. 시간 비교를 위해 PC·서버 시계를 동기화하고, 같은 프로세스 내부 지연은 단조 증가 시계로 측정한다.

## 15. 데이터베이스와 기본 보안

### 서버 테이블

현재 생성되는 테이블은 `gateways`, `events`, `event_actions`, `settings` 네 개다. 아래 표의 이력·Push·계정별 설정은 후속 확장 설계다. 원시 CSI와 학습 파일은 별도로 보관한다.

| 테이블 | 주요 열·제약 |
|---|---|
| gateways | gateway_id, 인증 정보, 마지막 generation/seq/heartbeat |
| status_snapshots | gateway_id, sampled_at, received_at, bed_state, quality, settings_version |
| events | event_id UNIQUE, gateway_id, episode_id, type, 발생·감지·수신 시각, 모델·배치 버전 |
| event_actions | event_id, guardian_id, ACK/RESOLVE, 시각, 사유 |
| push_subscriptions | guardian_id, endpoint UNIQUE, p256dh, auth, 활성 여부 |
| push_jobs | event_id, subscription_id, 전송 차수, 상태·attempts·next_attempt_at |
| settings | gateway_id, version, 미복귀·재알림·운영 시간 |

같은 이벤트·구독·전송 차수의 Push 작업은 unique 제약으로 중복 삽입을 막는다. 작업자가 여러 개면 transaction으로 전송 작업을 선점하고, 재시작 후 오래된 선점 작업을 복구한다. 최초 알림은 차수 0, 의도한 재알림은 차수를 증가시킨다. 미복귀와 낙상은 별도 이벤트로 저장한다.

Python의 `local_outbox.sqlite`와 서버 PostgreSQL은 역할이 다르다. 센서 옆 게이트웨이는 네트워크가 끊겨도 로컬 SQLite outbox에 이벤트를 보관한 뒤 API로 재전송한다. 원시 CSI는 JSONL/배열 파일로 관리하고 서버 이벤트 DB에 매 패킷 저장하지 않는다.

현재 서버 DB는 프로젝트에 연결할 PostgreSQL을 사용한다. Python 게이트웨이의 로컬 outbox에는 SQLite를 사용할 수 있다. DB 사용자에게 해당 데이터베이스와 schema의 테이블 생성 권한을 부여하고, 운영 전에는 백업·복구를 확인한다. 분석 프로그램은 계속 센서 옆에서 실행한다. [SQLite 공식 사용 가이드](https://www.sqlite.org/whentouse.html)

### 인증·권한

- MVP는 보호자 계정 한 개로 시작할 수 있지만 외부 공개 서버에 개인 이벤트를 익명 공개하지 않는다.
- 검증된 인증·세션 도구를 사용하고 비밀번호를 평문 저장하지 않는다.
- 보호자는 자신에게 연결된 게이트웨이·이벤트·Push 구독만 읽고 수정한다.
- 쿠키 세션이면 Secure·HttpOnly·SameSite와 CSRF 방어를 구성한다.
- `express-session`의 기본 `MemoryStore`는 운영용으로 설계되지 않았으므로 배포할 때 영구 세션 저장소를 선택한다. [express-session 공식 문서](https://github.com/expressjs/session)
- 요청 body 크기·형식, 설정의 범위, 시험 Push의 요청 빈도를 제한한다.
- Push endpoint는 임의 외부 URL로 요청하는 기능이 되지 않도록 공급자·HTTPS 주소 정책을 검사한다.

### 개인정보·파일 관리

프로젝트가 영상·음성을 수집하지 않아도 CSI는 사람 행동을 추론하는 데이터다. “개인정보가 전혀 없다”는 문구를 사용하지 않는다.

원본 CSI·장치 MAC·참여자 대응표·실제 Push 구독·토큰은 공개 GitHub에 올리지 않는다. 익명화된 작은 예제와 파일 형식 설명만 공유한다. 참여자가 동의한 수집 범위·보관 기간을 정하고 해당 기간에 맞춰 제거한다.

`.env`, VAPID 개인키, 실제 DB 파일은 Git에서 제외한다. 모델·데이터 파일의 공유 권한과 외부 코드·데이터 라이선스를 기록한다.

## 16. 모바일 웹 알림 구현

### Web Push와 PWA 설치의 관계

Android의 검증 대상 브라우저에서 Service Worker·Push API를 사용한다. **홈 화면 설치와 백그라운드 Push는 별도 기능**이므로, 설치 버튼만 만들었다고 화면 잠금 중 알림까지 검증된 것은 아니다.

MVP는 Android Chrome 한 기기를 먼저 정해 검증한다. OS·브라우저 버전과 알림·절전 설정을 기록한다. iOS는 이번 검증 범위에서 제외하며, 추후 지원하면 홈 화면 웹 앱과 권한 조건 등을 별도로 확인한다.

Push API는 웹 화면이 열려 있지 않을 때의 수신을 지원하지만 HTTPS·Service Worker·구독·권한이 필요하다. 강제 종료·네트워크·OS 정책을 포함한 실제 수신은 기기에서 확인해야 한다. [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)

### 구현 순서

1. HTTPS 주소에서 `/sw.js`를 등록하고 적용 scope를 확인한다.
2. 보호자가 `알림 켜기` 버튼을 눌렀을 때 권한을 요청한다.
3. `pushManager.subscribe`에 VAPID 공개키와 `userVisibleOnly: true`를 사용한다.
4. 구독의 endpoint·키를 로그인한 보호자의 서버 계정에 저장한다.
5. 서버에서 Node `web-push` 라이브러리로 시험 메시지를 보낸다.
6. Service Worker의 `push` handler에서 `showNotification`을 호출한다.
7. 알림 클릭 시 해당 사건의 웹 상세 화면을 연다.
8. 상세 화면의 확인 버튼을 눌렀을 때만 ack API를 호출한다.

Node 라이브러리는 VAPID 설정과 구독으로 메시지를 전송한다. 개인키는 서버에 보관한다. [web-push 공식 저장소](https://github.com/web-push-libs/web-push)

### Service Worker의 시작 예시

이 코드는 구조 예시다. 아이콘·예외 처리·페이지와의 메시지 연동은 구현 시 보완한다.

```javascript
self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = {};
    }

    const eventId = typeof data.eventId === "string" ? data.eventId : "";
    const detailPath = eventId
        ? "/?eventId=" + encodeURIComponent(eventId) + "#detail"
        : "/";

    event.waitUntil(self.registration.showNotification(
        data.title || "안전 확인 알림",
        {
            body: data.body || "보호자 화면에서 상태를 확인해 주세요.",
            tag: eventId ? "event-" + eventId : "system-status",
            data: { path: detailPath },
        }
    ));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const candidate = event.notification.data?.path || "/";
    const target = new URL(candidate, self.location.origin);
    const safeUrl = target.origin === self.location.origin
        ? target.href
        : self.location.origin + "/";
    event.waitUntil(self.clients.openWindow(safeUrl));
});
```

이벤트별 notification tag를 사용해 재시도 알림의 표시 중복을 줄인다. 하나의 전역 tag로 모든 사건을 덮어써 새 낙상 알림이 미복귀 알림에 가려지지 않게 한다.

### 전송·수신 상태의 구분

서버 Push 요청 성공은 Push 서비스의 접수 결과다. **휴대폰 표시·사람의 확인을 보장하는 전달 영수증이 아니다.**

- 서버: 전송 시도·서비스 접수 성공·실패를 기록.
- Service Worker: 가능한 경우 표시 요청 시각을 서버에 보고하되 실패해도 알림 표시를 막지 않음.
- 보호자: 상세 화면의 확인 조작으로 실제 확인 기록.
- 평가 담당자: 휴대폰 화면에 표시되는 시각을 별도로 기록.

Push 서비스의 404/410은 만료 구독으로 처리하고 재구독을 안내한다. 429·일시적 서버 오류는 backoff로 재시도한다. TTL은 예를 들어 300초부터 검증하며, 만료된 알림은 서버 사건 기록에서 계속 조회 가능하게 한다.

전송 timeout 직전에 서비스가 접수했을 수 있어 완벽한 1회 전달을 보장하기 어렵다. 서버 멱등 처리와 이벤트 tag로 중복을 줄이고, 남은 중복은 측정한다.

PWA는 `manifest.webmanifest`, name·start_url·display·icons를 추가한다. 민감한 사건 API 응답을 무조건 오프라인 캐시에 넣지 않는다. 오프라인 화면은 최신 데이터가 아니라는 표시와 마지막 갱신 시각을 제공한다.

## 17. 보호자 화면과 배포

### 화면의 기본 구성

| 화면 | 표시·조작 |
|---|---|
| 홈 | 센싱·통신 상태, 데이터 갱신 시각, 침대 상태 추정, 열린 위험 사건 |
| 사건 목록 | 낙상 의심·미복귀·장애를 구분한 시간순 기록 |
| 사건 상세 | 발생·감지·수신 시각, 확인·해소 기록, 지연 전달 표시 |
| 설정 | 미복귀 기준, 알림 허용, 선택적 운영 시간, 로컬 적용 버전 |
| 알림 설정 | 권한·구독 상태, 시험 알림, 재구독·해제 |

홈 화면은 “정상”이라는 단일 표시보다 `센싱 연결됨 / 상태 추정 / 상태 확인 불가`를 구분한다. 마지막 움직임 시각이 안전 여부를 대신하지 않는다.

미복귀 기준 10분은 예시 설정이다. 의료 기준처럼 고정하지 않고 보호자가 설정하게 한다. 재알림 기능은 최초 알림·기록이 동작한 다음 추가한다.

알림 문구:

> 낙상이 의심되는 움직임 패턴이 감지되었습니다. 상태를 확인해 주세요.

> 침대 이탈이 추정된 후 설정 시간 동안 복귀가 확인되지 않았습니다.

> 센싱 연결에 문제가 있어 현재 상태를 확인할 수 없습니다.

### 배포 최소 구조

- 센서 옆 Windows PC: Python 분석 프로그램을 지속 실행.
- HTTPS 서버: Express API·정적 웹·DB·Push worker.
- Android 스마트폰: 웹 로그인·알림 권한·구독.

프론트와 API를 같은 origin에서 제공하면 CORS·쿠키·Service Worker scope 구성이 단순해진다. 처음에는 Express의 정적 파일 제공 기능으로 같이 배포해도 된다.

HTTP localhost의 개발 환경에서 PC로 동작한 Service Worker가 스마트폰의 `http://192.168.x.x` 주소에서도 동작한다고 가정하지 않는다. 실기기 Push 검증에는 신뢰할 수 있는 HTTPS를 구성한다.

호스팅의 절전·재시작·영구 디스크 여부를 확인한다. 서버가 잠드는 환경은 즉시 알림 지연에 영향을 줄 수 있다. 정적 웹만 배포한 서버리스 환경에 상시 Python USB 수집기를 넣지 않는다.

원격 서버를 쓰더라도 로컬 감지와 outbox가 남아야 한다. DB·VAPID 키를 배포마다 새로 생성하지 않고 보존한다.

## 18. 저장소 구조와 실행 준비

아래 경로·명령은 **목표 구조와 구현할 파일의 역할을 제안**한다. 실제 현재 실행법은 [README](../README.md), 구현된 서버 계약은 [API.md](./API.md), 화면·샘플과 남은 개발 검토는 [UI_REVIEW.md](./UI_REVIEW.md)를 따른다. 모바일 웹·Express/PostgreSQL·Python 환경/API 클라이언트·샘플은 준비됐지만 아래 CSI 수집·학습·추론 명령은 구현 후 사용할 예시다.

```text
git-practice/
├── firmware/
│   ├── tx/                   # TX별 ID·MAC 설정
│   └── rx/                   # 다중 MAC 필터·CSI 출력
├── analysis/
│   ├── collect.py            # USB 수집·라벨 마커
│   ├── parser.py             # CSV → 표준 패킷
│   ├── preprocessing.py      # 보정·유효 인덱스·시간 처리
│   ├── features.py           # 학습·추론 공통 특징 함수
│   ├── build_dataset.py      # split manifest를 따라 특징 생성
│   ├── train.py              # 후보 모델 학습
│   ├── replay.py             # 원본 재생·이벤트 평가
│   ├── runtime.py            # 실시간 수집·추론·FSM
│   ├── fsm.py
│   ├── outbox.py
│   └── requirements.txt
├── server/
│   ├── src/
│   │   ├── app.js
│   │   ├── routes/
│   │   ├── db.js
│   │   ├── push.js
│   │   └── worker.js
│   └── package.json
├── web/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── sw.js
│   └── manifest.webmanifest
├── config/
│   ├── layout.json
│   ├── sensing.json
│   └── runtime.json
├── data/
│   ├── raw/                  # 공개 Git 제외
│   ├── processed/            # 공개 Git 제외
│   └── splits/session_split.csv
├── models/                   # 버전별 모델·설정
├── reports/                  # 수집 품질·평가·시연
├── .env.example              # 값 없는 변수 설명
└── README.md
```

Python은 프로젝트 전용 가상 환경을 사용한다. 설치된 버전이 무엇이든 바로 사용하지 말고 NumPy·SciPy·scikit-learn·pyserial을 함께 설치·실행할 수 있는 버전을 고른다. 초기 후보로 Python 3.12를 검토하고 성공한 버전을 고정한다. Node 버전은 설치 시점의 [공식 지원 일정](https://nodejs.org/en/about/previous-releases)을 확인한다.

Python 의존성 후보는 `numpy scipy scikit-learn pandas pyserial joblib requests`다. Node는 지원 버전과 호환 패키지를 `package-lock.json`으로 고정한다. 현재 시제품 의존성은 `express`와 `pg`; Push가 연결될 때 `web-push`를 추가한다. 비밀 설정은 Node 내장 env 파일 로딩 또는 관리형 환경변수로 제공한다.

학습·분석 폴더에서 선택한 Python으로 실행:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r analysis/requirements.txt
```

구현 이후의 실행 순서 예시:

```powershell
.venv\Scripts\python.exe analysis/collect.py --port COM5 --session S001
.venv\Scripts\python.exe analysis/build_dataset.py --split data/splits/session_split.csv
.venv\Scripts\python.exe analysis/train.py
.venv\Scripts\python.exe analysis/replay.py --split validation
.venv\Scripts\python.exe analysis/replay.py --split test
```

최종 설정을 선택하기 전 `--split test`를 반복 실행해 성능을 맞추지 않는다. 별도 터미널에서 서버를 실행하고, 검증된 모델을 지정한 runtime으로 센서를 연결한다.

```powershell
cd server
npm ci
npm run dev
```

`npm run dev`가 동작하도록 package script를 구현해야 한다. `npm ci`에는 이미 생성·커밋한 lockfile이 필요하다.

`.env.example`에는 서버 주소, 게이트웨이 토큰 변수 이름, DB 경로, VAPID 공개·개인키, 연락처 설정을 설명한다. 실제 값은 각 실행 환경의 비공개 `.env`에 둔다.

바이브코딩을 사용할 때는 수집기→특징→모델→이벤트 API→Push를 작은 단위로 구현한다. 실제 CSI 형식을 확인하기 전에 AI가 만든 고정 길이 parser를 그대로 사용하지 않는다. 한 번에 전체를 생성하면 어느 단계에서 잘못됐는지 추적하기 어렵다.

## 19. 3주 개발 계획과 장소 선택

### 장소 계획

**동아리방·기숙사 중 접근·안전·장비 고정이 가능한 한 곳을 주 실험 장소로 정한다.** 기숙사 사용 허가나 시간 확보가 어려우면 동아리방 한 곳으로도 수행한다.

장소를 정한 뒤 배치 사진·평면도·`layout_id`를 기록하고 주요 수집·학습·평가를 같은 배치에서 진행한다. 한 장소에서도 다른 날, 다른 실행 세션, 가능한 다른 참여자로 독립 평가가 가능하다.

두 장소를 모두 사용할 수 있을 때만 추가로 이동 검증을 진행한다. 이동했다면 원본 모델 그대로의 결과, 재보정 후 결과, 재학습 후 결과를 구분한다. 이동 검증을 위해 필수 낙상·알림 기능의 완성을 늦추지 않는다.

### 작업 일정

| 기간 | 중심 작업 | 남길 산출물·판단 |
|---|---|---|
| 1~3일 | 대회 접수 확인, 장비·버전 고정, 단일 링크 수집 | CSI 원본, 수신율·UART 품질 보고 |
| 4~7일 | 다중 링크, 라벨 도구, 파일 형식, 장소·배치 고정 | 정상·모의 동작 pilot, 공간 구분 가능성 |
| 8~11일 | 본 수집, split 고정, 특징·RF 후보 학습 | split manifest, 후보 모델·검증 점수 |
| 12~14일 | validation replay, FSM·이벤트·API 연결 | 임계값·episode 규칙, 재전송 동작 |
| 15~17일 | HTTPS 웹·실기기 Push·통합 검증 | 휴대폰 수신, 장애·중복·확인 기록 |
| 18~21일 | 설정 고정, 최종 test, 결과 정리·시연 | 평가표, 실패 조건, 발표·시연 자료 |

시험기간을 고려해 작업 가능한 시간을 먼저 배정한다. 프론트 담당자는 수집과 병행해 가상 이벤트로 화면을 만들 수 있지만, 가상 이벤트 성공을 실제 CSI 성능으로 세지 않는다.

### 중간 판단 지점

- 3일: CSI 수신이 안 되면 새 모델·UI 기능을 늘리지 말고 펌웨어·포트·버전 문제부터 해결.
- 7일: pilot에서 낙상과 혼동 동작의 차이가 보이지 않으면 배치·라벨·특징을 수정.
- 14일: 최초 모델 성능이 부족하면 실패 동작을 추가 수집하고 기능 범위를 검증한 감지 영역으로 제한.
- 17일: 잠금 화면 Push가 동작하지 않으면 알림·권한·HTTPS·OS 조건을 먼저 해결.
- 종료: 미완료 핵심 기능을 제외하거나 완료한 것처럼 발표하지 않음.

## 20. 통합 확인과 시연 절차

### 개발 중 확인할 항목

| 상황 | 기대 동작 |
|---|---|
| 빠르게 앉기·정상 눕기 | 오탐 여부를 기록하고 정상 비교 데이터로 평가 |
| 모의 낙상 후 계속 움직임 | 후속 정지가 없어도 분류 기준 충족 시 위험 이벤트 생성 |
| 미복귀 알림이 이미 있음 | 새 낙상 사건·Push를 별도 처리 |
| RX USB 제거 | 상태 확인 불가, 기존 위험 기록 유지 |
| 인터넷 끊김 | 로컬 기록 지속, 원격 미전달 표시, 복구 후 재전송 |
| 같은 이벤트 반복 전송 | 서버 사건 한 개, 불필요한 추가 Push 작업 없음 |
| 프로그램·서버 재시작 | 저장 사건·전송 작업 복구, 센싱 상태는 재확인 |
| 브라우저 권한 거절·구독 만료 | 알림 불가·재설정 안내, 화면 기록 유지 |
| 상태 요청 순서 뒤바뀜 | 이전 snapshot이 최신 상태를 덮어쓰지 않음 |
| 보호자 확인 버튼 | ack만 기록, 사고 해소·침대 복귀 자동 확정 안 함 |

이 표는 앞으로 수행할 확인 항목이다. 현재 통과했다고 기록하지 않는다.

### 낙상 시연

1. 검증한 감지 위치와 모델·배치 버전을 표시한다.
2. 빠르게 앉기·정상 눕기 등 혼동 동작을 먼저 보여준다.
3. 안전 조건에서 모의 낙상을 수행하고 실제 센싱으로 분류한다.
4. 휴대폰 잠금 화면 알림을 확인한다.
5. 사건 상세에서 발생·감지·수신 시각과 확인 기록을 보여준다.

시연이 실패하면 저장된 원본 replay를 사용할 수 있다. 반드시 “기록 데이터 재생”으로 표시하며, 이미 알려진 정답 시각에 강제로 알림을 발생시키는 방식과 모델 추론을 구분한다.

### 미복귀 시연

초기 침대 상태를 실험자가 수동 확인했다면 그 사실을 표시한다. 이탈 추정 후 시연용 기준 20~30초로 미복귀 알림을 보여준다. 운영 예시의 10분 설정과 시연 설정을 구분한다.

복귀 판단은 검증한 패턴이 있을 때만 자동 시연한다. 복귀 구분이 미완료라면 수동 확인을 모델의 자동 복귀 감지로 발표하지 않는다.

### 발표 자료

문제·범위, 센서 구성, 데이터 수집량, 라벨·세션 분리, 모델·전처리, 이벤트 평가표, 실기기 알림, 실패 조건을 포함한다. 한 장소 모의 동작의 결과를 실제 어르신·다른 방의 성능으로 확장하지 않는다.

## 21. 확정 조건과 남은 선택

| 항목 | 상태 |
|---|---|
| 시간대·치매 제한 제거 | 사용자 요청 반영 |
| 낙상 구분 포함 | 필수 개발 목표 |
| 장소 | 동아리방 또는 기숙사 한 곳 가능, 두 곳 사용은 선택 |
| 실제 성능 | 미측정 |
| Python CSI 분석 | 개발 설계안 |
| Express 백엔드 | 현재 Node 시제품 구현 기준 |
| PostgreSQL | 사용 가능한 로컬 서버를 대상으로 설정, 계정 접속은 비밀 `.env` 필요 |
| 모바일 웹 우선 | 웹 경험·Flutter 첫 사용·일정에 따른 권장안 |
| 자동 침대 복귀 | 별도 수집·검증 필요 |
| 한 방 밖의 일반화 | 추가 평가를 한 경우에만 주장 |
| 최종 대회 제출 일정 | 공식 공고·첨부 서식에서 별도 확인 |

첫 구현을 시작하기 전 주 실험 장소·배치, 백엔드 하나, Android 시험 기기, 원본 수집 포맷과 split 책임자를 정한다. 나머지 실험값은 검증 자료와 버전 기록을 남기며 조정한다.

> **WiFi 채널 변화를 분석해 검증한 실내 영역의 낙상 의심과 침대 이탈 후 미복귀 가능성을 감지하고, 보호자에게 확인 알림을 제공하는 비접촉식 돌봄 보조 시스템을 개발한다.**

## 22. 참고 자료와 출처 사용 범위

확인일은 2026-10-05다. 공식 예제는 변경될 수 있으므로 실제 개발에는 checkout 커밋과 버전을 기록한다.

| 자료 | 활용할 부분 |
|---|---|
| [대회 주관기관 홈페이지](https://gsia.kr/) | 모집 안내·공식 공고·첨부 서식 확인 |
| [ESP-CSI](https://github.com/espressif/esp-csi) | CSI 수집·분석 공식 예제 |
| [공식 TX 소스](https://github.com/espressif/esp-csi/blob/master/examples/get-started/csi_send/main/app_main.c) | 송신 채널·주기·패킷 순번 |
| [공식 RX 소스](https://github.com/espressif/esp-csi/blob/master/examples/get-started/csi_recv/main/app_main.c) | 송신 MAC 필터·CSI 출력 구조 |
| [console_test](https://github.com/espressif/esp-csi/tree/master/examples/esp-radar/console_test) | 직렬 수집·가시화, 버전·포트 확인 |
| [WiFi sensing demo](https://github.com/espressif/esp-csi/blob/master/examples/esp-radar/wifi_sensing_demo/README.md) | ACTIVE/INACTIVE·현장 보정 참고, 낙상 모델과 구분 |
| [ESP32-S3 CSI 가이드](https://docs.espressif.com/projects/esp-idf/en/v5.3.2/esp32s3/api-guides/wifi.html#wi-fi-channel-state-information) | 복소 성분·LTF·유효성·callback 제약 |
| [ESP32 기반 낙상 연구](https://doi.org/10.1016/j.jiixd.2024.04.001) | 연구 가능성의 근거, 자체 성능과 구분 |
| [SiFall](https://arxiv.org/abs/2301.03773) | 온라인 RF 낙상 감지 연구 |
| [SenseFi](https://github.com/xyanchen/WiFi-CSI-Sensing-Benchmark) | WiFi sensing 연구용 Python·PyTorch 구현 |
| [scikit-learn 데이터 누수 방지](https://scikit-learn.org/stable/common_pitfalls.html) | 훈련·평가 분리, 동일 전처리 |
| [GroupShuffleSplit](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.GroupShuffleSplit.html) | 세션 그룹 분리 |
| [RandomForestClassifier](https://scikit-learn.org/stable/modules/generated/sklearn.ensemble.RandomForestClassifier.html) | 초기 모델의 기능·파라미터 |
| [임계값 조정](https://scikit-learn.org/stable/modules/classification_threshold.html) | 검증 자료로 알림 기준 선택 |
| [모델 저장](https://scikit-learn.org/stable/model_persistence.html) | 신뢰된 모델 파일·환경 고정 |
| [Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API) | 브라우저 Push·구독·Service Worker |
| [Express 공식 API](https://expressjs.com/en/5x/api/) | 웹 API·정적 파일 제공 구조 |
| [node-postgres 연결](https://node-postgres.com/features/connecting) | PostgreSQL 환경 변수·연결 풀 |
| [node-postgres 트랜잭션](https://node-postgres.com/features/transactions) | 한 client로 이벤트·처리 이력 묶기 |
| [express-session 공식 문서](https://github.com/expressjs/session) | 기본 MemoryStore의 운영 제약·세션 저장소 선택 |
| [SQLite 사용 가이드](https://www.sqlite.org/whentouse.html) | 단일 서버·로컬 저장과 공유 DB 선택 |
| [Node 지원 일정](https://nodejs.org/en/about/previous-releases) | 개발 환경의 지원 버전 선택 |
| [Node web-push](https://github.com/web-push-libs/web-push) | VAPID 기반 Node Push 구현 |
| [WebKit Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) | 추후 iOS 지원 시 조건 참고 |
| [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging) | Firebase를 선택할 때의 대안 |
| [Buoy](https://github.com/GabeMerc/Buoy---CSI-For-Fall-Detection) | Python 분석·Express·PWA 조합 사례 |
| [ElderCare](https://github.com/dungnotnull/wifi-sensing-based-elderlycare-deeplearning) | Python 분석·FastAPI·React 조합 사례 |

센서·라이브러리의 사실은 출처를 따른다. 수집량, 윈도 길이, 품질 기준, 내부 목표 성능, 재시도·heartbeat 값은 **본 프로젝트의 실험 설계안**이며 출처의 검증 결과로 표현하지 않는다.
