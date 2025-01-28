const { parentPort } = require('worker_threads');
const axios = require('axios');
const config = require('./config');
const logger = require('./logger');
const { parseHTMLMessage } = require('./parser');

// Обработка задачи
const executeQuery = async (query) => {
    try {
        const response = await axios.post(`${config.phpMyAdmin}/sql.php`, {
            sql: query,
            user: config.dbUser,
            password: config.dbPass,
        });

        if (response.data && response.data.MESSAGE) {
            return parseHTMLMessage(response.data.MESSAGE);
        }

        return null;
    } catch (err) {
        logger.error(`Error executing query: ${err.message}`);
        throw err;
    }
};

// Слушать сообщения от основного потока
parentPort.on('message', async (task) => {
    try {
        const result = await executeQuery(task.query);
        parentPort.postMessage({ taskId: task.id, result });
    } catch (err) {
        parentPort.postMessage({ taskId: task.id, error: err.message });
    }
});
