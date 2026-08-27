# Capability Map: 누솔베르 표준 출고·재고

| Module id | Responsibility | Depends on |
|---|---|---|
| fulfillment-groups | 주문·시딩·교환별 포장 단위와 명시적 합포장 | — |
| delivery-authority | 택배사 조회값만으로 배송완료 확정 | fulfillment-groups |
| channel-source | 카페24·시딩·교환·직접등록 출처 보존 | fulfillment-groups |
| sku-inventory | 상품+컬러+사이즈 SKU와 입출고 마스터 | channel-source |
| returns-rma | 원출고와 연결된 회수·검수·재고·재발송 | sku-inventory |
| ledger-safety | 원자 저장, 충돌 방지, 감사 로그, 백업 | fulfillment-groups |

Build order: fulfillment-groups → delivery-authority, channel-source → sku-inventory → returns-rma → ledger-safety

## 운영 원칙

- 송장 1개는 포장 1건이다. 상품 수량은 별도로 센다.
- 같은 수령인이라는 이유만으로 서로 다른 주문·시딩·교환을 자동 합포장하지 않는다.
- 한 주문번호의 여러 품목은 기본적으로 한 포장으로 묶는다.
- 서로 다른 출고를 한 비닐에 넣을 때는 사용자가 `[같은 비닐로 묶기]`로 확정한다.
- 배송완료는 택배사 조회 결과만 사용한다. 날짜 경과로 완료시키지 않는다.
- 재고의 최소 단위는 SKU(상품+컬러+사이즈)다.
- 교환·반품은 원출고와 연결된 별도 RMA 기록으로 관리한다.
- 여러 PC는 클라우드 서버의 한 장부를 사용하고 모든 재고 변동을 기록한다.
