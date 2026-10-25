import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { violouUnicidade, type Db } from '../db.js';
import { ErroDeNegocio } from '../lib/erros.js';
import type { CobrancaRow } from './cobrancas.js';

type AvisoPagamento = { id_evento: string; nosso_numero: string; data_pagamento: string };

type Resultado = 'PAGA' | 'JA_ESTAVA_PAGA';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

const schemaAviso = {
  body: {
    type: 'object',
    required: ['id_evento', 'nosso_numero', 'data_pagamento'],
    properties: {
      id_evento: { type: 'string', minLength: 1, maxLength: 100 },
      nosso_numero: { type: 'string', minLength: 1, maxLength: 50 },
      data_pagamento: { type: 'string', format: 'date' }, // AAAA-MM-DD
    },
  },
} as const;

// A assinatura é calculada sobre o corpo EXATO recebido (bytes crus),
// por isso guardamos o rawBody antes do JSON.parse.
const assinaturaValida = (corpo: string, assinatura: string | undefined, segredo: string): boolean => {
  if (!assinatura) return false;
  const esperada = createHmac('sha256', segredo).update(corpo).digest('hex');
  const a = Buffer.from(esperada, 'utf8');
  const b = Buffer.from(assinatura.trim().toLowerCase(), 'utf8');
  // timingSafeEqual evita "timing attack" (descobrir a assinatura pelo tempo de resposta)
  return a.length === b.length && timingSafeEqual(a, b);
};

export const rotasWebhooks = async (app: FastifyInstance, opts: { db: Db; segredoWebhook?: string }) => {
  const { db, segredoWebhook } = opts;

  // Parser só deste plugin (encapsulamento do Fastify): guarda o corpo cru para o HMAC.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const texto = body as string;
    (request as FastifyRequest).rawBody = texto;
    try {
      done(null, JSON.parse(texto));
    } catch {
      done(new ErroDeNegocio(400, 'JSON inválido.'), undefined);
    }
  });

  // Tudo dentro de UMA transação: registrar o evento + marcar a cobrança como paga.
  // A PRIMARY KEY em eventos_webhook.id_evento garante que o mesmo evento
  // nunca é processado duas vezes, mesmo com reenvios simultâneos.
  const processarAviso = db.transaction((aviso: AvisoPagamento, cobranca: CobrancaRow): Resultado => {
    const resultado: Resultado = cobranca.status === 'PAGA' ? 'JA_ESTAVA_PAGA' : 'PAGA';

    db.prepare(
      `INSERT INTO eventos_webhook (id_evento, nosso_numero, data_pagamento, resultado)
       VALUES (?, ?, ?, ?)`,
    ).run(aviso.id_evento, aviso.nosso_numero, aviso.data_pagamento, resultado);

    if (resultado === 'PAGA') {
      db.prepare(
        `UPDATE cobrancas
            SET status = 'PAGA', data_pagamento = ?, id_evento_pagamento = ?
          WHERE id = ? AND status = 'PENDENTE'`,
      ).run(aviso.data_pagamento, aviso.id_evento, cobranca.id);
    }
    return resultado;
  });

  app.post<{ Body: AvisoPagamento }>('/webhooks/pagamento', { schema: schemaAviso }, async (request, reply) => {
    if (segredoWebhook) {
      const assinatura = request.headers['x-assinatura'];
      if (!assinaturaValida(request.rawBody ?? '', typeof assinatura === 'string' ? assinatura : undefined, segredoWebhook)) {
        throw new ErroDeNegocio(401, 'Assinatura X-Assinatura ausente ou inválida.');
      }
    }

    const aviso = request.body;

    const jaProcessado = db
      .prepare('SELECT resultado FROM eventos_webhook WHERE id_evento = ?')
      .get(aviso.id_evento) as { resultado: Resultado } | undefined;

    if (jaProcessado) {
      return reply.code(200).send({ status: 'IGNORADO', motivo: 'Evento já processado anteriormente.' });
    }

    const cobranca = db
      .prepare('SELECT * FROM cobrancas WHERE nosso_numero = ?')
      .get(aviso.nosso_numero) as CobrancaRow | undefined;

    if (!cobranca) {
      request.log.warn({ aviso }, 'Aviso de pagamento para nosso_numero inexistente');
      throw new ErroDeNegocio(404, `Cobrança com nosso_numero ${aviso.nosso_numero} não encontrada.`);
    }

    try {
      const resultado = processarAviso(aviso, cobranca);
      return reply.code(200).send({ status: resultado, nosso_numero: cobranca.nosso_numero });
    } catch (erro) {
      // Corrida: outro reenvio do mesmo evento gravou entre o SELECT e o INSERT.
      if (violouUnicidade(erro)) {
        return reply.code(200).send({ status: 'IGNORADO', motivo: 'Evento já processado anteriormente.' });
      }
      throw erro;
    }
  });
};
