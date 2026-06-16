const express = require('express');
const db = require('../db');
const authenticateJWT = require('../middleware/auth');

const router = express.Router();
const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

router.use(authenticateJWT); //protecting all endpoints

//creating and scheduling a new job
router.post('/', (req, res) => {
    const { name, url, method, headers, payload, schedule_type, schedule_value } = req.body;
    const userId = req.user.id;

    //Checking the presence of required params
    if (!name || !url || !schedule_type || schedule_value === undefined) {
        return res.status(400).json({ error: 'name, url, schedule_type and schedule_value - all are REQUIRED' });
    }

    //url validation to prevent worker fetch failures
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    } catch (error) {
        return res.status(400).json({ error: 'Invalid URL format' });
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: 'only HTTP and HTTPS protocols are supported' });
    }

    //schedule type validation
    if (!['once', 'interval'].includes(schedule_type)) {
        return res.status(400).json({ error: " schedule_type must be either 'once' or 'interval' " });
    }

    //schedule_value validation(must be in positive integer seconds)
    const valueInt = Number(schedule_value);
    if (!Number.isInteger(valueInt) || valueInt <= 0) {
        return res.status(400).json({ error: 'schedule_value must be a positive integer(seconds)' });
    }

    //HTTP Method validation
    const httpMethod = (method || 'GET').toUpperCase();
    if (!VALID_METHODS.includes(httpMethod)) {
        return res.status(400).json({ error: `unsupported HTTP method: ${httpMethod}` });
    }

    // Headers validation - headers must be a key-value object, not an array
    if (headers && (typeof headers !== 'object' || Array.isArray(headers))) {
        return res.status(400).json({ error: 'headers must be a JSON object containing key-value pairs' });
    }

    //payload validation - payload can be an object or a JSON array
    if (payload && typeof payload !== 'object') {
        return res.status(400).json({ error: 'payload must be a valid JSON object or array' });
    }

    try {
        // calculate the initial next execution time
        const nextRunAt = Date.now() + (valueInt * 1000);

        //standardize optional fields as JSON strings for database storage 
        const headersStr = headers ? JSON.stringify(headers) : null;
        const payloadStr = payload ? JSON.stringify(payload) : null;

        const stmt = db.prepare(`
            INSERT INTO jobs (
                user_id, name, url, method, headers, payload, schedule_type, schedule_value, next_run_at, status
            ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending') 
        `);

        const result = stmt.run(
            userId, name, url, httpMethod, headersStr, payloadStr, schedule_type, valueInt, nextRunAt,
        );

        res.status(201).json({
            message: 'job scheduled successfully',
            job: {
                id: result.lastInsertRowid,
                name,
                url,
                method: httpMethod,
                schedule_type,
                schedule_value: valueInt,
                next_run_at: nextRunAt,
                status: 'pending'
            }
        });

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = router;