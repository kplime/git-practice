# 온가드(OnGuard) 현재 구현된 API 계약

HTTP JSON은 **camelCase**, PostgreSQL 열 이름은 snake_case다. Python 내부 변수나 원시 CSI 파일 형식은 별도로 정한다. 이 문서는 현재 Express 서버의 계약이며 Push·로그인·CSI 추론은 포함하지 않는다.

소개서 기준 프로젝트 설명은 [프로젝트 설명](./PROJECT_PLAN.md)을 참고한다. 아래 계약은 현재 실행 코드에서 제공하는 API다.

활동 입력·저활동 상태 전이·호출 방법은 [활동 데이터와 저활동 판단](./ACTIVITY_DETECTION.md)을 참고한다. 실제 CSI 분석기·상시 수집 루프는 아직 연결하지 않았다.

## 공통

- 기본 주소: `http://127.0.0.1:3002`. 웹과 API를 같은 Node 서버에서 제공한다.
- 요청 body: `Content-Type: application/json`, 최대 32 KB.
- 시각: UTC ISO 8601 문자열. 예: `2026-10-06T12:00:00.000Z`. 화면은 현지 시각으로 표시한다.
- ID: 영문·숫자·`.`·`_`·`:`·`-`, 1~120자. 이벤트는 UUID 권장.
- 게이트웨이 경로는 `Authorization: Bearer <GATEWAY_TOKEN>`이 필요하다. 토큰을 브라우저에 전달하지 않는다.
- 보호자 로그인은 구현 전이며 localhost 개발용이다.
- `isDemo: true`는 생성한 시험 데이터에 사용한다. 누락 시 false. 시험 도구는 항상 true로 보낸다.
- 오류: `{ "error": { "code": "INVALID_EVENT", "message": "..." } }`.

## 경로

| 메서드·경로 | 계약 |
|---|---|
| GET `/api/health` | PostgreSQL 조회 후 `{ok, service, time}` |
| GET `/api/status` | 실제 기기의 최신 heartbeat 기준 관측 상태. isDemo=true 신호 제외 |
| GET `/api/activity/history` | 실제 활동의 구간·관측 공백 이력. `{gatewayId, from, to, items, nextCursor}` |
| GET `/api/events` | `{items, nextCursor}`. 아래 필터·페이지 규칙 참고 |
| GET `/api/events/:id` | 사건 필드와 `actions` 배열 |
| POST `/api/events/:id/ack` | `{}`. 확인 시각만 기록하며 상황 해소와 별개 |
| POST `/api/events/:id/resolve` | `{observed: true, reason: "직접 관찰한 상황과 조치"}` |
| GET `/api/settings` | version, 낙상·저활동·장애 설정, timeZone, updatedAt |
| PATCH `/api/settings` | 아래 변경 가능 필드를 일부 또는 전부 지정. 모르는 필드·빈 객체는 400 |
| GET `/api/gateway/settings` | 토큰 필요. 동일 설정 응답 |
| POST `/api/ingest/status` | 토큰 필요. 최신 상태와 명시적 실제 신호의 활동 이력을 한 트랜잭션으로 저장 |
| POST `/api/ingest/events` | 토큰 필요. 이벤트 멱등 저장 |

## 상태 요청과 응답

```json
{
  "gatewayId": "room-gateway-01",
  "generation": 1,
  "sequence": 1,
  "sensorAvailable": true,
  "qualityStatus": "AVAILABLE",
  "measuredAt": "2026-10-06T12:00:00.000Z",
  "appliedSettingsVersion": 1,
  "isDemo": true
}
```

| 필드 | 값 |
|---|---|
| generation | 1 이상 정수. 로컬에 보관하고 재시작마다 증가 |
| sequence | 0 이상 정수. 같은 generation 안에서 증가 |
| sensorAvailable | boolean |
| qualityStatus | AVAILABLE / DEGRADED / UNAVAILABLE / UNKNOWN |
| measuredAt | 측정 시각 또는 null |
| appliedSettingsVersion | 선택. 기기에 실제로 적용한 설정 버전, 1 이상 정수 또는 null. 누락하면 적용 여부 확인 불가 |
| isDemo | 선택 boolean |
| activity | 선택 객체 또는 null. score, windowStartedAt, modelVersion, calibrationVersion. 객체가 있으면 명시적 isDemo 필수 |

