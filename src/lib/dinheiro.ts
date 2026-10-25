// Dinheiro é guardado em centavos (inteiro) para evitar erros de ponto flutuante
// (ex.: 0.1 + 0.2 !== 0.3). A API recebe e devolve reais (189.90).
export const reaisParaCentavos = (reais: number): number => Math.round(reais * 100);

export const centavosParaReais = (centavos: number): number => centavos / 100;
