/**
 * Captura e persiste os parâmetros de rastreamento (UTMs + click ids).
 * Grava no primeiro acesso (localStorage) e reaproveita em todo o funil,
 * para que toda cobrança BravoPay envie a origem da venda (UTMify/Pixel).
 */
(function () {
  var KEY = "lv_utm";
  var FIELDS = [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "xcod",
    "src",
    "sck",
    "fbclid",
    "ttclid",
    "gclid",
  ];

  function readStored() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function capture() {
    var stored = readStored();
    var params = new URLSearchParams(window.location.search);
    var changed = false;
    FIELDS.forEach(function (f) {
      var v = params.get(f);
      if (v) {
        stored[f] = v;
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem(KEY, JSON.stringify(stored));
      } catch (e) {}
    }
    return stored;
  }

  var data = capture();

  // Formato esperado pela API BravoPay (campo "utm" do POST /transactions)
  window.getUTMs = function () {
    var d = readStored();
    return {
      source: d.utm_source || "",
      medium: d.utm_medium || "",
      campaign: d.utm_campaign || "",
      content: d.utm_content || "",
      term: d.utm_term || "",
      xcod: d.xcod || "",
      src: d.src || "",
      sck: d.sck || "",
      fbclid: d.fbclid || "",
      ttclid: d.ttclid || "",
      gclid: d.gclid || "",
    };
  };
})();