활동 score는 0~1 유한한 숫자이며 낙상 확률이 아니다. 구간은 windowStartedAt부터 measuredAt까지 0초 초과·15초 이하이며 UTC Z 시각을 사용한다. 모델·보정 버전은 각각 공백만 아닌 1~100자다. 잘못된 객체는 400 INVALID_ACTIVITY다. 생략/null 또는 사용할 수 없는 센싱 상태이면 이전 활동값을 비운다.

generation·sequence는 PostgreSQL INTEGER 범위 안에서 사용한다. 수신 성공은 `202 {accepted: true, receivedAt}`. 더 낮은 generation 또는 동일 generation의 이전·같은 sequence는 `409 STALE_STATUS`다. 동일 heartbeat 재전송은 새 순번으로 갱신해야 한다.

상태 조회에는 `gateway {id?, connected, receivedAt, ageSeconds, generation?, sequence?}`, `sensor {available, qualityStatus, measuredAt, ageSeconds, fresh}`, `activity`(최신 활동 객체 또는 null), `settings`(설정 전체와 appliedVersion), `isDemo`, `fetchedAt`이 포함된다. 마지막 heartbeat 수신이 15초를 넘으면 connected=false다. sensor.fresh는 측정 시각이 서버 기준 15초 이내이고 미래 시각 오차가 5초 이하일 때 true다. 통신 수신 시각과 센서 측정 시각은 별도로 판단한다. 처음에는 ID·순번이 없고 시각·경과는 null이다. activity는 연결·센싱·품질·신선도가 모두 유효할 때만 반환한다. 명시적 실제 신호에서는 동일 세대의 반복 측정도 activity=null이다. 활동 이력은 별도 경로로 조회한다.

**이벤트 전송은 heartbeat가 아니다.** 과거 이벤트를 재전송해도 연결 상태가 정상으로 바뀌지 않는다. 상태 조회는 isDemo=false이고 heartbeat 수신 이력이 있는 기기 중 최신 신호만 선택한다. isDemo=true 신호는 실제 신호가 없거나 끊겨도 대체 신호로 사용하지 않는다. 실제 heartbeat가 한 번도 없으면 connected=false, sensor.available=false, sensor.fresh=false이며 측정·수신 시각과 appliedVersion·activity는 null이다. 웹은 이 경우 '연결 대기'로 표시한다. 웹도 isDemo가 명시적으로 false인 응답만 실제 관측으로 인정한다. 다중 방/기기 선택은 아직 없다.

침대 상태·이탈 시각은 현재 계약에서 제외했다. 이전 클라이언트가 보낸 bedState·bedExitedAt은 무시하고 저장·응답하지 않는다. DB의 기존 열과 값은 이력 호환을 위해 보존한다.

## 활동 이력 조회

GET `/api/activity/history`의 쿼리:

- `gatewayId`: 선택. 생략하면 최신 실제 heartbeat 기기 한 개. 다음 페이지에서는 커서의 기기를 유지한다.
- `from`, `to`: UTC Z 시각, `[from, to)` 구간. 기본 최근 1시간, 최대 7일. `to`만 지정하면 그 시각 직전 1시간이다.
- `limit`: 기본 500, 1~1000 정수. 잘못된 값을 보정하지 않고 400으로 거절한다.
- `cursor`: 응답의 nextCursor. 기기·기간을 포함하며 다른 조회 조건과 섞으면 400이다. 페이지 이동 시 기간을 생략하면 커서의 기간을 사용한다.

items는 sampledAt·generation·sequence 내림차순이다. 항목은 generation, sequence, sampledAt, measuredAt, receivedAt, windowStartedAt, score, qualityStatus, modelVersion, calibrationVersion, reason을 포함한다. score=0은 유효한 측정이며, 공백은 score=null과 reason으로 구분한다. 유효 측정의 sampledAt은 measuredAt, 공백은 서버 receivedAt이다. 다음 항목이 실제로 있을 때만 nextCursor를 반환한다. 알 수 없는 기기나 기록이 없는 기간은 빈 items다.

이력은 isDemo=false를 **명시한** 상태 요청만 저장한다. 시험 신호·출처 누락·사건 전송은 이력을 생성하지 않는다. 오래된 상태 요청의 409와 malformed 활동 객체의 400도 이력을 남기지 않는다. 기존 최신 상태를 과거 이력으로 복제하지 않는다. 저장 구조·공백 사유·조회 예제·UI의 페이지 한계는 [활동 이력 개발 안내](./ACTIVITY_HISTORY.md)에 정리했다.

## 이벤트 요청

