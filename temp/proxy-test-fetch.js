const { HttpsProxyAgent } = require('https-proxy-agent');

// Настройки прокси
const proxy = 'http://45.86.163.132:18997';
const proxyAuth = 'modeler_lTfZBG:EcYlYXSFYFeO';
const targetUrl = 'https://example.com';

// Создаём прокси-агент
const httpsAgent = new HttpsProxyAgent({
    host: '45.86.163.132',
    port: 18997,
    auth: proxyAuth, // Указываем авторизацию в прокси
    keepAlive: true
});

// Тестовый запрос
async function testQuery() {
    try {
        console.log('Отправляем запрос через прокси...');
        const response = await fetch(targetUrl, {
            agent: httpsAgent, // Используем наш прокси-агент
            timeout: 5000
        });

        if (!response.ok) {
            throw new Error(`Ошибка ответа: ${response.status} - ${response.statusText}`);
        }

        const data = await response.text();
        console.log(`✅ Успешный запрос: ${data}`);
    } catch (error) {
        console.error(`❌ Ошибка: ${error.message}`);
    }
}

// Запускаем тест
testQuery();