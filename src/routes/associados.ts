import type { FastifyInstance } from 'fastify';
import { violouUnicidade, type Db } from '../db.js';
import { cpfValido, normalizarCpf } from '../lib/cpf.js';
import { centavosParaReais, reaisParaCentavos } from '../lib/dinheiro.js';
import { ErroDeNegocio } from '../lib/erros.js';

type NovoAssociado = { nome: string; cpf: string; valor_mensalidade: number };

type AssociadoRow = {
  id: number;
  nome: string;
  cpf: string;
  mensalidade_centavos: number;
  criado_em: string;
};

const paraResposta = (row: AssociadoRow) => ({
  id: row.id,
  nome: row.nome,
  cpf: row.cpf,
  valor_mensalidade: centavosParaReais(row.mensalidade_centavos),
  criado_em: row.criado_em,
});

// O Fastify valida o body com este JSON Schema antes de chamar o handler.
// Se falhar, responde 400 automaticamente (formatado no error handler).
const schemaCadastro = {
  body: {
    type: 'object',
    required: ['nome', 'cpf', 'valor_mensalidade'],
    additionalProperties: false,
    properties: {
      nome: { type: 'string', minLength: 2, maxLength: 120 },
      cpf: { type: 'string', minLength: 11, maxLength: 14 },
      valor_mensalidade: { type: 'number', exclusiveMinimum: 0 },
    },
  },
} as const;

export const rotasAssociados = async (app: FastifyInstance, opts: { db: Db }) => {
  const { db } = opts;

  app.post<{ Body: NovoAssociado }>('/associados', { schema: schemaCadastro }, async (request, reply) => {
    const { nome, cpf, valor_mensalidade } = request.body;

    if (!cpfValido(cpf)) {
      throw new ErroDeNegocio(422, 'CPF inválido: dígitos verificadores não conferem.');
    }

    try {
      const row = db
        .prepare(
          `INSERT INTO associados (nome, cpf, mensalidade_centavos)
           VALUES (?, ?, ?) RETURNING *`,
        )
        .get(nome.trim(), normalizarCpf(cpf), reaisParaCentavos(valor_mensalidade)) as AssociadoRow;

      return reply.code(201).send(paraResposta(row));
    } catch (erro) {
      if (violouUnicidade(erro)) {
        throw new ErroDeNegocio(409, 'Já existe um associado cadastrado com este CPF.');
      }
      throw erro;
    }
  });
};