```json
{
  "eventId": "73a74246-976f-4f9f-92ee-675b57c5f96f",
  "gatewayId": "room-gateway-01",
  "type": "FALL_SUSPECTED",
  "occurredAt": "2026-10-06T12:00:00.000Z",
  "detectedAt": "2026-10-06T12:00:01.000Z",
  "score": 0.82,
  "qualityStatus": "AVAILABLE",
  "modelVersion": "rf-v1",
  "details": {"layoutId": "clubroom-layout-01", "settingsVersion": 1},
  "isDemo": true
}
```

- 필수: eventId, gatewayId, type, occurredAt, detectedAt.
- 신규 type: FALL_SUSPECTED / LOW_ACTIVITY / SENSOR_UNAVAILABLE / GATEWAY_OFFLINE.
- score: 선택. 0~1 숫자 또는 null. 검증되지 않은 점수를 확률로 설명하지 않는다.
- qualityStatus: 선택. 상태 요청과 동일 enum. 기본 UNKNOWN.
- modelVersion: 선택 문자열, 최대 100자로 저장.
- details: 선택 JSON 객체. episodeId, layoutId, calibrationVersion, settingsVersion 등 추가 맥락을 넣는다. CSI 원시 배열은 보내지 않는다.
- 응답: 최초 `201 {accepted, duplicate: false, eventId, receivedAt}`. 같은 ID·같은 내용은 `200 {accepted, duplicate: true, eventId}`. 같은 ID·다른 내용은 `409 EVENT_ID_CONFLICT`.

LOW_ACTIVITY에는 명시적인 isDemo, qualityStatus=AVAILABLE, modelVersion, score=null이 필요하다. details에는 lowSince, durationSeconds, thresholdMinutes, activityThreshold, activityScore, settingsVersion, calibrationVersion을 넣는다. occurredAt=lowSince+기준 시간이고 detectedAt까지의 지속 길이가 durationSeconds와 맞아야 한다. activityScore는 기준 이하여야 하며 기준 시간에 도달해야 한다. 잘못된 근거는 400 INVALID_LOW_ACTIVITY_EVENT다. 상세 계약은 활동 판단 문서에 설명했다.

재시도는 ID·발생/감지 시각·요청 내용을 그대로 유지한다. 토큰·필드 오류는 수정 전 무한 재시도하지 않는다. 내구성 있는 SQLite outbox와 backoff는 추후 실제 게이트웨이에 구현한다. `python/gateway_client.py`는 timeout을 둔 전송 도구이며 outbox를 대신하지 않는다.

이전 유형 NON_RETURN_WARNING은 신규 생성 시 `400 RETIRED_EVENT_TYPE`이다. 이미 저장된 동일 ID·동일 내용은 `200 duplicate: true`, 내용이 다르면 `409 EVENT_ID_CONFLICT`다. 기존 미복귀 사건과 처리 이력은 보존하며 '미복귀 · 이전 기록'으로 표시한다. 전체 목록·상세·확인·해소는 계속 지원하지만 웹의 미복귀 필터는 제거했다. 이전 API 호출자의 `type=NON_RETURN_WARNING` 조회는 유지한다. 기존 기록을 저활동 사건으로 바꾸지 않는다.

## 사건 조회와 처리

사건은 이벤트 요청 필드와 서버가 기록한 receivedAt, state, acknowledgedAt, resolvedAt, observed, resolutionReason을 반환한다. 최초 state=OPEN. 확인 후 ACKNOWLEDGED. 직접 관찰과 사유 기록 후 RESOLVED.

