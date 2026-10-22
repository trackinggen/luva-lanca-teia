# Pague-X — luva

Documentação: https://app.pague-x.com.br/docs

## Configuração

Configure PAGUEX_SECRET_KEY e PAGUEX_WEBHOOK_SECRET como secrets de produção na Vercel e publique novamente. A Public Key não é necessária no Pix processado pelo backend.

Webhook: https://luva-lanca-teia.vercel.app/api/public/pix/webhook

O backend envia postbackUrl por cobrança. De acordo com a documentação, isso dispensa webhook fixo no painel. Se usar o painel, deixe os eventos desmarcados para receber todos.

## Fluxo

O servidor calcula R$17,99 por luva, extras de R$14,99/R$24,99, PAC grátis, Jadlog R$18,47 ou Sedex12 R$33,40. Rejeita taxas de liberação e produtos não cadastrados. Dados reais do comprador e endereço do checkout são enviados à Pague-X.

POST /v1/charges é chamado uma única vez por tentativa. Não há idempotência documentada. Em timeout ou resposta perdida, o checkout interrompe as retentativas: confira o painel antes de gerar nova cobrança.

Cada cobrança tem referência aleatória assinada, sem dados pessoais. A consulta autentica no backend, valida o ID, método, valor e referência da resposta e devolve apenas status/valor/ID ao navegador. O status persistente pertence à Pague-X: não há armazenamento em memória nem banco adicional.

O webhook valida HMAC-SHA256 dos bytes exatos (x-paguex-signature), limita tamanho e reconhece a referência. Responde rapidamente e não tem efeitos financeiros, de entrega ou anúncios. Reenvios são inofensivos. A confirmação visual usa GET /v1/charges/:id; não depende de compartilhar memória com a função do webhook.

Pix pago leva a /pedido-confirmado/. A nova integração não cobra emissão de NF-e ou taxas obrigatórias após a compra. Pix antigos IronPay não são consultados pela API nova e o cache anterior é descartado.

## Rastreamento

Scripts existentes do navegador são preservados. A integração nativa da IronPay com a UTMify deixa de receber novas vendas quando o gateway muda. Esta implementação não adiciona Purchase na Meta/UTMify nem presume integração nativa Pague-X. Isso exige configuração separada e verificação de deduplicação. UTMs continuam no checkout, mas não são enviadas em campos não documentados da API Pague-X.

## Validação

npm test usa fetch simulado. Nenhuma cobrança real nem evento de compra é criado pelos testes. Após publicar, validar com dados reais autorizados no checkout, conferir cobrança no painel, pagar e confirmar navegação/status e webhook assinado.
