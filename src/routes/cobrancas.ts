import type { FastifyInstance } from 'fastify';
import { violouUnicidade, type Db } from '../db.js';
import { centavosParaReais } from '../lib/dinheiro.js';
import { ErroDeNegocio } from '../lib/erros.js';

type NovaCobranca = { associado_id: number; mes_referencia: string };

export type CobrancaRow = {
  id: number;
  nosso_numero: string;
  associado_id: number;
  mes_referencia: string;
  valor_centavos: number;
  status: 'PENDENTE' | 'PAGA';
  data_pagamento: string | null;
  id_evento_pagamento: string | null;
  criado_em: string;
};

export const cobrancaParaResposta = (row: CobrancaRow) => ({
  nosso_numero: row.nosso_numero,
  associado_id: row.associado_id,
  mes_referencia: row.mes_referencia,
  valor: centavosParaReais(row.valor_centavos),
  status: row.status,
  data_pagamento: row.data_pagamento,
  criado_em: row.criado_em,
});

// "Nosso número" = id da cobrança com zeros à esquerda (8 dígitos): 1 -> "00000001".
// É único porque o id é único, e é fácil de ler/ditar para o associado.
const gerarNossoNumero = (id: number): string => String(id).padStart(8, '0');

const schemaCriacao = {
  body: {
    type: 'object',
    required: ['associado_id', 'mes_referencia'],
    additionalProperties: false,
    properties: {
      associado_id: { type: 'integer', minimum: 1 },
      // AAAA-MM com mês de 01 a 12
      mes_referencia: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
    },
  },
} as const;

export const rotasCobrancas = async (app: FastifyInstance, opts: { db: Db }) => {
  const { db } = opts;

  // Transação: insere, descobre o id gerado e grava o nosso_numero.
  // Se qualquer passo falhar, nada fica gravado pela metade.
  const criarCobranca = db.transaction((associadoId: number, mes: string, valorCentavos: number) => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO cobrancas (associado_id, mes_referencia, valor_centavos)
         VALUES (?, ?, ?)`,
      )
      .run(associadoId, mes, valorCentavos);

    const id = Number(lastInsertRowid);
    return db
      .prepare('UPDATE cobrancas SET nosso_numero = ? WHERE id = ? RETURNING *')
      .get(gerarNossoNumero(id), id) as CobrancaRow;
  });

  app.post<{ Body: NovaCobranca }>('/cobrancas', { schema: schemaCriacao }, async (request, reply) => {
    const { associado_id, mes_referencia } = request.body;

    const associado = db
      .prepare('SELECT mensalidade_centavos FROM associados WHERE id = ?')
      .get(associado_id) as { mensalidade_centavos: number } | undefined;

    if (!associado) {
      throw new ErroDeNegocio(404, `Associado ${associado_id} não encontrado.`);
    }

    try {
      const cobranca = criarCobranca(associado_id, mes_referencia, associado.mensalidade_centavos);
      return reply.code(201).send(cobrancaParaResposta(cobranca));
    } catch (erro) {
      if (violouUnicidade(erro)) {
        throw new ErroDeNegocio(409, `Já existe cobrança do associado ${associado_id} para ${mes_referencia}.`);
      }
      throw erro;
    }
  });

  app.get<{ Params: { nosso_numero: string } }>('/cobrancas/:nosso_numero', async (request) => {
    const row = db
      .prepare('SELECT * FROM cobrancas WHERE nosso_numero = ?')
      .get(request.params.nosso_numero) as CobrancaRow | undefined;

    if (!row) {
      throw new ErroDeNegocio(404, 'Cobrança não encontrada.');
    }
    return cobrancaParaResposta(row);
  });
};
