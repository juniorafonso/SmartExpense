const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.db');
const dbExists = fs.existsSync(dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("Error opening database", err.message);
  } else {
    console.log("Database connected successfully.");
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Tabela de Usuários (Users Table)
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'user' NOT NULL CHECK(role IN ('user', 'admin'))
    )`, (err) => {
      if (err) console.error("Error creating users table", err.message);
      else console.log("Users table checked/created.");
    });

    // Tabela de Projetos (Projects Table)
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active', 'finished'))
    )`, (err) => {
      if (err) console.error("Error creating projects table", err.message);
      else console.log("Projects table checked/created.");
    });

    // Tabela de Credores (Creditors Table)
    db.run(`CREATE TABLE IF NOT EXISTS creditors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      information TEXT
    )`, (err) => {
      if (err) console.error("Error creating creditors table", err.message);
      else console.log("Creditors table checked/created.");
    });

    // Tabela de Métodos de Pagamento (Payments Table) - Atualizada
    db.run(`CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, -- Nome descritivo (ex: "My Bank VISA", "Main Checking Account")
      payment_type TEXT NOT NULL CHECK(payment_type IN ('cash', 'bank_account', 'credit_card')), -- Tipo geral
      reference TEXT,     -- Renomeado de account_id. Usado para nº conta ou nº cartão
      bank TEXT,          -- Nome do banco (para bank_account ou credit_card)
      account_type TEXT CHECK(account_type IN ('checking', 'savings')), -- Apenas para bank_account
      country TEXT,       -- Apenas para bank_account
      currency TEXT       -- Apenas para bank_account
      -- creditcard_number foi removido, usaremos 'reference'
    )`, (err) => {
      if (err) console.error("Error creating payments table", err.message);
      else console.log("Payments table checked/created.");
    });

    // Tabela de Despesas (Expenses Table) - CORRIGIDA
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,          -- Coluna correta para ID do projeto
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('fixed', 'one-time')),
      file TEXT,
      iban TEXT,
      notes TEXT,
      payment_status TEXT DEFAULT 'unpaid' NOT NULL CHECK(payment_status IN ('paid', 'unpaid')),
      creditor_id INTEGER,
      payment_id INTEGER,
      FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE, -- <<< LINHA CORRETA (Referencia projects.id)
      FOREIGN KEY (creditor_id) REFERENCES creditors (id) ON DELETE SET NULL,
      FOREIGN KEY (payment_id) REFERENCES payments (id) ON DELETE SET NULL
    )`, (err) => {
      if (err) console.error("Error creating expenses table", err.message);
      else console.log("Expenses table checked/created.");
    });

    // Tabela de Templates (Templates Table)
    db.run(`CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    )`, (err) => {
      if (err) console.error("Error creating templates table", err.message);
      else console.log("Templates table checked/created.");
    });

    // Tabela de Despesas de Template (Template Expenses Table)
    db.run(`CREATE TABLE IF NOT EXISTS template_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      day_of_month INTEGER CHECK(day_of_month >= 1 AND day_of_month <= 31),
      type TEXT NOT NULL CHECK(type IN ('fixed', 'one-time')),
      file TEXT,
      iban TEXT,
      notes TEXT,
      creditor_id INTEGER,
      FOREIGN KEY (template_id) REFERENCES templates (id) ON DELETE CASCADE,
      FOREIGN KEY (creditor_id) REFERENCES creditors (id) ON DELETE SET NULL
    )`, (err) => {
      if (err) console.error("Error creating template_expenses table", err.message);
      else console.log("Template expenses table checked/created.");
    });

    // Índices - CORRIGIDO
    db.run("CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);", (err) => {
        if (err) console.error("Error creating index idx_users_email", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses (project_id);", (err) => { // <<< LINHA CORRETA (Usa project_id)
        if (err) console.error("Error creating index idx_expenses_project", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_template_expenses_template ON template_expenses (template_id);", (err) => {
        if (err) console.error("Error creating index idx_template_expenses_template", err.message);
    });
    db.run("CREATE INDEX IF NOT EXISTS idx_expenses_creditor ON expenses (creditor_id);", (err) => {
        if (err) console.error("Error creating index idx_expenses_creditor", err.message);
    });
     db.run("CREATE INDEX IF NOT EXISTS idx_expenses_payment ON expenses (payment_id);", (err) => {
        if (err) console.error("Error creating index idx_expenses_payment", err.message);
    });
     db.run("CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments (reference);", (err) => { // Índice para reference
        if (err) console.error("Error creating index idx_payments_reference", err.message);
    });

    console.log("Database initialization checks complete.");
  });
}

module.exports = db;