# Pague-X e UTMify — luva

## Configuração

API: https://pay.pague-x.com.br/v1 (base mostrada no painel, com rota /v1 confirmada por consulta sem cobrança). A base pública https://api.pague-x.com.br/v1 também respondeu à consulta. Documentação: https://app.pague-x.com.br/docs

Configure os secrets de produção PAGUEX_SECRET_KEY, PAGUEX_WEBHOOK_SECRET, UTMIFY_API_TOKEN e UTMIFY_STATE_SECRET na Vercel. O último é uma chave aleatória gerada pelo servidor, exclusiva para criptografar o contexto de atribuição. Não o rotacione enquanto existirem cobranças pendentes que o utilizam. Public Key não é necessária para Pix no backend.

## Fluxo sem Redis

1. O servidor valida produto, dados do pagador, quantidade, frete e adicionais e calcula o total em centavos.
2. Prepara um contexto AES-256-GCM com referência, valor, produtos, data e UTMs. Esse contexto não contém nome, telefone, e-mail, CPF ou endereço do cliente.
3. Envia postbackUrl por cobrança com o contexto criptografado no parâmetro state. O callback é HTTPS público, possui barra final e tem menos de 2048 caracteres. Contextos acima do limite são recusados antes de criar cobrança.
4. Cria um único Pix e envia o pedido waiting_payment à UTMify usando o ID retornado pela Pague-X. Falha de analytics não esconde o Pix nem repete a criação.
5. A Pague-X notifica o webhook com os dados do comprador. O servidor valida HMAC-SHA256 dos bytes exatos, autentica o contexto e confere referência e valor. Consulta o estado atual na API Pague-X antes de enviar paid, para impedir aprovação falsa ou regressão por callback antigo.
6. Atualiza o mesmo orderId na UTMify com as UTMs originais e o novo status. Não cria outro pedido nem dispara um Purchase Meta próprio no navegador.

O CPF não é enviado à UTMify. Os campos do comprador enviados são nome, e-mail, telefone e país. Os dados vêm do checkout validado ou da Pague-X autenticada. O navegador guarda somente o contexto criptografado de produtos/UTMs para permitir nova tentativa nas consultas de status; callbacks funcionam mesmo se o cliente fechar a página. O contexto é aceito por até 30 dias.

O backend não usa Redis, banco adicional, fila persistente ou agendamento. Se a UTMify falhar durante o webhook, responde 502. A documentação não garante uma política de reenvio da Pague-X; portanto, sem fila durável não há garantia de entrega durante indisponibilidade prolongada. Com a página aberta, as consultas tentam o envio usando a cobrança existente, sem gerar outro Pix.

O backend usa os estados autenticados pending/paid/refused/refunded/chargeback/canceled/expired. Estados intermediários não suportados pela UTMify não são convertidos em paid. A atualização usa sempre o ID real da cobrança; a UTMify centraliza o pedido e o envio para a Meta. Na UTMify, configure Purchase somente para vendas aprovadas e evite integração independente duplicada com a Meta.

O valor enviado é o bruto cobrado, incluindo os adicionais e frete. Como as taxas não são documentadas na resposta usada, gatewayFeeInCents é zero e userCommissionInCents recebe o bruto; essa integração não calcula lucro líquido após taxas.

## Preços e confirmação

Luva R$17,99 por unidade; extras R$14,99 e R$24,99; PAC grátis, Jadlog R$18,47, Sedex12 R$33,40. O servidor rejeita produtos não cadastrados e taxas de liberação. Os dados reais do comprador e endereço são enviados à Pague-X.

Cada POST /v1/charges gera uma nova cobrança. Não existem retentativas automáticas. Em timeout ou resposta perdida, confira o painel antes de criar outra. Os metadados ausentes são consultados com GET, nunca com outro POST.

Referências lv2 usam HMAC-SHA256 completo em base64url para caber no limite observado de 80 caracteres. Assinaturas cortadas são rejeitadas. O sufixo UUID não dispensa a validação da assinatura. Pix pago abre /pedido-confirmado/, sem taxas obrigatórias posteriores. O cache de Pix IronPay foi desativado na migração.

## Validação

npm test usa respostas de gateway e UTMify simuladas. Não cria cobranças ou compras fictícias. Após publicação, a validação real exige gerar Pix no checkout, verificar waiting_payment na UTMify, pagar e verificar paid no mesmo pedido. Eventos na Meta dependem da configuração do pixel conectado na UTMify.
