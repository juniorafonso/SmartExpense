# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SmartExpense is a multilingual expense management system built with Node.js, Express, EJS, and SQLite. It helps households or small teams manage monthly and one-time expenses with support for templates, document attachments, and project-based organization.

## Development Commands

### Running the Application
```bash
node server.js
```

### Database Management
- Database initialization happens automatically on server start
- Database path is configurable via `DATABASE_PATH` environment variable
- Default database location: `./smart_expense.db`

### Docker Development
```bash
# Build and run with Docker Compose
docker-compose up -d

# Stop the application
docker-compose down

# Update to latest image
docker-compose pull && docker-compose up -d --force-recreate
```

## Architecture Overview

### Application Structure
- **Entry Point**: `server.js` - Async application startup with database initialization
- **Database**: `database.js` - SQLite database initialization and table creation
- **Routes**: Modular route handlers in `/routes` directory
- **Views**: EJS templates in `/views` with Bootstrap styling
- **Middleware**: Authentication, localization, and setup checks in `/middleware`

### Key Components

#### Database Layer (`database.js`)
- SQLite database with automatic table creation
- Promise-based initialization pattern
- Tables: users, projects, expenses, templates, creditors, payments, income_sources, incomes, annual_plan_items
- Proper foreign key relationships and indexes

#### Authentication System (`middleware/auth.js`)
- Session-based authentication with bcrypt password hashing
- Role-based access control (admin/user)
- Development mode simulation (DEV_MODE bypasses auth for testing)
- Protected routes with `ensureAuthenticated` middleware

#### Route Organization
Routes are modular functions that accept database instance and middleware:
- `/routes/index.js` - Dashboard with project stats and annual planning
- `/routes/auth.js` - Login/logout functionality
- `/routes/projects.js` - Project management and expense tracking
- `/routes/templates.js` - Expense template management
- `/routes/creditors.js` - Creditor management
- `/routes/payments.js` - Payment method management
- `/routes/users.js` - User management (admin only)
- `/routes/setup.js` - Initial system setup
- `/routes/i_sources.js` - Income source management
- `/routes/annual_plan.js` - Annual planning API

#### Configuration System
- Environment variables loaded via dotenv
- `config.js` for application settings (locale, currency)
- `lang.json` for multilingual support (English, Portuguese, French)
- Session configuration with secure cookies in production

### Database Schema Highlights
- **Projects**: Central organizing entity for expenses/incomes
- **Expenses**: Support for fixed/one-time types with file attachments
- **Templates**: Reusable expense sets for quick project setup  
- **Annual Planning**: Monthly expense and deposit tracking

### Security Features
- Bcrypt password hashing (10 salt rounds)
- Session-based authentication with secure cookies
- CSRF protection via session validation
- File upload restrictions and secure storage
- Environment variable validation (SESSION_SECRET required)

### Multilingual Support
- Language switching via `res.locals.lang` 
- Supported languages: English (en), Portuguese (pt), French (fr)
- Currency support: USD, BRL, EUR, CHF, GBP

## Development Notes

### Environment Variables Required
- `SESSION_SECRET`: Strong secret for session encryption (REQUIRED)
- `DATABASE_PATH`: Path to SQLite database file (optional)
- `NODE_ENV`: Set to 'production' for production mode
- `PORT`: Application port (default: 3000)

### File Structure Patterns
- Routes export functions accepting `(db, ...middleware/dependencies)`
- Database operations use Promise wrappers for async/await compatibility
- EJS views use `express-ejs-layouts` with Bootstrap styling
- Static files served from `/public`, `/node_modules` paths

### Initial Setup Flow
1. Application checks for existing users on startup
2. If no users exist, redirects to `/setup` for initial admin creation
3. Setup middleware prevents access to protected routes until complete
4. Admin user creation enables normal application flow

### File Upload System
- Multer configuration for document attachments
- Files stored in `/uploads` directory with timestamp prefixes
- PDF support for expense documentation

## Testing and Development
- No formal test framework configured
- Development mode (`NODE_ENV !== 'production'`) enables:
  - Automatic admin user simulation
  - Enhanced error reporting
  - Insecure cookie settings for local development