- 목록: `limit` 1~100, 기본 30.
- `type`: 이벤트 type 한 개 또는 `FAULT`(SENSOR_UNAVAILABLE + GATEWAY_OFFLINE).
- `state`: OPEN / ACKNOWLEDGED / RESOLVED.
- `from`, `to`: 선택 UTC ISO 시각(Z, 예: `2026-10-04T15:00:00.000Z`). 발생 시각 기준 `from` 이상, `to` 미만. 둘 중 하나만 지정 가능. 잘못된 시각 또는 from >= to는 400 INVALID_PERIOD. 유형·처리 상태·페이지 커서와 함께 적용된다.
- 웹의 시작일·종료일과 선택 시각은 사용하는 기기의 현지 시간이다. 시각을 비우면 시작일 00:00부터 종료일 다음 날 00:00 미만으로 조회한다. 예: 한국 시간 2026-10-05 하루는 from=`2026-10-04T15:00:00.000Z`, to=`2026-10-05T15:00:00.000Z`다. 시작 시각을 지정하면 해당 분의 00초를 from으로, 종료 시각을 지정하면 해당 분 다음 00초를 to로 보낸다. 예: 한국 시간 2026-10-05 09:00~10:00은 from=`2026-10-05T00:00:00.000Z`, to=`2026-10-05T01:01:00.000Z`다. 종료 시각의 분 전체를 포함하므로 같은 날짜·같은 시각도 1분 구간으로 조회할 수 있다. 시각만 입력하면 해당 날짜를 요구하고 역순 구간은 조회하지 않는다. 기간 변경·초기화 시 커서를 비우고 전체 기간 초기화는 시각도 비운다.
- 발생 시각 내림차순, 같은 시각은 eventId 내림차순.
- 다음 페이지는 받은 nextCursor를 URL 인코딩해서 그대로 cursor에 보낸다. 발생 시각과 ID를 묶은 불투명 커서이며 null이면 마지막 페이지다. 필터 변경 시 cursor를 초기화한다.
- 상세 actions: `{type, actor, createdAt, detail}` 배열. CREATED / ACKNOWLEDGED / RESOLVED 이력.
- ack: 이미 확인·해소된 사건은 추가 기록 없이 `{item, duplicate: true}`. 확인과 해소는 별도다.
- resolve: observed=true와 공백 제거 후 3~1000자 사유 필요. 이미 해소되면 409 ALREADY_RESOLVED.
- 없는 사건은 404 EVENT_NOT_FOUND.

## 설정 적용과 후속 계약

변경 가능한 설정:

| 필드 | 값·기본값 |
|---|---|
| fallAlertEnabled | boolean, 기본 true. 낙상 의심 감지 사용 여부. 기존 API 필드명 유지 |
| sensorFaultAlertEnabled | boolean, 기본 true. 센싱 연결 장애 감지 사용 여부. 기존 API 필드명 유지 |
| gatewayFaultAlertEnabled | boolean, 기본 true. 기기 통신 장애 감지 사용 여부. 기존 API 필드명 유지 |
| lowActivityEnabled | boolean, 기본 false. 장시간 저활동 감지 사용 여부 |
| lowActivityMinutes | 1~1440 정수, 기본 30 |
| lowActivityThreshold | 0~1 유한한 숫자, 기본 0.2 |
| lowActivityMode | ALL_DAY / TIME_RANGE, 기본 ALL_DAY |
| lowActivityStart | 한국 시간 HH:mm, 기본 22:00 |
| lowActivityEnd | 한국 시간 HH:mm, 기본 07:00. 시작과 같은 시각은 거절 |

저활동 기본값은 개발 초기값이며 실제 데이터로 검증한 건강·안전 기준이 아니다. 잘못된 지속 시간·활동 기준은 400 INVALID_LOW_ACTIVITY_SETTINGS다. 잘못된 시간대·시각·동일 시작/종료는 400 INVALID_LOW_ACTIVITY_SCHEDULE다. 부분 수정도 저장된 값과 합친 뒤 검증하며 잘못된 요청은 version을 바꾸지 않는다. 상시로 바꿔도 지정해 둔 시각은 보존한다.

웹은 lowActivityThreshold를 0~10 민감도 눈금 슬라이더로 표시한다. 민감도 S를 움직이면 threshold=S/10으로 저장하며 높을수록 LOW로 판단하는 지표 범위가 넓어진다. 새 조작은 1단위이고 기존의 세밀한 threshold는 슬라이더를 움직이기 전까지 그대로 보존한다. 내부 활동 지표와 API의 threshold는 계속 0~1이다. 예: 민감도 3 → threshold=0.3, 민감도 10 → 모든 유효 활동 지표가 LOW 범위다. 민감도 0은 사용 중지를 뜻하지 않으며 지표 0만 LOW다. 사용 중지는 별도 감지 사용 스위치로 지정한다.

TIME_RANGE는 한국 시간 시작 포함·종료 미포함이며 자정 넘김을 지원한다. 예: 22:00~07:00. 상시면 웹의 시각 입력을 숨긴다. Python은 시간대 밖이나 경계에 걸친 측정 구간을 누적하지 않고, 시간대 종료 시 누적을 초기화한다. 최신 상태·활동 이력·낙상/장애 감지는 저활동 시간대와 별도로 유지한다.

