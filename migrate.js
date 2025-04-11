const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

// Passo 1: Criar nova tabela com estrutura corrigida
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS template_despesas_tmp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    nome TEXT,
    valor REAL,
    tipo TEXT,
    iban TEXT,
    observacoes TEXT,
    arquivo TEXT,
    status_pagamento TEXT DEFAULT 'unpaid',
    dia_do_mes INTEGER
  )`, (err) => {
    if (err) return console.error("Erro criando tabela temporária:", err.message);

    // Passo 2: Copiar dados da antiga (exceto data)
    db.run(`INSERT INTO template_despesas_tmp (
      id, template_id, nome, valor, tipo, iban, observacoes, arquivo, status_pagamento
    ) SELECT 
      id, template_id, nome, valor, tipo, iban, observacoes, arquivo, status_pagamento
    FROM template_despesas`, (err2) => {
      if (err2) return console.error("Erro copiando dados:", err2.message);

      // Passo 3: Apagar a tabela antiga
      db.run(`DROP TABLE template_despesas`, (err3) => {
        if (err3) return console.error("Erro ao deletar tabela antiga:", err3.message);

        // Passo 4: Renomear nova tabela
        db.run(`ALTER TABLE template_despesas_tmp RENAME TO template_despesas`, (err4) => {
          if (err4) return console.error("Erro ao renomear tabela:", err4.message);
          console.log("✅ Migração concluída com sucesso!");
        });
      });
    });
  });
});
