# Parte B — Defeitos em `calcularValorAtualizado`

Regra esperada: até o vencimento, sem acréscimo. Depois do vencimento, **multa única de 2%** + **juros simples de 0,033% por dia corrido**, ambos sobre o **valor original**, com resultado **arredondado em centavos**.

## Defeitos encontrados

| # | Onde | Defeito | Efeito para o associado |
|---|------|---------|------------------------|
| 1 | `i <= diasAtraso` | O laço roda uma vez a mais. Com `diasAtraso = 0` (pagou **no dia do vencimento**) ele ainda executa 1 vez. | Quem pagou em dia é cobrado com multa e juros. Quem atrasou paga um dia de juros a mais. |
| 2 | `valor * 0.02` dentro do laço | A multa de 2% é somada **a cada dia** de atraso, e não uma única vez. | Com 10 dias de atraso o associado paga ~22% de multa em vez de 2%. É o erro que mais pesa no bolso. |
| 3 | `total * 0.00033` | Os juros são calculados sobre o `total` acumulado (que já tem multa e juros), ou seja, **juros compostos**. A regra pede juros simples sobre o valor original. | Juros sobre juros: o valor cresce cada dia mais rápido. |
| 4 | `return total` | Não arredonda em centavos. | O valor sai com várias casas (ex.: 197,62260802…), gerando divergência entre sistema, boleto e o que o associado pagou. |
| 5 | `new Date(...)` + `Math.floor` | As datas são lidas sem formato definido. `"2026-10-05"` vira meia-noite **UTC**, mas `"2026-10-05T00:00"` ou `"10/05/2026"` viram horário **local** (ou outra data). Misturando formatos, a diferença em dias pode sair errada por fuso/horário de verão, e uma data inválida vira `NaN` sem nenhum erro. | Risco de cobrar um dia a mais/a menos ou devolver `NaN` (cobrança quebrada) silenciosamente. |

> Observação: a taxa `0.00033` **está correta** (0,033% = 0,033 / 100). O problema dos juros é a base de cálculo (defeito 3), não a taxa.

## Versão corrigida

Também está em [`src/lib/calcular-valor-atualizado.ts`](src/lib/calcular-valor-atualizado.ts), com testes em [`test/calcular-valor-atualizado.test.ts`](test/calcular-valor-atualizado.test.ts).

```ts
const MULTA = 0.02;           // 2%
const JUROS_AO_DIA = 0.00033; // 0,033% ao dia
const MS_POR_DIA = 86_400_000;

// Lê "AAAA-MM-DD" como meia-noite UTC nas duas datas: fuso não interfere.
const lerData = (texto: string): number => {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!partes) throw new Error(`Data inválida: "${texto}". Use AAAA-MM-DD.`);
  const [, ano, mes, dia] = partes.map(Number);
  const ms = Date.UTC(ano, mes - 1, dia);
  if (new Date(ms).getUTCDate() !== dia) throw new Error(`Data inválida: "${texto}".`);
  return ms;
};

export const calcularValorAtualizado = (valor: number, vencimento: string, dataPagamento: string): number => {
  if (!Number.isFinite(valor) || valor < 0) throw new Error('Valor inválido.');

  const diasAtraso = Math.round((lerData(dataPagamento) - lerData(vencimento)) / MS_POR_DIA);
  if (diasAtraso <= 0) return valor;               // corrige #1: no vencimento não há acréscimo

  const multa = valor * MULTA;                      // corrige #2: multa aplicada uma única vez
  const juros = valor * JUROS_AO_DIA * diasAtraso;  // corrige #3: juros simples sobre o original
  return Math.round((valor + multa + juros) * 100) / 100; // corrige #4: arredonda em centavos
};
```

O que mudou, em resumo: não há mais laço (a conta é uma fórmula direta), a multa entra uma vez, os juros usam sempre o valor original, as datas são lidas num formato fixo em UTC (corrige #5) e o resultado é arredondado só no final.

## Valores corretos — R$ 189,90 com vencimento em 05/10/2026

| Pago em | Dias de atraso | Cálculo | **Correto** | Função antiga (com defeito) |
|---------|---------------:|---------|------------:|----------------------------:|
| 01/10/2026 | 0 (adiantado) | sem acréscimo | **R$ 189,90** | R$ 189,90 |
| 05/10/2026 | 0 (no dia) | sem acréscimo | **R$ 189,90** | R$ 193,760667 |
| 06/10/2026 | 1 | 189,90 + 3,798 (multa) + 0,0627 (juros) = 193,7607 | **R$ 193,76** | R$ 197,622608… |
| 15/10/2026 | 10 | 189,90 + 3,798 (multa) + 0,6267 (juros) = 194,3247 | **R$ 194,32** | R$ 232,437477… |

No pagamento de 15/10 a função antiga cobrava **R$ 38,12 a mais** do associado.
