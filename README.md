# BellaMix Cosméticos — versão pronta para produção

Esta versão inclui:
- catálogo e busca;
- carrinho;
- checkout com dados de entrega;
- pedidos persistidos em SQLite;
- painel administrativo em `/admin`;
- controle de estoque;
- Mercado Pago Checkout Pro;
- retorno do pagamento;
- webhook para atualizar o pedido após o pagamento;
- Pix/cartão/outros meios que a conta Mercado Pago disponibilizar.

## 1. Requisitos
Node.js 18+ e HTTPS no domínio em produção. O SDK oficial do Mercado Pago para Node exige Node 18+.

## 2. Instalação
```bash
npm install
cp .env.example .env
```

Gere o hash da senha do administrador:
```bash
node -e "console.log(require('bcryptjs').hashSync('SUA_SENHA_FORTE', 12))"
```
Cole o resultado em `ADMIN_PASSWORD_HASH`.

Preencha no `.env`:
- `BASE_URL` com o endereço público HTTPS da loja;
- `ADMIN_EMAIL`;
- `ADMIN_PASSWORD_HASH`;
- `SESSION_SECRET`;
- `MERCADOPAGO_ACCESS_TOKEN`;
- `STORE_WHATSAPP`.

Depois:
```bash
npm start
```

Abra:
- Loja: `https://SEU-DOMINIO.com.br`
- Painel: `https://SEU-DOMINIO.com.br/admin`

## 3. Mercado Pago
Crie/tenha uma conta vendedora e uma aplicação no Mercado Pago. Copie o Access Token de produção para `MERCADOPAGO_ACCESS_TOKEN`.

O backend cria uma `preference` por pedido, com `external_reference` igual ao ID interno do pedido, e envia o cliente ao Checkout Pro. O webhook `/api/payments/webhook` consulta o pagamento e atualiza o pedido.

O `notification_url` precisa ser público e HTTPS em produção.

## 4. Antes de anunciar a loja
- coloque fotos reais e preços reais no painel;
- configure política de troca/devolução e privacidade;
- configure frete real ou integração com transportadora;
- configure domínio + HTTPS;
- teste primeiro com credenciais de teste do Mercado Pago;
- só depois troque para produção;
- confirme os dados fiscais/empresariais necessários para sua operação.

## 5. Segurança
Nunca coloque `MERCADOPAGO_ACCESS_TOKEN` no HTML ou JavaScript do navegador. Ele fica somente no `.env` do servidor.

## 6. Painel administrativo configurado
O painel agora inclui:
- visão geral com faturamento, pedidos em andamento e alerta de estoque baixo;
- cadastro e edição de produtos;
- ativação/desativação de produtos;
- busca e filtro de catálogo;
- acompanhamento e alteração do status dos pedidos;
- autenticação por sessão e senha com bcrypt;
- validação opcional da assinatura `x-signature` do Webhook do Mercado Pago quando `MERCADOPAGO_WEBHOOK_SECRET` estiver configurado.

### Configurar o acesso do administrador
1. Defina `ADMIN_EMAIL` no `.env`.
2. Gere a senha com:
```bash
./scripts_setup_admin.sh "SUA_SENHA_FORTE"
```
3. Copie o hash exibido para `ADMIN_PASSWORD_HASH`.
4. Defina uma `SESSION_SECRET` longa e aleatória.
5. Reinicie a loja e acesse `/admin`.

### Webhook do Mercado Pago
No painel do Mercado Pago, em **Suas integrações > Webhooks > Configurar notificações**, informe a URL pública HTTPS:
`https://SEU-DOMINIO.com.br/api/payments/webhook`

Ative o evento **Pagamentos** e copie a chave secreta gerada para `MERCADOPAGO_WEBHOOK_SECRET`. O Mercado Pago recomenda validar a assinatura secreta enviada no header `x-signature`. citeturn1view0
