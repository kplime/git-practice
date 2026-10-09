# 활동 데이터와 장시간 저활동 판단

구현 단계: 활동 입력·저활동 Python 로직·설정/사건 API·DB 저장 계약과 홈 최신 활동 표시·저활동 설정 화면·전용 필터·사건 상세를 구현했다. 활동 시계열 저장·기간 조회·홈 추이도 연결했다. 실제 ESP32 수집·CSI 활동 지표 산출·상시 실행 루프는 아직 연결하지 않았다.

## 1. 활동 지표의 의미

`activity.score`는 로컬 분석기가 **해당 측정 구간의 움직임 변화**를 0~1로 정규화한 값이다. 낮을수록 변화가 작다. 낙상 확률, 안전 점수, 사람의 재실 여부를 뜻하지 않는다. 입력값 검증과 저활동 시간 누적은 구현했지만, CSI에서 이 지표를 만드는 모델·정규화 방식은 실제 수집 데이터로 정해야 한다.

- 센싱 중단·패킷 누락·품질 저하·지표 미산출은 `activity: null`이다. 0을 대신 넣지 않는다.
- 0은 **실제 유효한 구간에서 산출한 값**일 때만 사용한다.
- 구간 내 패킷이 빠졌거나 보정이 유효하지 않으면 수집기가 구간을 유효하다고 보내면 안 된다.
- modelVersion은 지표 산출 방법, calibrationVersion은 공간·배치별 정규화/보정의 버전이다.
- 검증 데이터는 수집 세션 단위로 나눈다. 구간별 무작위 분할로 중첩 데이터가 학습·평가에 섞이지 않도록 한다.

## 2. 입력 계약

기존 POST `/api/ingest/status` 요청에 선택 필드 `activity`를 추가한다. `measuredAt`은 구간 종료다.

```json
{
  "gatewayId": "room-01",
  "generation": 1,
  "sequence": 1,
  "sensorAvailable": true,
  "qualityStatus": "AVAILABLE",
  "measuredAt": "2026-10-08T00:00:10.000Z",
  "isDemo": true,
  "activity": {
    "score": 0.1,
    "windowStartedAt": "2026-10-08T00:00:00.000Z",
    "modelVersion": "activity-v1",
    "calibrationVersion": "room-layout-v1"
  }
}
```

위 값은 계약 예시이며 실제 측정 기록이 아니다. 생성한 입력은 반드시 isDemo=true로 보낸다.

| 항목 | 조건 |
|---|---|
| score | boolean·문자열이 아닌 유한한 숫자, 0~1 |
| windowStartedAt / measuredAt | UTC ISO 문자열, Z 필수, 소수 초는 최대 3자리 |
| 구간 길이 | 0초 초과, 15초 이하 |
| modelVersion / calibrationVersion | 공백만으로 구성되지 않은 문자열, 최대 100자 |
| isDemo | 활동 객체가 있으면 명시적인 boolean 필수 |
| 상태·출처 | 하나의 detector는 한 gatewayId만 처리 |

API는 잘못된 활동 객체를 400 INVALID_ACTIVITY로 거절한다. 구조가 유효해도 품질이 AVAILABLE이 아니거나 sensorAvailable=false이면 활동 객체를 저장하지 않는다. 활동을 생략/null로 보낸 새 heartbeat는 이전 활동 객체를 비운다.

GET `/api/status`는 기존 실제 기기 선택 규칙을 유지한다. 실제 heartbeat가 없으면 activity=null이다. 연결·센서·품질이 정상이고 측정이 15초 이내일 때만 최신 activity 객체를 반환한다. 미래 시각 허용 오차는 5초다. 시험 신호로 실제 활동을 대신하지 않는다. 명시적 실제 신호의 반복 측정도 최신 활동값으로 반환하지 않는다. 시계열은 별도 activity_history에 저장하고 GET `/api/activity/history`로 조회한다. 저장·조회·그래프의 개발 계약은 [활동 이력 개발 안내](./ACTIVITY_HISTORY.md)를 참고한다.

## 3. 설정 계약

GET/PATCH `/api/settings`, GET `/api/gateway/settings`와 상태 응답의 settings에 다음을 추가했다.

| 필드 | 값 | 기본값 |
|---|---|---|
| lowActivityEnabled | boolean | false |
| lowActivityMinutes | 1~1440 정수 | 30 |
| lowActivityThreshold | 0~1 유한한 숫자 | 0.2 |
| lowActivityMode | ALL_DAY / TIME_RANGE | ALL_DAY |
| lowActivityStart | 한국 시간 HH:mm | 22:00 |
| lowActivityEnd | 한국 시간 HH:mm, 시작과 다름 | 07:00 |

