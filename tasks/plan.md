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
