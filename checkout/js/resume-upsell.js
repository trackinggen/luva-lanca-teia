/**
 * Recuperação de funil (checkout + upsells).
 *
 * Quem paga o PIX no app do banco e fecha a aba nunca é redirecionado, porque
 * o polling da página morre junto com ela. Este script roda em todas as etapas
 * do funil: se existir um PIX recente ainda não marcado como pago, consulta o
 * status — na hora e depois periodicamente enquanto a aba estiver aberta — e,
 * se o backend confirmar o pagamento, manda o usuário para a etapa seguinte
 * registrada quando o PIX foi gerado (checkout -> /upsell1, upsell1 ->
 * /upsell2, e assim por diante), sem depender de ele recarregar a página.
 */
(function () {
  try {
    var txId = localStorage.getItem("lastPixTx");
    if (!txId) return;
    if (localStorage.getItem("pixPaid_" + txId)) return;

    // Só tenta recuperar pagamentos das últimas 6 horas.
    var stamp = parseInt(localStorage.getItem("lastPixTxAt") || "0", 10) || 0;
    if (stamp && Date.now() - stamp > 6 * 60 * 60 * 1000) return;

    var next = localStorage.getItem("lvPixNext") || "/upsell1";
    if (!/^\/[A-Za-z0-9/_-]*$/.test(next)) next = "/upsell1";

    // Evita loop caso o usuário já esteja na etapa de destino.
    var path = (window.top && window.top.location ? window.top.location.pathname : location.pathname) || "";
    path = path.replace(/\.html$/, "").replace(/\/$/, "") || "/";
    if (path === next) return;

    var done = false;
    function goNext() {
      if (done) return;
      done = true;
      // O Purchase já é disparado pelo servidor (CAPI) na confirmação do
      // webhook; aqui só recuperamos a navegação.
      try {
        localStorage.setItem("pixPaid_" + txId, "1");
        localStorage.removeItem("lv_pix_cache");
      } catch (e) {}
      try {
        var payload = { txId: txId, status: "paid", to: next, ts: Date.now(), resumed: true };
        navigator.sendBeacon &&
          navigator.sendBeacon(
            "/api/public/analytics/upsell-redirect",
            new Blob([JSON.stringify(payload)], { type: "application/json" }),
          );
      } catch (e) {}
      if (window.lvGo) window.lvGo(next);
      else window.top.location.href = next;
    }

    function check() {
      if (done) return;
      fetch("/api/public/pix/status?id=" + encodeURIComponent(txId), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          if (j && j.status === "paid") goNext();
        })
        .catch(function () {});
    }

    // Checa na hora e continua re-checando enquanto a aba estiver aberta:
    // se o PIX for pago com o usuário em qualquer página do funil, ele é
    // redirecionado automaticamente sem precisar recarregar.
    check();
    var timer = setInterval(function () {
      if (done) { clearInterval(timer); return; }
      if (document.visibilityState === "visible") check();
    }, 15000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") check();
    });
    window.addEventListener("focus", check);
  } catch (e) {}
})();
