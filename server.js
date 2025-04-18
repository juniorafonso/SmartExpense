require('dotenv').config(); // Load variables from .env into process.env -> ADDED AT THE TOP

// =============================================================================
// Essential Imports
// =============================================================================
const express = require('express');
const session = require('express-session');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const expressLayouts = require('express-ejs-layouts'); // <-- 1. Require the module
const fs = require('fs');
const bcrypt = require('bcrypt');
const flash = require('connect-flash'); // Import connect-flash

// =============================================================================
// Configuration & Constants from .env and config.js
// =============================================================================

// --- Variables from .env ---
const PORT = process.env.PORT || 3000; // Use port from .env or 3000 as fallback
const sessionSecret = process.env.SESSION_SECRET;
const dbPath = process.env.DATABASE_PATH || './db.sqlite'; // Use path from .env or './db.sqlite'
const NODE_ENV = process.env.NODE_ENV || 'development'; // 'development' or 'production'
const DEV_MODE = NODE_ENV === 'development'; // Derive DEV_MODE directly from NODE_ENV

// Check if SESSION_SECRET is defined in .env
if (!sessionSecret) {
    console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error("FATAL ERROR: SESSION_SECRET not defined in the .env file!");
    console.error("Generate a secure key and add it to your .env file.");
    console.error("Example: SESSION_SECRET=\"a_very_long_and_secure_random_string\"");
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n");
    process.exit(1); // Abort initialization if the secret key is not defined
}

// --- Load config.js (for non-sensitive/non-environment settings) ---
let config;
let lang;

function loadConfigAndLang() {
    try {
        // Clear cache to ensure fresh require
        delete require.cache[require.resolve('./config')];
        config = require('./config');
    } catch (e) {
        console.warn("config.js file not found or invalid. Using default values (except DEV_MODE).");
        // DEV_MODE now comes from NODE_ENV, no longer set here as primary fallback
        config = { DEFAULT_LOCALE: 'en', DEFAULT_CURRENCY: 'USD' };
    }
    try {
        // Clear cache for lang.json as well
        delete require.cache[require.resolve('./lang.json')];
        lang = require('./lang.json');
    } catch (e) {
        console.error("Error loading lang.json:", e);
        // Provide a minimal fallback language object
        lang = { en: { error_generic: "An error occurred." } };
    }
}

loadConfigAndLang(); // Initial load

// --- Derived Constants and Global Variables ---
const saltRounds = 10; // bcrypt salt rounds

// Validate and set the default locale globally (prioritize config.js, fallback 'en')
let DEFAULT_LOCALE = ['pt', 'en', 'fr'].includes(config.DEFAULT_LOCALE)
  ? config.DEFAULT_LOCALE
  : 'en';

// Function to get the current default locale
const getDefaultLocale = () => DEFAULT_LOCALE;
// Function to set the current default locale
const setDefaultLocale = (newLocale) => {
    if (['pt', 'en', 'fr'].includes(newLocale)) {
        DEFAULT_LOCALE = newLocale;
    }
};

// Function to reload config.js and lang.json (no longer directly affects DEV_MODE)
function updateConfigAndGlobals() {
    loadConfigAndLang();
    // Update DEFAULT_LOCALE based on the reloaded config
    DEFAULT_LOCALE = ['pt', 'en', 'fr'].includes(config.DEFAULT_LOCALE) ? config.DEFAULT_LOCALE : 'en';
    console.log("Configuration (config.js) and language (lang.json) reloaded.");
    // DEV_MODE is based on NODE_ENV and doesn't change dynamically here
    console.log(`Development Mode (DEV_MODE based on NODE_ENV): ${DEV_MODE}`);
    console.log(`New DEFAULT_LOCALE (from config.js): ${DEFAULT_LOCALE}`);
}

// Function to get the current config (from config.js)
const getConfig = () => config;

