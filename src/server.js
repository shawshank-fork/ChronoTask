const express = require('express');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const jobRoutes = require('./routes/jobs');
const { startWorker } = require('./worker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'ChronoTask server running'
    })
});

//start the worker before the server
startWorker();
//start the server
app.listen(PORT, () => {
    console.log(`ChronoTask server is running on port ${PORT}`);
});