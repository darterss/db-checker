// curl --proxy http://modeler_lTfZBG:EcYlYXSFYFeOxxx@45.86.163.132:18997 --proxy-insecure https://example.com

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

// Прокси данные
const proxyHost = '45.86.163.132';
const proxyPort = '18997';
const proxyUser = 'modeler_lTfZBG';
const proxyPass = 'EcYlYXSFYFeO';

const targetUrl = 'http://example.com';

// Формируем прокси-URL
const proxyUrl = `http://${proxyUser}:${proxyPass}@${proxyHost}:${proxyPort}`;

// Прокси-агент
const httpsAgent = new HttpsProxyAgent(proxyUrl, {
    rejectUnauthorized: false // Отключаем проверку SSL для прокси
});

// Создаём axios инстанс с использованием прокси
const axiosInstance = axios.create({
    validateStatus: () => true, // Игнорируем ошибки ответа
    proxy: false,  // Отключаем встроенную поддержку прокси
    httpsAgent,    // Устанавливаем прокси-агент

    timeout: 5000,
});

// Запрос через прокси
async function testQuery() {
    try {
        console.log('🚀 Отправляем запрос через прокси...');
        const response = await axiosInstance.get(targetUrl);
        console.log(`✅ Успешный запрос: ${response.status}`);
    } catch (error) {
        if (error.response) {
            console.error(`❌ Ошибка ответа: ${error.response.status} - ${error.response.statusText}`);
        } else if (error.request) {
            console.error(`❌ Ошибка запроса: Сервер не ответил.`);
        } else {
            console.error(`❌ Ошибка настройки: ${error.message}`);
        }
    }
}

// Запускаем тест
testQuery();
