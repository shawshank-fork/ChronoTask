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

//list all jobs belonging to the authenticated user

router.get('/', (req, res) => {
    const userId = req.user.id;

    try {
        const stmt = db.prepare(`
            SELECT id, name, url, method, headers, payload, schedule_type,
                   schedule_value, next_run_at, status, failure_count, last_error,
                   created_at, updated_at
            FROM jobs
            WHERE user_id = ?
            ORDER BY created_at DESC       
        `);
        const jobs = stmt.all(userId);

        //parse JSON strings back to objects for client response
        const parsedJobs = jobs.map(job => ({
            ...job,
            headers: job.headers ? JSON.parse(job.headers) : null,
            payload: job.payload ? JSON.parse(job.payload) : null
        }));

        res.json(parsedJobs);

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

//get execution longs for a specific job 
router.get('/:id/logs', (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);

    //validate that the id is a valid integer
    if (!Number.isInteger(jobId)) {
        return res.status(400).json({ error: 'job ID must be a valid integer' });
    }

    try {
        //Ensure the job exists AND belongs to the logged-in user
        const jobCheck = db.prepare('SELECT id FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
        if (!jobCheck) {
            return res.status(404).json({ error: 'Job not found or unauthorized.' });
        }

        //retrieve the logs
        const stmt = db.prepare(`
            SELECT id, job_id, attempt_number, executed_at,
                    status_code, response_time_ms, response_body, error_message
            FROM job_logs
            WHERE job_id = ?
            ORDER BY executed_at DESC    
        `);

        const logs = stmt.all(jobId);
        res.json(logs);

    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

//pause an active job

router.patch('/:id/pause', (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId)) {
        return res.status(400).json({
            error: 'Job ID must be a valid integer'
        });
    }

    try {
        const job = db.prepare('SELECT status FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
        if (!job) {
            return res.status(404).json({
                error: 'Job not found or unauthorized'
            });
        }

        if (job.status === 'completed' || job.status === 'failed') {
            return res.status(400).json({
                error: `Cannot pause a job that is already ${job.status}`
            });
        }

        if (job.status === 'paused') {
            return res.status(400).json({
                error: 'Job is already paused'
            });
        }

        db.prepare(`
            UPDATE jobs
            SET status = 'paused', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(jobId, userId);

        res.json({ message: 'Job paused successfully' });

    } catch (error) {
        res.status(500).json({
            error: 'Internal server error'
        });

    }
});

//resume a paused job
router.patch('/:id/resume', (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId)) {
        return res.status(400).json({ error: 'job ID must be a valid integer' });
    }

    try {
        const job = db.prepare('SELECT status, schedule_value FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId);

        if (!job) {
            return res.status(404).json({ error: 'Job not found or unauthorized' });
        }

        if (job.status !== 'paused') {
            return res.status(400).json({ error: 'Only paused jobs can be resumed' });
        }

        //recalculating the next execution time relative to now
        const nextRunAt = Date.now() + (job.schedule_value * 1000);

        //update the job to pending and set the new next run time
        db.prepare(`
            UPDATE jobs
            SET status = 'pending',
            next_run_at = ?,
            failure_count = 0,
            last_error = null,
            updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
        `).run(nextRunAt, jobId, userId);

        res.json({ message: 'job resumed successfully', next_run_at: nextRunAt });
    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});

//cancel and delete a job
router.delete('/:id', (req, res) => {
    const userId = req.user.id;
    const jobId = Number(req.params.id);

    if (!Number.isInteger(jobId)) {
        return res.status(400).json({ error: 'job ID must be a valid integer' });
    }

    try {
        const jobCheck = db.prepare('SELECT id FROM jobs WHERE id = ? AND user_id = ?').get(jobId, userId);

        if (!jobCheck) {
            return res.status(404).json({ error: 'Job not found or unauthorized.' });
        }

        db.prepare('DELETE FROM jobs WHERE id = ? AND user_id = ?').run(jobId, userId);

        res.json({ message: 'Job deleted successfully' });

    } catch (error) {
        return res.status(500).json({ error: 'Internal server error' });
    }
});


module.exports = router;