const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

// Recebe db, setNeedsSetup, saltRounds de server.js
module.exports = (db, setNeedsSetup, saltRounds) => {

    // GET /setup - Mostra a página de configuração inicial
    router.get('/', (req, res) => {
        // Verifica se o setup já foi feito (segurança extra)
        db.get('SELECT COUNT(*) as count FROM users', (err, row) => {
            if (err && !err.message.includes('no such table')) {
                 // Erro inesperado ao verificar usuários
                 console.error("[GET /setup] Error checking user count:", err);
                 // Renderiza a página de erro ou uma mensagem genérica
                 return res.status(500).send("Error checking application status.");
            }
            // Se a tabela existe e tem usuários, redireciona para login
            if (row && row.count > 0) {
                console.log("[GET /setup] Setup already complete. Redirecting to login.");
                return res.redirect('/login');
            }

            // Se não há usuários ou a tabela não existe, mostra a página de setup
            console.log("[GET /setup] Rendering setup page.");
            res.render('setup', {
                title: res.locals.lang?.initial_setup || 'Initial Setup',
                layout: 'layouts/simple', // Use um layout simples (crie se necessário)
                lang: res.locals.lang,
                // Passa mensagens flash (se houver de um redirect anterior)
                error_msg: req.flash('error'),
                success_msg: req.flash('success')
            });
        });
    });

    // POST /setup - Processa a criação do primeiro usuário admin
    router.post('/', async (req, res) => {
        const lang = res.locals.lang;
        // Corrigido para pegar 'fullName' do formulário
        const { username, password, confirmPassword, email, fullName } = req.body;

        // Validações básicas
        if (!username || !password || !confirmPassword || !email || !fullName) {
            req.flash('error', lang?.error_all_fields_required || 'All fields are required.');
            return res.redirect('/setup');
        }
        if (password !== confirmPassword) {
            req.flash('error', lang?.error_passwords_do_not_match || 'Passwords do not match.');
            return res.redirect('/setup');
        }
        // Adicione validação de força de senha se desejar (ex: mínimo 6 caracteres)
        if (password.length < 6) {
             req.flash('error', lang?.error_password_too_short || 'Password must be at least 6 characters long.');
             return res.redirect('/setup');
        }
        // Validação básica de email
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
             req.flash('error', lang?.error_invalid_email || 'Invalid email format.');
             return res.redirect('/setup');
        }


        try {
            // Verifica novamente se já existe algum usuário antes de inserir
            db.get('SELECT COUNT(*) as count FROM users', async (err, row) => {
                if (err && !err.message.includes('no such table')) {
                    console.error("[POST /setup] Error checking user count before insert:", err);
                    req.flash('error', lang?.error_generic || 'An error occurred checking user status.');
                    return res.redirect('/setup');
                }
                // Se a tabela existe e tem usuários, não permite criar outro via setup
                if (row && row.count > 0) {
                    req.flash('error', lang?.error_setup_already_complete || 'Setup has already been completed.');
                    return res.redirect('/login');
                }

                // Hash da senha
                const hashedPassword = await bcrypt.hash(password, saltRounds);

                // Insere o primeiro usuário como admin
                // Corrigido para usar 'fullName' na coluna 'full_name'
                db.run(
                    'INSERT INTO users (username, password, email, full_name, role) VALUES (?, ?, ?, ?, ?)',
                    [username, hashedPassword, email, fullName, 'admin'],
                    function (err) {
                        if (err) {
                            console.error("[POST /setup] Error creating initial admin user:", err);
                            if (err.message.includes('UNIQUE constraint failed')) {
                                // Verifica qual constraint falhou (username ou email)
                                if (err.message.includes('users.username')) {
                                    req.flash('error', lang?.error_username_taken || 'Username already exists.');
                                } else if (err.message.includes('users.email')) {
                                    req.flash('error', lang?.error_email_taken || 'Email already exists.');
                                } else {
                                    req.flash('error', lang?.error_username_or_email_taken || 'Username or email already exists.');
                                }
                            } else {
                                req.flash('error', lang?.error_creating_user || 'Error creating the initial user.');
                            }
                            return res.redirect('/setup');
                        }

                        console.log(`[POST /setup] Initial admin user created successfully (ID: ${this.lastID})`);
                        setNeedsSetup(false); // Atualiza o status global
                        req.flash('success', lang?.success_setup_complete || 'Setup complete! Please log in.');
                        res.redirect('/login'); // Redireciona para login
                    }
                );
            });
        } catch (error) {
            console.error("[POST /setup] Unexpected error:", error);
            req.flash('error', lang?.error_generic || 'An unexpected error occurred during setup.');
            res.redirect('/setup');
        }
    });

    return router;
};