기본값은 개발용 초기 설정이며 건강·안전을 판단하는 검증된 기준이 아니다. 실제 공간·정상 생활 데이터로 적절한 지표와 기준을 검증한 뒤 사용한다. 설정 변경은 기존 version을 증가시키며, 수정하지 않은 낙상·장애 설정과 기존 이력은 보존한다. 웹에서는 사용 여부·지속 시간·0~10 민감도·감지 시간대를 한 카드에서 조정하며 꺼짐일 때 관련 입력을 비활성화한다. 상시면 시각 입력을 숨기고 지정해 둔 시각은 보존한다. 저장 실패·자동 갱신 중 편집값을 유지한다.

민감도 S는 threshold=S/10에 대응한다. 높을수록 저활동으로 판단하는 범위가 넓어진다. 슬라이더 조작은 1단위이며 기존의 소수 민감도는 조작 전까지 유지한다. 기본 threshold=0.2는 민감도 2로 표시한다. API·활동 지표의 0~1 계약은 유지한다. 민감도 0은 감지 끄기와 다르며 지표 0만 LOW다. 민감도 10이면 모든 유효 지표가 LOW 범위다.

TIME_RANGE는 매일 한국 시간 `[시작, 종료)` 구간이며 22:00~07:00처럼 자정을 넘길 수 있다. 같은 시작·종료는 거절한다. 감지 설정과 사건 생성 조건에만 적용하며 원시 측정·활동 이력·낙상/장애의 사용 여부를 바꾸지 않는다.

홈은 유효한 실제 활동 지표와 측정 시각만 표시한다. 저장 기준의 기기 적용을 확인한 경우에만 LOW/ACTIVE에 해당하는 '낮은 활동'/'활동 변화'를 구분한다. 적용을 확인하지 못하거나 지정 감지 시간대 밖이면 지표와 '측정됨'을 표시한다. 단일 지표를 장시간 저활동 사건이나 안전 판정으로 표시하지 않는다. 저활동 사건 상세는 현재 설정이 아니라 사건에 기록된 당시 민감도·시작·지속 시간·지표·감지 시간대를 보여 준다. 시간대가 기록되지 않은 과거 사건은 '기록 없음'이다.

## 4. 저활동 상태 전이

구현: [activity.py](../python/activity.py), [low_activity.py](../python/low_activity.py), [low_activity_schedule.py](../python/low_activity_schedule.py).

1. 유효한 관측이고 score <= lowActivityThreshold이면 LOW, 초과하면 ACTIVE다.
2. 감지가 켜져 있고 지정 시간대 안에 완전히 포함되는 LOW 구간만 누적한다. 한 구간의 종료와 다음 시작이 정확히 같아야 한다. 시간대 시작에 걸친 구간은 잘라 추정하지 않고 제외한다.
3. 누적 시간이 lowActivityMinutes에 도달하면 LOW_ACTIVITY 사건 payload를 한 번 반환한다. 이후 LOW가 이어져도 반복 생성하지 않는다.
4. 유효한 ACTIVE 구간이 오면 누적과 사건 생성 상태를 초기화한다. 이후 새 LOW 구간부터 다시 계산한다.
5. 누락·장애·품질 저하·오래된 측정·잘못된 지표는 UNKNOWN으로 전환하고 누적을 초기화한다. 빈 시간을 LOW로 채우지 않는다.
6. 구간의 틈·겹침·순번 건너뜀, generation·시험/실제 출처·모델·보정 변경도 초기화한다. 새 유효 구간부터 다시 누적한다.
7. 이전 generation 또는 같은 generation의 중복/이전 sequence는 무시한다. 같은 측정 종료 시각을 새 sequence로 재전송해도 시간이 추가되지 않는다.
8. 감지를 끄거나 지속 시간·지표 기준·감지 모드·시각을 바꾸면 누적을 초기화한다. 낙상 옵션만 바꾸는 등 무관한 version 변경은 기존 연속 시간을 유지한다.
9. 보호자 확인·상황 해소는 감지기의 재감지 조건과 별개다. 확인 버튼을 눌렀다는 이유로 같은 연속 LOW에서 사건을 다시 만들지 않는다.
10. 지정 시간대 밖이거나 측정 종료가 시간대 종료와 같으면 PAUSED다. check_stale의 idle tick도 종료 시점에 누적을 초기화한다. 다음 감지 시간대에 이전 누적을 더하지 않는다. 자정 넘김 구간 안에서는 자정만으로 초기화하지 않는다.

