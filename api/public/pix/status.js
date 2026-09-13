const IRONPAY_BASE = 'https://api.ironpayapp.com.br/api/public/v1';

function normalizeStatus(data) {
  return String(
    data?.payment_status || data?.status || data?.data?.payment_status || data?.data?.status || 'pending'
  ).toLowerCase();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const token = process.env.IRONPAY_API_TOKEN;
  const ids = String(req.query.id || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!token) {
    return res.status(503).json({
      code: 'payment_gateway_not_configured',
      error: 'O pagamento ainda não está configurado.'
    });
  }

  if (!ids.length) {
    return res.status(400).json({ error: 'transaction_id_required' });
  }

  try {
    const responses = await Promise.all(ids.map(async (id) => {
      const upstream = await fetch(
        IRONPAY_BASE + '/transactions/' + encodeURIComponent(id) + '?api_token=' + encodeURIComponent(token),
        { headers: { Accept: 'application/json' } }
      );
      const data = await upstream.json().catch(() => null);
      return { id, upstream, data, status: normalizeStatus(data) };
    }));

    const result = responses.find((item) => item.status === 'paid') || responses[0];
    if (!result.upstream.ok) {
      return res.status(result.upstream.status).json({
        code: 'ironpay_status_failed',
        error: result.data?.message || result.data?.error || 'Não foi possível consultar o pagamento.'
      });
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      status: result.status,
      transactionId: result.data?.hash || result.data?.data?.hash || result.id,
      paidAt: result.data?.paid_at || result.data?.data?.paid_at || null
    });
  } catch {
    return res.status(502).json({
      code: 'ironpay_unavailable',
      error: 'Não foi possível consultar o gateway de pagamento.'
    });
  }
}
