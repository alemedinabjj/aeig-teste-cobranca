import { describe, expect, it } from 'vitest';
import { calcularValorAtualizado } from '../src/lib/calcular-valor-atualizado.js';

describe('calcularValorAtualizado (Parte B)', () => {
  const cenarios: Array<[string, number]> = [
    ['2026-10-01', 189.9], // antes do vencimento
    ['2026-10-05', 189.9], // no dia do vencimento
    ['2026-10-06', 193.76], // 1 dia: 189,90 + 3,798 + 0,0627
    ['2026-10-15', 194.32], // 10 dias: 189,90 + 3,798 + 0,6267
  ];

  it.each(cenarios)('R$ 189,90 vencendo 05/10, pago em %s = %s', (pagamento, esperado) => {
    expect(calcularValorAtualizado(189.9, '2026-10-05', pagamento)).toBe(esperado);
  });

  it('rejeita data em formato errado', () => {
    expect(() => calcularValorAtualizado(100, '05/10/2026', '2026-10-06')).toThrow();
    expect(() => calcularValorAtualizado(100, '2026-02-31', '2026-03-01')).toThrow();
  });
});
