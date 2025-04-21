require('dotenv').config(); // Load variables from .env into process.env -> ADDED AT THE TOP

// =============================================================================
// Essential Imports
// =============================================================================
const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose(); // Keep for potential other uses
const multer = require('multer');
const expressLayouts = require('express-ejs-layouts');
const fs = require('fs');
const bcrypt = require('bcrypt');
const flash = require('connect-flash');
const initializeDatabase = require('./database.js'); // Caminho correto para o arquivo database.js

// =============================================================================
// Configuration & Constants from .env and config.js
// =============================================================================

// --- Variables from .env ---
const PORT = process.env.PORT || 3000;
const sessionSecret = process.env.SESSION_SECRET;
// DATABASE_PATH is now primarily used within database.js
// const dbPath = process.env.DATABASE_PATH || './db.sqlite'; // No longer needed here
const NODE_ENV = process.env.NODE_ENV || 'development';
const DEV_MODE = NODE_ENV === 'development';

// Check if SESSION_SECRET is defined in .env
if (!sessionSecret) {
    console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("FATAL ERROR: SESSION_SECRET not defined in the .env file!");
    console.error("Generate a secure key and add it to your .env file.");
    console.error("Example: SESSION_SECRET=\"a_very_long_and_secure_random_string\"");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    process.exit(1);
}

// --- Load config.js and lang.json ---
let config;
let lang;

function loadConfigAndLang() {
    try {
        delete require.cache[require.resolve('./config')];
        config = require('./config');
    } catch (e) {
        console.warn("config.js file not found or invalid. Using default values.");
        config = { DEFAULT_LOCALE: 'en', DEFAULT_CURRENCY: 'USD' };
    }
    try {
        delete require.cache[require.resolve('./lang.json')];
        lang = require('./lang.json');
    } catch (e) {
        console.error("Error loading lang.json:", e);
        lang = { en: { error_generic: "An error occurred." } };
    }
}

loadConfigAndLang(); // Initial load

// --- Derived Constants and Global Variables ---
const saltRounds = 10;
let DEFAULT_LOCALE = ['pt', 'en', 'fr'].includes(config.DEFAULT_LOCALE) ? config.DEFAULT_LOCALE : 'en';
const getDefaultLocale = () => DEFAULT_LOCALE;
const setDefaultLocale = (newLocale) => { /* ... */ };
function updateConfigAndGlobals() { /* ... */ }
const getConfig = () => config;

// Multer Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'uploads');
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage: storage });

// =============================================================================
// Global Variables (Setup Check)
// =============================================================================
let needsSetup = false;
const getNeedsSetup = () => needsSetup;
const setNeedsSetup = (value) => { needsSetup = !!value; };

