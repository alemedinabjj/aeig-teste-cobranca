// Erro de regra de negócio com o status HTTP que ele deve gerar.
// O error handler global (app.ts) transforma isso em { erro: mensagem }.
export class ErroDeNegocio extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'ErroDeNegocio';
  }
}
