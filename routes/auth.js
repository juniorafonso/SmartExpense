const express = require('express');

module.exports = (db, bcrypt, saltRounds, getNeedsSetup, setNeedsSetup, langData, getDefaultLocale, setDefaultLocale) => {
  const router = express.Router();

  /**
   * GET /setup Route
   * Displays the form for creating the first admin user.
   */
  router.get('/setup', (req, res) => {
    if (!getNeedsSetup()) return res.redirect('/login');
    res.render('setup', { error: null, layout: 'login_layout' });
  });

  /**
   * POST /setup Route
   * Processes the creation of the first admin user.
   */
  router.post('/setup', async (req, res) => {
    if (!getNeedsSetup()) return res.redirect('/login');

    // Use full_name and email from the form
    const { fullName, email, username, password, confirmPassword } = req.body;
    const lang = res.locals.lang;

    // Validations
    if (!fullName || !email || !username || !password || !confirmPassword) {
      return res.render('setup', { error: lang.error_all_fields_required || 'All fields are required.', layout: 'login_layout' });
    }
    if (password !== confirmPassword) {
      return res.render('setup', { error: lang.error_password_mismatch || 'Passwords do not match.', layout: 'login_layout' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.render('setup', { error: lang.error_invalid_email || 'Invalid email format.', layout: 'login_layout' });
    }

    try {
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Use correct column names: 'full_name', 'email', 'password' (for the hash)
      db.run('INSERT INTO users (full_name, email, username, password, role) VALUES (?, ?, ?, ?, ?)',
             [fullName, email, username, passwordHash, 'admin'], (insertErr) => {
        if (insertErr) {
          console.error("[Setup POST] Error creating admin user:", insertErr.message);
          let errorMessage = lang.error_generic || 'An error occurred.';
          if (insertErr.message.includes('UNIQUE constraint failed')) {
              if (insertErr.message.includes('.email')) {
                   errorMessage = lang.error_email_taken || 'Email already taken.';
              } else if (insertErr.message.includes('.username')) {
                   errorMessage = lang.error_username_taken || 'Username already taken.';
              } else {
                   errorMessage = lang.error_username_or_email_taken || 'Username or Email already taken.';
              }
          }
          return res.render('setup', { error: errorMessage, layout: 'login_layout' });
        }
        console.log(`[Setup POST] Admin user '${username}' (Email: ${email}) created successfully.`);
        setNeedsSetup(false);
        res.redirect('/login');
      });
    } catch (hashError) {
      console.error("[Setup POST] Error hashing password:", hashError);
      res.render('setup', { error: lang.error_generic || 'An error occurred.', layout: 'login_layout' });
    }
  });

  /**
   * GET /login Route
   * Displays the login form.
   */
  router.get('/login', (req, res) => {
    if (getNeedsSetup()) return res.redirect('/setup');
    res.render('login', { error: null, layout: 'login_layout' });
  });

  /**
   * POST /login Route
   * Processes the user's login attempt.
   */
  router.post('/login', async (req, res) => {
    if (getNeedsSetup()) return res.redirect('/setup');

    const { username, password, language } = req.body; // Correct names matching the form
    const lang = res.locals.lang;

    if (!username || !password) { // Use correct variables
      // Use flash messages for feedback if available, otherwise render with error
       if (req.flash) req.flash('error', lang.error_login || 'Invalid username/email or password.');
      return res.render('login', { error: lang.error_login || 'Invalid username/email or password.', layout: 'login_layout' });
    }

    try {
      // Select the correct 'password' column (which stores the hash)
      db.get('SELECT id, username, email, password, role, full_name FROM users WHERE username = ? OR email = ?', [username, username], async (err, user) => { // Use correct variable
        if (err) {
          console.error("[Login POST] Error fetching user:", err.message);
           if (req.flash) req.flash('error', lang.error_generic || 'An error occurred.');
          return res.render('login', { error: lang.error_generic || 'An error occurred.', layout: 'login_layout' });
        }

        // Compare provided password ('password') with the stored hash ('user.password')
        if (user && await bcrypt.compare(password, user.password)) { // Use correct variable
          console.log(`[Login POST] User '${user.username}' logged in successfully.`);
          // Store essential data in session, including full_name
          req.session.user = {
              id: user.id,
              username: user.username,
              email: user.email,
              role: user.role,
              fullName: user.full_name // Store full name in session
          };
          // Set session language if selected
          if (language && ['pt', 'en', 'fr'].includes(language)) {
              req.session.lang = language;
              setDefaultLocale(language);
          }
          res.redirect('/');
        } else {
          console.log(`[Login POST] Login failed for user/email '${username}'.`); // Use correct variable
           if (req.flash) req.flash('error', lang.error_login || 'Invalid username/email or password.');
          res.render('login', { error: lang.error_login || 'Invalid username/email or password.', layout: 'login_layout' });
        }
      });
    } catch (compareError) {
      console.error("[Login POST] Error comparing passwords:", compareError);
       if (req.flash) req.flash('error', lang.error_generic || 'An error occurred.');
      res.render('login', { error: lang.error_generic || 'An error occurred.', layout: 'login_layout' });
    }
  });

  /**
   * GET /logout Route
   * Destroys the user session and redirects to login.
   */
  router.get('/logout', (req, res) => {
    const username = req.session.user?.username;
    req.session.destroy((err) => {
      if (err) {
        console.error("[Logout] Error destroying session:", err);
      }
      console.log(`[Logout] User '${username || 'unknown'}' logged out.`);
      res.clearCookie('connect.sid');
      res.redirect('/login');
    });
  });

  return router;
};