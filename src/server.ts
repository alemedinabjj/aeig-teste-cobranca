import { construirApp } from './app.js';

const porta = Number(process.env.PORT ?? 3333);

const app = construirApp({
  caminhoBanco: process.env.DB_PATH ?? 'dados.db',
  segredoWebhook: process.env.WEBHOOK_SECRET || undefined,
  logger: true,
});

app.listen({ port: porta, host: '0.0.0.0' }).catch((erro) => {
  app.log.error(erro);
  process.exit(1);
});
