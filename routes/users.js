const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

module.exports = (db, authMiddleware, saltRounds) => {

    // GET /users - Display user list page (Admin only)
    router.get('/', authMiddleware.requireAdmin, (req, res) => {
        // Select the actual columns from the database, EXCLUDING password
        db.all("SELECT id, username, email, full_name, role FROM users ORDER BY username", [], (err, users) => { // <-- Correct columns
            if (err) {
                console.error("Error fetching users:", err);
                req.flash('error', res.locals.lang?.error_fetching_users || 'Error fetching users.');
                return res.render('users', {
                    title: res.locals.lang?.users || 'Users',
                    users: [],
                    user: req.session.user,
                    lang: res.locals.lang
                });
            }
            res.render('users', {
                title: res.locals.lang?.users || 'Users',
                users: users,
                user: req.session.user,
                lang: res.locals.lang
            });
        });
    });

    // POST /users/add - Add a new user (Admin only) - UPDATED
    router.post('/add', authMiddleware.requireAdmin, async (req, res) => {
        const { username, password, email, full_name, role } = req.body; // Added email, full_name
        const allowedRoles = ['admin', 'user'];

        // Added validation for email and full_name
        if (!username || !password || !email || !full_name || !role) {
            req.flash('error', res.locals.lang?.error_all_fields_required || 'All fields are required.');
            return res.redirect('/users');
        }

        // Basic email format validation (consider a more robust library if needed)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
             req.flash('error', res.locals.lang?.error_invalid_email || 'Invalid email format.');
             return res.redirect('/users');
        }

        if (password.length < 6) {
             req.flash('error', res.locals.lang?.error_password_too_short || 'Password must be at least 6 characters long.');
             return res.redirect('/users');
        }

        if (!allowedRoles.includes(role)) {
            req.flash('error', res.locals.lang?.error_invalid_role || 'Invalid role selected.');
            return res.redirect('/users');
        }

        try {
            // Check if username or email already exists
            db.get("SELECT id FROM users WHERE username = ? OR email = ?", [username, email], async (err, existingUser) => {
                if (err) {
                    console.error("Error checking existing username/email:", err);
                    req.flash('error', res.locals.lang?.error_generic || 'An error occurred.');
                    return res.redirect('/users');
                }
                if (existingUser) {
                    // Determine which one exists for a better message (optional)
                    let message = existingUser.username === username
                        ? (res.locals.lang?.error_username_taken || 'Username already exists.')
                        : (res.locals.lang?.error_email_taken || 'Email already exists.');
                    req.flash('error', message);
                    return res.redirect('/users');
                }

                // Hash password and insert user
                const hashedPassword = await bcrypt.hash(password, saltRounds);
                // Added email, full_name to INSERT
                db.run("INSERT INTO users (username, password, email, full_name, role) VALUES (?, ?, ?, ?, ?)",
                       [username, hashedPassword, email, full_name, role], function(err) {
                    if (err) {
                        console.error("Error adding user:", err);
                        req.flash('error', res.locals.lang?.error_adding_user || 'Error adding user.');
                    } else {
                        req.flash('success', res.locals.lang?.user_added_success || 'User added successfully.');
                    }
                    res.redirect('/users');
                });
            });
        } catch (error) {
            console.error("Error hashing password or adding user:", error);
            req.flash('error', res.locals.lang?.error_generic || 'An error occurred.');
            res.redirect('/users');
        }
    });

    // POST /users/edit/:id - Edit an existing user (Admin only) - UPDATED
    router.post('/edit/:id', authMiddleware.requireAdmin, async (req, res) => {
        const { id } = req.params;
        const { username, password, email, full_name, role } = req.body; // Added email, full_name. Password is optional
        const allowedRoles = ['admin', 'user'];

        // Added validation for email and full_name
        if (!username || !email || !full_name || !role) {
            req.flash('error', res.locals.lang?.error_all_fields_required_except_password || 'Username, Email, Full Name, and Role are required.');
            return res.redirect('/users');
        }
        // Basic email format validation
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
             req.flash('error', res.locals.lang?.error_invalid_email || 'Invalid email format.');
             return res.redirect('/users');
        }
         if (password && password.length < 6) {
             req.flash('error', res.locals.lang?.error_password_too_short || 'Password must be at least 6 characters long.');
             return res.redirect('/users');
        }
        if (!allowedRoles.includes(role)) {
            req.flash('error', res.locals.lang?.error_invalid_role || 'Invalid role selected.');
            return res.redirect('/users');
        }

        try {
            // Check if new username or email already exists (and isn't the current user's)
             db.get("SELECT id, username, email FROM users WHERE (username = ? OR email = ?) AND id != ?", [username, email, id], async (err, existingUser) => {
                if (err) {
                    console.error("Error checking existing username/email for edit:", err);
                    req.flash('error', res.locals.lang?.error_generic || 'An error occurred.');
                    return res.redirect('/users');
                }
                if (existingUser) {
                     let message = existingUser.username === username
                        ? (res.locals.lang?.error_username_taken || 'Username already exists.')
                        : (res.locals.lang?.error_email_taken || 'Email already exists.');
                    req.flash('error', message);
                    return res.redirect('/users');
                }

                // Prepare SQL query and parameters - Added email, full_name
                let sql = "UPDATE users SET username = ?, email = ?, full_name = ?, role = ?";
                const params = [username, email, full_name, role];

                if (password) {
                    const hashedPassword = await bcrypt.hash(password, saltRounds);
                    sql += ", password = ?";
                    params.push(hashedPassword);
                }

                sql += " WHERE id = ?";
                params.push(id);

                db.run(sql, params, function(err) {
                    if (err) {
                        console.error("Error updating user:", err);
                        req.flash('error', res.locals.lang?.error_updating_user || 'Error updating user.');
                    } else if (this.changes === 0) {
                         req.flash('error', res.locals.lang?.error_user_not_found || 'User not found.');
                    }
                     else {
                        req.flash('success', res.locals.lang?.user_updated_success || 'User updated successfully.');
                    }
                    res.redirect('/users');
                });
            });
        } catch (error) {
            console.error("Error hashing password or updating user:", error);
            req.flash('error', res.locals.lang?.error_generic || 'An error occurred.');
            res.redirect('/users');
        }
    });

    // POST /users/delete/:id - Delete a user (Admin only) - (No changes needed here based on columns)
    router.post('/delete/:id', authMiddleware.requireAdmin, (req, res) => {
        const { id } = req.params;
        const loggedInUserId = req.session.user.id;

        if (parseInt(id, 10) === loggedInUserId) {
            req.flash('error', res.locals.lang?.error_cannot_delete_self || 'You cannot delete your own account.');
            return res.redirect('/users');
        }

        db.run("DELETE FROM users WHERE id = ?", [id], function(err) {
            if (err) {
                console.error("Error deleting user:", err);
                req.flash('error', res.locals.lang?.error_deleting_user || 'Error deleting user.');
            } else if (this.changes === 0) {
                 req.flash('error', res.locals.lang?.error_user_not_found || 'User not found.');
            } else {
                req.flash('success', res.locals.lang?.user_deleted_success || 'User deleted successfully.');
            }
            res.redirect('/users');
        });
    });

    return router;
};