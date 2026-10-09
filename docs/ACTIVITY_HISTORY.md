# 활동 이력 저장·조회 개발 안내

구현일: 2026-10-08. 실제 CSI 수집 루프를 연결하기 전에도 저장·조회 계약을 검증할 수 있는 기능이다. 생성 시험 신호로 실제 관측 이력을 채우지 않는다.

## 1. 연결 흐름

```text
로컬 수집기 → POST /api/ingest/status (토큰 필요)
            → 최신 gateways 갱신 + activity_history 추가 (한 트랜잭션)
보호자 웹   → GET /api/status (현재 상태)
            → GET /api/activity/history (과거 측정·공백)
```

- 실제 활동의 계산·측정 구간·모델/보정 버전은 수집기가 보낸다. 서버는 CSI에서 활동값을 계산하지 않는다.
- 실제 수집기는 isDemo=false를 명시해야 한다. 시험 도구는 계속 true를 사용한다. 출처가 없으면 기존 상태 계약의 호환 처리만 하고 이력은 기록하지 않는다.
- 한 gatewayId의 generation은 재시작마다 증가하고 sequence는 같은 세대에서 증가한다.
- 이전·같은 순번은 409다. 동일 heartbeat를 새 순번으로 보내더라도 같은 측정 시각을 새 활동으로 세지 않는다.
- 사건 전송은 이력을 만들거나 연결을 갱신하지 않는다.
- 서버 시작 시 필요한 테이블·열·인덱스를 추가한다. 과거 사건/설정/최신 상태를 이력으로 복제하거나 삭제하지 않는다.

## 2. 유효한 측정과 공백

유효 측정은 AVAILABLE 품질·sensorAvailable=true·0~1 활동 지표·양의 15초 이하 구간·모델/보정 버전이 필요하다. 수신 시 측정 시각이 15초 이내이고 미래 오차가 5초 이하이며 동일 세대의 이전 유효 측정보다 새로워야 한다.

| reason | 저장 의미 |
|---|---|
| null | 유효한 활동 측정. score=0도 보존 |
| NO_ACTIVITY | 활동 객체 없이 받은 heartbeat |
| SENSING_UNAVAILABLE | 센서 사용 불가 또는 AVAILABLE이 아닌 품질 |
| STALE_MEASUREMENT | 수신 기준 15초 초과·미래 오차 5초 초과 |
| REPEATED_MEASUREMENT | 동일 세대에서 이미 기록한 측정 시각 이하 |

- 공백의 score는 null이다. 센싱 중단을 저활동이나 0으로 바꾸지 않는다.
- 유효 측정 sampledAt은 measuredAt, 공백 sampledAt은 receivedAt이다. 원래 measuredAt은 별도로 남긴다.
- 순번이 바뀌어도 마지막 유효 측정 시각을 유지한다. 활동 누락 뒤 이전 구간을 다시 보내도 중복 측정이다.
- 잘못된 미래 시각이나 관측 불가 입력은 마지막 유효 측정 시각을 앞으로 밀지 않는다. 이후 정상 관측을 계속 받을 수 있다.
- 요청 자체의 malformed activity는 기존처럼 400이다. 거절된 입력을 공백 heartbeat로 저장하지 않는다.
- heartbeat 자체가 없는 시간에는 행이 생성되지 않는다. 그래프도 그 시간을 채우지 않는다.

## 3. PostgreSQL 구조와 실패 처리

activity_history의 기본 키는 `(gateway_id, generation, sequence)`다. gateway_id 외래 키와 `(gateway_id, sampled_at DESC, generation DESC, sequence DESC)` 조회 인덱스가 있다.

보관 열: gateway_id, generation, sequence, sampled_at, measured_at, received_at, window_started_at, score, quality_status, model_version, calibration_version, reason.

gateways의 activity_watermark_at은 같은 세대의 마지막 유효 측정 시각이다. 저장 시 gateway 행을 잠가 동시에 도착한 같은 순번 요청 중 한 개만 처리한다. 최신 상태와 이력을 같은 트랜잭션으로 저장하므로 이력 INSERT가 실패하면 상태·순번 갱신도 롤백한다. 송신자는 실패한 순번을 다시 시도할 수 있다. 내구성 있는 재시도 worker는 아직 별도 후속 작업이다.

