import Fastify, { type FastifyError } from 'fastify';
import { abrirBanco } from './db.js';
import { ErroDeNegocio } from './lib/erros.js';
import { rotasAssociados } from './routes/associados.js';
import { rotasCobrancas } from './routes/cobrancas.js';
import { rotasWebhooks } from './routes/webhooks.js';

export type OpcoesApp = {
  caminhoBanco?: string; // ':memory:' nos testes
  segredoWebhook?: string; // se definido, exige X-Assinatura no webhook
  logger?: boolean;
};

// Separar "montar o app" de "subir o servidor" permite testar com app.inject()
// sem abrir porta de rede.
export const construirApp = (opcoes: OpcoesApp = {}) => {
  const app = Fastify({ logger: opcoes.logger ?? false });
  const db = abrirBanco(opcoes.caminhoBanco ?? 'dados.db');

  app.setErrorHandler((erro: FastifyError | ErroDeNegocio, request, reply) => {
    if (erro instanceof ErroDeNegocio) {
      return reply.code(erro.statusCode).send({ erro: erro.message });
    }
    if ('validation' in erro && erro.validation) {
      return reply.code(400).send({ erro: 'Dados inválidos.', detalhes: erro.message });
    }
    // Erro inesperado: loga tudo, mas não expõe detalhes internos ao cliente.
    request.log.error(erro);
    return reply.code(500).send({ erro: 'Erro interno. Tente novamente mais tarde.' });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ erro: `Rota ${request.method} ${request.url} não existe.` });
  });

  app.get('/health', async () => ({ status: 'ok' }));
  app.register(rotasAssociados, { db });
  app.register(rotasCobrancas, { db });
  app.register(rotasWebhooks, { db, segredoWebhook: opcoes.segredoWebhook });

  app.addHook('onClose', async () => db.close());

  return app;
};
