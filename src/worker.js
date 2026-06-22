const db = require('./db');

let isRunning = false;

//boot up recovery - reset any jobs stuck in 'running'  back to 'pending' on startup

function recoverStuckJobs() {
    try {
        const result = db.prepare(`
            UPDATE jobs 
            SET status = 'pending', updated_at = CURRENT_TIMESTAMP
            WHERE status = 'running'
        `).run();
        if (result.changes > 0) {
            console.log(`Worker: recovered ${result.changes}  stuck running jobs back to pending`);
        }
    } catch (error) {
        console.error('Worker: recovery failed', error);
    }
}

//core execution func for due jobs
async function executeDueJobs() {
    const now = Date.now();

    //query for due jobs that are currently 'pending'
    const dueJobs = db.prepare(`
        SELECT id, name, url, method, headers, payload, schedule_type, schedule_value, failure_count
        FROM jobs
        WHERE status = 'pending' AND next_run_at <= ?
    `).all(now);

    if (dueJobs.length === 0) return;

    //process all due jobs in parallel
    await Promise.allSettled(dueJobs.map(async (job) => {
        //double execution prevention - try to mark the job as 'running' in sqlite first
        const claim = db.prepare(
            `UPDATE jobs
            SET status = 'running', updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND status = 'pending'
        `).run(job.id);

        //if naother process/worker thread claimed it first , skip
        if (claim.changes === 0) return;

        console.log(`Worker: Executing job "${job.name}" (ID: ${job.id}) -> ${job.url}`);

        let fetchHeaders = {};
        try {
            fetchHeaders = job.headers ? JSON.parse(job.headers) : {};
        } catch (error) {
            console.error(`Worker: Failed to parse headers for job ${job.id}, defaulting to empty object:`, error);
        }
        const hasContentType = Object.keys(fetchHeaders).some(k => k.toLowerCase() === 'content-type');

        //default content-type if payload exists
        if (!hasContentType && job.payload) {
            fetchHeaders['Content-Type'] = 'application/json';
        }

        const start = Date.now();
        let responseStatusCode = null;
        let responseBody = null;
        let errorMessage = null;

        try {
            const options = {
                method: job.method,
                headers: fetchHeaders,
            };

            if (job.payload && job.method !== 'GET' && job.method !== 'HEAD') {
                options.body = job.payload;
            }
            const response = await fetch(job.url, options);
            responseStatusCode = response.status;
            const rawBody = await response.text();
            responseBody = rawBody.slice(0, 5000);
        } catch (error) {
            errorMessage = error.message;
        }

        const responseTimeMs = Date.now() - start;
        const isSuccess = !errorMessage && responseStatusCode < 400;

        //log attmept to job_logs
        //attempt number is the previous failure_count + 1
        const attemptNumber = job.failure_count + 1;

        db.prepare(`
            INSERT INTO job_logs (job_id, attempt_number, status_code, response_time_ms, response_body, error_message)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(job.id, attemptNumber, responseStatusCode, responseTimeMs, responseBody, errorMessage);

        //rescheduling & status update logic
        if (isSuccess) {
            if (job.schedule_type === 'once') {
                db.prepare(`
                    UPDATE jobs
                    SET status = 'completed', failure_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(job.id);
            } else if (job.schedule_type === 'interval') {
                //calculate next run at
                const nextRunAt = Date.now() + (job.schedule_value * 1000);
                db.prepare(`
                    UPDATE jobs
                    SET status = 'pending', next_run_at = ?, failure_count = 0, last_error = NULL, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(nextRunAt, job.id);
            }
            console.log(`Worker: job "${job.name}" (ID: ${job.id}) completed successfully`);
        } else {
            //handle failure: increment failure_count, record error message, update status
            const newFailureCount = job.failure_count + 1;
            const errorDetail = errorMessage || `HTTP Status ${responseStatusCode}`;

            if (newFailureCount >= 5) {
                //final failure state after 5 retries
                db.prepare(`
                    UPDATE jobs
                    SET status = 'failed', failure_count = ?,
                        last_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(newFailureCount, errorDetail, job.id);
                console.log(`Worker: job "${job.name}" (ID: ${job.id}) FAILED permanently after 5 retries.`);
            } else {
                //schedule next retry with exponentioal backoff - base_delay * (2 ^ failure_count) seconds
                const baseDelay = 10;
                const backoffSeconds = baseDelay * Math.pow(2, job.failure_count);
                const nextRunAt = Date.now() + (backoffSeconds * 1000);

                db.prepare(`
                    UPDATE jobs
                    SET status = 'pending',
                        next_run_at = ?,
                        failure_count = ?,
                        last_error = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).run(nextRunAt, newFailureCount, errorDetail, job.id);
                console.log(`Worker: job "${job.name}"(ID: ${job.id}) failed. Retrying in ${backoffSeconds}s (attempt ${newFailureCount}/5)`);
            }
        }
    }));
}

//starting the scheduling loop
function startWorker() {
    recoverStuckJobs();

    const poll = async () => {
        if (isRunning) return;
        isRunning = true;

        try {
            await executeDueJobs();
        } catch (error) {
            console.error('Worker loop execution error:', error);
        } finally {
            isRunning = false;
            setTimeout(poll, 5000); // poll database every 5 seconds
        }
    };

    poll();
    console.log('Worker: Background job scheduling loop initialized');
}

module.exports = { startWorker };
