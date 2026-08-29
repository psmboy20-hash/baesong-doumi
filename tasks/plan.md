# Implementation Plan: 표준 출고·재고 1차 적용

## Overview

현재 기능을 유지하면서 잘못된 자동 합포장·날짜 배송완료·상품명 재고 매칭을 단계적으로 표준화한다. 각 단계는 독립적으로 검증하고 운영 데이터는 마이그레이션 함수로 보강한다.

## Architecture Decisions

- `fulfillmentKey`를 서버와 화면의 유일한 포장 기준으로 사용한다.
- 같은 주문번호만 자동 묶고 다른 출고는 `packGroupId`가 있을 때만 합친다.
- `sourceChannel`, `sku`, `rmaNo`를 장부에 영구 보존한다.
- JSON 장부는 원자 교체 저장과 감사 로그로 1차 강화한다. 관계형 DB 전환은 별도 마이그레이션으로 분리한다.

## Task List

### Phase 1: 출고 기준
- Task 1: 출고 포장 키와 합포장 endpoint/UI
- Task 2: 날짜 배송완료 제거와 확인필요 상태

### Checkpoint
- 같은 주문 2품목=1건, 다른 주문=2건, 명시적 합포장=1건

### Phase 2: 마스터
- Task 3: 출처 필드 마이그레이션과 대시보드 반영
- Task 4: SKU 생성·재고 우선 매칭·미매칭 경고
- Task 5: RMA 번호·원출고·검수 상태 연결

### Checkpoint
- 출고·재고·교환반품 계약 테스트 통과

### Phase 3: 안전성과 화면
- Task 6: 원자 저장·감사 로그
- Task 7: PC/모바일 실화면 검수와 배포

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 기존 수령인 묶음이 갈라짐 | 중 | 같은 주문번호는 그대로 묶고 합포장 추천 버튼 제공 |
| 과거 재고에 SKU 없음 | 중 | load 시 결정적 SKU를 자동 보강 |
| 택배사 조회 실패 | 중 | 배송중 유지 + 확인필요 표시, 완료로 추정하지 않음 |
| 장부 저장 중 장애 | 높음 | 임시 파일 fsync 후 rename, 일별 백업 유지 |

## Open Questions

- 29CM·무신사 API 연결은 이번 1차 적용 범위 밖이며 중앙 SKU 계약만 준비한다.

---

# Implementation Plan: 운영 안전성 강화 1차

## Overview

운영 중단 없이 가장 큰 사고 원인부터 얇은 단계로 보강한다. 검증 전에는 `main`과 클라우드 서버에 배포하지 않는다.

## Architecture Decisions

- 우체국 접수는 외부 호출 전에 `shipmentOp`를 저장하고 조회 복구를 우선한다.
- 라벨은 선택한 첫 행이 아니라 동일 송장의 모든 품목을 확장한다.
- 엑셀 예비 접수는 서버 폴더가 아니라 HTTP 다운로드로 제공한다.
- HTTPS는 역방향 프록시를 전제로 앱이 보안 헤더와 `Secure` 쿠키를 올바르게 처리한다.
- 재고 미확정 55개는 임의 수량을 채우지 않고 `실사 필요`로 유지한다.

## Task List

### Phase 1: 즉시 사고 방지
- Task 8: 요청 크기·파일 형식 제한과 보안 헤더
- Task 9: 우체국 접수 작업 선저장·복구

### Checkpoint: 외부 호출 안전성
- 신규 계약 테스트와 전체 테스트 통과
- 동일 포장 재호출이 우체국 신규 접수를 만들지 않음

### Phase 2: 송장과 예비 동선
- Task 10: 다상품 라벨·가상번호·인쇄확인
- Task 11: 클라우드 엑셀 직접 다운로드

### Checkpoint: 출고 화면
- 다상품 fixture 한 장 출력 확인
- 브라우저 다운로드와 모바일/PC 핵심 동선 확인

### Phase 3: 채널 대사
- Task 12: Cafe24 품목별 송장과 실패 재시도
- Task 13: 발송취소·시딩 웹훅 미확인 대사 화면

### Phase 4: 인프라
- Task 14: HTTPS 프록시와 공개 주소 전환
- Task 15: 서버 밖 백업·상태 알림·복구훈련
- Task 16: 안전한 XLSX 라이브러리 교체 검토와 적용

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| 우체국 성공 후 응답 불명 | 중복 택배 | pending 저장 후 GetResInfo 조회, 자동 재접수 금지 |
| 라벨 제품 과다 | 내용 잘림 | 상품별 줄·수량 축약, 피킹리스트 병행 |
| Cafe24 부분배송 | 다른 품목 오배송처리 | 선택한 order_item_code만 전송 |
| HTTPS 전환 실패 | 전 PC 접속 중단 | 기존 8899 유지 상태에서 새 주소 검증 후 전환 |
| 백업 복원 불일치 | 우체국 상태 역행 | 복원 후 우체국·Cafe24 대사 필수 |

## Open Questions

- 도메인과 Google 비공개 인증은 코드 단계 완료 후 사용자 계정 작업이 필요한 시점에 별도 안내한다.
