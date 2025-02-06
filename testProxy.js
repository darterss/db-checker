const axios = require('axios');

async function testProxy(proxy) {
    const [host, port, username, password] = proxy.split(':');
    const axiosInstance = axios.create({
        proxy: {
            host,
            port: parseInt(port),
            auth: username && password ? { username, password } : undefined
        }
    });

    try {
        const response = await axiosInstance.get('http://httpbin.org/ip', {
            timeout: 10000 // Таймаут 5 секунд
        });
        console.log(`Прокси ${proxy} работает. Ваш IP: ${response.data.origin}`);
    } catch (error) {
        console.error(`Прокси ${proxy} не работает: ${error.message}`);
    }
}

// Пример использования
const proxies = [
    //'8.220.136.174:12000',
    '83.217.23.35:8090',
    '31.40.248.2:8080'
];

proxies.forEach(proxy => testProxy(proxy));