응답에는 고정 timeZone=`Asia/Seoul`도 포함한다. 변경하지 않은 사용 옵션은 유지하며 모든 설정 변경은 같은 version으로 묶어 저장한다. nonReturnMinutes·bedMonitoringEnabled·bedMonitoringMode·bedMonitoringStart·bedMonitoringEnd는 응답에서 제외하고 PATCH 요청 시 400 INVALID_SETTINGS로 거절한다. DB의 기존 값은 삭제하지 않는다. 웹과 Python 게이트웨이는 함께 갱신해야 하며 이전 Python 코드의 기본값으로 미복귀 기능을 재활성화하면 안 된다.

예시 PATCH:

```json
{
  "fallAlertEnabled": true,
  "sensorFaultAlertEnabled": true,
  "gatewayFaultAlertEnabled": true
}
```

GET `/api/status`의 settings도 이 전체 설정과 appliedVersion을 포함한다. 낙상 의심·센싱 연결 장애·기기 통신 장애는 각각 사용 여부로 판단한다. boolean 이외의 값은 400 INVALID_ALERT_OPTIONS로 거절한다. 옵션은 새 감지 사건의 생성 여부를 제어하며, 꺼도 원시 측정·heartbeat·기존 사건 이력은 유지한다. 서버 수신 API는 재전송 시점의 설정으로 이미 발생한 사건을 버리거나 숨기지 않는다.

Python의 `detection_policy.py`는 detection_enabled(type, settings, at)를 제공한다. alert_allowed는 이전 호출자용 호환 함수다. NON_RETURN_WARNING·BED_EXIT는 이전 설정에 관계없이 항상 false다. LOW_ACTIVITY는 lowActivityEnabled가 명시적으로 true이고 at이 지정 시간대 안일 때 허용한다. at은 UTC Z 문자열 또는 시간대가 있는 datetime이며 생략 시 현재 시각이다. 잘못된 시간대 설정은 허용하지 않는다. 새 사건 생성 전 사용 여부를 확인하고, 시간 누적은 LowActivityDetector가 담당한다. GatewayClient.send_detection_event(payload, settings)는 payload.detectedAt으로 정책을 확인해 해제된 유형·시간대 밖이면 HTTP 요청 없이 None을 반환한다. 이미 생성된 사건의 재전송에는 설정을 다시 적용하지 않는 send_event(payload)를 사용한다. 실제 CSI 추론 루프·자동 장애 사건 worker에는 정책을 연결해야 한다. 실제 CSI 루프와 원격 Push는 아직 구현 전이다.

저장 성공 시 서버 version이 증가한다. 실제 Python 게이트웨이는 `/api/gateway/settings`를 주기적으로 조회한 뒤 감지 사용 여부를 적용하고 다음 heartbeat에 appliedSettingsVersion을 보고해야 한다. 조회만 성공했다고 보고하지 않는다. 연결이 살아 있고 appliedVersion과 저장한 version이 같을 때만 웹은 '적용됨'을 표시한다. 나머지는 '적용 확인 중' 또는 '연결 필요'다. 실제 CSI 추론 루프의 설정 적용은 후속 개발이다.

보호자 인증·권한, 실제 CSI 분석과 설정 적용, 원격 Push는 구현 전이다.

## 브라우저 알림 사용 설정

알림 설정의 '이 브라우저 알림'은 서버 API와 별개로 `localStorage`의 `onguard.notifications.enabled`에 저장한다. 미설정 시 기존 동작과 동일하게 켜짐이며, 실제 표시는 브라우저 권한이 허용되어야 가능하다. 같은 브라우저·사이트 주소에서 유지되고 다른 탭의 변경도 반영한다. 사이트 데이터를 삭제하면 기본값으로 돌아간다. 저장소를 읽을 수 없으면 알림 사용을 비활성화하고 저장 불가로 표시한다. 쓰기 실패 시 기존 선택을 유지한다.

끄면 이 브라우저의 표시 확인 알림 요청을 차단하고 준비 중인 요청을 취소한다. 이미 표시했거나 늦게 완료된 같은 시험 알림은 닫기를 요청한다. 감지 설정·사건 기록·브라우저 자체 권한은 변경하지 않는다. 브라우저 권한은 읽기 전용 상태다. [MDN Notification.permission](https://developer.mozilla.org/en-US/docs/Web/API/Notification/permission_static). 원격 Push 구독·서버 전송 제어는 아직 구현 전이며 이 스위치를 원격 수신 차단의 증거로 사용하지 않는다.
