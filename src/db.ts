import Database from 'better-sqlite3';

export type Db = Database.Database;

// As regras "não pode repetir" ficam no banco (UNIQUE / PRIMARY KEY), não só no código.
// Assim, mesmo com duas requisições simultâneas, o banco impede a duplicidade.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS associados (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                  TEXT    NOT NULL,
  cpf                   TEXT    NOT NULL UNIQUE,
  mensalidade_centavos  INTEGER NOT NULL CHECK (mensalidade_centavos > 0),
  criado_em             TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cobrancas (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  nosso_numero           TEXT    UNIQUE,
  associado_id           INTEGER NOT NULL REFERENCES associados(id),
  mes_referencia         TEXT    NOT NULL,
  valor_centavos         INTEGER NOT NULL,
  status                 TEXT    NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'PAGA')),
  data_pagamento         TEXT,
  id_evento_pagamento    TEXT,
  criado_em              TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (associado_id, mes_referencia)
);

CREATE TABLE IF NOT EXISTS eventos_webhook (
  id_evento       TEXT PRIMARY KEY,
  nosso_numero    TEXT NOT NULL,
  data_pagamento  TEXT NOT NULL,
  resultado       TEXT NOT NULL,
  recebido_em     TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

export const abrirBanco = (caminho: string): Db => {
  const db = new Database(caminho);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
};

// better-sqlite3 lança SqliteError com code "SQLITE_CONSTRAINT_UNIQUE" / "..._PRIMARYKEY"
export const violouUnicidade = (erro: unknown): boolean => {
  const code = (erro as { code?: string })?.code;
  return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
};