`DetectionResult`는 state(UNKNOWN/ACTIVE/LOW/PAUSED), score, low_since, duration_seconds, event, ignored를 제공한다. PAUSED는 시간대 제한에 따른 중지이며 센서 고장을 의미하지 않는다. 감지가 꺼져 있어도 유효한 활동 구간은 LOW/ACTIVE로 구분하지만 시간 누적·사건 생성은 하지 않는다. 감지 설정이 잘못됐거나 다른 기기를 같은 객체로 처리하면 상태를 비우고 ValueError를 낸다.

## 5. 실행 코드에서 호출하기

아래는 호출 흐름이다. collector·queue는 아직 구현하지 않은 연결 부분이며 실제 실행 가능한 수집 프로그램으로 제공하는 예시는 아니다.

```python
from python.low_activity import LowActivityDetector

detector = LowActivityDetector("room-01")
# 수집 프로그램 시작 때 한 번 만들고 유지한다. 매 구간마다 새로 만들지 않는다.

# 유효성/출처/측정 구간을 포함한 새 status를 만들었을 때:
result = detector.update(status, applied_settings)
if result.event is not None:
    # 발생한 payload를 저장한 후 GatewayClient.send_event로 전송한다.
    # 실패 시 동일 eventId와 내용을 재사용한다.
    pass

# 입력이 없을 때도 주기적으로 호출한다. tick은 사건을 만들지 않는다.
current = detector.check_stale()
```

설정은 detector에 실제 적용한 값을 넘기며 enabled=true이면 양의 정수 version이 필요하다. 입력이 없는 동안 check_stale을 호출하면 마지막 측정이 15초를 넘었을 때 UNKNOWN이 된다. 이후 입력이 재개돼도 확인되지 않은 중간 시간은 누적하지 않는다.

현재 로직은 메모리에서 연속 상태를 관리한다. 프로세스 재시작 시 누적을 복원하지 않고 새 관측부터 시작한다. 사건 전송·실패 재시도·내구성 있는 outbox·설정 자동 동기화·상시 수집 worker는 이 모듈에 포함하지 않았다. 호출자가 사건을 저장하지 못하면 전달을 보장할 수 없다. 기존에 후속 후보로 둔 전송/동기화 작업과 실제 수집 루프를 연결해야 지속 실행된다.

## 6. 사건 계약과 DB 호환

LOW_ACTIVITY 사건의 score는 null이며, 활동 지표는 details.activityScore에 넣는다. 보호자 확인과 해소는 기존 API를 그대로 사용한다.

- occurredAt: LOW 시작 시각에 기준 시간을 더한 시각.
- detectedAt: 기준 도달을 확인한 구간의 종료 시각.
- details: lowSince, durationSeconds, thresholdMinutes, activityThreshold, activityScore, settingsVersion, calibrationVersion.
- 새 Python 사건은 당시 monitoringMode, monitoringStart, monitoringEnd, timeZone도 details에 남긴다. 과거 사건은 이 필드가 없어도 기존 계약으로 처리한다.
- qualityStatus=AVAILABLE, modelVersion과 명시적 isDemo를 포함한다.
- API는 시간·지속 길이·활동 기준의 일관성을 검증한다. 조건이 다르면 400 INVALID_LOW_ACTIVITY_EVENT다.
- 동일 payload의 재전송은 멱등 처리한다. 수신 시 현재 설정이 꺼졌다는 이유로 이미 발생한 사건을 버리지 않는다.
- DB 초기화는 기존 events 유형 제약에 LOW_ACTIVITY를 추가하고 필요한 열만 추가한다. 과거 NON_RETURN_WARNING 사건·처리 이력·설정값은 삭제하거나 변환하지 않는다.

활동 계약 검증은 입력이 실제 CSI에서 나온 것임을 증명하지 않는다. 실제 분석기를 연결하고 실제 데이터로 평가하는 작업은 별도로 남아 있다.

## 7. 검증

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_*.py
npm.cmd test
npm.cmd run test:integration
```

Python 테스트는 기준 도달·재감지·신호 누락·구간 연속성·중복·재시작·출처·보정·설정 변경·시각 경계를 확인한다. API 통합 테스트는 임시 PostgreSQL 스키마에서 활동 검증·실제/시험 분리·신선도·설정 저장·기존 제약 변경·Python 발생 사건의 저장/조회/처리/재전송을 확인한다. 생성 데이터 검증이며 실제 CSI 감지 성능 검증은 아니다.
