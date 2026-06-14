const express = require('express');
const db = require('../db');
const authenticateJWT = require('../middleware/auth');

const router = express.Router();

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
        return res.status(400).json({ error: 'only HTTP and HTTPS protocols are supproted' });
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

})