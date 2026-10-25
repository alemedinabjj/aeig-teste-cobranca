import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { construirApp } from '../src/app.js';

const CPF_VALIDO = '529.982.247-25';
const OUTRO_CPF_VALIDO = '111.444.777-35';

type App = ReturnType<typeof construirApp>;
let app: App;

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

const criarAssociado = async (cpf = CPF_VALIDO) =>
  (await post('/associados', { nome: 'Maria Silva', cpf, valor_mensalidade: 189.9 })).json();

const criarCobranca = async (associado_id: number, mes_referencia = '2026-10') =>
  (await post('/cobrancas', { associado_id, mes_referencia })).json();

beforeEach(() => {
  app = construirApp({ caminhoBanco: ':memory:' });
});

afterEach(async () => {
  await app.close();
});

describe('POST /associados', () => {
  it('cadastra com CPF válido (com máscara) e guarda só os dígitos', async () => {
    const res = await post('/associados', { nome: 'Maria Silva', cpf: CPF_VALIDO, valor_mensalidade: 189.9 });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 1, cpf: '52998224725', valor_mensalidade: 189.9 });
  });

  it('rejeita CPF com dígito verificador errado (422)', async () => {
    const res = await post('/associados', { nome: 'Maria', cpf: '529.982.247-26', valor_mensalidade: 100 });
    expect(res.statusCode).toBe(422);
    expect(res.json().erro).toMatch(/CPF inválido/);
  });

  it('rejeita CPF com todos os dígitos iguais', async () => {
    const res = await post('/associados', { nome: 'Maria', cpf: '111.111.111-11', valor_mensalidade: 100 });
    expect(res.statusCode).toBe(422);
  });

  it('rejeita CPF repetido, mesmo com formatação diferente (409)', async () => {
    await criarAssociado(CPF_VALIDO);
    const res = await post('/associados', { nome: 'Outra', cpf: '52998224725', valor_mensalidade: 100 });
    expect(res.statusCode).toBe(409);
  });

  it('rejeita body incompleto ou mensalidade <= 0 (400)', async () => {
    expect((await post('/associados', { nome: 'Maria' })).statusCode).toBe(400);
    expect((await post('/associados', { nome: 'Maria', cpf: CPF_VALIDO, valor_mensalidade: 0 })).statusCode).toBe(400);
  });
});

