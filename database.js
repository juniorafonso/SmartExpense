console.log("--- Executing database.js ---");
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Use dbPath from .env or default
const dbPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : path.join(__dirname, 'smart_expense.db');
console.log(`[DB] Database path: ${dbPath}`);

let dbInstance = null; // Variable to store the DB instance

// Function to create tables (returns a Promise)
function createTables(db) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            console.log("[DB] Starting table creation process...");

            // Array to store Promises for each db.run
            const tablePromises = [];

            // Helper function to convert db.run to Promise
            const runSql = (sql, message) => {
                return new Promise((res, rej) => {
                    db.run(sql, (err) => {
                        if (err) {
                            console.error(`[DB] Error ${message}:`, err.message);
                            rej(err); // Reject the specific promise
                        } else {
                            res();
                        }
                    });
                });
            };

            // --- Table and Index Definitions ---
            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    password TEXT NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    full_name TEXT NOT NULL,
                    role TEXT DEFAULT 'user' NOT NULL CHECK(role IN ('admin', 'user'))
                )
            `, "creating 'users' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`, "creating 'idx_users_email' index"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS projects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    status TEXT DEFAULT 'active' NOT NULL CHECK(status IN ('active', 'finished'))
                )
            `, "creating 'projects' table"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS creditors (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    information TEXT
                )
            `, "creating 'creditors' table"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS payments (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    payment_type TEXT NOT NULL CHECK(payment_type IN ('cash', 'bank_account', 'credit_card')),
                    reference TEXT,
                    bank TEXT,
                    account_type TEXT CHECK(account_type IN ('checking', 'savings')),
                    country TEXT,
                    currency TEXT
                )
            `, "creating 'payments' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference)`, "creating 'idx_payments_reference' index"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS expenses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
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
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY (creditor_id) REFERENCES creditors(id) ON DELETE SET NULL,
                    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL
                )
            `, "creating 'expenses' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_expenses_project ON expenses(project_id)`, "creating 'idx_expenses_project' index"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_expenses_creditor ON expenses(creditor_id)`, "creating 'idx_expenses_creditor' index"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_expenses_payment ON expenses(payment_id)`, "creating 'idx_expenses_payment' index"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL
                )
            `, "creating 'templates' table"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS template_expenses (
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
                    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
                    FOREIGN KEY (creditor_id) REFERENCES creditors(id) ON DELETE SET NULL
                )
            `, "creating 'template_expenses' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_template_expenses_template ON template_expenses(template_id)`, "creating 'idx_template_expenses_template' index"));

            // --- New Tables ---
            console.log("[DB] Adding 'income_sources' and 'incomes' tables...");
            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS income_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT UNIQUE NOT NULL,
                    type TEXT CHECK(type IN ('Client', 'Investment', 'Salary', 'Sales', 'Other'))
                )
            `, "creating 'income_sources' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_income_sources_name ON income_sources(name)`, "creating 'idx_income_sources_name' index"));

            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS incomes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    project_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    amount REAL NOT NULL,
                    date TEXT NOT NULL,
                    income_source_id INTEGER,
                    type TEXT NOT NULL CHECK(type IN ('one-time', 'recurring')),
                    notes TEXT,
                    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY (income_source_id) REFERENCES income_sources(id) ON DELETE SET NULL
                )
            `, "creating 'incomes' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_incomes_project ON incomes(project_id)`, "creating 'idx_incomes_project' index"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_incomes_source ON incomes(income_source_id)`, "creating 'idx_incomes_source' index"));

            // --- Tabela para o Plano Anual --- <<< ADICIONADO
            console.log("[DB] Adding 'annual_plan_items' table...");
            tablePromises.push(runSql(`
                CREATE TABLE IF NOT EXISTS annual_plan_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    month_year TEXT,
                    expense_name TEXT,
                    expense_amount REAL DEFAULT 0,
                    deposit_amount REAL DEFAULT 0,
                    order_index INTEGER NOT NULL
                )
            `, "creating 'annual_plan_items' table"));
            tablePromises.push(runSql(`CREATE INDEX IF NOT EXISTS idx_annual_plan_order ON annual_plan_items(order_index)`, "creating 'idx_annual_plan_order' index"));


            // Wait for all table/index operations to complete
            Promise.all(tablePromises)
                .then(() => {
                    console.log("[DB] Table creation process finished successfully.");
                    resolve(); // Resolve the createTables Promise
                })
                .catch((err) => {
                    console.error("[DB] Failure during table creation process.");
                    reject(err); // Reject the createTables Promise if any operation fails
                });
        });
    });
}

// Main Promise representing DB readiness
const initializeDatabase = () => {
    return new Promise((resolve, reject) => {
        // Avoid reconnecting if already connected
        if (dbInstance) {
            console.log("[DB] Using existing database instance.");
            resolve(dbInstance);
            return;
        }

        console.log(`[DB] Attempting to connect to database at: ${dbPath}`);
        const db = new sqlite3.Database(dbPath, async (err) => { // Make the callback async
            if (err) {
                console.error("[DB] Error opening database:", err.message);
                reject(err); // Reject the main promise
            } else {
                console.log("[DB] Database connected successfully.");
                dbInstance = db; // Store the instance
                try {
                    await createTables(db); // Wait for table creation to complete
                    console.log("[DB] Database initialization complete.");
                    resolve(db); // Resolve the main promise with the DB instance
                } catch (tableErr) {
                    console.error("[DB] Database initialization failed during table creation.");
                    reject(tableErr); // Reject if createTables fails
                }
            }
        });
    });
};

// Export the function that returns the Promise
module.exports = initializeDatabase;