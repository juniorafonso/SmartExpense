const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./db.sqlite');

db.serialize(() => {
  console.log('Criando tabela Payments...');
  db.run(`
    CREATE TABLE IF NOT EXISTS Payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_pagamento TEXT NOT NULL,  --ENUM('Conta Bancária', 'Cartão de Crédito', 'Dinheiro', ...)
      nome TEXT NOT NULL,
      banco TEXT,                    --Aplicável para 'Conta Bancária'
      id_conta TEXT,                 --Identificador (ex: número da conta)
      tipo_conta TEXT,               -- 'Corrente' ou 'Poupança'
      moeda TEXT NOT NULL,
      pais TEXT NOT NULL
    )
  `, (err) => {
    if (err) {
      console.error("Erro ao criar tabela Payments:", err.message);
    } else {
      console.log("Tabela Payments criada com sucesso!");
    }
  });

  console.log('Adicionando coluna payment_id à tabela template_despesas...');
  db.run(`ALTER TABLE template_despesas ADD COLUMN payment_id INTEGER REFERENCES Payments(id)`, (err) => {
    if (err) {
      console.error("Erro ao adicionar coluna payment_id:", err.message);
    } else {
      console.log("Coluna payment_id adicionada com sucesso!");
    }
  });
});