describe('cobranças', () => {
  it('gera cobrança PENDENTE com valor da mensalidade e nosso_numero', async () => {
    const { id } = await criarAssociado();
    const res = await post('/cobrancas', { associado_id: id, mes_referencia: '2026-10' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ nosso_numero: '00000001', valor: 189.9, status: 'PENDENTE' });
  });

  it('não permite duas cobranças do mesmo associado no mesmo mês (409)', async () => {
    const { id } = await criarAssociado();
    await criarCobranca(id, '2026-10');
    const res = await post('/cobrancas', { associado_id: id, mes_referencia: '2026-10' });
    expect(res.statusCode).toBe(409);
  });

  it('permite o mesmo mês para associados diferentes', async () => {
    const a = await criarAssociado(CPF_VALIDO);
    const b = await criarAssociado(OUTRO_CPF_VALIDO);
    await criarCobranca(a.id);
    const res = await post('/cobrancas', { associado_id: b.id, mes_referencia: '2026-10' });
    expect(res.statusCode).toBe(201);
    expect(res.json().nosso_numero).toBe('00000002');
  });

  it('valida mês no formato AAAA-MM (400) e associado existente (404)', async () => {
    const { id } = await criarAssociado();
    expect((await post('/cobrancas', { associado_id: id, mes_referencia: '2026-13' })).statusCode).toBe(400);
    expect((await post('/cobrancas', { associado_id: id, mes_referencia: '10/2026' })).statusCode).toBe(400);
    expect((await post('/cobrancas', { associado_id: 999, mes_referencia: '2026-10' })).statusCode).toBe(404);
  });

  it('GET /cobrancas/:nosso_numero consulta e retorna 404 se não existir', async () => {
    const { id } = await criarAssociado();
    const { nosso_numero } = await criarCobranca(id);
    const ok = await app.inject({ method: 'GET', url: `/cobrancas/${nosso_numero}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('PENDENTE');
    expect((await app.inject({ method: 'GET', url: '/cobrancas/99999999' })).statusCode).toBe(404);
  });
});

describe('POST /webhooks/pagamento', () => {
  it('marca a cobrança como PAGA', async () => {
    const { id } = await criarAssociado();
    const { nosso_numero } = await criarCobranca(id);
    const res = await post('/webhooks/pagamento', { id_evento: 'evt_1', nosso_numero, data_pagamento: '2026-10-15' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PAGA');

    const consulta = (await app.inject({ method: 'GET', url: `/cobrancas/${nosso_numero}` })).json();
    expect(consulta).toMatchObject({ status: 'PAGA', data_pagamento: '2026-10-15' });
  });

  it('o mesmo id_evento reenviado não é processado de novo', async () => {
    const { id } = await criarAssociado();
    const { nosso_numero } = await criarCobranca(id);
    const aviso = { id_evento: 'evt_1', nosso_numero, data_pagamento: '2026-10-15' };

    await post('/webhooks/pagamento', aviso);
    const reenvio = await post('/webhooks/pagamento', { ...aviso, data_pagamento: '2026-10-20' });

    expect(reenvio.statusCode).toBe(200);
    expect(reenvio.json().status).toBe('IGNORADO');
    const consulta = (await app.inject({ method: 'GET', url: `/cobrancas/${nosso_numero}` })).json();
    expect(consulta.data_pagamento).toBe('2026-10-15'); // não mudou
  });

  it('evento novo para cobrança já paga não altera nada', async () => {
    const { id } = await criarAssociado();
    const { nosso_numero } = await criarCobranca(id);
    await post('/webhooks/pagamento', { id_evento: 'evt_1', nosso_numero, data_pagamento: '2026-10-15' });
    const res = await post('/webhooks/pagamento', { id_evento: 'evt_2', nosso_numero, data_pagamento: '2026-10-16' });
    expect(res.json().status).toBe('JA_ESTAVA_PAGA');
  });

  it('nosso_numero inexistente responde 404 e o sistema continua de pé', async () => {
    const res = await post('/webhooks/pagamento', { id_evento: 'evt_x', nosso_numero: '00099999', data_pagamento: '2026-10-15' });
    expect(res.statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('JSON malformado ou data inválida responde 400', async () => {
    const malformado = await app.inject({
      method: 'POST',
      url: '/webhooks/pagamento',
      headers: { 'content-type': 'application/json' },
      payload: '{ isso não é json',
    });
    expect(malformado.statusCode).toBe(400);
    const dataRuim = await post('/webhooks/pagamento', { id_evento: 'e', nosso_numero: '1', data_pagamento: '15/10/2026' });
    expect(dataRuim.statusCode).toBe(400);
  });
});

describe('webhook com HMAC (bônus)', () => {
  const SEGREDO = 'segredo-de-teste';
  let appSeguro: App;

  beforeEach(() => {
    appSeguro = construirApp({ caminhoBanco: ':memory:', segredoWebhook: SEGREDO });
  });
  afterEach(async () => {
    await appSeguro.close();
  });

  const enviar = (corpo: string, assinatura?: string) =>
    appSeguro.inject({
      method: 'POST',
      url: '/webhooks/pagamento',
      headers: { 'content-type': 'application/json', ...(assinatura ? { 'x-assinatura': assinatura } : {}) },
      payload: corpo,
    });

  it('aceita assinatura válida e recusa ausente/errada com 401', async () => {
    const corpo = JSON.stringify({ id_evento: 'evt_1', nosso_numero: '00000001', data_pagamento: '2026-10-15' });
    const assinatura = createHmac('sha256', SEGREDO).update(corpo).digest('hex');

    expect((await enviar(corpo)).statusCode).toBe(401);
    expect((await enviar(corpo, 'abc123')).statusCode).toBe(401);
    // assinatura certa passa pela verificação (404 porque a cobrança não existe neste banco)
    expect((await enviar(corpo, assinatura)).statusCode).toBe(404);
  });
});
