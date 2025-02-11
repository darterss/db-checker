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

// Основной поток
if (isMainThread) {
    (async () => {
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

        await new Promise((resolve) => {
            rl.question('Очистить данные предыдущих запросов из папок Results и Logs? (введите "y" для удаления)', (answer) => {
                if (answer.trim() === 'y') {
                    clearResults();
                }
                resolve();
            });
        });

        rl.close();

        const startTime = Date.now();

        // Вывод динамических данных в консоль
        let processedLines = 0;
        let activeWorkers = 0;
        const interval = setInterval(() => {
            const currentTime = new Date().toISOString().slice(0, 19).replace('T', ' ');
            console.log(`[${currentTime}] Строк пройдено: ${processedLines}/${targets.size} Потоки ${activeWorkers}/${MAX_CONCURRENT_WORKERS}`);
        }, 5000);

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

        for (const { url, login, password } of targets) {
            while (activeWorkers >= MAX_CONCURRENT_WORKERS) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            const proxy = proxies[proxyIndex % proxies.length];
            proxyIndex++;

            const workerData = { url, login, password, columnsToFind, whatNeeds };
            if (proxy) workerData.proxy = proxy;
            const worker = new Worker(__filename, { workerData });

            activeWorkers++;

            workers.push(new Promise((resolve) => {
                worker.on('message', (message) => {
                    if (message) {
                        results.push(message);
                    }
                });

                worker.on('error', (error) => {
                    logger.error(`Worker ошибка: ${error.message}`);
                });

                worker.on('exit', (code) => {
                    if (code !== 0) {
                        logger.error(`Worker остановлен с кодом выхода: ${code}`);
                    }

                    activeWorkers--;
                    processedLines++;

                    if (processedLines >= targets.size) {
                        clearInterval(interval);
                    }

                    resolve();
                });
            }));
        }

        // Ждём завершения всех воркеров
        await Promise.all(workers);

        // Запись результатов
        if (whatNeeds === '2' || whatNeeds === 'both') {
            if (results.length > 0) {
                fs.appendFileSync('./results/all_tables.json', JSON.stringify(results, null, 2) + ',\n');

                let output = "";
                results.forEach((item) => {
                    output += `${item.url}:${item.login}:${item.password}\n`;
                    for (const [dbName, tables] of Object.entries(item.databases)) {
                        output += `          ${dbName}\n`;
                        tables.forEach((table) => {
                            output += `               ${table}\n`;
                        });
                    }
                });
                fs.appendFileSync('./results/all_tables.txt', output);
                logger.info(`Результаты записаны в all_tables, в папку Results`);
                console.log(`Результаты записаны в all_tables, в папку Results`);
            } else {
                logger.warn('Нет данных для записи в all_tables.json');
            }
        }
        if (whatNeeds === '1' || whatNeeds === 'both') {
            logger.info(`Результаты записаны в found_columns.txt, в папку Results`);
            console.log(`Результаты записаны в found_columns.txt, в папку Results`);
        }

        // Замеряем время выполнения
        const endTime = Date.now();
        const executionTime = (endTime - startTime) / 1000;
        logger.info(`Выполнение завершено за ${executionTime.toFixed(2)} сек.`);
        console.log(`Выполнение завершено за ${executionTime.toFixed(2)} сек.`);
    })();
}

else {
    workerTask(workerData)
        .then((entry) => {
            if (entry) {
                parentPort.postMessage(entry);
            }
        })
        .catch(err => {
            logger.error(`Worker error: ${err.message}`);
        })
        .finally(() => {
            parentPort.close();
        });
}
