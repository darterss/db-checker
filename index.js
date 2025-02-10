const fs = require('fs');
const readline = require('readline');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const ini = require("ini");
const workerTask = require("./workers/workerTask");
const logger = require("./utils/logger");
const { readFileIfExists, readProxies, clearResults } = require("./utils/fileUtils");

let whatNeeds = ''; // выбор вариантов обработок

// Чтение конфигурации из config.ini
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
const MAX_CONCURRENT_WORKERS = parseInt(config.settings.max_concurrent_workers, 10) || 5;

// Функция для разбора строки
function parseLine(line) {
    const match = line.match(/^(https?:\/\/[^\s:]+(:\d+)?(?:\/[^\s:]*)?):([^:]+):(.+)$/);
    if (match) {
        const [, url, , login, password] = match;
        return { url, login, password };
    }
    return null;
}

// Очистка файлов с предыдущими результатами при запуске программы
clearResults();

// Основной поток
if (isMainThread) {
    (async () => {
        // запрос данных от пользователя
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const inputFile = await new Promise((resolve) => {
            rl.question('Введите название файла с данными для поиска (в папке files) [по умолчанию input.txt]: ', (answer) => {
                resolve(answer.trim() || 'input.txt');
            });
        });

        whatNeeds = await new Promise((resolve) => {
            rl.question('Выберите нужный вариант: \n' +
                '1 - Поиск по названию колонок внутри таблиц\n' +
                '2 - Получение списка всех таблиц внутри всех баз данных\n' +
                'Ничего не вводите, если требуется выполнить оба варианта\n', resolve);
        });
        whatNeeds = whatNeeds.trim() || 'both';

        let columnsToFind = '';
        if (whatNeeds === '1' || whatNeeds === 'both') {
            columnsToFind = await new Promise((resolve) => {
                rl.question('Введите названия колонок для поиска (через запятую): ', resolve);
            });
        }

        rl.close();

        const startTime = Date.now();

        const proxies = readProxies('./files/proxies.txt');
        const rawLines = readFileIfExists('./files/' + inputFile);
        const targets = new Set();

        for (const line of rawLines) {
            const parsed = parseLine(line);
            if (parsed) {
                targets.add(parsed);
            }
        }

        const workers = [];
        let proxyIndex = 0;
        const results = [];

        // Счётчик активных потоков
        let activeWorkers = 0;

        for (const { url, login, password } of targets) {
            // Ожидаем, пока количество активных потоков не станет меньше MAX_CONCURRENT_WORKERS
            while (activeWorkers >= MAX_CONCURRENT_WORKERS) {
                await new Promise(resolve => setTimeout(resolve, 100)); // Пауза перед следующей попыткой
            }

            const proxy = proxies[proxyIndex % proxies.length];
            proxyIndex++;

            const workerData = { url, login, password, columnsToFind, whatNeeds };
            if (proxy) workerData.proxy = proxy;
            const worker = new Worker(__filename, { workerData });

            activeWorkers++;  // Увеличиваем счётчик активных потоков

            worker.on('message', (message) => {
                logger.info(`Базы данных с ${JSON.stringify(message.url, null, 2)} обработаны`);
            });

            worker.on('error', (error) => {
                logger.error(`Worker ошибка: ${error.message}`);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    logger.error(`Worker остановлен с кодом выхода: ${code}`);
                }

                activeWorkers--;  // Уменьшаем счётчик активных потоков
            });

            worker.on('message', (entry) => {
                if (entry) {
                    results.push(entry);
                }
            });

            workers.push(worker);
        }

        // Ожидание завершения всех worker'ов
        await Promise.all(workers.map(worker => new Promise((resolve) => {
            worker.on('exit', resolve);
        })));

        // Запись результатов в JSON-файл
        if (whatNeeds === '2' || whatNeeds === 'both') {
            if (results.length > 0) {
                fs.writeFileSync('./results/all_tables.json', JSON.stringify(results, null, 2));
                logger.info(`Результаты записаны в all_tables.json, в папку Results`);
            } else {
                logger.warn('Нет данных для записи в all_tables.json');
            }
        }
        if (whatNeeds === '1' || whatNeeds === 'both') {
            logger.info(`Результаты записаны в found_columns.txt, в папку Results`);
        }

        // Замеряем время выполнения
        const endTime = Date.now();
        const executionTime = (endTime - startTime) / 1000; // В секундах
        logger.info(`Выполнение завершено за ${executionTime.toFixed(2)} сек.`);
    })();
}

 else {
    // Код для worker'а
    workerTask(workerData)
        .then((entry) => {
            if (entry) {
                parentPort.postMessage(entry);
            }
        })
        .catch(err => {
            logger.error(`Worker error: ${err.message}`);
        });
}