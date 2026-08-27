# Spec: 누솔베르 표준 출고·재고

## Objective

카페24 주문, 시딩, 교환 재발송, 직접 등록을 하나의 출고 화면에서 처리하되 출처와 원주문을 잃지 않는다. 포장·송장 건수와 상품 수량을 분리하고, 택배사·SKU·RMA 기준의 정확한 장부를 만든다.

## Tech Stack

- Node.js CommonJS 내장 HTTP 서버
- Vanilla JavaScript SPA
- JSON 장부 + 원자 교체 저장 + 일별 백업
- Cafe24 Admin API, 우체국 계약소포 API, Google Sheet

## Commands

- Syntax: `node --check server.js && node --check public/app.js`
- Contract tests: `node tests/fulfillment-standard.test.js`
- Local run: `node server.js`
- Manual QA: `http://127.0.0.1:8899/`

## Project Structure

- `server.js`: 동기화, 출고 묶음, 택배사 상태, SKU 재고, RMA, 장부 저장
- `public/app.js`: 출고·배송·재고·교환반품 화면
- `public/style.css`: PC/모바일 레이아웃
- `tests/`: 외부 접수 없이 실행하는 계약 테스트
- `data/`: 운영 장부와 백업(버전 관리 제외)

## Code Style

```js
function fulfillmentKey(type, item) {
  if (item.packGroupId) return 'pack|' + item.packGroupId;
  if (type === 'order' && item.orderNo) return 'order|' + item.orderNo;
  return type + '|' + item.id;
}
```

- 화면 문구는 초보자가 이해할 수 있는 한국어를 우선한다.
- 외부 상태코드는 장부에 보존하고, 화면에는 쉬운 말을 함께 표시한다.
- 데이터 변경은 서버 endpoint에서 수행하고 감사 로그를 남긴다.

## Testing Strategy

- 동일 주문의 2개 품목은 택배 1건·상품 2개인지 계약 테스트한다.
- 다른 주문은 같은 주소여도 기본 2건인지 테스트한다.
- 사용자가 합포장한 뒤에만 1건이 되는지 테스트한다.
- 7일이 지나도 택배사 확인 없이 배송완료가 되지 않는지 테스트한다.
- SKU별 출고·반품 복구와 재고 미매칭 경고를 테스트한다.
- 실제 우체국 접수 버튼은 자동 테스트에서 누르지 않는다.

## Boundaries

- Always: 기존 기록 보존, 서버 검증, 중복 접수 방지, 입출고 로그 기록
- Ask first: 외부 판매채널의 주문·상품 상태 변경, 유료 서비스 추가
- Never: 날짜만으로 배송완료 처리, 이름·주소만으로 자동 합포장, 재고 미매칭 묵살, 비밀키 커밋

## Success Criteria

- 한 주문의 상품 2개는 송장 1개와 상품 2개로 표시된다.
- 다른 주문·시딩·교환은 주소가 같아도 자동으로 합쳐지지 않는다.
- 합포장은 명시적 확인 후 모든 품목에 같은 `packGroupId`가 기록된다.
- 배송완료는 실제 택배사 확인 또는 사용자 확인으로만 바뀐다.
- 모든 주문·시딩·교환·직접등록에 `sourceChannel`이 있다.
- 모든 재고 행과 입출고 로그에 안정적인 `sku`가 있다.
- 교환·반품은 `rmaNo`, 원주문·원송장, 검수 결과, 재고 처리 결과를 보존한다.
- 장부 저장은 임시 파일을 거쳐 원자적으로 교체되고 감사 로그가 남는다.

## Open Questions

- 29CM·무신사 연결 시 각 채널 상품번호와 중앙 SKU 매핑 규칙은 해당 API 연결 단계에서 확정한다.
- 실제 생산 재고를 어느 시스템에서 최초 입력할지는 allin_v4 연동 단계에서 확정한다.
