// Parte B — versão corrigida (explicação completa em BUGS.md).
//
// Regra:
// - Pago até o vencimento (inclusive): valor original.
// - Após o vencimento: multa única de 2% + juros simples de 0,033% por dia corrido,
//   ambos calculados sobre o valor ORIGINAL.
// - Resultado arredondado em centavos.

const MULTA = 0.02; // 2%
const JUROS_AO_DIA = 0.00033; // 0,033% = 0,033 / 100
const MS_POR_DIA = 86_400_000;

// Lê "AAAA-MM-DD" como meia-noite UTC. Usar UTC nas duas datas evita que
// fuso horário ou horário de verão mudem a contagem de dias.
const lerData = (texto: string): number => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) throw new Error(`Data inválida: "${texto}". Use AAAA-MM-DD.`);
  const [, ano, mes, dia] = partes.map(Number);
  const ms = Date.UTC(ano, mes - 1, dia);
  // Rejeita datas inexistentes como 2026-02-31 (o Date "rolaria" para março)
  if (new Date(ms).getUTCDate() !== dia) throw new Error(`Data inválida: "${texto}".`);
  return ms;
};

export const calcularValorAtualizado = (valor: number, vencimento: string, dataPagamento: string): number => {
  if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor inválido.');

  const diasAtraso = Math.round((lerData(dataPagamento) - lerData(vencimento)) / MS_POR_DIA);
  if (diasAtraso <= 0) return valor;

  const multa = valor * MULTA;
  const juros = valor * JUROS_AO_DIA * diasAtraso;
  return Math.round((valor + multa + juros) * 100) / 100;
};