자동 보관 기간/삭제 작업은 구현하지 않았다. 7일은 한 번의 조회 기간 제한이며 DB 보관 기간이 아니다. 실제 운영 전에 수집 주기·용량·보관 요구를 정하고 정리 정책을 구현해야 한다.

## 4. API 호출

기본 최근 1시간:

```http
GET /api/activity/history
```

기기와 기간 지정:

```http
GET /api/activity/history?gatewayId=room-01&from=2026-10-08T00%3A00%3A00.000Z&to=2026-10-08T01%3A00%3A00.000Z&limit=500
```

응답은 `{gatewayId, from, to, items, nextCursor}`다. items는 최신순이며 측정 구간과 공백이 함께 포함된다. 항목 필드는 DB 계약의 camelCase 이름이며 gatewayId는 응답 최상위에 있다.

- from 포함·to 미포함. UTC Z 시각만 허용한다. 범위는 0초 초과·7일 이하.
- 기본 limit=500, 최대 1000. 다음 페이지가 있을 때만 nextCursor가 생긴다.
- 다음 페이지는 nextCursor를 URL 인코딩해 cursor에 넣는다. 커서는 원래 기기·기간에 고정된다. 변경한 조건과 섞으면 400이다.
- 같은 시각의 여러 항목도 generation·sequence로 순서를 구분한다.
- 기본 기기는 최신 실제 heartbeat 기기다. 페이지 이동 도중 다른 기기가 신호를 보내도 기존 페이지는 원래 기기를 유지한다.
- 기록이 없는 기기는 빈 items다. 조회 실패는 오류 응답이며 빈 기록으로 바꾸지 않는다.

## 5. 모바일 화면

- 홈의 활동 추이: 최근 1·6·24시간, 접힌 날짜·시각 직접 지정, 새로고침.
- 날짜는 브라우저 현지 시간이다. 종료 시각을 지정하면 해당 분을 포함하고, 비우면 종료일 전체를 포함한다. 최대 7일이다.
- SVG는 각 유효 측정 구간을 별도 선분으로 그린다. 공백·모델/보정 변경 사이를 연결하는 보간선을 만들지 않는다. 평균·보정값을 새로 계산하지 않는다.
- 500개씩 이전 기록을 불러온다. 아직 이전 페이지가 남으면 그래프 시작은 불러온 구간으로 제한하고 '이전 기록이 더 있어요'를 표시한다. 전체 선택 기간은 위에 따로 표시한다.
- 모바일 메모리 사용을 제한하기 위해 한 번에 최대 5000개를 표시한다. 그 이상은 기간을 좁혀 조회한다.
- 최근 조회 기록 목록은 최신 20개이며, 활동값과 공백 사유를 텍스트로 확인할 수 있다.
- 최근 기간은 홈이 보일 때 30초마다 갱신한다. 직접 지정 기간·여러 페이지를 조회 중이면 자동으로 초기화하지 않는다. 현재 상태는 기존 5초 주기를 유지한다.
- 기간 변경 후 늦게 온 응답은 무시한다. 새 조회 실패 시 이전 그래프를 숨기며, 이전 페이지 추가 실패는 기존 기록을 유지하고 재시도를 허용한다.

## 6. 검증 및 남은 연결

`npm.cmd test`: JavaScript 57개. 이력 입력·엄격한 기간·커서 범위와 기존 화면을 확인한다. UI 검증은 DOM에서 기간 전환·현지 시각·공백 표시·유효한 0·페이지 재시도·늦은 응답과 민감도/감지 시간대 편집을 확인한다.

`npm.cmd run test:integration`: 별도 임시 PostgreSQL 스키마에서 실제 Express 요청으로 저장·조회·경계·동시 재전송·저장 실패 롤백을 확인한다. 임시 스키마만 종료 시 정리하며 프로젝트 DB의 실제 신호나 이력을 만들지 않는다.

현재 연결 가능한 브라우저가 없어 실제 모바일 레이아웃·터치 조작은 미검증이다. 실제 ESP32 CSI 수집·활동값 산출·낙상 모델·수집 루프는 별도 연결해야 한다. 생성 데이터 테스트 통과를 CSI 감지 성능으로 해석하지 않는다.

관련 코드: [저장/조회 API](../src/server.js), [DB](../src/db.js), [이력 검증](../src/activity-history.js), [추이 화면](../public/activity-history.js), [활동 판단 안내](./ACTIVITY_DETECTION.md).