// =============================================================================
// Async Application Start Function
// =============================================================================
async function startApp() {
    let db; // Variable to hold the resolved DB instance

    try {
        console.log("--- [SERVER] Initializing Database ---");
        db = await initializeDatabase(); // Wait for the database to be ready
        console.log("--- [SERVER] Database Initialized Successfully ---");

        // --- Perform Setup Check (Safely after DB init) ---
        console.log("[Setup Check] Performing initial setup check...");
        await new Promise((resolve, reject) => { // Wait for the check to complete
             db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
                if (err) {
                    if (err.message.includes('no such table')) {
                        console.warn(`[Setup Check] Table 'users' not found. Initial setup is required.`);
                        setNeedsSetup(true);
                        resolve();
                    } else {
                        console.error("[Setup Check] Error checking for existing users:", err.message);
                        setNeedsSetup(true); // Assume setup on error
                        console.warn("[Setup Check] Could not check for users. Assuming initial setup is required.");
                        reject(err); // Reject on unexpected DB errors
                    }
                } else if (row.count === 0) {
                    setNeedsSetup(true);
                    console.log("[Setup Check] No users found. Initial setup is required.");
                    resolve();
                } else {
                    setNeedsSetup(false);
                    console.log("[Setup Check] Users found. Initial setup is not required.");
                    resolve();
                }
            });
        });
        console.log("[Setup Check] Finished.");

    } catch (dbError) {
        console.error("--- [SERVER] FATAL: Failed to initialize database or perform setup check. ---", dbError);
        process.exit(1);
    }

    // =============================================================================
    // Express App Initialization (Only if DB is ready)
    // =============================================================================
    const app = express();

    // Confie no primeiro proxy reverso na cadeia
    // Se você tiver mais de um proxy, pode precisar ajustar o valor (ex: 'loopback, 123.123.123.123')
    // Ou usar uma função de confiança mais complexa. '1' é comum para um único proxy.
    app.set('trust proxy', 1);
    // View Engine (EJS) and Layouts Configuration
    app.set('view engine', 'ejs');
    app.use(expressLayouts);
    // app.set('layout', 'layout'); // Ensure this is commented out or removed if using layout directives in .ejs files
    app.set('views', path.join(__dirname, 'views'));

    // =============================================================================
    // Import Middlewares (AFTER DB is initialized)
    // =============================================================================
    const localsMiddleware = require('./middleware/locals');
    const setupMiddleware = require('./middleware/setup');
    const authMiddlewareFunctions = require('./middleware/auth')(DEV_MODE, db); // Pass db

    // =============================================================================
    // Express App Configuration (Middleware Pipeline)
    // =============================================================================

    // Session Configuration
    app.use(session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: { secure: !DEV_MODE, httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 }
    }));

    // Connect-Flash Middleware
    app.use(flash());

    // Global Flash Message Variables Middleware
    app.use((req, res, next) => {
      res.locals.success_msg = req.flash('success');
      res.locals.error_msg = req.flash('error');
      next();
    });

    // Body Parsers
    app.use(express.urlencoded({ extended: true }));
    app.use(express.json());

    // Serve Static Files
    app.use(express.static(path.join(__dirname, 'public')));
    app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
    app.use('/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));
    app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
    app.use('/js/jquery', express.static(path.join(__dirname, 'node_modules/jquery/dist')));
    app.use('/libs/bootstrap-table', express.static(path.join(__dirname, 'node_modules/bootstrap-table/dist')));
    app.use('/js/store', express.static(path.join(__dirname, 'node_modules/store-js/dist')));
    app.use('/libs/jquery-resizable-columns', express.static(path.join(__dirname, 'node_modules/jquery-resizable-columns/dist')));

    // Language and Local Variables Middleware
    app.use(localsMiddleware.setLocals(config, lang, DEV_MODE, getDefaultLocale, getNeedsSetup)); // Pass getNeedsSetup

    // Setup Check Middleware (Uses getNeedsSetup internally)
    app.use(setupMiddleware.checkSetup(getNeedsSetup));

    // =============================================================================
    // Import & Mount Routes (AFTER DB is initialized and middlewares are set)
    // =============================================================================
    // Pass the resolved 'db' instance and other dependencies
    const indexRoutes = require('./routes/index')(authMiddlewareFunctions);
    const authRoutes = require('./routes/auth')(db, bcrypt, saltRounds, getNeedsSetup, setNeedsSetup, lang, getDefaultLocale, setDefaultLocale);
    const projectRoutes = require('./routes/projects')(db, upload, getConfig, authMiddlewareFunctions);
    const templateRoutes = require('./routes/templates')(db, upload, authMiddlewareFunctions);
    const creditorRoutes = require('./routes/creditors')(db, authMiddlewareFunctions);
    const paymentRoutes = require('./routes/payments')(db, authMiddlewareFunctions);
    const settingRoutes = require('./routes/settings')(getConfig, updateConfigAndGlobals, lang, getDefaultLocale, authMiddlewareFunctions);
    const userRoutes = require('./routes/users')(db, authMiddlewareFunctions, saltRounds);
    const setupRoutes = require('./routes/setup')(db, setNeedsSetup, saltRounds);
    const incomeSourceRoutes = require('./routes/i_sources')(db, authMiddlewareFunctions); // <-- ADICIONE ESTA LINHA

    // Mount Routes
    app.use('/', indexRoutes);
    app.use('/', authRoutes); // Handles login/logout
    app.use('/setup', setupRoutes); // <-- MOUNT SETUP ROUTES

    // Middleware to redirect to setup if needed (BEFORE protected routes)
    app.use((req, res, next) => {
        const allowedPaths = ['/setup', '/public', '/css', '/js', '/libs', '/lang', '/uploads'];
        const isAllowed = req.path.startsWith('/api') || allowedPaths.some(p => req.path.startsWith(p));

        if (needsSetup && !isAllowed) {
             console.log(`[Redirect] Needs setup, redirecting from ${req.path} to /setup`);
             return res.redirect('/setup');
        }
        next();
    });

    // Mount Protected Feature Routes
    app.use('/projects', projectRoutes);
    app.use('/project', projectRoutes);
    app.use('/templates', templateRoutes);
    app.use('/creditors', creditorRoutes);
    app.use('/payments', paymentRoutes);
    app.use('/settings', settingRoutes);
    app.use('/users', userRoutes);
    app.use('/income-sources', incomeSourceRoutes); // <-- ADICIONE ESTA LINHA

    // =============================================================================
    // Error Handling Middleware (Should be last)
    // =============================================================================
    // 404 Not Found Handler
    app.use((req, res, next) => {
      res.status(404).render('error', {
          title: '404 - Not Found',
          message: res.locals.lang?.error_404_message || `The page you requested (${req.originalUrl}) was not found.`,
          user: req.session?.user,
          lang: res.locals.lang
      });
    });

    // Generic Error Handler (500)
    app.use((err, req, res, next) => {
      console.error("Unhandled Error:", err.stack || err.message || err);
      res.status(err.status || 500).render('error', {
          title: 'Error',
          message: res.locals.lang?.error_generic || 'An unexpected error occurred.',
          errorDetail: DEV_MODE ? (err.stack || err.message) : undefined,
          user: req.session?.user,
          lang: res.locals.lang
      });
    });

    // =============================================================================
    // Server Start
    // =============================================================================
    app.listen(PORT, () => {
      console.log(`SmartExpense running at http://localhost:${PORT}`);
      console.log(`Environment (NODE_ENV): ${NODE_ENV}`);
      console.log(`Development Mode (DEV_MODE): ${DEV_MODE}`);
      console.log(`Default Language (DEFAULT_LOCALE from config.js): ${DEFAULT_LOCALE}`);
      if (needsSetup) {
            console.warn("*****************************************************");
            console.warn("*** Initial setup required. Go to /setup in your browser. ***");
            console.warn("*****************************************************");
        }
    });

} // End of startApp function

// =============================================================================
// Execute the Async Start Function
// =============================================================================
startApp();