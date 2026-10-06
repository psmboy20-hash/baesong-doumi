/* 출고·배송 확인·내려받기에서 같이 쓰는 배송 단계. 저장된 상태값은 바꾸지 않는다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.shippingStage = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return function shippingStage(item) {
    const x = item || {};
    const stage = (key, label, kind) => ({ key, label, kind: kind || 'stage-' + key });
    if (x.delivered === true) return stage('done', '배송완료');
    const stus = x.epost && String(x.epost.stus || '01');
    if (x.status === '취소됨' || stus === '05') return stage('canceled', '취소됨', 'idle');
    if (stus === '04') return stage('problem', '수거 안 됨 · 확인', 'bad');
    if (stus && !['00', '01', '02', '03'].includes(stus)) return stage('unknown', '확인 필요', 'processing');
    // 우체국 건은 수거(03)로만 배송중 — 택배 조회의 '배송중'은 "조회됨·미완료"라 접수 직후에도 붙는다
    if (stus === '03' || (!x.epost && x.deliveryCheckStatus === '배송중')) return stage('moving', '배송중');
    const postal = !!x.epost || /우체국|epost/i.test(String(x.courier || ''));
    if (postal && x.printed === true) return stage('pickup', '우체국 픽업 대기');
    if (x.epost || (postal && x.invoice) || x.status === '접수중') return stage('ready', '배송준비');
    if (x.status === '발송완료' && x.invoice) return stage('moving', '배송중');
    if (x.status === '대기') return stage('before', '접수 전', 'idle');
    return stage('unknown', '확인 필요', 'processing');
  };
});
