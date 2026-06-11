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

    //format validation
    if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email format' });
    }

    //password length validation
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be atleast 8 charaters long mate.' });
    }

    try {
        //async password hashing(non-blocking)
        const passwordHash = await bcrypt.hash(password, 10);
        const stmt = db.prepare('INSERT INTO users (email, password_hash) VALUES(?, ?)');
        const result = stmt.run(email, passwordHash);
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

module.exports = router;