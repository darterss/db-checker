const { Worker } = require('worker_threads');
const config = require('../config');
const logger = require('./logger');

const tasks = [];
const workers = [];

// Инициализация воркеров
const initWorkers = () => {
    for (let i = 0; i < config.threads; i++) {
        const worker = new Worker('./worker.js');
        workers.push(worker);

        worker.on('message', (msg) => {
            if (msg.error) {
                logger.error(`Task ${msg.taskId} failed: ${msg.error}`);
            } else {
                logger.info(`Task ${msg.taskId} completed: ${JSON.stringify(msg.result)}`);
            }
            processNextTask(worker);
        });

        worker.on('error', (err) => logger.error(`Worker error: ${err.message}`));
        worker.on('exit', () => logger.info('Worker exited'));
    }
};

// Добавить задачу
const addTask = (query) => {
    tasks.push({ id: Date.now(), query });
    const availableWorker = workers.find((w) => !w.busy);
    if (availableWorker) {
        processNextTask(availableWorker);
    }
};

// Обработать следующую задачу
const processNextTask = (worker) => {
    if (tasks.length > 0) {
        const task = tasks.shift();
        worker.postMessage(task);
    }
};

initWorkers();

module.exports = { addTask };
