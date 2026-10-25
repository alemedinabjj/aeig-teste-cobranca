# AEIG — Mini-API de cobrança

Teste prático para Programador(a) Full-Stack. API em **TypeScript + Node.js** com **Fastify** e **SQLite** para cadastrar associados, gerar cobranças mensais e receber o aviso de pagamento do banco (webhook).

A Parte B (defeitos na função de cálculo de atraso) está em [`BUGS.md`](BUGS.md).

## Como rodar

Requisito: Node.js 20 ou superior.

```bash
npm install
npm run dev        # sobe em http://localhost:3333 com reload automático
npm test           # roda os 21 testes automatizados
```

Variáveis de ambiente (todas opcionais):

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `3333` | Porta HTTP |
| `DB_PATH` | `dados.db` | Arquivo do SQLite (criado automaticamente) |
| `WEBHOOK_SECRET` | vazio | Se definido, o webhook só aceita requisições com `X-Assinatura` válida (HMAC-SHA256) |

Não precisa criar banco nem rodar migração: as tabelas são criadas ao subir a API.

## Endpoints

| Método | Rota | Sucesso | Erros |
|---|---|---|---|
| POST | `/associados` | 201 | 400 dados inválidos · 409 CPF já cadastrado · 422 CPF com dígito verificador inválido |
| POST | `/cobrancas` | 201 | 400 dados/mês inválidos · 404 associado não existe · 409 já existe cobrança no mês |
| GET | `/cobrancas/:nosso_numero` | 200 | 404 não encontrada |
| POST | `/webhooks/pagamento` | 200 | 400 JSON/data inválidos · 401 assinatura inválida · 404 nosso número inexistente |
| GET | `/health` | 200 | — |

Todos os erros seguem o formato `{ "erro": "mensagem clara" }`.

### Exemplos com curl

```bash
# 1. Cadastrar associado (CPF pode vir com ou sem máscara)
curl -X POST http://localhost:3333/associados \
  -H "Content-Type: application/json" \
  -d '{"nome":"Maria Silva","cpf":"529.982.247-25","valor_mensalidade":189.90}'

# 2. Gerar cobrança de outubro
curl -X POST http://localhost:3333/cobrancas \
  -H "Content-Type: application/json" \
  -d '{"associado_id":1,"mes_referencia":"2026-10"}'

# 3. Consultar
curl http://localhost:3333/cobrancas/00000001

# 4. Aviso de pagamento (rode duas vezes: a segunda responde IGNORADO)
curl -X POST http://localhost:3333/webhooks/pagamento \
  -H "Content-Type: application/json" \
  -d '{"id_evento":"evt_000123","nosso_numero":"00000001","data_pagamento":"2026-10-15"}'

# 5. Com WEBHOOK_SECRET=segredo definido, assine o corpo:
BODY='{"id_evento":"evt_000124","nosso_numero":"00000001","data_pagamento":"2026-10-15"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "segredo" -hex | sed 's/^.* //')
curl -X POST http://localhost:3333/webhooks/pagamento \
  -H "Content-Type: application/json" -H "X-Assinatura: $SIG" -d "$BODY"
```

O arquivo [`exemplos.http`](exemplos.http) tem as mesmas chamadas para o REST Client do VS Code.

## Estrutura

```
src/
  server.ts            sobe o servidor (lê variáveis de ambiente)
  app.ts               monta o Fastify: rotas, tratamento de erros (testável sem porta)
  db.ts                conexão SQLite e criação das tabelas
  routes/
    associados.ts      POST /associados
    cobrancas.ts       POST /cobrancas, GET /cobrancas/:nosso_numero
    webhooks.ts        POST /webhooks/pagamento (idempotência + HMAC)
  lib/
    cpf.ts             validação dos dígitos verificadores
    dinheiro.ts        conversão reais <-> centavos
    erros.ts           ErroDeNegocio (mensagem + status HTTP)
    calcular-valor-atualizado.ts   Parte B corrigida
test/                  testes com Vitest usando app.inject()
```

## Principais decisões

- **Fastify**: valida o corpo com JSON Schema nativo (sem lib extra), tem `inject()` para testar rotas sem abrir porta e o sistema de plugins isola configurações (o parser de corpo cru só existe na rota do webhook).
- **SQLite com `better-sqlite3`**: zero configuração para quem for avaliar. As regras de unicidade estão **no banco** (`UNIQUE` em `cpf`, `UNIQUE(associado_id, mes_referencia)`, `PRIMARY KEY` em `id_evento`), então valem mesmo com requisições simultâneas, não só no código. Trocar por PostgreSQL mudaria só o `db.ts` e as queries.
- **Dinheiro em centavos (inteiro)**: evita erro de ponto flutuante. A API recebe e devolve reais (`189.90`) por ser mais natural para o cliente.
- **CPF**: aceita com ou sem máscara e grava só os dígitos, para que `529.982.247-25` e `52998224725` sejam reconhecidos como o mesmo CPF. Recusa sequências repetidas (`111.111.111-11`), que passam na conta mas não são CPFs reais. Formato errado → 400; dígito verificador errado → 422 (o JSON está certo, a regra de negócio é que falhou).
- **Nosso número**: o `id` da cobrança com 8 dígitos (`00000001`). Único por construção e fácil de ditar. Gerado dentro de uma transação junto com o insert.
- **Webhook idempotente**: cada `id_evento` é gravado na tabela `eventos_webhook` na **mesma transação** que marca a cobrança como paga. Se o mesmo evento chegar de novo, responde `200 IGNORADO` sem alterar nada. Se dois reenvios chegarem ao mesmo tempo, a `PRIMARY KEY` barra o segundo, que também recebe `IGNORADO`.
- **Status do webhook**: reenvio do mesmo evento responde **200** (e não 409) porque, para o banco, "já recebi" é sucesso; um erro faria o banco continuar reenviando. Um evento novo para cobrança já paga responde `200 JA_ESTAVA_PAGA` e não altera a data do primeiro pagamento.
- **Nosso número inexistente → 404**: o erro é tratado, logado como aviso e o sistema segue normalmente. Não gravo esse evento como processado, para que um reenvio futuro possa funcionar caso a cobrança seja criada depois.
- **HMAC (bônus)**: ligado só quando `WEBHOOK_SECRET` existe, para facilitar o teste manual. A assinatura é calculada sobre o **corpo cru** (não sobre o JSON re-serializado) e comparada com `timingSafeEqual`.
- **Erros**: um único `setErrorHandler` traduz `ErroDeNegocio`, erros de validação (400) e erros inesperados (500 sem expor detalhes internos).

## O que ficou faltando / próximos passos

- Listagem e consulta de associados (`GET /associados`) e listagem de cobranças por associado.
- Validar se `data_pagamento` não está no futuro e aplicar a regra de multa/juros da Parte B quando o pagamento vier depois do vencimento (o enunciado não define o vencimento da cobrança, então não inventei um).
- Valor pago no webhook: o payload do banco não traz o valor, então não há conciliação de pagamento a menor/maior.
- Em produção: PostgreSQL, migrações versionadas, Docker, autenticação nas rotas internas e fila para processar webhooks de forma assíncrona.

## Uso de IA

Usei IA como apoio para escrever os testes automatizados, revisar a documentação (README e BUGS.md) e acelerar partes repetitivas do código. Revisei e testei tudo, e consigo explicar cada trecho e as decisões acima.
