const IRONPAY_BASE = 'https://api.ironpayapp.com.br/api/public/v1';

function digits(value) {
  return String(value || '').replace(/\D/g, '');
}

function cents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function envKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const token = process.env.IRONPAY_API_TOKEN;
  const body = req.body || {};
  const product = Array.isArray(body.products) ? body.products[0] || {} : {};
  const productKey = envKey(product.name || 'DEFAULT');
  const offerHash = process.env['IRONPAY_OFFER_' + productKey] || process.env.IRONPAY_OFFER_HASH;
  const productHash = process.env['IRONPAY_PRODUCT_' + productKey] || process.env.IRONPAY_PRODUCT_HASH;
  const amount = cents(body.amount);
  const client = body.client || {};
  const shipping = body.shipping || {};

  if (!token || !offerHash || !productHash) {
    return res.status(503).json({
      code: 'payment_gateway_not_configured',
      error: 'O pagamento ainda não está configurado.'
    });
  }

  if (!amount || !client.name || !client.email || !digits(client.document) || !digits(client.phone)) {
    return res.status(400).json({
      code: 'invalid_payment_data',
      error: 'Preencha os dados obrigatórios para gerar o PIX.'
    });
  }

  const transaction = {
    amount,
    offer_hash: offerHash,
    payment_method: 'pix',
    customer: {
      name: String(client.name).trim(),
      email: String(client.email).trim(),
      phone_number: digits(client.phone),
      document: digits(client.document),
      street_name: String(shipping.logradouro || '').trim(),
      number: String(shipping.numero || '').trim(),
      complement: String(shipping.complemento || '').trim(),
      neighborhood: String(shipping.bairro || '').trim(),
      city: String(shipping.cidade || '').trim(),
      state: String(shipping.uf || '').trim().toUpperCase(),
      zip_code: digits(shipping.cep)
    },
    cart: [{
      product_hash: productHash,
      title: String(product.name || process.env.IRONPAY_PRODUCT_TITLE || 'Produto'),
      cover: null,
      price: amount,
      quantity: Math.max(1, Number(product.quantity) || 1),
      operation_type: 1,
      tangible: true
    }],
    installments: 1,
    expire_in_days: 1,
    transaction_origin: 'api',
    tracking: body.utm || {}
  };

  try {
    const upstream = await fetch(
      IRONPAY_BASE + '/transactions?api_token=' + encodeURIComponent(token),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(transaction)
      }
    );
    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        code: 'ironpay_transaction_failed',
        error: data?.message || data?.error || 'Não foi possível criar a cobrança PIX.'
      });
    }

    const copyPaste = data?.pix?.pix_qr_code;
    const transactionId = data?.hash || data?.data?.hash;
    if (!copyPaste || !transactionId) {
      return res.status(502).json({
        code: 'ironpay_invalid_response',
        error: 'A IronPay não retornou os dados do PIX.'
      });
    }

    return res.status(201).json({
      copyPaste,
      qrCode: data?.pix?.pix_url || '',
      transactionId,
      gatewayTransactionId: transactionId,
      orderId: String(data?.id || data?.transaction || transactionId)
    });
  } catch {
    return res.status(502).json({
      code: 'ironpay_unavailable',
      error: 'Não foi possível conectar ao gateway de pagamento.'
    });
  }
}