// Multer Configuration (File Uploads)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'uploads');
    fs.mkdirSync(uploadPath, { recursive: true }); // Create directory if it doesn't exist
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    // Create a unique and safe filename
    cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage: storage });

// =============================================================================
// Global Variables (Setup Check)
// =============================================================================
let needsSetup = false; // Controls the need for initial setup
const getNeedsSetup = () => needsSetup; // Function to get the state
const setNeedsSetup = (value) => { needsSetup = !!value; }; // Function to set the state

// =============================================================================
// Database Connection & Initial Setup Check
// =============================================================================
// Use dbPath from .env
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(`Fatal error connecting to the database at '${dbPath}':`, err.message);
    process.exit(1);
  }
  console.log(`Connected to SQLite database at '${dbPath}'.`);

  // Check if any user exists in the 'users' table (logic unchanged)
  db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
    if (err) {
      // If the users table doesn't exist, assume setup is needed
      if (err.message.includes('no such table')) {
          console.warn("Table 'users' not found. Initial setup is required.");
          setNeedsSetup(true);
      } else {
          console.error("Error checking for existing users:", err.message);
          setNeedsSetup(true); // Assume setup in case of unknown error
          console.warn("Could not check for users. Assuming initial setup is required.");
      }
    } else if (row.count === 0) {
      setNeedsSetup(true);
      console.log("No users found. Initial setup is required.");
    } else {
      setNeedsSetup(false);
      console.log("Users found. Initial setup is not required.");
    }
  });
});

// =============================================================================
// Express App Initialization
// =============================================================================
const app = express();

// View Engine (EJS) and Layouts Configuration
app.set('view engine', 'ejs');
app.use(expressLayouts);
// app.set('layout', 'layout'); // <-- COMENTE ESTA LINHA
app.set('views', path.join(__dirname, 'views'));

// =============================================================================
// Import Middlewares
// =============================================================================
const localsMiddleware = require('./middleware/locals');
const setupMiddleware = require('./middleware/setup');
// Pass the DEV_MODE derived from NODE_ENV to the authentication middleware
const authMiddlewareFunctions = require('./middleware/auth')(DEV_MODE);
// Debug logs to verify middleware functions (can be removed later)
// console.log('DEBUG: authMiddlewareFunctions object:', authMiddlewareFunctions);
// console.log('DEBUG: typeof authMiddlewareFunctions.ensureAuthenticated:', typeof authMiddlewareFunctions?.ensureAuthenticated);

// =============================================================================
// Express App Configuration (Middleware Pipeline)
// =============================================================================

// Session Configuration
app.use(session({
  secret: sessionSecret, // Use the variable loaded from .env
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: !DEV_MODE, // Secure cookies only if NOT in DEV_MODE (i.e., in production)
    httpOnly: true,
    sameSite: 'lax', // Recommended for security
    maxAge: 1000 * 60 * 60 * 24 // 1 day expiration
   }
}));

// Connect-Flash Middleware (AFTER session)
app.use(flash());

// Global Flash Message Variables Middleware (BEFORE routes)
app.use((req, res, next) => {
  // Make flash messages available in templates
  res.locals.success_msg = req.flash('success'); // Or the key you use ('success_msg', 'success')
  res.locals.error_msg = req.flash('error');   // Or the key you use ('error_msg', 'error')
  next();
});

// Body Parsers (for form data and JSON)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve Static Files (public assets, bootstrap, uploads)
app.use(express.static(path.join(__dirname, 'public')));
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve jQuery from node_modules
app.use('/js/jquery', express.static(path.join(__dirname, 'node_modules/jquery/dist')));
// Serve Bootstrap Table JS and CSS from node_modules
app.use('/libs/bootstrap-table', express.static(path.join(__dirname, 'node_modules/bootstrap-table/dist')));

// Serve store.js
app.use('/js/store', express.static(path.join(__dirname, 'node_modules/store-js/dist')));
// Serve jquery-resizable-columns JS and CSS
app.use('/libs/jquery-resizable-columns', express.static(path.join(__dirname, 'node_modules/jquery-resizable-columns/dist')));

