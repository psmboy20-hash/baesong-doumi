# Spec: 배송 도우미 운영 안전성 강화

## Objective

카페24 주문·구글 시딩을 우체국에 접수하는 현재 흐름을 유지하면서, 통신 장애·중복 클릭·서버 재시작·다상품 포장에서도 송장과 재고가 한 번만 처리되게 한다. 클라우드에서 모든 PC가 쓰는 운영 도구인 만큼 개인정보 전송, 엑셀 업로드, 백업과 인쇄 상태를 실제 운영 기준으로 강화한다.

## Tech Stack

- Node.js CommonJS 내장 HTTP 서버
- Vanilla JavaScript SPA
- JSON 장부 + 원자 저장 + 감사 로그
- Cafe24 Admin API, 우체국 계약소포 API, Google Sheet
- XLSX 런타임은 공식 SheetJS CE `0.20.3` tarball을 사용한다.

## Commands

- Focused tests: `node --test tests/hardening.test.js`
- Full tests: `npm test`
- Syntax: `node --check server.js && node --check public/app.js && node --check public/item-lines.js`
- Dependency audit: `npm audit --omit=dev`
- Local run: `node server.js`

## Project Structure

- `server.js`: 요청 경계, 우체국 접수 작업, 카페24·시트 후처리, 엑셀 다운로드
- `lib/operations.js`: 포장·상품·작업키의 순수 로직
- `lib/security.js`: 응답 마스킹·접근 범위·보안 헤더 보조 로직
- `public/item-lines.js`: 브라우저와 테스트가 함께 쓰는 포장·라벨 표시 로직
- `public/app.js`, `public/label.html`: 사용자 동선과 인쇄 확인
- `tests/hardening.test.js`: 장애·중복·라벨·업로드 계약 테스트

## Code Style

```js
function shipmentOperationKey(group) {
  return group.items.map(({ type, item }) => `${type}:${item.id}`).sort().join('|');
}
```

- 외부 호출 전 장부에 작업 상태를 먼저 저장한다.
- 결과가 불분명하면 재호출하지 않고 조회로 복구한다.
- 화면에는 기술 코드보다 사용자가 해야 할 다음 행동을 표시한다.

## Testing Strategy

- 순수 로직은 Node 단위 테스트로 RED → GREEN 순서로 구현한다.
- HTTP 업로드 제한과 다운로드 헤더는 로컬 통합 테스트로 검증한다.
- 실제 Cafe24·우체국 접수는 자동 테스트에서 생성하지 않는다.
- 라벨은 다상품 fixture로 전체 상품이 한 장에 들어가는지 확인하고, 실제 프린터는 배포 전 수동 검증한다.
- 배포 전 전체 130개 이상의 기존 테스트와 새 테스트를 모두 통과시킨다.

## Boundaries

- Always: 운영 장부 보존, 외부 호출 전 작업 저장, 입력 크기 제한, 비밀값 응답 제외, 실패 시 중복보다 보류 선택
- Ask first: 새 유료 서비스, 도메인 구매, Google 인증 계정 추가, Cafe24 결제·환불 변경
- Never: 실제 주문으로 자동 테스트, 실패한 접수를 추측 성공 처리, 재고 미확정 수량 생성, 비밀키 커밋

## Success Criteria

- 우체국 응답 직후 서버가 중단돼도 같은 포장이 두 번 접수되지 않는다.
- 한 송장에 포함된 모든 상품·옵션·수량이 라벨 한 장에 표시된다.
- 인쇄 창을 열기만 해서는 `인쇄함`이 되지 않고 사용자가 완료해야 기록된다.
- 가상번호가 없으면 가상번호 안내문을 인쇄하지 않는다.
- 클라우드 서버에서도 우체국 엑셀을 사용자 PC로 직접 다운로드한다.
- Cafe24 송장은 실제 출고 품목 코드만 사용하고 실패한 후처리는 대사 후 재시도한다.
- 업로드 용량 초과는 413으로 차단하고 잘못된 파일은 XLSX 파서에 전달하지 않는다.
- HTTPS 뒤에서는 `Secure` 쿠키와 보안 헤더가 적용된다.
- 백업은 서버 밖에 한 벌 이상 보관되고 복구 절차가 검증된다.
- 우체국 취소 도중 서버가 중단돼도 재시작 후 취소 상태·재고·외부 장부를 이어서 맞춘다.
- 외부 서비스가 응답하지 않으면 정해진 시간 안에 끊고 홈에 재처리 상태를 남긴다.
- 복구된 우체국 송장은 인쇄 데이터가 없어도 사이트 출력 완료를 장부에 기록할 수 있다.
- 클라우드 업데이트가 의존성 설치나 재시작에서 실패하면 다음 실행에서 같은 버전을 다시 배포한다.

## Open Questions

- HTTPS 공개 주소는 기존 도메인 또는 별도 서브도메인을 연결해야 한다.
- 비공개 Google Sheet 읽기는 서비스 계정 또는 사용자 OAuth 중 운영 계정에 맞는 방식을 선택해야 한다.
- Cafe24 배송취소 API가 현재 앱 권한과 주문 상태에서 허용되는지는 공식 API와 실주문 전 테스트로 확인한다.
