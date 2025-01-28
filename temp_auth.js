const axios = require("axios");
const cheerio = require("cheerio");
const {Cookie} = require("tough-cookie");

const phpMyAdminUrl = "http://localhost/phpmyadmin";
//const phpMyAdminUrl = "https://db-checker.free.beeceptor.com";
let cookieHeader = ""; // Храним куки здесь

async function loginAndGetCookies() {
    const loginUrl = `${phpMyAdminUrl}/index.php?route=/`;

    try {
        // Делаем GET-запрос для получения initial cookies и токена
        const response = await axios.get(loginUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        });

        // Сохраняем куки
        const rawCookies = response.headers["set-cookie"];
        console.log(rawCookies);
        if (rawCookies) {
            //cookieHeader = rawCookies.map(cookie => cookie.split(";")[0]).join("; ");
            cookieHeader = rawCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0]
        }

        // Извлекаем токен
        const $ = cheerio.load(response.data);
        const token = $('input[name="token"]').val();
        //console.log(response.data);
        if (!token) throw new Error("Не удалось извлечь токен.");

        console.log("Токен найден:", token);
        console.log("Куки получены:", cookieHeader);

        // Делаем POST-запрос на авторизацию
        const body = new URLSearchParams({
            route: "/",
            token: token,
            pma_username: "root", // Укажи свой логин
            pma_password: "", // Укажи свой пароль
            server: "1",
        });

        const loginResponse = await axios.post(loginUrl, body.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                Cookie: cookieHeader, // Передаём полученные куки
            },
        });
        // Сохраняем новые куки после логина
        const newCookies = loginResponse.headers["set-cookie"];
        console.log(newCookies);
        if (newCookies) {
            cookieHeader = newCookies.filter(cookie => cookie.startsWith("phpMyAdmin=")).pop().split(';')[0]

        }

        console.log("Авторизация успешна. Куки обновлены:", cookieHeader);
        return { token };
    } catch (error) {
        console.error("Ошибка авторизации:", error.message);
        return null;
    }
}

async function executeSQLQuery(token, sqlQuery) {
    const queryUrl = `${phpMyAdminUrl}/index.php?route=/import`;

    try {
        const body = new URLSearchParams({
            route: "/import",
            token: token,
            sql_query: sqlQuery,
            is_js_confirmed: "1",
            pos: "0",
            goto: "index.php?route=/server/sql",
            message_to_show: "",
            prev_sql_query: "",
            sql_delimiter: ";",
            fk_checks: "1",
            ajax_request: "true",
            ajax_page_request: "true",
            _nocache: Date.now(),
        });

        const response = await axios.post(queryUrl, body.toString(), {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                Cookie: cookieHeader, // Используем авторизационные куки
            },
        });

        console.log("SQL-запрос выполнен. Ответ сервера:", response.data.message);
    } catch (error) {
        console.error("Ошибка выполнения SQL-запроса:", error.message);
    }
}

// Основной процесс: Авторизация → SQL-запрос
(async () => {
    const params = await loginAndGetCookies();
    if (params) {
        await executeSQLQuery(params.token, "SHOW DATABASES;");
    }
})();
