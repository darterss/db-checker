const axios = require('axios');
const tough = require('tough-cookie');
const cheerio = require('cheerio');

const phpMyAdminUrl = 'http://localhost/phpmyadmin';
const cookieJar = new tough.CookieJar();

async function loginToPhpMyAdmin(username, password) {
    const loginUrl = `${phpMyAdminUrl}/index.php`;

    try {
        // 1. Получаем начальную страницу для извлечения токена
        const response = await axios.get(loginUrl, {
            headers: { 'Content-Type': 'text/html' },
            jar: cookieJar,
            withCredentials: true,
        });

        const $ = cheerio.load(response.data);
        const token = $('input[name="token"]').val();

        if (!token) {
            console.error('Не удалось извлечь токен.');
            return null;
        }

        console.log('Извлечён токен:', token);

        // 2. Выполняем авторизацию
        const loginResponse = await axios.post(
            loginUrl,
            new URLSearchParams({
                route: '/',
                token,
                pma_username: username,
                pma_password: password,
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                jar: cookieJar,
                withCredentials: true,
            }
        );

        const cookies = loginResponse.headers['set-cookie'];
        const phpMyAdminCookie = cookies?.find((c) => c.startsWith('phpMyAdmin='));

        if (!phpMyAdminCookie) {
            console.error('Куки phpMyAdmin не найдена.');
            return null;
        }

        const phpMyAdminValue = phpMyAdminCookie
            .split(';')[0]
            .split('=')[1];

        console.log('Извлечён phpMyAdmin куки:', phpMyAdminValue);

        // 3. Проверяем успешность входа
        const loginHtml = cheerio.load(loginResponse.data);
        if (loginHtml('#input_password').length > 0) {
            console.error('Не удалось авторизоваться.');
            //console.error(loginHtml('div.alert').text());
            return null;
        }

        console.log('Авторизация успешна.');
        return { token, session: cookieJar, phpMyAdmin: phpMyAdminValue };
    } catch (error) {
        console.error('Ошибка при авторизации:', error.message);
        return null;
    }
}

async function executeSQLQuery(session, token, phpMyAdmin, query) {
    const queryUrl = `${phpMyAdminUrl}/index.php?route=/import`;

    try {
        const response = await axios.post(
            queryUrl,
            new URLSearchParams({
                route: '/import',
                token,
                sql_query: query,
                ajax_request: 'true',
                ajax_page_request: 'true',
            }),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Cookie: `phpMyAdmin=${phpMyAdmin}`, // куки в заголовке
                },
                jar: session,
                withCredentials: true,
            }
        );

        if (response.data.success) {
            console.log('SQL-запрос выполнен успешно. Ответ:', response.data);
            return response.data;
        } else {
            console.error(
                'Ошибка выполнения SQL-запроса:',
                response.data || 'Нет данных об ошибке.'
            );
            return null;
        }
    } catch (error) {
        console.error('Ошибка при выполнении SQL-запроса:', error.message);
        return null;
    }
}

// Выполнение авторизации и запроса
(async () => {
    const credentials = {
        username: 'root',
        password: 'password1',
    };

    const auth = await loginToPhpMyAdmin(credentials.username, credentials.password);

    if (auth) {
        await executeSQLQuery(auth.session, auth.token, auth.phpMyAdmin, 'SHOW DATABASES;');
    }
})();
