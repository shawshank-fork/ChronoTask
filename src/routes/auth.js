const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_chronotask_key_123!';

const emailRegex = /\S+@\S+\.\S+/;

//registering a new user
router.post('/register', async (req, res) => {
    const { email, password } = req.body;
    //basic validation
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    if (typeof email !== 'string') {
        return res.status(400).json({ error: 'Email must be a string' });
    }

    if (typeof password !== 'string') {
        return res.status(400).json({ error: 'Password must be a string.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    //format validation
    if (!emailRegex.test(normalizedEmail)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    //password length validation
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be atleast 8 charaters long.' });
    }

    try {
        //async password hashing(non-blocking)
        const passwordHash = await bcrypt.hash(password, 10);
        const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES(?, ?)');
        const result = stmt.run(normalizedEmail, passwordHash);
        res.status(201).json({
            message: 'User registered successfully',
            userId: result.lastInsertRowid
        });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(400).json({ error: 'Email already registered' });
        }
        res.status(500).json({ error: 'Internal server error' });
    }
});

//user login 
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and Password are required' });
    }

    if (typeof email !== 'string') {
        return res.status(400).json({ error: 'Email must be a string' });
    }

    if (typeof password !== 'string') {
        return res.status(400).json({ error: 'Password must be a string.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    try {
        const stmt = db.prepare('SELECT id, email, password_hash FROM users WHERE email = ?');
        const user = stmt.get(normalizedEmail);

        if (!user) {
            return res.status(401).json({ error: 'Invalid Email or password' });
        }
        //aysnc password verification
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid Email or Password' });
        }
        //generating JWT token 
        const token = jwt.sign(
            { id: user.id, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        res.json({
            message: 'Login Successfull',
            token
        });

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;