// Language and Local Variables Middleware (AFTER session and global flash)
// Pass the DEV_MODE derived from NODE_ENV
app.use(localsMiddleware.setLocals(config, lang, DEV_MODE, getDefaultLocale));

// Setup Check Middleware (BEFORE protected routes)
app.use(setupMiddleware.checkSetup(getNeedsSetup)); // Pass the function to get needsSetup state

// =============================================================================
// Import Routes
// =============================================================================
// Pass necessary dependencies to route modules
// (authMiddlewareFunctions already includes the correct DEV_MODE)
const indexRoutes = require('./routes/index')(authMiddlewareFunctions);
const authRoutes = require('./routes/auth')(db, bcrypt, saltRounds, getNeedsSetup, setNeedsSetup, lang, getDefaultLocale, setDefaultLocale);
const projectRoutes = require('./routes/projects')(db, upload, getConfig, authMiddlewareFunctions);
const templateRoutes = require('./routes/templates')(db, upload, authMiddlewareFunctions);
const creditorRoutes = require('./routes/creditors')(db, authMiddlewareFunctions);
const paymentRoutes = require('./routes/payments')(db, authMiddlewareFunctions);
// Pass functions to get/update config (from config.js)
const settingRoutes = require('./routes/settings')(getConfig, updateConfigAndGlobals, lang, getDefaultLocale, authMiddlewareFunctions);
const userRoutes = require('./routes/users')(db, authMiddlewareFunctions, saltRounds);

// =============================================================================
// Mount Routes
// =============================================================================
app.use('/', indexRoutes); // Handles '/', '/dashboard' etc.
app.use('/', authRoutes); // Handles '/login', '/logout', '/setup'

// Feature Routes (ensure paths are correct and consistent)
app.use('/projects', projectRoutes); // Handles '/projects', '/projects/create', '/projects/:name', etc.
app.use('/project', projectRoutes); // Handles '/project/:name/expenses', etc. (Consider consolidating under /projects if possible)

app.use('/templates', templateRoutes); // Handles '/templates', '/templates/:id', etc.
app.use('/creditors', creditorRoutes); // Handles '/creditors', etc.
app.use('/payments', paymentRoutes); // Handles '/payments', etc.
app.use('/settings', settingRoutes); // Handles '/settings'
app.use('/users', userRoutes); // Handles '/users', etc.

// =============================================================================
// Error Handling Middleware (Should be last)
// =============================================================================
// 404 Not Found Handler
app.use((req, res, next) => {
  res.status(404).render('error', {
      title: '404 - Not Found',
      message: res.locals.lang?.error_404_message || `The page you requested (${req.originalUrl}) was not found.`,
      user: req.session?.user, // Pass user info to the error page layout
      lang: res.locals.lang // Pass lang object
      // layout: 'layout' // Explicitly set layout if needed, though default should work
  });
});

// Generic Error Handler (500)
app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack || err.message || err); // Log the full error
  res.status(err.status || 500).render('error', {
      title: 'Error',
      message: res.locals.lang?.error_generic || 'An unexpected error occurred.',
      // Show detailed error only in development mode for security
      errorDetail: DEV_MODE ? (err.stack || err.message) : undefined,
      user: req.session?.user, // Pass user info
      lang: res.locals.lang // Pass lang object
      // layout: 'layout' // Explicitly set layout if needed
  });
});

// =============================================================================
// Server Start
// =============================================================================
// Use PORT from .env
app.listen(PORT, () => {
  console.log(`SmartExpense running at http://localhost:${PORT}`);
  // Log environment details on startup
  console.log(`Environment (NODE_ENV): ${NODE_ENV}`);
  console.log(`Development Mode (DEV_MODE): ${DEV_MODE}`);
  console.log(`Default Language (DEFAULT_LOCALE from config.js): ${DEFAULT_LOCALE}`);
});